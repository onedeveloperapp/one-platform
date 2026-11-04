import { checkTemplate, placeholdersOf } from "@flyee/whatsapp/rules";

/**
 * The pure rules of the notices a firm's clients get on WhatsApp by
 * themselves (migration 0038): the kinds and their words, what a firm's own
 * text of a kind must keep (the database checks the same,
 * `begin_notice_template`), how a template the vendor decided is said, why a
 * notice cannot go, and how a message that went is said. Nothing here decides
 * whether a notice is due: the database does (`notice_candidates`).
 */

export const NOTICE_KINDS = [
  "hearing_change",
  "hearing_reminder",
  "payment_alert",
  "lawsuit_update",
  "document_refused",
  "flight_problem",
  "case_received",
  "lawsuit_filed",
  "case_questions",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const isNoticeKind = (value: unknown): value is NoticeKind =>
  (NOTICE_KINDS as readonly unknown[]).includes(value);

/** What each kind is called, and when it goes. */
export const KIND_KEY: Record<NoticeKind, { label: string; when: string }> = {
  hearing_change: { label: "notice-kind-hearing-change", when: "notice-kind-hearing-change-when" },
  hearing_reminder: { label: "notice-kind-hearing-reminder", when: "notice-kind-hearing-reminder-when" },
  payment_alert: { label: "notice-kind-payment-alert", when: "notice-kind-payment-alert-when" },
  lawsuit_update: { label: "notice-kind-lawsuit-update", when: "notice-kind-lawsuit-update-when" },
  document_refused: { label: "notice-kind-document-refused", when: "notice-kind-document-refused-when" },
  flight_problem: { label: "notice-kind-flight-problem", when: "notice-kind-flight-problem-when" },
  case_received: { label: "notice-kind-case-received", when: "notice-kind-case-received-when" },
  lawsuit_filed: { label: "notice-kind-lawsuit-filed", when: "notice-kind-lawsuit-filed-when" },
  case_questions: { label: "notice-kind-case-questions", when: "notice-kind-case-questions-when" },
};

/** What each value of a kind's text is, as the firm's form names it beside its number. */
const PARAM_KEY: Record<string, string> = {
  first_name: "notice-param-first-name",
  firm: "notice-param-firm",
  hearing: "notice-param-hearing",
  lawsuit: "notice-param-lawsuit",
  moment: "notice-param-moment",
  how: "notice-param-how",
  change: "notice-param-change",
  status: "notice-param-status",
  document: "notice-param-document",
  reason: "notice-param-reason",
  flight: "notice-param-flight",
  what: "notice-param-what",
  assistance: "notice-param-assistance",
  next: "notice-param-next",
  court: "notice-param-court",
};
export const paramKey = (param: string): string => PARAM_KEY[param] ?? "notice-param-other";

/**
 * What is wrong with a firm's own text of a kind, as the database would say
 * it: the values the kind has, each once and in order ({{1}}, {{2}}...), and
 * none at its start or its end; within the vendor's length.
 */
export function noticeTextProblem(
  body: string,
  valueCount: number,
): "invalid_body" | "invalid_values" | "value_at_edge" | null {
  const text = body.trim();
  if (text.length < 20 || text.length > 1024) return "invalid_body";
  const found = placeholdersOf(text);
  if (found.length !== valueCount || found.some((number, index) => number !== index + 1)) return "invalid_values";
  if (/^\{\{/.test(text) || /\}\}$/.test(text)) return "value_at_edge";
  return null;
}

/** What a lawyer is asked to weigh in a firm's text (the bar's rules on advertising): pointed at, never refused. */
export const noticeTextFindings = (body: string, footer: string | null): string[] =>
  checkTemplate({ name: "one_aviso", category: "utility", body, footerText: footer })
    .filter((finding) => finding.severity === "warning")
    .map((finding) => finding.code);

/** What became of a new text of a kind that is on, at the vendor: waiting, refused, or called marketing. */
export function pendingState(pending: { status: string; category: string } | null): string | null {
  if (!pending) return null;
  if (pending.status === "rejected" || pending.status === "disabled" || pending.status === "paused") {
    return "notices-pending-refused";
  }
  if (pending.status === "approved" && pending.category !== "utility") return "notices-pending-not-utility";
  return "notices-pending-waiting";
}

/** How a kind stands for the firm: no text sent, waiting for the vendor, refused, paused, approved and off, on. */
export type KindState = "none" | "pending" | "refused" | "paused" | "not_utility" | "ready" | "on";

export function kindState(kind: {
  enabled: boolean;
  template: { status: string; category: string } | null;
}): KindState {
  if (!kind.template) return "none";
  if (kind.template.status === "rejected" || kind.template.status === "disabled") return "refused";
  if (kind.template.status === "paused") return "paused";
  if (kind.template.status !== "approved") return "pending";
  if (kind.template.category !== "utility") return "not_utility";
  return kind.enabled ? "on" : "ready";
}

export const KIND_STATE_KEY: Record<KindState, string> = {
  none: "notice-state-none",
  pending: "notice-state-pending",
  refused: "notice-state-refused",
  paused: "notice-state-paused",
  not_utility: "notice-state-not-utility",
  ready: "notice-state-ready",
  on: "notice-state-on",
};

/**
 * Why a notice cannot go now. Nobody is asked to agree (0088): a person is told unless they have no WhatsApp, wrote
 * SAIR to the firm's number, or asked to stop the notices (on their link, or to a person of the firm).
 */
const BLOCKER_KEY: Record<string, string> = {
  no_phone: "notice-blocker-no-phone",
  opted_out: "notice-blocker-opted-out",
  stopped: "notice-blocker-stopped",
  kind_off: "notice-blocker-kind-off",
  template_unusable: "notice-blocker-template",
  no_number: "notice-blocker-no-number",
  number_failing: "notice-blocker-number-failing",
};
export const blockerKey = (code: string | null | undefined): string =>
  BLOCKER_KEY[code ?? ""] ?? "notice-blocker-other";

/** How a notice that went stands: its message in the outbox, at the vendor, on the phone, or not out. */
const SENT_KEY: Record<string, string> = {
  queued: "notice-sent-queued",
  sending: "notice-sent-sending",
  sent: "notice-sent-sent",
  delivered: "notice-sent-delivered",
  read: "notice-sent-read",
  failed: "notice-sent-failed",
};
export const sentKey = (status: string | null | undefined): string => SENT_KEY[status ?? ""] ?? "notice-sent-queued";

/** A message whose fate nobody can tell (the vendor did not answer): it may have reached the client. */
export const isUnconfirmed = (status: string, error: string | null): boolean =>
  status === "failed" && error === "unconfirmed";

/** What a refusal of a write is called on the screen. */
const ERROR_KEY: Record<string, string> = {
  invalid_body: "notice-error-body",
  invalid_values: "notice-error-values",
  value_at_edge: "notice-error-edge",
  no_number: "notice-error-no-number",
  several_accounts: "notice-error-several-accounts",
  no_template: "notice-error-no-template",
  template_not_approved: "notice-error-not-approved",
  template_not_utility: "notice-error-not-utility",
  note_required: "notice-error-note",
  no_phone: "notice-error-no-phone",
  person_not_found: "notice-error-person",
  second_factor_required: "connections-error-second-factor",
  not_allowed_in_support_session: "connections-error-support-session",
  not_authorized: "connections-error-not-authorized",
  unconfirmed: "notice-error-unconfirmed",
  rejected: "notice-error-refused",
  name_taken: "notice-error-name-taken",
  number_failing: "notice-blocker-number-failing",
  // The vendor's code for a token it no longer takes.
  meta_190: "notice-blocker-number-failing",
};
export function noticeErrorKey(code: string | null | undefined): string {
  const known = ERROR_KEY[code ?? ""];
  if (known) return known;
  // The vendor's own refusal of a text, by its code.
  if ((code ?? "").startsWith("meta_")) return "notice-error-refused";
  return "notice-error-failed";
}
