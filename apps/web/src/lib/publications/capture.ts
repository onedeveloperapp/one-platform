import "server-only";

import { djenClient } from "@/lib/courts/djen";
import { soon } from "@/lib/jobs/soon";
import { addDays, chunkItems, isDay, nextWindow, toCaptureItem } from "@/lib/publications/publications";
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
 * The backend's reading of the DJEN for the registrations at the bar held by
 * the people of a firm (migration 0028). A registration due is claimed under
 * a number; who holds the claim asks the database what to read (from which
 * day through which), reads a few days at a time and hands each day's
 * communications over, so what was read is kept even when the reading stops
 * halfway, and goes on from there. The database is the one clock and the one
 * memory of a reading: nothing here remembers a day.
 *
 * A listing is whole or it is an error: days that hold more than one listing
 * reads (more than a search gives, or than the calls and the time of one
 * turn) are asked again in fewer days, down to one; and a registration is
 * said to be read only when the reading reached the day it was to reach.
 * What the database could not keep of what was read is counted and kept with
 * the reading, for the firm to see. Only ids and counts leave this file.
 */

/** Who is read is recomputed from the data: what a sweep does before it claims anything. */
export async function prepareDjenCaptures(service: SupabaseClient): Promise<void> {
  const { error } = await service.rpc("prepare_djen_captures");
  if (error) throw new Error(`prepare_djen_captures failed: ${error.message}`);
}

/** A capture the sweep holds, with the number of the claim. */
export type CaptureClaim = { captureId: string; claim: number };

export async function claimDjenCaptures(
  service: SupabaseClient,
  limit = 1,
  captureId: string | null = null,
  orgId: string | null = null,
): Promise<CaptureClaim[]> {
  const { data, error } = await service.rpc("claim_djen_captures", {
    target_limit: limit,
    target_capture: captureId,
    target_org: orgId,
  });
  if (error) throw new Error(`claim_djen_captures failed: ${error.message}`);
  return ((data ?? []) as { capture_id: string; claim: number }[]).map((row) => ({
    captureId: row.capture_id,
    claim: Number(row.claim),
  }));
}

type CaptureToRead = {
  capture_id: string;
  claim: number;
  uf: string;
  number: string;
  since: string;
  through: string;
  window_days: number;
};

/**
 *   done      the reading reached today;
 *   paused    this turn ended with days still to read: it goes on at the next;
 *   retry     a passing failure (the DJEN limited the calls, or did not answer): tried again after a wait;
 *   failed    this round is over (the attempts are spent, or one day holds more than a search gives);
 *   not_held  the claim is no longer this worker's.
 */
export type CaptureOutcome = "done" | "paused" | "retry" | "failed" | "not_held";

/**
 * How long one turn reads before it hands the rest to the next. A step has
 * five minutes at most, and the last listing a turn starts may itself take
 * more than two of them (the waits for the window of calls, then keeping
 * what it read): so a turn starts no listing after its first minute.
 */
const TURN_MS = 60_000;

/**
 * Reads the DJEN for a claimed registration and records what came of it.
 * Never throws for what the DJEN did.
 */
export async function captureClaimed(
  service: SupabaseClient,
  client: DjenClient,
  held: CaptureClaim,
  options: { now?: () => number; turnMs?: number } = {},
): Promise<CaptureOutcome> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.turnMs ?? TURN_MS);

  const { data, error } = await service.rpc("djen_capture_to_read", {
    target_capture: held.captureId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`djen_capture_to_read failed: ${error.message}`);
  const row = ((data ?? []) as CaptureToRead[])[0];
  if (!row) return "not_held";

  let leftOut = 0;
  const record = async (
    outcome: "partial" | "done" | "paused" | "retry" | "failed",
    input: { items?: unknown[]; code?: string; through?: string | null } = {},
  ): Promise<string> => {
    const { data: recorded, error: recordError } = await service.rpc("record_djen_capture", {
      target_capture: row.capture_id,
      target_claim: row.claim,
      target_outcome: outcome,
      target_items: input.items ?? [],
      target_code: input.code ?? null,
      target_through: input.through ?? null,
    });
    if (recordError) throw new Error(`record_djen_capture failed: ${recordError.message}`);
    const answer = (recorded ?? {}) as { code?: string; skipped?: number };
    if (outcome === "partial") leftOut += Number(answer.skipped ?? 0);
    else if (outcome === "done") leftOut = Number(answer.skipped ?? 0);
    return String(answer.code ?? "");
  };
  /** What the database answered, as an outcome: it is the one that knows whether a retry was the last. */
  const said = (code: string): CaptureOutcome => {
    // A communication addressed to the registration that could not be kept is said aloud to who runs the
    // platform, by its count alone: the firm sees the same count beside its reading.
    if (leftOut > 0) console.warn("djen_capture_left_out", { captureId: row.capture_id, communications: leftOut });
    return code === "done" || code === "paused" || code === "retry" || code === "failed" ? code : "not_held";
  };

  let from = String(row.since).slice(0, 10);
  const through = String(row.through).slice(0, 10);
  // Days that are not days read nothing: never said as a reading that reached its end.
  if (!isDay(from) || !isDay(through)) return said(await record("failed", { code: "capture_failed" }));
  let span = Math.max(Number(row.window_days) || 1, 1);
  /** A search the API refused was asked again for one day alone, once: it may have been the days it would not give. */
  let narrowed = false;

  for (;;) {
    const window = nextWindow(from, through, span);
    // Nothing left to read (a reading that had reached today already): the round is over.
    if (!window) return said(await record("done", { through }));

    let listed: Awaited<ReturnType<DjenClient["listByOab"]>>;
    try {
      listed = await client.listByOab({ uf: row.uf, number: row.number, since: window.since, until: window.until });
    } catch (thrown) {
      if (thrown instanceof DjenWindowTooLargeError) {
        if (window.since === window.until) {
          // One day that holds more than a listing reads is beyond what the public API gives one address.
          // The days before it were read: the reading stays at this day, and says which.
          const stopped = await record("partial", { through: addDays(window.since, -1) });
          if (stopped !== "partial") return "not_held";
          return said(await record("failed", { code: "djen_too_many" }));
        }
        // More than one listing reads: fewer days hold fewer.
        span = Math.max(Math.floor(span / 2), 1);
        continue;
      }
      // A registration the DJEN cannot be asked for is not one that had nothing published: the round fails,
      // and the firm reads why.
      if (thrown instanceof DjenInvalidQueryError) {
        return said(await record("failed", { code: "djen_invalid_registration" }));
      }
      if (thrown instanceof DjenRateLimitedError) return said(await record("retry", { code: "djen_rate_limited" }));
      if (thrown instanceof DjenUnavailableError) {
        // The API answers what it refuses with the words of an outage. Before giving the try up, the same
        // start is asked for one day alone: if that is read, it was the days.
        if (thrown.status !== null && span > 1 && !narrowed) {
          narrowed = true;
          span = 1;
          continue;
        }
        return said(await record("retry", { code: "djen_unavailable" }));
      }
      // Anything else is a fault of this code: said aloud to who runs the platform, and tried again like the rest.
      console.error("djen_capture_failed", {
        captureId: row.capture_id,
        error: thrown instanceof Error ? thrown.name : "unknown",
      });
      return said(await record("retry", { code: "capture_failed" }));
    }

    // A day's communications go in as many calls as their size asks; only the last one says the days are read.
    const chunks = chunkItems(listed.map(toCaptureItem));
    for (const [index, items] of chunks.entries()) {
      const closes = index === chunks.length - 1;
      const answer = await record(closes && window.last ? "done" : "partial", {
        items,
        through: closes ? window.until : null,
      });
      if (answer === "done") return said("done");
      if (answer !== "partial") return "not_held";
    }

    from = addDays(window.until, 1);
    if (now() > deadline) return said(await record("paused"));
  }
}

/**
 * Claims the registration that waits the longest (of one firm, when one is
 * named) and reads it: one piece of work, so a claim is never held while
 * its worker waits in a line for its turn. `none` when nothing is due.
 */
export async function captureNext(
  service: SupabaseClient,
  client: DjenClient,
  orgId: string | null = null,
  options: { now?: () => number; turnMs?: number } = {},
): Promise<CaptureOutcome | "none"> {
  const held = (await claimDjenCaptures(service, 1, null, orgId))[0];
  return held ? captureClaimed(service, client, held, options) : "none";
}

/** How many registrations a reading asked for by a person takes right after the answer. */
const INLINE_CAPTURES = 6;

/**
 * A person of the firm asked for a reading now: the firm's registrations are
 * read right after the response is sent, a few at most; the rest stays owed
 * to the sweep.
 */
export async function queueFirmCapture(orgId: string): Promise<void> {
  soon("djen-capture", async () => {
    const client = djenClient();
    if (!client) return;
    const service = createServiceClient();
    for (let turn = 0; turn < INLINE_CAPTURES; turn += 1) {
      const outcome = await captureNext(service, client, orgId);
      // Nothing left, or the DJEN limited the calls: insisting with the next registration would only
      // spend its attempts.
      if (outcome === "none" || outcome === "retry") return;
    }
  });
}
