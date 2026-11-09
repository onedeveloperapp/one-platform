import "server-only";

import { failureCode, inProjudiHours, movementsOf, snapshotOf } from "@/lib/courts/course";
import { type TrackingSources, trackingSources } from "@/lib/courts/tracking";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { AggregatorAuthError, AggregatorNoCreditError } from "@flyee/courts/providers/aggregator-http";
import type { ProceedingRead } from "@flyee/courts/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the course of the lawsuits (migration 0031): claim
 * one reading owed, read the lawsuit from its source by its number, and
 * record what came of it under the claim. One at a time, claimed and read in
 * the same piece of work, as the DJEN's reading is. A person's request goes
 * first; the routine readings of TJGO's Projudi go in the hours the setting
 * gives. A refused key or a balance run out at the aggregator stops the run:
 * the next lawsuit would only meet the same. Nothing of a person is sent to a
 * source: a lawsuit's number is all it is asked.
 */

export type CourseOutcome =
  | "read"
  | "secret"
  | "not_found"
  | "retry"
  | "release"
  | "paused"
  | "failed"
  | "not_held"
  | "stopped";

type Claimed = {
  tracking_id: string;
  claim: number;
  cnj: string;
  source: "projudi" | "aggregator";
  first_read: boolean;
};

/** The hours of the routine readings of Projudi, from the setting. */
export async function projudiHoursNow(service: SupabaseClient, now: number = Date.now()): Promise<boolean> {
  const { data } = await service.from("platform_settings").select("value").eq("key", "tracking").maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const hour = (raw: unknown, fallback: number) => {
    const number = Number(raw);
    return Number.isInteger(number) && number >= 0 && number <= 23 ? number : fallback;
  };
  return inProjudiHours(now, hour(value.projudi_from_hour, 22), hour(value.projudi_to_hour, 6));
}

/**
 * Claims the next reading owed from the sources at hand (only a person's request when `requestedOnly`, or
 * the one named) and reads it. `none` when nothing is due.
 */
export async function readNext(
  service: SupabaseClient,
  sources: TrackingSources,
  options: { requestedOnly?: boolean; trackingId?: string | null } = {},
): Promise<CourseOutcome | "none"> {
  const names = (Object.keys(sources) as (keyof TrackingSources)[]).filter((name) => sources[name] !== null);
  if (names.length === 0) return "none";
  const { data, error } = await service.rpc("claim_proceeding_reads", {
    target_sources: names,
    target_limit: 1,
    target_requested_only: options.requestedOnly ?? false,
    target_tracking: options.trackingId ?? null,
  });
  if (error) throw new Error("readings could not be claimed");
  const held = ((data ?? []) as Claimed[])[0];
  if (!held) return "none";
  const source = sources[held.source];

  const record = async (outcome: string, extra: Record<string, unknown> = {}): Promise<CourseOutcome> => {
    const { data: answered, error: failed } = await service.rpc("record_proceeding_read", {
      target_tracking: held.tracking_id,
      target_claim: held.claim,
      target_outcome: outcome,
      ...extra,
    });
    if (failed) throw new Error("a reading could not be recorded");
    const answer = (answered ?? {}) as { ok?: boolean; code?: string };
    if (answer.ok) return (answer.code as CourseOutcome) ?? "failed";
    // What the source answered cannot be kept as it is: given up, saying so, instead of a claim left held.
    if (answer.code === "invalid_data" && outcome !== "failed")
      return record("failed", { target_code: "invalid_data" });
    return "not_held";
  };

  // Claimed for a source that went away meanwhile: given back for later.
  if (!source) return record("retry", { target_code: "source_off" });
  let read: ProceedingRead;
  try {
    read = await source.read(held.cnj);
  } catch (readError) {
    // A key refused, or a balance run out: the platform's to fix, never the lawsuit's, whose attempt is given back.
    if (readError instanceof AggregatorAuthError || readError instanceof AggregatorNoCreditError) {
      await record("release", { target_code: failureCode(readError) });
      return "stopped";
    }
    return record("retry", { target_code: failureCode(readError) });
  }
  if (!read.found) return record("not_found");
  const snapshot = snapshotOf(read.proceeding, source.name);
  const vendor = source.name;
  if (read.proceeding.secret) return record("secret", { target_snapshot: snapshot, target_vendor: vendor });
  return record("read", {
    target_snapshot: snapshot,
    target_movements: movementsOf(read.movements),
    target_vendor: vendor,
  });
}

/**
 * A person asked for a lawsuit to be read now: it is read right after the response is sent. The sweep takes it
 * when that did not finish.
 */
export async function queueProceedingRead(trackingId: string): Promise<void> {
  soon("proceeding-read", () =>
    readNext(createServiceClient(), trackingSources(), { requestedOnly: true, trackingId }),
  );
}
