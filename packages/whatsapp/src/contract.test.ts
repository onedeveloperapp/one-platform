import assert from "node:assert/strict";
import test from "node:test";

import {
  exchangeSignupCode,
  getNumberInfo,
  listAccountNumbers,
  MetaProvider,
  registerNumber,
  requestCoexistenceSync,
  sendErrorOf,
  subscribeApp,
  toAccountTemplate,
  unsubscribeApp,
  vendorFailureCode,
} from "./providers/meta.ts";
import { failureCodeOf } from "./rules.ts";
import { SimulatorProvider } from "./simulator.ts";
import type { OutboundMessage, WhatsAppProvider } from "./types.ts";

/**
 * The contract every WhatsApp provider keeps, run against the simulator and
 * against the Cloud API provider answering from the vendor's own response
 * shapes. Those shapes were copied from the Cloud API reference on 2026-10-09
 * (ids and tokens replaced by invented ones); none was recorded from a live
 * call, because ONE has no Meta app yet. When it has one, the same tests take
 * the recordings.
 */

// ---------- The vendor's answers, as its reference documents them ----------

const SENT = {
  messaging_product: "whatsapp",
  contacts: [{ input: "5562999990001", wa_id: "5562999990001" }],
  messages: [{ id: "wamid.HBgNNTU2Mjk5OTk5MDAwMRUCABEYEjdGQTU4QjQ5QzA5RTJBNkYwRgA=" }],
};

const graphError = (code: number, message: string, subcode?: number) => ({
  error: {
    message: `(#${code}) ${message}`,
    type: "OAuthException",
    code,
    ...(subcode ? { error_subcode: subcode } : {}),
    error_data: { messaging_product: "whatsapp", details: message },
    fbtrace_id: "AbCdEfGhIjKlMnOpQrStUv",
  },
});

const TEMPLATES_PAGE_1 = {
  data: [
    {
      name: "retomar_conversa",
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      id: "1001",
      components: [
        { type: "HEADER", format: "TEXT", text: "Seu atendimento" },
        { type: "BODY", text: "Olá, {{1}}. Aqui é do escritório {{2}}. Podemos continuar por aqui?" },
        { type: "FOOTER", text: "Responda SAIR para não receber mais." },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sim" }] },
      ],
    },
    {
      name: "foto_do_escritorio",
      language: "pt_BR",
      status: "PENDING",
      category: "MARKETING",
      id: "1002",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Conheça o nosso escritório." },
      ],
    },
    // A template with no body text (an authentication one keeps its text at the vendor).
    { name: "codigo_de_acesso", language: "pt_BR", status: "APPROVED", category: "AUTHENTICATION", id: "1003", components: [{ type: "BODY" }] },
  ],
  paging: { cursors: { before: "MAZDZD", after: "MjQZD" }, next: "https://graph.facebook.com/v25.0/waba-1/message_templates?after=MjQZD" },
};

const TEMPLATES_PAGE_2 = {
  data: [
    {
      name: "aviso_de_audiencia",
      language: "pt_BR",
      status: "REJECTED",
      category: "UTILITY",
      id: "1004",
      components: [{ type: "BODY", text: "Olá, {{1}}. Sua audiência é em {{2}}." }],
    },
  ],
  paging: { cursors: { before: "MjQZD", after: "MzQZD" } },
};

// ---------- A network that answers from a script ----------

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function scripted(answers: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const run = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected call to ${call.url}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(call) : answer;
  }) as typeof fetch;
  return { fetch: run, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const meta = (answers: Parameters<typeof scripted>[0]) => {
  const network = scripted(answers);
  const provider = new MetaProvider({
    accessToken: "token-do-escritorio",
    phoneNumberId: "phone-1",
    wabaId: "waba-1",
    apiVersion: "v25.0",
    fetch: network.fetch,
  });
  return { provider, calls: network.calls };
};

const TEXT: OutboundMessage = { kind: "text", text: "Bom dia, Maria." };

// ---------- The contract, for every provider ----------

const providers: { name: string; build: () => WhatsAppProvider; refused: () => WhatsAppProvider }[] = [
  { name: "simulator", build: () => new SimulatorProvider(), refused: () => new SimulatorProvider() },
  {
    name: "meta",
    build: () => meta([json(SENT), json(TEMPLATES_PAGE_2)]).provider,
    // Any call made for a recipient that is no number would be a bug: the script is empty.
    refused: () => meta([]).provider,
  },
];

for (const { name, build, refused } of providers) {
  test(`${name}: a reserved message is carried and answered with the vendor's id`, async () => {
    const provider = build();
    assert.equal(provider.name, name);
    const result = await provider.send("+55 (62) 99999-0001", TEXT);
    assert.equal(result.ok, true);
    assert.match(result.ok ? result.providerMessageId : "", /^wamid\./);
  });

  test(`${name}: a destination that is no number is refused before anything is sent`, async () => {
    const provider = refused();
    for (const to of ["", "abc", "12345", "1".repeat(16)]) {
      assert.deepEqual(await provider.send(to, TEXT), { ok: false, error: "invalid_recipient" });
    }
  });

  test(`${name}: the account's templates come in ONE's own words`, async () => {
    const provider = name === "meta" ? meta([json(TEMPLATES_PAGE_2)]).provider : build();
    const templates = await provider.listTemplates();
    assert.ok(templates.length > 0);
    for (const template of templates) {
      assert.match(template.name, /^[a-z0-9_]+$/);
      assert.match(template.language, /^[a-z]{2}(_[A-Z]{2})?$/);
      assert.ok(["marketing", "utility", "authentication"].includes(template.category));
      assert.ok(["approved", "pending", "rejected", "paused", "disabled"].includes(template.status));
      assert.ok(template.body.length > 0);
      assert.equal(Number.isInteger(template.paramCount) && template.paramCount >= 0, true);
    }
  });
}

const SUBMISSION = {
  name: "one_lembrete_audiencia_1",
  language: "pt_BR",
  category: "utility" as const,
  body: "Olá, {{1}}. O escritório {{2}} lembra que a {{3}} do seu processo nº {{4}} está marcada para {{5}}. {{6}} A sua presença é importante.",
  footer: "Para não receber estes avisos, responda SAIR.",
  examples: [
    "Maria",
    "Souza Advogados",
    "audiência de conciliação",
    "5000401-61.2099.8.09.0051",
    "terça-feira, 10/11/2099, às 14:00, horário de Brasília",
    "Ela será por videoconferência, pelo link https://videoconferencia.tribunal.example/sala-7.",
  ],
};

for (const { name, provider } of [
  { name: "simulator", provider: () => new SimulatorProvider() },
  // The account's answer to a template it took, as the reference shows it: its id, status and category.
  { name: "meta", provider: () => meta([json({ id: "9001", status: "PENDING", category: "UTILITY" })]).provider },
]) {
  test(`${name}: a template submitted to the account is taken with its id, its status and its category`, async () => {
    const created = await provider().createTemplate(SUBMISSION);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.ok(created.id.length > 0);
    assert.ok(["approved", "pending"].includes(created.status));
    assert.equal(created.category, "utility");
  });
}

test("simulator: a template submitted is approved at once and listed from then on, by any instance handed what the platform keeps", async () => {
  const simulator = new SimulatorProvider();
  const created = await simulator.createTemplate(SUBMISSION);
  assert.equal(created.ok && created.status, "approved");
  const mine = (await simulator.listTemplates()).find((template) => template.name === SUBMISSION.name);
  assert.ok(mine);
  assert.equal(mine.paramCount, 6);
  assert.equal(mine.footerText, SUBMISSION.footer);
  // Another instance has no memory of it: it lists what the platform recorded of the account.
  assert.ok(!(await new SimulatorProvider().listTemplates()).some((template) => template.name === SUBMISSION.name));
  assert.ok(
    (await new SimulatorProvider({ templates: [mine] }).listTemplates()).some((template) => template.name === SUBMISSION.name),
  );
  assert.deepEqual(await simulator.createTemplate({ ...SUBMISSION, name: "Nome Errado" }), { ok: false, code: "rejected" });
});

test("meta: a template goes to the account's address as a utility message with positional values and an example of each", async () => {
  const { provider, calls } = meta([json({ id: "9001", status: "PENDING", category: "UTILITY" })]);
  await provider.createTemplate(SUBMISSION);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/waba-1/message_templates");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer token-do-escritorio");
  assert.deepEqual(calls[0].body, {
    name: SUBMISSION.name,
    language: "pt_BR",
    category: "UTILITY",
    parameter_format: "POSITIONAL",
    components: [
      { type: "BODY", text: SUBMISSION.body, example: { body_text: [SUBMISSION.examples] } },
      { type: "FOOTER", text: SUBMISSION.footer },
    ],
  });
});

test("meta: a template the account refused, or that nobody can say was taken, is said so and never as taken", async () => {
  const refused = meta([json(graphError(100, "Invalid parameter", 2388024), 400)]).provider;
  assert.deepEqual(await refused.createTemplate(SUBMISSION), { ok: false, code: "meta_100" });
  const silent = meta([new Error("socket hang up")]).provider;
  assert.deepEqual(await silent.createTemplate(SUBMISSION), { ok: false, code: "unconfirmed" });
  const gateway = meta([new Response("Bad Gateway", { status: 502 })]).provider;
  assert.deepEqual(await gateway.createTemplate(SUBMISSION), { ok: false, code: "unconfirmed" });
  // A server error that names a code is no refusal of the text either: the account may have it.
  const failing = meta([json(graphError(2, "Service temporarily unavailable"), 503)]).provider;
  assert.deepEqual(await failing.createTemplate(SUBMISSION), { ok: false, code: "unconfirmed" });
  // Taken, with no id named: nothing could ever be matched to it.
  const nameless = meta([json({ success: true })]).provider;
  assert.deepEqual(await nameless.createTemplate(SUBMISSION), { ok: false, code: "no_template_id" });
});

test("simulator: what was sent stays in its outbox, and a media of a simulated person is nothing to fetch", async () => {
  const provider = new SimulatorProvider();
  const first = await provider.send("5562999990001", TEXT);
  const second = await provider.send("5562999990001", { kind: "template", name: "retomar_conversa", bodyParams: ["Maria", "Teste"] });
  assert.equal(first.ok && second.ok, true);
  assert.deepEqual(
    provider.outbox.map((entry) => [entry.to, entry.message.kind]),
    [
      ["5562999990001", "text"],
      ["5562999990001", "template"],
    ],
  );
  assert.notEqual(provider.outbox[0].providerMessageId, provider.outbox[1].providerMessageId);
  assert.deepEqual(await provider.send("5562999990001", { kind: "text", text: "   " }), {
    ok: false,
    error: "rejected",
    detail: "empty_text",
  });
  assert.deepEqual(await provider.fetchMedia(), { kind: "gone" });
});

// ---------- The Cloud API ----------

test("meta: a text goes to the number's own address, with the firm's token and the configured version", async () => {
  const { provider, calls } = meta([json(SENT)]);
  const result = await provider.send("+55 62 99999-0001", TEXT);
  assert.deepEqual(result, { ok: true, providerMessageId: SENT.messages[0].id });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/phone-1/messages");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer token-do-escritorio");
  assert.deepEqual(calls[0].body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "5562999990001",
    type: "text",
    text: { body: "Bom dia, Maria." },
  });
});

test("meta: a template carries its name, its language and the values of the body in order", async () => {
  const { provider, calls } = meta([json(SENT), json(SENT)]);
  await provider.send("5562999990001", { kind: "template", name: "retomar_conversa", bodyParams: ["Maria", "Teste Advogados"] });
  assert.deepEqual((calls[0].body as { template: unknown }).template, {
    name: "retomar_conversa",
    language: { code: "pt_BR" },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Maria" },
          { type: "text", text: "Teste Advogados" },
        ],
      },
    ],
  });

  // A template with no value sends no components at all.
  await provider.send("5562999990001", { kind: "template", name: "boas_vindas", language: "en_US" });
  assert.deepEqual((calls[1].body as { template: unknown }).template, { name: "boas_vindas", language: { code: "en_US" } });
});

test("meta: a document goes as an address the vendor fetches, with its name and caption", async () => {
  const { provider, calls } = meta([json(SENT), json(SENT)]);
  await provider.send("5562999990001", {
    kind: "document",
    url: "https://files.example/assinada/peticao.pdf",
    filename: "peticao.pdf",
    caption: "Segue a petição.",
  });
  assert.deepEqual(
    { type: (calls[0].body as { type: string }).type, document: (calls[0].body as { document: unknown }).document },
    {
      type: "document",
      document: { link: "https://files.example/assinada/peticao.pdf", caption: "Segue a petição.", filename: "peticao.pdf" },
    },
  );

  // An image has no file name to show.
  await provider.send("5562999990001", { kind: "image", url: "https://files.example/assinada/foto.jpg", filename: "foto.jpg" });
  assert.deepEqual((calls[1].body as { image: unknown }).image, { link: "https://files.example/assinada/foto.jpg" });
});

test("meta: each refusal of the vendor becomes a word the caller branches on, and never the vendor's text", async () => {
  const cases: [number, number, string, string][] = [
    [131047, 400, "Re-engagement message", "window_closed"],
    [131026, 400, "Message undeliverable", "invalid_recipient"],
    [190, 401, "Access token has expired", "token_invalid"],
    [130429, 429, "Rate limit hit", "rate_limited"],
    [131056, 429, "Pair rate limit hit", "rate_limited"],
    [80007, 429, "Rate limit issues", "rate_limited"],
    [131016, 503, "Service unavailable", "unavailable"],
    [132001, 404, "Template name does not exist in the translation", "rejected"],
    [132000, 400, "Number of parameters does not match the expected number of params", "rejected"],
    [131031, 403, "Account has been locked", "rejected"],
  ];
  for (const [code, status, message, expected] of cases) {
    const { provider } = meta([json(graphError(code, message), status)]);
    assert.deepEqual(await provider.send("5562999990001", TEXT), { ok: false, error: expected, detail: `meta_${code}` });
  }
  // A server error that names nothing does not say whether the message was taken.
  assert.deepEqual(sendErrorOf(undefined, 502), { error: "unconfirmed", detail: "http_502" });
  assert.deepEqual(sendErrorOf(undefined, 400), { error: "rejected", detail: "http_400" });
});

test("meta: one code is recorded for a message that did not go out, whether refused at once or reported later", () => {
  // Refused at once: the reason when it has a name, the vendor's own code when it has none.
  assert.equal(failureCodeOf("window_closed", "meta_131047"), "window_closed");
  assert.equal(failureCodeOf("rejected", "meta_132000"), "meta_132000");
  assert.equal(failureCodeOf("rejected"), "rejected");
  // Reported later, by a status: the vendor's code arrives as text and gets the same words.
  assert.equal(vendorFailureCode("131047"), "window_closed");
  assert.equal(vendorFailureCode("131026"), "invalid_recipient");
  assert.equal(vendorFailureCode("132000"), "meta_132000");
  for (const nothing of [null, undefined, "", "abc"]) assert.equal(vendorFailureCode(nothing), "rejected");
});

test("meta: a network that fails or answers nonsense is an answer too, never an exception", async () => {
  // The line went quiet: the vendor may have taken the message before it did. That is never
  // reported as a message that did not go out, or somebody sends it again and it arrives twice.
  const offline = meta([new Error("ECONNRESET")]);
  assert.deepEqual(await offline.provider.send("5562999990001", TEXT), { ok: false, error: "unconfirmed", detail: "no_answer" });

  const html = meta([new Response("<html>Bad Gateway</html>", { status: 502 })]);
  assert.deepEqual(await html.provider.send("5562999990001", TEXT), { ok: false, error: "unconfirmed", detail: "http_502" });

  // When the vendor itself says it cannot take the message now, the message did not go out.
  const busy = meta([json(graphError(131016, "Service unavailable"), 503)]);
  assert.deepEqual(await busy.provider.send("5562999990001", TEXT), { ok: false, error: "unavailable", detail: "meta_131016" });

  // A 200 that names no message is not a message sent.
  const empty = meta([json({ messaging_product: "whatsapp", messages: [] })]);
  assert.deepEqual(await empty.provider.send("5562999990001", TEXT), { ok: false, error: "rejected", detail: "no_message_id" });
});

test("meta: a media is fetched in two steps, the address first and the bytes after, both with the firm's token", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const { provider, calls } = meta([
    json({
      messaging_product: "whatsapp",
      url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1",
      mime_type: "application/pdf",
      sha256: "f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      file_size: 5,
      id: "media-9",
    }),
    new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } }),
  ]);
  const media = await provider.fetchMedia("media-9");
  assert.deepEqual(media, { kind: "fetched", bytes, mime: "application/pdf" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/media-9?phone_number_id=phone-1");
  assert.equal(calls[1].url, "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=1");
  assert.equal(calls[1].headers.Authorization, "Bearer token-do-escritorio");

});

test("meta: a media is given up only when the vendor says it is gone; anything else is tried again", async () => {
  const fetchOf = (answers: Parameters<typeof scripted>[0]) => meta(answers).provider.fetchMedia("media-9");

  // The vendor keeps a media for 7 days: after that the object is not there, and it says so.
  assert.deepEqual(await fetchOf([json(graphError(100, "Unsupported get request"), 400)]), { kind: "gone" });
  assert.deepEqual(await fetchOf([new Response("", { status: 404 })]), { kind: "gone" });

  // Everything else may pass next time, and the file may well still be there: the caller waits and asks again.
  assert.deepEqual(await fetchOf([new Error("ETIMEDOUT")]), { kind: "later", detail: "no_answer" });
  assert.deepEqual(await fetchOf([json(graphError(190, "Access token has expired"), 401)]), { kind: "later", detail: "meta_190" });
  assert.deepEqual(await fetchOf([json(graphError(130429, "Rate limit hit"), 429)]), { kind: "later", detail: "meta_130429" });
  assert.deepEqual(await fetchOf([new Response("<html>Bad Gateway</html>", { status: 502 })]), { kind: "later", detail: "http_502" });
  assert.deepEqual(await fetchOf([json({ id: "media-9" })]), { kind: "later", detail: "no_address" });

  // The address is good for five minutes: when it stops working, a new one is asked for on the next try.
  const located = () => json({ url: "https://lookaside.fbsbx.com/x", mime_type: "image/jpeg" });
  assert.deepEqual(await fetchOf([located(), new Response("", { status: 404 })]), { kind: "later", detail: "download_http_404" });
  assert.deepEqual(await fetchOf([located(), new Error("ECONNRESET")]), { kind: "later", detail: "download_no_answer" });
});

test("meta: the templates are read page by page, and one ONE cannot show is left out", async () => {
  const { provider, calls } = meta([json(TEMPLATES_PAGE_1), json(TEMPLATES_PAGE_2)]);
  const templates = await provider.listTemplates();
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    "https://graph.facebook.com/v25.0/waba-1/message_templates?fields=name,language,status,category,components&limit=100",
  );
  assert.equal(calls[1].url, TEMPLATES_PAGE_1.paging.next);
  assert.deepEqual(
    templates.map((template) => [template.name, template.category, template.status, template.paramCount, template.headerText, template.footerText]),
    [
      ["retomar_conversa", "utility", "approved", 2, "Seu atendimento", "Responda SAIR para não receber mais."],
      // The header is an image: there is no header text.
      ["foto_do_escritorio", "marketing", "pending", 0, null, null],
      ["aviso_de_audiencia", "utility", "rejected", 2, null, null],
    ],
  );

  // A list that could not be read is an error, never an empty list: an empty one would disable every template.
  await assert.rejects(meta([json(graphError(190, "Access token has expired"), 401)]).provider.listTemplates());
  await assert.rejects(meta([new Error("ECONNRESET")]).provider.listTemplates());
  assert.equal(toAccountTemplate({ name: "sem_corpo", components: [] }), null);
});

// ---------- Connecting a firm's account ----------

const app = (answers: Parameters<typeof scripted>[0]) => {
  const network = scripted(answers);
  return { config: { appId: "app-1", appSecret: "segredo-do-app", apiVersion: "v25.0", fetch: network.fetch }, calls: network.calls };
};

test("signup: the code of the signup window is exchanged for the firm's token, once and at once", async () => {
  const exchanged = app([json({ access_token: "EAAGtokenDoEscritorio0123456789", token_type: "bearer" })]);
  assert.deepEqual(await exchangeSignupCode(exchanged.config, "codigo-de-30-segundos"), {
    ok: true,
    accessToken: "EAAGtokenDoEscritorio0123456789",
  });
  const url = new URL(exchanged.calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, "https://graph.facebook.com/v25.0/oauth/access_token");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "app-1",
    client_secret: "segredo-do-app",
    code: "codigo-de-30-segundos",
  });

  // The reference shows the answer as the token alone: that form is read too.
  const bare = app([new Response("EAAGtokenDoEscritorio0123456789", { status: 200 })]);
  assert.deepEqual(await exchangeSignupCode(bare.config, "codigo"), { ok: true, accessToken: "EAAGtokenDoEscritorio0123456789" });

  // A code that expired, an answer with no token, a network that failed.
  const expired = app([json(graphError(100, "This authorization code has expired."), 400)]);
  assert.deepEqual(await exchangeSignupCode(expired.config, "codigo"), { ok: false, code: "meta_100" });
  const nothing = app([json({ token_type: "bearer" })]);
  assert.deepEqual(await exchangeSignupCode(nothing.config, "codigo"), { ok: false, code: "no_token" });
  const offline = app([new Error("ECONNRESET")]);
  assert.deepEqual(await exchangeSignupCode(offline.config, "codigo"), { ok: false, code: "no_answer" });
});

test("signup: the app subscribes to the account, registers a cloud number and asks for the phone's contacts and history", async () => {
  const steps = app([
    json({ success: true }),
    json({ success: true }),
    json({ messaging_product: "whatsapp", request_id: "req-1" }),
    json({ messaging_product: "whatsapp", request_id: "req-2" }),
  ]);
  assert.deepEqual(await subscribeApp(steps.config, "token-do-escritorio", "waba-1"), { ok: true });
  assert.deepEqual(await registerNumber(steps.config, "token-do-escritorio", "phone-1", "123456"), { ok: true });
  assert.deepEqual(await requestCoexistenceSync(steps.config, "token-do-escritorio", "phone-1", "smb_app_state_sync"), { ok: true });
  assert.deepEqual(await requestCoexistenceSync(steps.config, "token-do-escritorio", "phone-1", "history"), { ok: true });

  assert.deepEqual(
    steps.calls.map((call) => [call.method, call.url, call.body]),
    [
      ["POST", "https://graph.facebook.com/v25.0/waba-1/subscribed_apps", null],
      ["POST", "https://graph.facebook.com/v25.0/phone-1/register", { messaging_product: "whatsapp", pin: "123456" }],
      ["POST", "https://graph.facebook.com/v25.0/phone-1/smb_app_data", { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" }],
      ["POST", "https://graph.facebook.com/v25.0/phone-1/smb_app_data", { messaging_product: "whatsapp", sync_type: "history" }],
    ],
  );
  // Every step after the exchange speaks with the firm's token, never with the app's secret.
  assert.equal(steps.calls.every((call) => call.headers.Authorization === "Bearer token-do-escritorio"), true);

  const refused = app([json(graphError(200, "Permissions error"), 403), json({ success: false }), new Error("ECONNRESET")]);
  assert.deepEqual(await subscribeApp(refused.config, "token", "waba-1"), { ok: false, code: "meta_200" });
  assert.deepEqual(await registerNumber(refused.config, "token", "phone-1", "123456"), { ok: false, code: "not_confirmed" });
  assert.deepEqual(await requestCoexistenceSync(refused.config, "token", "phone-1", "history"), { ok: false, code: "no_answer" });
});

test("signup: the number is read as the vendor knows it, with whether it also lives on the phone app", async () => {
  const known = app([
    json({ display_phone_number: "+55 62 90000-0001", verified_name: "Teste Advogados", is_on_biz_app: true, platform_type: "CLOUD_API", id: "phone-1" }),
  ]);
  assert.deepEqual(await getNumberInfo(known.config, "token-do-escritorio", "phone-1"), {
    displayPhoneNumber: "5562900000001",
    verifiedName: "Teste Advogados",
    onBusinessApp: true,
  });
  assert.equal(
    known.calls[0].url,
    "https://graph.facebook.com/v25.0/phone-1?fields=display_phone_number,verified_name,is_on_biz_app,platform_type",
  );

  const cloudOnly = app([json({ display_phone_number: "15550001111", id: "phone-2" })]);
  assert.deepEqual(await getNumberInfo(cloudOnly.config, "token", "phone-2"), {
    displayPhoneNumber: "15550001111",
    verifiedName: null,
    onBusinessApp: false,
  });
  assert.equal(await getNumberInfo(app([json(graphError(100, "Unsupported get request"), 400)]).config, "token", "phone-3"), null);
});

test("signup: an account that named no number has its numbers listed, and leaving takes the app off its webhooks", async () => {
  const listed = app([json({ data: [{ id: "phone-1" }, { id: "phone-2" }, {}], paging: { cursors: { before: "a", after: "b" } } })]);
  assert.deepEqual(await listAccountNumbers(listed.config, "token-do-escritorio", "waba-1"), ["phone-1", "phone-2"]);
  assert.equal(listed.calls[0].url, "https://graph.facebook.com/v25.0/waba-1/phone_numbers?fields=id&limit=50");
  assert.equal(listed.calls[0].headers.Authorization, "Bearer token-do-escritorio");
  // An account that could not be read is not an account with no number.
  assert.equal(await listAccountNumbers(app([json(graphError(190, "Access token has expired"), 401)]).config, "token", "waba-1"), null);
  assert.equal(await listAccountNumbers(app([new Error("ECONNRESET")]).config, "token", "waba-1"), null);

  const left = app([json({ success: true }), json(graphError(190, "Access token has expired"), 401)]);
  assert.deepEqual(await unsubscribeApp(left.config, "token-do-escritorio", "waba-1"), { ok: true });
  assert.deepEqual([left.calls[0].method, left.calls[0].url], ["DELETE", "https://graph.facebook.com/v25.0/waba-1/subscribed_apps"]);
  // The token was already taken back at the vendor: the firm is as disconnected as it asked to be.
  assert.deepEqual(await unsubscribeApp(left.config, "token-do-escritorio", "waba-1"), { ok: false, code: "meta_190" });
});
