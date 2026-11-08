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

/** The filing package of the example, as a case leaves it: the petition, the client's papers and the trip's. */
export const EXAMPLE_PACKAGE = planFiling(
  [
    pdf("p", "petition", "Petição inicial", null, 180_000, 9),
    pdf("o", "power_of_attorney", "Procuração", EXAMPLE_PERSON, 120_000, 2),
    pdf("i", "identity", "Documento de identidade", EXAMPLE_PERSON, 420_000, 1),
    pdf("a", "address_proof", "Comprovante de endereço", EXAMPLE_PERSON, 300_000, 1),
    pdf("b", "boarding_pass", "Cartão de embarque", null, 90_000, 1),
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
  calendar: { years: [{ year: 2026, allComarcas: false, comarcas: ["Goiânia"] }], days: [] },
});
