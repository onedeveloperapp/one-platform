import { type CasePulse, casePulseOf, firmPulseOf } from "@/lib/cases/pulse";
import { createClient } from "@flyee/auth/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PulseRead<T> = { ok: true; pulse: T } | { ok: false };

/**
 * The pulse of a case, for its screen to know that something changed while it is open (migration 0096): asked by
 * the browser straight to the database, under the person's own session (the support visit's, in one), so a case of
 * another firm is not found and the app's host spends nothing on a screen that waits (2026-11-14: a server action
 * every few seconds per open screen was much of the host's plan). A pulse that cannot be read is said as such, and
 * the screen keeps what it has.
 */
export async function readCasePulse(caseId: string): Promise<PulseRead<CasePulse>> {
  if (typeof caseId !== "string" || !UUID.test(caseId)) return { ok: false };
  const { data, error } = await createClient().rpc("case_pulse", { target_case: caseId });
  const pulse = error ? null : casePulseOf(data);
  return pulse ? { ok: true, pulse } : { ok: false };
}

/** The pulse of the firm's home (0096), the same way: the database answers only to a member of the firm. */
export async function readHomePulse(firmId: string): Promise<PulseRead<string>> {
  if (typeof firmId !== "string" || !UUID.test(firmId)) return { ok: false };
  const { data, error } = await createClient().rpc("firm_pulse", { target_org: firmId });
  const stamp = error ? null : firmPulseOf(data);
  return stamp ? { ok: true, pulse: stamp } : { ok: false };
}
