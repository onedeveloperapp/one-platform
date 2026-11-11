"use server";

import { revalidatePath } from "next/cache";

import { queueFinanceCategorization } from "@/lib/finance/categorize-work";
import { queueMoneySplit } from "@/lib/finance/money-work";
import { readFinanceAccess, readFinanceRegistrations } from "@/lib/finance/read";
import { queueFinanceReceipts } from "@/lib/finance/receipt-work";
import { queueMoneyStatements } from "@/lib/finance/statement-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * The writes of the firm's books (migration 0126), each through its database function, which checks who may (the
 * level, the second factor, never a support visit) and keeps it on the record. ONE moves no money: these write what
 * the bank and the person say happened.
 */

export type FinanceResult<T extends object = object> = ({ ok: true } & T) | { ok: false; code: string; field?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

async function call<T extends object>(
  name: string,
  args: Record<string, unknown>,
  pick: (answer: Record<string, unknown>) => T = () => ({}) as T,
): Promise<FinanceResult<T>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, { target_org: context.firm.id, ...args });
  if (error) {
    if (String(error.message ?? "").includes("month_closed")) return { ok: false, code: "month_closed" };
    return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  }
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true) {
    return {
      ok: false,
      code: typeof answer.code === "string" ? answer.code : "failed",
      field: typeof answer.field === "string" ? answer.field : undefined,
    };
  }
  revalidatePath("/financeiro", "layout");
  return { ok: true, ...pick(answer) };
}

export async function openFinanceBooks(firstDay: string): Promise<FinanceResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) return { ok: false, code: "invalid_data", field: "first_day" };
  return call("open_finance_books", { target_first_day: firstDay });
}

export async function setFinanceAccess(userId: string, level: string): Promise<FinanceResult> {
  if (!isId(userId)) return { ok: false, code: "failed" };
  return call("set_finance_access", { target_user: userId, target_level: level });
}

export async function saveFinanceAccount(
  accountId: string | null,
  fields: {
    kind: string;
    name: string;
    institution: string;
    numberTail: string;
    openingCents: number;
    closingDay: number | null;
    dueDay: number | null;
  },
): Promise<FinanceResult<{ accountId: string }>> {
  if (accountId !== null && !isId(accountId)) return { ok: false, code: "not_found" };
  if (!Number.isSafeInteger(fields.openingCents)) return { ok: false, code: "invalid_data", field: "opening_cents" };
  return call(
    "save_finance_account",
    {
      target_account: accountId,
      fields: {
        kind: fields.kind,
        name: String(fields.name ?? "").slice(0, 80),
        institution: String(fields.institution ?? "").slice(0, 80),
        number_tail: String(fields.numberTail ?? "").slice(0, 8),
        opening_cents: String(fields.openingCents),
        closing_day: fields.closingDay === null ? "" : String(fields.closingDay),
        due_day: fields.dueDay === null ? "" : String(fields.dueDay),
      },
    },
    (answer) => ({ accountId: String(answer.account_id) }),
  );
}

export async function saveFinanceCategory(
  table: "category" | "cost_center",
  recordId: string | null,
  fields: { name: string; kind?: string; dreLine?: string | null; dfcLine?: string | null },
): Promise<FinanceResult<{ id: string }>> {
  if (recordId !== null && !isId(recordId)) return { ok: false, code: "not_found" };
  return call(
    "save_finance_category",
    {
      target_table: table,
      target_record: recordId,
      fields: {
        name: String(fields.name ?? "").slice(0, 80),
        kind: fields.kind ?? "",
        dre_line: fields.dreLine ?? "",
        dfc_line: fields.dfcLine ?? "",
      },
    },
    (answer) => ({ id: String(answer.id) }),
  );
}

/** Archives with the reason (or brings back, with none), or deletes what nothing uses. */
export async function archiveFinanceRecord(
  table: "account" | "category" | "cost_center",
  recordId: string,
  reason: string | null,
  remove = false,
): Promise<FinanceResult> {
  if (!isId(recordId)) return { ok: false, code: "not_found" };
  return call("archive_finance_record", {
    target_table: table,
    target_record: recordId,
    target_reason: reason === null ? null : String(reason).slice(0, 300),
    target_delete: remove,
  });
}

export async function saveFinanceEntry(fields: {
  kind: string;
  accountId: string;
  toAccountId?: string | null;
  cents: number;
  categoryId?: string | null;
  costCenterId?: string | null;
  caseId?: string | null;
  counterparty?: string;
  description?: string;
  occurredOn: string;
  competenceOn?: string | null;
  /** The receipt ONE read into the form (0140), kept with the entry. */
  fileId?: string | null;
}): Promise<FinanceResult<{ entryId?: string; transferId?: string; documentKept?: boolean }>> {
  if (!isId(fields.accountId) || !Number.isSafeInteger(fields.cents))
    return { ok: false, code: "invalid_data", field: "cents" };
  const saved = await call(
    "save_finance_entry",
    {
      fields: {
        kind: fields.kind,
        account_id: fields.accountId,
        to_account_id: fields.toAccountId ?? "",
        cents: String(fields.cents),
        category_id: fields.categoryId ?? "",
        cost_center_id: fields.costCenterId ?? "",
        case_id: fields.caseId ?? "",
        counterparty: String(fields.counterparty ?? "").slice(0, 120),
        description: String(fields.description ?? "").slice(0, 300),
        occurred_on: fields.occurredOn,
        competence_on: fields.competenceOn ?? "",
      },
    },
    (answer) => ({
      entryId: typeof answer.entry_id === "string" ? answer.entry_id : undefined,
      transferId: typeof answer.transfer_id === "string" ? answer.transfer_id : undefined,
    }),
  );
  if (!saved.ok || !isId(fields.fileId) || !saved.entryId) return saved;
  return { ...saved, documentKept: await attachFinanceDocument("entry", saved.entryId, fields.fileId) };
}

export async function cancelFinanceEntry(entryId: string, reason: string): Promise<FinanceResult> {
  if (!isId(entryId)) return { ok: false, code: "not_found" };
  return call("cancel_finance_entry", { target_entry: entryId, target_reason: String(reason ?? "").slice(0, 300) });
}

export async function beginFinanceStatement(
  accountId: string,
  fields: {
    fileName: string;
    sha256: string;
    startsOn: string | null;
    endsOn: string | null;
    balanceCents: number | null;
    balanceOn: string | null;
    format?: "ofx" | "csv" | "xlsx" | "pdf";
  },
): Promise<FinanceResult<{ statementId: string }>> {
  if (!isId(accountId)) return { ok: false, code: "invalid_data", field: "account" };
  return call(
    "begin_finance_statement",
    {
      target_account: accountId,
      fields: {
        file_name: String(fields.fileName ?? "").slice(0, 200),
        sha256: fields.sha256,
        starts_on: fields.startsOn ?? "",
        ends_on: fields.endsOn ?? "",
        balance_cents: fields.balanceCents === null ? "" : String(fields.balanceCents),
        balance_on: fields.balanceOn ?? "",
        format: fields.format === "csv" || fields.format === "xlsx" || fields.format === "pdf" ? fields.format : "ofx",
      },
    },
    (answer) => ({ statementId: String(answer.statement_id) }),
  );
}

export async function addFinanceStatementLines(
  statementId: string,
  lines: { bankId: string | null; postedOn: string; cents: number; memo: string }[],
): Promise<FinanceResult<{ added: number; known: number; repeated: number }>> {
  if (!isId(statementId) || !Array.isArray(lines) || lines.length > 500)
    return { ok: false, code: "invalid_data", field: "lines" };
  return call(
    "add_finance_statement_lines",
    {
      target_statement: statementId,
      target_lines: lines.map((line) => ({
        bank_id: line.bankId ?? "",
        posted_on: line.postedOn,
        cents: String(Math.trunc(line.cents)),
        memo: String(line.memo ?? "").slice(0, 300),
      })),
    },
    (answer) => ({
      added: Number(answer.added ?? 0),
      known: Number(answer.known ?? 0),
      repeated: Number(answer.repeated ?? 0),
    }),
  );
}

export async function finishFinanceStatement(
  statementId: string,
): Promise<FinanceResult<{ decided: number; pending: number; gapCents: number | null }>> {
  if (!isId(statementId)) return { ok: false, code: "not_found" };
  const finished = await call("finish_finance_statement", { target_statement: statementId }, (answer) => ({
    decided: Number(answer.decided ?? 0),
    pending: Number(answer.pending ?? 0),
    gapCents:
      answer.balance_gap_cents === null || answer.balance_gap_cents === undefined
        ? null
        : Number(answer.balance_gap_cents),
  }));
  // What no rule decided, ONE reads by the AI right after the answer (0128), never waited for by the person.
  if (finished.ok && finished.pending > 0) queueFinanceCategorization();
  // A client's bill ONE settled from the statement owes its receipt (0152), issued after the answer.
  if (finished.ok) queueFinanceReceipts();
  // A release ONE read as received owes its split, and a part it read as passed on its accountability statement
  // (0155, 0156): both after the answer.
  if (finished.ok) queueMoneySplit();
  if (finished.ok) queueMoneyStatements();
  return finished;
}

export async function removeFinanceStatement(statementId: string, reason: string): Promise<FinanceResult> {
  if (!isId(statementId)) return { ok: false, code: "not_found" };
  return call("remove_finance_statement", {
    target_statement: statementId,
    target_reason: String(reason ?? "").slice(0, 300),
  });
}

export async function decideFinanceLine(
  lineId: string,
  fields: {
    kind: string;
    categoryId?: string | null;
    costCenterId?: string | null;
    caseId?: string | null;
    counterparty?: string;
    ruleWords?: string;
    ignoreReason?: string;
  },
): Promise<FinanceResult<{ others?: number }>> {
  if (!isId(lineId)) return { ok: false, code: "not_found" };
  const decided = await call(
    "decide_finance_line",
    {
      target_line: lineId,
      fields: {
        kind: fields.kind,
        category_id: fields.categoryId ?? "",
        cost_center_id: fields.costCenterId ?? "",
        case_id: fields.caseId ?? "",
        counterparty: String(fields.counterparty ?? "").slice(0, 120),
        rule_words: String(fields.ruleWords ?? "").slice(0, 80),
        ignore_reason: String(fields.ignoreReason ?? "").slice(0, 300),
      },
    },
    (answer) => ({ others: Number(answer.others ?? 0) }),
  );
  if (decided.ok) queueFinanceReceipts();
  return decided;
}

export async function undoFinanceLine(lineId: string): Promise<FinanceResult> {
  if (!isId(lineId)) return { ok: false, code: "not_found" };
  return call("undo_finance_line", { target_line: lineId });
}

/** Says a client's money that came into an account of the firm's own was set apart, or takes it back (0127). */
export async function setFinanceMoneyApart(entryId: string, apart: boolean): Promise<FinanceResult<object>> {
  if (!isId(entryId)) return { ok: false, code: "invalid_data", field: "entry" };
  return call("set_finance_money_apart", { target_entry: entryId, target_apart: apart === true }, () => ({}));
}

/** Begins an export of the entries, on the record with its format and how many lines (0127). */
export async function beginFinanceExport(format: "xlsx" | "pdf", rows: number): Promise<FinanceResult<object>> {
  if ((format !== "xlsx" && format !== "pdf") || !Number.isInteger(rows) || rows < 0 || rows > 100_000) {
    return { ok: false, code: "invalid_data", field: "export" };
  }
  return call("begin_finance_export", { target_format: format, target_rows: rows }, () => ({}));
}

/**
 * The registrations the top's "Adicionar" needs to write an entry (0127): the accounts, the chart and the cost centres,
 * read under the person's own session, only for who writes in the books.
 */
export async function readFinanceForAdd(): Promise<
  { ok: true; registrations: NonNullable<Awaited<ReturnType<typeof readFinanceRegistrations>>> } | { ok: false }
> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const access = await readFinanceAccess(context.supabase, context.firm.id);
  if (!access || !access.opened || (access.level !== "operate" && access.level !== "configure")) return { ok: false };
  const registrations = await readFinanceRegistrations(context.supabase, context.firm.id);
  return registrations ? { ok: true, registrations } : { ok: false };
}

/** Writes a bill to pay or to receive, or changes one still open with nothing paid (0129). */
export async function saveFinanceBill(
  billId: string | null,
  fields: {
    direction: "pay" | "receive";
    counterparty: string;
    description: string;
    categoryId: string | null;
    costCenterId: string | null;
    cents: number;
    dueOn: string;
    competenceOn: string | null;
    typedLine: string | null;
    barcode: string | null;
    repeat: number;
    /** The document ONE read into the form (0140), kept with the bill (the first month of a series). */
    fileId?: string | null;
  },
): Promise<FinanceResult<{ billId: string; months: number; documentKept?: boolean }>> {
  if (billId !== null && !isId(billId)) return { ok: false, code: "not_found" };
  if (!Number.isSafeInteger(fields.cents) || fields.cents <= 0)
    return { ok: false, code: "invalid_data", field: "cents" };
  const saved = await call(
    "save_finance_bill",
    {
      target_bill: billId,
      fields: {
        direction: fields.direction,
        counterparty: String(fields.counterparty ?? "").slice(0, 200),
        description: String(fields.description ?? "").slice(0, 400),
        category_id: fields.categoryId ?? "",
        cost_center_id: fields.costCenterId ?? "",
        cents: String(fields.cents),
        due_on: fields.dueOn,
        competence_on: fields.competenceOn ?? "",
        typed_line: fields.typedLine ?? "",
        barcode: fields.barcode ?? "",
        repeat: String(Math.trunc(fields.repeat || 1)),
      },
    },
    (answer) => ({ billId: String(answer.bill_id), months: Number(answer.months ?? 1) }),
  );
  if (!saved.ok || !isId(fields.fileId)) return saved;
  // A series answers its last month: the document is of the first, which carries the typed line.
  const context = await getMemberContext();
  let target = saved.billId;
  if (context?.firm && saved.months > 1) {
    const { data: last } = await context.supabase
      .from("finance_bills")
      .select("series_id")
      .eq("id", saved.billId)
      .maybeSingle();
    if (last?.series_id) {
      const { data: first } = await context.supabase
        .from("finance_bills")
        .select("id")
        .eq("series_id", last.series_id)
        .order("due_on", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (first?.id) target = String(first.id);
    }
  }
  const kept = await attachFinanceDocument("bill", target, fields.fileId);
  return { ...saved, documentKept: kept };
}

/** A person stops a series ONE made, with the reason: its open bills are cancelled with it (0151). */
export async function stopFinanceSeries(
  seriesId: string,
  reason: string,
): Promise<FinanceResult<{ cancelled: number }>> {
  if (!isId(seriesId)) return { ok: false, code: "not_found" };
  return call(
    "stop_finance_series",
    { target_series: seriesId, target_reason: String(reason ?? "").slice(0, 300) },
    (answer) => ({ cancelled: Number(answer.cancelled ?? 0) }),
  );
}

/** Keeps a document ONE read with the bill or the entry it was read into (0140); false when it could not. */
async function attachFinanceDocument(kind: "bill" | "entry", recordId: string, fileId: string): Promise<boolean> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(recordId)) return false;
  const { data, error } = await context.supabase.rpc("attach_finance_document", {
    target_org: context.firm.id,
    target_kind: kind,
    target_record: recordId,
    target_file: fileId,
  });
  return !error && (data as { ok?: boolean } | null)?.ok === true;
}

/** Registers a payment or a receipt of a bill, in part or whole, or with a discount (0129). */
export async function settleFinanceBill(
  billId: string,
  fields: { accountId: string; paidOn: string; cents: number; discountCents: number },
): Promise<FinanceResult<{ status: string }>> {
  if (!isId(billId) || !isId(fields.accountId)) return { ok: false, code: "invalid_data", field: "account" };
  if (!Number.isSafeInteger(fields.cents) || fields.cents <= 0)
    return { ok: false, code: "invalid_data", field: "cents" };
  const settled = await call(
    "settle_finance_bill",
    {
      target_bill: billId,
      fields: {
        account_id: fields.accountId,
        paid_on: fields.paidOn,
        cents: String(fields.cents),
        discount_cents: fields.discountCents > 0 ? String(fields.discountCents) : "",
      },
    },
    (answer) => ({ status: String(answer.status ?? "") }),
  );
  // A client's bill received owes its receipt (0152): ONE issues it after the answer, never waited for.
  if (settled.ok) queueFinanceReceipts();
  return settled;
}

/** Who operates the books asks for the receipt of a bill: kept to a person by the firm, or one that failed (0152). */
export async function requestFinanceReceipt(billId: string): Promise<FinanceResult<{ receipts: number }>> {
  if (!isId(billId)) return { ok: false, code: "not_found" };
  const asked = await call("request_finance_receipt", { target_bill: billId }, (answer) => ({
    receipts: Number(answer.receipts ?? 0),
  }));
  if (asked.ok) queueFinanceReceipts();
  return asked;
}

/** Cancels an open bill, or writes off a receivable a client will not pay, with the reason (0129). */
export async function closeFinanceBill(
  billId: string,
  how: "cancelled" | "written_off",
  reason: string,
): Promise<FinanceResult> {
  if (!isId(billId)) return { ok: false, code: "not_found" };
  return call("close_finance_bill", {
    target_bill: billId,
    target_how: how,
    target_reason: String(reason ?? "").slice(0, 300),
  });
}

/** Renegotiates an open bill into installments of what is still owed (0129). */
export async function renegotiateFinanceBill(
  billId: string,
  fields: { installments: number; firstDueOn: string; reason: string },
): Promise<FinanceResult> {
  if (!isId(billId)) return { ok: false, code: "not_found" };
  return call("renegotiate_finance_bill", {
    target_bill: billId,
    fields: {
      installments: String(Math.trunc(fields.installments || 0)),
      first_due_on: fields.firstDueOn,
      reason: String(fields.reason ?? "").slice(0, 300),
    },
  });
}
