/**
 * The complaint before the lawsuit, only where the unit asks it (migration 0180, item 3.5 of the case journey plan):
 * a unit whose profile asks it holds the piece of its lawsuits until the case has one and its channel's days ran.
 * ONE files nothing at the channel: the client makes it at consumidor.gov.br, guided step by step on their link, and
 * gives the protocol; the client says what the airline answered, and ONE closes one nobody answered by its day. Pure:
 * what the database answers, read into what the screens show.
 */

export type PriorComplaintState = "not_required" | "owed" | "waiting" | "done";

export type PriorComplaint = {
  state: PriorComplaintState;
  /** Past its days with nobody's answer, until ONE closes it as unanswered. */
  overdue: boolean;
  /** The units of the case's planned lawsuits whose profile asks it. */
  units: string[];
  complaint: {
    id: string;
    channel: string;
    protocol: string | null;
    filedOn: string | null;
    dueOn: string | null;
    answeredOn: string | null;
    outcome: string;
    paidCents: number | null;
    byClient: boolean;
  } | null;
  /** How many days the channel gives the airline to answer. */
  days: number;
  /** The airline the complaint is made against, on the client's link. */
  airline: string | null;
};

const STATES: readonly PriorComplaintState[] = ["not_required", "owed", "waiting", "done"];

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const day = (value: unknown): string | null => {
  const read = text(value);
  return read && /^\d{4}-\d{2}-\d{2}/.test(read) ? read.slice(0, 10) : null;
};

/** What the database answers of a case's complaint before the lawsuit, or null for an answer that is not one. */
export function priorComplaintOf(raw: unknown): PriorComplaint | null {
  const row = (raw ?? null) as Record<string, unknown> | null;
  if (!row || row.ok === false) return null;
  const state = STATES.find((value) => value === row.state);
  if (!state) return null;
  const complaint = (row.complaint ?? null) as Record<string, unknown> | null;
  const paid = Number(complaint?.paid_cents);
  return {
    state,
    overdue: row.overdue === true,
    units: Array.isArray(row.units) ? row.units.filter((unit): unit is string => typeof unit === "string") : [],
    complaint:
      complaint && typeof complaint.id === "string"
        ? {
            id: complaint.id,
            channel: text(complaint.channel) ?? "other",
            protocol: text(complaint.protocol),
            filedOn: day(complaint.filed_on),
            dueOn: day(complaint.due_on),
            answeredOn: day(complaint.answered_on),
            outcome: text(complaint.outcome) ?? "pending",
            paidCents: complaint.paid_cents != null && Number.isFinite(paid) && paid >= 0 ? paid : null,
            byClient: complaint.by_client === true,
          }
        : null,
    days: Number.isFinite(Number(row.days)) && Number(row.days) > 0 ? Number(row.days) : 10,
    airline: text(row.airline),
  };
}

/** The address of the channel the client is guided to: the consumer platform of the federal government. */
export const CONSUMIDOR_GOV_URL = "https://www.consumidor.gov.br";

/** The refusals of the client's word on the complaint, in the screen's words. */
export function priorComplaintErrorKey(code: string | null | undefined): string {
  switch (code) {
    case "invalid_protocol":
      return "client-prior-complaint-error-protocol";
    case "invalid_date":
      return "client-prior-complaint-error-date";
    case "invalid_value":
      return "client-prior-complaint-error-value";
    case "not_owed":
      return "client-prior-complaint-error-not-owed";
    case "link_not_found":
      return "client-prior-complaint-error-link";
    default:
      return "client-prior-complaint-error";
  }
}
