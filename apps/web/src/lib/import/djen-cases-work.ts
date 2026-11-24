import "server-only";

import { djenClient } from "@/lib/courts/djen";
import { addressedTo } from "@/lib/import/djen-cases";
import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { queueProceedingHistory } from "@/lib/publications/history-work";
import { createServiceClient } from "@flyee/auth/service";
import {
  DjenInvalidQueryError,
  DjenRateLimitedError,
  DjenUnavailableError,
  DjenWindowTooLargeError,
} from "@flyee/courts/providers/djen";
import type { DjenClient } from "@flyee/courts/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the cases ONE opens from the lawsuits the DJEN shows (migration 0287): what is owed is
 * recomputed from the data (`prepare_djen_case_reads`), each lawsuit is claimed under a number, the DJEN is asked for
 * it by its number, and the database opens its case from whom its communications are addressed to
 * (`one_open_djen_case`), or keeps why it did not. Only ids and counts leave this file: never a party's name.
 */

/** A lawsuit the worker holds, with the number of the claim. */
type Held = { readId: string; claim: number; cnj: string };

/**
 *   opened    ONE opened its case;
 *   skipped   ONE left it, with why, on record;
 *   retry     the DJEN did not answer, or limited the calls: tried again later;
 *   not_held  the claim is no longer this worker's.
 */
export type DjenCaseOutcome = "opened" | "skipped" | "retry" | "not_held";

async function claim(service: SupabaseClient, limit: number, orgId: string | null): Promise<Held[]> {
  const { data, error } = await service.rpc("claim_djen_case_reads", { target_limit: limit, target_org: orgId });
  if (error) throw new Error(`claim_djen_case_reads failed: ${error.message}`);
  return ((data ?? []) as { read_id: string; claim: number; cnj: string }[]).map((row) => ({
    readId: row.read_id,
    claim: Number(row.claim),
    cnj: String(row.cnj),
  }));
}

/** Reads one claimed lawsuit at the DJEN and has the database open its case. Never throws for what the DJEN did. */
export async function openClaimedCase(
  service: SupabaseClient,
  client: DjenClient,
  held: Held,
): Promise<DjenCaseOutcome> {
  const record = async (outcome: "retry" | "skipped", code: string): Promise<DjenCaseOutcome> => {
    const { data, error } = await service.rpc("record_djen_case_read", {
      target_read: held.readId,
      target_claim: held.claim,
      target_outcome: outcome,
      target_code: code,
    });
    if (error) throw new Error(`record_djen_case_read failed: ${error.message}`);
    const said = String(((data ?? {}) as { code?: string }).code ?? "");
    return said === "retry" || said === "skipped" ? said : "not_held";
  };

  let listed: Awaited<ReturnType<DjenClient["listByProcess"]>>;
  try {
    listed = await client.listByProcess({ cnj: held.cnj });
  } catch (thrown) {
    if (thrown instanceof DjenWindowTooLargeError) return record("skipped", "djen_too_many");
    if (thrown instanceof DjenInvalidQueryError) return record("skipped", "djen_invalid_number");
    if (thrown instanceof DjenRateLimitedError) return record("retry", "djen_rate_limited");
    if (thrown instanceof DjenUnavailableError) return record("retry", "djen_unavailable");
    console.error("djen_case_failed", {
      readId: held.readId,
      error: thrown instanceof Error ? thrown.name : "unknown",
    });
    return record("retry", "djen_case_failed");
  }

  const { data, error } = await service.rpc("one_open_djen_case", {
    target_read: held.readId,
    target_claim: held.claim,
    target_communications: addressedTo(listed),
  });
  if (error) throw new Error(`one_open_djen_case failed: ${error.message}`);
  const said = String(((data ?? {}) as { code?: string }).code ?? "");
  return said === "opened" || said === "skipped" ? said : "not_held";
}

/** How many lawsuits a round reads: the DJEN takes twenty calls a minute from an address, shared with the capture. */
const PER_ROUND = 8;

/**
 * One round: what is owed is recomputed, then a few lawsuits are read and opened, the oldest first (of one firm, when
 * one is named). A DJEN that limits the calls ends the round; what is left is the next one's.
 */
export async function openDjenCases(
  service: SupabaseClient,
  client: DjenClient,
  until: number,
  orgId: string | null = null,
): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = { opened: 0, skipped: 0, retry: 0, not_held: 0 };
  if (orgId === null) {
    const { error } = await service.rpc("prepare_djen_case_reads");
    if (error) throw new Error(`prepare_djen_case_reads failed: ${error.message}`);
  }
  // One at a time: a DJEN that limits the calls ends the round without leaving the next lawsuits held by it.
  for (let turn = 0; turn < PER_ROUND && Date.now() < until; turn += 1) {
    const [held] = await claim(service, 1, orgId);
    if (!held) break;
    const outcome = await openClaimedCase(service, client, held);
    outcomes[outcome] += 1;
    if (outcome === "retry") break;
  }
  return outcomes;
}

/**
 * A person of a firm that keeps the decision with a person asked ONE to open these cases: a few are read right after
 * the answer, the rest by the sweep; the histories of what was opened follow.
 */
export function queueDjenCases(orgId: string): void {
  soon("djen-cases", async () => {
    const client = djenClient();
    if (!client) return;
    const outcomes = await openDjenCases(createServiceClient(), client, Date.now() + 60_000, orgId);
    if (outcomes.opened > 0) queueProceedingHistory();
  });
}

export const djenCaseSweeps: Sweep[] = [
  /**
   * The lawsuits the DJEN shows of the firms' lawyers that no case of theirs has (0287): ONE reads each at the DJEN
   * and opens its case where the firm leaves that to it. Every fifteen minutes: a portfolio comes in over hours, and
   * the DJEN's calls are shared with the capture and the histories.
   */
  {
    key: "djen-cases",
    when: { every: 15 },
    run: async (service, until) => {
      const client = djenClient();
      if (!client) return { off: true };
      return openDjenCases(service, client, until);
    },
  },
];
