import "server-only";

import { countInput, type DeadlineToCount } from "@/lib/deadlines/deadlines";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { computeDeadline } from "@flyee/rules/deadlines";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a deadline (migration 0034): claim the deadlines
 * whose count is not of their revision in force, read what each is counted
 * from (`deadline_to_count`: the inputs, where the lawsuit is and its
 * court's calendar), count it with the rule (`@flyee/rules/deadlines`) and
 * record the answer for the revision read. A person never writes a count:
 * the database takes it from here only, and a count of a revision that
 * changed meanwhile is dropped by it. Nothing of a person is in a count.
 */

export type CountReport = {
  claimed: number;
  counted: number;
  failed: number;
  retried: number;
  changed: number;
  /** Claims given back unfinished: what the count reads, or its answer, could not be read or written. */
  released: number;
};

type Claim = { deadline_id: string; claim: number };

async function record(
  service: SupabaseClient,
  read: { id: string; claim: number; revision: number },
  outcome: "counted" | "retry" | "failed",
  result: object | null,
  code: string | null,
): Promise<string> {
  const { data, error } = await service.rpc("record_deadline_count", {
    target_deadline: read.id,
    target_claim: read.claim,
    target_revision: read.revision,
    target_outcome: outcome,
    target_result: result,
    target_code: code,
  });
  if (error) throw new Error(`record_deadline_count failed: ${error.code ?? "unknown"}`);
  return String((data as { code?: string } | null)?.code ?? "");
}

/** Counts one claimed deadline and records the answer: the database's word on it, or null when nothing was read. */
async function countOne(service: SupabaseClient, claim: Claim): Promise<string | null> {
  const { data: read, error: readError } = await service.rpc("deadline_to_count", {
    target_deadline: claim.deadline_id,
    target_claim: claim.claim,
  });
  if (readError) throw new Error(`deadline_to_count failed: ${readError.code ?? "unknown"}`);
  // Nothing to read: the claim is no longer this worker's.
  if (!read) return null;
  const toCount = read as DeadlineToCount;
  const target = { id: claim.deadline_id, claim: claim.claim, revision: toCount.revision };
  const input = countInput(toCount);
  const outcome = input ? computeDeadline(input) : ({ ok: false, code: "invalid_input" } as const);
  if (!outcome.ok) return record(service, target, "failed", null, outcome.code);
  const place = {
    court: toCount.court,
    proceedingKind: toCount.place?.proceeding_kind ?? null,
    system: toCount.place?.system ?? null,
    comarca: toCount.place?.comarca ?? null,
  };
  return record(service, target, "counted", { ...outcome.result, place }, null);
}

/**
 * Claims what is owed (or the one deadline named) and counts it. A deadline
 * the rule refuses to count is final for its revision, and a person
 * confirms a day of their own or corrects what it is counted from. A claim
 * whose reading or recording failed is given back at once
 * (`release_deadline_count`), so the next try waits only its pause, never
 * the claim's clock; each try is spent, and a deadline that keeps failing
 * waits for a person.
 */
export async function countDeadlines(
  service: SupabaseClient,
  options: { limit?: number; deadlineId?: string | null } = {},
): Promise<CountReport> {
  const report: CountReport = { claimed: 0, counted: 0, failed: 0, retried: 0, changed: 0, released: 0 };
  const { data: claims, error } = await service.rpc("claim_deadline_counts", {
    target_limit: options.limit ?? 20,
    target_deadline: options.deadlineId ?? null,
  });
  if (error) throw new Error(`claim_deadline_counts failed: ${error.code ?? "unknown"}`);
  for (const claim of (claims ?? []) as Claim[]) {
    report.claimed += 1;
    let answer: string | null;
    try {
      answer = await countOne(service, claim);
    } catch {
      // What failed is the platform's (a read, a write), never the deadline's: the claim goes back with a word.
      await service
        .rpc("release_deadline_count", {
          target_deadline: claim.deadline_id,
          target_claim: claim.claim,
          target_code: "unfinished",
        })
        .then(
          () => undefined,
          () => undefined,
        );
      report.released += 1;
      continue;
    }
    if (answer === null) continue;
    if (answer === "counted") report.counted += 1;
    else if (answer === "changed") report.changed += 1;
    else if (answer === "retry") report.retried += 1;
    else report.failed += 1;
  }
  return report;
}

/**
 * Counts a deadline a person just wrote, before they are answered, so the
 * screen shows its day at once. When that did not happen now (another
 * worker holds it, it changed while it was counted, or the count could not
 * be made), it is tried again right after the answer; the sweep would reach
 * it anyway.
 */
export async function settleDeadlineCount(deadlineId: string): Promise<void> {
  try {
    const report = await countDeadlines(createServiceClient(), { limit: 1, deadlineId });
    if (report.counted + report.failed > 0) return;
  } catch {
    // Tried again below.
  }
  soon("deadline-count", () => countDeadlines(createServiceClient(), { limit: 1, deadlineId }));
}

/** The court's calendar changed: the open deadlines whose count goes through it are counted right after. */
export function settleDeadlineCounts(): void {
  soon("deadline-counts", () => countDeadlines(createServiceClient(), { limit: 100 }));
}
