import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { type CourseStatus, isCourseStatus } from "@/lib/courts/course";
import { aggregatorSource, projudiSource } from "@/lib/courts/tracking";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the case screen reads of the course of its lawsuits (migration 0031),
 * under the person's own session: how each one's reading stands, what the
 * court shows of it, and its latest movements, the ones the firm did not see
 * yet marked. A read that fails throws.
 */

/** How many of a lawsuit's movements the screen reads, the latest first. */
export const MOVEMENTS_SHOWN = 30;

export type CourseMovement = {
  id: string;
  atLabel: string;
  title: string;
  detail: string | null;
  by: string | null;
  /** Learned after the firm last said it saw what the court did. */
  fresh: boolean;
};

export type CoursePending = {
  kind: string;
  title: string;
  status: string | null;
  endLabel: string | null;
  startLabel: string | null;
};

export type CourseView = {
  status: CourseStatus;
  /** Who reads it: TJGO's Projudi, the aggregator, or the test court of a test case (0061), which no switch turns off. */
  source: "projudi" | "aggregator" | "teste";
  /** The aggregator that read it, by its name, when one did. */
  vendor: string | null;
  readLabel: string | null;
  /** When the source last answered for it, whatever it said. */
  checkedLabel: string | null;
  /** A person asked for a reading the source has not answered yet. */
  asked: boolean;
  /** When ONE starts over a reading that stopped (0119), while it is paused. */
  retryLabel: string | null;
  error: string | null;
  unit: string | null;
  courtStatus: string | null;
  phase: string | null;
  judge: string | null;
  pending: CoursePending[];
  lawyers: { name: string; oab: string | null; party: string | null }[];
  movementsCount: number;
  unseen: number;
  movements: CourseMovement[];
};

export type CourseFacts = {
  byProceeding: Record<string, CourseView>;
  /** This environment reads the courts (TJGO's Projudi), and has an aggregator for the others. */
  courtsOn: boolean;
  aggregatorOn: boolean;
};

type TrackingRow = {
  proceeding_id: string;
  source: string;
  status: string;
  snapshot: Record<string, unknown> | null;
  movements_count: number;
  unseen_count: number;
  read_at: string | null;
  checked_at: string | null;
  vendor: string | null;
  seen_until: string | null;
  requested_at: string | null;
  work_error: string | null;
  retry_at: string | null;
};

type MovementRow = {
  id: string;
  proceeding_id: string;
  occurred_at: string;
  title: string;
  detail: string | null;
  by_name: string | null;
  learned_at: string;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];

export async function loadCourseFacts(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  timeZone: string | null | undefined,
): Promise<CourseFacts> {
  const tracking = await supabase
    .from("proceeding_tracking")
    .select(
      "proceeding_id, source, status, snapshot, vendor, movements_count, unseen_count, read_at, checked_at, seen_until, requested_at, work_error, retry_at",
    )
    .eq("org_id", firmId)
    .eq("case_id", caseId);
  if (tracking.error) throw new Error("the course of the lawsuits could not be read");
  const rows = (tracking.data ?? []) as TrackingRow[];
  // Each lawsuit's latest movements, read on their own: a case has a lawsuit or two.
  const reads = await Promise.all(
    rows.map((row) =>
      supabase
        .from("movements")
        .select("id, proceeding_id, occurred_at, title, detail, by_name, learned_at")
        .eq("org_id", firmId)
        .eq("proceeding_id", row.proceeding_id)
        .order("occurred_at", { ascending: false })
        .limit(MOVEMENTS_SHOWN),
    ),
  );
  if (reads.some((read) => read.error)) throw new Error("the course of the lawsuits could not be read");
  const moved = reads.flatMap((read) => (read.data ?? []) as MovementRow[]);

  const byProceeding: Record<string, CourseView> = {};
  for (const row of rows) {
    if (
      !isCourseStatus(row.status) ||
      (row.source !== "projudi" && row.source !== "aggregator" && row.source !== "teste")
    ) {
      continue;
    }
    const snapshot = row.snapshot ?? {};
    const seen = row.seen_until ? Date.parse(row.seen_until) : null;
    const label = (instant: string | null) => (instant ? momentLabel(instant, timeZone) : null);
    byProceeding[row.proceeding_id] = {
      status: row.status,
      source: row.source,
      vendor: row.source === "aggregator" ? (row.vendor ?? text(snapshot.vendor)) : null,
      readLabel: label(row.read_at),
      checkedLabel: label(row.checked_at),
      // A request the source has not answered yet; one given up is answered (the reading failed, or paused).
      asked:
        row.status !== "failed" &&
        row.status !== "paused" &&
        Boolean(row.requested_at && (!row.checked_at || Date.parse(row.requested_at) > Date.parse(row.checked_at))),
      retryLabel: row.status === "paused" ? label(row.retry_at) : null,
      error: row.work_error,
      unit: text(snapshot.unit),
      courtStatus: text(snapshot.status),
      phase: text(snapshot.phase),
      judge: text(list(snapshot.responsibles).find((person) => /juiz/i.test(text(person.role) ?? ""))?.name),
      pending: list(snapshot.pending)
        .map((entry) => ({
          kind: text(entry.kind) ?? "pendency",
          title: text(entry.title) ?? "",
          status: text(entry.status),
          startLabel: label(text(entry.start)),
          endLabel: label(text(entry.end)),
        }))
        .filter((entry) => entry.title),
      lawyers: list(snapshot.lawyers)
        .map((lawyer) => ({ name: text(lawyer.name) ?? "", oab: text(lawyer.oab), party: text(lawyer.party) }))
        .filter((lawyer) => lawyer.name),
      movementsCount: row.movements_count,
      unseen: row.unseen_count,
      movements: moved
        .filter((movement) => movement.proceeding_id === row.proceeding_id)
        .map((movement) => ({
          id: movement.id,
          atLabel: momentLabel(movement.occurred_at, timeZone),
          title: movement.title,
          detail: movement.detail,
          by: movement.by_name,
          fresh: row.unseen_count > 0 && seen !== null && Date.parse(movement.learned_at) > seen,
        })),
    };
  }
  return { byProceeding, courtsOn: projudiSource() !== null, aggregatorOn: aggregatorSource() !== null };
}
