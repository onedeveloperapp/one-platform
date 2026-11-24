import type { DjenCommunication } from "@flyee/courts/types";

/**
 * The cases ONE opens from the lawsuits the DJEN shows (migration 0287), the pure half: what the worker hands the
 * database of a lawsuit's communications, and what the import's screen and the home read of the database's answers.
 */

/** What the database takes of each communication of a lawsuit: who it is addressed to, and through which lawyers. */
export type AddressedTo = {
  parties: { name: string; side: "active" | "passive" | null }[];
  lawyers: { uf: string; number: string }[];
};

/** Each communication of a lawsuit as the database takes it: nothing of its text, only whom it is addressed to. */
export function addressedTo(communications: readonly DjenCommunication[]): AddressedTo[] {
  return communications.map((communication) => ({
    parties: communication.parties.map((party) => ({ name: party.name, side: party.side })),
    lawyers: communication.lawyers.map((lawyer) => ({ uf: lawyer.uf, number: lawyer.number })),
  }));
}

/** Why ONE left a lawsuit of the DJEN without a case: each has its words in the catalog. */
export const SKIP_REASONS = [
  "exists",
  "by_person",
  "no_lawyer_of_firm",
  "firm_on_defense",
  "no_client",
  "airline_unclear",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

const SKIP_KEY: Record<SkipReason, string> = {
  exists: "import-djen-skip-exists",
  by_person: "import-djen-skip-by-person",
  no_lawyer_of_firm: "import-djen-skip-no-lawyer-of-firm",
  firm_on_defense: "import-djen-skip-firm-on-defense",
  no_client: "import-djen-skip-no-client",
  airline_unclear: "import-djen-skip-airline-unclear",
};

/** The words of a reason; a reason this code does not know is said as the lawsuit ONE could not read. */
export const skipReasonKey = (code: string): string =>
  (SKIP_REASONS as readonly string[]).includes(code) ? SKIP_KEY[code as SkipReason] : "import-djen-skip-other";

/** A client ONE named from the DJEN who has no CPF yet: the firm gives it. */
export type DjenClient = { personId: string; name: string; caseId: string; seq: number; cnj: string };

/** What the import's screen reads of the cases ONE opened (`firm_djen_cases`). */
export type DjenCases = {
  /** How the firm keeps the decision `open_case_from_djen`: ONE alone, or a person asks. */
  mode: "auto" | "approval";
  /** The firm has the passenger module, the only one whose cases ONE opens from the DJEN. */
  module: boolean;
  /** Lawsuits ONE is reading to open. */
  opening: number;
  /** Cases ONE opened that the firm still has. */
  opened: number;
  /** Lawsuits ONE left, by why. */
  skipped: { reason: string; count: number }[];
  /** Where a person decides: the lawsuits ONE would read once asked. */
  waiting: number;
  withoutCpfTotal: number;
  withoutCpf: DjenClient[];
};

const count = (value: unknown): number => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/** The answer of `firm_djen_cases`, read; null when it is not one (a refusal is read by the caller). */
export function djenCasesOf(raw: unknown): DjenCases | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  if (answer.ok !== true) return null;
  const skipped =
    answer.skipped && typeof answer.skipped === "object" ? (answer.skipped as Record<string, unknown>) : {};
  const withoutCpf = (Array.isArray(answer.without_cpf) ? answer.without_cpf : []).flatMap((item): DjenClient[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    return typeof row.person_id === "string" &&
      typeof row.name === "string" &&
      typeof row.case_id === "string" &&
      typeof row.cnj === "string"
      ? [{ personId: row.person_id, name: row.name, caseId: row.case_id, seq: count(row.seq), cnj: row.cnj }]
      : [];
  });
  return {
    mode: answer.mode === "approval" ? "approval" : "auto",
    module: answer.module === true,
    opening: count(answer.opening),
    opened: count(answer.opened),
    skipped: Object.entries(skipped)
      .map(([reason, value]) => ({ reason, count: count(value) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    waiting: count(answer.waiting),
    withoutCpfTotal: Math.max(count(answer.without_cpf_total), withoutCpf.length),
    withoutCpf,
  };
}

/** Where the firm's portfolio stands, for the home (`firm_portfolio`). */
export type PortfolioState = {
  /** The system the firm said it used before ONE; null when it said none, or nothing. */
  system: string | null;
  /** A spreadsheet of the portfolio was brought. */
  brought: boolean;
  /** This person may bring it (a partner, a lawyer or the controladoria, never in a support visit). */
  canImport: boolean;
  opening: number;
  opened: number;
  withoutCpf: number;
};

export function portfolioStateOf(raw: unknown): PortfolioState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  if (answer.ok !== true) return null;
  return {
    system: typeof answer.system === "string" ? answer.system : null,
    brought: answer.brought === true,
    canImport: answer.can_import === true,
    opening: count(answer.opening),
    opened: count(answer.opened),
    withoutCpf: count(answer.without_cpf),
  };
}

/**
 * What the home says of the portfolio, each line whose own: the firm's step while it said it used a system and
 * brought nothing of it (only to who may bring it), ONE's work (the cases it opened, the ones it is opening) and what
 * only the firm gives of them (the CPF of the clients ONE named). Nothing to say is nothing drawn.
 */
export type PortfolioLines = {
  bring: string | null;
  opened: number;
  opening: number;
  withoutCpf: number;
};

export function portfolioLines(state: PortfolioState | null): PortfolioLines | null {
  if (!state) return null;
  const lines: PortfolioLines = {
    bring: state.canImport && state.system !== null && !state.brought ? state.system : null,
    opened: state.opened,
    opening: state.opening,
    withoutCpf: state.canImport ? state.withoutCpf : 0,
  };
  return lines.bring !== null || lines.opened > 0 || lines.opening > 0 ? lines : null;
}
