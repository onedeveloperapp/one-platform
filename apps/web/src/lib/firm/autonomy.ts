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
  return "autonomy-error-failed";
}
