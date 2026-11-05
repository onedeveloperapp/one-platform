"use server";

import { type CasePulse, casePulseOf, firmPulseOf } from "@/lib/cases/pulse";
import { sweepWhileUsed } from "@/lib/jobs/while-used";
import { getMemberContext } from "@/lib/member/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PulseRead<T> = { ok: true; pulse: T } | { ok: false };

/**
 * The pulse of a case, for its screen to know that something changed while it is open (migration 0096): read
 * under the person's own session, so a case of another firm is not found. A pulse that cannot be read (the
 * database, or a database that does not have the function yet) is said as such, and the screen keeps what it has.
 */
export async function readCasePulse(caseId: string): Promise<PulseRead<CasePulse>> {
  if (typeof caseId !== "string" || !UUID.test(caseId)) return { ok: false };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  // Somebody follows a case on the screen: the sweeps that serve what people wait on run now and then, after the
  // answer (lib/jobs/while-used.ts).
  sweepWhileUsed();
  const { data, error } = await context.supabase.rpc("case_pulse", { target_case: caseId });
  const pulse = error ? null : casePulseOf(data);
  return pulse ? { ok: true, pulse } : { ok: false };
}

/** The pulse of the firm's home, for the person who asks (0096). */
export async function readHomePulse(): Promise<PulseRead<string>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  sweepWhileUsed();
  const { data, error } = await context.supabase.rpc("firm_pulse", { target_org: context.firm.id });
  const stamp = error ? null : firmPulseOf(data);
  return stamp ? { ok: true, pulse: stamp } : { ok: false };
}
