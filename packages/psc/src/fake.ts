import {
  constants,
  createHash,
  createHmac,
  KeyObject,
  privateEncrypt,
  randomBytes,
  timingSafeEqual,
  webcrypto,
} from "node:crypto";

import { challengeOf } from "@flyee/psc/pkce";
import {
  type AuthorizeRequest,
  MAX_PERSON_LIFETIME_SECONDS,
  type PscCertificate,
  PscError,
  type PscProvider,
  type PscScope,
  type PscToken,
  type SignRequest,
  type SignResult,
  type TokenRequest,
} from "@flyee/psc/types";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/** What pkijs takes as its crypto: the WebCrypto of Node, typed without the DOM. */
type EngineCrypto = ConstructorParameters<typeof pkijs.CryptoEngine>[0]["crypto"];

/**
 * A PSC in memory, for tests and for a machine with no PSC. It keeps a test
 * AC of its own and the certificates it issued to invented holders (by
 * default one of a person every manual uses as an example; with a login
 * hint, the person whose CPF it names), takes the holder's approval as a
 * test says it, and signs for real with keys it never hands out, so what is
 * built on its signatures verifies like what a PSC would sign. It honours the
 * norm's rules the contract checks: PKCE, a code that lives a minute and is
 * spent once, a token of one signature or of one call spent once, a session
 * that lives what was asked up to 7 days, and no token that outlives its
 * time.
 */

/** The DER that goes before a SHA-256 hash in a PKCS#1 v1.5 signature (the DigestInfo). */
const DIGEST_INFO_SHA256 = Buffer.from("3031300d060960864801650304020105000420", "hex");

type Pending = {
  request: AuthorizeRequest;
  holderCpf: string;
  code: string | null;
  codeIssuedAt: number;
  denied: boolean;
};
type FakeCertificate = { alias: string; pem: string; key: KeyObject };
type Session = { scope: PscScope; holderCpf: string; expiresAt: number; spent: boolean };

/**
 * A code or a token that carries what it stands for (lenient), under a
 * prefix no PSC would write, sealed with the instances' shared secret when
 * one is given, so that nobody else mints one.
 */
const sealOf = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

const carriedWith = (value: Record<string, unknown>, secret: string | null): string => {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return secret ? `fake.${payload}.${sealOf(payload, secret)}` : `fake.${payload}`;
};

function uncarriedWith(text: string, secret: string | null): Record<string, unknown> | null {
  if (!text.startsWith("fake.")) return null;
  const [payload = "", seal] = text.slice(5).split(".");
  if (secret) {
    const expected = Buffer.from(sealOf(payload, secret));
    const given = Buffer.from(seal ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  }
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ensureEngine = (() => {
  let done = false;
  return () => {
    if (done) return;
    pkijs.setEngine(
      "one-node",
      new pkijs.CryptoEngine({ name: "one-node", crypto: webcrypto as unknown as EngineCrypto }),
    );
    done = true;
  };
})();

const rsaKeys = async (): Promise<webcrypto.CryptoKeyPair> =>
  (await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as webcrypto.CryptoKeyPair;

const country = () =>
  new pkijs.AttributeTypeAndValue({ type: "2.5.4.6", value: new asn1js.PrintableString({ value: "BR" }) });
const icp = () =>
  new pkijs.AttributeTypeAndValue({ type: "2.5.4.10", value: new asn1js.Utf8String({ value: "ICP-Brasil" }) });
const commonName = (value: string) =>
  new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value }) });

const pemOf = (der: ArrayBuffer): string => {
  const lines =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
};

/** A serial of a holder's certificate that every instance of a server writes the same: from the CPF. */
const serialOfCpf = (cpf: string): Uint8Array =>
  new Uint8Array([0x01, ...createHash("sha256").update(`fake-psc:${cpf}`).digest().subarray(0, 8)]);

export type FakePscOptions = {
  name?: string;
  /** The holder, as the certificate names them: invented, with a CPF every manual uses as an example. */
  holderName?: string;
  holderCpf?: string;
  /** Whether the common name carries the CPF ("NOME:CPF"), as most authorities write it; the alternative name always does. */
  cpfInCommonName?: boolean;
  /** The default holder's certificate's serial, in hexadecimal. */
  serialHex?: string;
  /** The holder answers for a company too: its certificate (e-CNPJ) is listed first, and signs when no alias is named. */
  companyCertificateFirst?: boolean;
  /** The clock, in milliseconds: a test moves it to see a token run out. */
  now?: () => number;
  /**
   * The holder approves at once: the address of the PSC's page is the
   * application's own redirect address with the code (a development machine,
   * a preview).
   */
  consentAtOnce?: boolean;
  /**
   * Codes and tokens carry what they stand for, and a holder's certificate
   * has a serial derived from their CPF, so an instance of the server with
   * its own memory takes what another one made: a preview may run the action
   * that starts an authorization and the page the PSC sends the holder back
   * to in different instances.
   */
  lenient?: boolean;
  /** What every instance of a server shares, to seal the codes and tokens a lenient fake carries. */
  secret?: string;
  /**
   * The PSC grants this scope whatever was asked, and says so in its token
   * answer, as the norm has a PSC do when it grants another one.
   */
  grantScope?: PscScope;
};

export class FakePsc implements PscProvider {
  readonly name: string;
  /** The default holder's CPF. */
  readonly holderCpf: string;
  /** The default holder's certificate, in PEM, as `certificates` hands it. */
  readonly certificatePem: string;
  /** The test AC that issued every certificate here, in PEM: what a chain is checked against. */
  readonly authorityPem: string;
  /** Every hash the fake signed, by token: what a test reads to see one signature per act. */
  readonly signed: { token: string; ids: string[] }[] = [];
  private readonly authorityKey: webcrypto.CryptoKey;
  private readonly authority: pkijs.Certificate;
  private readonly holderName: string;
  private readonly cpfInCommonName: boolean;
  /** Each holder's certificates, in the order `certificates` lists them, each with the key it signs with. */
  private readonly holders = new Map<string, Promise<FakeCertificate[]>>();
  private readonly now: () => number;
  private readonly consentAtOnce: boolean;
  private readonly lenient: boolean;
  private readonly secret: string | null;
  private readonly grantScope: PscScope | null;
  private readonly pending = new Map<string, Pending>();
  private readonly sessions = new Map<string, Session>();
  private readonly spentCodes = new Set<string>();

  private constructor(
    options: Required<Pick<FakePscOptions, "name" | "holderName" | "holderCpf" | "cpfInCommonName">> & {
      authority: pkijs.Certificate;
      authorityKey: webcrypto.CryptoKey;
      authorityPem: string;
      now: () => number;
      consentAtOnce: boolean;
      lenient: boolean;
      secret: string | null;
      grantScope: PscScope | null;
    },
  ) {
    this.name = options.name;
    this.holderName = options.holderName;
    this.holderCpf = options.holderCpf;
    this.cpfInCommonName = options.cpfInCommonName;
    this.authority = options.authority;
    this.authorityKey = options.authorityKey;
    this.authorityPem = options.authorityPem;
    this.now = options.now;
    this.consentAtOnce = options.consentAtOnce;
    this.lenient = options.lenient;
    this.secret = options.secret;
    this.grantScope = options.grantScope;
    this.certificatePem = "";
  }

  /** A fake PSC with its test AC and the default holder's certificate. */
  static async create(options: FakePscOptions = {}): Promise<FakePsc> {
    ensureEngine();
    const now = options.now ?? Date.now;
    const issuedAt = now();

    // The authority that issues the holders' certificates, as an AC of ICP-Brasil does: a test AC of its own.
    const authorityKeys = await rsaKeys();
    const authority = new pkijs.Certificate();
    authority.version = 2;
    authority.serialNumber = new asn1js.Integer({ valueHex: new Uint8Array([0x01, ...randomBytes(8)]).buffer });
    authority.issuer.typesAndValues.push(country(), icp(), commonName("AC ONE DE TESTE"));
    authority.subject.typesAndValues.push(country(), icp(), commonName("AC ONE DE TESTE"));
    authority.notBefore.value = new Date(issuedAt - 2 * 24 * 60 * 60 * 1000);
    authority.notAfter.value = new Date(issuedAt + 5 * 365 * 24 * 60 * 60 * 1000);
    authority.extensions = [
      new pkijs.Extension({
        extnID: "2.5.29.19",
        critical: true,
        extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false),
      }),
    ];
    await authority.subjectPublicKeyInfo.importKey(authorityKeys.publicKey as never);
    await authority.sign(authorityKeys.privateKey as never, "SHA-256");

    const fake = new FakePsc({
      name: options.name ?? "fake",
      holderName: options.holderName ?? "ADVOGADA TESTE DA SILVA",
      holderCpf: options.holderCpf ?? "12345678909",
      cpfInCommonName: options.cpfInCommonName ?? true,
      authority,
      authorityKey: authorityKeys.privateKey,
      authorityPem: pemOf(authority.toSchema(true).toBER(false)),
      now,
      consentAtOnce: options.consentAtOnce ?? false,
      lenient: options.lenient ?? false,
      secret: options.secret ?? null,
      grantScope: options.grantScope ?? null,
    });
    // Where instances must agree (lenient), the default holder's serial comes from the CPF too.
    const held = fake.issueFor(fake.holderCpf, {
      serial: options.serialHex
        ? new Uint8Array(Buffer.from(options.serialHex, "hex"))
        : fake.lenient
          ? serialOfCpf(fake.holderCpf)
          : undefined,
      companyFirst: options.companyCertificateFirst ?? false,
    });
    fake.holders.set(fake.holderCpf, held);
    (fake as { certificatePem: string }).certificatePem = (await held).find((item) => item.alias === "fake")?.pem ?? "";
    return fake;
  }

  /** The certificates a holder has here: issued once per CPF, the serial from the CPF where instances must agree. */
  private holderCertificates(cpf: string): Promise<FakeCertificate[]> {
    let held = this.holders.get(cpf);
    if (!held) {
      held = this.issueFor(cpf, { serial: this.lenient ? serialOfCpf(cpf) : undefined, companyFirst: false });
      this.holders.set(cpf, held);
    }
    return held;
  }

  private async issueFor(
    cpf: string,
    options: { serial?: Uint8Array; companyFirst: boolean },
  ): Promise<FakeCertificate[]> {
    const issue = async (
      subjectName: string,
      otherNameOid: string,
      otherNameData: string,
      serial: Uint8Array,
    ): Promise<{ pem: string; key: KeyObject }> => {
      const keys = await rsaKeys();
      const issuedAt = this.now();
      const certificate = new pkijs.Certificate();
      certificate.version = 2;
      certificate.serialNumber = new asn1js.Integer({ valueHex: serial.slice().buffer });
      certificate.issuer.typesAndValues.push(...this.authority.subject.typesAndValues);
      certificate.subject.typesAndValues.push(
        country(),
        icp(),
        new pkijs.AttributeTypeAndValue({
          type: "2.5.4.11",
          value: new asn1js.Utf8String({ value: "Certificado de teste do ONE" }),
        }),
        commonName(subjectName),
      );
      const otherName = new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 0 },
        value: [
          new asn1js.ObjectIdentifier({ value: otherNameOid }),
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 0 },
            value: [new asn1js.OctetString({ valueHex: new Uint8Array(Buffer.from(otherNameData, "latin1")).buffer })],
          }),
        ],
      });
      certificate.extensions = [
        new pkijs.Extension({
          extnID: "2.5.29.17",
          critical: false,
          extnValue: new asn1js.Sequence({ value: [otherName] }).toBER(false),
        }),
      ];
      certificate.notBefore.value = new Date(issuedAt - 24 * 60 * 60 * 1000);
      certificate.notAfter.value = new Date(issuedAt + 365 * 24 * 60 * 60 * 1000);
      await certificate.subjectPublicKeyInfo.importKey(keys.publicKey as never);
      await certificate.sign(this.authorityKey as never, "SHA-256");
      return { pem: pemOf(certificate.toSchema(true).toBER(false)), key: KeyObject.from(keys.privateKey) };
    };

    // The holder's data as ICP-Brasil writes it (DOC-ICP-04, OID 2.16.76.1.3.1): the birth date, the CPF, then
    // the NIS and the identity document, here none.
    const person = await issue(
      this.cpfInCommonName ? `${this.holderName}:${cpf}` : this.holderName,
      "2.16.76.1.3.1",
      `01011980${cpf}${"0".repeat(11)}${"0".repeat(15)}`,
      options.serial ?? new Uint8Array([0x01, ...randomBytes(8)]),
    );
    const certificates: FakeCertificate[] = [{ alias: "fake", pem: person.pem, key: person.key }];
    if (options.companyFirst) {
      // A company's certificate (e-CNPJ) the same holder answers for: its CNPJ under 2.16.76.1.3.3, no CPF of a person.
      const company = await issue(
        "EMPRESA TESTE LTDA:11222333000181",
        "2.16.76.1.3.3",
        "11222333000181",
        new Uint8Array([0x02, ...randomBytes(8)]),
      );
      certificates.unshift({ alias: "fake-cnpj", pem: company.pem, key: company.key });
    }
    return certificates;
  }

  authorizeUrl(request: AuthorizeRequest): string {
    const hinted = request.loginHint?.replace(/\D/g, "");
    this.pending.set(request.state, {
      request,
      holderCpf: hinted && hinted.length === 11 ? hinted : this.holderCpf,
      code: null,
      codeIssuedAt: 0,
      denied: false,
    });
    if (this.consentAtOnce) {
      const back = new URL(request.redirectUri);
      back.searchParams.set("code", this.approve(request.state));
      back.searchParams.set("state", request.state);
      return back.toString();
    }
    const params = new URLSearchParams({ state: request.state, scope: request.scope, client_id: request.clientId });
    return `https://psc.invalid/fake/oauth/authorize?${params.toString()}`;
  }

  /** The holder approves at the PSC: the code their browser carries back to the redirect address. */
  approve(state: string): string {
    const item = this.pending.get(state);
    if (!item) throw new Error(`fake PSC: no authorization asked under state ${state}`);
    item.codeIssuedAt = this.now();
    item.code = this.lenient
      ? this.carried({
          c: item.request.codeChallenge,
          r: item.request.redirectUri,
          i: item.request.clientId,
          s: item.request.scope,
          l: item.request.lifetimeSeconds ?? 300,
          h: item.holderCpf,
          t: item.codeIssuedAt,
          n: randomBytes(8).toString("base64url"),
        })
      : randomBytes(16).toString("base64url");
    return item.code;
  }

  /** The holder says no at the PSC. */
  deny(state: string): void {
    const item = this.pending.get(state);
    if (item) item.denied = true;
  }

  async exchangeCode(request: TokenRequest): Promise<PscToken> {
    const entry =
      [...this.pending.entries()].find(([, item]) => item.code !== null && item.code === request.code) ??
      this.carriedCode(request.code);
    if (!entry) throw new PscError("expired", "fake PSC: unknown or spent code");
    const [state, item] = entry;
    this.pending.delete(state);
    this.spentCodes.add(request.code);
    if (item.denied) throw new PscError("denied", "fake PSC: the holder said no");
    if (this.now() - item.codeIssuedAt > 60_000) throw new PscError("expired", "fake PSC: the code lived its minute");
    if (request.clientId !== item.request.clientId || request.redirectUri !== item.request.redirectUri) {
      throw new PscError("expired", "fake PSC: the code was asked by another application or address");
    }
    if (challengeOf(request.codeVerifier) !== item.request.codeChallenge) {
      throw new PscError("expired", "fake PSC: the verifier does not match the challenge");
    }
    if (request.clientSecret.length === 0) throw new PscError("not_authorized", "fake PSC: no client secret");
    const asked = item.request.lifetimeSeconds ?? 300;
    const scope = this.grantScope ?? item.request.scope;
    const lifetime = scope === "signature_session" ? Math.min(Math.max(asked, 60), MAX_PERSON_LIFETIME_SECONDS) : 300;
    const expiresAt = this.now() + lifetime * 1000;
    const accessToken = this.lenient
      ? this.carried({
          s: scope,
          h: item.holderCpf,
          e: expiresAt,
          n: randomBytes(12).toString("base64url"),
        })
      : randomBytes(24).toString("base64url");
    this.sessions.set(accessToken, { scope, holderCpf: item.holderCpf, expiresAt, spent: false });
    return {
      accessToken,
      expiresIn: lifetime,
      scope: scope === item.request.scope ? null : scope,
      identification: { type: "CPF", value: item.holderCpf },
    };
  }

  async certificates(token: string): Promise<PscCertificate[]> {
    const session = this.live(token);
    return (await this.holderCertificates(session.holderCpf)).map((item) => ({ alias: item.alias, pem: item.pem }));
  }

  async sign(request: SignRequest): Promise<SignResult> {
    const session = this.live(request.token);
    if (request.format !== "RAW") throw new PscError("refused", "fake PSC: signs RAW only");
    if (session.scope === "single_signature" && request.hashes.length !== 1) {
      throw new PscError("refused", "fake PSC: a token of one signature signs one hash");
    }
    for (const item of request.hashes) {
      if (item.hash.length !== 32) throw new PscError("refused", `fake PSC: hash ${item.id} is not a SHA-256`);
    }
    // With no alias, the PSC signs with the first certificate the holder has, as a PSC whose holder has more than one may.
    const held = await this.holderCertificates(session.holderCpf);
    const signer = request.certificateAlias ? held.find((item) => item.alias === request.certificateAlias) : held[0];
    if (!signer) throw new PscError("refused", "fake PSC: no certificate under that alias");
    if (session.scope !== "signature_session") session.spent = true;
    const signatures = request.hashes.map((item) => ({
      id: item.id,
      value: new Uint8Array(
        privateEncrypt(
          { key: signer.key, padding: constants.RSA_PKCS1_PADDING },
          Buffer.concat([DIGEST_INFO_SHA256, Buffer.from(item.hash)]),
        ),
      ),
    }));
    this.signed.push({ token: request.token, ids: request.hashes.map((item) => item.id) });
    return { certificateAlias: signer.alias, signatures };
  }

  /** A code another instance made, read from what it carries: lenient only, and never twice in this one. */
  private carriedCode(code: string): [string, Pending] | undefined {
    if (!this.lenient || this.spentCodes.has(code)) return undefined;
    const value = uncarriedWith(code, this.secret);
    if (!value || typeof value.c !== "string" || typeof value.r !== "string" || typeof value.i !== "string") {
      return undefined;
    }
    const lifetime = Number(value.l);
    const request: AuthorizeRequest = {
      clientId: value.i,
      redirectUri: value.r,
      state: `carried-${code}`,
      codeChallenge: value.c,
      scope: value.s as PscScope,
      lifetimeSeconds: Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 300,
    };
    const issued = Number(value.t);
    const holderCpf = typeof value.h === "string" && /^[0-9]{11}$/.test(value.h) ? value.h : this.holderCpf;
    return [
      request.state,
      { request, holderCpf, code, codeIssuedAt: Number.isFinite(issued) ? issued : 0, denied: false },
    ];
  }

  private carried(value: Record<string, unknown>): string {
    return carriedWith(value, this.secret);
  }

  /** The token as the PSC holds it, or the error a spent or expired one answers. */
  private live(token: string): Session {
    let session = this.sessions.get(token);
    if (!session && this.lenient) {
      const value = uncarriedWith(token, this.secret);
      if (value && typeof value.s === "string" && Number.isFinite(Number(value.e))) {
        const ceiling = this.now() + MAX_PERSON_LIFETIME_SECONDS * 1000;
        session = {
          scope: value.s as PscScope,
          holderCpf: typeof value.h === "string" && /^[0-9]{11}$/.test(value.h) ? value.h : this.holderCpf,
          expiresAt: Math.min(Number(value.e), ceiling),
          spent: false,
        };
        this.sessions.set(token, session);
      }
    }
    if (!session) throw new PscError("expired", "fake PSC: unknown token");
    if (session.spent) throw new PscError("token_used", "fake PSC: the token was used already");
    if (this.now() >= session.expiresAt) throw new PscError("expired", "fake PSC: the token lived its time");
    return session;
  }
}
