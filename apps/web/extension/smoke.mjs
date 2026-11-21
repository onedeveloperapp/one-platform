// `node apps/web/extension/smoke.mjs`: builds the extension calling a stand-in of ONE on this machine, loads it in
// Playwright's Chromium, and drives it against stand-ins of the court's screens served in place of the courts' hosts
// (no request reaches a court or ONE).
//
// Version 0.2, a filing: the lawyer links the extension with the code ONE showed them, sees the batch they approved,
// and starts it on the court's tab; ONE types the value of the cause, attaches the petition, stops before "Finalizar"
// for the lawyer's word (ONE still learns the eproc of TJSP), and once it is given sends the lawsuit, confirms the
// summary and brings back the number and the receipt, the path it learned holding no value nor person.
//
// Version 0.1, the diagnosis: both frames of a page mapped, the path recorded without what was typed, nothing of a
// value, a token or a person in the file, nothing recorded once stopped; then the eproc of TJSP, whose map names it.
/* global console, URL, chrome, Buffer, process */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "package.json"));
const { chromium } = require("playwright");

// ---------- A stand-in of ONE: the calls of the extension, kept in memory ----------

const TOKEN = `onex_${"s".repeat(43)}`;
const BATCH = "c2670000-0000-4000-8000-0000000000aa";
const FILING = "e2670000-0000-4000-8000-0000000000ee";
const PDF = Buffer.from("%PDF-1.4\n% stand-in of a petition\n%%EOF\n");
// Every person and number here is invented.
const FACTS = {
  fatos: [
    { chave: "processo.valor_causa", descricao: "Valor da causa, em reais", valor: "10.000,00" },
    { chave: "autor.1.nome", descricao: "Nome completo do autor 1" },
  ],
  partes: { autores: ["autor.1"], reus: ["reu.1"], representados: [] },
  arquivos: [{ posicao: 1, tipo: "Petição inicial", nome: "01-peticao-inicial.pdf" }],
  values: { "processo.valor_causa": "10.000,00", "autor.1.nome": "Marina Teste" },
};

const calls = [];
const one = { confirmed: false, handed: false, screens: [], path: null, result: null };

function plan(heading) {
  const T = (id) => `0|#${id}|0`;
  if (heading.includes("Informações")) {
    return {
      tela: { tipo: "formulario", titulo: heading },
      acoes: [
        { fazer: "preencher", alvo: T("txtValorCausa"), fato: "processo.valor_causa" },
        { fazer: "clicar", alvo: T("btnProxima") },
      ],
      pronto: true,
      pergunta: "",
    };
  }
  if (heading.includes("Documentos")) {
    return {
      tela: { tipo: "formulario", titulo: heading },
      acoes: [
        { fazer: "anexar", alvo: T("arquivo"), arquivo: 1 },
        { fazer: "clicar", alvo: T("btnFinalizar") },
      ],
      pronto: true,
      pergunta: "",
    };
  }
  if (heading.includes("Resumo")) {
    return one.confirmed
      ? {
          tela: { tipo: "resumo", titulo: heading },
          acoes: [{ fazer: "clicar", alvo: T("btnConfirmar"), envia: true }],
          pronto: true,
          pergunta: "",
        }
      : { tela: { tipo: "resumo", titulo: heading }, acoes: [], pronto: false, pergunta: "" };
  }
  if (heading.includes("distribuído"))
    return { tela: { tipo: "recibo", titulo: heading }, acoes: [], pronto: true, pergunta: "" };
  return null;
}

let base = "";
function answer(path, body) {
  // The code as the backend reads it: small letters and a dash as the lawyer typed them.
  if (path === "vincular")
    return String(body.code).toUpperCase().replace(/[s.-]/g, "") === "ABCDEFG"
      ? { ok: true, token: TOKEN, lawyer: "Ana Lima", firm: "Lima Advogados" }
      : { ok: false, error: "invalid_code" };
  if (path === "situacao") {
    return {
      ok: true,
      lawyer: "Ana Lima",
      firm: "Lima Advogados",
      batches: one.result
        ? []
        : [
            {
              id: BATCH,
              system: { key: "eproc-tjsp", name: "eproc do TJSP", host: "eproc1g.tjsp.jus.br" },
              status: "approved",
              packages: 1,
              left: 1,
              learning: true,
            },
          ],
    };
  }
  const [area, , action] = path.split("/");
  if (area === "lotes" && action === "iniciar") {
    return {
      ok: true,
      claim: 1,
      system: { key: "eproc-tjsp", name: "eproc do TJSP", host: "eproc1g.tjsp.jus.br" },
      learning: true,
      map: null,
    };
  }
  if (area === "lotes" && action === "proximo") {
    if (one.handed) return { ok: true, filing: null };
    one.handed = true;
    return {
      ok: true,
      filing: {
        id: FILING,
        claim: 1,
        learning: true,
        confirmed: false,
        caseSeq: 12,
        client: "Marina",
        facts: FACTS,
        files: [{ position: 1, name: "01-peticao-inicial.pdf", type: "application/pdf", url: `${base}/arquivo/1` }],
      },
    };
  }
  if (area === "lotes") return { ok: true, held: true, code: "done" };
  if (action === "tela") {
    one.screens.push(body.screen);
    return { ok: true, plan: plan(body.screen?.[0]?.headings?.[0] ?? "") };
  }
  if (action === "segurar") return { ok: true, code: "confirming" };
  if (action === "confirmar") {
    one.confirmed = true;
    return { ok: true, code: "confirmed" };
  }
  if (action === "estado") return { ok: true, status: "confirming", confirmed: false, batch: "awaiting_confirmation" };
  if (action === "enviando")
    return { ok: true, going: one.confirmed, code: one.confirmed ? "sending" : "awaits_confirmation" };
  if (action === "caminho") {
    one.path = body.steps;
    return { ok: true, saved: true };
  }
  if (action === "resultado") {
    one.result = body;
    return { ok: true, code: "filed" };
  }
  return { ok: false, error: "not_found" };
}

// ONE answers at an address of its own, which the browser serves from here: the extension's hosts hold it as they
// hold ONE's real one.
const ONE = "https://one-stand-in.invalid";
base = ONE;

/** Answers a request of the extension to the stand-in of ONE. */
function oneRoute(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/arquivo/1") return route.fulfill({ status: 200, contentType: "application/pdf", body: PDF });
  const path = url.pathname.replace(/^\/api\/extensao\/v1\//, "");
  const raw = request.postData();
  const body = raw ? JSON.parse(raw) : {};
  const linked = request.headers().authorization === `Bearer ${TOKEN}`;
  calls.push({ path: path.replace(/[0-9a-f-]{36}/g, ":id"), body });
  const result = path === "vincular" || linked ? answer(path, body) : { ok: false, error: "invalid_token" };
  return route.fulfill({
    status: result.ok ? 200 : 400,
    contentType: "application/json",
    body: JSON.stringify(result),
  });
}

// ---------- The extension, built to call the stand-in ----------

const dist = mkdtempSync(path.join(os.tmpdir(), "one-ext-dist-"));
execFileSync(process.execPath, [path.join(here, "build.mjs"), "--one", ONE, "--out", dist], { stdio: "inherit" });
const profile = mkdtempSync(path.join(os.tmpdir(), "one-ext-"));

// ---------- Stand-ins of the eproc of TJSP's screens of a new lawsuit ----------

const court = { values: [], files: [] };
const SCREEN = {
  processo_ajuizamento: `<h1>Peticionamento Eletrônico (1 de 5) - Informações do processo</h1>
    <form action="/eproc/controlador.php" method="get">
      <input type="hidden" name="acao" value="processo_ajuizamento_documentos">
      <input type="hidden" name="hash" value="0a1b2c3d4e5f60718293">
      <label for="txtValorCausa">Valor da causa</label>
      <input id="txtValorCausa" name="txtValorCausa" type="text">
      <button type="submit" id="btnProxima">Próxima</button>
    </form>`,
  processo_ajuizamento_documentos: `<h1>Peticionamento Eletrônico (5 de 5) - Documentos</h1>
    <form action="/eproc/controlador.php?acao=processo_ajuizamento_resumo" method="post" enctype="multipart/form-data">
      <label for="arquivo">Escolher arquivo</label>
      <input id="arquivo" name="arquivo" type="file">
      <button type="submit" id="btnFinalizar">Finalizar</button>
    </form>`,
  processo_ajuizamento_resumo: `<h1>Resumo do ajuizamento</h1>
    <form action="/eproc/controlador.php" method="get">
      <input type="hidden" name="acao" value="processo_ajuizamento_recibo">
      <button type="submit" id="btnConfirmar">Confirmar ajuizamento</button>
    </form>`,
  processo_ajuizamento_recibo: `<h1>Processo distribuído</h1>
    <p>Processo 1000123-07.2099.8.26.0100 distribuído ao 1º Juizado Especial Cível de São Paulo</p>`,
};

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
  await context.route(`${ONE}/**`, oneRoute);
  await context.route("https://eproc1g.tjsp.jus.br/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const acao = url.searchParams.get("acao") ?? "processo_ajuizamento";
    if (url.searchParams.has("txtValorCausa")) court.values.push(url.searchParams.get("txtValorCausa"));
    const posted = request.postDataBuffer();
    if (posted) {
      const found = /filename="([^"]+)"/.exec(posted.toString("latin1"));
      if (found) court.files.push(found[1]);
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><title>eproc - TJSP</title></head><body>${SCREEN[acao] ?? "<h1>?</h1>"}</body></html>`,
    });
  });
  await context.route("https://eproc1g.tjrj.jus.br/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: route.request().url().includes("frame.php") ? FRAME : PAGE,
    }),
  );
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  // ---------- Version 0.2: a batch filed in the lawyer's session ----------

  const tjsp = await context.newPage();
  await tjsp.goto(
    "https://eproc1g.tjsp.jus.br/eproc/controlador.php?acao=processo_ajuizamento&hash=0a1b2c3d4e5f60718293",
  );
  await tjsp.locator("#txtValorCausa").waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.locator("#view-link").waitFor({ state: "visible" });
  await panel.fill("#link-code", "abc-defg");
  await panel.click("#link-go");
  await panel.locator("#view-home").waitFor({ state: "visible" });
  assert.match(await panel.locator("#home-who").innerText(), /Ana Lima · Lima Advogados/);
  assert.match(await panel.locator("#home-batches").innerText(), /eproc do TJSP/);

  // The court's tab is the one in front, as when the lawyer works on it with the panel beside.
  await tjsp.bringToFront();
  await panel.locator("#home-batches button").click();
  await panel.locator("#run-word").waitFor({ state: "visible", timeout: 60_000 });
  assert.match(await panel.locator("#run-word-text").innerText(), /Finalizar/);
  // Nothing that may send was pressed before the lawyer's word: the court has the value, no file was posted yet.
  assert.deepEqual(court.values, ["10.000,00"]);
  assert.deepEqual(court.files, []);
  await panel.click("#run-word-go");
  await panel.locator("#view-end").waitFor({ state: "visible", timeout: 60_000 });
  assert.match(await panel.locator("#end-title").innerText(), /Lote protocolado no eproc do TJSP/);
  assert.match(await panel.locator("#end-text").innerText(), /1 ação protocolada/);

  assert.deepEqual(court.files, ["01-peticao-inicial.pdf"], "the petition reached the court's screen");
  // The readings of screens, the looks at the held filing and the claim kept fresh come as often as they come.
  const order = calls.map((call) => call.path).filter((name) => !/\/(tela|estado|manter)$/.test(name));
  assert.deepEqual(order, [
    "vincular",
    "situacao",
    "lotes/:id/iniciar",
    "lotes/:id/proximo",
    "envios/:id/segurar",
    "envios/:id/confirmar",
    "envios/:id/enviando",
    "envios/:id/caminho",
    "envios/:id/resultado",
    "lotes/:id/proximo",
    "lotes/:id/fim",
  ]);
  assert.equal(one.result.outcome, "filed");
  assert.equal(one.result.number, "10001230720998260100");
  assert.match(one.result.receipt, /distribuído ao 1º Juizado Especial Cível/);
  // What ONE's AI saw and what the platform keeps of the path: no value typed, no person, no token of the address.
  const seen = JSON.stringify({ screens: one.screens, path: one.path });
  for (const secret of ["10.000,00", "Marina", "0a1b2c3d4e5f60718293"])
    assert.ok(!seen.includes(secret), `nothing of ${secret}`);
  assert.equal(one.path.length, 4);
  assert.deepEqual(
    one.path.map((step) => step.tipo),
    ["formulario", "formulario", "resumo", "recibo"],
  );

  // ---------- Version 0.1: the diagnosis, through the same background ----------

  const tjrj = await context.newPage();
  await tjrj.goto(
    "https://eproc1g.tjrj.jus.br/eproc/controlador.php?acao=processo_ajuizamento&hash=9f8e7d6c5b4a39281706",
  );
  await tjrj.frameLocator("iframe").locator("#selMotivo").waitFor();
  const tabId = await panel.evaluate(
    async () => (await chrome.tabs.query({ url: "https://eproc1g.tjrj.jus.br/*" }))[0]?.id,
  );
  assert.equal(typeof tabId, "number", "the court's tab is found");

  const recording = await panel.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "record", tabId: id, on: true }),
    tabId,
  );
  assert.equal(recording.recording, true);
  await tjrj.fill("#txtValorCausa", "1500000");
  // The browser says the field changed when the focus leaves it, as when a person moves on.
  await tjrj.locator("#txtValorCausa").blur();
  await tjrj.selectOption("#selClasse", "436");
  await tjrj.selectOption("#selAdvogado", "1");
  await tjrj.frameLocator("iframe").locator("#selMotivo").selectOption("JEC");
  await tjrj.click("#btnProxima");
  await tjrj.waitForTimeout(500);

  const captured = await panel.evaluate((id) => chrome.runtime.sendMessage({ type: "capture", tabId: id }), tabId);
  assert.equal(captured.ok, true, "the screen is mapped");
  assert.equal(captured.last, "Peticionamento Eletrônico (1 de 5) - Informações do processo");
  const file = (await panel.evaluate(() => chrome.runtime.sendMessage({ type: "export" }))).file;
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
  assert.deepEqual(
    file.steps.filter((step) => step.event !== "page").map((step) => [step.event, step.selector, step.option]),
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
  const stopped = await panel.evaluate(
    (id) => chrome.runtime.sendMessage({ type: "record", tabId: id, on: false }),
    tabId,
  );
  assert.equal(stopped.recording, false);
  await tjrj.click("#btnProxima");
  await tjrj.waitForTimeout(300);
  const after = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "status" }));
  assert.equal(after.steps, file.steps.length, "nothing is recorded once stopped");
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: "clear" }));
  const cleared = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "status" }));
  assert.deepEqual([cleared.screens, cleared.steps, cleared.recording], [0, 0, false]);

  console.log("extension smoke: ok", { calls: calls.length, steps: file.steps.length, fields: fields.length });
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
}
