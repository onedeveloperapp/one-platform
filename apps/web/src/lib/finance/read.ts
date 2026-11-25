import "server-only";

import { fetchAllPages } from "@/lib/fetch-all-pages";
import type { BillStatus, FinanceBill } from "@/lib/finance/bills";
import {
  type AccountKind,
  type CategoryKind,
  entryViewOf,
  type FinanceEntryView,
  type FinanceHome,
  financeHomeOf,
  type FinanceLevel,
  isAccountKind,
  isCategoryKind,
  isFinanceLevel,
} from "@/lib/finance/books";
import type { SupabaseClient } from "@supabase/supabase-js";

/** What the person asking reads and does of the books, and whether they are open (`firm_finance_access`). */
export async function readFinanceAccess(
  supabase: SupabaseClient,
  firmId: string,
): Promise<{ level: FinanceLevel; opened: boolean; decides: boolean } | null> {
  const { data, error } = await supabase.rpc("firm_finance_access", { target_org: firmId });
  if (error || !data) return null;
  const raw = data as { level?: unknown; opened?: unknown; decides?: unknown };
  if (!isFinanceLevel(raw.level)) return null;
  return { level: raw.level, opened: raw.opened === true, decides: raw.decides === true };
}

export async function readFinanceHome(supabase: SupabaseClient, firmId: string): Promise<FinanceHome | null | "error"> {
  const { data, error } = await supabase.rpc("firm_finance_home", { target_org: firmId });
  if (error) return "error";
  return financeHomeOf(data);
}

export type FinanceCategory = {
  id: string;
  kind: CategoryKind;
  name: string;
  dreLine: string | null;
  dfcLine: string | null;
  archived: boolean;
  archivedReason: string | null;
};
export type FinanceCostCenter = { id: string; name: string; archived: boolean; archivedReason: string | null };
export type FinanceAccountRow = {
  id: string;
  kind: AccountKind;
  name: string;
  institution: string | null;
  numberTail: string | null;
  openingCents: number;
  closingDay: number | null;
  dueDay: number | null;
  archived: boolean;
  archivedReason: string | null;
};

/** The registrations of the books: the accounts, the chart and the cost centres, archived ones included. */
export async function readFinanceRegistrations(
  supabase: SupabaseClient,
  firmId: string,
): Promise<{ accounts: FinanceAccountRow[]; categories: FinanceCategory[]; costCenters: FinanceCostCenter[] } | null> {
  const [accounts, categories, centers] = await Promise.all([
    supabase
      .from("finance_accounts")
      .select(
        "id, kind, name, institution, number_tail, opening_cents, closing_day, due_day, archived_at, archived_reason",
      )
      .eq("org_id", firmId)
      .order("name"),
    supabase
      .from("finance_categories")
      .select("id, kind, name, dre_line, dfc_line, archived_at, archived_reason, position")
      .eq("org_id", firmId)
      .order("position")
      .order("name"),
    supabase
      .from("finance_cost_centers")
      .select("id, name, archived_at, archived_reason")
      .eq("org_id", firmId)
      .order("name"),
  ]);
  if (accounts.error || categories.error || centers.error) return null;
  return {
    accounts: (accounts.data ?? [])
      .filter((row) => isAccountKind(row.kind))
      .map((row) => ({
        id: String(row.id),
        kind: row.kind as AccountKind,
        name: String(row.name),
        institution: (row.institution as string | null) ?? null,
        numberTail: (row.number_tail as string | null) ?? null,
        openingCents: Number(row.opening_cents ?? 0),
        closingDay: (row.closing_day as number | null) ?? null,
        dueDay: (row.due_day as number | null) ?? null,
        archived: row.archived_at !== null,
        archivedReason: (row.archived_reason as string | null) ?? null,
      })),
    categories: (categories.data ?? [])
      .filter((row) => isCategoryKind(row.kind))
      .map((row) => ({
        id: String(row.id),
        kind: row.kind as CategoryKind,
        name: String(row.name),
        dreLine: (row.dre_line as string | null) ?? null,
        dfcLine: (row.dfc_line as string | null) ?? null,
        archived: row.archived_at !== null,
        archivedReason: (row.archived_reason as string | null) ?? null,
      })),
    costCenters: (centers.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      archived: row.archived_at !== null,
      archivedReason: (row.archived_reason as string | null) ?? null,
    })),
  };
}

export type FinanceEntryRow = FinanceEntryView & {
  source: "manual" | "one";
  cancelled: boolean;
  cancelledReason: string | null;
  transferId: string | null;
  fromStatement: boolean;
  /**
   * A client's money that came into an account of the firm's own and nobody said was set apart (0127): `owed`; said
   * apart, or in a custody account: `apart`; any other entry: null.
   */
  apart: "owed" | "apart" | null;
  /** The receipt kept with it (0140). */
  fileId: string | null;
};

/**
 * Every entry of the books, the latest first: the list decides its views, its search and its export in the browser,
 * so it holds them all, read in the pages the API hands back (it hands a thousand rows at most, and the latest 500
 * alone made the counts, the search and the export of an older entry say nothing of it). A read that fails is null,
 * never a shorter book.
 */
export async function readFinanceEntries(supabase: SupabaseClient, firmId: string): Promise<FinanceEntryRow[] | null> {
  const { data, error } = await fetchAllPages((from, to) =>
    supabase
      .from("finance_entries")
      .select(
        "id, kind, cents, occurred_on, by_one, source, counterparty, description, cancelled_at, cancelled_reason, transfer_id, statement_line_id, apart_at, file_id, finance_accounts(name, kind), finance_categories(name)",
      )
      .eq("org_id", firmId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  if (error) return null;
  const rows: FinanceEntryRow[] = [];
  for (const row of data) {
    const view = entryViewOf({
      ...row,
      account: (row.finance_accounts as { name?: string } | null)?.name ?? "",
      category: (row.finance_categories as { name?: string } | null)?.name ?? null,
    });
    if (!view) continue;
    rows.push({
      ...view,
      source: row.source === "one" ? "one" : "manual",
      cancelled: row.cancelled_at !== null,
      cancelledReason: (row.cancelled_reason as string | null) ?? null,
      transferId: (row.transfer_id as string | null) ?? null,
      fromStatement: row.statement_line_id !== null,
      fileId: (row.file_id as string | null) ?? null,
      apart:
        view.kind !== "client_money" || view.cents <= 0 || row.cancelled_at !== null
          ? null
          : row.apart_at !== null || (row.finance_accounts as { kind?: string } | null)?.kind === "custody"
            ? "apart"
            : "owed",
    });
  }
  return rows;
}

export type FinanceLine = {
  id: string;
  accountId: string;
  account: string;
  postedOn: string;
  cents: number;
  memo: string;
  state: "pending" | "entered" | "matched" | "ignored";
  repeated: boolean;
  byOne: boolean;
  rule: string | null;
  entryId: string | null;
  /**
   * What ONE's AI said of a line it read (0128): the category it suggests, who the money was of, and whether it was
   * sure. Kept on a line ONE entered too, so undoing it leaves the suggestion for the person.
   */
  suggestion: { categoryId: string | null; counterparty: string | null; sure: boolean } | null;
  /** ONE's AI is still to read this line (its statement waits for the reading). */
  reading: boolean;
};

/**
 * Every line of the statements, the latest first: the screen counts and shows those that wait for a person and what
 * ONE decided, so it holds them all, read in the pages the API hands back. The latest 300 alone left a line that
 * waits, older than they are, out of the list and of its count: never decided, never seen. A read that fails is null.
 */
export async function readFinanceLines(supabase: SupabaseClient, firmId: string): Promise<FinanceLine[] | null> {
  const { data, error } = await fetchAllPages((from, to) =>
    supabase
      .from("finance_statement_lines")
      .select(
        "id, account_id, posted_on, cents, memo, state, repeat_of, decided_by_one, decided_rule, entry_id, ai_asked, ai_category_id, ai_counterparty, ai_sure, finance_accounts(name), finance_statements(ai_state)",
      )
      .eq("org_id", firmId)
      .order("posted_on", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  if (error) return null;
  return data.map((row) => ({
    id: String(row.id),
    accountId: String(row.account_id),
    account: (row.finance_accounts as { name?: string } | null)?.name ?? "",
    postedOn: String(row.posted_on),
    cents: Number(row.cents),
    memo: String(row.memo ?? ""),
    state: (["pending", "entered", "matched", "ignored"].includes(String(row.state))
      ? row.state
      : "pending") as FinanceLine["state"],
    repeated: row.repeat_of !== null,
    byOne: row.decided_by_one === true,
    rule: (row.decided_rule as string | null) ?? null,
    suggestion:
      row.ai_asked === true && (row.ai_category_id !== null || row.ai_counterparty !== null)
        ? {
            categoryId: (row.ai_category_id as string | null) ?? null,
            counterparty: (row.ai_counterparty as string | null) ?? null,
            sure: row.ai_sure === true,
          }
        : null,
    reading:
      row.state === "pending" &&
      row.ai_asked !== true &&
      row.repeat_of === null &&
      ["due", "claimed"].includes(String((row.finance_statements as { ai_state?: string } | null)?.ai_state ?? "")),
    entryId: (row.entry_id as string | null) ?? null,
  }));
}

export type FinancePerson = {
  userId: string;
  name: string;
  email: string | null;
  level: FinanceLevel;
  decides: boolean;
};

/** Who of the firm reads what of the books: for who configures them. */
export async function readFinancePeople(supabase: SupabaseClient, firmId: string): Promise<FinancePerson[] | null> {
  const [members, access] = await Promise.all([
    supabase.rpc("firm_team", { target_org: firmId }),
    supabase.from("finance_access").select("user_id, level").eq("org_id", firmId),
  ]);
  if (members.error || access.error) return null;
  const levels = new Map((access.data ?? []).map((row) => [String(row.user_id), row.level as FinanceLevel]));
  const rows = (members.data ?? []) as Record<string, unknown>[];
  // Who decides for the firm, as `decides_for_firm` says: a partner, or who manages a firm with none.
  const hasPartner = rows.some((raw) => raw.firm_function === "socio");
  const people: FinancePerson[] = [];
  for (const raw of rows) {
    const userId = typeof raw.user_id === "string" ? raw.user_id : null;
    if (!userId) continue;
    const decides = raw.firm_function === "socio" || (!hasPartner && (raw.role === "owner" || raw.role === "admin"));
    const name = typeof raw.display_name === "string" && raw.display_name.trim() ? raw.display_name : "";
    people.push({
      userId,
      name,
      email: typeof raw.email === "string" ? raw.email : null,
      level: decides ? "configure" : (levels.get(userId) ?? "costs"),
      decides,
    });
  }
  return people.sort((a, b) => Number(b.decides) - Number(a.decides) || a.name.localeCompare(b.name));
}

const BILL_STATUSES: readonly BillStatus[] = ["open", "paid", "cancelled", "renegotiated", "written_off"];

/**
 * Every bill to pay and to receive (0129), with what its payments said, read in the pages the API hands back: the
 * screen's views and counts are of every bill, and a read of the first thousand left an open bill out of them. A
 * read that fails is null.
 */
export async function readFinanceBills(supabase: SupabaseClient, firmId: string): Promise<FinanceBill[] | null> {
  const { data, error } = await fetchAllPages((from, to) =>
    supabase
      .from("finance_bills")
      .select(
        "id, direction, status, counterparty, description, category_id, case_id, cents, paid_cents, due_on, competence_on, paid_on, typed_line, series_index, series_total, closed_reason, file_id, source, by_one, finance_categories(name), finance_bill_payments(id, paid_on, by_one, extra_cents, discount_cents, fine_cents, interest_cents, split_by, undone_at)",
      )
      .eq("org_id", firmId)
      .order("due_on", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  if (error) return null;
  return data.flatMap((row): FinanceBill[] => {
    const status = BILL_STATUSES.find((known) => known === row.status);
    if (!status || (row.direction !== "pay" && row.direction !== "receive")) return [];
    const payments = (
      (row.finance_bill_payments ?? []) as {
        id?: string;
        paid_on?: string;
        by_one?: boolean;
        extra_cents?: number;
        discount_cents?: number;
        fine_cents?: number;
        interest_cents?: number;
        split_by?: string | null;
        undone_at?: string | null;
      }[]
    ).filter((payment) => !payment.undone_at);
    return [
      {
        id: String(row.id),
        direction: row.direction,
        status,
        counterparty: (row.counterparty as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        categoryId: (row.category_id as string | null) ?? null,
        category: (row.finance_categories as { name?: string } | null)?.name ?? null,
        caseId: (row.case_id as string | null) ?? null,
        cents: Number(row.cents),
        paidCents: Number(row.paid_cents ?? 0),
        dueOn: String(row.due_on),
        competenceOn: String(row.competence_on),
        paidOn: (row.paid_on as string | null) ?? null,
        typedLine: (row.typed_line as string | null) ?? null,
        seriesIndex: (row.series_index as number | null) ?? null,
        seriesTotal: (row.series_total as number | null) ?? null,
        closedReason: (row.closed_reason as string | null) ?? null,
        byOne: payments.some((payment) => payment.by_one === true),
        extraCents: payments.reduce((sum, payment) => sum + Number(payment.extra_cents ?? 0), 0),
        discountCents: payments.reduce((sum, payment) => sum + Number(payment.discount_cents ?? 0), 0),
        latePayments: payments
          .filter((payment) => Number(payment.extra_cents ?? 0) > 0 && payment.id)
          .map((payment) => ({
            id: String(payment.id),
            paidOn: String(payment.paid_on ?? ""),
            extraCents: Number(payment.extra_cents ?? 0),
            fineCents: Number(payment.fine_cents ?? 0),
            interestCents: Number(payment.interest_cents ?? 0),
            splitBy: payment.split_by === "person" || payment.split_by === "contract" ? payment.split_by : null,
          })),
        fileId: (row.file_id as string | null) ?? null,
        seriesByOne: row.source === "series" && row.by_one === true,
        source: (row.source as string | null) ?? null,
      },
    ];
  });
}

/** The firm's accountant (0166), with the latest sendings of the month's package. */
export type FinanceAccountant = {
  name: string;
  email: string;
  office: string | null;
  crc: string | null;
  sends: { month: string; status: "sending" | "sent" | "failed"; at: string }[];
};

export async function readFinanceAccountant(
  supabase: SupabaseClient,
  firmId: string,
): Promise<FinanceAccountant | null | "error"> {
  const [accountant, sends] = await Promise.all([
    supabase.from("finance_accountants").select("name, email, office, crc").eq("org_id", firmId).maybeSingle(),
    supabase
      .from("finance_package_sends")
      .select("month, status, requested_at")
      .eq("org_id", firmId)
      .order("requested_at", { ascending: false })
      .limit(5),
  ]);
  if (accountant.error || sends.error) return "error";
  if (!accountant.data) return null;
  return {
    name: String(accountant.data.name),
    email: String(accountant.data.email),
    office: (accountant.data.office as string | null) ?? null,
    crc: (accountant.data.crc as string | null) ?? null,
    sends: (sends.data ?? []).flatMap((row) =>
      row.status === "sending" || row.status === "sent" || row.status === "failed"
        ? [{ month: String(row.month).slice(0, 7), status: row.status, at: String(row.requested_at) }]
        : [],
    ),
  };
}
