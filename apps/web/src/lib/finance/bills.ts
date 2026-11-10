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
  /** The document it was read from, kept with it (0140). */
  fileId?: string | null;
  /** A bill ONE wrote for a series it made (0151). */
  seriesByOne?: boolean;
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

/** How long a receivable is past its day: the market's bands of default. */
export const AGING_BANDS = ["1-30", "31-60", "61-90", "91-180", "180+"] as const;
export type AgingBand = (typeof AGING_BANDS)[number];

const bandOf = (days: number): AgingBand =>
  days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : days <= 180 ? "91-180" : "180+";

export type ReceivableAging = {
  /** Each band with how many receivables and what is still owed of them, in the bands' order. */
  bands: { band: AgingBand; count: number; cents: number }[];
  /** Who owes the most, the largest first, at most `top` of them. */
  clients: { name: string; count: number; cents: number }[];
  count: number;
  cents: number;
};

/**
 * The default of the firm's receivables on a day (phase 5): every receivable still open past its due day, by how long
 * (the bands) and by who owes it (the counterparty, or the description when there is none). ONE charges nobody: this
 * says what the firm's people charge or inform.
 */
export function receivableAging(bills: readonly FinanceBill[], today: string, top = 5): ReceivableAging {
  const bands = new Map<AgingBand, { count: number; cents: number }>(
    AGING_BANDS.map((band) => [band, { count: 0, cents: 0 }]),
  );
  const clients = new Map<string, { name: string; count: number; cents: number }>();
  let count = 0;
  let cents = 0;
  for (const bill of bills) {
    if (bill.direction !== "receive" || bill.status !== "open" || bill.dueOn >= today) continue;
    const rest = billRest(bill);
    if (rest <= 0) continue;
    const band = bands.get(bandOf(daysBetween(bill.dueOn, today))) as { count: number; cents: number };
    band.count += 1;
    band.cents += rest;
    const name = (bill.counterparty ?? bill.description ?? "").trim();
    const key = name.toLocaleLowerCase("pt-BR");
    const client = clients.get(key) ?? { name, count: 0, cents: 0 };
    client.count += 1;
    client.cents += rest;
    clients.set(key, client);
    count += 1;
    cents += rest;
  }
  return {
    bands: AGING_BANDS.map((band) => ({ band, ...(bands.get(band) as { count: number; cents: number }) })),
    clients: [...clients.values()]
      .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, top),
    count,
    cents,
  };
}

/** A series ONE made of a bill it saw three months in a row in the statement (migration 0151). */
export type FinanceSeries = {
  id: string;
  direction: BillDirection;
  counterparty: string | null;
  category: string | null;
  cents: number;
  day: number;
  status: "active" | "stopped";
  stoppedReason: string | null;
  nextDueOn: string | null;
};

/** The firm's series as the database answers them (`firm_finance_series`); anything unreadable is left out. */
export function readFinanceSeries(raw: unknown): FinanceSeries[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): FinanceSeries[] => {
    if (typeof row !== "object" || row === null) return [];
    const value = row as Record<string, unknown>;
    const direction = value.direction === "pay" || value.direction === "receive" ? value.direction : null;
    const status = value.status === "active" || value.status === "stopped" ? value.status : null;
    if (typeof value.id !== "string" || !direction || !status) return [];
    return [
      {
        id: value.id,
        direction,
        counterparty: typeof value.counterparty === "string" ? value.counterparty : null,
        category: typeof value.category === "string" ? value.category : null,
        cents: Number(value.cents ?? 0),
        day: Number(value.day ?? 1),
        status,
        stoppedReason: typeof value.stopped_reason === "string" ? value.stopped_reason : null,
        nextDueOn: typeof value.next_due_on === "string" ? value.next_due_on : null,
      },
    ];
  });
}
