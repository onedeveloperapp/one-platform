/**
 * A product module of ONE as the core asks for it (migration 0068: the catalog `product_modules`, the modules of
 * each firm in `firm_modules`, the module of each case in `cases.module`).
 *
 * The core never imports a module. It reads the modules through the two files that know which ones exist:
 * `lib/modules/registry.ts`, for anything a screen or a rule asks, and `lib/modules/jobs.ts`, for the backend's
 * jobs. A module's own code lives in `src/modules/<key>/`, and its routes in a route group named after it
 * (`app/**\/(<key>)/...`); the lint keeps the rest of the code from importing it (eslint.config.ts).
 */

import type { IconName } from "@/icons/icon-registry";

/**
 * A place of a module in the area of a partner of a firm (migration 0069): a page of the module's route group,
 * which the partner's menu and home lead to.
 */
export type PartnerAreaEntry = {
  id: string;
  href: string;
  icon: IconName;
  /** The `dashboard` message keys of its name and of its one line. */
  labelKey: string;
  descriptionKey: string;
};

/**
 * A place of a module for the firm (migration 0078): what only that module has, which its area lists beside the
 * module's share of the firm's work. A page of the core or of the module's route group.
 */
export type FirmAreaEntry = {
  id: string;
  href: string;
  icon: IconName;
  /** The `product` message keys of its name and of its one line. */
  labelKey: string;
  descriptionKey: string;
  /** Shown only to who brings the firm's portfolio from a spreadsheet (`lib/import/who.ts`). */
  importers?: boolean;
};

/** A kind of problem a case of the module is about (`cases.incident` for the passenger module). */
export type CaseKind = {
  /** As stored. Unique across every module, so a kind names its module by itself. */
  key: string;
  /** The `product` message key of its name on the screens. */
  labelKey: string;
  /** The words a model of the AI reads for it, in a briefing. */
  forModel: string;
};

export type ModuleDefinition = {
  /** As `product_modules.key` stores it. */
  key: string;
  /** The `product` message key of the module's name. */
  nameKey: string;
  /** The kinds of problem a case of the module is about, in the order the screens offer them. */
  caseKinds: readonly CaseKind[];
  /** What the module gives a partner of a firm to do, in the partner's area (none for a module with no partner). */
  partnerArea: readonly PartnerAreaEntry[];
  /**
   * The kind of partner of a firm the module has (`partners.kind`, 0069) and the page of the module's route group
   * where somebody of such a partner sets it up (0080): the gate opens it for who owes the second factor, and the
   * partner's home opens on it while who manages the partner never answered it. None for a module with no partner.
   */
  partnerSetup?: { kind: string; href: string };
  /** What only the module has, which its area in the firm's app lists (0078). */
  firmArea: readonly FirmAreaEntry[];
  /** The test chat stands for this module's passenger: its area offers the chat while the firm has it on (0047). */
  testChat?: boolean;
};
