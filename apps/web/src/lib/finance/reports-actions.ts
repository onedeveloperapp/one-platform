"use server";

import { revalidatePath } from "next/cache";

import {
  type Forecast,
  type InvoiceData,
  readForecast,
  readInvoices,
  readReport,
  type Report,
} from "@/lib/finance/reports";
import { getMemberContext } from "@/lib/member/context";

/** The books' reports (migration 0137): read for a month, the month closed or reopened, an invoice recorded. */

type Result = { ok: true } | { ok: false; code: string };
const MONTH = /^\d{4}-\d{2}$/;

export async function readFinanceReports(
  month: string,
): Promise<
  { ok: true; report: Report; forecast: Forecast | null; invoices: InvoiceData[] | null } | { ok: false; code: string }
> {
  if (!MONTH.test(month)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const first = `${month}-01`;
  const [report, forecast, invoices] = await Promise.all([
    context.supabase.rpc("finance_report", { target_org: context.firm.id, target_month: first }),
    context.supabase.rpc("finance_forecast", { target_org: context.firm.id }),
    context.supabase.rpc("finance_invoice_data", { target_org: context.firm.id, target_month: first }),
  ]);
  if (report.error) return { ok: false, code: "failed" };
  const read = readReport(report.data);
  if (!read) return { ok: false, code: "not_reader" };
  return {
    ok: true,
    report: read,
    forecast: forecast.error ? null : readForecast(forecast.data),
    invoices: invoices.error ? null : readInvoices(invoices.data),
  };
}

async function call(name: string, args: Record<string, unknown>, withFirm = true): Promise<Result> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, withFirm ? { target_org: context.firm.id, ...args } : args);
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  revalidatePath("/financeiro/relatorios");
  return { ok: true };
}

export async function closeFinanceMonth(month: string): Promise<Result> {
  if (!MONTH.test(month)) return { ok: false, code: "invalid_data" };
  return call("close_finance_month", { target_month: `${month}-01` });
}

export async function reopenFinanceMonth(month: string, reason: string): Promise<Result> {
  if (!MONTH.test(month)) return { ok: false, code: "invalid_data" };
  return call("reopen_finance_month", {
    target_month: `${month}-01`,
    target_reason: String(reason ?? "").slice(0, 300),
  });
}

export async function recordFinanceInvoice(entryId: string, number: string, issuedOn: string): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(entryId) || !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn))
    return { ok: false, code: "invalid_data" };
  return call(
    "record_finance_invoice",
    { target_entry: entryId, target_number: String(number ?? "").slice(0, 40), target_issued_on: issuedOn },
    false,
  );
}

/**
 * Who configures the books says what each category should come to in a month, and in as many months after it as
 * asked (migration 0163): the rows replace those months' budget. With the second factor; on the record.
 */
export async function saveFinanceBudget(
  month: string,
  rows: { categoryId: string; cents: number }[],
  months: number,
): Promise<Result> {
  if (!MONTH.test(month)) return { ok: false, code: "invalid_data" };
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((row) => /^[0-9a-f-]{36}$/i.test(String(row?.categoryId ?? "")) && Number(row?.cents) > 0)
    .slice(0, 200)
    .map((row) => ({ category_id: row.categoryId, cents: String(Math.trunc(Number(row.cents))) }));
  return call("save_finance_budget", {
    target_month: `${month}-01`,
    target_rows: clean,
    target_months: Math.min(Math.max(Math.trunc(Number(months) || 1), 1), 12),
  });
}

/** A movement of the month for the accountant's package (0164): never a name, only the case's number. */
export type MonthMovement = {
  day: string;
  account: string;
  kind: string;
  category: string | null;
  center: string | null;
  cents: number;
  caseSeq: number | null;
  byOne: boolean;
};

const one = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

/**
 * The month's movement of the books, by its day, for the accountant's package: every entry in force but a transfer
 * between the firm's own accounts, with its account, kind, category, cost centre, value and case number, never who it
 * was of nor its words (a client's name may be in them). Read under the books' policies: only who reads them.
 */
export async function readFinanceMonthMovement(month: string): Promise<MonthMovement[] | null> {
  if (!MONTH.test(month)) return null;
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const { data, error } = await context.supabase
    .from("finance_entries")
    .select(
      "occurred_on, kind, cents, by_one, finance_accounts(name), finance_categories(name), finance_cost_centers(name), cases(seq)",
    )
    .eq("org_id", context.firm.id)
    .is("cancelled_at", null)
    .neq("kind", "transfer")
    .gte("occurred_on", `${month}-01`)
    .lte("occurred_on", last)
    .order("occurred_on", { ascending: true })
    .limit(20000);
  if (error) return null;
  return (data ?? []).map((row) => ({
    day: String(row.occurred_on),
    account: String(one(row.finance_accounts as { name?: string } | null)?.name ?? ""),
    kind: String(row.kind),
    category: one(row.finance_categories as { name?: string } | null)?.name ?? null,
    center: one(row.finance_cost_centers as { name?: string } | null)?.name ?? null,
    cents: Number(row.cents),
    caseSeq: one(row.cases as { seq?: number } | null)?.seq ?? null,
    byOne: row.by_one === true,
  }));
}
