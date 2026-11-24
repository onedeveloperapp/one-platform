import "server-only";

import { djenClient } from "@/lib/courts/djen";
import { soon } from "@/lib/jobs/soon";
import { chunkItems, toCaptureItem } from "@/lib/publications/publications";
import { queuePublicationTriage } from "@/lib/publications/triage-work";
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
 * The backend's reading of the history of a lawsuit filed before its case was in ONE (migration 0286): the DJEN is
 * asked by the lawsuit's number, once, and every communication it has of it is handed to the database, which keeps
 * each as a publication of the lawsuit marked as of its history (`record_proceeding_history`). ONE then triages and
 * reads them as any other, and the database settles what had already passed. Only ids and counts leave this file.
 */

/** A history the worker holds, with the number of the claim and the lawsuit's number. */
export type HistoryClaim = { readId: string; claim: number; cnj: string };

/**
 *   done      the history was read and kept;
 *   retry     a passing failure (the DJEN limited the calls, or did not answer): tried again after a wait;
 *   failed    it cannot be read (its attempts spent, or more than one listing reads);
 *   not_held  the claim is no longer this worker's.
 */
export type HistoryOutcome = "done" | "retry" | "failed" | "not_held";

export async function claimProceedingHistories(
  service: SupabaseClient,
  limit = 1,
  readId: string | null = null,
): Promise<HistoryClaim[]> {
  const { data, error } = await service.rpc("claim_proceeding_history_reads", {
    target_limit: limit,
    target_read: readId,
  });
  if (error) throw new Error(`claim_proceeding_history_reads failed: ${error.message}`);
  return ((data ?? []) as { read_id: string; claim: number; cnj: string }[]).map((row) => ({
    readId: row.read_id,
    claim: Number(row.claim),
    cnj: String(row.cnj),
  }));
}

/** Reads the DJEN for a claimed history and records what came of it. Never throws for what the DJEN did. */
export async function readClaimedHistory(
  service: SupabaseClient,
  client: DjenClient,
  held: HistoryClaim,
): Promise<HistoryOutcome> {
  const record = async (
    outcome: "partial" | "done" | "retry" | "failed",
    input: { items?: unknown[]; code?: string } = {},
  ): Promise<string> => {
    const { data, error } = await service.rpc("record_proceeding_history", {
      target_read: held.readId,
      target_claim: held.claim,
      target_outcome: outcome,
      target_items: input.items ?? [],
      target_code: input.code ?? null,
    });
    if (error) throw new Error(`record_proceeding_history failed: ${error.message}`);
    return String(((data ?? {}) as { code?: string }).code ?? "");
  };
  const said = (code: string): HistoryOutcome =>
    code === "done" || code === "retry" || code === "failed" ? code : "not_held";

  let listed: Awaited<ReturnType<DjenClient["listByProcess"]>>;
  try {
    listed = await client.listByProcess({ cnj: held.cnj });
  } catch (thrown) {
    // A lawsuit with more communications than one listing reads, or a number the DJEN cannot be asked for, is not one
    // with nothing published: the reading fails, and the case says so.
    if (thrown instanceof DjenWindowTooLargeError) return said(await record("failed", { code: "djen_too_many" }));
    if (thrown instanceof DjenInvalidQueryError) return said(await record("failed", { code: "djen_invalid_number" }));
    if (thrown instanceof DjenRateLimitedError) return said(await record("retry", { code: "djen_rate_limited" }));
    if (thrown instanceof DjenUnavailableError) return said(await record("retry", { code: "djen_unavailable" }));
    // Anything else is a fault of this code: said aloud to who runs the platform, and tried again like the rest.
    console.error("djen_history_failed", {
      readId: held.readId,
      error: thrown instanceof Error ? thrown.name : "unknown",
    });
    return said(await record("retry", { code: "history_failed" }));
  }

  // A long history goes in as many calls as its size asks; only the last one says the reading is over.
  const chunks = listed.length > 0 ? chunkItems(listed.map(toCaptureItem)) : [[]];
  for (const [index, items] of chunks.entries()) {
    const last = index === chunks.length - 1;
    const answer = await record(last ? "done" : "partial", { items });
    if (last) return said(answer);
    if (answer !== "partial") return "not_held";
  }
  return "not_held";
}

/** Claims the history that waits the longest (one named, when one is) and reads it. `none` when nothing is due. */
export async function readHistoryNext(
  service: SupabaseClient,
  client: DjenClient,
  readId: string | null = null,
): Promise<HistoryOutcome | "none"> {
  const held = (await claimProceedingHistories(service, 1, readId))[0];
  return held ? readClaimedHistory(service, client, held) : "none";
}

/** How many histories the work right after a person's answer reads, at most. */
const INLINE_HISTORIES = 2;

/**
 * A lawyer attached the receipt of a lawsuit filed before its case was in ONE, or asked its history again: what the
 * DJEN has of it is read right after the response is sent, and ONE's triage follows; the rest stays owed to the sweep.
 */
export function queueProceedingHistory(): void {
  soon("djen-history", async () => {
    const client = djenClient();
    if (!client) return;
    const service = createServiceClient();
    let read = false;
    for (let turn = 0; turn < INLINE_HISTORIES; turn += 1) {
      const outcome = await readHistoryNext(service, client);
      if (outcome === "none" || outcome === "retry") break;
      read = read || outcome === "done";
    }
    if (read) await queuePublicationTriage();
  });
}
