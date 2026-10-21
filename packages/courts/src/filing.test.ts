import assert from "node:assert/strict";
import { test } from "node:test";

import { FILING_ORDER, filingKindOf, type FilingSource, nameSlug, partName, planFiling } from "./filing.ts";

const MB = 1_000_000;

const pdf = (key: string, kind: string, label: string, over: Partial<FilingSource> = {}): FilingSource => ({
  key,
  kind,
  label,
  person: null,
  mime: "application/pdf",
  bytes: 200_000,
  pages: 2,
  ...over,
});

test("the petition leads, and the rest follows in the order of a filing", () => {
  const plan = planFiling(
    [
      pdf("d1", "ticket", "Bilhete"),
      pdf("d2", "identity", "Documento de identidade", { person: "Maria Souza" }),
      pdf("d3", "petition", "Petição inicial"),
      pdf("d4", "power_of_attorney", "Procuração", { person: "Maria Souza" }),
      pdf("d5", "evidence", "Comprovante de despesa"),
    ],
    { maxFileBytes: 6 * MB },
  );
  assert.equal(plan.ready, true);
  assert.equal(plan.blockedBy, null);
  assert.deepEqual(
    plan.items.map((item) => [item.position, item.key, item.stem]),
    [
      [1, "d3", "01-peticao-inicial"],
      [2, "d4", "02-procuracao-maria-souza"],
      [3, "d2", "03-documento-de-identidade-maria-souza"],
      [4, "d1", "04-bilhete"],
      [5, "d5", "05-comprovante-de-despesa"],
    ],
  );
  assert.equal(
    plan.items.every((item) => !item.split),
    true,
  );
});

test("the documents of one kind go by person, then as they were given", () => {
  const plan = planFiling(
    [
      pdf("p", "petition", "Petição inicial"),
      pdf("z", "identity", "Documento de identidade", { person: "Zeca Lima" }),
      pdf("a2", "identity", "Documento de identidade", { person: "Ana Lima" }),
      pdf("a1", "identity", "Documento de identidade", { person: "Ana Lima" }),
    ],
    { maxFileBytes: null },
  );
  assert.deepEqual(
    plan.items.map((item) => item.key),
    ["p", "a2", "a1", "z"],
  );
});

test("a name is plain, never repeated and never longer than the system takes", () => {
  assert.equal(nameSlug("  Petição   Inicial (2ª via) "), "peticao-inicial-2a-via");
  assert.equal(nameSlug("João D'Ávila"), "joao-d-avila");
  const long = "Comprovante de residência em nome de terceiro com declaração de moradia assinada".repeat(2);
  const plan = planFiling(
    [
      pdf("p", "petition", "Petição inicial"),
      pdf("a", "address_proof", long, { person: "Maria Aparecida dos Santos Oliveira" }),
      pdf("b", "address_proof", long, { person: "Maria Aparecida dos Santos Oliveira" }),
    ],
    { maxFileBytes: 6 * MB, nameMaxLength: 60 },
  );
  const names = plan.items.map((item) => partName(item.stem, 10, 12));
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^[a-z0-9][a-z0-9-]*\.pdf$/);
    assert.ok(name.length <= 60, `${name} has ${name.length} characters`);
  }
  // Two files of the same kind and person keep their own place, so their names differ by it.
  assert.equal(plan.items[1].stem.slice(0, 3), "02-");
  assert.equal(plan.items[2].stem.slice(0, 3), "03-");
});

test("a file larger than the limit is marked to be cut, and its parts are named in order", () => {
  const plan = planFiling(
    [pdf("p", "petition", "Petição inicial"), pdf("e", "evidence", "Conversas", { bytes: 14 * MB, pages: 40 })],
    { maxFileBytes: 6 * MB },
  );
  assert.equal(plan.ready, true);
  assert.deepEqual(
    plan.items.map((item) => item.split),
    [false, true],
  );
  assert.equal(partName(plan.items[1].stem, 1, 3), "02-conversas-parte-1-de-3.pdf");
  assert.equal(partName(plan.items[1].stem, 1, 1), "02-conversas.pdf");
  // With no known limit nothing is cut: a limit nobody confirmed is not invented.
  const unknown = planFiling([pdf("p", "petition", "Petição inicial", { bytes: 40 * MB })], { maxFileBytes: null });
  assert.equal(unknown.items[0].split, false);
});

test("what cannot go is named, and blocks the package", () => {
  const plan = planFiling(
    [
      pdf("p", "petition", "Petição inicial"),
      pdf("photo", "identity", "Documento de identidade", { mime: "image/jpeg" }),
      pdf("empty", "receipt", "Recibo", { bytes: 0 }),
      pdf("scan", "evidence", "Foto do painel", { bytes: 9 * MB, pages: 1 }),
      pdf("protected", "evidence", "Extrato", { bytes: 300_000, pages: null }),
    ],
    { maxFileBytes: 6 * MB },
  );
  assert.deepEqual(plan.problems, [
    { key: "photo", code: "not_a_pdf" },
    { key: "empty", code: "unreadable" },
    // A PDF whose pages could not be counted was never opened (protected, or damaged): it does not go as it is.
    { key: "protected", code: "unreadable" },
  ]);
  assert.equal(plan.ready, false);
  assert.equal(plan.blockedBy, "problems");
  // A single page over the limit is left to who cuts: its images compressed again may make it fit.
  assert.deepEqual(
    plan.items.map((item) => [item.key, item.split]),
    [
      ["p", false],
      ["scan", true],
    ],
  );
});

test("a petition under a limit of its own goes whole, and one larger than it is named", () => {
  // The PJe of a court takes the petition as one PDF of up to 1.5 MB, and its attachments under another limit.
  const limits = { maxFileBytes: 5 * MB, maxPetitionBytes: 1.5 * MB };
  const whole = planFiling(
    [pdf("p", "petition", "Petição inicial", { bytes: 1.4 * MB }), pdf("t", "ticket", "Bilhete", { bytes: 7 * MB, pages: 9 })],
    limits,
  );
  assert.equal(whole.ready, true);
  assert.deepEqual(
    whole.items.map((item) => [item.key, item.split]),
    [
      ["p", false],
      ["t", true],
    ],
  );

  const large = planFiling([pdf("p", "petition", "Petição inicial", { bytes: 1.6 * MB, pages: 30 })], limits);
  assert.equal(large.ready, false);
  assert.equal(large.blockedBy, "problems");
  assert.deepEqual(large.problems, [{ key: "p", code: "petition_too_large" }]);

  // A system that takes the petition as a file like the others cuts a large one like any other.
  const projudi = planFiling([pdf("p", "petition", "Petição inicial", { bytes: 7 * MB, pages: 40 })], { maxFileBytes: 6 * MB });
  assert.equal(projudi.items[0].split, true);

  // A petition's own limit above the limit of a file: the smaller one is what the petition is measured against.
  const above = planFiling([pdf("p", "petition", "Petição inicial", { bytes: 5.5 * MB, pages: 40 })], {
    maxFileBytes: 5 * MB,
    maxPetitionBytes: 6 * MB,
  });
  assert.deepEqual(above.problems, [{ key: "p", code: "petition_too_large" }]);
});

test("a package has one petition: none, or two, is no package", () => {
  assert.equal(planFiling([pdf("i", "identity", "Documento de identidade")], { maxFileBytes: null }).blockedBy, "no_petition");
  assert.equal(planFiling([], { maxFileBytes: null }).blockedBy, "no_petition");
  assert.equal(
    planFiling([pdf("a", "petition", "Petição inicial"), pdf("b", "petition", "Petição inicial")], { maxFileBytes: null })
      .blockedBy,
    "two_petitions",
  );
});

test("a kind the package does not know goes last, as another document", () => {
  assert.equal(filingKindOf("selfie"), "other");
  assert.equal(FILING_ORDER[0], "petition");
  const plan = planFiling([pdf("x", "selfie", "Foto"), pdf("p", "petition", "Petição inicial")], { maxFileBytes: null });
  assert.deepEqual(
    plan.items.map((item) => [item.key, item.kind]),
    [
      ["p", "petition"],
      ["x", "other"],
    ],
  );
});
