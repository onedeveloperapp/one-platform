import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { FakeSignatureProvider } from "./fake.ts";
import {
  D4SignAuthError,
  D4SignProvider,
  D4SignUnavailableError,
  d4signWebhookUrl,
  readD4SignWebhook,
} from "./providers/d4sign.ts";
import { type CreateEnvelopeInput, EnvelopeNotSignedError, type SignatureProvider } from "./types.ts";
import {
  readZapSignWebhook,
  webhookSecretHash,
  ZAPSIGN_WEBHOOK_HEADER,
  ZapSignAuthError,
  zapSignExternalId,
  ZapSignProvider,
  ZapSignUnavailableError,
} from "./providers/zapsign.ts";

const PDF = new TextEncoder().encode("%PDF-1.7\n% procuração de teste\n%%EOF\n");

const BASE_INPUT: CreateEnvelopeInput = {
  pdf: PDF,
  title: "Procuração",
  signers: [{ name: "Ana Souza", phone: "5562999990001" }, { name: "Carlos Souza" }],
  externalId: "case-1/procuracao/v1",
};

const INPUT = BASE_INPUT;

/** A provider plus what a scenario plays on the client's side. */
type Harness = {
  provider: SignatureProvider;
  /** The signer at this position (1 is the first) signs. */
  sign(envelopeId: string, position: number): void;
  /** A signer refuses. */
  refuse(envelopeId: string): void;
};

/**
 * What any signature provider must do, whatever is behind it. It runs against
 * the fake today. The ZapSign provider (M2) joins this suite with responses
 * recorded from its sandbox and has to pass the same cases.
 */
function signatureContract(
  name: string,
  make: () => Harness,
  options: {
    /** What the envelopes are opened with (a provider that names signers by e-mail gets them). */
    input?: CreateEnvelopeInput;
    /**
     * Whether a read gives back the envelope whole, its addresses and our reference included. D4Sign reads the
     * phase and the signatures only: its addresses cost a call each under a limit of calls an hour.
     */
    readsBack?: boolean;
  } = {},
) {
  const INPUT = options.input ?? BASE_INPUT;
  describe(`signature provider contract: ${name}`, () => {
    it("opens an envelope pending, with one signing address per signer and our own reference", async () => {
      const { provider } = make();
      const envelope = await provider.createEnvelope(INPUT);
      assert.equal(envelope.status, "pending");
      assert.equal(envelope.externalId, INPUT.externalId);
      assert.deepEqual(
        envelope.signers.map((signer) => [signer.name, signer.signedAt]),
        [
          ["Ana Souza", null],
          ["Carlos Souza", null],
        ],
      );
      const addresses = envelope.signers.map((signer) => signer.signUrl);
      assert.ok(addresses.every((address) => URL.canParse(address)));
      assert.equal(new Set(addresses).size, addresses.length);
      const read = await provider.getStatus(envelope.id);
      if (options.readsBack ?? true) {
        assert.deepEqual(read, envelope);
      } else {
        assert.equal(read?.id, envelope.id);
        assert.equal(read?.status, "pending");
        assert.deepEqual(
          read?.signers.map((signer) => signer.signedAt),
          envelope.signers.map(() => null),
        );
      }
    });

    it("does not know an envelope it never opened", async () => {
      const { provider } = make();
      assert.equal(await provider.getStatus("not-an-envelope"), null);
      await assert.rejects(provider.downloadSigned("not-an-envelope"), EnvelopeNotSignedError);
    });

    it("hands over the signed document only when every signer has signed", async () => {
      const { provider, sign } = make();
      const { id } = await provider.createEnvelope(INPUT);

      sign(id, 1);
      assert.equal((await provider.getStatus(id))?.status, "pending");
      await assert.rejects(provider.downloadSigned(id), EnvelopeNotSignedError);

      sign(id, 2);
      const signed = await provider.getStatus(id);
      assert.equal(signed?.status, "signed");
      assert.ok(signed?.signers.every((signer) => signer.signedAt !== null));

      const document = await provider.downloadSigned(id);
      assert.equal(document.sha256, createHash("sha256").update(document.pdf).digest("hex"));
      assert.deepEqual(
        document.evidence.map((entry) => entry.signerName),
        ["Ana Souza", "Carlos Souza"],
      );
      assert.ok(document.evidence.every((entry) => !Number.isNaN(Date.parse(entry.signedAt))));
    });

    it("ends a refused envelope: it never hands over a signed document", async () => {
      const { provider, sign, refuse } = make();
      const { id } = await provider.createEnvelope(INPUT);
      sign(id, 1);
      refuse(id);
      assert.equal((await provider.getStatus(id))?.status, "refused");
      await assert.rejects(provider.downloadSigned(id), EnvelopeNotSignedError);
    });

    it("gives each envelope its own id, even for the same document", async () => {
      const { provider } = make();
      const first = await provider.createEnvelope(INPUT);
      const second = await provider.createEnvelope(INPUT);
      assert.notEqual(first.id, second.id);
    });
  });
}

function fakeHarness() {
  const provider = new FakeSignatureProvider({ now: () => Date.parse("2026-10-08T12:00:00Z") });
  return {
    provider,
    sign: (envelopeId: string, position: number) => provider.sign(envelopeId, position),
    refuse: (envelopeId: string) => provider.refuse(envelopeId),
  };
}

signatureContract("fake", fakeHarness);

describe("the fake signature provider", () => {
  it("keeps a final state: a signed, refused or expired envelope does not change again", async () => {
    const { provider } = fakeHarness();
    const expired = await provider.createEnvelope(INPUT);
    provider.expire(expired.id);
    assert.equal((await provider.getStatus(expired.id))?.status, "expired");
    assert.throws(() => provider.sign(expired.id, 1), /already expired/);
  });

  it("does not hand back the bytes it was given as if they were signed", async () => {
    const { provider } = fakeHarness();
    const { id } = await provider.createEnvelope({ ...INPUT, signers: [{ name: "Ana Souza" }] });
    provider.sign(id, 1);
    const document = await provider.downloadSigned(id);
    assert.notDeepEqual(document.pdf, PDF);
    assert.ok(document.pdf.length > PDF.length);
  });
});

// ---------- ZapSign, against a stand-in that answers in the shapes of its reference ----------

const API_TOKEN = "zapsign-token-de-teste";
const SANDBOX = "https://sandbox.api.zapsign.com.br";
const FILES = "https://zapsign.s3.amazonaws.com/signed";

type StandInSigner = {
  token: string;
  name: string;
  status: string;
  sign_url: string;
  signed_at: string | null;
  phone_country: string;
  phone_number: string;
};

type StandInDocument = {
  token: string;
  external_id: string;
  status: string;
  deleted: boolean;
  pdf: Uint8Array;
  expiration_date: string | null;
  signers: StandInSigner[];
};

/**
 * ZapSign as its reference describes it (read on 2026-10-09): a document from
 * a base64 PDF, its detail with `signed_file` once every signer signed, the
 * webhook and its headers. It checks the token on every call.
 */
function zapSignStandIn() {
  const documents = new Map<string, StandInDocument>();
  const webhooks: { url: string; type: string; headers: { name: string; value: string }[] }[] = [];
  let sequence = 0;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const view = (document: StandInDocument) => ({
    token: document.token,
    external_id: document.external_id,
    status: document.status,
    deleted: document.deleted,
    expiration_date: document.expiration_date,
    original_file: `${FILES}/${document.token}-original.pdf`,
    signed_file: document.status === "signed" ? `${FILES}/${document.token}.pdf` : null,
    signers: document.signers,
  });

  const fetchStandIn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(FILES)) {
      const token = url.slice(FILES.length + 1).replace(/\.pdf$/, "");
      const document = documents.get(token);
      if (!document || document.status !== "signed") return new Response("", { status: 404 });
      const marker = new TextEncoder().encode(`\n%% assinado na ZapSign: ${token}\n`);
      const pdf = new Uint8Array(document.pdf.length + marker.length);
      pdf.set(document.pdf, 0);
      pdf.set(marker, document.pdf.length);
      return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== `Bearer ${API_TOKEN}`) return new Response("Forbidden", { status: 403 });
    const path = url.slice(SANDBOX.length);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (init?.method === "POST" && path === "/api/v1/docs/") {
      sequence += 1;
      const token = `doc-${String(sequence).padStart(4, "0")}-aaaa-bbbb`;
      const signers = (body.signers as Record<string, string>[]).map((signer, index) => ({
        token: `${token}-s${index + 1}`,
        name: signer.name,
        status: "new",
        sign_url: `https://sandbox.app.zapsign.com.br/verificar/${token}-s${index + 1}`,
        signed_at: null,
        phone_country: signer.phone_country,
        phone_number: signer.phone_number,
      }));
      const document: StandInDocument = {
        token,
        external_id: String(body.external_id ?? ""),
        status: "pending",
        deleted: false,
        pdf: Uint8Array.from(Buffer.from(String(body.base64_pdf), "base64")),
        expiration_date: null,
        signers,
      };
      documents.set(token, document);
      return json(200, view(document));
    }
    const detail = /^\/api\/v1\/docs\/([^/]+)\/$/.exec(path);
    if (init?.method === "GET" && detail) {
      const document = documents.get(detail[1]);
      return document ? json(200, view(document)) : json(404, { detail: "Not found." });
    }
    if (init?.method === "POST" && path === "/api/v1/refuse/") {
      const document = documents.get(String(body.doc_token));
      if (!document) return json(404, { error: "document_not_found" });
      if (document.status === "signed") return json(403, { error: "document_already_signed" });
      if (document.status === "recusado") return json(403, { error: "document_already_refused" });
      document.status = "recusado";
      return json(200, { message: "Document successfully refused." });
    }
    if (init?.method === "DELETE" && path === "/api/v1/user/company/webhook/delete/") {
      const index = Number(body.id) - 1;
      if (!webhooks[index]) return json(404, { detail: "Not found." });
      webhooks[index] = { url: "", type: "deleted", headers: [] };
      return json(200, {});
    }
    if (init?.method === "POST" && path === "/api/v1/user/company/webhook/") {
      webhooks.push({ url: String(body.url), type: String(body.type), headers: [] });
      return json(200, { id: webhooks.length });
    }
    if (init?.method === "POST" && path === "/api/v1/user/company/webhook/header/") {
      const webhook = webhooks[Number(body.id) - 1];
      if (!webhook) return json(404, { detail: "Not found." });
      webhook.headers = body.headers as { name: string; value: string }[];
      return json(200, {});
    }
    return new Response("", { status: 400 });
  }) as typeof fetch;

  const at = "2026-10-09T12:00:00.000000Z";
  return {
    fetch: fetchStandIn,
    documents,
    webhooks,
    sign(token: string, position: number) {
      const document = documents.get(token);
      const signer = document?.signers[position - 1];
      if (!document || !signer) throw new Error(`no signer ${position} in ${token}`);
      signer.status = "signed";
      signer.signed_at = at;
      if (document.signers.every((each) => each.status === "signed")) document.status = "signed";
    },
    refuse(token: string) {
      const document = documents.get(token);
      if (!document) throw new Error(`no document ${token}`);
      document.status = "recusado";
    },
  };
}

function zapSignHarness() {
  const standIn = zapSignStandIn();
  const provider = new ZapSignProvider({
    apiToken: API_TOKEN,
    environment: "sandbox",
    fetch: standIn.fetch,
    now: () => Date.parse("2026-10-09T12:00:00Z"),
  });
  return { provider, standIn, sign: standIn.sign, refuse: standIn.refuse };
}

signatureContract("zapsign (stand-in)", zapSignHarness);

describe("the ZapSign provider", () => {
  it("sends the PDF, our reference, and each signer with the phone apart from Brazil's code", async () => {
    const { provider, standIn } = zapSignHarness();
    const envelope = await provider.createEnvelope(INPUT);
    const stored = standIn.documents.get(envelope.id);
    assert.deepEqual(stored?.pdf, PDF);
    assert.equal(stored?.external_id, INPUT.externalId);
    assert.deepEqual(
      stored?.signers.map((signer) => [signer.phone_country, signer.phone_number]),
      [
        ["55", "62999990001"],
        ["", ""],
      ],
    );
    assert.ok(envelope.signers[0].signUrl.startsWith("https://sandbox.app.zapsign.com.br/verificar/"));
  });

  it("reads a refused document, and one whose deadline passed, as ended", async () => {
    const { provider, standIn } = zapSignHarness();
    const refused = await provider.createEnvelope(INPUT);
    standIn.refuse(refused.id);
    assert.equal((await provider.getStatus(refused.id))?.status, "refused");
    const late = await provider.createEnvelope(INPUT);
    const stored = standIn.documents.get(late.id);
    if (stored) stored.expiration_date = "2026-10-08T23:59:59.000999+00:00";
    assert.equal((await provider.getStatus(late.id))?.status, "expired");
  });

  it("refuses a token ZapSign does not take, and never puts a strange id in a path", async () => {
    const standIn = zapSignStandIn();
    const wrong = new ZapSignProvider({ apiToken: "outro", environment: "sandbox", fetch: standIn.fetch });
    await assert.rejects(wrong.createEnvelope(INPUT), ZapSignAuthError);
    const { provider } = zapSignHarness();
    assert.equal(await provider.getStatus("../../user/company"), null);
  });

  it("points the account's webhook at ONE with the secret in its own header", async () => {
    const { provider, standIn } = zapSignHarness();
    const id = await provider.registerWebhook({
      url: "https://one.test/api/webhooks/zapsign",
      secret: "segredo-longo",
    });
    assert.equal(id, "1");
    assert.deepEqual(standIn.webhooks[0], {
      url: "https://one.test/api/webhooks/zapsign",
      type: "",
      headers: [{ name: ZAPSIGN_WEBHOOK_HEADER, value: "segredo-longo" }],
    });
  });

  it("cancels a document still pending, never one already signed, and removes a webhook", async () => {
    const { provider, standIn } = zapSignHarness();
    const open = await provider.createEnvelope(INPUT);
    assert.equal(await provider.cancelDocument(open.id, "Cancelado pelo escritório"), "cancelled");
    assert.equal((await provider.getStatus(open.id))?.status, "refused");
    assert.equal(await provider.cancelDocument(open.id, "De novo"), "already_ended");
    const signed = await provider.createEnvelope({ ...INPUT, signers: [{ name: "Ana Souza" }] });
    standIn.sign(signed.id, 1);
    assert.equal(await provider.cancelDocument(signed.id, "Tarde demais"), "already_signed");
    assert.equal(await provider.cancelDocument("nao-existe-0000", "x"), "not_found");
    const id = await provider.registerWebhook({ url: "https://one.test/api/webhooks/zapsign", secret: "s" });
    await provider.deleteWebhook(id);
    assert.equal(standIn.webhooks[0].type, "deleted");
  });

  it("calls a success whose body cannot be read an answer nobody can tell, never a refusal", async () => {
    const garbled = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    const provider = new ZapSignProvider({ apiToken: API_TOKEN, environment: "sandbox", fetch: garbled });
    await assert.rejects(provider.createEnvelope(INPUT), (error: unknown) => {
      assert.ok(error instanceof ZapSignUnavailableError);
      assert.equal(error.status, null);
      return true;
    });
  });

  it("reads a delivery only when the header carries the secret, and only what it names", () => {
    const body = JSON.stringify({
      event_type: "doc_signed",
      sandbox: true,
      external_id: "envelope-1",
      token: "cce11abf-abcd-abcd-a657-25b55f185f16",
      status: "signed",
    });
    const secretSha256 = webhookSecretHash("segredo-longo");
    assert.deepEqual(readZapSignWebhook({ header: "segredo-longo", secretSha256, body }), {
      type: "doc_signed",
      documentToken: "cce11abf-abcd-abcd-a657-25b55f185f16",
      externalId: "envelope-1",
      sandbox: true,
    });
    assert.equal(readZapSignWebhook({ header: "outro", secretSha256, body }), null);
    assert.equal(readZapSignWebhook({ header: null, secretSha256, body }), null);
    assert.equal(readZapSignWebhook({ header: "segredo-longo", secretSha256: null, body }), null);
    assert.equal(readZapSignWebhook({ header: "segredo-longo", secretSha256, body: "{" }), null);
    const strange = JSON.stringify({ event_type: "x", token: "t" });
    assert.equal(readZapSignWebhook({ header: "segredo-longo", secretSha256, body: strange }), null);
    assert.equal(zapSignExternalId(body), "envelope-1");
    assert.equal(zapSignExternalId("nada"), null);
  });
});

// ---------- D4Sign (0253), against a stand-in that answers in the shapes of its reference ----------

const D4_TOKEN = "live_token-de-teste-d4sign";
const D4_CRYPT = "live_crypt-de-teste-d4sign";
const D4_API = "https://sandbox.d4sign.com.br/api/v1";
const D4_FILES = "https://sandbox.d4sign.com.br/download";
const D4_SAFE = "9f08bf18-bf4b-410f-9701-c286e5b1cad1";

const D4_INPUT: CreateEnvelopeInput = {
  ...BASE_INPUT,
  signers: [
    { name: "Ana Souza", email: "ana@souza.invalid", phone: "5562999990001" },
    { name: "Carlos Souza", email: "carlos@souza.invalid" },
  ],
};

type D4StandInSigner = { key: string; email: string; userName: string; signed: boolean; at: string | null };
type D4StandInDocument = { uuid: string; name: string; statusId: string; pdf: Uint8Array; signers: D4StandInSigner[] };

/**
 * D4Sign as its reference describes it (read on 2026-11-17): the keys in the address of every call, a document from a
 * base64 PDF in a safe, its signers by e-mail with a `key_signer` each, sent to signature, a signer's own address by
 * the decoded `key_signer`, the document's phase and each signer's signature, the temporary address of the signed PDF,
 * and the cancel. It answers a key it does not know with D4Sign's 401, and its limit of calls when told to.
 */
function d4signStandIn(
  options: {
    crypt?: string | null;
    failOn?: string;
    /** An answer of D4Sign's for a call, in place of the reference's, where the reference does not say it (0254). */
    answer?: (method: string, path: string) => Response | null;
  } = {},
) {
  const documents = new Map<string, D4StandInDocument>();
  const calls: { method: string; path: string; query: URLSearchParams; headers: Headers; body: unknown }[] = [];
  const webhooks: { uuid: string; url: string }[] = [];
  let sequence = 0;
  let signerSequence = 4703160;
  let limited = false;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchStandIn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    if (`${url.origin}${url.pathname}`.startsWith(D4_FILES)) {
      const document = documents.get(url.pathname.split("/").pop() ?? "");
      if (!document || document.statusId !== "4") return new Response("", { status: 404 });
      const marker = new TextEncoder().encode(`\n%% assinado na D4Sign: ${document.uuid}\n`);
      const pdf = new Uint8Array(document.pdf.length + marker.length);
      pdf.set(document.pdf, 0);
      pdf.set(marker, document.pdf.length);
      return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
    }
    const path = url.pathname.slice(new URL(D4_API).pathname.length);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method, path, query: url.searchParams, headers: new Headers(init?.headers), body });
    if (
      url.searchParams.get("tokenAPI") !== D4_TOKEN ||
      (url.searchParams.get("cryptKey") ?? null) !== (options.crypt ?? null)
    ) {
      return json(401, { message: "API error: Check API user.", mensagem_pt: "Chave de API inválida." });
    }
    const forced = options.answer?.(method, path) ?? null;
    if (forced) return forced;
    if (limited) return json(400, { message: "Esta chave da API já atingiu o tempo limite para este método" });
    if (options.failOn && path.endsWith(options.failOn)) return json(400, { message: null });

    if (method === "GET" && path === "/safes") {
      return json(200, [
        { "uuid-safe": D4_SAFE, "name-safe": "Clientes" },
        { "uuid-safe": "06b3ddb1-abc9-4ab8-b944-0d7c940486af", "name-safe": "Atendimento" },
      ]);
    }
    const upload = /^\/documents\/([0-9a-f-]{36})\/uploadbinary$/.exec(path);
    if (method === "POST" && upload) {
      if (upload[1] !== D4_SAFE) return json(400, { message: "not permission this safe" });
      sequence += 1;
      const uuid = `aea20243-475a-43fc-8ba5-${String(sequence).padStart(12, "0")}`;
      documents.set(uuid, {
        uuid,
        name: String(body.name ?? ""),
        statusId: "2",
        pdf: Uint8Array.from(Buffer.from(String(body.base64_binary_file), "base64")),
        signers: [],
      });
      return json(200, { uuid });
    }
    const action = /^\/documents\/([0-9a-f-]{36})\/([a-z]+)(?:\/(.+))?$/.exec(path);
    const document = action ? documents.get(action[1]) : undefined;
    if (action && !document) return json(404, { message: "document not found" });
    if (!action || !document) return new Response("false - metodo desconhecido", { status: 400 });
    const [, , verb, argument] = action;
    if (method === "POST" && verb === "webhooks") {
      webhooks.push({ uuid: document.uuid, url: String(body.url) });
      return json(200, { message: "Webhook successfully registered" });
    }
    if (method === "POST" && verb === "createlist") {
      const added = (body.signers as { email: string }[]).map((signer) => {
        signerSequence += 1;
        const entry = {
          key: Buffer.from(String(signerSequence)).toString("base64"),
          email: signer.email,
          userName: "",
          signed: false,
          at: null,
        };
        document.signers.push(entry);
        return entry;
      });
      return json(200, {
        message: added.map((signer) => ({ key_signer: signer.key, email: signer.email, act: "1", status: "created" })),
      });
    }
    if (method === "POST" && verb === "sendtosigner") {
      if (body.skip_email !== "1" || body.workflow !== "0") return json(400, { message: null });
      document.statusId = "3";
      return json(200, { message: "File sent to successfully signing" });
    }
    if (method === "GET" && verb === "signaturelink") {
      if (document.statusId !== "3") return json(400, { message: "Link de assinatura indisponível" });
      const signer = document.signers.find((item) => Buffer.from(item.key, "base64").toString("utf8") === argument);
      if (!signer) return json(400, { message: null });
      return json(200, { link: `https://sandbox.d4sign.com.br/w/i/${document.uuid}/${argument}-link/feee` });
    }
    if (method === "GET" && verb === "list") {
      return json(200, [
        {
          uuidDoc: document.uuid,
          nameDoc: document.name,
          statusId: document.statusId,
          statusName: document.statusId,
          list: document.signers.map((signer) => ({
            key_signer: signer.key,
            user_name: signer.userName,
            email: signer.email,
            signed: signer.signed ? "1" : "0",
            sign_info: signer.at ? { date_signed: "", date_signed_atom: signer.at } : {},
          })),
        },
      ]);
    }
    if (method === "POST" && verb === "download") {
      if (document.statusId !== "4") return json(400, { message: "Documento não finalizado" });
      return json(200, { url: `${D4_FILES}/${document.uuid}`, name: `${document.name}.pdf` });
    }
    if (method === "POST" && verb === "cancel") {
      if (document.statusId !== "2" && document.statusId !== "3")
        return json(400, { message: "Não é possível cancelar" });
      document.statusId = "6";
      return json(200, { uuidDoc: document.uuid, statusId: "6", statusName: "Cancelado" });
    }
    return new Response("false - metodo desconhecido", { status: 400 });
  }) as typeof fetch;

  return {
    fetch: fetchStandIn,
    documents,
    calls,
    webhooks,
    limit: () => {
      limited = true;
    },
    sign(uuid: string, position: number, name: string) {
      const document = documents.get(uuid);
      const signer = document?.signers[position - 1];
      if (!document || !signer) throw new Error("no such signer");
      signer.signed = true;
      signer.userName = name;
      signer.at = `2026-11-17T10:0${position}:00-03:00`;
      if (document.signers.every((item) => item.signed)) document.statusId = "4";
    },
    refuse(uuid: string) {
      const document = documents.get(uuid);
      if (document) document.statusId = "6";
    },
  };
}

function d4signHarness() {
  const standIn = d4signStandIn({ crypt: D4_CRYPT });
  const provider = new D4SignProvider({
    tokenApi: D4_TOKEN,
    cryptKey: D4_CRYPT,
    environment: "sandbox",
    safeUuid: D4_SAFE,
    webhookFor: (externalId) => d4signWebhookUrl("https://one.invalid", externalId, "segredo-da-conexao-longo"),
    fetch: standIn.fetch,
  });
  const names = ["Ana Souza", "Carlos Souza"];
  return {
    provider,
    standIn,
    sign: (envelopeId: string, position: number) => standIn.sign(envelopeId, position, names[position - 1]),
    refuse: (envelopeId: string) => standIn.refuse(envelopeId),
  };
}

signatureContract("d4sign (stand-in)", d4signHarness, { input: D4_INPUT, readsBack: false });

describe("the D4Sign provider", () => {
  it("sends the keys in the address of every call, the cryptKey only where the account has one", async () => {
    const { provider, standIn } = d4signHarness();
    await provider.createEnvelope(D4_INPUT);
    assert.ok(standIn.calls.length >= 6);
    for (const call of standIn.calls) {
      assert.equal(call.query.get("tokenAPI"), D4_TOKEN);
      assert.equal(call.query.get("cryptKey"), D4_CRYPT);
      assert.equal(call.headers.get("tokenAPI"), D4_TOKEN);
    }
    const plain = d4signStandIn({ crypt: null });
    const noCrypt = new D4SignProvider({ tokenApi: D4_TOKEN, environment: "sandbox", fetch: plain.fetch });
    assert.equal((await noCrypt.listSafes()).length, 2);
    assert.equal(plain.calls[0].query.has("cryptKey"), false);
  });

  it("puts the document in the firm's safe, sends it with no e-mail of D4Sign's and points its webhook at ONE", async () => {
    const { provider, standIn } = d4signHarness();
    const envelope = await provider.createEnvelope(D4_INPUT);
    const steps = standIn.calls.map((call) => `${call.method} ${call.path.replace(envelope.id, "{doc}")}`);
    assert.deepEqual(steps.slice(0, 4), [
      `POST /documents/${D4_SAFE}/uploadbinary`,
      "POST /documents/{doc}/webhooks",
      "POST /documents/{doc}/createlist",
      "POST /documents/{doc}/sendtosigner",
    ]);
    const created = standIn.calls.find((call) => call.path.endsWith("/createlist"))?.body as {
      signers: Record<string, string>[];
    };
    assert.deepEqual(
      created.signers.map((signer) => [signer.email, signer.act, signer.skipemail, signer.certificadoicpbr]),
      [
        ["ana@souza.invalid", "1", "1", "0"],
        ["carlos@souza.invalid", "1", "1", "0"],
      ],
    );
    assert.deepEqual(standIn.webhooks, [
      {
        uuid: envelope.id,
        url: `https://one.invalid/api/webhooks/d4sign?envelope=${encodeURIComponent(D4_INPUT.externalId)}&key=segredo-da-conexao-longo`,
      },
    ]);
    assert.ok(envelope.signers.every((signer) => signer.signUrl.startsWith("https://sandbox.d4sign.com.br/w/i/")));
  });

  it("sends nothing when a signer has no e-mail, which D4Sign names every signer by", async () => {
    const { provider, standIn } = d4signHarness();
    await assert.rejects(
      provider.createEnvelope({ ...D4_INPUT, signers: [{ name: "Ana Souza" }] }),
      (error: unknown) => error instanceof D4SignUnavailableError && error.code === "signer_email_missing",
    );
    assert.equal(standIn.calls.length, 0);
  });

  it("takes refused keys as the firm's to reconnect, and the hour's limit as a wait", async () => {
    const standIn = d4signStandIn({ crypt: D4_CRYPT });
    const wrong = new D4SignProvider({
      tokenApi: "outra-chave-qualquer",
      cryptKey: D4_CRYPT,
      environment: "sandbox",
      fetch: standIn.fetch,
    });
    await assert.rejects(wrong.listSafes(), D4SignAuthError);
    const { provider, standIn: limitedStandIn } = d4signHarness();
    limitedStandIn.limit();
    await assert.rejects(
      provider.createEnvelope(D4_INPUT),
      (error: unknown) => error instanceof D4SignUnavailableError && error.code === "provider_rate_limited",
    );
  });

  it("takes a 403 for an access refused and never for the keys' end, and a 429 or a bare message for the limit", async () => {
    const answering = (response: () => Response) =>
      new D4SignProvider({
        tokenApi: D4_TOKEN,
        environment: "sandbox",
        fetch: d4signStandIn({ crypt: null, answer: (_method, path) => (path === "/safes" ? response() : null) }).fetch,
      });
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      answering(() => reply(403, { message: "Forbidden" })).listSafes(),
      (error: unknown) =>
        error instanceof D4SignUnavailableError &&
        error.code === "provider_forbidden" &&
        !(error instanceof D4SignAuthError),
    );
    for (const limit of [
      () => reply(429, {}),
      () => reply(200, { message: "Esta chave da API já atingiu o tempo limite para este método" }),
    ]) {
      await assert.rejects(
        answering(limit).listSafes(),
        (error: unknown) => error instanceof D4SignUnavailableError && error.code === "provider_rate_limited",
      );
    }
    await assert.rejects(
      answering(() => reply(200, { message: "API error: Check API user." })).listSafes(),
      D4SignAuthError,
    );
  });

  it("never takes the words of a document for D4Sign's refusal", async () => {
    const { provider } = d4signHarness();
    const envelope = await provider.createEnvelope({ ...D4_INPUT, title: "Prazo e tempo limite: check api user" });
    assert.equal((await provider.getStatus(envelope.id))?.status, "pending");
  });

  it("says a safe D4Sign does not know, with nothing made there", async () => {
    const standIn = d4signStandIn({
      crypt: null,
      answer: (_method, path) => (path.endsWith("/uploadbinary") ? new Response("", { status: 404 }) : null),
    });
    const provider = new D4SignProvider({
      tokenApi: D4_TOKEN,
      environment: "sandbox",
      safeUuid: D4_SAFE,
      fetch: standIn.fetch,
    });
    await assert.rejects(
      provider.createEnvelope(D4_INPUT),
      (error: unknown) => error instanceof D4SignUnavailableError && error.code === "safe_not_found",
    );
    assert.equal(standIn.documents.size, 0);
  });

  it("sends nothing when two signers share an e-mail, which would give them one code and one address", async () => {
    const { provider, standIn } = d4signHarness();
    await assert.rejects(
      provider.createEnvelope({
        ...D4_INPUT,
        signers: [
          { name: "Ana Souza", email: "familia@souza.invalid" },
          { name: "Carlos Souza", email: "Familia@Souza.invalid" },
        ],
      }),
      (error: unknown) => error instanceof D4SignUnavailableError && error.code === "signer_email_shared",
    );
    assert.equal(standIn.calls.length, 0);
  });

  it("hands over the signed PDF from the state just read, with no second reading", async () => {
    const { provider, standIn } = d4signHarness();
    const envelope = await provider.createEnvelope(D4_INPUT);
    standIn.sign(envelope.id, 1, "Ana Souza");
    standIn.sign(envelope.id, 2, "Carlos Souza");
    const state = await provider.getStatus(envelope.id);
    const before = standIn.calls.length;
    const signed = await provider.downloadSigned(envelope.id, state);
    assert.deepEqual(
      standIn.calls.slice(before).map((call) => call.path.replace(envelope.id, "{doc}")),
      ["/documents/{doc}/download"],
    );
    assert.equal(Buffer.from(signed.pdf.subarray(0, 4)).toString("latin1"), "%PDF");
  });

  it("cancels at D4Sign a document left half made, so nothing waits there for nobody", async () => {
    const standIn = d4signStandIn({ crypt: null, failOn: "/createlist" });
    const provider = new D4SignProvider({
      tokenApi: D4_TOKEN,
      environment: "sandbox",
      safeUuid: D4_SAFE,
      fetch: standIn.fetch,
    });
    await assert.rejects(provider.createEnvelope(D4_INPUT), D4SignUnavailableError);
    assert.equal(standIn.documents.size, 1);
    assert.equal([...standIn.documents.values()][0].statusId, "6");
  });

  it("cancels only what waits, and says what a signed or ended document is", async () => {
    const { provider, standIn } = d4signHarness();
    const open = await provider.createEnvelope(D4_INPUT);
    assert.equal(await provider.cancelDocument(open.id, "Documento errado"), "cancelled");
    assert.equal(await provider.cancelDocument(open.id, ""), "already_ended");
    const signed = await provider.createEnvelope(D4_INPUT);
    standIn.sign(signed.id, 1, "Ana Souza");
    standIn.sign(signed.id, 2, "Carlos Souza");
    assert.equal(await provider.cancelDocument(signed.id, ""), "already_signed");
    assert.equal(await provider.cancelDocument("aea20243-475a-43fc-8ba5-999999999999", ""), "not_found");
    assert.equal(await provider.cancelDocument("não-é-um-documento", ""), "not_found");
  });

  it("reads the account's safes by either spelling of their keys", async () => {
    const { provider } = d4signHarness();
    assert.deepEqual(await provider.listSafes(), [
      { uuid: D4_SAFE, name: "Clientes" },
      { uuid: "06b3ddb1-abc9-4ab8-b944-0d7c940486af", name: "Atendimento" },
    ]);
  });

  it("reads a delivery only when it names a document and an event", () => {
    assert.deepEqual(
      readD4SignWebhook({ uuid: "9f08bf18-bf4b-410f-9701-c286e5b1cad1", type_post: "4", message: "Signed" }),
      {
        documentUuid: "9f08bf18-bf4b-410f-9701-c286e5b1cad1",
        typePost: "4",
      },
    );
    assert.equal(readD4SignWebhook({ uuid: "doc", type_post: "4" }), null);
    assert.equal(readD4SignWebhook({ uuid: "9f08bf18-bf4b-410f-9701-c286e5b1cad1", type_post: "" }), null);
    assert.equal(readD4SignWebhook({}), null);
    assert.equal(
      d4signWebhookUrl("https://one.invalid/", "env-1", "k k"),
      "https://one.invalid/api/webhooks/d4sign?envelope=env-1&key=k+k",
    );
  });
});
