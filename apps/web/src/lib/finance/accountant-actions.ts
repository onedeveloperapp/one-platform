"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { emailReady } from "@/lib/email-ready";
import { writeWorkbook } from "@/lib/export/xlsx-write";
import { accountantPackage } from "@/lib/finance/accountant-package";
import { readInvoices, readReport } from "@/lib/finance/reports";
import { readFinanceMonthMovement } from "@/lib/finance/reports-actions";
import { getMemberContext } from "@/lib/member/context";
import { sendAccountantPackageEmail } from "@flyee/email";

/**
 * The firm's accountant and the month's package by e-mail (migration 0166): who configures the books registers the
 * accountant, who operates them sends a month's package to that address and no other. The server builds the very
 * workbook the download builds and keeps no copy of it; each sending is on the record with what came of it.
 */

export type AccountantResult = { ok: true } | { ok: false; code: string; field?: string };
export type PackageSent = { ok: true; email: string } | { ok: false; code: string; limit?: number };

const MONTH = /^\d{4}-\d{2}$/;

async function call(name: string, args: Record<string, unknown>): Promise<AccountantResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, { target_org: context.firm.id, ...args });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; field?: string };
  if (answer.ok !== true) {
    return { ok: false, code: answer.code ?? "failed", ...(answer.field ? { field: answer.field } : {}) };
  }
  revalidatePath("/financeiro", "layout");
  return { ok: true };
}

export async function saveFinanceAccountant(fields: {
  name: string;
  email: string;
  office: string;
  crc: string;
}): Promise<AccountantResult> {
  return call("save_finance_accountant", {
    fields: {
      name: String(fields?.name ?? "").slice(0, 120),
      email: String(fields?.email ?? "").slice(0, 254),
      office: String(fields?.office ?? "").slice(0, 120),
      crc: String(fields?.crc ?? "").slice(0, 20),
    },
  });
}

export async function removeFinanceAccountant(): Promise<AccountantResult> {
  return call("remove_finance_accountant", {});
}

/** The month written for the reader of the e-mail: "outubro de 2026". */
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00Z`),
  );

/**
 * Sends a month's package to the firm's accountant: the database says whether it may and where it goes, the server
 * writes the workbook from the month's report, invoices and movement, the provider sends it, and the database is told
 * what came of it. Where e-mail does not leave ONE here, nothing is begun.
 */
export async function sendAccountantPackage(month: string): Promise<PackageSent> {
  if (!MONTH.test(month)) return { ok: false, code: "invalid_data" };
  if (!(await emailReady())) return { ok: false, code: "email_off" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const first = `${month}-01`;

  const [reportAnswer, invoicesAnswer, movement] = await Promise.all([
    context.supabase.rpc("finance_report", { target_org: context.firm.id, target_month: first }),
    context.supabase.rpc("finance_invoice_data", { target_org: context.firm.id, target_month: first }),
    readFinanceMonthMovement(month),
  ]);
  const report = reportAnswer.error ? null : readReport(reportAnswer.data);
  const invoices = invoicesAnswer.error ? null : readInvoices(invoicesAnswer.data);
  if (!report || !invoices || !movement) return { ok: false, code: "failed" };

  const { data: begun, error } = await context.supabase.rpc("begin_finance_package_send", {
    target_org: context.firm.id,
    target_month: first,
  });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (begun ?? {}) as { ok?: boolean; code?: string; limit?: number; send_id?: string; email?: string };
  if (answer.ok !== true || !answer.send_id || !answer.email) {
    return { ok: false, code: answer.code ?? "failed", ...(answer.limit ? { limit: answer.limit } : {}) };
  }

  const t = await getTranslations("product");
  let sent: { sent: boolean; error?: string };
  try {
    const bytes = writeWorkbook(
      accountantPackage({ report, invoices, movement, say: (key, values) => t(key, values) }),
    );
    sent = await sendAccountantPackageEmail(
      answer.email,
      {
        locale: "pt-BR",
        firmName: context.firm.name,
        monthLabel: monthLabel(month),
        senderName: context.profile.displayName || null,
      },
      { filename: `${t("reports-package")} ${month}.xlsx`, content: bytes },
      context.email || null,
    );
  } catch (thrown) {
    sent = { sent: false, error: thrown instanceof Error ? thrown.message : "send_failed" };
  }
  await context.supabase.rpc("finish_finance_package_send", {
    target_send: answer.send_id,
    target_sent: sent.sent,
    target_error: sent.sent ? null : String(sent.error ?? "").slice(0, 300),
  });
  revalidatePath("/financeiro/relatorios");
  return sent.sent ? { ok: true, email: answer.email } : { ok: false, code: "send_failed" };
}
