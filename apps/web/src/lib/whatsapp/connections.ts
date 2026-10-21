import type { StatusTone } from "@/components/product/status-chip";
import type { SecondFactorState } from "@/lib/ai/approvals";
import type { FirmNotices } from "@/lib/notices/facts";

/**
 * The firm's WhatsApp connection as its screen reads it (migrations 0017 and
 * 0019): types and the pure rules of the screen. The reads are in the page,
 * under the session of who manages the firm; the writes are the actions of
 * `lib/whatsapp/actions.ts`.
 */

export type ConnectedNumber = {
  id: string;
  connectionId: string;
  provider: "meta" | "simulator";
  phoneLabel: string;
  verifiedName: string | null;
  /** `coexistence`: the number also lives on the firm's phone. `cloud`: only on the platform. */
  mode: "cloud" | "coexistence";
  status: "active" | "disconnected";
  /** Why it stopped, as the database recorded it: `partner_removed`, `connection_disconnected`. */
  disconnectReason: string | null;
  /** When it was connected, or disconnected, already written on the reader's clock. */
  sinceLabel: string;
  /** Coexistence: the phone's contacts and history were asked for. */
  syncRequested: boolean;
  /** Coexistence: how far the history got, 0 to 100. Null when none arrived. */
  historyProgress: number | null;
};

/** A number whose token is sealed and which the vendor still has to register: the six digits are missing. */
export type PendingRegistration = { connectionId: string; phoneLabel: string };

export type AccountTemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
};

/** What this environment can connect with, so the screen offers only what works here. */
export type ConnectEnvironment = {
  /** The simulator is on: a number that exists only here. */
  simulator: boolean;
  /** The vault has its keys: a token can be sealed. */
  vault: boolean;
  /** The platform's app at Meta, for the signup window. Null while it is not configured. */
  signup: { appId: string; configId: string; sdkVersion: string } | null;
};

export type ConnectionsData = {
  firm: { id: string; name: string };
  numbers: ConnectedNumber[];
  pending: PendingRegistration[];
  /** The connection of an active number reported a failure (`token_invalid`, `partner_removed`). */
  failing: boolean;
  templates: AccountTemplateRow[];
  secondFactor: SecondFactorState;
  supportVisit: boolean;
  environment: ConnectEnvironment;
  /** The firm's ZapSign account (migration 0023), or null when it never connected one. */
  signature: { connectionId: string; status: string; environment: string; lastError: string | null } | null;
  /** The firm's calendar of hearings in Google (migration 0037). */
  calendar: {
    available: boolean;
    connection: { id: string; status: string } | null;
    calendar: { name: string; status: "active" | "lost" | "off"; problem: string | null } | null;
    outcome: string | null;
  };
  /** The notices the firm's clients get on WhatsApp by themselves (migration 0038). */
  notices: FirmNotices;
};

/**
 * What the screen renders from. `not-manager` is somebody of the firm who
 * does not manage it: the connections are not theirs to see. None of the
 * states is ever shown as an empty list.
 */
export type ConnectionsState =
  | ({ kind: "ready" } & ConnectionsData)
  | { kind: "not-manager" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** The message key of each answer the connection actions give (`product` namespace). */
const CONNECT_ERROR_KEYS: Record<string, string> = {
  second_factor_required: "connections-error-second-factor",
  not_allowed_in_support_session: "connections-error-support-session",
  not_authorized: "connections-error-not-authorized",
  number_in_use: "connections-error-number-in-use",
  simulator_off: "connections-error-simulator-off",
  simulator_not_allowed: "connections-error-simulator-not-allowed",
  not_recorded: "connections-error-not-recorded",
  vault_not_configured: "connections-error-vault",
  backend_not_configured: "connections-error-backend",
  meta_not_configured: "connections-error-meta",
  invalid_signup: "connections-error-signup",
  signup_incomplete: "connections-error-signup",
  signup_code_refused: "connections-error-signup-code",
  account_unreadable: "connections-error-account",
  no_number: "connections-error-no-number",
  several_numbers: "connections-error-several-numbers",
  subscribe_failed: "connections-error-subscribe",
  registration_code_needed: "connections-error-registration-code",
  registration_failed: "connections-error-registration",
  connection_not_found: "connections-error-not-found",
  not_found: "connections-error-not-found",
  templates_unreadable: "connections-error-templates",
  number_disconnected: "connections-error-templates",
  invalid_token: "connections-error-signature-token",
  token_refused: "connections-error-signature-refused",
  provider_unavailable: "connections-error-signature-unavailable",
  already_connected: "connections-error-signature-connected",
  other_account: "connections-error-signature-other-account",
  calendar_not_configured: "connections-calendar-unavailable",
  not_connected: "connections-error-calendar-not-connected",
  grant_refused: "connections-calendar-lost-auth",
  calendar_unavailable: "connections-calendar-error-unavailable",
  calendar_refused: "connections-calendar-error-refused",
  calendar_unusable: "connections-calendar-error-unusable",
  no_calendar: "connections-calendar-error-unusable",
};

export const connectErrorKey = (code: string): string => CONNECT_ERROR_KEYS[code] ?? "connections-error-failed";

/** Why a number stopped, in words (`product` namespace). */
const DISCONNECT_KEYS: Record<string, string> = {
  connection_disconnected: "connections-reason-disconnected",
  connection_expired: "connections-reason-expired",
  partner_removed: "connections-reason-phone",
  account_disconnected: "connections-reason-phone",
  primary_inactivity: "connections-reason-inactivity",
  account_offboarded: "connections-reason-offboarded",
};

export const disconnectReasonKey = (reason: string | null): string =>
  DISCONNECT_KEYS[reason ?? ""] ?? "connections-reason-other";

/** A template's approval at the vendor, as a named badge (`product` namespace). */
const TEMPLATE_STATUS: Record<string, { key: string; tone: StatusTone }> = {
  approved: { key: "connections-template-approved", tone: "positive" },
  pending: { key: "connections-template-pending", tone: "info" },
  rejected: { key: "connections-template-rejected", tone: "danger" },
  paused: { key: "connections-template-paused", tone: "attention" },
  disabled: { key: "connections-template-disabled", tone: "neutral" },
};

export const templateStatus = (status: string): { key: string; tone: StatusTone } =>
  TEMPLATE_STATUS[status] ?? TEMPLATE_STATUS.disabled;

/** What a check found in a template's text, for the lawyer to weigh (`product` namespace). */
const FINDING_KEYS: Record<string, string> = {
  promises_result: "connections-finding-promises-result",
  speaks_of_price: "connections-finding-speaks-of-price",
  marketing_category: "connections-finding-marketing",
};

export const findingKey = (code: string): string | null => FINDING_KEYS[code] ?? null;
