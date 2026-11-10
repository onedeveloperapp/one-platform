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
