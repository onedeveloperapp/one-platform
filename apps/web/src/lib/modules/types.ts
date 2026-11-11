/**
 * A product module of ONE as the core asks for it (migration 0068: the catalog `product_modules`, the modules of
 * each firm in `firm_modules`, the module of each case in `cases.module`).
 *
 * The core never imports a module. It reads the modules through the two files that know which ones exist:
 * `lib/modules/registry.ts`, for anything a screen or a rule asks, and `lib/modules/jobs.ts`, for the backend's
 * jobs. A module's own code lives in `src/modules/<key>/`, and its routes in a route group named after it
 * (`app/**\/(<key>)/...`); the lint keeps the rest of the code from importing it (eslint.config.ts).
 */

import type { ComponentType } from "react";

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
  /** The `product` message key of its name: its tile is its icon and its name (the owner, 2026-11-09). */
  labelKey: string;
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
  /**
   * The page of the module's route group where a firm that contracted it sets it up (0081): its own steps, in the
   * module's colour, after the firm's core setup and before the home. None for a module with nothing to set up.
   */
  firmSetup?: string;
  /**
   * The module's own settings, which the settings menu lists under the module's name for a firm that contracted it:
   * what only this module's cases read (the Valor da Causa Pedido by kind of problem, the partner agencies), never
   * in the core's pages. None for a module with nothing of its own to set.
   */
  firmSettings?: readonly FirmAreaEntry[];
  /** What only the module has, which its area in the firm's app lists (0078). */
  firmArea: readonly FirmAreaEntry[];
  /** The test chat stands for this module's passenger: its area offers the chat while the firm has it on (0047). */
  testChat?: boolean;
  /**
   * The module's section of a partner's home, loaded only when it is shown (the passenger module's: the agency's
   * passengers' flights as they happen, 0084): a client component that reads its own data, which the core opens
   * for a partner with a partnership of the module and never names. None for a module with nothing to show there.
   */
  partnerHome?: () => Promise<{ default: ComponentType }>;
  /**
   * What the module does with a person the firm just registered (the owner, 2026-11-11): the core registers anybody as
   * "Nova pessoa", whatever the modules, and then offers each module's step ("Acompanhar uma viagem"), loaded when it
   * opens. None for a module with nothing to do with a new person.
   */
  personStep?: {
    /** The words of the step ("Acompanhar uma viagem") and of what it does, keys of the product's messages. */
    label: string;
    description: string;
    panel: () => Promise<{ default: ComponentType<PersonStepPanelProps> }>;
  };
  /** What the module shows on a person's page (the trips ONE follows of them, 0170), loaded when it is shown. */
  personSection?: () => Promise<{ default: ComponentType<{ personId: string; personName: string }> }>;
};

/** What the core hands a module's step for a person of the firm (`personStep`). */
export type PersonStepPanelProps = {
  /** A person of the firm already: only what the module needs is asked. */
  personId?: string | null;
  personName?: string | null;
  /** The documents the core read the person from, for the module to keep with what it does (the identity). */
  documents?: readonly { fileId: string; kind: string }[];
  onClose: () => void;
  /** The person the trip is of, once ONE follows it. */
  onDone: (personId: string) => void;
};
