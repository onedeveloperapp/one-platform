"use server";

import { readWaitingDecisions } from "@/lib/ai/decisions-read";
import { cloudSigningOffered } from "@/lib/cases/filing-facts";
import { readFilingAttention } from "@/lib/firm/filing-attention";
import { pendingBadge, type PendingGroup, pendingGroups, pendingLate, readFirmPending } from "@/lib/firm/pending";
import { readPublicationAcks } from "@/lib/firm/publication-acks";
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

  const [today, pending, decisions, filing, cloudSigning, acks] = await Promise.all([
    context.supabase.rpc("firm_today", { target_org: context.firm.id }),
    context.supabase.rpc("firm_pending", { target_org: context.firm.id }),
    // Each decision that waits, placed where it is decided; unread, the center counts them as before.
    readWaitingDecisions(context.supabase, context.firm.id, context.firm.firmFunction).catch(() => null),
    // What ONE's filing waits on a person for (0102); unread, the center says the rest as before.
    context.supabase.rpc("firm_filing_attention", { target_org: context.firm.id }),
    cloudSigningOffered(context.supabase).catch(() => false),
    // The awareness of ONE's triage of the publications owed (0104); unread, the center says the rest as before.
    context.supabase
      .rpc("firm_publication_acks", { target_org: context.firm.id })
      .then(({ data, error }) => (error ? null : readPublicationAcks(data))),
  ]);
  const todayRead = today.error ? null : readFirmToday(today.data);
  const pendingRead = pending.error ? null : readFirmPending(pending.data);
  if (!todayRead || !pendingRead) return { ok: false, code: "unavailable" };

  const viewer = todayViewerOf(context.firm);
  const attention = filing.error ? null : readFilingAttention(filing.data);
  const groups = pendingGroups(
    todayRead,
    pendingRead,
    viewer,
    new Date(),
    decisions,
    attention
      ? {
          attention,
          viewer: {
            userId: context.userId,
            firmFunction: context.firm.firmFunction,
            managesFirm: viewer.managesFirm,
            cloudSigning,
            timeZone: context.profile.timezone,
          },
        }
      : null,
    acks ? { acks, viewer: { userId: context.userId, firmFunction: context.firm.firmFunction } } : null,
  );
  return { ok: true, groups, badge: pendingBadge(groups), late: pendingLate(groups) };
}
