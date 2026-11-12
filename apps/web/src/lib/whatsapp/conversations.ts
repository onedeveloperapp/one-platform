import { DOCUMENT_KIND_KEY, type DocumentKind } from "@/lib/cases/cases";
import type { WaitingReply } from "@/lib/conversations/reply";
import type { FirmFunction, OrgRole } from "@/lib/firm/roles";
import type { PageScope } from "@/lib/modules/offer";
import type { InboxCounts, InboxSort, InboxView } from "@/lib/whatsapp/inbox-list";

/**
 * The firm's conversations as the screens read them (migration 0019): types
 * and the pure rules of the screen. The reads are in the page, under the
 * person's own session; every write is a function of the database, reached
 * through `lib/whatsapp/actions.ts`.
 */

export type WhatsAppState = "active" | "disconnected" | "none";

export type ConversationSummary = {
  id: string;
  numberId: string;
  /** The person's number, digits only. */
  contact: string;
  /** The name the firm's phone has for the person, else the one WhatsApp shows, else the number. */
  name: string;
  phoneLabel: string;
  preview: string | null;
  lastDirection: "in" | "out" | null;
  /**
   * The person wrote last, through the platform, and nobody of the firm answered. A last word that
   * came with the history of the number, from before it was connected, waits for nobody.
   */
  waiting: boolean;
  /** When the last message was, already written on the reader's clock. */
  lastLabel: string | null;
  unread: number;
  /** Free text may be sent: the person wrote within the service window. */
  windowOpen: boolean;
  /** When the window closes, written on the reader's clock. Null when it is closed. */
  windowClosesLabel: string | null;
  optedOut: boolean;
  /** The number this conversation is on is connected. */
  numberActive: boolean;
  /** The number is a simulated one: the screen offers to play the person's side. */
  simulated: boolean;
  /** The number is the firm's test chat (0047): the person's side is played on its page. */
  test: boolean;
  /** Who answers it (0048): ONE, or a person of the firm who took it over or whom ONE called. */
  agent: "one" | "person";
  /** Why ONE called a person, while the conversation waits for one. */
  calledReason: string | null;
  /** An answer of ONE waits for a person's "Enviar" in it. */
  replyWaiting: boolean;
};

export type MessageStatus = "received" | "queued" | "sending" | "sent" | "delivered" | "read" | "failed";

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  /** `cloud`: through the platform. `app`: typed on the firm's phone. `history`: from before the number was connected. */
  origin: "cloud" | "app" | "history";
  kind: string;
  body: string | null;
  status: MessageStatus;
  errorCode: string | null;
  momentLabel: string;
  /** Who of the firm wrote it here, or approved ONE's answer. Null for what came in, for the phone and for somebody who left. */
  authorName: string | null;
  /** When it was, for the order of the conversation. */
  at: string;
  /** ONE wrote it: its own words (a link, a notice, the first word on a flight) or a model's answer. */
  byOne: boolean;
  /** A model's answer: a run of the task that answers the passenger. */
  aiRun: boolean;
  templateName: string | null;
  media: { state: "none" | "pending" | "stored" | "failed"; fileId: string | null; filename: string | null };
};

/** What ONE did in a conversation, or who took it over, as the thread tells it (`wa_conversation_events`). */
export type ThreadEvent = {
  id: string;
  kind: string;
  at: string;
  momentLabel: string;
  caseId: string | null;
  seq: number | null;
  reason: string | null;
  actorName: string | null;
  fromPhone: boolean;
  /** The kind of paper ONE joined to the case, for `document_joined`. */
  paper: string | null;
};

/**
 * The words of each event of a conversation, with what they name; `paperKey` is the name of a paper ONE
 * joined to the case, said as `paper`.
 */
export function eventWords(event: ThreadEvent): {
  key: string;
  values: Record<string, string | number>;
  paperKey?: string;
} {
  switch (event.kind) {
    case "case_opened":
      return { key: "inbox-event-case-opened", values: { seq: event.seq ?? 0 } };
    case "document_joined":
      return {
        key: "inbox-event-document-joined",
        values: { seq: event.seq ?? 0 },
        paperKey: DOCUMENT_KIND_KEY[(event.paper ?? "other") as DocumentKind] ?? DOCUMENT_KIND_KEY.other,
      };
    case "statement_joined":
      return { key: "inbox-event-statement-joined", values: { seq: event.seq ?? 0 } };
    case "link_sent":
      return { key: "inbox-event-link-sent", values: {} };
    case "person_called":
      return { key: "inbox-event-person-called", values: { reason: event.reason ?? "" } };
    case "taken_over":
      return event.fromPhone
        ? { key: "inbox-event-taken-over-phone", values: {} }
        : event.actorName
          ? { key: "inbox-event-taken-over", values: { name: event.actorName } }
          : { key: "inbox-event-taken-over-unnamed", values: {} };
    case "returned_to_one":
      return event.actorName
        ? { key: "inbox-event-returned", values: { name: event.actorName } }
        : { key: "inbox-event-returned-unnamed", values: {} };
    case "declined":
      return { key: "inbox-event-declined", values: {} };
    case "not_qualified":
      return { key: "inbox-event-not-qualified", values: {} };
    case "stopped":
      return { key: "inbox-event-stopped", values: {} };
    case "lead_followup":
      return { key: "inbox-event-lead-followup", values: {} };
    case "came_from_ad":
      return event.reason
        ? { key: "inbox-event-came-from-ad", values: { headline: event.reason } }
        : { key: "inbox-event-came-from-ad-plain", values: {} };
    default:
      return { key: "inbox-event-other", values: {} };
  }
}

export type TemplateOption = {
  id: string;
  name: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  paramCount: number;
};

export type InboxData = {
  firm: { id: string; name: string };
  me: { role: OrgRole; firmFunction: FirmFunction };
  whatsapp: WhatsAppState;
  /** The conversations of the view the page was asked for (`?ver=`), in its order (`?ordem=`), at most `CONVERSATIONS_SHOWN`. */
  conversations: ConversationSummary[];
  /** How many conversations the view holds, beyond the ones shown. */
  total: number;
  /** How many each view holds, over every conversation of the firm (or of the module). */
  counts: InboxCounts;
  view: InboxView;
  sort: InboxSort;
  selected: {
    conversation: ConversationSummary;
    messages: ThreadMessage[];
    olderHidden: boolean;
    /** The cases of the person with this number, the latest first. */
    cases: { id: string; seq: number }[];
    /** What ONE did and what changed hands, told between the messages (0048). */
    events: ThreadEvent[];
    /** The answer of ONE that waits for a person's "Enviar" here, and whether this person's function decides it. */
    waitingReply: { reply: WaitingReply; mayDecide: boolean } | null;
  } | null;
  /** The approved templates of the selected conversation's account. */
  templates: TemplateOption[];
  /** A support visit reads the conversations and writes nothing. */
  supportVisit: boolean;
  /** The simulated number of the firm, when the simulator is on: the screen can start a conversation on it. */
  simulatorNumberId: string | null;
  /**
   * The firm's panel of attendance (0223): whether this person can enter it from here, and why the last try to
   * enter did not, when it came back here (`?painel=`).
   */
  panel: { available: boolean; error: string | null };
  /** The modules of the firm, and the one the inbox is under (0078): its conversations, by its cases' clients. */
  scope: PageScope;
};

/**
 * What the screen renders from. `no-firm` is the platform operator, who works
 * in no firm; `unavailable` is a clone without Supabase; `error` is a read
 * that failed. None of them is ever shown as an empty list.
 */
export type InboxState =
  | ({ kind: "ready" } & InboxData)
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** How many conversations the list loads, most recent first. */
export const CONVERSATIONS_SHOWN = 60;

/** How many messages of a conversation the thread loads, the most recent ones. */
export const MESSAGES_SHOWN = 80;

/** A number as people write it: `+55 (62) 99999-0001` for a Brazilian one, `+<digits>` for any other. */
export function phoneLabel(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  const brazil = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(clean);
  if (brazil) return `+55 (${brazil[1]}) ${brazil[2]}-${brazil[3]}`;
  return clean ? `+${clean}` : "";
}

/** The name a conversation shows under: the firm's own name for the person first. */
export const contactName = (input: { savedName: string | null; contactName: string | null; contact: string }): string =>
  input.savedName?.trim() || input.contactName?.trim() || phoneLabel(input.contact);

/**
 * True when a conversation waits for the firm: its last message is the person's and it is the one
 * that arrived through the platform (the same rule `firm_today` counts by, migration 0020).
 */
export function isWaiting(input: {
  lastDirection: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
}): boolean {
  if (input.lastDirection !== "in" || !input.lastInboundAt || !input.lastMessageAt) return false;
  return Date.parse(input.lastInboundAt) >= Date.parse(input.lastMessageAt);
}

/** Who may record that a person agreed to be written to again: who manages the firm or works its cases. */
export const mayRemoveOptOut = (role: OrgRole, firmFunction: FirmFunction): boolean =>
  role === "owner" || role === "admin" || firmFunction === "socio" || firmFunction === "advogado";

/**
 * What the composer offers in a conversation, decided from its state in the
 * same order the database decides (`reserve_wa_send`), so the screen never
 * offers what would be refused:
 *
 *   read_only     a support visit;
 *   disconnected  the number is no longer connected;
 *   text          the window is open: free text;
 *   opted_out     the window is closed and the person asked to stop;
 *   template      the window is closed: only an approved template.
 */
export type ComposerMode = "read_only" | "disconnected" | "text" | "opted_out" | "template";

export function composerMode(input: {
  supportVisit: boolean;
  numberActive: boolean;
  windowOpen: boolean;
  optedOut: boolean;
}): ComposerMode {
  if (input.supportVisit) return "read_only";
  if (!input.numberActive) return "disconnected";
  if (input.windowOpen) return "text";
  return input.optedOut ? "opted_out" : "template";
}

/** The words of each kind of message that has no text of its own (`product` namespace). */
const KIND_KEYS: Record<string, string> = {
  image: "inbox-kind-image",
  document: "inbox-kind-document",
  audio: "inbox-kind-audio",
  video: "inbox-kind-video",
  sticker: "inbox-kind-sticker",
  location: "inbox-kind-location",
  contacts: "inbox-kind-contacts",
  reaction: "inbox-kind-reaction",
  interactive: "inbox-kind-interactive",
  button: "inbox-kind-interactive",
  template: "inbox-kind-template",
  system: "inbox-kind-system",
};

export const kindKey = (kind: string): string => KIND_KEYS[kind] ?? "inbox-kind-unsupported";

/** What became of a message the firm sent, as a word (`product` namespace). */
const STATUS_KEYS: Record<MessageStatus, string> = {
  received: "inbox-status-received",
  queued: "inbox-status-queued",
  sending: "inbox-status-sending",
  sent: "inbox-status-sent",
  delivered: "inbox-status-delivered",
  read: "inbox-status-read",
  failed: "inbox-status-failed",
};

export const statusKey = (status: MessageStatus): string => STATUS_KEYS[status];

/**
 * Why a message did not go out, in words (`product` namespace). The codes are
 * the ones recorded on the message: a name when the reason has one, the
 * vendor's own code otherwise, which the screen shows as it is for whoever
 * supports the firm.
 */
const FAILURE_KEYS: Record<string, string> = {
  window_closed: "inbox-failure-window-closed",
  invalid_recipient: "inbox-failure-invalid-recipient",
  token_invalid: "inbox-failure-token-invalid",
  vault_not_configured: "inbox-failure-token-invalid",
  rate_limited: "inbox-failure-rate-limited",
  unavailable: "inbox-failure-unavailable",
  unconfirmed: "inbox-failure-unconfirmed",
  not_attempted: "inbox-failure-not-attempted",
  number_disconnected: "inbox-failure-number-disconnected",
  simulator_off: "inbox-failure-simulator-off",
  file_unavailable: "inbox-failure-file",
  file_not_found: "inbox-failure-file",
};

export const failureKey = (code: string | null): string => FAILURE_KEYS[code ?? ""] ?? "inbox-failure-other";

/** True when the failure has no words of its own, so the code is shown beside the generic sentence. */
export const failureHasNoWords = (code: string | null): boolean => !(code && code in FAILURE_KEYS);

/** The message key of each answer the sending functions give (`product` namespace). */
const SEND_ERROR_KEYS: Record<string, string> = {
  not_allowed_in_support_session: "inbox-error-support-session",
  not_found: "inbox-error-not-found",
  number_disconnected: "inbox-error-number-disconnected",
  empty: "inbox-error-empty",
  too_long: "inbox-error-too-long",
  window_closed: "inbox-error-window-closed",
  template_not_found: "inbox-error-template",
  template_not_approved: "inbox-error-template",
  template_params_mismatch: "inbox-error-template-values",
  opted_out: "inbox-error-opted-out",
  note_required: "inbox-error-note-required",
  not_authorized: "inbox-error-not-authorized",
  backend_not_configured: "inbox-error-backend",
  file_not_found: "inbox-error-file",
  type_not_allowed: "inbox-error-file-type",
  too_large: "inbox-error-file-size",
  not_uploaded: "inbox-error-file-upload",
};

export const sendErrorKey = (code: string): string => SEND_ERROR_KEYS[code] ?? "inbox-error-failed";
