import "server-only";

import type { QueuedFiling } from "@/lib/cases/filing-facts";
import {
  type BatchCandidate,
  type BatchSubmission,
  type BatchView,
  type EligibleGroup,
  eligibleGroups,
  OPEN_BATCH_STATUSES,
  type OpenBatchStatus,
  STOPPED_SHOWN_HOURS,
  type StoppedBatch,
  STOPS_ASKED,
  unchosenGroups,
} from "@/lib/filing-ways/batches";
import { loadFilingWays } from "@/lib/filing-ways/read";
import type { MemberContext } from "@/lib/member/context";

export type FilingBatchesState = {
  viewerId: string;
  /** The pulse the screen was drawn with (`readBatchesPulse`): the batches in course by state and last change. */
  pulse: string;
  batches: BatchView[];
  /** The batches ONE's browser or a lawyer's extension stopped lately, each with why (a person's own stop is not said). */
  stopped: StoppedBatch[];
  eligible: EligibleGroup[];
  /** The packages ready ONE could file for the person where they never chose a way, by system. */
  unchosen: { system: { key: string; name: string }; count: number }[];
};

const BATCHES_SHOWN = 20;
const STOPPED_SHOWN = 5;

/**
 * What /protocolo shows of the batches (migration 0264), with the person's own session: the firm's batches in course
 * with their filings, and the packages ready that the person may hand ONE, by system. Null when a read failed: the
 * screen says it could not read, never that nothing waits.
 */
export async function loadFilingBatches(
  context: MemberContext,
  queue: readonly QueuedFiling[],
): Promise<FilingBatchesState | null> {
  const firm = context.firm;
  if (!firm) return null;
  const ways = await loadFilingWays(context);
  if (!ways) return null;

  const since = new Date(Date.now() - STOPPED_SHOWN_HOURS * 3_600_000).toISOString();
  const [batches, team, stoppedRows] = await Promise.all([
    context.supabase
      .from("filing_batches")
      .select("id, person_id, system_key, way, status, code_kind, updated_at")
      .eq("org_id", firm.id)
      .in("status", [...OPEN_BATCH_STATUSES])
      .order("approved_at", { ascending: true })
      .limit(BATCHES_SHOWN),
    context.supabase.rpc("firm_team", { target_org: firm.id }),
    context.supabase
      .from("filing_batches")
      .select("id, person_id, system_key, way, error, finished_at")
      .eq("org_id", firm.id)
      .eq("status", "stopped")
      .gte("finished_at", since)
      .not("error", "in", `(${STOPS_ASKED.join(",")})`)
      .order("finished_at", { ascending: false })
      .limit(STOPPED_SHOWN),
  ]);
  if (batches.error || team.error || stoppedRows.error) return null;

  const batchRows = (batches.data ?? []) as {
    id: string;
    person_id: string | null;
    system_key: string;
    way: string;
    status: string;
    code_kind: string | null;
    updated_at: string;
  }[];
  const ids = batchRows.map((row) => row.id);
  const submissions = ids.length
    ? await context.supabase
        .from("filing_submissions")
        .select("id, batch_id, package_id, case_id, status, summary_file_id")
        .in("batch_id", ids)
    : { data: [], error: null };
  if (submissions.error) return null;

  const names = new Map(
    ((team.data ?? []) as { user_id: string; display_name: string | null; email: string | null }[]).map((row) => [
      row.user_id,
      row.display_name?.trim() || row.email?.split("@")[0] || "",
    ]),
  );
  const systemName = new Map(ways.systems.map((system) => [system.key, system.name]));
  const byBatch = new Map<string, BatchSubmission[]>();
  for (const row of (submissions.data ?? []) as {
    id: string;
    batch_id: string;
    package_id: string;
    case_id: string;
    status: string;
    summary_file_id: string | null;
  }[]) {
    const list = byBatch.get(row.batch_id) ?? [];
    list.push({
      id: row.id,
      packageId: row.package_id,
      caseId: row.case_id,
      status: row.status,
      summaryFileId: row.summary_file_id,
    });
    byBatch.set(row.batch_id, list);
  }
  const views: BatchView[] = batchRows.flatMap((row): BatchView[] => {
    if (!(OPEN_BATCH_STATUSES as readonly string[]).includes(row.status)) return [];
    if (row.way !== "browser" && row.way !== "extension") return [];
    return [
      {
        id: row.id,
        systemKey: row.system_key,
        systemName: systemName.get(row.system_key) ?? row.system_key,
        way: row.way,
        status: row.status as OpenBatchStatus,
        personId: row.person_id,
        personName: row.person_id ? (names.get(row.person_id) ?? "") : "",
        codeKind: row.code_kind === "app" || row.code_kind === "email" ? row.code_kind : null,
        submissions: byBatch.get(row.id) ?? [],
      },
    ];
  });

  // The packages ready, kept by nothing, and what the person may hand ONE of them.
  const ready = queue.filter((row) => row.status === "ready" && row.blocker === null);
  let eligible: EligibleGroup[] = [];
  let unchosen: FilingBatchesState["unchosen"] = [];
  if (ways.lawyer && ready.length > 0) {
    const packageIds = ready.map((row) => row.id);
    const [packages, existing, cases] = await Promise.all([
      context.supabase.from("filing_packages").select("id, proceeding_id").in("id", packageIds),
      context.supabase.from("filing_submissions").select("package_id").in("package_id", packageIds),
      // A test case is filed by the test court, never on a court's screen (0267).
      context.supabase
        .from("cases")
        .select("id, is_test")
        .in("id", [...new Set(ready.map((row) => row.caseId))]),
    ]);
    if (packages.error || existing.error || cases.error) return null;
    const testCases = new Set(
      ((cases.data ?? []) as { id: string; is_test: boolean }[]).filter((row) => row.is_test).map((row) => row.id),
    );
    const proceedingOf = new Map(
      ((packages.data ?? []) as { id: string; proceeding_id: string }[]).map((row) => [row.id, row.proceeding_id]),
    );
    const signs = await context.supabase
      .from("proceeding_lawyers")
      .select("proceeding_id")
      .eq("user_id", context.userId)
      .in("proceeding_id", [...new Set(proceedingOf.values())]);
    if (signs.error) return null;
    const candidates: BatchCandidate[] = ready.flatMap((row): BatchCandidate[] => {
      const proceedingId = proceedingOf.get(row.id);
      return proceedingId && !testCases.has(row.caseId)
        ? [
            {
              id: row.id,
              caseId: row.caseId,
              caseSeq: row.caseSeq,
              client: row.client,
              court: row.court,
              system: row.system,
              status: row.status,
              blocker: row.blocker,
              proceedingId,
            },
          ]
        : [];
    });
    const input = {
      candidates,
      ways,
      signs: new Set(((signs.data ?? []) as { proceeding_id: string }[]).map((row) => row.proceeding_id)),
      submitted: new Set(((existing.data ?? []) as { package_id: string }[]).map((row) => row.package_id)),
    };
    eligible = eligibleGroups(input);
    unchosen = unchosenGroups(input).map((group) => ({
      system: { key: group.system.key, name: group.system.name },
      count: group.count,
    }));
  }

  const pulse = [...batchRows]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((row) => `${row.id}:${row.status}:${row.updated_at}`)
    .join("|");
  const stopped: StoppedBatch[] = (
    (stoppedRows.data ?? []) as {
      id: string;
      person_id: string | null;
      system_key: string;
      way: string;
      error: string | null;
      finished_at: string | null;
    }[]
  ).flatMap((row): StoppedBatch[] =>
    (row.way === "browser" || row.way === "extension") && row.error && row.finished_at
      ? [
          {
            id: row.id,
            systemName: systemName.get(row.system_key) ?? row.system_key,
            way: row.way,
            personId: row.person_id,
            why: row.error,
            finishedAt: row.finished_at,
          },
        ]
      : [],
  );

  return { viewerId: context.userId, pulse, batches: views, stopped, eligible, unchosen };
}
