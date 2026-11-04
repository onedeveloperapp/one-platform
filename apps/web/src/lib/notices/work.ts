import "server-only";

import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the notices to clients (migration 0038): for each
 * firm with a kind of notice on, the database reserves what is due and may
 * go (`reserve_client_notices`: the notice and its message to the outbox in
 * one statement, never twice, one firm's sweeps taking turns), and the
 * outbox of migration 0019 sends them one at a time, recording what the
 * vendor said. A firm whose reservation failed is left for the next round;
 * nothing is sent that was not reserved.
 */

export type NoticeReport = { firms: number; reserved: number; failedFirms: number; sent: number; notSent: number };

/** How many notices one firm reserves per round, and how long a round sends for. */
const PER_FIRM = 50;
const SEND_BUDGET_MS = 200_000;

export async function reserveNotices(
  service: SupabaseClient,
  options: { perFirm?: number } = {},
): Promise<{ firms: number; reserved: number; failedFirms: number }> {
  const { data, error } = await service.rpc("notice_firms");
  if (error) throw new Error(`notice_firms failed: ${error.code ?? "unknown"}`);
  const firms = ((data ?? []) as { org_id: string }[]).map((row) => row.org_id);
  let reserved = 0;
  let failedFirms = 0;
  for (const org of firms) {
    const { data: answer, error: refused } = await service.rpc("reserve_client_notices", {
      target_org: org,
      target_limit: options.perFirm ?? PER_FIRM,
    });
    if (refused) {
      failedFirms += 1;
      continue;
    }
    reserved += Number((answer as { reserved?: number } | null)?.reserved ?? 0);
  }
  return { firms: firms.length, reserved, failedFirms };
}

/** Reserves what is due in every firm, then sends what the outbox holds. */
export async function sweepNotices(
  service: SupabaseClient,
  options: { budgetMs?: number } = {},
): Promise<NoticeReport> {
  const round = await reserveNotices(service);
  if (round.reserved === 0) return { ...round, sent: 0, notSent: 0 };
  const delivered = await deliverOutbox(service, {
    limit: round.reserved,
    budgetMs: options.budgetMs ?? SEND_BUDGET_MS,
  });
  return { ...round, sent: delivered.sent, notSent: delivered.failed };
}

/**
 * Somebody switched a kind on or agreed to be told: what is due now is
 * reserved and sent right after the answer instead of at the next sweep.
 * Never waited for.
 */
export async function settleNotices(): Promise<void> {
  soon("client-notices", () => sweepNotices(createServiceClient(), { budgetMs: 20_000 }));
}
