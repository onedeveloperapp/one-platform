/**
 * The bills to pay and to receive (phase 5 of the plan of the controladoria and the finance, migration 0129), as the
 * screens read them: a bill's standing on a day (paid, closed, late by how many days, due today, due soon, open), the
 * views of the list, and the numbers of the month. Pure: no I/O, no clock of its own (the day is given).
 */

export type BillDirection = "pay" | "receive";
export type BillStatus = "open" | "paid" | "cancelled" | "renegotiated" | "written_off";

export type FinanceBill = {
  id: string;
  direction: BillDirection;
  status: BillStatus;
  counterparty: string | null;
  description: string | null;
  categoryId: string | null;
  category: string | null;
  caseId: string | null;
  cents: number;
  paidCents: number;
  dueOn: string;
  competenceOn: string;
  paidOn: string | null;
  typedLine: string | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
  closedReason: string | null;
  /** ONE settled it from the statement. */
  byOne: boolean;
  /** The interest and fine, and the discount, of its payments. */
  extraCents: number;
  discountCents: number;
};

export type BillStanding =
  | { kind: "paid"; on: string | null }
  | { kind: "closed"; status: "cancelled" | "renegotiated" | "written_off" }
  | { kind: "late"; days: number }
  | { kind: "today" }
  | { kind: "soon"; days: number }
  | { kind: "open"; days: number };

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Where a bill stands on a day: `soon` within the given days ahead. */
export function billStanding(
  bill: Pick<FinanceBill, "status" | "dueOn" | "paidOn">,
  today: string,
  soonDays = 7,
): BillStanding {
  if (bill.status === "paid") return { kind: "paid", on: bill.paidOn };
  if (bill.status !== "open") return { kind: "closed", status: bill.status };
  const ahead = daysBetween(today, bill.dueOn);
  if (ahead < 0) return { kind: "late", days: -ahead };
  if (ahead === 0) return { kind: "today" };
  if (ahead <= soonDays) return { kind: "soon", days: ahead };
  return { kind: "open", days: ahead };
}

export const BILL_VIEWS = ["pagar", "receber", "vencidas", "cobrar", "pagas", "fechadas"] as const;
export type BillView = (typeof BILL_VIEWS)[number];

/** Which bills a view holds: open to pay, open to receive, late to pay, late to receive (to charge), paid, closed. */
export function billInView(bill: FinanceBill, view: BillView, today: string): boolean {
  const late = bill.status === "open" && bill.dueOn < today;
  switch (view) {
    case "pagar":
      return bill.status === "open" && bill.direction === "pay";
    case "receber":
      return bill.status === "open" && bill.direction === "receive";
    case "vencidas":
      return late && bill.direction === "pay";
    case "cobrar":
      return late && bill.direction === "receive";
    case "pagas":
      return bill.status === "paid";
    default:
      return bill.status !== "open" && bill.status !== "paid";
  }
}

/** What is still owed of a bill. */
export const billRest = (bill: Pick<FinanceBill, "cents" | "paidCents">): number =>
  Math.max(bill.cents - bill.paidCents, 0);

export type BillNumbers = {
  /** Open receivables due this month, in cents (what is left of them). */
  receiveMonth: number;
  payMonth: number;
  /** Open bills past their day, both ways. */
  late: number;
  lateCount: number;
  /** Received this month, from the payments of the receivables. */
  receivedMonth: number;
};

/** The numbers of the month of a day, over the bills read. */
export function billNumbers(bills: readonly FinanceBill[], today: string): BillNumbers {
  const month = today.slice(0, 7);
  const numbers: BillNumbers = { receiveMonth: 0, payMonth: 0, late: 0, lateCount: 0, receivedMonth: 0 };
  for (const bill of bills) {
    if (bill.status === "open") {
      const rest = billRest(bill);
      if (bill.dueOn.slice(0, 7) === month) {
        if (bill.direction === "receive") numbers.receiveMonth += rest;
        else numbers.payMonth += rest;
      }
      if (bill.dueOn < today) {
        numbers.late += rest;
        numbers.lateCount += 1;
      }
    }
    if (bill.direction === "receive" && bill.paidOn?.slice(0, 7) === month) numbers.receivedMonth += bill.paidCents;
  }
  return numbers;
}

/** The order of a list: the late first, then by due day; closed and paid the latest first. */
export function billOrder(a: FinanceBill, b: FinanceBill): number {
  const openA = a.status === "open";
  const openB = b.status === "open";
  if (openA !== openB) return openA ? -1 : 1;
  return openA ? a.dueOn.localeCompare(b.dueOn) : b.dueOn.localeCompare(a.dueOn);
}
