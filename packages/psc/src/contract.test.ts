import assert from "node:assert/strict";
import { createHash, verify } from "node:crypto";
import { describe, it } from "node:test";

import { certificateFacts, cpfChecks } from "./certificate.ts";
import { FakePsc } from "./fake.ts";
import { challengeOf, newState, newVerifier } from "./pkce.ts";
import { ItiPscProvider } from "./providers/iti.ts";
import { PscError, type PscErrorCode, type PscProvider, type PscScope } from "./types.ts";

/**
 * What any PSC client must do, run against the fake and against the client
 * of the ITI's norm. The norm's client meets a stand-in that answers in the
 * shapes of DOC-ICP-17.01, item 6.4 (read on 2026-10-14), backed by a fake
 * PSC's key: once with the norm's own ways (a hash in base64, the token
 * asked with a form), once with BirdID's (a hash in hexadecimal, the token
 * asked in JSON). The holder is invented, with a CPF every manual uses.
 */

const CLIENT = { clientId: "one-test", clientSecret: "segredo-de-teste", redirectUri: "https://one.invalid/psc/volta" };
const sha256 = (text: string): Uint8Array => new Uint8Array(createHash("sha256").update(text, "utf8").digest());

type Harness = {
  name: string;
  provider: PscProvider;
  /** The holder approves at the PSC the authorization this address asks: the code that comes back. */
  holderApproves: (authorizeUrl: string) => string;
  advance: (ms: number) => void;
};

async function fakeHarness(): Promise<Harness> {
  let clock = Date.parse("2026-10-15T12:00:00Z");
  const psc = await FakePsc.create({ now: () => clock });
  return {
    name: "fake",
    provider: psc,
    holderApproves: (url) => psc.approve(new URL(url).searchParams.get("state") ?? ""),
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** A PSC behind HTTP, in the norm's shapes, holding a fake's key. */
async function normHarness(variant: { hashEncoding: "base64" | "hex"; tokenBody: "form" | "json" }): Promise<Harness> {
  let clock = Date.parse("2026-10-15T12:00:00Z");
  const inner = await FakePsc.create({ now: () => clock });
  const statusOf: Record<PscErrorCode, number> = {
    denied: 400,
    expired: 401,
    token_used: 400,
    refused: 400,
    not_authorized: 401,
    unavailable: 503,
  };
  const wordsOf: Record<PscErrorCode, Record<string, string>> = {
    denied: { error: "access_denied" },
    expired: { error: "invalid_token" },
    token_used: { code: "TOKEN_JA_UTILIZADO" },
    refused: { code: "INVALID_SIGNATURE" },
    not_authorized: { error: "invalid_client" },
    unavailable: { message: "indisponível" },
  };
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const standIn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const bearer = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    try {
      if (url.pathname.endsWith("/oauth/token")) {
        const text = String(init?.body ?? "");
        const fields: Record<string, string> =
          headers.get("content-type") === "application/json"
            ? (JSON.parse(text) as Record<string, string>)
            : Object.fromEntries(new URLSearchParams(text));
        if (fields.grant_type !== "authorization_code") return answer(400, { error: "unsupported_grant_type" });
        try {
          const token = await inner.exchangeCode({
            clientId: fields.client_id,
            clientSecret: fields.client_secret,
            code: fields.code,
            redirectUri: fields.redirect_uri,
            codeVerifier: fields.code_verifier,
          });
          return answer(200, {
            access_token: token.accessToken,
            token_type: "Bearer",
            expires_in: token.expiresIn,
            ...(token.scope ? { scope: token.scope } : {}),
            authorized_identification_type: token.identification?.type,
            authorized_identification: token.identification?.value,
          });
        } catch (error) {
          // A code spent, expired or of another verifier is the grant's: 400 invalid_grant, as OAuth answers.
          if (error instanceof PscError && error.code === "expired") return answer(400, { error: "invalid_grant" });
          throw error;
        }
      }
      if (url.pathname.endsWith("/oauth/certificate-discovery")) {
        const list = await inner.certificates(bearer);
        // The norm's PEM, sent here with its lines joined, as some PSCs send it.
        return answer(200, {
          status: "S",
          certificates: list.map((item) => ({
            alias: item.alias,
            certificate: item.pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""),
          })),
        });
      }
      if (url.pathname.endsWith("/oauth/signature")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          hashes: { id: string; hash: string; hash_algorithm: string; signature_format: "RAW" | "CMS" }[];
        };
        if (body.hashes.some((item) => item.hash_algorithm !== "2.16.840.1.101.3.4.2.1")) {
          return answer(400, { code: "INVALID_ALGORITHM" });
        }
        const decode = (value: string) =>
          new Uint8Array(Buffer.from(value, variant.hashEncoding === "hex" ? "hex" : "base64"));
        const signed = await inner.sign({
          token: bearer,
          format: body.hashes[0]?.signature_format ?? "RAW",
          hashes: body.hashes.map((item) => ({ id: item.id, hash: decode(item.hash) })),
        });
        return answer(200, {
          certificate_alias: signed.certificateAlias,
          signatures: signed.signatures.map((item) => ({
            id: item.id,
            raw_signature: Buffer.from(item.value).toString("base64"),
          })),
        });
      }
      return answer(404, { message: "não encontrado" });
    } catch (error) {
      if (error instanceof PscError) return answer(statusOf[error.code], wordsOf[error.code]);
      throw error;
    }
  };

  const provider = new ItiPscProvider({
    name: variant.hashEncoding === "hex" ? "birdid" : "norma",
    baseUrl: "https://psc.invalid/v0/",
    hashEncoding: variant.hashEncoding,
    tokenBody: variant.tokenBody,
    fetch: standIn,
  });
  return {
    name: `iti (${variant.hashEncoding}, ${variant.tokenBody})`,
    provider,
    holderApproves: (address) => {
      // The holder's browser takes the address to the PSC, which keeps the request and answers with a code.
      const params = new URL(address).searchParams;
      assert.equal(params.get("response_type"), "code");
      assert.equal(params.get("code_challenge_method"), "S256");
      inner.authorizeUrl({
        clientId: params.get("client_id") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        state: params.get("state") ?? "",
        codeChallenge: params.get("code_challenge") ?? "",
        scope: (params.get("scope") ?? "single_signature") as PscScope,
        lifetimeSeconds: params.get("lifetime") ? Number(params.get("lifetime")) : undefined,
        loginHint: params.get("login_hint") ?? undefined,
      });
      return inner.approve(params.get("state") ?? "");
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** The holder authorizes a scope, and the application exchanges the code: the token and what it reaches. */
async function authorized(harness: Harness, scope: PscScope, lifetimeSeconds?: number) {
  const verifier = newVerifier();
  const state = newState();
  const url = harness.provider.authorizeUrl({
    ...CLIENT,
    state,
    codeChallenge: challengeOf(verifier),
    scope,
    lifetimeSeconds,
    loginHint: "123.456.789-09",
  });
  assert.equal(new URL(url).searchParams.get("state"), state);
  const code = harness.holderApproves(url);
  const token = await harness.provider.exchangeCode({ ...CLIENT, code, codeVerifier: verifier });
  return { token, verifier, code };
}

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "ok";
  } catch (error) {
    assert.ok(error instanceof PscError, `not a PscError: ${String(error)}`);
    return error.code;
  }
};

const harnesses: { label: string; make: () => Promise<Harness> }[] = [
  { label: "the fake", make: fakeHarness },
  {
    label: "the norm's client, the norm's ways",
    make: () => normHarness({ hashEncoding: "base64", tokenBody: "form" }),
  },
  { label: "the norm's client, BirdID's ways", make: () => normHarness({ hashEncoding: "hex", tokenBody: "json" }) },
];

for (const { label, make } of harnesses) {
  describe(`a PSC client honours the contract: ${label}`, () => {
    it("signs a hash with the holder's certificate once the holder authorized it, and the signature verifies", async () => {
      const harness = await make();
      const { token } = await authorized(harness, "single_signature");
      assert.deepEqual(token.identification, { type: "CPF", value: "12345678909" }, harness.name);
      assert.ok(token.expiresIn > 0);
      const certificates = await harness.provider.certificates(token.accessToken);
      assert.equal(certificates.length, 1);
      assert.match(certificates[0].pem, /^-----BEGIN CERTIFICATE-----\n/);

      const petition = "Petição inicial de um caso inventado.";
      const result = await harness.provider.sign({
        token: token.accessToken,
        hashes: [{ id: "peticao", hash: sha256(petition) }],
        format: "RAW",
      });
      assert.equal(result.signatures.length, 1);
      assert.equal(result.signatures[0].id, "peticao");
      assert.ok(
        verify("sha256", Buffer.from(petition, "utf8"), certificates[0].pem, result.signatures[0].value),
        harness.name,
      );
    });

    it("spends a code once, and only with the verifier that asked for it", async () => {
      const harness = await make();
      const verifier = newVerifier();
      const url = harness.provider.authorizeUrl({
        ...CLIENT,
        state: newState(),
        codeChallenge: challengeOf(verifier),
        scope: "single_signature",
      });
      const code = harness.holderApproves(url);
      assert.equal(
        await codeOf(harness.provider.exchangeCode({ ...CLIENT, code, codeVerifier: newVerifier() })),
        "expired",
      );

      const second = harness.provider.authorizeUrl({
        ...CLIENT,
        state: newState(),
        codeChallenge: challengeOf(verifier),
        scope: "single_signature",
      });
      const fresh = harness.holderApproves(second);
      assert.equal(
        await codeOf(harness.provider.exchangeCode({ ...CLIENT, code: fresh, codeVerifier: verifier })),
        "ok",
      );
      assert.equal(
        await codeOf(harness.provider.exchangeCode({ ...CLIENT, code: fresh, codeVerifier: verifier })),
        "expired",
      );
    });

    it("lets a token of one signature sign once, and refuses what is not a SHA-256", async () => {
      const harness = await make();
      const { token } = await authorized(harness, "single_signature");
      assert.equal(
        await codeOf(
          harness.provider.sign({
            token: token.accessToken,
            hashes: [{ id: "curto", hash: new Uint8Array(20) }],
            format: "RAW",
          }),
        ),
        "refused",
      );
      assert.equal(
        await codeOf(
          harness.provider.sign({ token: token.accessToken, hashes: [{ id: "a", hash: sha256("a") }], format: "RAW" }),
        ),
        "ok",
      );
      assert.equal(
        await codeOf(
          harness.provider.sign({ token: token.accessToken, hashes: [{ id: "b", hash: sha256("b") }], format: "RAW" }),
        ),
        "token_used",
      );
    });

    it("lets a session sign as often as asked while it lasts, and never after", async () => {
      const harness = await make();
      const { token } = await authorized(harness, "signature_session", 3600);
      assert.equal(token.expiresIn, 3600);
      for (const text of ["primeira", "segunda"]) {
        const result = await harness.provider.sign({
          token: token.accessToken,
          hashes: [
            { id: `${text}-1`, hash: sha256(`${text}-1`) },
            { id: `${text}-2`, hash: sha256(`${text}-2`) },
          ],
          format: "RAW",
        });
        assert.equal(result.signatures.length, 2);
      }
      harness.advance(3600 * 1000);
      assert.equal(
        await codeOf(
          harness.provider.sign({
            token: token.accessToken,
            hashes: [{ id: "tarde", hash: sha256("tarde") }],
            format: "RAW",
          }),
        ),
        "expired",
      );
      assert.equal(await codeOf(harness.provider.certificates(token.accessToken)), "expired");
    });

    it("caps a natural person's session at seven days", async () => {
      const harness = await make();
      const { token } = await authorized(harness, "signature_session", 30 * 24 * 3600);
      assert.ok(token.expiresIn <= 7 * 24 * 3600, `${harness.name}: ${token.expiresIn}`);
    });
  });
}

describe("the norm's client reads a PSC's answers by what comes next", () => {
  const replying =
    (status: number, body: unknown): typeof fetch =>
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const client = (fetcher: typeof fetch) =>
    new ItiPscProvider({ name: "teste", baseUrl: "https://psc.invalid/v0", fetch: fetcher });
  const token = { ...CLIENT, code: "c", codeVerifier: "v" };

  it("names what the holder, the token or the platform must do", async () => {
    assert.equal(await codeOf(client(replying(400, { error: "access_denied" })).exchangeCode(token)), "denied");
    assert.equal(await codeOf(client(replying(400, { error: "invalid_grant" })).exchangeCode(token)), "expired");
    assert.equal(
      await codeOf(client(replying(401, { error: "invalid_client" })).exchangeCode(token)),
      "not_authorized",
    );
    assert.equal(await codeOf(client(replying(503, "fora do ar")).exchangeCode(token)), "unavailable");
    assert.equal(await codeOf(client(replying(401, { error: "invalid_token" })).certificates("t")), "expired");
    assert.equal(
      await codeOf(
        client(replying(400, { code: "TOKEN_JA_UTILIZADO" })).sign({
          token: "t",
          hashes: [{ id: "x", hash: sha256("x") }],
          format: "RAW",
        }),
      ),
      "token_used",
    );
    assert.equal(
      await codeOf(
        client(async () => {
          throw new Error("connection reset");
        }).certificates("t"),
      ),
      "unavailable",
    );
  });

  it("ends a lawyer's authorization only by what the token endpoint says, never by a refused hash", async () => {
    const signing = (status: number, body: unknown) =>
      codeOf(
        client(replying(status, body)).sign({ token: "t", hashes: [{ id: "x", hash: sha256("x") }], format: "RAW" }),
      );
    assert.equal(await signing(400, { message: "Hash recusado" }), "refused");
    assert.equal(await signing(403, { error: "access_denied" }), "refused");
    assert.equal(await signing(401, { error: "invalid_token" }), "expired");
    // Only words about the token spend it: an id or a hash said to be used already is the request's.
    assert.equal(await signing(400, { message: "Identificador já utilizado" }), "refused");
    assert.equal(await signing(400, { message: "Hash already used in this session" }), "refused");
    assert.equal(await signing(400, { message: "Token já utilizado" }), "token_used");
    assert.equal(await codeOf(client(replying(400, { message: "Autorização negada" })).exchangeCode(token)), "denied");
  });

  it("reads a signature's id as a number too, and a signature in hexadecimal from a PSC that takes hexadecimal", async () => {
    const value = new Uint8Array([0, 1, 2, 250, 251, 252]);
    const answered = (raw: string, id: unknown) =>
      new ItiPscProvider({
        name: "hex",
        baseUrl: "https://psc.invalid/v0",
        hashEncoding: "hex",
        fetch: replying(200, { certificate_alias: "a", signatures: [{ id, raw_signature: raw }] }),
      });
    const hex = await answered(Buffer.from(value).toString("hex"), 0).sign({
      token: "t",
      hashes: [{ id: "0", hash: sha256("x") }],
      format: "RAW",
    });
    assert.deepEqual(hex.signatures[0].value, value);
    const base64 = await answered(Buffer.from(value).toString("base64"), "0").sign({
      token: "t",
      hashes: [{ id: "0", hash: sha256("x") }],
      format: "RAW",
    });
    assert.deepEqual(base64.signatures[0].value, value);
  });

  it("reads the scope a PSC says it granted, and none when it says none", async () => {
    const granted = await client(
      replying(200, { access_token: "t", expires_in: 300, scope: "single_signature" }),
    ).exchangeCode(token);
    assert.equal(granted.scope, "single_signature");
    const silent = await client(replying(200, { access_token: "t", expires_in: 300 })).exchangeCode(token);
    assert.equal(silent.scope, null);

    const fake = await FakePsc.create({ consentAtOnce: true, grantScope: "single_signature" });
    const verifier = newVerifier();
    const code =
      new URL(
        fake.authorizeUrl({
          ...CLIENT,
          state: newState(),
          codeChallenge: challengeOf(verifier),
          scope: "signature_session",
        }),
      ).searchParams.get("code") ?? "";
    assert.equal((await fake.exchangeCode({ ...CLIENT, code, codeVerifier: verifier })).scope, "single_signature");
  });

  it("reads a CPF the PSC sends as a number with the zeros it lost, and a bundle by the holder's certificate", async () => {
    const answer = await client(
      replying(200, {
        access_token: "t",
        expires_in: 3600,
        authorized_identification_type: "CPF",
        authorized_identification: 12345678909,
      }),
    ).exchangeCode(token);
    assert.deepEqual(answer.identification, { type: "CPF", value: "12345678909" });
    const zeros = await client(
      replying(200, {
        access_token: "t",
        authorized_identification_type: "CPF",
        authorized_identification: 1234567890,
      }),
    ).exchangeCode(token);
    assert.equal(zeros.identification?.value, "01234567890");

    const holder = await FakePsc.create();
    const serial = certificateFacts(holder.certificatePem).serialHex;
    const listedFrom = async (certificate: string) =>
      (await client(replying(200, { certificates: [{ alias: "a", certificate }] })).certificates("t"))[0];
    // The holder's first, the chain first, and a PEM whose line breaks came written as "\\n".
    assert.equal(
      certificateFacts((await listedFrom(`${holder.certificatePem}\n${holder.authorityPem}\n`)).pem).serialHex,
      serial,
    );
    assert.equal(
      certificateFacts((await listedFrom(`${holder.authorityPem}\n${holder.certificatePem}\n`)).pem).serialHex,
      serial,
    );
    const escaped = holder.certificatePem.replace(/\n/g, "\\n");
    assert.equal(certificateFacts((await listedFrom(escaped)).pem).serialHex, serial);
    assert.equal(certificateFacts(holder.authorityPem).authority, true);
    assert.equal(certificateFacts(holder.certificatePem).authority, false);
  });

  it("takes a PSC with no certificate for the holder as none, and an answer missing a signature as refused", async () => {
    assert.deepEqual(await client(replying(200, { status: "N" })).certificates("t"), []);
    // An answer of another shape says nothing of the holder's certificates: refused, never "none".
    assert.equal(await codeOf(client(replying(200, { status: "S", certificados: [] })).certificates("t")), "refused");
    assert.equal(
      await codeOf(
        client(replying(200, { certificate_alias: "a", signatures: [] })).sign({
          token: "t",
          hashes: [{ id: "x", hash: sha256("x") }],
          format: "RAW",
        }),
      ),
      "refused",
    );
  });

  it("asks the holder's page with PKCE and the scope, and never sends the CPF with its marks", () => {
    const url = new URL(
      client(replying(200, {})).authorizeUrl({
        ...CLIENT,
        state: "s",
        codeChallenge: "c",
        scope: "signature_session",
        lifetimeSeconds: 604800,
        loginHint: "123.456.789-09",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://psc.invalid/v0/oauth/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "signature_session");
    assert.equal(url.searchParams.get("lifetime"), "604800");
    assert.equal(url.searchParams.get("login_hint"), "12345678909");
  });
});

describe("what a certificate says of its holder", () => {
  it("reads the holder's name and CPF as ICP-Brasil writes them, with its validity and issuer", async () => {
    const psc = await FakePsc.create({ now: () => Date.parse("2026-10-15T12:00:00Z") });
    const facts = certificateFacts(psc.certificatePem);
    assert.equal(facts.holderName, "ADVOGADA TESTE DA SILVA");
    assert.equal(facts.cpf, "12345678909");
    assert.equal(facts.issuerName, "AC ONE DE TESTE");
    assert.ok(facts.validUntil.getTime() > Date.parse("2027-01-01T00:00:00Z"));
    assert.ok(facts.validFrom.getTime() < Date.parse("2026-10-15T12:00:00Z"));
    assert.match(facts.serialHex, /^01[0-9a-f]{16}$/);
  });

  it("reads a company's certificate as no person's: its CNPJ, and no CPF", async () => {
    const psc = await FakePsc.create({ companyCertificateFirst: true });
    const verifier = newVerifier();
    const state = newState();
    psc.authorizeUrl({ ...CLIENT, state, codeChallenge: challengeOf(verifier), scope: "signature_session" });
    const token = await psc.exchangeCode({ ...CLIENT, code: psc.approve(state), codeVerifier: verifier });
    const [company, person] = await psc.certificates(token.accessToken);
    assert.deepEqual(
      { cpf: certificateFacts(company.pem).cpf, cnpj: certificateFacts(company.pem).cnpj },
      { cpf: null, cnpj: "11222333000181" },
    );
    assert.equal(certificateFacts(person.pem).cpf, "12345678909");
    // With no alias, a PSC may sign with the first certificate the holder has: the company's.
    const hash = sha256("documento");
    const unnamed = await psc.sign({ token: token.accessToken, hashes: [{ id: "d", hash }], format: "RAW" });
    assert.equal(unnamed.certificateAlias, company.alias);
    const named = await psc.sign({
      token: token.accessToken,
      hashes: [{ id: "d", hash }],
      format: "RAW",
      certificateAlias: person.alias,
    });
    assert.ok(verify("sha256", Buffer.from("documento"), person.pem, Buffer.from(named.signatures[0].value)));
  });

  it("finds the CPF in the alternative name when the common name does not carry it", async () => {
    const psc = await FakePsc.create({
      holderName: "ADVOGADO SEM NUMERO",
      holderCpf: "52998224725",
      cpfInCommonName: false,
    });
    const facts = certificateFacts(psc.certificatePem);
    assert.equal(facts.holderName, "ADVOGADO SEM NUMERO");
    assert.equal(facts.cpf, "52998224725");
    assert.equal(facts.commonNameCpf, null);
  });

  it("checks the CPF's digits, and never takes a CPF that does not check", async () => {
    assert.equal(cpfChecks("12345678909"), true);
    assert.equal(cpfChecks("12345678900"), false);
    assert.equal(cpfChecks("11111111111"), false);
    const psc = await FakePsc.create({ holderCpf: "12345678900" });
    assert.equal(certificateFacts(psc.certificatePem).cpf, null);
  });
});

describe("the fake on a machine with no PSC", () => {
  it("consents at once, and another instance with its own memory takes the code and the token", async () => {
    let clock = Date.parse("2026-10-15T12:00:00Z");
    const now = () => clock;
    const starts = await FakePsc.create({ consentAtOnce: true, lenient: true, now });
    const answers = await FakePsc.create({ consentAtOnce: true, lenient: true, now });
    const verifier = newVerifier();
    const state = newState();
    const back = new URL(
      starts.authorizeUrl({
        ...CLIENT,
        state,
        codeChallenge: challengeOf(verifier),
        scope: "signature_session",
        lifetimeSeconds: 3600,
      }),
    );
    assert.equal(back.origin + back.pathname, CLIENT.redirectUri);
    assert.equal(back.searchParams.get("state"), state);
    const code = back.searchParams.get("code") ?? "";

    const token = await answers.exchangeCode({ ...CLIENT, code, codeVerifier: verifier });
    assert.equal(token.expiresIn, 3600);
    assert.equal(await codeOf(answers.exchangeCode({ ...CLIENT, code, codeVerifier: verifier })), "expired");
    // Another code, asked with another verifier than the one it is exchanged with, is refused.
    const other =
      new URL(
        starts.authorizeUrl({
          ...CLIENT,
          state: newState(),
          codeChallenge: challengeOf(verifier),
          scope: "signature_session",
        }),
      ).searchParams.get("code") ?? "";
    assert.equal(
      await codeOf(answers.exchangeCode({ ...CLIENT, code: other, codeVerifier: newVerifier() })),
      "expired",
    );

    // The instance that signs reads the token another one gave, and hands its own certificate with its own signature.
    const [certificate] = await starts.certificates(token.accessToken);
    const hash = sha256("documento");
    const signed = await starts.sign({ token: token.accessToken, hashes: [{ id: "doc", hash }], format: "RAW" });
    assert.ok(verify("sha256", Buffer.from("documento"), certificate.pem, Buffer.from(signed.signatures[0].value)));

    clock += 3601_000;
    assert.equal(await codeOf(starts.certificates(token.accessToken)), "expired");
  });

  it("issues the certificate of the CPF the application hints, the same serial in every instance", async () => {
    const now = () => Date.parse("2026-10-15T12:00:00Z");
    const one = await FakePsc.create({ consentAtOnce: true, lenient: true, secret: "segredo-do-preview", now });
    const two = await FakePsc.create({ consentAtOnce: true, lenient: true, secret: "segredo-do-preview", now });
    const verifier = newVerifier();
    const back = new URL(
      one.authorizeUrl({
        ...CLIENT,
        state: newState(),
        codeChallenge: challengeOf(verifier),
        scope: "signature_session",
        loginHint: "529.982.247-25",
      }),
    );
    const token = await two.exchangeCode({
      ...CLIENT,
      code: back.searchParams.get("code") ?? "",
      codeVerifier: verifier,
    });
    assert.deepEqual(token.identification, { type: "CPF", value: "52998224725" });
    const [fromOne] = await one.certificates(token.accessToken);
    const [fromTwo] = await two.certificates(token.accessToken);
    assert.equal(certificateFacts(fromOne.pem).cpf, "52998224725");
    assert.equal(certificateFacts(fromOne.pem).serialHex, certificateFacts(fromTwo.pem).serialHex);

    // The default holder too: every lenient instance writes the same serial for the same CPF.
    const first = await FakePsc.create({ lenient: true, secret: "segredo-do-preview", now });
    const second = await FakePsc.create({ lenient: true, secret: "segredo-do-preview", now });
    assert.equal(certificateFacts(first.certificatePem).serialHex, certificateFacts(second.certificatePem).serialHex);

    // A code or a token sealed with another secret is no code of these instances.
    const other = await FakePsc.create({ consentAtOnce: true, lenient: true, secret: "outro-segredo", now });
    assert.equal(await codeOf(other.certificates(token.accessToken)), "expired");
  });

  it("is strict by default: a code or a token it did not make is unknown", async () => {
    const strict = await FakePsc.create();
    const lenient = await FakePsc.create({ consentAtOnce: true, lenient: true });
    const verifier = newVerifier();
    const url = new URL(
      lenient.authorizeUrl({
        ...CLIENT,
        state: newState(),
        codeChallenge: challengeOf(verifier),
        scope: "signature_session",
      }),
    );
    const code = url.searchParams.get("code") ?? "";
    assert.equal(await codeOf(strict.exchangeCode({ ...CLIENT, code, codeVerifier: verifier })), "expired");
    const token = await lenient.exchangeCode({ ...CLIENT, code, codeVerifier: verifier });
    assert.equal(await codeOf(strict.certificates(token.accessToken)), "expired");
  });
});
