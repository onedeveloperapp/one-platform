import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { FakeSignatureProvider } from "./fake.ts";
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

const INPUT: CreateEnvelopeInput = {
  pdf: PDF,
  title: "Procuração",
  signers: [{ name: "Ana Souza", phone: "5562999990001" }, { name: "Carlos Souza" }],
  externalId: "case-1/procuracao/v1",
};

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
function signatureContract(name: string, make: () => Harness) {
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
      assert.deepEqual(await provider.getStatus(envelope.id), envelope);
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
    const id = await provider.registerWebhook({ url: "https://one.test/api/webhooks/zapsign", secret: "segredo-longo" });
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
