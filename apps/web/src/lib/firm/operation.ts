/**
 * How the firm works (migration 0256, the setup's step "A operação", the owner, 2026-11-20): where it works, how its
 * clients arrive, how many new cases a month, its hours, the system it used before ONE, and who does each work, with
 * the areas it works in. The answers decide later what ONE says to a client and the tools the panel shows; the areas
 * decide now the way a new contact on the WhatsApp goes. The values are the database's own (`firm_operations`). Pure.
 */

export const OPERATION_CHANNELS = ["indicacao", "anuncio", "agencia", "carteira", "outro"] as const;
export type OperationChannel = (typeof OPERATION_CHANNELS)[number];

export const MONTHLY_BANDS = ["ate_20", "ate_100", "ate_500", "mais_500"] as const;
export type MonthlyBand = (typeof MONTHLY_BANDS)[number];

export const PREVIOUS_SYSTEMS = ["nenhum", "astrea", "advbox", "projuris", "planilha", "outro"] as const;
export type PreviousSystem = (typeof PREVIOUS_SYSTEMS)[number];

/** The questions of who does each work: each answered yes or no, and none decided for the firm. */
export const OPERATION_WORKS = ["one_filing", "one_finance", "partners", "controladoria"] as const;
export type OperationWork = (typeof OPERATION_WORKS)[number];

export type FirmOperation = {
  states: string[];
  channels: OperationChannel[];
  monthlyCases: MonthlyBand | null;
  hoursFrom: string | null;
  hoursTo: string | null;
  saturdays: boolean;
  previousSystem: PreviousSystem | null;
  works: Record<OperationWork, boolean | null>;
};

export const EMPTY_OPERATION: FirmOperation = {
  states: [],
  channels: [],
  monthlyCases: null,
  hoursFrom: null,
  hoursTo: null,
  saturdays: false,
  previousSystem: null,
  works: { one_filing: null, one_finance: null, partners: null, controladoria: null },
};

/** An area of the firm: one ONE knows (`lawArea`), or one the firm named (`lawArea` null). */
export type OperationArea = { lawArea: string | null; name: string; source: "module" | "xray" | "person" };

/** An area of law ONE knows, as the step lists it. */
export type KnownArea = { key: string; name: string; covers: string; module: string | null };

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;

const hour = (value: unknown): string | null =>
  typeof value === "string" && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : null;

const yesNo = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** The row of `firm_operations`, as the step reads it; the empty answers where there is none. */
export function operationOf(row: unknown): FirmOperation {
  if (typeof row !== "object" || row === null) return EMPTY_OPERATION;
  const data = row as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    states: list(data.states),
    channels: list(data.channels).filter((item): item is OperationChannel => oneOf(OPERATION_CHANNELS, item) !== null),
    monthlyCases: oneOf(MONTHLY_BANDS, data.monthly_cases),
    hoursFrom: hour(data.hours_from),
    hoursTo: hour(data.hours_to),
    saturdays: data.saturdays === true,
    previousSystem: oneOf(PREVIOUS_SYSTEMS, data.previous_system),
    works: {
      one_filing: yesNo(data.one_filing),
      one_finance: yesNo(data.one_finance),
      partners: yesNo(data.partners),
      controladoria: yesNo(data.controladoria),
    },
  };
}

/** What `save_firm_operation` takes. */
export function operationPayload(operation: FirmOperation): Record<string, unknown> {
  return {
    states: operation.states,
    channels: operation.channels,
    monthly_cases: operation.monthlyCases,
    hours_from: operation.hoursFrom && operation.hoursTo ? operation.hoursFrom : null,
    hours_to: operation.hoursFrom && operation.hoursTo ? operation.hoursTo : null,
    saturdays: operation.saturdays,
    previous_system: operation.previousSystem,
    ...operation.works,
  };
}

/** Whether the hours, when given, are a span of a day. */
export const hoursOk = (operation: Pick<FirmOperation, "hoursFrom" | "hoursTo">): boolean =>
  (!operation.hoursFrom && !operation.hoursTo) ||
  (Boolean(operation.hoursFrom) && Boolean(operation.hoursTo) && operation.hoursFrom! < operation.hoursTo!);

/** The name of an area the firm types: one space between words, from 2 to 80 characters. */
export const areaName = (value: string): string => value.replace(/\s+/g, " ").trim();
export const areaNameOk = (value: string): boolean => {
  const name = areaName(value);
  return name.length >= 2 && name.length <= 80;
};
