// `node apps/web/clock/navegador-smoke.mjs`: ONE's own browser (lib/court-browser/worker.ts) in a real Chromium, against
// stand-ins of the eproc of TJSP and of the court's single sign-on served in place of their hosts, and a stand-in of
// ONE's backend kept in memory (no request reaches a court or ONE).
//
// First a login a lawyer just gave is checked: ONE signs in and stops where the court asks its code, and the court
// took it; a wrong password is refused and never tried again. Then a batch: ONE signs in with the lawyer's login, asks
// the lawyer the court's code through ONE (the first one the court refuses, the second it takes), finds the screen of
// a new lawsuit from the lawyer's panel, types the value of the cause, attaches the petition, and, ONE still learning
// the eproc of TJSP, holds the filing before "Finalizar" with a picture of the court's screen for the lawyer's word in
// ONE; once it is given, it sends the lawsuit, answers yes to the court's "confirma?" on that press only, and brings
// back the number and the court's screen printed as the receipt. The browser is the Chromium Playwright runs, as it is.
/* global console, URL, URLSearchParams, Buffer, process, setTimeout */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const require = createRequire(path.join(web, "package.json"));
const { build } = require("esbuild");
const { chromium } = require("playwright");

// ---------- ONE's browser, bundled from its source as the server's bundle is ----------

const temp = mkdtempSync(path.join(os.tmpdir(), "one-navegador-"));
const stub = {
  name: "stubs",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
  },
};
await build({
  stdin: {
    contents: 'export { courtBrowser } from "@/lib/court-browser/worker";',
    resolveDir: web,
    sourcefile: "smoke-entry.ts",
    loader: "ts",
  },
  outfile: path.join(temp, "worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  tsconfig: path.join(web, "tsconfig.json"),
  external: ["playwright-core"],
  plugins: [stub],
  logLevel: "warning",
});
await build({
  entryPoints: [path.join(web, "src/lib/court-browser/page-script.ts")],
  outfile: path.join(temp, "pagina.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  tsconfig: path.join(web, "tsconfig.json"),
  logLevel: "warning",
});
const { courtBrowser } = await import(pathToFileURL(path.join(temp, "worker.mjs")).href);
const pageScript = readFileSync(path.join(temp, "pagina.js"), "utf8");

// ---------- Stand-ins of the court's sign-on and of the eproc of TJSP ----------

// Every person and number here is invented.
const LOGIN = "52998224725";
const SENHA = "senha de teste";
const CODES = ["918273", "564738"];
const EPROC = "https://eproc1g.tjsp.jus.br";
const SSO = "https://sso.tjsp.jus.br";
const court = {
  paths: [],
  agents: [],
  typed: { valor: null },
  files: [],
  otps: [],
  confirmations: 0,
  receipts: 0,
  strays: [],
};

const html = (title, body) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const LOGIN_PAGE = (error) =>
  html(
    "Entrar",
    `<h1>Tribunal de Justiça de São Paulo</h1>
    <form id="kc-form-login" action="${SSO}/realms/eproc/login-actions/authenticate" method="post">
      <label for="username">CPF</label><input id="username" name="username" type="text">
      <label for="password">Senha</label><input id="password" name="password" type="password">
      ${error ? '<span id="input-error" class="kc-feedback-text" aria-live="polite">Usuário ou senha inválidos.</span>' : ""}
      <input id="kc-login" name="login" type="submit" value="Entrar">
      <button type="button" id="kc-login-certificate">Certificado digital</button>
    </form>`,
  );

const OTP_PAGE = (error) =>
  html(
    "Autenticação",
    `<form id="kc-otp-login-form" action="${SSO}/realms/eproc/login-actions/otp" method="post">
      <label for="otp">Código de autenticação</label><input id="otp" name="otp" type="text" autocomplete="off">
      ${error ? '<span id="input-error" class="kc-feedback-text" aria-live="polite">Código de autenticação inválido.</span>' : ""}
      <input id="kc-login" type="submit" value="Entrar">
    </form>`,
  );

const SCREEN = {
  painel_advogado: html(
    "eproc",
    `<h1>Painel do advogado</h1>
    <a id="lnkPeticaoInicial" href="/eproc/controlador.php?acao=processo_ajuizamento">Petição inicial</a>`,
  ),
  processo_ajuizamento: html(
    "eproc",
    `<h1>Peticionamento Eletrônico (1 de 5) - Informações do processo</h1>
    <form action="/eproc/controlador.php" method="get">
      <input type="hidden" name="acao" value="processo_ajuizamento_documentos">
      <label for="txtValorCausa">Valor da causa</label><input id="txtValorCausa" name="txtValorCausa" type="text">
      <button type="submit" id="btnProxima">Próxima</button>
    </form>`,
  ),
  processo_ajuizamento_documentos: html(
    "eproc",
    `<h1>Peticionamento Eletrônico (5 de 5) - Documentos</h1>
    <form action="/eproc/controlador.php?acao=processo_ajuizamento_resumo" method="post" enctype="multipart/form-data">
      <label for="arquivo">Escolher arquivo</label><input id="arquivo" name="arquivo" type="file">
      <button type="submit" id="btnFinalizar">Finalizar</button>
    </form>`,
  ),
  processo_ajuizamento_resumo: html(
    "eproc",
    `<h1>Resumo do ajuizamento</h1>
    <form action="/eproc/controlador.php" method="get" onsubmit="return confirm('Confirma o ajuizamento?')">
      <input type="hidden" name="acao" value="processo_ajuizamento_recibo">
      <button type="submit" id="btnConfirmar">Confirmar ajuizamento</button>
    </form>`,
  ),
  processo_ajuizamento_recibo: html(
    "eproc",
    `<h1>Processo distribuído</h1>
    <p>Processo 1000123-07.2099.8.26.0100 distribuído ao 1º Juizado Especial Cível de São Paulo</p>`,
  ),
};

const fields = (body) => Object.fromEntries(new URLSearchParams(body ?? ""));

/** The court's answers, in place of its hosts. */
async function courtRoute(route) {
  const request = route.request();
  const url = new URL(request.url());
  court.agents.push(request.headers()["user-agent"] ?? "");
  const acaoOf = url.searchParams.get("acao");
  court.paths.push(`${request.method()} ${url.hostname}${url.pathname}${acaoOf ? `?${acaoOf}` : ""}`);
  const page = (body) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  // Never an HTTP redirect: the browser follows one outside the routes, to the real host. The page moves on itself.
  const go = (location) =>
    page(html("Redirecionando", `<script>location.replace(${JSON.stringify(location)})</script>`));

  if (url.origin === EPROC && url.pathname === "/eproc/") {
    return go(`${SSO}/realms/eproc/protocol/openid-connect/auth?client_id=eproc1g.tjsp.jus.br`);
  }
  if (url.origin === SSO && url.pathname.endsWith("/openid-connect/auth")) return page(LOGIN_PAGE(false));
  if (url.origin === SSO && url.pathname.endsWith("/login-actions/authenticate")) {
    const given = fields(request.postData());
    return page(given.username === LOGIN && given.password === SENHA ? OTP_PAGE(false) : LOGIN_PAGE(true));
  }
  if (url.origin === SSO && url.pathname.endsWith("/login-actions/otp")) {
    const given = fields(request.postData());
    court.otps.push(given.otp);
    return given.otp === "564738" ? go(`${EPROC}/eproc/controlador.php?acao=painel_advogado`) : page(OTP_PAGE(true));
  }
  if (url.origin === EPROC && url.pathname === "/eproc/controlador.php") {
    const acao = url.searchParams.get("acao") ?? "";
    if (acao === "processo_ajuizamento_documentos") court.typed.valor = url.searchParams.get("txtValorCausa");
    if (acao === "processo_ajuizamento_resumo") {
      const body = request.postDataBuffer()?.toString("latin1") ?? "";
      const name = /filename="([^"]+)"/.exec(body)?.[1];
      if (name) court.files.push(name);
    }
    if (acao === "processo_ajuizamento_recibo") court.receipts += 1;
    const screen = SCREEN[acao];
    if (screen) return page(screen);
  }
  court.strays.push(url.origin);
  return route.abort();
}

// ---------- A stand-in of ONE's backend, kept in memory ----------

const PDF = Buffer.from("%PDF-1.4\n% stand-in of a petition\n%%EOF\n");
const FACTS = {
  fatos: [{ chave: "processo.valor_causa", descricao: "Valor da causa, em reais", valor: "10.000,00" }],
  partes: { autores: ["autor.1"], reus: ["reu.1"], representados: [] },
  arquivos: [{ posicao: 1, tipo: "Petição inicial", nome: "01-peticao-inicial.pdf" }],
  values: { "processo.valor_causa": "10.000,00" },
};
const SYSTEM = {
  key: "eproc-tjsp",
  name: "eproc do TJSP",
  host: "eproc1g.tjsp.jus.br",
  startPath: "/eproc/",
  loginKind: "password_app",
};
const BATCH = {
  batchId: "c2680000-0000-4000-8000-0000000000aa",
  claim: 1,
  orgId: "o1",
  personId: "p1",
  system: SYSTEM,
  learning: true,
};
const FILING = "e2680000-0000-4000-8000-0000000000ee";

const one = {
  checks: [
    { orgId: "o1", connectionId: "login-certo", system: SYSTEM, login: LOGIN, senha: SENHA },
    { orgId: "o1", connectionId: "login-errado", system: SYSTEM, login: LOGIN, senha: "outra senha" },
  ],
  batches: [BATCH],
  checked: [],
  asked: [],
  given: 0,
  finished: [],
  calls: [],
  held: null,
  heldAt: 0,
  screens: [],
  result: null,
  pdf: null,
  picture: null,
  saved: null,
  handed: false,
};

const yes = (value) => Promise.resolve({ ok: true, value });

function plan(heading) {
  const T = (id) => `0|#${id}|0`;
  const step = (tipo, acoes) => ({ tela: { tipo, titulo: heading }, acoes, pronto: true, pergunta: "" });
  if (heading.includes("Painel")) return step("outra", [{ fazer: "clicar", alvo: T("lnkPeticaoInicial") }]);
  if (heading.includes("Informações"))
    return step("formulario", [
      { fazer: "preencher", alvo: T("txtValorCausa"), fato: "processo.valor_causa" },
      { fazer: "clicar", alvo: T("btnProxima") },
    ]);
  if (heading.includes("Documentos"))
    return step("formulario", [
      { fazer: "anexar", alvo: T("arquivo"), arquivo: 1 },
      { fazer: "clicar", alvo: T("btnFinalizar") },
    ]);
  if (heading.includes("Resumo")) return step("resumo", [{ fazer: "clicar", alvo: T("btnConfirmar"), envia: true }]);
  if (heading.includes("distribuído")) return step("recibo", []);
  return null;
}

const backend = {
  claimCheck: async () => one.checks.shift() ?? null,
  checked: async (check, outcome) => void one.checked.push({ connection: check.connectionId, outcome }),
  claimBatch: async () => one.batches.shift() ?? null,
  started: async () => ({ claim: 1, system: SYSTEM, learning: true, map: null, mapId: null }),
  openLogin: async () => ({ ok: true, connectionId: "login-certo", login: LOGIN, senha: SENHA }),
  askCode: async (_batch, kind) => {
    one.asked.push(kind);
    return true;
  },
  // The lawyer types each code in ONE a moment after it is asked.
  takeCode: async () =>
    one.given < one.asked.length ? { kind: "code", code: CODES[one.given++] ?? "999999" } : { kind: "none" },
  batchStatus: async () => "awaiting_code",
  touch: async () => undefined,
  finish: async (_batch, why) => void one.finished.push(why),
  beat: async () => undefined,
  api: (_batch, _started, hooks) => {
    const record = (name, args) => one.calls.push({ name, args });
    return {
      link: async () => ({ ok: false, error: "unused" }),
      situation: async () => ({ ok: false, error: "unused" }),
      start: async () => ({ ok: false, error: "unused" }),
      confirm: async () => ({ ok: false, error: "not_linked" }),
      next: async (...args) => {
        record("next", args);
        if (one.handed) return yes({ filing: null });
        one.handed = true;
        return yes({
          filing: {
            id: FILING,
            claim: 1,
            learning: true,
            confirmed: false,
            caseSeq: 12,
            client: "Marina",
            facts: FACTS,
            files: [{ position: 1, name: "01-peticao-inicial.pdf", type: "application/pdf", url: "one://arquivo/1" }],
          },
        });
      },
      keep: async (...args) => (record("keep", args), yes({ held: true })),
      finish: async (...args) => {
        record("finish", args);
        one.finished.push(args[2]);
        return yes({ code: args[2] ? "stopped" : "done" });
      },
      plan: async (...args) => {
        record("plan", args);
        one.screens.push(args[2]);
        return yes({ plan: plan(args[2]?.[0]?.headings?.[0] ?? "") });
      },
      hold: async (...args) => {
        record("hold", args);
        one.picture = await hooks.screenshot();
        one.heldAt = Date.now();
        return yes({ code: "confirming" });
      },
      // The lawyer confirms in ONE two seconds after the filing was held, the court's screen in front of them.
      state: async (...args) => {
        record("state", args);
        const confirmed = one.heldAt > 0 && Date.now() - one.heldAt > 2_000;
        return yes(
          confirmed
            ? { status: "claimed", confirmed: true, batch: "running" }
            : { status: "confirming", confirmed: false, batch: "awaiting_confirmation" },
        );
      },
      sending: async (...args) => {
        record("sending", args);
        const confirmed = one.heldAt > 0 && Date.now() - one.heldAt > 2_000;
        return yes({ going: confirmed, code: confirmed ? "sending" : "awaits_confirmation" });
      },
      path: async (...args) => {
        record("path", args);
        one.saved = args[2];
        return yes({ saved: true });
      },
      result: async (...args) => {
        record("result", args);
        one.result = args[2];
        one.pdf = await hooks.receipt();
        return yes({ code: "filed" });
      },
    };
  },
};

// ---------- The run ----------

const events = [];
const browser = await chromium.launch({ headless: true });
let failed = null;
try {
  const worker = courtBrowser({
    backend,
    launch: async () => browser,
    pageScript,
    log: (event, data) => events.push({ event, ...data }),
    prepare: async (context) => {
      await context.route("**/*", courtRoute);
    },
    fetchFile: async (url) => (url === "one://arquivo/1" ? new Uint8Array(PDF) : null),
    codeMostMs: 20_000,
    wordMostMs: 60_000,
  });

  // A login a lawyer just gave, and then one with a wrong password.
  assert.equal(await worker.turn(), true);
  assert.equal(await worker.turn(), true);
  assert.deepEqual(one.checked, [
    { connection: "login-certo", outcome: "verified" },
    { connection: "login-errado", outcome: "refused" },
  ]);
  assert.deepEqual(one.asked, [], "a check never asks the lawyer the court's code");
  assert.deepEqual(court.otps, [], "a check types no code");

  // The batch.
  assert.equal(await worker.turn(), true);
  assert.equal(await worker.turn(), false, "nothing else waits");

  assert.deepEqual(one.asked, ["app", "app"], "the court's code asked again after the court refused the first");
  assert.deepEqual(court.otps, ["918273", "564738"]);
  assert.equal(court.typed.valor, "10.000,00");
  assert.deepEqual(court.files, ["01-peticao-inicial.pdf"]);
  assert.equal(court.receipts, 1, "the lawsuit went once");

  const names = one.calls.map((call) => call.name).filter((name) => !["plan", "state", "keep"].includes(name));
  assert.deepEqual(names, ["next", "hold", "sending", "path", "result", "next", "finish"]);
  // Held before "Finalizar" with the court's screen as a picture, before anything was sent.
  assert.ok(one.picture && one.picture.length > 1000, "the court's screen kept for the lawyer's word");
  assert.equal(Buffer.from(one.picture.subarray(0, 8)).toString("latin1"), "\x89PNG\r\n\x1a\n");
  assert.equal(one.result.outcome, "filed");
  assert.equal(one.result.number, "10001230720998260100");
  assert.ok(one.pdf && Buffer.from(one.pdf.subarray(0, 5)).toString("latin1") === "%PDF-", "the receipt printed");
  assert.deepEqual(one.finished, [null], "the batch ended done");

  // The path ONE learned names screens and facts, never a value, a login or a person.
  const path_ = JSON.stringify(one.saved);
  for (const secret of [LOGIN, SENHA, "564738", "10.000,00", "Marina"]) {
    assert.ok(!path_.includes(secret), `the path holds no "${secret}"`);
  }
  // Nothing the lawyer gave reached the AI's screens, nor the log.
  const seen = JSON.stringify(one.screens) + JSON.stringify(events);
  for (const secret of [LOGIN, SENHA, "918273", "564738"]) {
    assert.ok(!seen.includes(secret), `"${secret}" never read by the AI nor logged`);
  }
  // The court's "confirma?" was answered yes on the press that sends.
  const ended = events.find((event) => event.event === "batch_ended");
  assert.deepEqual(ended?.dialogs, { yes: 1, no: 0 });
  // The browser does not disguise itself, and nothing left for another host.
  assert.ok(
    court.agents.every((agent) => agent.includes("HeadlessChrome")),
    "the browser says what it is",
  );
  assert.deepEqual(court.strays, []);
} catch (error) {
  failed = error;
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
if (failed) {
  console.error("events:", JSON.stringify(events, null, 1));
  console.error("court:", JSON.stringify({ paths: court.paths, otps: court.otps, typed: court.typed }, null, 1));
  throw failed;
}
console.log("navegador smoke: ok", {
  checks: one.checked.length,
  codes: court.otps.length,
  screens: one.screens.length,
  picture: one.picture.length,
  receipt: one.pdf.length,
});
setTimeout(() => process.exit(0), 0);
