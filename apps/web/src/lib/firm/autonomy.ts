import { type Incident, INCIDENTS } from "@/lib/cases/cases";

/**
 * What each firm lets ONE decide alone (migration 0016, `autonomy_decisions`
 * and `firm_autonomy`): by default ONE decides and records each decision
 * (the owner's decision of 2026-10-14); a partner chooses, per decision, to
 * have a person check a share, or decide every one. Pure: the reader of the
 * database's answer and the screen's words (`product` namespace).
 */

export const AUTONOMY_DECISIONS = [
  "reply_client",
  "open_case_from_chat",
  "send_client_link",
  "send_signature_papers",
  "document_check",
  "chronology",
  "piece_text",
  "deadline_confirm",
  "file_or_hold",
  "create_lawsuits",
  "start_piece",
  "request_package",
  "sign_package",
  "publication_deadline",
  "publication_hearing",
] as const;
export type AutonomyDecision = (typeof AUTONOMY_DECISIONS)[number];

export const AUTONOMY_MODES = ["auto", "sampled", "approval"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const isAutonomyDecision = (value: unknown): value is AutonomyDecision =>
  (AUTONOMY_DECISIONS as readonly unknown[]).includes(value);
export const isAutonomyMode = (value: unknown): value is AutonomyMode =>
  (AUTONOMY_MODES as readonly unknown[]).includes(value);

/** One decision as the firm has it now. */
export type FirmAutonomy = {
  key: AutonomyDecision;
  /** The ways this decision may be taken. */
  modes: AutonomyMode[];
  defaultMode: AutonomyMode;
  /** The operator holds it for every firm: a person decides it everywhere for now. */
  held: boolean;
  /** What the firm chose; null when it follows the platform's default. */
  chosen: AutonomyMode | null;
  /** How it is taken now: a decision held is a person's whatever the firm chose. */
  mode: AutonomyMode;
  samplePercent: number;
  changedBy: string | null;
  changedAt: string | null;
};

/** The answer of `firm_autonomy`, read; null when it is not one. A decision this code does not know is left out. */
export function firmAutonomyOf(raw: unknown): FirmAutonomy[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): FirmAutonomy[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (!isAutonomyDecision(row.key) || !isAutonomyMode(row.mode) || !isAutonomyMode(row.default_mode)) return [];
    const modes = (Array.isArray(row.modes) ? row.modes : []).filter(isAutonomyMode);
    return [
      {
        key: row.key,
        modes: AUTONOMY_MODES.filter((mode) => modes.includes(mode)),
        defaultMode: row.default_mode,
        held: row.held === true,
        chosen: isAutonomyMode(row.chosen) ? row.chosen : null,
        mode: row.mode,
        samplePercent:
          typeof row.sample_percent === "number" && row.sample_percent >= 1 && row.sample_percent <= 100
            ? row.sample_percent
            : 20,
        changedBy: typeof row.changed_by === "string" ? row.changed_by : null,
        changedAt: typeof row.changed_at === "string" ? row.changed_at : null,
      },
    ];
  });
}

/** What each decision is, in the screen's words. */
export const DECISION_KEY: Record<AutonomyDecision, { title: string; body: string }> = {
  reply_client: { title: "autonomy-reply-client", body: "autonomy-reply-client-body" },
  open_case_from_chat: { title: "autonomy-open-case-from-chat", body: "autonomy-open-case-from-chat-body" },
  send_client_link: { title: "autonomy-send-client-link", body: "autonomy-send-client-link-body" },
  send_signature_papers: { title: "autonomy-send-signature-papers", body: "autonomy-send-signature-papers-body" },
  document_check: { title: "autonomy-document-check", body: "autonomy-document-check-body" },
  chronology: { title: "autonomy-chronology", body: "autonomy-chronology-body" },
  piece_text: { title: "autonomy-piece-text", body: "autonomy-piece-text-body" },
  deadline_confirm: { title: "autonomy-deadline-confirm", body: "autonomy-deadline-confirm-body" },
  file_or_hold: { title: "autonomy-file-or-hold", body: "autonomy-file-or-hold-body" },
  create_lawsuits: { title: "autonomy-create-lawsuits", body: "autonomy-create-lawsuits-body" },
  start_piece: { title: "autonomy-start-piece", body: "autonomy-start-piece-body" },
  request_package: { title: "autonomy-request-package", body: "autonomy-request-package-body" },
  sign_package: { title: "autonomy-sign-package", body: "autonomy-sign-package-body" },
  publication_deadline: { title: "autonomy-publication-deadline", body: "autonomy-publication-deadline-body" },
  publication_hearing: { title: "autonomy-publication-hearing", body: "autonomy-publication-hearing-body" },
};

export const MODE_KEY: Record<AutonomyMode, string> = {
  auto: "autonomy-mode-auto",
  sampled: "autonomy-mode-sampled",
  approval: "autonomy-mode-approval",
};

/** The decisions that are a lawyer's own acts: the screen says what the bar recommends beside them. */
export const LAWYER_ACTS: readonly AutonomyDecision[] = ["piece_text", "file_or_hold", "sign_package"];

/** The words of a refusal. */
export function autonomyErrorKey(code: string): string {
  if (code === "second_factor") return "autonomy-error-second-factor";
  if (code === "not_a_partner") return "autonomy-error-not-partner";
  if (code === "not_allowed_in_support_session") return "autonomy-error-support";
  if (code === "not_a_lawyer") return "autonomy-error-not-lawyer";
  if (code === "invalid_mode" || code === "invalid_sample" || code === "decision_not_found") {
    return "autonomy-error-invalid";
  }
  if (code === "invalid_amount" || code === "invalid_incident") return "autonomy-claim-error-amount";
  return "autonomy-error-failed";
}

/**
 * The Valor da Causa Pedido a firm gives for a kind of problem (migration 0052), in cents: what each claimant of a
 * case of that kind asks, written by ONE (or by the lawsuits a person creates) for a claimant with none. A kind
 * with none goes with no value, and the judge defines it (0064).
 */
export type ClaimDefault = { incident: Incident; cents: number };

/** The firm's default claims as the database answered them; a row that is not one is left out. */
export function claimDefaultsOf(raw: unknown): ClaimDefault[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ClaimDefault[] => {
    const row = (item ?? {}) as { incident?: unknown; cents?: unknown };
    const cents = typeof row.cents === "number" ? row.cents : typeof row.cents === "string" ? Number(row.cents) : NaN;
    return (INCIDENTS as readonly unknown[]).includes(row.incident) && Number.isInteger(cents) && cents > 0
      ? [{ incident: row.incident as Incident, cents }]
      : [];
  });
}

/** What the firm chose of the Valor da Causa Pedido: a value for some kind of problem, or no value (0064). */
export type ClaimChoice = "define" | "judge";

/** The choice the firm's values say: any value given is a choice to define one. */
export const claimChoiceOf = (defaults: ClaimDefault[]): ClaimChoice => (defaults.length > 0 ? "define" : "judge");

/** The firm's values as the fields hold them: reais with their decimals. */
export const typedClaims = (defaults: ClaimDefault[]): Partial<Record<Incident, string>> =>
  Object.fromEntries(defaults.map((row) => [row.incident, (row.cents / 100).toFixed(2)]));

/** A value as a field holds it, in cents: none when blank, `invalid` when it is no amount the database keeps. */
export function typedCents(raw: string | undefined): number | null | "invalid" {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value <= 1_000_000_000 ? Math.round(value * 100) : "invalid";
}

/**
 * What saving the firm's choice writes, in the order of the kinds: each kind whose value changed, with its new
 * value or none (a kind left blank goes with no value); choosing no value takes off every value the firm had.
 * The first kind typed with something that is no amount stops it, named.
 */
export function claimDefaultChanges(
  choice: ClaimChoice,
  typed: Partial<Record<Incident, string>>,
  saved: ClaimDefault[],
): { ok: true; changes: { incident: Incident; cents: number | null }[] } | { ok: false; invalid: Incident } {
  const before = new Map(saved.map((row) => [row.incident, row.cents]));
  const changes: { incident: Incident; cents: number | null }[] = [];
  for (const incident of INCIDENTS) {
    const cents = choice === "judge" ? null : typedCents(typed[incident]);
    if (cents === "invalid") return { ok: false, invalid: incident };
    if (cents !== (before.get(incident) ?? null)) changes.push({ incident, cents });
  }
  return { ok: true, changes };
}
