import "server-only";

import { cookies } from "next/headers";

import { momentLabel } from "@/lib/ai/approvals";
import { type FeeTerms, feeTermsOf } from "@/lib/cases/fees";
import { type FinanceAttention, readFinanceAttention } from "@/lib/finance/attention";
import { type FinanceBill, type FinanceSeries, readFinanceSeries } from "@/lib/finance/bills";
import type { FinanceHome, FinanceLevel } from "@/lib/finance/books";
import {
  type FinanceAccountRow,
  type FinanceCategory,
  type FinanceCostCenter,
  type FinanceEntryRow,
  type FinanceLine,
  type FinancePerson,
  readFinanceAccess,
  readFinanceBills,
  readFinanceEntries,
  readFinanceHome,
  readFinanceLines,
  readFinancePeople,
  readFinanceRegistrations,
} from "@/lib/finance/read";
import { type FinanceReceipt, readReceipts } from "@/lib/finance/receipts";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export type FinanceRegistrations = {
  accounts: FinanceAccountRow[];
  categories: FinanceCategory[];
  costCenters: FinanceCostCenter[];
};

/** The session's second factor: confirmed, to confirm with a code, or none on the account. */
export type FactorState = "ok" | "challenge" | "missing";

export type FinanceState =
  | {
      kind: "ready";
      level: FinanceLevel;
      factor: FactorState;
      decides: boolean;
      /** A support visit reads nothing of the books and writes nothing. */
      supportVisit: boolean;
      firmName: string;
      home: FinanceHome;
      registrations: FinanceRegistrations;
      entries: FinanceEntryRow[] | null;
      lines: FinanceLine[] | null;
      people: FinancePerson[] | null;
      /** What waits in the books (0127): a statement late, a client's money to set apart; null when unread. */
      attention: FinanceAttention | null;
      /** The bills to pay and to receive (0129), when the page lists them. */
      bills: FinanceBill[] | null;
      /** The series ONE made of the bills that repeat (0151), when the page lists the bills. */
      series: FinanceSeries[] | null;
      /** The receipts ONE issues to clients of the bills received (0152), when the page lists the bills. */
      receipts: FinanceReceipt[] | null;
      /** The firm's fee terms in force (0131), when the page lists them. */
      feeTerms: FeeTerms[] | null;
      /** The name of the firm's fee contract in the library, which ONE reads the terms from (0160). */
      feeContract: string | null;
      readLabel: string;
    }
  /** The books are not open yet: who decides for the firm opens them; anybody else is told so. */
  | { kind: "closed"; decides: boolean; supportVisit: boolean; firmName: string; factor: FactorState }
  /** Who reads only the costs of the cases, or nothing: the books are not theirs to read. */
  | { kind: "not-reader"; level: FinanceLevel }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * What a page of `/financeiro` reads, under the person's own session (the database decides what each level reads):
 * the home of the books and their registrations always, and what the page lists (`with`).
 */
export async function loadFinance(
  withData: { entries?: boolean; lines?: boolean; people?: boolean; bills?: boolean; terms?: boolean } = {},
): Promise<FinanceState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const [access, cookieStore, assurance] = await Promise.all([
    readFinanceAccess(context.supabase, context.firm.id),
    cookies(),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!access) return { kind: "error" };
  const supportVisit = cookieStore.has(IMPERSONATION_MARKER_COOKIE);
  // `nextLevel` is aal2 exactly when the account has a verified factor; `currentLevel` when this session confirmed it.
  const factor: FactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  if (!access.opened) {
    return {
      kind: "closed",
      decides: access.decides && !supportVisit,
      supportVisit,
      firmName: context.firm.name,
      factor,
    };
  }
  if (access.level !== "view" && access.level !== "operate" && access.level !== "configure") {
    return { kind: "not-reader", level: access.level };
  }
  const [home, registrations, entries, lines, people, attention, bills, feeTerms, series] = await Promise.all([
    readFinanceHome(context.supabase, context.firm.id),
    readFinanceRegistrations(context.supabase, context.firm.id),
    withData.entries ? readFinanceEntries(context.supabase, context.firm.id) : Promise.resolve(null),
    withData.lines ? readFinanceLines(context.supabase, context.firm.id) : Promise.resolve(null),
    withData.people && access.decides ? readFinancePeople(context.supabase, context.firm.id) : Promise.resolve(null),
    context.supabase
      .rpc("firm_finance_attention", { target_org: context.firm.id })
      .then(({ data, error }) => (error ? null : readFinanceAttention(data))),
    withData.bills ? readFinanceBills(context.supabase, context.firm.id) : Promise.resolve(null),
    withData.terms
      ? context.supabase
          .from("fee_terms")
          .select(
            "id, module, incident, entry_cents, installments, installment_cents, success_percent, success_min_cents, settlement_percent, confirmed_at, monthly_cents, monthly_months, hearing_cents, appeal_cents, late_fine_percent, late_interest_percent",
          )
          .eq("org_id", context.firm.id)
          .is("archived_at", null)
          .order("incident", { ascending: true, nullsFirst: true })
          .then(({ data, error }) => (error ? null : feeTermsOf(data)))
      : Promise.resolve(null),
    withData.bills
      ? context.supabase
          .rpc("firm_finance_series", { target_org: context.firm.id })
          .then(({ data, error }) => (error ? null : readFinanceSeries(data)))
      : Promise.resolve(null),
  ]);
  if (home === "error" || home === null || !registrations) return { kind: "error" };
  if ((withData.entries && !entries) || (withData.lines && !lines) || (withData.bills && !bills)) {
    return { kind: "error" };
  }
  // The firm's fee contract, which ONE reads the terms from (0160): the default first.
  const feeContract = withData.terms
    ? await context.supabase
        .from("draft_templates")
        .select("name")
        .eq("org_id", context.firm.id)
        .eq("document_kind", "contrato")
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => (data?.name ? String(data.name) : null))
    : null;
  // The fine and interest of the fee contract of each case with a fee receivable past its day (0159).
  const lateFees = (bills ?? []).filter(
    (bill) =>
      bill.direction === "receive" &&
      bill.caseId &&
      bill.status === "open" &&
      bill.dueOn < today() &&
      (bill.source === "fees" || bill.source === "act"),
  );
  if (lateFees.length > 0) {
    const { data } = await context.supabase
      .from("case_fees")
      .select("case_id, late_fine_percent, late_interest_percent")
      .in("case_id", [...new Set(lateFees.map((bill) => bill.caseId as string))]);
    const terms = new Map(
      ((data ?? []) as { case_id: string; late_fine_percent: number | null; late_interest_percent: number | null }[])
        .filter((row) => Number(row.late_fine_percent ?? 0) > 0 || Number(row.late_interest_percent ?? 0) > 0)
        .map((row) => [
          row.case_id,
          { finePercent: Number(row.late_fine_percent ?? 0), interestPercent: Number(row.late_interest_percent ?? 0) },
        ]),
    );
    for (const bill of lateFees) bill.lateTerms = terms.get(bill.caseId as string) ?? null;
  }
  // The receipts of the receivables of a case that were received, in part or whole (0152): read once the bills are.
  const received = (bills ?? []).filter((bill) => bill.direction === "receive" && bill.caseId && bill.paidCents > 0);
  const receipts =
    received.length > 0
      ? await context.supabase
          .rpc("firm_finance_receipts", { target_org: context.firm.id, target_bills: received.map((bill) => bill.id) })
          .then(({ data, error }) => (error ? null : readReceipts(data)))
      : bills
        ? []
        : null;
  return {
    kind: "ready",
    level: access.level,
    factor,
    decides: access.decides,
    supportVisit,
    firmName: context.firm.name,
    home,
    registrations,
    entries,
    lines,
    people,
    attention,
    bills,
    series,
    receipts,
    feeTerms,
    feeContract,
    readLabel: momentLabel(new Date().toISOString(), context.profile.timezone),
  };
}
