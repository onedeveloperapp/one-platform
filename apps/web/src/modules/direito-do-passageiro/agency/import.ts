import { type DateOrder, parseDateValue, resolveDateOrder } from "@/lib/import/dates";
import { normalizeHeader } from "@/lib/import/mapping";
import type { ParsedTable } from "@/lib/import/table";

/**
 * A spreadsheet of the agency's passengers (migration 0070, `pax_import_rows`): one line per passenger, or per
 * passenger and leg, as an agency's system exports its bookings. Read in the browser (`lib/import/read.ts`), each
 * column confirmed by the person, and only the lines that go are sent, a few at a time. Pure.
 *
 * A line is a passenger (found by their CPF in the partnership, or by name and birth date, or added) and, with a
 * locator, the trip of that locator, with its leg when the line names a flight. What the database refuses of a
 * line is said by the line's number; what this file cannot read (a day that is no day) is said before anything is
 * sent, so the person fixes the spreadsheet and not the record.
 */

export const PAX_IMPORT_FIELDS = [
  "name",
  "cpf",
  "birth_date",
  "phone",
  "email",
  "locator",
  "flight",
  "origin",
  "destination",
  "departure_date",
  "departure_time",
  "arrival_date",
  "arrival_time",
] as const;
export type PaxImportField = (typeof PAX_IMPORT_FIELDS)[number];

export const PAX_IMPORT_REQUIRED: readonly PaxImportField[] = ["name"];

export type PaxColumnMapping = Partial<Record<PaxImportField, number>>;

/** The names each fact is known by in an agency's export, the most telling first. */
const NAMES: Record<PaxImportField, readonly string[]> = {
  name: ["nome do passageiro", "nome completo", "passageiro", "passageiros", "nome", "viajante", "cliente"],
  cpf: ["cpf do passageiro", "cpf", "documento"],
  birth_date: ["data de nascimento", "data nascimento", "dt nascimento", "nascimento", "data nasc", "nasc"],
  phone: ["whatsapp", "celular", "telefone celular", "telefone", "fone", "contato"],
  email: ["e mail", "email"],
  locator: ["localizador", "codigo da reserva", "codigo de reserva", "reserva", "pnr", "loc"],
  flight: ["numero do voo", "n do voo", "voo", "flight"],
  origin: ["aeroporto de origem", "origem", "saindo de", "de"],
  destination: ["aeroporto de destino", "destino", "indo para", "para"],
  departure_time: [
    "hora de partida",
    "hora da partida",
    "horario de partida",
    "horario da partida",
    "hora de saida",
    "horario de saida",
    "hora do embarque",
    "hora",
  ],
  departure_date: [
    "data e hora de partida",
    "data de partida",
    "data da partida",
    "data do voo",
    "data de embarque",
    "data de saida",
    "partida",
    "saida",
    "embarque",
    "data",
  ],
  arrival_time: ["hora de chegada", "hora da chegada", "horario de chegada", "horario da chegada"],
  arrival_date: ["data e hora de chegada", "data de chegada", "data da chegada", "chegada"],
};

/** Names too short or too common to be read inside a longer header: they name a fact only as the whole header. */
const WHOLE_ONLY = new Set(["de", "para", "data", "hora", "loc", "nasc", "documento", "contato", "cliente"]);

/**
 * The column of each fact, guessed from the headers: a header that is one of a fact's names first, then one that
 * starts with a name, then one that holds it as a whole word. A column is taken once, by the fact that names it
 * best. The person confirms it before anything is read.
 */
export function guessPaxMapping(headers: readonly string[]): PaxColumnMapping {
  const plain = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: PaxColumnMapping = {};
  const tests: ((header: string, name: string) => boolean)[] = [
    (header, name) => header === name,
    (header, name) => !WHOLE_ONLY.has(name) && header.startsWith(`${name} `),
    (header, name) => !WHOLE_ONLY.has(name) && ` ${header} `.includes(` ${name} `),
  ];
  // The hours before the days: "Hora de partida" holds the word of a day, and is an hour.
  const order: readonly PaxImportField[] = [
    "name",
    "cpf",
    "birth_date",
    "phone",
    "email",
    "locator",
    "flight",
    "departure_time",
    "arrival_time",
    "arrival_date",
    "departure_date",
    "origin",
    "destination",
  ];
  for (const test of tests) {
    for (const field of order) {
      if (mapping[field] !== undefined) continue;
      for (const name of NAMES[field]) {
        const index = plain.findIndex((header, column) => !taken.has(column) && header !== "" && test(header, name));
        if (index !== -1) {
          mapping[field] = index;
          taken.add(index);
          break;
        }
      }
    }
  }
  return mapping;
}

/** How much a line reads as the headers of an agency's export: the facts it names (`readSpreadsheet`). */
export const paxHeaderScore = (row: readonly string[]): number => Object.keys(guessPaxMapping(row)).length;

export const missingPaxRequired = (mapping: PaxColumnMapping): PaxImportField[] =>
  PAX_IMPORT_REQUIRED.filter((field) => mapping[field] === undefined);

/** A line as `pax_import_rows` takes it. */
export type PaxImportRow = {
  line: number;
  nome: string;
  cpf?: string;
  nascimento?: string;
  whatsapp?: string;
  email?: string;
  localizador?: string;
  voo?: string;
  origem?: string;
  destino?: string;
  partida?: string;
  chegada?: string;
};

/** Why a line is not sent: what this reader could not read of it. */
export type PaxImportProblem = {
  line: number;
  code: "no_name" | "birth_date_unreadable" | "departure_unreadable" | "arrival_unreadable" | "leg_incomplete";
};

export type PaxImportPlan = {
  rows: PaxImportRow[];
  problems: PaxImportProblem[];
  /** How many of the lines that go carry each fact: the conference before anything is sent. */
  counts: { withCpf: number; withPhone: number; withLocator: number; withFlight: number };
};

const HOUR = /(?:^|[^\d])(\d{1,2})\s*(?::\s*(\d{2})|h\s*(\d{2})?)(?:\s*:\s*\d{2})?(?:[^\d]|$)/i;

/** An hour of a cell ("14:30", "14h30", "14h", "14:30:00", Excel's "1899-12-30 14:30"), as "HH:MM", or null. */
export function hourOf(value: string): string | null {
  const match = HOUR.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? "0");
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The hour written after the day in a cell that holds both ("03/11/2026 14:30", "2026-11-03T14:30"), or null. */
function hourAfterDay(value: string): string | null {
  const rest = value.trim().replace(/^[^\sT]+/, "");
  return rest.trim() ? hourOf(rest) : null;
}

const nextDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * The lines of the table as they go, and what keeps a line from going. A day is read in the order its column was
 * written (day first unless the column says otherwise). A leg goes only with its flight, its two airports and its
 * two moments; with no day of arrival the arrival is on the day of departure, or on the next day when its hour is
 * earlier than the departure's (a flight that lands after midnight).
 */
export function planPaxImport(table: ParsedTable, mapping: PaxColumnMapping): PaxImportPlan {
  const cell = (row: readonly string[], field: PaxImportField): string => {
    const column = mapping[field];
    return column === undefined ? "" : (row[column] ?? "").trim();
  };
  const orderOf = (field: PaxImportField): DateOrder =>
    resolveDateOrder(table.rows.map((row) => cell(row, field)).filter(Boolean));
  const birthOrder = orderOf("birth_date");
  const departureOrder = orderOf("departure_date");
  const arrivalOrder = orderOf("arrival_date");

  const rows: PaxImportRow[] = [];
  const problems: PaxImportProblem[] = [];
  const counts = { withCpf: 0, withPhone: 0, withLocator: 0, withFlight: 0 };

  table.rows.forEach((row, index) => {
    const line = table.lines[index] ?? index + 2;
    const nome = cell(row, "name").replace(/\s+/g, " ");
    if (!nome) {
      // A line with nothing of a passenger is no line of the import (a total, a blank under a title).
      if (row.some((value) => value.trim() !== "")) problems.push({ line, code: "no_name" });
      return;
    }
    const out: PaxImportRow = { line, nome };

    const birth = cell(row, "birth_date");
    if (birth) {
      const day = parseDateValue(birth, birthOrder);
      if (!day) {
        problems.push({ line, code: "birth_date_unreadable" });
        return;
      }
      out.nascimento = day;
    }
    const cpf = cell(row, "cpf").replace(/\D/g, "");
    if (cpf) out.cpf = cpf;
    const phone = cell(row, "phone");
    if (phone) out.whatsapp = phone;
    const email = cell(row, "email");
    if (email) out.email = email;
    const locator = cell(row, "locator").replace(/\s+/g, "").toUpperCase();
    if (locator) out.localizador = locator;

    const flight = cell(row, "flight").replace(/\s+/g, "").toUpperCase();
    if (flight) {
      const departureCell = cell(row, "departure_date");
      const departureDay = departureCell ? parseDateValue(departureCell, departureOrder) : null;
      const departureHour = hourOf(cell(row, "departure_time")) ?? hourAfterDay(departureCell);
      if (!departureDay || !departureHour) {
        problems.push({ line, code: "departure_unreadable" });
        return;
      }
      const arrivalCell = cell(row, "arrival_date");
      const arrivalHour = hourOf(cell(row, "arrival_time")) ?? hourAfterDay(arrivalCell);
      let arrivalDay = arrivalCell ? parseDateValue(arrivalCell, arrivalOrder) : null;
      if (arrivalCell && !arrivalDay) {
        problems.push({ line, code: "arrival_unreadable" });
        return;
      }
      if (!arrivalHour) {
        problems.push({ line, code: "arrival_unreadable" });
        return;
      }
      if (!arrivalDay) arrivalDay = arrivalHour < departureHour ? nextDay(departureDay) : departureDay;
      const origin = cell(row, "origin").toUpperCase();
      const destination = cell(row, "destination").toUpperCase();
      if (!locator || !origin || !destination) {
        problems.push({ line, code: "leg_incomplete" });
        return;
      }
      out.voo = flight;
      out.origem = origin;
      out.destino = destination;
      out.partida = `${departureDay}T${departureHour}`;
      out.chegada = `${arrivalDay}T${arrivalHour}`;
    }

    rows.push(out);
    if (out.cpf) counts.withCpf += 1;
    if (out.whatsapp) counts.withPhone += 1;
    if (out.localizador) counts.withLocator += 1;
    if (out.voo) counts.withFlight += 1;
  });

  return { rows, problems, counts };
}

/** The `product` message key of each fact of the mapping, spelled out for the catalog check. */
export const IMPORT_FIELD_KEY: Record<PaxImportField, string> = {
  name: "pax-import-field-name",
  cpf: "pax-import-field-cpf",
  birth_date: "pax-import-field-birth-date",
  phone: "pax-import-field-phone",
  email: "pax-import-field-email",
  locator: "pax-import-field-locator",
  flight: "pax-import-field-flight",
  origin: "pax-import-field-origin",
  destination: "pax-import-field-destination",
  departure_date: "pax-import-field-departure-date",
  departure_time: "pax-import-field-departure-time",
  arrival_date: "pax-import-field-arrival-date",
  arrival_time: "pax-import-field-arrival-time",
};

export const IMPORT_PROBLEM_KEY: Record<PaxImportProblem["code"], string> = {
  no_name: "pax-import-problem-no-name",
  birth_date_unreadable: "pax-import-problem-birth-date",
  departure_unreadable: "pax-import-problem-departure",
  arrival_unreadable: "pax-import-problem-arrival",
  leg_incomplete: "pax-import-problem-leg",
};
