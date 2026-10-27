"use server";

import {
  isCourtStep,
  receiptBlocks,
  receiptDay,
  type TestCourtView,
  testCourtViewOf,
  unitOf,
} from "@/lib/test-court/test-court";
import { createServiceClient } from "@flyee/auth/service";
import { renderTextPdf } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the test court's page does (migration 0061), by the firm's test chat
 * link: reads the test cases ready to file and the test lawsuits, hands the
 * receipt of a filing with the number the lawsuit gets, and acts on a test
 * lawsuit as its court. Every action is a public endpoint: it acts only by
 * the link's secret, which the database checks, and only on the firm's own
 * test cases. Nothing leaves ONE.
 */

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backendOrNull(): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/** The test court a link opens; `missing` for a link that opens nothing. */
export async function readTestCourt(
  token: string,
): Promise<{ ok: true; view: TestCourtView } | { ok: false; code: "missing" | "unavailable" }> {
  if (!TOKEN.test(String(token ?? ""))) return { ok: false, code: "missing" };
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const { data, error } = await service.rpc("test_court_view", { target_token: token });
  if (error) return { ok: false, code: "unavailable" };
  const view = testCourtViewOf(data);
  return view ? { ok: true, view } : { ok: false, code: "missing" };
}

export type TestCourtAnswer = { ok: boolean; code: string; published?: boolean; hearingAt?: string };

/** The court takes one step on a test lawsuit. */
export async function actTestCourt(token: string, proceedingId: string, step: string): Promise<TestCourtAnswer> {
  if (!TOKEN.test(String(token ?? "")) || !UUID.test(String(proceedingId ?? "")) || !isCourtStep(step)) {
    return { ok: false, code: "not_found" };
  }
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const { data, error } = await service.rpc("test_court_act", {
    target_token: token,
    target_proceeding: proceedingId,
    target_event: step,
  });
  if (error) return { ok: false, code: "unavailable" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; published?: string; hearing_at?: string };
  return {
    ok: answer.ok === true,
    code: String(answer.code ?? "failed"),
    published: typeof answer.published === "string",
    hearingAt: typeof answer.hearing_at === "string" ? answer.hearing_at : undefined,
  };
}

/**
 * The receipt of a package the test court received: a PDF with the number the lawsuit gets and the day, for
 * the lawyer to attach in ONE. Read from the court's own view, so it is only ever of a package of the link's
 * firm that is ready to file.
 */
export async function testCourtReceipt(
  token: string,
  packageId: string,
): Promise<{ ok: true; name: string; base64: string } | { ok: false; code: string }> {
  const read = await readTestCourt(token);
  if (!read.ok) return { ok: false, code: read.code };
  const filing = read.view.packages.find((item) => item.id === packageId);
  if (!filing || !filing.number) return { ok: false, code: "not_found" };
  try {
    const pdf = await renderTextPdf({
      blocks: receiptBlocks({
        firm: read.view.firm,
        number: filing.number,
        day: receiptDay(Date.now()),
        court: filing.court,
        unit: unitOf(filing.kind, filing.comarca),
        files: filing.files,
      }),
      title: "Recibo de protocolo do tribunal de teste",
      author: "Tribunal de teste do ONE",
      producer: "ONE",
    });
    return {
      ok: true,
      name: `recibo-tribunal-de-teste-${filing.number}.pdf`,
      base64: Buffer.from(pdf).toString("base64"),
    };
  } catch {
    return { ok: false, code: "failed" };
  }
}
