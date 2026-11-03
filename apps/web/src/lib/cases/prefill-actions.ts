"use server";

import { PREFILL_READINGS } from "@/lib/cases/document-prefill";
import { readStoredFile } from "@/lib/cases/document-prefill-work";
import { discardUpload, finishUpload } from "@/lib/files/uploads";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export type PrefillAnswer = { ok: true; output: Record<string, unknown> } | { ok: false; code: string };

/**
 * ONE reads a document a person of the firm just sent, for the form they are filling (migration 0085): the file
 * they reserved and sent (`startCaseUpload`) is measured now, the firm's reads of the day are counted, and the
 * reading's answer comes back for the person to confirm. Nothing is written to a case here: the form saves what the
 * person confirms, and the document joins the case after (`finishCaseUpload`), where its check runs as on any other.
 * Never in a support visit.
 */
export async function readForPrefill(input: { fileId: string; reading: string }): Promise<PrefillAnswer> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.fileId)) return { ok: false, code: "not_found" };
  const reading = PREFILL_READINGS.find((each) => each === input.reading);
  if (!reading) return { ok: false, code: "invalid_kind" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };

  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };

  const { data: allowed, error } = await context.supabase.rpc("prefill_reading_allowed", {
    target_org: context.firm.id,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (allowed ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  return readStoredFile(service, {
    orgId: context.firm.id,
    fileId: input.fileId,
    reading,
    requestedBy: context.userId,
  });
}

/**
 * A document read for a form that was never saved goes: the form was closed, or the person sent another. Only a
 * file this person sent and nothing uses (`discardUpload` checks both); never in a support visit.
 */
export async function dropPrefillUpload(fileId: string): Promise<void> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(fileId) || (await isSupportVisit())) return;
  await discardUpload(context, fileId);
}
