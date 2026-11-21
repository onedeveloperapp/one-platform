import { type FilingWaysData, type ScreenSystem, type Way, wayInForce, waysOffered } from "@/lib/filing-ways/ways";

/**
 * The batches a lawyer approves on /protocolo (the owner, 2026-11-20; migration 0264) as the screen shows them: the
 * packages ready that ONE may file on a court's screen for the person reading, by system, and where each batch in
 * course stands, with whose turn it is. Pure: the screen and its tests read it.
 */

/** A package of the queue, as much as the batches need of it. */
export type BatchCandidate = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  client: string;
  court: string;
  system: string;
  status: string;
  blocker: string | null;
  proceedingId: string;
};

export type EligibleGroup = {
  system: ScreenSystem;
  way: Exclude<Way, "hand">;
  packages: BatchCandidate[];
};

type BatchInput = {
  candidates: readonly BatchCandidate[];
  ways: Pick<FilingWaysData, "systems" | "myWays" | "firmWay">;
  /** The lawsuits the person signs. */
  signs: ReadonlySet<string>;
  /** The packages already in a submission (a batch, ONE's channel, or filed). */
  submitted: ReadonlySet<string>;
};

/** The packages ready the person may file now, each with the screen system it goes to. */
function readyOfMine(input: BatchInput): { row: BatchCandidate; system: ScreenSystem }[] {
  return input.candidates.flatMap((row) => {
    if (row.status !== "ready" || row.blocker !== null) return [];
    if (input.submitted.has(row.id) || !input.signs.has(row.proceedingId)) return [];
    const system = input.ways.systems.find((item) => item.court === row.court && item.system === row.system);
    return system ? [{ row, system }] : [];
  });
}

const bySystemName = (a: { system: ScreenSystem }, b: { system: ScreenSystem }) =>
  a.system.name.localeCompare(b.system.name, "pt-BR");

/**
 * The packages ready that the person may hand ONE to file on the court's screen, by system: ready, kept by nothing,
 * of a lawsuit the person signs, not in a submission already, at a system where the person chose an automated way
 * (the database files by the lawyer's own choice only, 0264: the firm's way is what is marked for them to choose).
 */
export function eligibleGroups(input: BatchInput): EligibleGroup[] {
  const groups = new Map<string, EligibleGroup>();
  for (const { row, system } of readyOfMine(input)) {
    const way = wayInForce(input.ways, system);
    if (way === "hand") continue;
    const group = groups.get(system.key) ?? { system, way, packages: [] };
    group.packages.push(row);
    groups.set(system.key, group);
  }
  return [...groups.values()].sort(bySystemName);
}

/**
 * The packages ready that ONE could file for the person at a system where they never chose a way, though the firm's
 * way offers them an automated one: what /protocolo tells them they may hand ONE once they choose, by system.
 */
export function unchosenGroups(input: BatchInput): { system: ScreenSystem; count: number }[] {
  const groups = new Map<string, { system: ScreenSystem; count: number }>();
  for (const { system } of readyOfMine(input)) {
    if (input.ways.myWays[system.key] || waysOffered(system, input.ways.firmWay).length < 2) continue;
    const group = groups.get(system.key) ?? { system, count: 0 };
    group.count += 1;
    groups.set(system.key, group);
  }
  return [...groups.values()].sort(bySystemName);
}

export const OPEN_BATCH_STATUSES = ["approved", "running", "awaiting_code", "awaiting_confirmation"] as const;
export type OpenBatchStatus = (typeof OPEN_BATCH_STATUSES)[number];

export type BatchSubmission = {
  id: string;
  packageId: string;
  caseId: string;
  status: string;
  summaryFileId: string | null;
};

export type BatchView = {
  id: string;
  systemKey: string;
  systemName: string;
  way: Exclude<Way, "hand">;
  status: OpenBatchStatus;
  personId: string | null;
  personName: string;
  codeKind: "app" | "email" | null;
  submissions: BatchSubmission[];
};

/** How many filings of a batch went, how many wait, and how many may have reached the court with no answer. */
export function batchCounts(batch: Pick<BatchView, "submissions">): {
  total: number;
  filed: number;
  unknown: number;
  refused: number;
  waiting: number;
} {
  const count = (statuses: string[]) => batch.submissions.filter((row) => statuses.includes(row.status)).length;
  return {
    total: batch.submissions.length,
    filed: count(["filed"]),
    unknown: count(["unknown", "sending"]),
    refused: count(["refused", "failed"]),
    waiting: count(["owed", "claimed", "confirming"]),
  };
}

/**
 * Whose turn a batch is, as its line says it: the person reading answers (the court's code, the confirmation of a
 * first filing), or waits on ONE, on the lawyer's extension, or on the batch's lawyer.
 */
export type BatchTurn =
  | "code_mine"
  | "code_theirs"
  | "confirm_mine"
  | "confirm_theirs"
  | "extension_mine"
  | "extension_theirs"
  | "one_waits_browser"
  | "one_files";

export function batchTurn(batch: Pick<BatchView, "status" | "way" | "personId">, viewerId: string): BatchTurn {
  const mine = batch.personId === viewerId;
  if (batch.status === "awaiting_code") return mine ? "code_mine" : "code_theirs";
  if (batch.status === "awaiting_confirmation") return mine ? "confirm_mine" : "confirm_theirs";
  if (batch.status === "approved") {
    if (batch.way === "extension") return mine ? "extension_mine" : "extension_theirs";
    return "one_waits_browser";
  }
  return "one_files";
}

/** The filing of a batch held at the court's screen for its lawyer's word, with what the screen showed, if kept. */
export const heldSubmission = (batch: Pick<BatchView, "submissions">): BatchSubmission | null =>
  batch.submissions.find((row) => row.status === "confirming") ?? null;
