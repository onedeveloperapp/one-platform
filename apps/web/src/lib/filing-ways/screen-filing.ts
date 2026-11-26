import "server-only";

import type { MappedScreen } from "@/lib/court-extension/capture";
import {
  asksInjunction,
  type FilingExtras,
  filingFactsOf,
  type ToSend,
  type TpuCodes,
  tpuCodesOf,
} from "@/lib/court-robot/facts";
import type { DoneAction, ScreenPlan } from "@/lib/court-robot/plan";
import { aiScreenPlanner } from "@/lib/court-robot/planner";
import type { ScreenPlanner } from "@/lib/court-robot/runner";
import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import { supabaseFileStore } from "@/lib/files/store";
import type { ExtensionFile, ExtensionFiling, ExtensionSystem } from "@/lib/filing-ways/extension-protocol";
import { settleFirmNotices } from "@/lib/notices/work";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { renderTextPdf, type TextBlock } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a filing on a court's screen needs of ONE's backend, whoever runs it (the owner's three ways to file,
 * 2026-11-20): the lawyer's extension through `/api/extensao/v1/...` (`extension-api.ts`, which first finds the batch
 * or the filing as the linked lawyer's) and ONE's own browser on ONE's server (`lib/court-browser/backend.ts`, which
 * holds the batch it claimed). The next lawsuit of a batch with its facts and its files, the AI's reading of a screen
 * ONE does not know, and what came of a filing with its receipt. Every write is a function of the database the
 * service role alone may call (migrations 0263, 0264, 0267, 0268). Only ids, codes and counts leave this file.
 */

export type ScreenFilingDeps = {
  service: SupabaseClient;
  /** The AI that reads a screen; the platform's executor unless a test stands in. */
  planner?: (orgId: string, submissionId: string) => ScreenPlanner;
  /** Tells the firm's clients what moved, after a lawsuit is filed. */
  notify?: (orgId: string) => Promise<void>;
  now?: () => Date;
};

/** The AI reads at most this many screens of one filing: a run that asks for more is stopped. */
export const AI_SCREENS_MOST = 60;
/** How long the link to a file of the package lives: the runner fetches it at once. */
export const FILE_LINK_SECONDS = 15 * 60;

/** The day a moment falls on in Brasília (the court's day of a filing). */
const brasiliaDay = (at: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(at);

const brasiliaMoment = (at: Date): string =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(
    at,
  );

/** A lawsuit's twenty digits as the CNJ writes them. */
const cnjOf = (digits: string): string =>
  `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;

/**
 * The receipt of a lawsuit filed on the court's screen, as a PDF of the firm, when no picture of the screen came: what
 * the court's screen said when it took it, with the number ONE read there. The court's own receipt stays in its system.
 */
export function receiptBlocks(input: { system: string; number: string | null; at: Date; text: string }): TextBlock[] {
  const rows = [
    { label: "Sistema", value: input.system },
    { label: "Lido da tela do tribunal em", value: brasiliaMoment(input.at) },
  ];
  if (input.number) rows.splice(1, 0, { label: "Número do processo", value: cnjOf(input.number) });
  const paragraphs = input.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 400);
  return [
    { kind: "title", text: "Recibo de protocolo" },
    { kind: "fields", rows },
    { kind: "space" },
    { kind: "heading", text: "O que a tela do tribunal mostrou" },
    ...paragraphs.map((text): TextBlock => ({ kind: "paragraph", text })),
  ];
}

export async function systemOf(service: SupabaseClient, key: string): Promise<ExtensionSystem | null> {
  const { data, error } = await service
    .from("court_screen_systems")
    .select("key, name, host")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error("court_screen_systems read failed");
  return (data as ExtensionSystem | null) ?? null;
}

export async function toSendOf(
  service: SupabaseClient,
  submissionId: string,
  claim: number,
): Promise<(ToSend & { case_seq?: number | null }) | null> {
  const { data, error } = await service.rpc("filing_submission_to_send", {
    target_submission: submissionId,
    target_claim: claim,
  });
  if (error) throw new Error("filing_submission_to_send failed");
  return (data as (ToSend & { case_seq?: number | null }) | null) ?? null;
}

/**
 * The codes of the CNJ's tables the platform keeps (`platform_settings.tpu`): the subject of each problem and the moral
 * damage, which the robot types in a court's search of subjects. None when the setting could not be read: the subjects
 * still go by their words.
 */
export async function tpuCodes(service: SupabaseClient): Promise<TpuCodes | null> {
  const { data, error } = await service.from("platform_settings").select("value").eq("key", "tpu").maybeSingle();
  if (error || !data) return null;
  return tpuCodesOf((data as { value: unknown }).value);
}

/**
 * What the court's screen asks of a lawsuit beside its parties and files (2026-11-26): whether free justice is asked
 * (in the civil court, a claimant's answer in force, `free_justice_answers` of 0125), whether its issued petition asks
 * an injunction, and the day in Brasília, for a claimant's age. A read that fails leaves that fact unknown.
 */
export async function filingExtras(service: SupabaseClient, sent: ToSend, now: Date): Promise<FilingExtras> {
  const [answers, petition] = await Promise.all([
    sent.kind === "juizado"
      ? Promise.resolve(null)
      : service.from("free_justice_answers").select("asks").eq("case_id", sent.case_id).is("replaced_at", null),
    sent.proceeding_id
      ? service
          .from("case_drafts")
          .select("approved_body")
          .eq("proceeding_id", sent.proceeding_id)
          .eq("piece_kind", "inicial")
          .eq("status", "issued")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve(null),
  ]);
  const asked = answers && !answers.error ? ((answers.data ?? []) as { asks: boolean }[]) : null;
  const body = petition && !petition.error ? (petition.data as { approved_body: string | null } | null) : null;
  return {
    freeJustice: asked === null ? null : asked.some((answer) => answer.asks === true),
    injunction: asksInjunction(body?.approved_body ?? null),
    today: brasiliaDay(now),
  };
}

/**
 * The next lawsuit of a batch its runner files: its facts, by key with their values (the runner types them, the AI
 * never sees them), and a short link to each file of its package. Null when the batch has nothing left to file.
 */
export async function nextFiling(
  service: SupabaseClient,
  batchId: string,
  claim: number,
): Promise<{ ok: true; filing: ExtensionFiling | null } | { ok: false; code: string }> {
  const { data, error } = await service.rpc("next_batch_submission", { target_batch: batchId, target_claim: claim });
  if (error) return { ok: false, code: "unavailable" };
  const held = data as { submission_id?: string; claim?: number; learning?: boolean; confirmed?: boolean } | null;
  if (!held?.submission_id || typeof held.claim !== "number") return { ok: true, filing: null };
  const [sent, codes] = await Promise.all([
    toSendOf(service, held.submission_id, Number(held.claim)),
    tpuCodes(service),
  ]);
  if (!sent) return { ok: false, code: "not_working" };
  const facts = filingFactsOf(sent, codes, await filingExtras(service, sent, new Date()));
  const bucket = service.storage.from(FIRM_FILES_BUCKET);
  const files: ExtensionFile[] = [];
  for (const item of sent.items) {
    const signed = item.signed_storage_path;
    const link = await bucket.createSignedUrl(signed ?? item.storage_path, FILE_LINK_SECONDS);
    if (link.error || !link.data?.signedUrl) return { ok: false, code: "unavailable" };
    files.push({
      position: item.position,
      // Where the court takes each file signed, the signed one goes, as the court names it.
      name: signed ? `${item.name}.p7s` : item.name,
      type: signed ? "application/pkcs7-signature" : "application/pdf",
      url: link.data.signedUrl,
    });
  }
  return {
    ok: true,
    filing: {
      id: held.submission_id,
      claim: Number(held.claim),
      learning: held.learning === true,
      confirmed: held.confirmed === true,
      caseSeq: typeof sent.case_seq === "number" ? sent.case_seq : sent.case_seq ? Number(sent.case_seq) : null,
      client:
        String(sent.claimants[0]?.name ?? "")
          .trim()
          .split(/\s+/)[0] ?? "",
      facts,
      files,
    },
  };
}

/** A filing as its run reads it before the AI looks at a screen of it. */
export type FilingRow = {
  id: string;
  org_id: string;
  batch_id: string | null;
  status: string;
  claims: number;
  learning: boolean;
  confirmed_at: string | null;
};

export async function filingRowOf(service: SupabaseClient, submissionId: string): Promise<FilingRow | null> {
  const { data, error } = await service
    .from("filing_submissions")
    .select("id, org_id, batch_id, status, claims, learning, confirmed_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error("filing_submissions read failed");
  const row = data as FilingRow | null;
  return row ? { ...row, claims: Number(row.claims) } : null;
}

/**
 * The AI reads a screen of a filing that ONE does not know (task `protocolo.tela`): the structure the runner read,
 * the facts by name. Only for the filing its runner holds, at most `AI_SCREENS_MOST` screens of it.
 */
export async function planScreen(
  deps: ScreenFilingDeps,
  input: {
    filing: FilingRow;
    claim: number;
    systemKey: string;
    frames: MappedScreen[];
    /** What the runner did on this same screen before this reading (`readDone` of what the extension sent). */
    done?: DoneAction[];
  },
): Promise<{ ok: true; plan: ScreenPlan | null } | { ok: false; code: string }> {
  const { service } = deps;
  const { filing } = input;
  if (filing.claims !== input.claim || filing.status !== "claimed") return { ok: false, code: "not_working" };
  const runs = await service
    .from("ai_runs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", filing.org_id)
    .eq("subject_type", "filing_submission")
    .eq("subject_id", filing.id);
  if (runs.error) return { ok: false, code: "unavailable" };
  if ((runs.count ?? 0) >= AI_SCREENS_MOST) return { ok: false, code: "too_many_screens" };
  const [sent, system, codes] = await Promise.all([
    toSendOf(service, filing.id, input.claim),
    systemOf(service, input.systemKey),
    tpuCodes(service),
  ]);
  if (!sent || !system) return { ok: false, code: "not_working" };
  const facts = filingFactsOf(sent, codes, await filingExtras(service, sent, (deps.now ?? (() => new Date()))()));
  const planner = (deps.planner ?? aiScreenPlanner)(filing.org_id, filing.id);
  const plan = await planner({
    sistema: system.name,
    // The button that sends is held back for the lawyer's word only until they gave it.
    aprendendo: filing.learning && filing.confirmed_at === null,
    fatos: facts.fatos,
    partes: facts.partes,
    arquivos: facts.arquivos,
    tela: input.frames,
    feito: input.done ?? [],
  });
  return { ok: true, plan };
}

/**
 * Records what came of a filing the database marked as going (`record_filing_submission`): taken by the court with
 * its number and its receipt, or unknown. The receipt is the picture of the court's screen when one came (ONE's own
 * browser prints it), else the screen's words read by the runner; a receipt that could not be kept never keeps the
 * filing from being recorded. The firm's clients are told once the court took it.
 */
export async function recordFiling(
  deps: ScreenFilingDeps,
  input: {
    orgId: string;
    submissionId: string;
    claim: number;
    systemKey: string;
    outcome: "filed" | "unknown";
    number: string | null;
    message: string | null;
    /** The court's screen of the receipt, as the runner read it. */
    text: string | null;
    /** The court's screen printed by ONE's browser. */
    pdf: Uint8Array | null;
  },
): Promise<{ ok: true; code: string } | { ok: false; code: string }> {
  const { service } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const store = supabaseFileStore(service);

  let receipt: { id: string; path: string } | null = null;
  if (input.outcome === "filed" && (input.pdf || input.text)) {
    try {
      let pdf = input.pdf;
      if (!pdf) {
        const system = await systemOf(service, input.systemKey);
        pdf = await renderTextPdf({
          blocks: receiptBlocks({
            system: system?.name ?? input.systemKey,
            number: input.number,
            at: now,
            text: input.text ?? "",
          }),
          title: "Recibo de protocolo",
          author: system?.name ?? "",
          producer: "ONE",
        });
      }
      const reserved = await store.reserve({
        orgId: input.orgId,
        purpose: "filing_receipt",
        name: `recibo-protocolo-${input.number ?? "acao"}.pdf`,
        mime: "application/pdf",
        bytes: pdf.byteLength,
      });
      if (reserved.ok) {
        await store.put(reserved.storagePath, pdf, "application/pdf");
        const kept = await store.confirm(reserved.fileId, await measureFile(pdf));
        if (kept.ok) receipt = { id: reserved.fileId, path: reserved.storagePath };
        else await takeBackFile(store, reserved.fileId, reserved.storagePath);
      }
    } catch {
      receipt = null;
    }
  }

  const { data, error } = await service.rpc("record_filing_submission", {
    target_submission: input.submissionId,
    target_claim: input.claim,
    target_outcome: input.outcome,
    target_protocol: null,
    target_case_number: input.outcome === "filed" ? input.number : null,
    target_message: input.message,
    target_receipt_file: receipt?.id ?? null,
    target_filed_on: input.outcome === "filed" ? brasiliaDay(now) : null,
  });
  if (error) {
    if (receipt) await takeBackFile(store, receipt.id, receipt.path).catch(() => undefined);
    return { ok: false, code: "unavailable" };
  }
  const code = String(((data ?? {}) as { code?: string }).code ?? "failed");
  if (receipt && code !== "filed" && code !== "filed_unnumbered") {
    await takeBackFile(store, receipt.id, receipt.path).catch(() => undefined);
  }
  // The client is told the lawsuit was filed, as when ONE files through the court's channel.
  if (code === "filed" || code === "filed_unnumbered") await (deps.notify ?? settleFirmNotices)(input.orgId);
  return { ok: true, code };
}
