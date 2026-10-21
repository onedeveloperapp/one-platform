import { parseDateValue, resolveDateOrder } from "@/lib/import/dates";
import { type ColumnMapping, guessColumnMapping, type PortfolioField } from "@/lib/import/mapping";
import { namesMatch } from "@/lib/import/names";
import type { ParsedTable } from "@/lib/import/table";
import { isValidCpf, onlyDigits } from "@flyee/fields";
import { formatCnj, parseCnj } from "@flyee/rules/cnj";

/**
 * A firm's portfolio as it comes from the system it used before: one line a
 * lawsuit. Each line is read into what ONE keeps of a lawsuit already in
 * court (its number, its client, the court its number names, its unit, the
 * day it was distributed, whether it ended) and what it would do: open a
 * case, or nothing because the firm already has that lawsuit, the file
 * repeats it, or the line cannot be read. The lawsuit's number is what a
 * line is matched by: the same number is the same lawsuit, whoever typed it.
 *
 * Pure: the lawsuits the firm has, the courts and the airlines are handed in.
 * It decides nothing of a claim.
 */

/** What a line would do. */
export type RowAction = "create" | "exists" | "duplicate" | "error";

/** Why a line cannot be read: it does not go. */
export const ROW_ERRORS = ["missing_cnj", "imprecise_cnj", "invalid_cnj", "court_not_known", "missing_client"] as const;
export type RowError = (typeof ROW_ERRORS)[number];

/** What was left out of a line that goes on: the lawsuit is brought without it. */
export const ROW_WARNINGS = [
  "invalid_cpf",
  "company_document",
  "cpf_other_name",
  "invalid_date",
  "old_date",
  "future_date",
] as const;
export type RowWarning = (typeof ROW_WARNINGS)[number];

/** Each has words in the catalog. */
export type RowProblem = RowError | RowWarning;

/** What goes to the server of a line that opens a case. */
export type PortfolioRow = {
  row: number;
  cnj: string;
  client_name: string;
  cpf: string | null;
  airline: string | null;
  kind: "juizado" | "comum";
  court: string;
  unit: string | null;
  comarca: string | null;
  filed_on: string | null;
  closed: boolean;
  /** The firm's own note on the case: where it came from and what the old system said of it. */
  summary: string | null;
};

export type StagedRow = {
  /** The line of the spreadsheet, as the person sees it. */
  line: number;
  action: RowAction;
  /** Why it is an error. */
  error: RowError | null;
  /** What was left out of a line that goes on (a CPF that is none, a day that is none). */
  warnings: RowWarning[];
  /** The number, with its mask when it is one; as typed otherwise. */
  cnjLabel: string;
  clientName: string;
  /** How the other party is written, as it is compared (no accents, no case): what a person's choice of airline is kept by. */
  opponentKey: string | null;
  row: PortfolioRow | null;
};

/** One way the other party is written in the lines that go, and the airline it is read as. */
export type OpponentRead = {
  /** The name as the spreadsheet compares it (no accents, no case): what a person's choice is kept by. */
  key: string;
  /** The name as the spreadsheet first wrote it. */
  label: string;
  lines: number;
  /** The airline its name says, by the names ONE knows; null when none, or more than one. */
  recognized: string | null;
  /** The airline the lines go with: the one recognized, unless the person chose another (or none). */
  airline: string | null;
};

export type PortfolioPreview = {
  rows: StagedRow[];
  summary: Record<RowAction, number>;
  /** How many lines each problem is in, errors and warnings alike. */
  problems: Partial<Record<RowProblem, number>>;
  /** The other parties of the lines that go, the most frequent first. */
  opponents: OpponentRead[];
  /** What the old system wrote of the lawsuits read as ended, the most frequent first. */
  endedStatuses: { label: string; lines: number }[];
};

export type PreviewInput = {
  table: ParsedTable;
  mapping: ColumnMapping;
  /** The numbers (20 digits) of the lawsuits the firm already has. */
  existing: ReadonlySet<string>;
  /** The courts ONE knows, by the segment and the code of a number. */
  courts: readonly { acronym: string; segment: string; code: string }[];
  /**
   * The airlines ONE knows: each by its own name and by the names it is written by in court (the company
   * that answers there, `legal_name` and `court_names` of migration 0032). One that no longer flies
   * (`active` false) is known so that a party of its name is read as none, never as another airline.
   */
  airlines: readonly { iata: string; name: string; names?: readonly string[]; active?: boolean }[];
  /** The system the spreadsheet came from, as the person names it. */
  source: string | null;
  /** Today, "YYYY-MM-DD": a lawsuit is not distributed tomorrow. */
  today: string;
  /** The oldest day a lawsuit is taken to be distributed on (the setting `import`): before it, a day is none. */
  oldestDay: string;
};

const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tidy = (text: string, most: number): string | null => {
  const cut = text.replace(/\s+/g, " ").trim().slice(0, most);
  return cut === "" ? null : cut;
};

/**
 * A number Excel kept as a number of more than fifteen digits, which it does not keep whole: it shows it
 * with an exponent ("5,12346E+19"), and whatever twenty digits it is turned back into are not the ones typed.
 */
const IMPRECISE = /^\s*[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+\s*$/;
/** A number written with no mask (digits, and the dots, commas and spaces of a number's format). */
const UNMASKED = /^[\d.,\s]+$/;

/**
 * Whether a cell is a number Excel did not keep whole: one with an exponent, or one written in full whose
 * digits past the fifteenth are all zeros ("50001236020998000000", "50.001.236.020.998.000.000"), which is
 * what Excel writes of a number of twenty digits it kept as a number. A lawsuit's number typed with its mask
 * is never one.
 */
export function isImpreciseNumber(cell: string): boolean {
  if (IMPRECISE.test(cell)) return true;
  if (!UNMASKED.test(cell)) return false;
  const significant = onlyDigits(cell).replace(/^0+/, "");
  return significant.length > 15 && /^0+$/.test(significant.slice(15));
}

/**
 * A lawsuit's number from a cell: its twenty digits when they are a valid number. A number that lost the
 * zeros before it (a spreadsheet keeps "0001234-..." typed as a number without them) is given them back,
 * when what comes of it is a valid number. One Excel rounded is none: its digits are not the lawsuit's.
 */
export function cnjOf(cell: string): string | null {
  if (isImpreciseNumber(cell)) return null;
  const digits = onlyDigits(cell);
  if (digits.length === 20) return parseCnj(digits) ? digits : null;
  if (digits.length >= 14 && digits.length < 20) {
    const padded = digits.padStart(20, "0");
    return parseCnj(padded) ? padded : null;
  }
  return null;
}

/** Words of a company's name that tell no airline from another. */
const GENERIC = new Set([
  "air",
  "airlines",
  "airways",
  "linhas",
  "aereas",
  "aerea",
  "aerolineas",
  "aerovias",
  "companhia",
  "sa",
  "s",
  "a",
  "ltda",
  "do",
  "de",
  "da",
  "brasil",
  "inc",
]);

/** A party's name that says it is an airline. */
const AVIATION = /\b(aere[oa]s?|airlines?|airways|air lines|aerolineas|aerovias|aviacao|aviation)\b/;

/**
 * The airline a party's name is, by the names ONE knows. First by a name the company is written by in court
 * ("TAM Linhas Aéreas S.A." is LATAM), then by the airline's own name, each found whole in the party's name:
 * a name found inside a longer one of another airline is not that airline, and a name of one word counts
 * only where the party's name is that word alone or says it is an airline ("Azul Linhas Aéreas" is Azul,
 * "Azul Companhia de Seguros" is not). Else by the airline's own word (the first of its name that tells it
 * from another: "delta" in "Delta Airlines"), only where the party's name says it is an airline. One
 * airline, or none: a party that names two airlines ("LATAM e Gol") names neither, and a party of an
 * airline that no longer flies (Avianca Brasil) is none, never another airline of a like name.
 */
export function airlineOf(opponent: string, airlines: PreviewInput["airlines"]): string | null {
  const said = plain(opponent);
  if (said === "") return null;
  const words = ` ${said} `;
  const aviation = AVIATION.test(said);
  const counts = (name: string) => name.includes(" ") || aviation || said === name;
  const whole = (names: readonly string[]) =>
    names.map(plain).filter((name) => name.length >= 2 && words.includes(` ${name} `) && counts(name));
  /** The airlines a set of names finds, less the ones whose every name found is part of a longer one of another. */
  const findBy = (pick: (airline: PreviewInput["airlines"][number]) => readonly string[]) => {
    const found = airlines
      .map((airline) => ({ airline, names: whole(pick(airline)) }))
      .filter((item) => item.names.length > 0);
    return found.filter(
      (item) =>
        !item.names.every((name) =>
          found.some(
            (other) =>
              other.airline.iata !== item.airline.iata &&
              other.names.some((longer) => longer.length > name.length && ` ${longer} `.includes(` ${name} `)),
          ),
        ),
    );
  };
  const answer = (found: { airline: PreviewInput["airlines"][number] }[]) =>
    found.length === 1 && found[0].airline.active !== false ? found[0].airline.iata : null;

  const byCourt = findBy((airline) => airline.names ?? []);
  if (byCourt.length > 0) {
    if (byCourt.length > 1) return null;
    // Another airline named in the party, other than by a name the first is written by in court, is a second one.
    const courtNames = byCourt[0].names;
    const another = airlines.some(
      (airline) =>
        airline.iata !== byCourt[0].airline.iata &&
        whole([airline.name]).some((name) => !courtNames.some((court) => ` ${court} `.includes(` ${name} `))),
    );
    return another ? null : answer(byCourt);
  }
  const byName = findBy((airline) => [airline.name]);
  if (byName.length > 0) return answer(byName);
  if (!aviation) return null;
  const byWord = airlines.filter((airline) => {
    const own = plain(airline.name)
      .split(" ")
      .find((word) => word.length >= 3 && !GENERIC.has(word));
    return own !== undefined && words.includes(` ${own} `);
  });
  return answer(byWord.map((airline) => ({ airline })));
}

/**
 * Whether a lawsuit ended, by what the old system says of it. Only the words that say it ended for the firm
 * (archived, closed, extinguished, finished); never a lawsuit archived provisionally, suspended, awaiting
 * something, sent back to another instance ("baixado à origem"), a negation ("não arquivado"), nor a final
 * judgment ("transitado em julgado"), which still has its enforcement ahead: a lawsuit taken for ended is one
 * nobody follows in court, which is the worse mistake of the two.
 */
export function endedBy(status: string): boolean {
  const said = ` ${plain(status)} `;
  if (said.trim() === "") return false;
  if (/\b(nao|sem)\s+(?:[a-z]+\s+){0,2}(arquivad|encerrad|baixad|finalizad|extint|conclu)/.test(said)) return false;
  if (/\b(provisori|sobrestad|suspens|aguardand)/.test(said)) return false;
  if (/\b(baixad|remetid|devolvid|retornad)[a-z]*\s+(a|ao|aos|as|para)\b/.test(said)) return false;
  return /\b(arquivad|arquivament|encerrad|baixad|baixa definitiv|finalizad|extint|concluid)/.test(said);
}

/**
 * How much a line of a sheet reads as the headers of a portfolio: how many facts of a lawsuit its cells name
 * (two say it is the line of the headers). A line with a lawsuit's number in it, whole or cut by Excel, is a
 * line of data (-1): the headers are above it.
 */
export function portfolioHeaderScore(row: readonly string[]): number {
  if (row.some((cell) => cnjOf(cell) !== null || isImpreciseNumber(cell))) return -1;
  return Object.keys(guessColumnMapping(row)).length;
}

/**
 * For each CPF of a file, the name it goes with: the one most of its lines carry (the first on a tie), its
 * spellings counted as one name. A mother's three lawsuits and her son's one under her CPF give it to her.
 */
export function cpfOwnersOf(lines: readonly (readonly [document: string, name: string])[]): Map<string, string> {
  const tallies = new Map<string, { name: string; lines: number }[]>();
  for (const [document, typedName] of lines) {
    const digits = onlyDigits(document);
    if (digits.length === 0 || digits.length > 11) continue;
    const cpf = digits.padStart(11, "0");
    if (!isValidCpf(cpf)) continue;
    const name = tidy(typedName, 200);
    if (!name) continue;
    const names = tallies.get(cpf) ?? [];
    const same = names.find((known) => namesMatch(known.name, name));
    if (same) same.lines += 1;
    else names.push({ name, lines: 1 });
    tallies.set(cpf, names);
  }
  const owners = new Map<string, string>();
  for (const [cpf, names] of tallies) {
    const best = names.reduce((most, item) => (item.lines > most.lines ? item : most), names[0]);
    owners.set(cpf, best.name);
  }
  return owners;
}

/**
 * The preview with the airline a person chose for some ways of writing the other party (by its key; null
 * for none): only the lines of those parties change, so a choice never reads the file again.
 */
export function withAirlineChoices(
  preview: PortfolioPreview,
  choices: ReadonlyMap<string, string | null>,
): PortfolioPreview {
  if (choices.size === 0) return preview;
  const chosen = (key: string | null, fallback: string | null) =>
    key !== null && choices.has(key) ? (choices.get(key) ?? null) : fallback;
  return {
    ...preview,
    rows: preview.rows.map((row) =>
      row.row && row.opponentKey !== null && choices.has(row.opponentKey)
        ? { ...row, row: { ...row.row, airline: chosen(row.opponentKey, row.row.airline) } }
        : row,
    ),
    opponents: preview.opponents.map((opponent) => ({
      ...opponent,
      airline: chosen(opponent.key, opponent.recognized),
    })),
  };
}

/** The lines of a spreadsheet as what each would do in ONE. */
export function buildPortfolioPreview(input: PreviewInput): PortfolioPreview {
  const { table, mapping } = input;
  const cell = (row: string[], field: PortfolioField): string => {
    const column = mapping[field];
    return column === undefined ? "" : (row[column] ?? "").trim();
  };
  const order = resolveDateOrder(table.rows.map((row) => cell(row, "filed_on")));
  const courtOf = new Map(input.courts.map((court) => [`${court.segment}${court.code}`, court.acronym]));
  const seen = new Set<string>();
  const summary: Record<RowAction, number> = { create: 0, exists: 0, duplicate: 0, error: 0 };
  const problems: Partial<Record<RowProblem, number>> = {};
  const count = (problem: RowProblem) => {
    problems[problem] = (problems[problem] ?? 0) + 1;
  };
  const opponents = new Map<string, OpponentRead>();
  const ended = new Map<string, { label: string; lines: number }>();
  const cpfOwners = cpfOwnersOf(table.rows.map((row) => [cell(row, "client_document"), cell(row, "client_name")]));

  const opponentOf = (typed: string): { key: string | null; airline: string | null } => {
    const key = plain(typed);
    if (key === "") return { key: null, airline: null };
    let read = opponents.get(key);
    if (!read) {
      const recognized = airlineOf(typed, input.airlines);
      read = { key, label: tidy(typed, 120) ?? typed, lines: 0, recognized, airline: recognized };
      opponents.set(key, read);
    }
    read.lines += 1;
    return { key, airline: read.airline };
  };

  const rows = table.rows.map((row, index): StagedRow => {
    const line = table.lines[index] ?? index + 2;
    const typed = cell(row, "cnj");
    const clientName = tidy(cell(row, "client_name"), 200) ?? "";
    const staged = (
      action: RowAction,
      error: RowError | null,
      cnjLabel: string,
      more: Partial<StagedRow> = {},
    ): StagedRow => {
      summary[action] += 1;
      if (error) count(error);
      return { line, action, error, warnings: [], cnjLabel, clientName, opponentKey: null, row: null, ...more };
    };

    if (typed === "") return staged("error", "missing_cnj", "");
    if (isImpreciseNumber(typed)) return staged("error", "imprecise_cnj", typed.slice(0, 40));
    const cnj = cnjOf(typed);
    if (!cnj) return staged("error", "invalid_cnj", typed.slice(0, 40));
    const label = formatCnj(cnj) ?? cnj;
    const court = courtOf.get(cnj.slice(13, 16));
    if (!court) return staged("error", "court_not_known", label);
    if (seen.has(cnj)) return staged("duplicate", null, label);
    seen.add(cnj);
    if (input.existing.has(cnj)) return staged("exists", null, label);
    if (clientName.length < 3) return staged("error", "missing_client", label);

    const warnings: RowWarning[] = [];
    const warn = (problem: RowWarning) => {
      warnings.push(problem);
      count(problem);
    };
    // A CPF is kept when it is one; a company's document has no place in a person, and a wrong one is left out.
    const document = onlyDigits(cell(row, "client_document"));
    let cpf: string | null = null;
    if (document.length === 14) warn("company_document");
    else if (document.length > 0) {
      const padded = document.padStart(11, "0");
      if (document.length <= 11 && isValidCpf(padded)) cpf = padded;
      else warn("invalid_cpf");
    }
    // A CPF the file gives people of more than one name is the one most of its lines name: a client of
    // another name goes without it.
    if (cpf !== null) {
      const owner = cpfOwners.get(cpf);
      if (owner !== undefined && !namesMatch(owner, clientName)) {
        warn("cpf_other_name");
        cpf = null;
      }
    }
    const typedDay = cell(row, "filed_on");
    let filedOn = typedDay === "" ? null : parseDateValue(typedDay, order);
    if (typedDay !== "" && filedOn === null) warn("invalid_date");
    if (filedOn !== null && filedOn < input.oldestDay) {
      warn("old_date");
      filedOn = null;
    }
    if (filedOn !== null && filedOn > input.today) {
      warn("future_date");
      filedOn = null;
    }
    const unit = tidy(cell(row, "unit"), 200);
    const kindSaid = plain(`${cell(row, "kind")} ${unit ?? ""}`);
    const status = cell(row, "status");
    const closed = endedBy(status);
    if (closed) {
      const key = plain(status);
      const read = ended.get(key) ?? { label: tidy(status, 80) ?? status, lines: 0 };
      read.lines += 1;
      ended.set(key, read);
    }
    const notes = [
      input.source ? `Importado de ${input.source}` : "Importado de planilha",
      tidy(cell(row, "folder"), 60) ? `Pasta: ${tidy(cell(row, "folder"), 60)}` : null,
      tidy(cell(row, "responsible"), 120) ? `Responsável: ${tidy(cell(row, "responsible"), 120)}` : null,
      tidy(cell(row, "opponent"), 200) ? `Parte contrária: ${tidy(cell(row, "opponent"), 200)}` : null,
      tidy(cell(row, "claim_value"), 40) ? `Valor da causa: ${tidy(cell(row, "claim_value"), 40)}` : null,
      tidy(status, 80) ? `Situação: ${tidy(status, 80)}` : null,
      tidy(cell(row, "notes"), 600),
    ].filter(Boolean);

    summary.create += 1;
    const opponent = opponentOf(cell(row, "opponent"));
    return {
      line,
      action: "create",
      error: null,
      warnings,
      cnjLabel: label,
      clientName,
      opponentKey: opponent.key,
      row: {
        row: line,
        cnj,
        client_name: clientName,
        cpf,
        airline: opponent.airline,
        // The small-claims court says so in its name; anything else is the civil court.
        kind: /\bjuizado/.test(kindSaid) || /\bjec\b/.test(kindSaid) ? "juizado" : "comum",
        court,
        unit,
        comarca: tidy(cell(row, "comarca"), 120),
        filed_on: filedOn,
        closed,
        summary: tidy(notes.join(" · "), 1000),
      },
    };
  });
  const byLines = <T extends { lines: number; label: string }>(a: T, b: T) =>
    b.lines - a.lines || a.label.localeCompare(b.label);
  return {
    rows,
    summary,
    problems,
    opponents: [...opponents.values()].sort(byLines),
    endedStatuses: [...ended.values()].sort(byLines),
  };
}
