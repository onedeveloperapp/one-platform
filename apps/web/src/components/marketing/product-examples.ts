import { partName, planFiling } from "@flyee/courts/filing";
import { computeDeadline } from "@flyee/rules/deadlines";

/**
 * The invented data the home's figures carry, worked out by the product's own rules: what a figure shows of a
 * deadline or a filing package is what the rule gives, never a number typed for the page. Kept apart from the
 * figures so a test holds the words that describe them (their screen-reader labels, docs/paginas/home/pagina.json)
 * to what the rules give: when a rule changes its answer, the test says which words to change.
 */

/** The client of the example, as the home's figures name her. */
export const EXAMPLE_PERSON = "Mariana Souza";

/** The court system of the example package: the name of a system, not a logo. */
export const EXAMPLE_SYSTEM = "Projudi";

/** One PDF of the example package. */
const pdf = (key: string, kind: string, label: string, person: string | null, bytes: number, pages: number) => ({
  key,
  kind,
  label,
  person,
  mime: "application/pdf",
  bytes,
  pages,
});

/** The filing package of the example, as a case leaves it: the petition and the client's papers. */
export const EXAMPLE_PACKAGE = planFiling(
  [
    pdf("p", "petition", "Petição inicial", null, 180_000, 9),
    pdf("o", "power_of_attorney", "Procuração", EXAMPLE_PERSON, 120_000, 2),
    pdf("i", "identity", "Documento de identidade", EXAMPLE_PERSON, 420_000, 1),
    pdf("a", "address_proof", "Comprovante de endereço", EXAMPLE_PERSON, 300_000, 1),
    pdf("r", "receipt", "Comprovante de gastos", null, 90_000, 1),
  ],
  // The Projudi of TJGO takes files of up to 6 MB (court_systems, seeded in 0027).
  { maxFileBytes: 6 * 1024 * 1024 },
);

/** The names the package gives its files, in the order of the filing. */
export const EXAMPLE_PACKAGE_NAMES = EXAMPLE_PACKAGE.items.map((item) => partName(item.stem, 1, 1));

/**
 * The example deadline: a publication made available on the DJEN on Wednesday, 4 November 2026, fifteen business
 * days, in a small-claims lawsuit of Goiânia. TJGO's calendar of 2026 has no day without business in November, so
 * the count is the rule's alone: the national holiday of 20 November (Lei nº 14.759/2023) left out.
 */
export const EXAMPLE_DEADLINE = computeDeadline({
  trigger: "publication",
  on: "2026-11-04",
  days: 15,
  counting: "business",
  place: { proceedingKind: "juizado", system: "projudi", comarca: "Goiânia" },
  calendar: {
    years: [{ year: 2026, allComarcas: false, comarcas: ["Goiânia"] }],
    days: [],
  },
});

/** How a day of the example's month reads on the calendar. */
export type CalendarDayKind = "plain" | "weekend" | "published" | "counted" | "holiday" | "due";

export type CalendarDay = { day: number; iso: string; kind: CalendarDayKind };

/** What a calendar draws of a count: the month it ends in, how many blanks open its first week, and each day's kind. */
export type CalendarMonth = {
  year: number;
  month: number;
  leading: number;
  days: CalendarDay[];
};

/**
 * The month a count ends in, day by day, as the count says it: the day it was published, the days it counted, the days
 * it left out, the day it ends. Only what the rule answered is marked, so the drawing can never disagree with it.
 */
export function calendarMonthOf(count: {
  publishedOn: string | null;
  startsOn: string;
  dueOn: string;
  skipped: { from: string; to: string; reason: string }[];
}): CalendarMonth {
  const [year, month] = count.dueOn.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const skipped = (iso: string) => count.skipped.some((span) => span.from <= iso && iso <= span.to);
  const days = Array.from({ length }, (_, index): CalendarDay => {
    const day = index + 1;
    const iso = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const within = count.startsOn <= iso && iso <= count.dueOn;
    const kind: CalendarDayKind =
      iso === count.dueOn
        ? "due"
        : iso === count.publishedOn
          ? "published"
          : within && skipped(iso)
            ? "holiday"
            : weekend
              ? "weekend"
              : within
                ? "counted"
                : "plain";
    return { day, iso, kind };
  });
  return { year, month, leading: first.getUTCDay(), days };
}

/** Who has a case on the window of the top, in the words of `standing-holder-*`. */
export type ExampleHolder = "one" | "client" | "firm" | "court";

export type ExampleCase = {
  seq: number;
  client: string;
  days: number;
  holder: ExampleHolder;
};

export type ExampleColumn = {
  step: "documents" | "signature" | "drafting" | "filing" | "hearing";
  total: number;
  cases: ExampleCase[];
};

/**
 * The firm of the home's window, its numbers and its cases on the board by step, the longest at the step first as the
 * product orders them (`firm_case_board`). Nothing here is a measure of anybody: it carries the "Exemplo fictício" tag
 * under the figure, and the page registers it (docs/paginas/home/pagina.json, `claims`). The cases of a column are a
 * page of it: each total is larger than what the column shows, as on the product's board.
 */
export const EXAMPLE_WINDOW = {
  going: 1284,
  goingDelta: "+4%",
  opened: 96,
  filed: 41,
  archived: 18,
  writing: 128,
  columns: [
    {
      step: "documents",
      total: 38,
      cases: [
        { seq: 122, client: "Juliana Prado", days: 3, holder: "one" },
        { seq: 127, client: "Carlos Menezes", days: 2, holder: "client" },
        { seq: 131, client: "Ana Ribeiro", days: 1, holder: "one" },
      ],
    },
    {
      step: "signature",
      total: 12,
      cases: [
        { seq: 112, client: "Marcos Vieira", days: 3, holder: "client" },
        { seq: 116, client: "Beatriz Lima", days: 2, holder: "client" },
        { seq: 119, client: "Rafael Costa", days: 1, holder: "client" },
      ],
    },
    {
      step: "drafting",
      total: 21,
      cases: [
        { seq: 109, client: "Clara Rocha", days: 2, holder: "firm" },
        { seq: 114, client: "Tiago Nunes", days: 1, holder: "one" },
        { seq: 128, client: EXAMPLE_PERSON, days: 1, holder: "one" },
      ],
    },
    {
      step: "filing",
      total: 9,
      cases: [
        { seq: 95, client: "Renata Souto", days: 2, holder: "firm" },
        { seq: 98, client: "Helena Dias", days: 1, holder: "one" },
        { seq: 103, client: "Pedro Alves", days: 1, holder: "firm" },
      ],
    },
    {
      step: "hearing",
      total: 64,
      cases: [
        { seq: 64, client: "Sofia Teixeira", days: 30, holder: "court" },
        { seq: 76, client: "Lúcia Martins", days: 21, holder: "court" },
        { seq: 87, client: "Bruno Farias", days: 12, holder: "court" },
      ],
    },
  ] satisfies ExampleColumn[],
};
