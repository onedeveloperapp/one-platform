import { cpfMiddle } from "@/lib/search/global-search";

/**
 * The firm's people (migrations 0133 and 0134), as pure rules: the views of the list, a row and a page read as nothing
 * more than they may be, the numbers of the screen, the filters of a marketing segment and the columns of its export.
 */

/** The views of the cards of numbers above the list. */
export const PEOPLE_LIST_VIEWS = ["todos", "ativos", "sem-caso-ativo", "sem-marketing"] as const;
/**
 * The funnel (0148): where each person stands, the furthest point any of their opportunities reached, in its order. The
 * cards of Pessoas are the funnel (the owner, 2026-11-11): a person enters as a contact and moves by what happens.
 */
export const FUNNEL_VIEWS = ["contatos", "leads", "clientes", "nao-qualificados"] as const;
export const PEOPLE_CARD_VIEWS = FUNNEL_VIEWS;
export const PEOPLE_VIEWS = [...PEOPLE_LIST_VIEWS, ...FUNNEL_VIEWS] as const;
export const isFunnelView = (value: unknown): value is (typeof FUNNEL_VIEWS)[number] =>
  (FUNNEL_VIEWS as readonly unknown[]).includes(value);
export type PeopleView = (typeof PEOPLE_VIEWS)[number];
export const isPeopleView = (value: unknown): value is PeopleView =>
  (PEOPLE_VIEWS as readonly unknown[]).includes(value);

export const PEOPLE_VIEW_KEY: Record<PeopleView, string> = {
  todos: "people-view-all",
  ativos: "people-view-active",
  "sem-caso-ativo": "people-view-inactive",
  "sem-marketing": "people-view-no-marketing",
  leads: "people-view-leads",
  clientes: "people-view-clients",
  "nao-qualificados": "people-view-not-qualified",
  contatos: "people-view-contacts",
};

export const FUNNEL_POINTS = ["lead", "cliente", "nao_qualificado", "contato"] as const;
export type FunnelPoint = (typeof FUNNEL_POINTS)[number];
const isFunnelPoint = (value: unknown): value is FunnelPoint => (FUNNEL_POINTS as readonly unknown[]).includes(value);

export const FUNNEL_POINT_KEY: Record<FunnelPoint, string> = {
  lead: "people-point-lead",
  cliente: "people-point-client",
  nao_qualificado: "people-point-not-qualified",
  contato: "people-point-contact",
};

export const PEOPLE_SHOWN = 50;

export type PersonRow = {
  id: string;
  name: string;
  cpfMiddle: string | null;
  place: string | null;
  active: boolean;
  hasCase: boolean;
  adult: boolean;
  marketingOff: boolean;
  erased: boolean;
  /** Where the person stands in the funnel (0148); null where the database did not say. */
  point: FunnelPoint | null;
  /** Why the rule did not qualify their problem, for one not qualified. */
  reasons: string[];
};

export type PeoplePage = { counts: Record<PeopleView, number>; total: number; rows: PersonRow[] };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    : [];
const place = (city: string | null, uf: string | null): string | null => (city ? (uf ? `${city}/${uf}` : city) : null);

export function readPeoplePage(raw: unknown): PeoplePage {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const counts = (answer.counts ?? {}) as Record<string, unknown>;
  return {
    counts: Object.fromEntries(PEOPLE_VIEWS.map((view) => [view, whole(counts[view])])) as Record<PeopleView, number>,
    total: whole(answer.total),
    rows: records(answer.rows).flatMap((row): PersonRow[] => {
      const id = text(row.id);
      const name = text(row.name);
      if (!id || !name) return [];
      return [
        {
          id,
          name,
          cpfMiddle: cpfMiddle(text(row.cpf)),
          place: place(text(row.city), text(row.uf)),
          active: row.active === true,
          hasCase: row.has_case === true,
          adult: row.adult !== false,
          marketingOff: row.marketing_off === true,
          erased: row.erased === true,
          point: isFunnelPoint(row.point) ? row.point : null,
          reasons: Array.isArray(row.reasons)
            ? row.reasons.filter((reason): reason is string => typeof reason === "string")
            : [],
        },
      ];
    }),
  };
}

// ---------- The numbers ----------

export const AGE_BANDS = ["minor", "18_29", "30_39", "40_49", "50_59", "60", "unknown"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const AGE_KEY: Record<AgeBand, string> = {
  minor: "people-age-minor",
  "18_29": "people-age-18-29",
  "30_39": "people-age-30-39",
  "40_49": "people-age-40-49",
  "50_59": "people-age-50-59",
  60: "people-age-60",
  unknown: "people-age-unknown",
};

export const ORIGINS = ["agency", "referral", "ads", "organic", "returning_client", "other"] as const;
export const ORIGIN_KEY: Record<string, string> = {
  agency: "people-origin-agency",
  referral: "people-origin-referral",
  ads: "people-origin-ads",
  organic: "people-origin-organic",
  returning_client: "people-origin-returning",
  other: "people-origin-other",
};

export const OUTCOME_KEY: Record<string, string> = {
  procedente: "people-outcome-won",
  parcial: "people-outcome-partial",
  improcedente: "people-outcome-lost",
  acordo: "people-outcome-settlement",
};

export type Tally = { key: string; count: number };

export type PeopleNumbers = {
  registered: number;
  /** The test cases counted, the firm having no real case yet (0138): the screen says so. */
  testsCounted: boolean;
  active: number;
  inactive: number;
  marketingOff: number;
  origins: Tally[];
  ages: Tally[];
  professions: Tally[];
  cities: Tally[];
  airlines: Tally[];
  incidents: Tally[];
  outcomes: Tally[];
};

const tallies = (value: unknown): Tally[] =>
  records(value).flatMap((row) => {
    const key = text(row.key);
    return key ? [{ key, count: whole(row.count) }] : [];
  });

export function readPeopleNumbers(raw: unknown): PeopleNumbers {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const origins = (answer.origins ?? {}) as Record<string, unknown>;
  const ages = (answer.ages ?? {}) as Record<string, unknown>;
  return {
    registered: whole(answer.registered),
    testsCounted: answer.tests_counted === true,
    active: whole(answer.active),
    inactive: whole(answer.inactive),
    marketingOff: whole(answer.marketing_off),
    origins: Object.entries(origins)
      .map(([key, count]) => ({ key, count: whole(count) }))
      .filter((tally) => tally.count > 0)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    ages: AGE_BANDS.map((key) => ({ key, count: whole(ages[key]) })),
    professions: tallies(answer.professions),
    cities: tallies(answer.cities),
    airlines: tallies(answer.airlines),
    incidents: tallies(answer.incidents),
    outcomes: tallies(answer.outcomes),
  };
}

// ---------- The segments ----------

export type SegmentFilters = {
  origins?: string[];
  airlines?: string[];
  incidents?: string[];
  outcomes?: string[];
  cities?: string[];
  ufs?: string[];
  professions?: string[];
  age_min?: number;
  age_max?: number;
  active?: boolean;
};

const words = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim());
  return list.length > 0 ? list.slice(0, 50) : undefined;
};
const age = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 18 && value <= 120 ? value : undefined;

/** The filters a segment keeps, read as nothing more than they may be: an empty list or an age out of range is none. */
export function readSegmentFilters(raw: unknown): SegmentFilters {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const filters: SegmentFilters = {
    origins: words(value.origins),
    airlines: words(value.airlines),
    incidents: words(value.incidents),
    outcomes: words(value.outcomes),
    cities: words(value.cities),
    ufs: words(value.ufs)?.map((uf) => uf.toUpperCase()),
    professions: words(value.professions),
    age_min: age(value.age_min),
    age_max: age(value.age_max),
    active: typeof value.active === "boolean" ? value.active : undefined,
  };
  return Object.fromEntries(Object.entries(filters).filter(([, item]) => item !== undefined)) as SegmentFilters;
}

/** How many filters a segment has in force. */
export const filterCount = (filters: SegmentFilters): number => Object.keys(readSegmentFilters(filters)).length;

export type Segment = {
  id: string;
  name: string;
  filters: SegmentFilters;
  count: number;
  archivedAt: string | null;
  archiveReason: string | null;
  updatedAt: string | null;
};

export function readSegments(raw: unknown): Segment[] {
  return records(raw).flatMap((row): Segment[] => {
    const id = text(row.id);
    const name = text(row.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        filters: readSegmentFilters(row.filters),
        count: whole(row.count),
        archivedAt: text(row.archived_at),
        archiveReason: text(row.archive_reason),
        updatedAt: text(row.updated_at),
      },
    ];
  });
}

/** The columns a segment's export may carry, in the order a spreadsheet shows them. */
export const EXPORT_COLUMNS = [
  "nome",
  "primeiro_nome",
  "email",
  "telefone",
  "cidade",
  "uf",
  "idade",
  "profissao",
  "origem",
  "companhia",
  "problema",
  "resultado",
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export const EXPORT_COLUMN_KEY: Record<ExportColumn, string> = {
  nome: "people-column-name",
  primeiro_nome: "people-column-first-name",
  email: "people-column-email",
  telefone: "people-column-phone",
  cidade: "people-column-city",
  uf: "people-column-uf",
  idade: "people-column-age",
  profissao: "people-column-profession",
  origem: "people-column-origin",
  companhia: "people-column-airline",
  problema: "people-column-incident",
  resultado: "people-column-outcome",
};

/** The default columns of an export: the ones a marketing tool needs to reach somebody. */
export const DEFAULT_COLUMNS: ExportColumn[] = ["nome", "primeiro_nome", "email", "telefone", "cidade", "uf"];

/** The export's rows as a sheet's lines, the columns in the order the person chose them. */
export function exportLines(
  rows: readonly Record<string, unknown>[],
  columns: readonly ExportColumn[],
): (string | number)[][] {
  return rows.map((row) =>
    columns.map((column) => {
      const value = row[column];
      return typeof value === "number" ? value : typeof value === "string" ? value : "";
    }),
  );
}

// ---------- How a person asked ----------

export const ASKED_HOW = ["telefone", "whatsapp", "email", "pessoalmente", "outro"] as const;
export type AskedHow = (typeof ASKED_HOW)[number];
export const ASKED_KEY: Record<AskedHow | "link", string> = {
  link: "people-how-link",
  telefone: "people-how-phone",
  whatsapp: "people-how-whatsapp",
  email: "people-how-email",
  pessoalmente: "people-how-in-person",
  outro: "people-how-other",
};
