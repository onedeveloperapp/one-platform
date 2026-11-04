"use server";

import { pendingBadge, type PendingGroup, pendingGroups, pendingLate, readFirmPending } from "@/lib/firm/pending";
import { readFirmToday, todayViewerOf } from "@/lib/firm/today";
import { sweepWhileUsed } from "@/lib/jobs/while-used";
import { getMemberContext } from "@/lib/member/context";

export type PendingRead =
  | { ok: true; groups: PendingGroup[]; badge: number; late: boolean }
  | { ok: false; code: "no_firm" | "unavailable" };

/**
 * What waits for the person who asks, in their firm (migrations 0038 and
 * 0044), for the center of the header: read under their own session, so it
 * holds what the home would show them and nothing of another firm. A read
 * that fails is said as such, never as nothing waiting.
 */
export async function readPendingCenter(): Promise<PendingRead> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "unavailable" };
  if (!context.firm) return { ok: false, code: "no_firm" };
  // The center asks every minute while a screen is in front of somebody: the sweeps that serve what people wait on
  // run now and then, after the answer (lib/jobs/while-used.ts).
  sweepWhileUsed();

  const [today, pending] = await Promise.all([
    context.supabase.rpc("firm_today", { target_org: context.firm.id }),
    context.supabase.rpc("firm_pending", { target_org: context.firm.id }),
  ]);
  const todayRead = today.error ? null : readFirmToday(today.data);
  const pendingRead = pending.error ? null : readFirmPending(pending.data);
  if (!todayRead || !pendingRead) return { ok: false, code: "unavailable" };

  const groups = pendingGroups(todayRead, pendingRead, todayViewerOf(context.firm));
  return { ok: true, groups, badge: pendingBadge(groups), late: pendingLate(groups) };
}
