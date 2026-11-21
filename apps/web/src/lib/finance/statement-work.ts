import "server-only";

import { firmLetterhead } from "@/lib/brand/letterhead-read";
import { issueFirmDocument } from "@/lib/documents/issue";
import { moneyStatementDocument, type StatementFacts } from "@/lib/finance/money-statement";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { stampVerification } from "@flyee/documents/stamp";
import { pageLayout, renderTextPdf } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The accountability statements ONE issues to clients (migration 0156): each owed statement is claimed under a number,
 * written from what the database says of its part, issued as a document of the firm with its public code (kind
 * `prestacao`, one per round of the part whatever the tries) and recorded. Only ids and codes leave this file.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the database answers of a statement to issue, read strictly; null when anything it needs is missing. */
export function statementFactsOf(raw: unknown): (StatementFacts & { orgId: string; round: number }) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.ok !== true) return null;
  const text = (key: string): string | null =>
    typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim() : null;
  const cents = (key: string): number => {
    const number = Number(value[key] ?? 0);
    return Number.isSafeInteger(number) && number >= 0 ? number : -1;
  };
  const orgId = text("org_id");
  const firm = text("firm");
  const person = text("person");
  const releasedOn = text("released_on");
  const issuedOn = text("issued_on");
  const amounts = ["released_cents", "gross_cents", "fees_cents", "costs_cents", "held_cents", "payable_cents"].map(
    cents,
  );
  if (!orgId || !firm || !person || !releasedOn || !issuedOn || !DAY.test(releasedOn) || !DAY.test(issuedOn))
    return null;
  if (amounts.some((amount) => amount < 0)) return null;
  const [releasedCents, grossCents, feesCents, costsCents, heldCents, payableCents] = amounts;
  const held = Array.isArray(value.held)
    ? (value.held as Record<string, unknown>[]).flatMap((item) =>
        typeof item.reason === "string" && Number.isSafeInteger(Number(item.cents))
          ? [{ reason: item.reason, cents: Number(item.cents) }]
          : [],
      )
    : [];
  const account = value.account as Record<string, unknown> | null | undefined;
  const seq = Number(value.case_seq);
  const percent = Number(value.fees_percent);
  return {
    orgId,
    round: Number.isSafeInteger(Number(value.round)) ? Number(value.round) : 1,
    firm,
    firmDocument: text("firm_document"),
    person,
    personCpf: text("person_cpf"),
    minor: value.minor === true,
    caseSeq: Number.isSafeInteger(seq) && seq > 0 ? seq : null,
    cnj: text("cnj"),
    court: text("court"),
    path: value.path === "direct" ? "direct" : "firm",
    releasedCents,
    releasedOn,
    grossCents,
    feesCents,
    feesPercent: Number.isFinite(percent) && percent > 0 ? percent : null,
    costsCents,
    heldCents,
    held,
    payableCents,
    paidOn: text("paid_on"),
    account:
      account && (account.kind === "pix" || account.kind === "conta")
        ? { kind: account.kind, ends: String(account.ends ?? "") }
        : null,
    issuedOn,
  };
}

export type StatementOutcome = "issued" | "failed" | "not_held";

/** Issues one claimed statement and records what came of it. Never throws for what the store did. */
export async function issueClaimedStatement(
  service: SupabaseClient,
  statementId: string,
  claim: number,
): Promise<StatementOutcome> {
  const { data, error } = await service.rpc("money_statement_to_issue", {
    target_statement: statementId,
    target_seq: claim,
  });
  if (error) throw new Error(`money_statement_to_issue failed: ${error.code ?? "unknown"}`);
  const record = async (documentId: string | null, code: string | null) => {
    const { error: recordError } = await service.rpc("record_money_statement", {
      target_statement: statementId,
      target_seq: claim,
      target_document: documentId,
      target_code: code,
    });
    if (recordError) throw new Error(`record_money_statement failed: ${recordError.code ?? "unknown"}`);
  };
  if ((data as { ok?: boolean } | null)?.ok === false) return "not_held";
  const facts = statementFactsOf(data);
  if (!facts) {
    await record(null, "facts_unreadable");
    return "failed";
  }
  const written = moneyStatementDocument(facts);
  const issued = await issueFirmDocument(
    {
      orgId: facts.orgId,
      kind: "prestacao",
      title: written.title,
      // One per round of the part: a try after a failure is the same document; a part passed on again, another.
      idempotencyKey: `prestacao:${statementId}:${facts.round}`,
      requestedBy: null,
      fileName: `${written.title}.pdf`,
    },
    async (render) => {
      // On the firm's letterhead, once confirmed (0260), with ONE's mark above its footer.
      const letterhead = await firmLetterhead(service, facts.orgId);
      return stampVerification(
        await renderTextPdf({
          blocks: written.blocks,
          header: letterhead ? undefined : facts.firm,
          pageNumbers: false,
          title: written.title,
          author: facts.firm,
          letterhead,
          stamped: true,
        }),
        { firm: facts.firm, verifyCode: render.verifyCode, verifyUrl: render.verifyUrl },
        { at: pageLayout(letterhead, true).stampAt },
      );
    },
  ).catch(() => null);
  if (!issued || issued.kind !== "issued") {
    await record(null, issued?.code ?? "issue_failed");
    return "failed";
  }
  await record(issued.documentId, null);
  return "issued";
}

/** A round of the sweep: claims the statements owed and issues each, until the time runs out. */
export async function statementRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let turn = 0; turn < 5 && Date.now() < until; turn += 1) {
    const { data, error } = await service.rpc("claim_money_statements", { target_limit: 10 });
    if (error) throw new Error(`claim_money_statements failed: ${error.code ?? "unknown"}`);
    const claimed = (data ?? []) as { statement_id: string; claim_seq: number }[];
    if (claimed.length === 0) break;
    for (const held of claimed) {
      if (Date.now() >= until) break;
      const outcome = await issueClaimedStatement(service, held.statement_id, Number(held.claim_seq)).catch(
        (): StatementOutcome => "failed",
      );
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
  }
  return counts;
}

/** Right after a client's part is passed on, or a person asks for its statement: issued after the answer. */
export function queueMoneyStatements(): void {
  soon("money-statements", async () => {
    await statementRound(createServiceClient(), Date.now() + 90_000);
  });
}
