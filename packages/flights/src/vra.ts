/**
 * The official record of the scheduled flights operated in Brazil: ANAC's
 * VRA ("Voo Regular Ativo"), the schedule each airline registered joined to
 * what it reported as flown. ANAC publishes one file per month, a few weeks
 * after the month ends:
 *
 *   https://siros.anac.gov.br/siros/registros/diversos/vra/{ano}/VRA_{ano}_{mes}.csv
 *
 * What a file of August 2026 showed, read on 2026-10-10 (and what this reads
 * by): UTF-8, one flight per line, fields separated by ";", a header naming
 * them ("Sigla ICAO Empresa Aérea", "Número Voo", "Sigla ICAO Aeroporto
 * Origem", "Partida Prevista", "Partida Real", "Sigla ICAO Aeroporto
 * Destino", "Chegada Prevista", "Chegada Real", "Situação Voo",
 * "Justificativa", "Codeshare", among others); an airline and the airports
 * by their ICAO codes; a flight number with zeros before it ("0904");
 * times as "dd/mm/aaaa hh:mm", every one of them in Brasília time, whatever
 * the airport (the scheduled time from Guarulhos to Manaus and the one back
 * take the same minutes); the state of a flight "REALIZADO" or "CANCELADO",
 * a cancelled one with no real times; the codeshares as "AZU/7800, GLO/6804";
 * and the airline's justification empty on every line. The columns are read
 * by their names, never by their places: a file of another year may hold
 * others, or in another order. Older files differ, and are read too (their
 * first lines read on 2026-10-10): June 2021 is UTF-8 with no codeshares
 * and the day of the flight as "2021-06-01"; December 2018 and March 2016
 * are written in Latin-1 (Windows-1252), with the airline's justification
 * filled in ("ATRASOS NÃO ESPECÍFICOS"), which is kept when there is one.
 *
 * Some 2,300 lines a month carry no scheduled times: legs flown that no
 * schedule foresaw, numbered as the flight they belong to with a "Z" before
 * it ("Z0950"), dated by the day of that flight ("Referência") and named by
 * a code ("Código DI") of Portaria nº 1.190/SRE of 2011, as amended by
 * Portaria nº 906/SAS of 2018: 2 an extra leg, 3 a return to the airport of
 * origin, 4 a leg included in a scheduled flight, 6 a leg nobody paid for (a
 * repositioning, a ferry), 7 a charter for one client, 9 a charter sold to
 * the public, D a leg carried by another flight of the same airline. The
 * file of August 2026 shows what they tell a case: American's 950 from
 * Guarulhos to New York of the 13th is recorded as cancelled, and beside it
 * the same aircraft's legs "Z0950" from Guarulhos to San Juan and from San
 * Juan to New York, each with its real times. Those are read here too
 * (`parseVraUnscheduled`), never as a flight of the schedule. A "Z" also
 * comes before the number of some 200 flights a month that do have a
 * schedule (code 0), on a day the plain number does not fly: the ticket's
 * number is the one after it, and that flight is read by it.
 *
 * The same Portaria says every time is Brasília's official time, taken at
 * the blocks (the aircraft leaving and reaching its stand).
 *
 * Pure: no I/O. A provider reads a file line by line and hands each line here
 * (`VraMonthReader`).
 */

/** The zone every time of the record is written in. */
export const VRA_TIME_ZONE = "America/Sao_Paulo";

/** The address of a month's file, from the pattern a setting holds. */
export function vraMonthUrl(pattern: string, month: string): string {
  const [year, number] = month.split("-");
  return pattern.replaceAll("{ano}", year).replaceAll("{mes}", number);
}

/** One flight of the record, as published. */
export type VraRecord = {
  /** The operating airline's ICAO designator ("TAM"). */
  airline: string;
  /** The number, with no zeros before it ("904"). */
  number: string;
  /** The airports' ICAO codes ("SBGR"). */
  origin: string;
  destination: string;
  /** Brasília time, as "YYYY-MM-DDTHH:MM". */
  scheduledDeparture: string;
  actualDeparture: string | null;
  scheduledArrival: string;
  actualArrival: string | null;
  /** `realizado` (flown) or `cancelado`; anything else the record says is `outro`. */
  state: "realizado" | "cancelado" | "outro";
  /** The flights it was also sold as, designator and number together ("GLO6804"). */
  codeshares: string[];
  /** The day of the flight the line belongs to, "YYYY-MM-DD" ("Referência"), when the file has it. */
  reference?: string | null;
  /** What the airline gave as the reason, as the record writes it, when it gave one (older files). */
  justification?: string | null;
  /** The legs of the same flight no schedule foresaw, attached by the check (`withUnscheduled`). */
  unscheduled?: UnscheduledLeg[];
  /**
   * The legs after this one that take the same flight on to the destination of a case's leg (one number
   * flies Galeão to Belém, then on to Macapá), attached by the check (`matchLeg`).
   */
  continuation?: VraRecord[];
  /** Set by the check when this flight never reaches the destination of the case's leg: its arrival is not the leg's. */
  arrivalElsewhere?: boolean;
};

/**
 * What a leg with no schedule is, by the code the record gives it: `extra` (2), `return` to the airport
 * of origin (3), `included` in a scheduled flight (4), `duplicated` (D, carried by another flight of the
 * airline); `other` for a code the Portaria read does not name. A leg nobody paid for (6) or a charter
 * (7, 9) carries no passenger of the airline's flight and is never read.
 */
export type UnscheduledKind = "extra" | "return" | "included" | "duplicated" | "other";

/** A leg of a flight no schedule foresaw, as the record writes it. */
export type UnscheduledLeg = {
  origin: string;
  destination: string;
  /** Brasília time, as "YYYY-MM-DDTHH:MM". */
  actualDeparture: string | null;
  actualArrival: string | null;
  kind: UnscheduledKind;
};

/** A line of the record with no schedule: whose flight it is, and the leg. */
export type VraUnscheduledLine = UnscheduledLeg & {
  airline: string;
  /** The number of the flight it belongs to: digits, no "Z" and no zeros before them. */
  number: string;
  reference: string | null;
};

/** A file whose header lacks what a flight is read from: no line of it is read as one. */
export class VraFormatError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`vra_format: ${missing.join(", ")}`);
    this.name = "VraFormatError";
    this.missing = missing;
  }
}

/** What a file written by some programs starts with, before its first name. */
const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** A column name with no accent, no case and single spaces: what a header is read by. */
const plainName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(BYTE_ORDER_MARK, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const COLUMNS = {
  airline: "sigla icao empresa aerea",
  number: "numero voo",
  origin: "sigla icao aeroporto origem",
  scheduledDeparture: "partida prevista",
  actualDeparture: "partida real",
  destination: "sigla icao aeroporto destino",
  scheduledArrival: "chegada prevista",
  actualArrival: "chegada real",
  state: "situacao voo",
} as const;

/** Where each field is on a line of a file; the last four are read when a file has them. */
export type VraColumns = Record<keyof typeof COLUMNS, number> & {
  codeshare: number | null;
  reference: number | null;
  code: number | null;
  justification: number | null;
};

/** The places of the fields, from a file's first line. */
export function readVraHeader(line: string): VraColumns {
  const names = line.split(";").map(plainName);
  const missing: string[] = [];
  const found = {} as Record<keyof typeof COLUMNS, number>;
  for (const [field, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const index = names.indexOf(name);
    if (index === -1) missing.push(name);
    else found[field] = index;
  }
  if (missing.length > 0) throw new VraFormatError(missing);
  const optional = (name: string) => {
    const index = names.indexOf(name);
    return index === -1 ? null : index;
  };
  return {
    ...found,
    codeshare: optional("codeshare"),
    reference: optional("referencia"),
    code: optional("codigo di"),
    justification: optional("justificativa"),
  };
}

/** "dd/mm/aaaa hh:mm" as "YYYY-MM-DDTHH:MM"; null when it is not a time. */
function wallTime(value: string | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec((value ?? "").trim());
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const back = new Date(at);
  // A day or an hour that is not one (31/02, 25:00) is no time.
  if (back.getUTCDate() !== Number(day) || back.getUTCHours() !== Number(hour) || back.getUTCMonth() !== Number(month) - 1) {
    return null;
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const isIcaoAirline = (value: string) => /^[A-Z]{3}$/.test(value);
const isIcaoAirport = (value: string) => /^[A-Z0-9]{4}$/.test(value);

/** A number as the record writes it, with a "Z" before it or not, as the flight's number. */
const flightNumber = (value: string): string | null => {
  const written = value.trim().toUpperCase();
  return plainNumber(written.startsWith("Z") ? written.slice(1) : written);
};

/** A flight number with no zeros before it, or null when it is not digits. */
function plainNumber(value: string | undefined): string | null {
  const digits = (value ?? "").trim();
  if (!/^\d{1,6}$/.test(digits)) return null;
  const number = String(Number(digits));
  return number === "0" ? null : number;
}

/** "dd/mm/aaaa[ hh:mm:ss]" or "aaaa-mm-dd" (files of 2021) as "YYYY-MM-DD"; null when it is not a day. */
function day(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const match = iso ? [iso[0], iso[3], iso[2], iso[1]] : /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const back = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return back.getUTCDate() === Number(dd) && back.getUTCMonth() === Number(mm) - 1 ? `${yyyy}-${mm}-${dd}` : null;
}

/** "AZU/7800, GLO/6804" as ["AZU7800", "GLO6804"]; what is not a designator and a number is left out. */
export function readCodeshares(value: string | undefined): string[] {
  const found: string[] = [];
  for (const part of (value ?? "").split(",")) {
    const match = /^\s*([A-Z]{3})\s*\/\s*(\d{1,6})\s*$/.exec(part);
    const number = match ? plainNumber(match[2]) : null;
    if (match && number && !found.includes(`${match[1]}${number}`)) found.push(`${match[1]}${number}`);
  }
  return found;
}

/**
 * One line of a file as a flight, or null for a line that is not one (blank,
 * or missing what identifies a flight). A flight's times are kept as the
 * record writes them, in Brasília time.
 */
export function parseVraLine(columns: VraColumns, line: string): VraRecord | null {
  if (!line.trim()) return null;
  const cells = line.split(";");
  const cell = (index: number) => (cells[index] ?? "").trim();
  const airline = cell(columns.airline).toUpperCase();
  const number = flightNumber(cell(columns.number));
  const origin = cell(columns.origin).toUpperCase();
  const destination = cell(columns.destination).toUpperCase();
  const scheduledDeparture = wallTime(cell(columns.scheduledDeparture));
  const scheduledArrival = wallTime(cell(columns.scheduledArrival));
  if (!isIcaoAirline(airline) || !number || !isIcaoAirport(origin) || !isIcaoAirport(destination)) return null;
  if (!scheduledDeparture || !scheduledArrival) return null;
  const said = plainName(cell(columns.state));
  const state = said === "realizado" ? "realizado" : said === "cancelado" ? "cancelado" : "outro";
  return {
    airline,
    number,
    origin,
    destination,
    scheduledDeparture,
    // A cancelled flight has no real times, whatever a line carries.
    actualDeparture: state === "cancelado" ? null : wallTime(cell(columns.actualDeparture)),
    scheduledArrival,
    actualArrival: state === "cancelado" ? null : wallTime(cell(columns.actualArrival)),
    state,
    codeshares: columns.codeshare === null ? [] : readCodeshares(cell(columns.codeshare)),
    reference: columns.reference === null ? null : day(cell(columns.reference)),
    justification: columns.justification === null ? null : cell(columns.justification).replace(/\s+/g, " ").slice(0, 160) || null,
  };
}

/** The kind of a leg with no schedule by its code, or null for one that carries no passenger of the flight. */
function unscheduledKind(code: string): UnscheduledKind | null {
  switch (code.toUpperCase()) {
    case "2":
      return "extra";
    case "3":
      return "return";
    case "4":
      return "included";
    case "D":
      return "duplicated";
    case "6":
    case "7":
    case "9":
      return null;
    default:
      return "other";
  }
}

/**
 * One line of a file as a leg no schedule foresaw, or null for any other line: a scheduled flight, a leg
 * that was not flown, a leg nobody paid for or a charter, or one missing what identifies it.
 */
export function parseVraUnscheduled(columns: VraColumns, line: string): VraUnscheduledLine | null {
  const read = unscheduledLine(columns, line);
  return read === "left_out" ? null : read;
}

/** The same, saying apart a leg read and left out on purpose (nobody paid for it, a charter). */
function unscheduledLine(columns: VraColumns, line: string): VraUnscheduledLine | "left_out" | null {
  if (!line.trim()) return null;
  const cells = line.split(";");
  const cell = (index: number) => (cells[index] ?? "").trim();
  if (cell(columns.scheduledDeparture) || cell(columns.scheduledArrival)) return null;
  if (plainName(cell(columns.state)) !== "realizado") return null;
  const airline = cell(columns.airline).toUpperCase();
  const number = flightNumber(cell(columns.number));
  const origin = cell(columns.origin).toUpperCase();
  const destination = cell(columns.destination).toUpperCase();
  if (!isIcaoAirline(airline) || !number || !isIcaoAirport(origin) || !isIcaoAirport(destination)) return null;
  const kind = unscheduledKind(columns.code === null ? "" : cell(columns.code));
  const actualDeparture = wallTime(cell(columns.actualDeparture));
  const actualArrival = wallTime(cell(columns.actualArrival));
  if (!actualDeparture && !actualArrival) return null;
  if (!kind) return "left_out";
  return {
    airline,
    number,
    origin,
    destination,
    actualDeparture,
    actualArrival,
    kind,
    reference: columns.reference === null ? null : day(cell(columns.reference)),
  };
}

/** What a reading of a month keeps: the flights with a number or a codeshare asked, and every leg no schedule foresaw. */
export type VraWanted = { numbers: ReadonlySet<string>; codeshares: ReadonlySet<string> };

/** A month read: the flights asked of it and its legs no schedule foresaw. */
export type VraMonthRead = { kind: "read"; records: VraRecord[]; unscheduled: VraUnscheduledLine[] };

/**
 * A month's file read line by line, its header first. A header without what a flight is read from throws
 * `VraFormatError` at once; a file most of whose lines are no flight and no leg (times written another way)
 * throws it at the end (`finish`), so a month never reads as one with no flights when it was not read.
 */
export class VraMonthReader {
  private readonly wanted: VraWanted;
  private readonly records: VraRecord[] = [];
  private readonly unscheduled: VraUnscheduledLine[] = [];
  private columns: VraColumns | null = null;
  private lines = 0;
  private understood = 0;

  constructor(wanted: VraWanted) {
    this.wanted = wanted;
  }

  /** Whether the header was read: a file with none is empty. */
  get started(): boolean {
    return this.columns !== null;
  }

  take(line: string): void {
    if (!line.trim()) return;
    if (this.columns === null) {
      this.columns = readVraHeader(line);
      return;
    }
    this.lines += 1;
    const record = parseVraLine(this.columns, line);
    if (record) {
      this.understood += 1;
      if (this.wanted.numbers.has(record.number) || record.codeshares.some((code) => this.wanted.codeshares.has(code))) {
        this.records.push(record);
      }
      return;
    }
    const leg = unscheduledLine(this.columns, line);
    if (leg !== null) this.understood += 1;
    if (leg !== null && leg !== "left_out") this.unscheduled.push(leg);
  }

  finish(): VraMonthRead {
    if (this.lines > 0 && this.understood * 2 < this.lines) throw new VraFormatError(["linhas"]);
    return { kind: "read", records: this.records, unscheduled: this.unscheduled };
  }
}

/**
 * A wall time of a zone ("YYYY-MM-DDTHH:MM") as the instant it was, an ISO
 * string in UTC. The zone's own rules decide the offset of that day (Brasília
 * kept a summer time until 2019): the offset is asked of the platform's time
 * zone data, never written here.
 */
export function zonedInstant(wall: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!match) throw new RangeError(`not a wall time: ${wall}`);
  const asUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - instant;
  };
  // Twice: the offset of the first guess may be the other side of a change of the zone's offset.
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant).toISOString();
}
