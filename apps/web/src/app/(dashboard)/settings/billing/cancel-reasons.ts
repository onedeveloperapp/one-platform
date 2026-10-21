/**
 * Why a member leaves (enum `subscription_cancel_reason`, migration 0003).
 * Shared by the cancellation dialog and the server action; the order is the
 * order the dialog offers them in.
 */
export const CANCEL_REASONS = [
  "too_expensive",
  "not_using",
  "missing_tool",
  "switched",
  "technical",
  "temporary",
  "other",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];
