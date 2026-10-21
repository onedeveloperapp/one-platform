import assert from "node:assert/strict";
import test from "node:test";

import { checkTemplate, isWindowOpen, paramCountOf, placeholdersOf, renderTemplate, type TemplateDraft } from "./rules.ts";

const found = (draft: TemplateDraft) => checkTemplate(draft).map((finding) => `${finding.severity}:${finding.code}`);

const draft = (changes: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: "aviso_de_audiencia",
  category: "utility",
  body: "Olá, {{1}}. Sua audiência está marcada para {{2}}.",
  headerText: null,
  footerText: "Responda SAIR para não receber mais.",
  ...changes,
});

test("free text is open for 24 hours after the person's last message, and closed when the person never wrote", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(isWindowOpen(null, now), false);
  assert.equal(isWindowOpen(undefined, now), false);
  assert.equal(isWindowOpen("isto não é uma data", now), false);

  assert.equal(isWindowOpen("2026-10-09T11:59:00Z", now), true);
  assert.equal(isWindowOpen(new Date("2026-10-08T12:00:01Z"), now), true);
  // At exactly 24 hours it is closed, as in the database (`wa_window_open`).
  assert.equal(isWindowOpen("2026-10-08T12:00:00Z", now), false);
  assert.equal(isWindowOpen("2026-10-07T12:00:00Z", now), false);

  // The length of the window is configuration, not a constant of the screen.
  assert.equal(isWindowOpen("2026-10-09T10:30:00Z", now, 60 * 60 * 1000), false);
  assert.equal(isWindowOpen("2026-10-09T11:30:00Z", now, 60 * 60 * 1000), true);
});

test("the values of a template go where its placeholders are, in order", () => {
  const body = "Olá, {{1}}. Sua audiência é em {{2}}. Até lá, {{ 1 }}.";
  assert.deepEqual(placeholdersOf(body), [1, 2, 1]);
  assert.equal(paramCountOf(body), 2);
  assert.equal(
    renderTemplate(body, ["Maria", "12 de novembro"]),
    "Olá, Maria. Sua audiência é em 12 de novembro. Até lá, Maria.",
  );

  // A value that is missing leaves its placeholder in sight, never a hole in the sentence.
  assert.equal(renderTemplate("Olá, {{1}}. Dia {{2}}.", ["Maria"]), "Olá, Maria. Dia {{2}}.");
  assert.equal(paramCountOf("Sem valores."), 0);
  // A named placeholder is not a numbered one: the values are given in order.
  assert.deepEqual(placeholdersOf("Olá, {{nome}}."), []);
});

test("a template within the vendor's limits and with no word to weigh has nothing to report", () => {
  assert.deepEqual(found(draft()), []);
  assert.deepEqual(found(draft({ headerText: "Audiência de {{1}}", footerText: null })), []);
});

test("what the vendor would refuse is an error, each with its own code", () => {
  assert.deepEqual(found(draft({ name: "Aviso de Audiência" })), ["error:invalid_name"]);
  assert.deepEqual(found(draft({ name: "a".repeat(513) })), ["error:invalid_name"]);
  assert.deepEqual(found(draft({ name: "" })), ["error:invalid_name"]);
  assert.deepEqual(found(draft({ category: "service" })), ["error:invalid_category"]);
  assert.deepEqual(found(draft({ body: "   " })), ["error:empty_body"]);
  assert.deepEqual(found(draft({ body: "a".repeat(1025) })), ["error:body_too_long"]);
  assert.deepEqual(found(draft({ body: "a".repeat(1024) })), []);
  assert.deepEqual(found(draft({ headerText: "a".repeat(61) })), ["error:header_too_long"]);
  assert.deepEqual(found(draft({ headerText: "{{1}} e {{2}}" })), ["error:header_too_many_values"]);
  assert.deepEqual(found(draft({ footerText: "a".repeat(61) })), ["error:footer_too_long"]);
  assert.deepEqual(found(draft({ footerText: "Até {{1}}." })), ["error:footer_with_value"]);
});

test("the placeholders of the body run from 1 with no gap, because the values are given in order", () => {
  assert.deepEqual(found(draft({ body: "Olá, {{2}}." })), ["error:placeholders_not_in_sequence"]);
  assert.deepEqual(found(draft({ body: "Olá, {{1}}. Dia {{3}}." })), ["error:placeholders_not_in_sequence"]);
  assert.deepEqual(found(draft({ body: "Dia {{2}}, {{1}}." })), []);
  assert.deepEqual(found(draft({ body: "Sem valores." })), []);
});

test("a promise of result, a word about price and the marketing category are pointed at, never refused", () => {
  assert.deepEqual(found(draft({ body: "Sua indenização é garantida, {{1}}." })), ["warning:promises_result"]);
  assert.deepEqual(found(draft({ body: "Olá, {{1}}. É causa ganha." })), ["warning:promises_result"]);
  assert.deepEqual(found(draft({ body: "Olá, {{1}}. Você tem 100% de chance." })), ["warning:promises_result"]);
  assert.deepEqual(found(draft({ body: "Análise GRÁTIS do seu voo, {{1}}." })), ["warning:speaks_of_price"]);
  assert.deepEqual(found(draft({ body: "Olá, {{1}}. Não cobramos honorários antes do resultado." })), [
    "warning:speaks_of_price",
  ]);
  assert.deepEqual(found(draft({ category: "marketing" })), ["warning:marketing_category"]);

  // A word that only contains one of them is not one of them.
  assert.deepEqual(found(draft({ body: "Olá, {{1}}. O embarque foi gratificante." })), []);
  // Every finding is a warning here: nothing stops the lawyer who weighed it.
  assert.equal(
    checkTemplate(draft({ category: "marketing", body: "Consulta gratuita e vitória certa, {{1}}." })).every(
      (finding) => finding.severity === "warning",
    ),
    true,
  );
});
