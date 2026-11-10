/**
 * The clients' parts of a release (migration 0135), read as nothing more than they may be, and their words: whose part,
 * what the firm kept and why, what is passed on and by when. Pure.
 */

export type MoneyShareStatus = "owed" | "held" | "minor" | "paid" | "direct";
export type HoldReason = "no_clause" | "cap_art50" | "minor";

export type MoneyShare = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  person: string | null;
  minor: boolean;
  grossCents: number;
  feesCents: number;
  costsCents: number;
  heldCents: number;
  held: { reason: HoldReason; cents: number }[];
  payableCents: number;
  status: MoneyShareStatus;
  dueOn: string | null;
  paidOn: string | null;
  holdDecision: "lowered" | "paid_whole" | "resent" | null;
  minorOrder: "deposited" | "released" | "accounts" | null;
  confirmedAt: string | null;
  path: "firm" | "direct";
  /** ONE read the Pix of this part in the statement (0155). */
  paidByOne: boolean;
  /** ONE read the release's money in the statement (0155). */
  receivedByOne: boolean;
  /** Its accountability statement to the client (0156), once the part was passed on or paid by the court. */
  statement?: { status: "owed" | "waiting" | "issued" | "failed"; fileId: string | null } | null;
  account: { kind: "pix" | "conta"; ends: string } | null;
};

const STATUSES: readonly MoneyShareStatus[] = ["owed", "held", "minor", "paid", "direct"];
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const whole = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0);

export function readMoneyShares(raw: unknown): MoneyShare[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): MoneyShare[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const status = STATUSES.includes(row.status as MoneyShareStatus) ? (row.status as MoneyShareStatus) : null;
    if (!id || !status) return [];
    const account = (row.account ?? null) as Record<string, unknown> | null;
    return [
      {
        id,
        caseId: text(row.case_id) ?? "",
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        person: text(row.person),
        minor: row.minor === true,
        grossCents: whole(row.gross_cents),
        feesCents: whole(row.fees_cents),
        costsCents: whole(row.costs_cents),
        heldCents: whole(row.held_cents),
        held: Array.isArray(row.held)
          ? (row.held as Record<string, unknown>[]).flatMap((hold) =>
              hold.reason === "no_clause" || hold.reason === "cap_art50" || hold.reason === "minor"
                ? [{ reason: hold.reason, cents: whole(hold.cents) }]
                : [],
            )
          : [],
        payableCents: whole(row.payable_cents),
        status,
        dueOn: text(row.due_on),
        paidOn: text(row.paid_on),
        holdDecision:
          row.hold_decision === "lowered" || row.hold_decision === "paid_whole" || row.hold_decision === "resent"
            ? row.hold_decision
            : null,
        minorOrder:
          row.minor_order === "deposited" || row.minor_order === "released" || row.minor_order === "accounts"
            ? row.minor_order
            : null,
        confirmedAt: text(row.confirmed_at),
        path: row.path === "direct" ? "direct" : "firm",
        paidByOne: row.paid_by_one === true,
        receivedByOne: row.received_by_one === true,
        account:
          account && (account.kind === "pix" || account.kind === "conta")
            ? { kind: account.kind, ends: text(account.ends) ?? "" }
            : null,
      },
    ];
  });
}

/** Whether a part owed is past its day. */
export const shareLate = (share: MoneyShare, today: string): boolean =>
  share.status === "owed" && share.dueOn !== null && share.dueOn < today;

export const SHARE_STATUS_KEY: Record<MoneyShareStatus, string> = {
  owed: "money-status-owed",
  held: "money-status-held",
  minor: "money-status-minor",
  paid: "money-status-paid",
  direct: "money-status-direct",
};

export const HOLD_KEY: Record<HoldReason, string> = {
  no_clause: "money-hold-no-clause",
  cap_art50: "money-hold-cap",
  minor: "money-hold-minor",
};

export const MINOR_ORDER_KEY: Record<"deposited" | "released" | "accounts", string> = {
  deposited: "money-minor-deposited",
  released: "money-minor-released",
  accounts: "money-minor-accounts",
};
