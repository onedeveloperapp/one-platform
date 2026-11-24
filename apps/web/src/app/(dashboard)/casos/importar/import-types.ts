import type { SecondFactorState } from "@/lib/ai/approvals";
import type { ImportCounts } from "@/lib/import/actions";
import type { ImportLimits } from "@/lib/import/limits";

/** A spreadsheet somebody of the firm brought, as its history shows it. */
export type ImportBatchView = {
  id: string;
  fileName: string | null;
  source: string | null;
  /** The cases ONE opened from the lawsuits the DJEN shows, a batch a day (0287): ONE's, never a person's file. */
  byOne: boolean;
  status: "staged" | "committed" | "reverted";
  /** The lines it received. */
  rows: number;
  /** How many of them were decided, for one that did not end: none means nothing of it was written yet. */
  decided: number | null;
  /** What came of its lines, once it ended. */
  counts: ImportCounts | null;
  /** The lawsuits of its file the firm already had when it started (never sent: the screen saw them). */
  fileExists: number;
  whenLabel: string;
};

export type ImportState =
  | {
      kind: "ready";
      /** The courts ONE knows, by the segment and the code of a lawsuit's number. */
      courts: { acronym: string; segment: string; code: string }[];
      /** The airlines ONE knows, each with the names it is written by in court; the ones that no longer fly too. */
      airlines: { iata: string; name: string; names: string[]; active: boolean }[];
      history: ImportBatchView[];
      /** The day in Brazil's official time: a lawsuit is not distributed tomorrow. */
      today: string;
      /** Bringing and undoing ask for the second factor: said before the person chooses a file. */
      secondFactor: SecondFactorState;
      /** How many lines a batch holds and a call takes, as the database says. */
      limits: ImportLimits;
    }
  /** The person is of the firm, and not of a function that brings a portfolio. */
  | { kind: "not-allowed" }
  /** A support visit reads and changes nothing. */
  | { kind: "support" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };
