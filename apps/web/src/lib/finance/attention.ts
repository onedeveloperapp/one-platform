import type { PendingItem } from "@/lib/firm/pending";
import { formatCents } from "@flyee/rules/finance";

/**
 * What waits for somebody of the books (migration 0127), as the center of what waits and the home say it, to who reads
 * the books and nobody else (the database answers null to anybody else). Pure: no I/O.
 *
 * The lines of a statement ONE left to a person; an account whose statement is late (ONE keeps the books from the
 * statements, so a month with none is a month the books do not know); and a client's money that came into an account
 * of the firm's own, never revenue, which waits until somebody says it was set apart. Each is something only a person
 * does, so each goes under "O ONE precisa de você".
 */

export type LateAccount = { accountId: string; name: string; lastOn: string | null };

export type FinanceAttention = {
  lines: { count: number; accounts: number; oldest: string | null };
  late: LateAccount[];
  apart: { count: number; cents: number; oldest: string | null };
  /** The cases in court with no fees set (0131). */
  feesMissing: number;
  /** The clients' parts (0135): passed on late, held for a partner, a minor's waiting for the judge. */
  money?: { late: number; lateCents: number; held: number; minor: number };
  /** The bills (0129): to pay in the next days and late, to receive late (to charge), near the five years. */
  bills: {
    paySoon: number;
    paySoonCents: number;
    payLate: number;
    payLateCents: number;
    receiveLate: number;
    receiveLateCents: number;
    receiveOld: number;
  };
};

const NO_BILLS: FinanceAttention["bills"] = {
  paySoon: 0,
  paySoonCents: 0,
  payLate: 0,
  payLateCents: 0,
  receiveLate: 0,
  receiveLateCents: 0,
  receiveOld: 0,
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const whole = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The database's answer (`firm_finance_attention`), read; null for who does not read the books, or no answer. */
export function readFinanceAttention(raw: unknown): FinanceAttention | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  const lines = record(answer.lines);
  const apart = record(answer.apart);
  const bills = answer.bills === undefined ? null : record(answer.bills);
  return {
    lines: { count: whole(lines.count), accounts: whole(lines.accounts), oldest: text(lines.oldest) },
    late: (Array.isArray(answer.late) ? answer.late : []).flatMap((item) => {
      const row = record(item);
      const accountId = text(row.account_id);
      const name = text(row.name);
      return accountId && name ? [{ accountId, name, lastOn: text(row.last_on) }] : [];
    }),
    apart: { count: whole(apart.count), cents: whole(apart.cents), oldest: text(apart.oldest) },
    feesMissing: whole(answer.fees_missing),
    money: {
      late: whole(record(answer.money).late),
      lateCents: whole(record(answer.money).late_cents),
      held: whole(record(answer.money).held),
      minor: whole(record(answer.money).minor),
    },
    bills: bills
      ? {
          paySoon: whole(bills.pay_soon),
          paySoonCents: whole(bills.pay_soon_cents),
          payLate: whole(bills.pay_late),
          payLateCents: whole(bills.pay_late_cents),
          receiveLate: whole(bills.receive_late),
          receiveLateCents: whole(bills.receive_late_cents),
          receiveOld: whole(bills.receive_old),
        }
      : NO_BILLS,
  };
}

/** "03/11", a day of the books as the center says it. */
function shortDay(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** How many late accounts the center names one by one; the rest are one line. */
const LATE_NAMED = 3;

/**
 * The lines of the center for what waits in the books, each one click from where it is done, in their groups: a bill
 * to pay that passed its day is late; one due in the next days is of today and the next days; the rest is only a
 * person's to do (a line ONE left, a client's money to set apart, a statement late, a receivable to charge).
 */
export function financeAttentionGroups(attention: FinanceAttention): {
  late: PendingItem[];
  today: PendingItem[];
  one: PendingItem[];
} {
  const late: PendingItem[] = [];
  const today: PendingItem[] = [];
  if (attention.bills.payLate > 0) {
    late.push({
      id: "finance:bills:pay-late",
      href: "/financeiro/contas?ver=vencidas",
      tag: { key: "pending-tag-finance" },
      label: {
        key: "pending-finance-pay-late",
        values: { count: attention.bills.payLate, value: formatCents(attention.bills.payLateCents) },
      },
      count: attention.bills.payLate,
    });
  }
  if (attention.bills.paySoon > 0) {
    today.push({
      id: "finance:bills:pay-soon",
      href: "/financeiro/contas?ver=pagar",
      tag: { key: "pending-tag-finance" },
      label: {
        key: "pending-finance-pay-soon",
        values: { count: attention.bills.paySoon, value: formatCents(attention.bills.paySoonCents) },
      },
      count: attention.bills.paySoon,
    });
  }
  const one = financeAttentionItems(attention);
  if (attention.bills.receiveLate > 0) {
    one.push({
      id: "finance:bills:charge",
      href: "/financeiro/contas?ver=cobrar",
      tag: { key: "pending-tag-finance" },
      label: {
        key: "pending-finance-charge",
        values: { count: attention.bills.receiveLate, value: formatCents(attention.bills.receiveLateCents) },
      },
      detail:
        attention.bills.receiveOld > 0
          ? { key: "pending-finance-charge-old", values: { count: attention.bills.receiveOld } }
          : { key: "pending-finance-charge-detail" },
      count: attention.bills.receiveLate,
    });
  }
  return { late, today, one };
}

/** The lines of the center that are only a person's to do: a line ONE left, a client's money, a statement late. */
export function financeAttentionItems(attention: FinanceAttention): PendingItem[] {
  const items: PendingItem[] = [];
  if (attention.lines.count > 0) {
    items.push({
      id: "finance:lines",
      href: "/financeiro/conciliacao",
      tag: { key: "pending-tag-finance" },
      label: { key: "pending-finance-lines", values: { count: attention.lines.count } },
      detail: attention.lines.oldest
        ? { key: "pending-finance-lines-since", values: { day: shortDay(attention.lines.oldest) } }
        : undefined,
      count: attention.lines.count,
    });
  }
  if (attention.apart.count > 0) {
    items.push({
      id: "finance:apart",
      href: "/financeiro/lancamentos?ver=separar",
      tag: { key: "pending-tag-finance" },
      label: {
        key: "pending-finance-apart",
        values: { count: attention.apart.count, value: formatCents(attention.apart.cents) },
      },
      detail: { key: "pending-finance-apart-detail" },
      count: attention.apart.count,
    });
  }
  for (const account of attention.late.slice(0, LATE_NAMED)) {
    items.push({
      id: `finance:late:${account.accountId}`,
      href: "/financeiro/conciliacao",
      tag: { key: "pending-tag-finance" },
      label: { key: "pending-finance-late", values: { name: account.name } },
      detail: account.lastOn
        ? { key: "pending-finance-late-since", values: { day: shortDay(account.lastOn) } }
        : { key: "pending-finance-late-never" },
      count: 1,
    });
  }
  if (attention.feesMissing > 0) {
    items.push({
      id: "finance:fees-missing",
      href: "/financeiro/configuracao#honorarios",
      tag: { key: "pending-tag-finance" },
      label: { key: "pending-finance-fees-missing", values: { count: attention.feesMissing } },
      detail: { key: "pending-finance-fees-missing-detail" },
      count: attention.feesMissing,
    });
  }
  const money = attention.money ?? { late: 0, lateCents: 0, held: 0, minor: 0 };
  if (money.late > 0) {
    items.push({
      id: "finance:money-late",
      href: "/financeiro/repasses",
      tag: { key: "pending-tag-finance" },
      label: { key: "pending-finance-money-late", values: { count: money.late } },
      detail: { key: "pending-finance-money-late-detail" },
      count: money.late,
    });
  }
  if (money.held + money.minor > 0) {
    items.push({
      id: "finance:money-held",
      href: "/financeiro/repasses",
      tag: { key: "pending-tag-finance" },
      label: { key: "pending-finance-money-held", values: { count: money.held + money.minor } },
      detail: { key: "pending-finance-money-held-detail" },
      count: money.held + money.minor,
    });
  }
  const others = attention.late.length - LATE_NAMED;
  if (others > 0) {
    items.push({
      id: "finance:late:others",
      href: "/financeiro/conciliacao",
      tag: { key: "pending-tag-finance" },
      label: { key: "pending-finance-late-others", values: { count: others } },
      count: others,
    });
  }
  return items;
}
