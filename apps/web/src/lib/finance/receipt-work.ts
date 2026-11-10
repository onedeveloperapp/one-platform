import "server-only";

import { issueFirmDocument } from "@/lib/documents/issue";
import { receiptDocument, type ReceiptFacts } from "@/lib/finance/receipts";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { stampVerification } from "@flyee/documents/stamp";
import { renderTextPdf } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The receipts ONE issues to clients (migration 0152): each owed receipt is claimed under a number, written from what
 * the database says of it, issued as a document of the firm with its public code (kind `recibo`, one per receipt
 * whatever the tries) and recorded. Only ids and codes leave this file; nothing of a client is logged.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the database answers of a receipt to issue, read strictly; null when anything the receipt needs is missing. */
export function receiptFactsOf(raw: unknown): (ReceiptFacts & { orgId: string }) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim() : null;
  const cents = Number(value.cents);
  const orgId = text("org_id");
  const firm = text("firm");
  const payer = text("payer");
  const paidOn = text("paid_on");
  const issuedOn = text("issued_on");
  if (value.ok !== true || !orgId || !firm || !payer || !paidOn || !issuedOn) return null;
  if (!DAY.test(paidOn) || !DAY.test(issuedOn) || !Number.isSafeInteger(cents) || cents <= 0) return null;
  const seq = Number(value.case_seq);
  return {
    orgId,
    firm,
    firmDocument: text("firm_document"),
    payer,
    payerCpf: text("payer_cpf"),
    cents,
    paidOn,
    about: text("about") ?? "Honorários advocatícios",
    caseSeq: Number.isSafeInteger(seq) && seq > 0 ? seq : null,
    issuedOn,
  };
}

export type ReceiptOutcome = "issued" | "failed" | "not_held" | "none";

/** Issues one claimed receipt and records what came of it. Never throws for what the store did. */
export async function issueClaimedReceipt(
  service: SupabaseClient,
  receiptId: string,
  claim: number,
): Promise<ReceiptOutcome> {
  const { data, error } = await service.rpc("finance_receipt_to_issue", {
    target_receipt: receiptId,
    target_seq: claim,
  });
  if (error) throw new Error(`finance_receipt_to_issue failed: ${error.code ?? "unknown"}`);
  const facts = receiptFactsOf(data);
  const record = async (documentId: string | null, code: string | null) => {
    const { error: recordError } = await service.rpc("record_finance_receipt", {
      target_receipt: receiptId,
      target_seq: claim,
      target_document: documentId,
      target_code: code,
    });
    if (recordError) throw new Error(`record_finance_receipt failed: ${recordError.code ?? "unknown"}`);
  };
  if (!facts) {
    if ((data as { ok?: boolean } | null)?.ok === false) return "not_held";
    await record(null, "facts_unreadable");
    return "failed";
  }

  const written = receiptDocument(facts);
  const issue = () =>
    issueFirmDocument(
      {
        orgId: facts.orgId,
        kind: "recibo",
        title: written.title,
        // One per receipt: a try after a failure on the way is the same document, never a second one.
        idempotencyKey: `recibo:${receiptId}`,
        requestedBy: null,
        fileName: `${written.title}.pdf`,
      },
      async (render) =>
        stampVerification(
          await renderTextPdf({
            blocks: written.blocks,
            header: facts.firm,
            pageNumbers: false,
            title: written.title,
            author: facts.firm,
          }),
          { firm: facts.firm, verifyCode: render.verifyCode, verifyUrl: render.verifyUrl },
        ),
    );
  const issued = await issue().catch(() => null);
  if (!issued || issued.kind !== "issued") {
    await record(null, issued?.code ?? "issue_failed");
    return "failed";
  }
  await record(issued.documentId, null);
  return "issued";
}

/** A round of the sweep: claims the receipts owed and issues each, until the time runs out. */
export async function receiptRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let turn = 0; turn < 5 && Date.now() < until; turn += 1) {
    const { data, error } = await service.rpc("claim_finance_receipts", { target_limit: 10 });
    if (error) throw new Error(`claim_finance_receipts failed: ${error.code ?? "unknown"}`);
    const claimed = (data ?? []) as { receipt_id: string; claim_seq: number }[];
    if (claimed.length === 0) break;
    for (const held of claimed) {
      if (Date.now() >= until) break;
      const outcome = await issueClaimedReceipt(service, held.receipt_id, Number(held.claim_seq)).catch(
        (): ReceiptOutcome => "failed",
      );
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
  }
  return counts;
}

/** Right after a client's bill is received, or a person asks for its receipt: issued after the answer, never waited for. */
export function queueFinanceReceipts(): void {
  soon("finance-receipts", async () => {
    await receiptRound(createServiceClient(), Date.now() + 90_000);
  });
}
