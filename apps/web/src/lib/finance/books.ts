/**
 * The firm's books (phase 4 of the plan of the controladoria and the finance, migration 0126): what the screens read,
 * read back from the database's answers, and the words of each thing. Pure. ONE records, reads, calculates and warns:
 * it never holds, receives, passes on, pays or charges money, and nothing here moves any.
 */

export type FinanceLevel = "none" | "costs" | "view" | "operate" | "configure";
export const FINANCE_LEVELS: readonly FinanceLevel[] = ["none", "costs", "view", "operate", "configure"];
export const isFinanceLevel = (value: unknown): value is FinanceLevel =>
  (FINANCE_LEVELS as readonly unknown[]).includes(value);

/** Whether a level reads the books (the costs of the cases are not the books). */
export const readsBooks = (level: FinanceLevel): boolean =>
  level === "view" || level === "operate" || level === "configure";
export const operatesBooks = (level: FinanceLevel): boolean => level === "operate" || level === "configure";
export const configuresBooks = (level: FinanceLevel): boolean => level === "configure";

export const LEVEL_KEY: Record<FinanceLevel, string> = {
  none: "finance-level-none",
  costs: "finance-level-costs",
  view: "finance-level-view",
  operate: "finance-level-operate",
  configure: "finance-level-configure",
};

export const ACCOUNT_KINDS = ["bank", "cash", "card", "receiving", "custody"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const isAccountKind = (value: unknown): value is AccountKind =>
  (ACCOUNT_KINDS as readonly unknown[]).includes(value);
export const ACCOUNT_KIND_KEY: Record<AccountKind, string> = {
  bank: "finance-account-bank",
  cash: "finance-account-cash",
  card: "finance-account-card",
  receiving: "finance-account-receiving",
  custody: "finance-account-custody",
};

export const ENTRY_KINDS = ["income", "expense", "client_money", "partner", "transfer"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const isEntryKind = (value: unknown): value is EntryKind => (ENTRY_KINDS as readonly unknown[]).includes(value);
export const ENTRY_KIND_KEY: Record<EntryKind, string> = {
  income: "finance-kind-income",
  expense: "finance-kind-expense",
  client_money: "finance-kind-client-money",
  partner: "finance-kind-partner",
  transfer: "finance-kind-transfer",
};

export const CATEGORY_KINDS = ["income", "expense", "client_money", "partner_in", "partner_out", "transfer"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const isCategoryKind = (value: unknown): value is CategoryKind =>
  (CATEGORY_KINDS as readonly unknown[]).includes(value);
export const CATEGORY_KIND_KEY: Record<CategoryKind, string> = {
  income: "finance-category-income",
  expense: "finance-category-expense",
  client_money: "finance-category-client-money",
  partner_in: "finance-category-partner-in",
  partner_out: "finance-category-partner-out",
  transfer: "finance-category-transfer",
};

/** Which kinds of category an entry of a kind takes, as the database checks it (`finance_entry_problem`). */
export function categoryFits(entry: EntryKind, category: CategoryKind): boolean {
  switch (entry) {
    case "income":
      return category === "income";
    case "expense":
      return category === "expense";
    case "client_money":
      return category === "client_money";
    case "partner":
      return category === "partner_in" || category === "partner_out";
    case "transfer":
      return category === "transfer";
  }
}

export type FinanceAccount = {
  id: string;
  kind: AccountKind;
  name: string;
  institution: string | null;
  numberTail: string | null;
  archived: boolean;
  balanceCents: number;
  pending: number;
  lastStatement: string | null;
  /** What the books said of the account on the bank's day against the bank's balance, of its latest statement. */
  balanceGapCents: number | null;
};

export type FinanceNumber = { now: number; before: number };

export type FinanceEntryView = {
  id: string;
  kind: EntryKind;
  cents: number;
  occurredOn: string;
  byOne: boolean;
  category: string | null;
  account: string;
  counterparty: string | null;
  description: string | null;
};

export type FinanceHome = {
  level: FinanceLevel;
  openedOn: string | null;
  accounts: FinanceAccount[];
  numbers: { balance: FinanceNumber; income: FinanceNumber; expense: FinanceNumber; clientMoney: FinanceNumber };
  pendingLines: number;
  latest: FinanceEntryView[];
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const integer = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const number = (value: unknown): FinanceNumber => {
  const raw = record(value);
  return { now: integer(raw.now), before: integer(raw.before) };
};

export function entryViewOf(raw: unknown): FinanceEntryView | null {
  const entry = record(raw);
  const id = text(entry.id);
  if (!id || !isEntryKind(entry.kind)) return null;
  return {
    id,
    kind: entry.kind,
    cents: integer(entry.cents),
    occurredOn: text(entry.occurred_on) ?? "",
    byOne: entry.by_one === true,
    category: text(entry.category),
    account: text(entry.account) ?? "",
    counterparty: text(entry.counterparty),
    description: text(entry.description),
  };
}

/** What `firm_finance_home` answered; null for who does not read the books, or an answer that is not one. */
export function financeHomeOf(raw: unknown): FinanceHome | null {
  if (raw === null || typeof raw !== "object") return null;
  const home = record(raw);
  if (!isFinanceLevel(home.level)) return null;
  const numbers = record(home.numbers);
  const accounts: FinanceAccount[] = [];
  for (const item of Array.isArray(home.accounts) ? home.accounts : []) {
    const account = record(item);
    const id = text(account.id);
    const name = text(account.name);
    if (!id || !name || !isAccountKind(account.kind)) continue;
    accounts.push({
      id,
      kind: account.kind,
      name,
      institution: text(account.institution),
      numberTail: text(account.number_tail),
      archived: account.archived === true,
      balanceCents: integer(account.balance_cents),
      pending: integer(account.pending),
      lastStatement: text(account.last_statement),
      balanceGapCents:
        account.balance_gap_cents === null || account.balance_gap_cents === undefined
          ? null
          : integer(account.balance_gap_cents),
    });
  }
  return {
    level: home.level,
    openedOn: text(home.opened_on),
    accounts,
    numbers: {
      balance: number(numbers.balance),
      income: number(numbers.income),
      expense: number(numbers.expense),
      clientMoney: number(numbers.client_money),
    },
    pendingLines: integer(home.pending_lines),
    latest: (Array.isArray(home.latest) ? home.latest : [])
      .map(entryViewOf)
      .filter((entry): entry is FinanceEntryView => entry !== null),
  };
}

/** Whole cents as a person reads them: "R$ 1.234,56", "-R$ 10,00". */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${whole},${String(abs % 100).padStart(2, "0")}`;
}

/** A day "YYYY-MM-DD" as a person reads it: "3 de nov. de 2026". */
export function dayLabel(iso: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
  );
}

/** The refusals of the books' functions, in the screens' words; anything else is "failed". */
const ERROR_KEY: Record<string, string> = {
  support_visit: "finance-error-support",
  not_allowed: "finance-error-not-allowed",
  second_factor: "finance-error-second-factor",
  books_closed: "finance-error-closed",
  has_entries: "finance-error-has-entries",
  not_found: "finance-error-not-found",
  in_use: "finance-error-in-use",
  kind_in_use: "finance-error-kind-in-use",
  already_imported: "finance-error-already-imported",
  decided: "finance-error-decided",
  not_member: "finance-error-not-member",
  own_access: "finance-error-own-access",
  invalid_data: "finance-error-invalid",
  daily_limit: "finance-error-daily-limit",
  bill_settled: "finance-error-bill-settled",
};
export const financeErrorKey = (code: string): string => ERROR_KEY[code] ?? "finance-error-failed";

/** The field a refusal of invalid data names, in the screens' words. */
const FIELD_KEY: Record<string, string> = {
  first_day: "finance-field-first-day",
  kind: "finance-field-kind",
  name: "finance-field-name",
  institution: "finance-field-institution",
  number_tail: "finance-field-number-tail",
  opening_cents: "finance-field-opening",
  days: "finance-field-days",
  account: "finance-field-account",
  to_account: "finance-field-to-account",
  cents: "finance-field-cents",
  category: "finance-field-category",
  cost_center: "finance-field-cost-center",
  case: "finance-field-case",
  day: "finance-field-day",
  competence: "finance-field-competence",
  reason: "finance-field-reason",
  rule_words: "finance-field-rule-words",
  file: "finance-field-file",
  level: "finance-field-level",
  dre_line: "finance-field-dre-line",
  dfc_line: "finance-field-dfc-line",
  counterparty: "finance-field-counterparty",
  entry: "finance-field-entry",
  export: "finance-field-export",
  direction: "finance-field-direction",
  due_on: "finance-field-due-on",
  typed_line: "finance-field-typed-line",
  repeat: "finance-field-repeat",
  how: "finance-field-how",
  installments: "finance-field-installments",
  discount: "finance-field-discount",
};
export const financeFieldKey = (field: string | null | undefined): string | null =>
  field ? (FIELD_KEY[field] ?? null) : null;
