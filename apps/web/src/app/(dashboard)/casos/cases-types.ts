import type { StatusTone } from "@/components/product/status-chip";
import type { AreaChoice } from "@/lib/cases/area-choices";
import type { StatusGroup } from "@/lib/cases/cases";
import type { CaseFilter, CaseListPage } from "@/lib/cases/list";
import type { CaseStock } from "@/lib/cases/standing";
import type { ModuleCard } from "@/lib/modules/offer";

/** The tint of each stage's badge: what waits on the client, what the firm works on, what is in court, what ended. */
export const GROUP_TONE: Record<StatusGroup, StatusTone> = {
  open: "attention",
  preparing: "primary",
  filed: "info",
  ended: "neutral",
};

export type AirlineOption = { iata: string; name: string };

/**
 * The module a list of cases is of (migration 0078), with what only that module has: a partner the cases may come
 * from (the agencies of the passenger module), and a portfolio a firm brings from a spreadsheet.
 */
export type CasesScope = { module: ModuleCard; partner: boolean; importable: boolean };

/** What a new case starts from, when it is opened from a conversation. */
export type NewCasePrefill = { name: string; phone: string } | null;

export type CasesState =
  | {
      kind: "ready";
      /** The first page of the list, as the database counted, filtered and paged it (`firm_cases`). */
      list: CaseListPage;
      /** Whether the page reads the test cases too (0114): every page does, but where the controladoria left them out. */
      tests: boolean;
      /**
       * The stock of the list's scope (`firm_case_stock`, 0111): who has the cases and the stagnant ones, which the
       * views of who has the case count. Null when the database did not say it.
       */
      stock: CaseStock | null;
      airlines: AirlineOption[];
      /** The areas of the firm's own a person opens a case of (0292). */
      areas: AreaChoice[];
      /** The filter the address asked for (`?ver=`), which the first page was read under. */
      filter: CaseFilter | null;
      prefill: NewCasePrefill;
      /** A support visit reads and changes nothing. */
      supportVisit: boolean;
      /** The person is of a function that brings the firm's portfolio from a spreadsheet. */
      canImport: boolean;
      /** The person takes the list to a spreadsheet or a PDF (0110): a partner, the controladoria or who manages the firm. */
      canExport: boolean;
      /** The firm's name, which a PDF of the list says. */
      firmName: string;
      /** The module the list is of (a module's area, or `?modulo=`); null for every module of the firm. */
      scope: CasesScope | null;
      /** The modules the firm contracted, for the choice above the list and the module of each row. */
      modules: ModuleCard[];
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };
