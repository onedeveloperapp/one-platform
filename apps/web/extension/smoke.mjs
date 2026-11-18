// `node apps/web/extension/smoke.mjs`, after build.mjs: loads the built extension (apps/web/extension/dist) in
// Playwright's Chromium and drives it against a stand-in of the eproc's first filing step, served in place of
// eproc1g.tjrj.jus.br (no request reaches the court), with a frame of the same host, as the Projudi draws some
// screens. Checks: the content script runs in both frames, the path is recorded without what was typed, the screen
// is mapped, and the exported map holds no value, token or person.
/* global console, URL, chrome */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "package.json"));
const { chromium } = require("playwright");

const dist = path.join(here, "dist");
const profile = mkdtempSync(path.join(os.tmpdir(), "one-ext-"));

const FRAME = `<!doctype html><html><head><title>Documentos</title></head><body>
  <h2>Informações de Custas</h2>
  <label for="selMotivo">Motivo para não recolhimento:</label>
  <select id="selMotivo" name="selMotivo"><option value="">Selecione</option><option value="JEC">Juizado Especial</option></select>
</body></html>`;

const PAGE = `<!doctype html><html><head><title>eproc - TJRJ</title></head><body>
  <h1>Peticionamento Eletrônico (1 de 5) - Informações do processo</h1>
  <label for="selClasse">Classe processual:</label>
  <select id="selClasse" name="selClasse"><option value="">Selecione</option><option value="436">PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL</option></select>
  <label for="txtValorCausa">Valor da Causa: (R$) (Somente números)</label>
  <input id="txtValorCausa" name="txtValorCausa" type="text">
  <span>Advogado:</span><select id="selAdvogado" name="selAdvogado"><option value="1">Ana Souza</option></select>
  <input type="hidden" name="hdnInfraHash" value="a1b2c3d4e5f6a7b8c9d0">
  <button type="button" id="btnProxima">Próxima &gt;</button>
  <iframe src="https://eproc1g.tjrj.jus.br/eproc/frame.php?acao=custas"></iframe>
</body></html>`;

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  await context.route("https://eproc1g.tjrj.jus.br/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: route.request().url().includes("frame.php") ? FRAME : PAGE,
    }),
  );
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  const court = await context.newPage();
  await court.goto(
    "https://eproc1g.tjrj.jus.br/eproc/controlador.php?acao=processo_ajuizamento&hash=9f8e7d6c5b4a39281706",
  );
  await court.frameLocator("iframe").locator("#selMotivo").waitFor();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await popup.evaluate(
    async () => (await chrome.tabs.query({ url: "https://eproc1g.tjrj.jus.br/*" }))[0]?.id,
  );
  assert.equal(typeof tabId, "number", "the court's tab is found");

  const recording = await popup.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "record", tabId: id, on: true }),
    tabId,
  );
  assert.equal(recording.recording, true);

  await court.fill("#txtValorCausa", "1500000");
  // The browser says the field changed when the focus leaves it, as when a person moves on.
  await court.locator("#txtValorCausa").blur();
  await court.selectOption("#selClasse", "436");
  await court.selectOption("#selAdvogado", "1");
  await court.frameLocator("iframe").locator("#selMotivo").selectOption("JEC");
  await court.click("#btnProxima");
  await court.waitForTimeout(500);

  const captured = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: "capture", tabId: id }), tabId);
  assert.equal(captured.ok, true, "the screen is mapped");
  assert.equal(captured.last, "Peticionamento Eletrônico (1 de 5) - Informações do processo");

  const exported = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "export" }));
  const file = exported.file;
  const text = JSON.stringify(file);
  assert.equal(file.screens.length, 1);
  assert.equal(file.screens[0].frames.length, 2, "both frames of the page are mapped");
  const fields = file.screens[0].frames.flatMap((frame) => frame.fields);
  assert.deepEqual(
    fields.find((field) => field.id === "selClasse").options.map((option) => option.value),
    ["", "436"],
  );
  assert.ok(
    fields.find((field) => field.id === "selMotivo"),
    "the frame's field is mapped",
  );
  assert.deepEqual(file.screens[0].frames[0].params, { acao: "processo_ajuizamento" });
  const steps = file.steps.map((step) => [step.event, step.selector, step.option]);
  assert.deepEqual(
    steps.filter(([event]) => event !== "page"),
    [
      ["change", "#txtValorCausa", null],
      ["change", "#selClasse", "436"],
      ["change", "#selAdvogado", null],
      ["change", "#selMotivo", "JEC"],
      ["click", "#btnProxima", null],
    ],
  );
  for (const secret of ["1500000", "a1b2c3d4e5f6a7b8c9d0", "9f8e7d6c5b4a39281706", "Ana Souza", "hdnInfraHash"]) {
    assert.ok(!text.includes(secret), `the map holds no ${secret}`);
  }

  const stopped = await popup.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "record", tabId: id, on: false }),
    tabId,
  );
  assert.equal(stopped.recording, false);
  await court.click("#btnProxima");
  await court.waitForTimeout(300);
  const after = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "status" }));
  assert.equal(after.steps, file.steps.length, "nothing is recorded once stopped");

  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "clear" }));
  const cleared = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "status" }));
  assert.deepEqual([cleared.screens, cleared.steps, cleared.recording], [0, 0, false]);

  // The popup on the court's page: what it says, with its words.
  const words = await popup.locator("main").innerText();
  console.log("popup words checked:", /Mapear esta tela|Abra o Projudi/.test(words));
  console.log("extension smoke: ok", { steps: file.steps.length, fields: fields.length });
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
