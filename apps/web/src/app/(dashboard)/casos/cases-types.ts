import type { StatusTone } from "@/components/product/status-chip";
import type { StatusGroup } from "@/lib/cases/cases";
import type { CaseFilter, CaseListPage } from "@/lib/cases/list";

/** The tint of each stage's badge: what waits on the client, what the firm works on, what is in court, what ended. */
export const GROUP_TONE: Record<StatusGroup, StatusTone> = {
  open: "attention",
  preparing: "primary",
  filed: "info",
  ended: "neutral",
};

export type AirlineOption = { iata: string; name: string };

/** What a new case starts from, when it is opened from a conversation. */
export type NewCasePrefill = { name: string; phone: string } | null;

export type CasesState =
  | {
      kind: "ready";
      /** The first page of the list, as the database counted, filtered and paged it (`firm_cases`). */
      list: CaseListPage;
      airlines: AirlineOption[];
      /** The filter the address asked for (`?ver=`), which the first page was read under. */
      filter: CaseFilter | null;
      prefill: NewCasePrefill;
      /** A support visit reads and changes nothing. */
      supportVisit: boolean;
      /** The person is of a function that brings the firm's portfolio from a spreadsheet. */
      canImport: boolean;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };
