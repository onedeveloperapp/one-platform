import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  OpenWaProvider,
  openWaSendResult,
  openWaSessions,
  parseOpenWaDelivery,
  phoneOfChat,
  verifyOpenWaSignature,
} from "./providers/openwa.ts";

// The shapes are OpenWA's (docs/06-api-specification.md of version 0.29.1, read on 2026-11-11). Every phone and
// name here is invented.

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function gateway(answers: { status: number; body?: unknown; bytes?: Uint8Array; type?: string }[]) {
  const calls: Call[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers.shift() ?? { status: 500 };
    if (answer.bytes) {
      return new Response(answer.bytes, {
        status: answer.status,
        headers: { "content-type": answer.type ?? "image/jpeg" },
      });
    }
    return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetch: fake };
}

const SESSION = "8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a";

test("openwa: a text goes to the person's chat with the key in its header, and the gateway's id comes back", async () => {
  const g = gateway([{ status: 201, body: { messageId: "true_5562988880001@c.us_3EB0AA", timestamp: 1786000000 } }]);
  const provider = new OpenWaProvider({
    baseUrl: "https://wa.exemplo.invalid/",
    apiKey: "chave",
    sessionId: SESSION,
    fetch: g.fetch,
  });
  assert.deepEqual(await provider.send("+55 62 98888-0001", { kind: "text", text: "Olá" }), {
    ok: true,
    providerMessageId: "true_5562988880001@c.us_3EB0AA",
  });
  assert.equal(g.calls[0].url, `https://wa.exemplo.invalid/api/sessions/${SESSION}/messages/send-text`);
  assert.equal(g.calls[0].headers["X-API-Key"], "chave");
  assert.deepEqual(g.calls[0].body, { chatId: "5562988880001@c.us", text: "Olá", linkPreview: false });
});

test("openwa: a document goes by its address with its name, and a template never goes", async () => {
  const g = gateway([{ status: 201, body: { messageId: "m-2" } }]);
  const provider = new OpenWaProvider({
    baseUrl: "https://wa.exemplo.invalid",
    apiKey: "k",
    sessionId: SESSION,
    fetch: g.fetch,
  });
  const sent = await provider.send("5562988880001", {
    kind: "document",
    url: "https://arquivo.invalid/a.pdf",
    filename: "procuracao.pdf",
    caption: "Segue",
  });
  assert.equal(sent.ok, true);
  assert.equal(g.calls[0].url.endsWith("/messages/send-document"), true);
  assert.deepEqual(g.calls[0].body, {
    chatId: "5562988880001@c.us",
    url: "https://arquivo.invalid/a.pdf",
    caption: "Segue",
    filename: "procuracao.pdf",
  });
  assert.deepEqual(await provider.send("5562988880001", { kind: "template", name: "aviso" }), {
    ok: false,
    error: "rejected",
    detail: "template_unsupported",
  });
  assert.equal(g.calls.length, 1);
});

test("openwa: what the gateway answered is said in the outbox's words, and an unknown outcome is never a refusal", () => {
  assert.deepEqual(openWaSendResult(null), { ok: false, error: "unconfirmed", detail: "no_answer" });
  assert.equal(
    (openWaSendResult({ status: 503, body: null, bytes: null, contentType: null }) as { error: string }).error,
    "unconfirmed",
  );
  assert.equal(
    (openWaSendResult({ status: 401, body: null, bytes: null, contentType: null }) as { error: string }).error,
    "token_invalid",
  );
  assert.equal(
    (
      openWaSendResult({ status: 429, body: { code: "SEND_PACING_LIMITED" }, bytes: null, contentType: null }) as {
        error: string;
        detail: string;
      }
    ).detail,
    "openwa_send_pacing_limited",
  );
  assert.equal(
    (openWaSendResult({ status: 409, body: null, bytes: null, contentType: null }) as { error: string }).error,
    "unavailable",
  );
  assert.equal(
    (openWaSendResult({ status: 201, body: {}, bytes: null, contentType: null }) as { detail: string }).detail,
    "no_message_id",
  );
});

test("openwa: a media is fetched by its chat and message, and a missing one is gone", async () => {
  const g = gateway([
    { status: 200, bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg; charset=binary" },
    { status: 404, body: {} },
  ]);
  const provider = new OpenWaProvider({
    baseUrl: "https://wa.exemplo.invalid",
    apiKey: "k",
    sessionId: SESSION,
    fetch: g.fetch,
  });
  const fetched = await provider.fetchMedia("5562988880001@c.us|false_5562988880001@c.us_3EB0BB");
  assert.equal(fetched.kind, "fetched");
  assert.equal(fetched.kind === "fetched" ? fetched.mime : "", "image/jpeg");
  assert.equal(
    g.calls[0].url,
    `https://wa.exemplo.invalid/api/sessions/${SESSION}/messages/5562988880001%40c.us/false_5562988880001%40c.us_3EB0BB/media`,
  );
  assert.deepEqual(await provider.fetchMedia("5562988880001@c.us|x"), { kind: "gone" });
  assert.deepEqual(await provider.fetchMedia("sem-separador"), { kind: "gone" });
});

test("openwa: a session is created, started, read with its QR, given ONE's signed webhook and unlinked", async () => {
  const g = gateway([
    { status: 201, body: { id: SESSION, name: "one-souza", status: "created" } },
    { status: 201, body: {} },
    { status: 200, body: { id: SESSION, status: "qr_ready", phone: null } },
    { status: 200, body: { qrCode: "data:image/png;base64,AAAA", status: "qr_ready" } },
    { status: 201, body: { id: "w-1" } },
    { status: 200, body: {} },
  ]);
  const sessions = openWaSessions({ baseUrl: "https://wa.exemplo.invalid", apiKey: "k", fetch: g.fetch });
  assert.equal((await sessions.create("one-souza"))?.id, SESSION);
  assert.equal(await sessions.start(SESSION), true);
  assert.deepEqual(await sessions.read(SESSION), { id: SESSION, status: "qr_ready", phone: null, restricted: false });
  assert.equal(await sessions.qr(SESSION), "data:image/png;base64,AAAA");
  assert.equal(
    await sessions.webhook(SESSION, "https://one.invalid/api/webhooks/openwa", "segredo-com-dezesseis"),
    true,
  );
  assert.deepEqual((g.calls[4].body as { events: string[] }).events.includes("message.received"), true);
  assert.equal(await sessions.logout(SESSION), true);
});

test("openwa: a delivery is taken only with the HMAC of its raw body under the platform's secret", () => {
  const body = JSON.stringify({ event: "message.received", sessionId: SESSION, data: {} });
  const good = `sha256=${createHmac("sha256", "segredo-da-plataforma").update(body).digest("hex")}`;
  assert.equal(verifyOpenWaSignature(body, good, "segredo-da-plataforma"), true);
  assert.equal(verifyOpenWaSignature(body + " ", good, "segredo-da-plataforma"), false);
  assert.equal(verifyOpenWaSignature(body, null, "segredo-da-plataforma"), false);
  assert.equal(verifyOpenWaSignature(body, "sha256=00", "segredo-da-plataforma"), false);
});

test("openwa: what a person writes, what the phone sends and what became of a message are read; a group is not", () => {
  assert.deepEqual(
    parseOpenWaDelivery({
      event: "message.received",
      sessionId: SESSION,
      data: {
        id: "false_5562988880001@c.us_3EB0CC",
        from: "5562988880001@c.us",
        to: "5562900002201@c.us",
        chatId: "5562988880001@c.us",
        body: "Meu voo foi cancelado",
        type: "chat",
        timestamp: 1786000000,
        fromMe: false,
        isGroup: false,
        kind: "individual",
        contact: { pushName: "Mariana" },
      },
    }),
    [
      {
        type: "message",
        phoneNumberId: SESSION,
        from: "5562988880001",
        contactName: "Mariana",
        providerMessageId: "false_5562988880001@c.us_3EB0CC",
        kind: "text",
        body: "Meu voo foi cancelado",
        media: null,
        replyTo: null,
        timestamp: new Date(1786000000 * 1000),
      },
    ],
  );
  const photo = parseOpenWaDelivery({
    event: "message.received",
    sessionId: SESSION,
    data: {
      id: "f_1",
      from: "5562988880001@c.us",
      chatId: "5562988880001@c.us",
      type: "image",
      body: "",
      media: { mimetype: "image/jpeg", omitted: true },
    },
  });
  assert.deepEqual(photo[0].type === "message" ? photo[0].media : null, {
    id: "5562988880001@c.us|f_1",
    mimeType: "image/jpeg",
    filename: null,
  });
  assert.deepEqual(
    parseOpenWaDelivery({
      event: "message.sent",
      sessionId: SESSION,
      data: {
        id: "true_5562988880001@c.us_3EB0DD",
        to: "5562988880001@c.us",
        chatId: "5562988880001@c.us",
        body: "Já vejo",
        type: "chat",
        fromMe: true,
        timestamp: 1786000100,
      },
    })[0].type,
    "echo",
  );
  assert.deepEqual(
    parseOpenWaDelivery({
      event: "message.ack",
      sessionId: SESSION,
      data: { id: "row-1", messageId: "true_x", status: "read", ack: 3 },
    }),
    [
      {
        type: "status",
        phoneNumberId: SESSION,
        providerMessageId: "true_x",
        status: "read",
        errorCode: null,
        pricingCategory: null,
        pricingType: null,
      },
    ],
  );
  assert.equal(
    parseOpenWaDelivery({
      event: "message.failed",
      sessionId: SESSION,
      data: { messageId: "true_y", status: "failed", ack: -1 },
    })[0].type,
    "status",
  );
  assert.deepEqual(
    parseOpenWaDelivery({
      event: "message.received",
      sessionId: SESSION,
      data: { id: "g", from: "120363@g.us", chatId: "120363@g.us", isGroup: true, type: "chat", body: "oi" },
    }),
    [],
  );
  assert.deepEqual(
    parseOpenWaDelivery({ event: "message.ack", sessionId: SESSION, data: { messageId: "z", status: "pending" } }),
    [],
  );
  assert.equal(phoneOfChat("123456789012345@lid"), null);
  assert.equal(phoneOfChat("5562988880001:12@s.whatsapp.net"), "5562988880001");
});
