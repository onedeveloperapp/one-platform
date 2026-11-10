import "server-only";

import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { PAYOUT_RULE_VERSION, splitPayout } from "@flyee/rules/payout";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The clients' money (migration 0135), the backend's half: a release received owes its split by claimant, which the
 * rule `repasse-v1` computes (`@flyee/rules/payout`) and the database checks adds up before it records it. In the
 * court's direct path the parts are only said, the court pays them.
 */

type ToSplit = {
  release_id: string;
  path: "firm" | "direct";
  received_cents: number;
  claimants: { party_id: string; person_id: string; minor: boolean }[];
  fees: { success_percent?: number; success_min_cents?: number; settlement_percent?: number | null } | null;
  fees_authorized: boolean;
  settlement: boolean;
  costs_cents: number;
};

const number = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** One release split and recorded; false when it owes nothing any more. */
export async function splitRelease(service: SupabaseClient, releaseId: string): Promise<boolean> {
  const { data, error } = await service.rpc("money_release_to_split", { target_release: releaseId });
  if (error) throw new Error("money_release_to_split failed");
  if (!data) return false;
  const input = data as ToSplit;
  const payout = splitPayout({
    receivedCents: number(input.received_cents),
    claimants: input.claimants.map((claimant) => ({
      partyId: claimant.party_id,
      minor: claimant.minor,
      ownCents: null,
    })),
    successPercent: number(input.fees?.success_percent),
    successMinCents: number(input.fees?.success_min_cents),
    settlementPercent:
      input.fees?.settlement_percent === null || input.fees?.settlement_percent === undefined
        ? null
        : number(input.fees.settlement_percent),
    settlement: input.settlement,
    // With no fees on the case there is nothing to keep, and so nothing in discussion.
    feesAuthorized: input.fees_authorized || !input.fees,
    costsCents: number(input.costs_cents),
  });
  const people = new Map(input.claimants.map((claimant) => [claimant.party_id, claimant.person_id]));
  const shares =
    payout.shares.length > 0
      ? payout.shares.map((share) => ({
          party_id: share.partyId,
          person_id: people.get(share.partyId) ?? null,
          minor: share.minor,
          gross_cents: share.grossCents,
          fees_cents: share.feesCents,
          costs_cents: share.costsCents,
          held: share.held,
          payable_cents: share.payableCents,
        }))
      : // A lawsuit with no claimant on record: the whole release is one part, held for a person.
        [
          {
            party_id: "",
            person_id: null,
            minor: false,
            gross_cents: number(input.received_cents),
            fees_cents: 0,
            costs_cents: 0,
            held: [{ reason: "no_clause", cents: number(input.received_cents) }],
            payable_cents: 0,
          },
        ];
  const { data: recorded, error: recordError } = await service.rpc("record_money_split", {
    target_release: releaseId,
    target_rule: PAYOUT_RULE_VERSION,
    target_shares: shares,
  });
  if (recordError) throw new Error("record_money_split failed");
  return (recorded as { ok?: boolean } | null)?.ok === true;
}

export async function moneyRound(service: SupabaseClient, until: number): Promise<SweepReport> {
  const { data, error } = await service.rpc("money_releases_pending", { target_limit: 10 });
  if (error) throw new Error("money_releases_pending failed");
  let split = 0;
  for (const id of (Array.isArray(data) ? data : []) as string[]) {
    if (Date.now() >= until) break;
    if (await splitRelease(service, id)) split += 1;
  }
  return { split };
}

/** Right after a person registered a release as received: its split, on the same server. */
export function queueMoneySplit(): void {
  soon("client-money", async () => {
    await moneyRound(createServiceClient(), Date.now() + 60_000);
  });
}

/** ONE closes, on the 25th, the month before of each firm whose checklist is green (0137). */
export async function closingRound(service: SupabaseClient): Promise<SweepReport> {
  const { data, error } = await service.rpc("close_finance_months_by_one");
  if (error) throw new Error("close_finance_months_by_one failed");
  return { closed: typeof data === "number" ? data : 0 };
}

export const moneySweeps: Sweep[] = [
  {
    // The clock's alone, once a day: the database closes only on the 25th and later, never twice.
    key: "finance-closing",
    when: { daily: { hour: 9, minute: 0 } },
    run: (service) => closingRound(service),
  },
  {
    key: "client-money",
    when: { every: 10 },
    whileUsed: true,
    run: (service, until) => moneyRound(service, until),
  },
];
