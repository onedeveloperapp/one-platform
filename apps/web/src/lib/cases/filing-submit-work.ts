import "server-only";

import { lawsuitFilingOf, submissionOf, type SubmissionToSend } from "@/lib/cases/filing-request";
import { mniChannelFor, TestCourtChannel } from "@/lib/courts/filing-channel";
import { supabaseFileStore } from "@/lib/files/store";
import { soon } from "@/lib/jobs/soon";
import { receiptBlocks, receiptDay, unitOf } from "@/lib/test-court/test-court";
import { createServiceClient } from "@flyee/auth/service";
import type { FilingChannel, FilingOutcome } from "@flyee/courts/types";
import { readAttachedCms } from "@flyee/documents/cms";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { renderTextPdf } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of ONE filing a lawsuit (migration 0101): a package
 * ready that nothing keeps from being filed is claimed, its lawsuit is read
 * and turned into the court's filing (`lib/cases/filing-request.ts`), and it
 * is sent through the court's channel (the MNI) or, for a test case, the
 * test court. The database is told right before it goes
 * (`filing_submission_sending`), so a worker that never comes back leaves it
 * unknown and never sent twice; what the court answered is recorded, with
 * the receipt it gave kept as a file of the firm. Every write is a function
 * of the database the service role alone may call. Only ids, codes and
 * counts leave this file.
 */

export type SubmissionClaim = { submissionId: string; claim: number };

/** Claims what ONE files now (the package named, or the oldest ones). */
export async function claimFilingSubmissions(
  service: SupabaseClient,
  limit = 2,
  packageId: string | null = null,
): Promise<SubmissionClaim[]> {
  const { data, error } = await service.rpc("claim_filing_submissions", {
    target_limit: limit,
    target_package: packageId,
  });
  if (error) throw new Error("claim_filing_submissions failed");
  const claimed = ((data ?? {}) as { claimed?: unknown }).claimed;
  return (Array.isArray(claimed) ? claimed : []).flatMap((item) => {
    const row = item as { submission_id?: unknown; claim?: unknown };
    return typeof row.submission_id === "string" && typeof row.claim === "number"
      ? [{ submissionId: row.submission_id, claim: row.claim }]
      : [];
  });
}

/** The day a moment falls on in Brasília (the court's day of a filing). */
const brasiliaDay = (at: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    Number.isNaN(at.getTime()) ? new Date() : at,
  );

/** The receipt the test court gives, as a PDF that says no court received the lawsuit. */
async function testCourtReceipt(sub: SubmissionToSend, files: number): Promise<Uint8Array> {
  return renderTextPdf({
    blocks: receiptBlocks({
      firm: sub.firm,
      number: sub.testNumber ?? "",
      day: receiptDay(Date.now()),
      court: sub.court,
      unit: unitOf(sub.kind, sub.comarca),
      files,
    }),
    title: "Recibo de protocolo do tribunal de teste",
    author: "Tribunal de teste do ONE",
    producer: "ONE",
  });
}

/** Files one claimed submission. Answers what the database recorded of it, or why nothing went. */
export async function submitClaimedFiling(service: SupabaseClient, held: SubmissionClaim): Promise<string> {
  const { data, error } = await service.rpc("filing_submission_to_send", {
    target_submission: held.submissionId,
    target_claim: held.claim,
  });
  if (error) throw new Error("filing_submission_to_send failed");
  const sub = submissionOf(data);
  if (!sub) return "not_held";
  const store = supabaseFileStore(service);

  const record = async (
    outcome: "filed" | "refused" | "unavailable" | "unknown",
    input: {
      protocol?: string | null;
      caseNumber?: string | null;
      message?: string | null;
      receiptFile?: string | null;
      filedOn?: string | null;
    } = {},
  ): Promise<string> => {
    const { data: recorded, error: recordError } = await service.rpc("record_filing_submission", {
      target_submission: sub.submissionId,
      target_claim: sub.claim,
      target_outcome: outcome,
      target_protocol: input.protocol ?? null,
      target_case_number: input.caseNumber ?? null,
      target_message: input.message ?? null,
      target_receipt_file: input.receiptFile ?? null,
      target_filed_on: input.filedOn ?? null,
    });
    if (recordError) throw new Error("record_filing_submission failed");
    return String(((recorded ?? {}) as { code?: string }).code ?? "failed");
  };

  // The channel: the test court for a test case, else the court's own with the platform's credential there.
  let channel: FilingChannel | null;
  if (sub.channel === "test_court") {
    if (!sub.testNumber) return record("unavailable", { message: "O tribunal de teste não deu número a esta ação." });
    const number = sub.testNumber;
    channel = new TestCourtChannel({
      number,
      receipt: (filing) => testCourtReceipt(sub, filing.documents.length),
    });
  } else {
    channel = mniChannelFor(sub.court, sub.endpoint);
    if (!channel) {
      return record("unavailable", { message: "A credencial do ONE neste tribunal ainda não está configurada." });
    }
  }

  // The files go only to a court: the test court reads none.
  const files = new Map<
    number,
    { pdf: Uint8Array; signature: { cms: Uint8Array; certificatePem: string; signedAt: Date } | null }
  >();
  if (sub.channel === "mni") {
    for (const item of sub.items) {
      const pdf = await store.get(item.storagePath);
      if (!pdf) return record("unavailable", { message: "Um arquivo do pacote não pôde ser lido agora." });
      let signature: { cms: Uint8Array; certificatePem: string; signedAt: Date } | null = null;
      if (item.signedStoragePath) {
        const cms = await store.get(item.signedStoragePath);
        const read = cms ? await readAttachedCms(cms).catch(() => null) : null;
        if (!cms || !read?.signed) {
          return record("unavailable", { message: "A assinatura de um arquivo do pacote não pôde ser conferida." });
        }
        signature = { cms, certificatePem: read.signerCertificatePem, signedAt: new Date() };
      }
      files.set(item.position, { pdf, signature });
    }
  }
  const built = lawsuitFilingOf(
    sub,
    (item) => files.get(item.position) ?? { pdf: new Uint8Array(), signature: null },
    new Date(),
  );
  if (!built.ok) {
    return record("unavailable", {
      message:
        built.code === "court_codes_missing"
          ? "Faltam códigos do tribunal para esta ação."
          : "Falta um dado da ação que o tribunal pede.",
    });
  }

  // From here on the lawsuit may reach the court: a worker that does not come back leaves it unknown.
  const { data: sending, error: sendingError } = await service.rpc("filing_submission_sending", {
    target_submission: sub.submissionId,
    target_claim: sub.claim,
  });
  if (sendingError) throw new Error("filing_submission_sending failed");
  const went = (sending ?? {}) as { ok?: boolean; code?: string };
  if (!went.ok) return String(went.code ?? "not_working");

  let outcome: FilingOutcome;
  try {
    outcome = await channel.fileLawsuit(built.filing);
  } catch {
    outcome = { kind: "unknown", reason: "O envio não teve resposta que se pudesse ler." };
  }

  if (outcome.kind === "filed") {
    // The receipt the court gave is kept as a file of the firm: record first, and taken back if it found no place.
    let receiptFile: { id: string; path: string } | null = null;
    if (outcome.receipt && outcome.receipt.byteLength > 0) {
      try {
        const reserved = await store.reserve({
          orgId: sub.orgId,
          purpose: "filing_receipt",
          name: `recibo-protocolo-${outcome.caseNumber ?? sub.caseSeq ?? "acao"}.pdf`,
          mime: "application/pdf",
          bytes: outcome.receipt.byteLength,
        });
        if (reserved.ok) {
          await store.put(reserved.storagePath, outcome.receipt, "application/pdf");
          const kept = await store.confirm(reserved.fileId, await measureFile(outcome.receipt));
          if (kept.ok) receiptFile = { id: reserved.fileId, path: reserved.storagePath };
          else await takeBackFile(store, reserved.fileId, reserved.storagePath);
        }
      } catch {
        receiptFile = null;
      }
    }
    const code = await record("filed", {
      protocol: outcome.protocol,
      caseNumber: outcome.caseNumber,
      message: outcome.message,
      receiptFile: receiptFile?.id ?? null,
      filedOn: brasiliaDay(outcome.at),
    });
    if (receiptFile && code !== "filed" && code !== "filed_unnumbered") {
      await takeBackFile(store, receiptFile.id, receiptFile.path).catch(() => undefined);
    }
    return code;
  }
  if (outcome.kind === "refused") return record("refused", { protocol: outcome.protocol, message: outcome.message });
  if (outcome.kind === "unavailable") return record("unavailable", { message: outcome.reason });
  return record("unknown", { message: outcome.reason });
}

/** Claims and files what is owed (or the package named), one after the other. Counts only. */
export async function submitFilings(
  service: SupabaseClient,
  limit = 2,
  packageId: string | null = null,
): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = {};
  for (const held of await claimFilingSubmissions(service, limit, packageId)) {
    const outcome = await submitClaimedFiling(service, held).catch(() => "error");
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return outcomes;
}

/**
 * A package just became ready or signed, or a lawyer asked ONE to file it:
 * it is filed right after the response is sent, never through the job
 * runner. The sweep takes what that did not finish.
 */
export function queueFilingSubmission(packageId: string | null): void {
  soon("filing-submission", () => submitFilings(createServiceClient(), packageId ? 1 : 2, packageId));
}
