// `node apps/web/extension/smoke.mjs`, after build.mjs: loads the built extension (apps/web/extension/dist) in
// Playwright's Chromium and drives it against a stand-in of the eproc's first filing step, served in place of
// eproc1g.tjrj.jus.br (no request reaches the court), with a frame of the same host, as the Projudi draws some
// screens. Checks: the content script runs in both frames, the path is recorded without what was typed, the screen
// is mapped, and the exported map holds no value, token or person. Then the same at eproc1g.tjsp.jus.br, whose map
// names its system.
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

// The first step of the eproc of TJSP, as its manual for lawyers draws it ("Da distribuição de inicial", 13/04/2026):
// in the small-claims rite it asks whether the plaintiff waives what exceeds the court's ceiling.
const PAGE_TJSP = `<!doctype html><html><head><title>eproc - TJSP</title></head><body>
  <h1>Peticionamento Eletrônico (1 de 5) - Informações do processo</h1>
  <label for="selRito">Rito:</label>
  <select id="selRito" name="selRito"><option value="">Selecione</option><option value="JE">JUIZADO ESPECIAL</option></select>
  <input id="chkRenuncia" name="chkRenuncia" type="checkbox"><label for="chkRenuncia">Renuncia valor excedente a 60 salários mínimos</label>
  <input type="hidden" name="hdnInfraHash" value="f0e1d2c3b4a5968778695a4b">
  <button type="button" id="btnProxima">Próxima &gt;</button>
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

  // The eproc of TJSP (2026-11-20): the same content script runs at its host, and the map names its system.
  await context.route("https://eproc1g.tjsp.jus.br/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_TJSP }),
  );
  const tjsp = await context.newPage();
  await tjsp.goto(
    "https://eproc1g.tjsp.jus.br/eproc/controlador.php?acao=processo_ajuizamento&hash=0a1b2c3d4e5f60718293",
  );
  await tjsp.locator("#chkRenuncia").waitFor();
  const tjspTab = await popup.evaluate(
    async () => (await chrome.tabs.query({ url: "https://eproc1g.tjsp.jus.br/*" }))[0]?.id,
  );
  assert.equal(typeof tjspTab, "number", "the TJSP tab is found");
  const capturedSp = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: "capture", tabId: id }), tjspTab);
  assert.equal(capturedSp.ok, true, "the TJSP screen is mapped");
  const fileSp = (await popup.evaluate(() => chrome.runtime.sendMessage({ type: "export" }))).file;
  assert.equal(fileSp.screens.length, 1);
  assert.equal(fileSp.screens[0].frames[0].system, "eproc-tjsp");
  assert.deepEqual(
    fileSp.systems.map((system) => system.key),
    ["eproc-tjsp"],
  );
  assert.ok(
    fileSp.screens[0].frames[0].fields.find((field) => field.id === "chkRenuncia"),
    "the TJSP field is mapped",
  );
  assert.ok(!JSON.stringify(fileSp).includes("0a1b2c3d4e5f60718293"), "the map holds no token of the address");
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "clear" }));

  // The popup on the court's page: what it says, with its words.
  const words = await popup.locator("main").innerText();
  console.log("popup words checked:", /Mapear esta tela|Abra o eproc/.test(words));
  console.log("extension smoke: ok", { steps: file.steps.length, fields: fields.length, tjsp: fileSp.screens.length });
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
