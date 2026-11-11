import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { FAKE_FILING_CLOCK, FakeFilingChannel } from "./fake.ts";
import {
  MNI_FILING_SOAP_ACTION,
  MNI_MODEL_NS,
  MNI_SERVICE_NS,
  MNI_SERVICE_TYPES_NS,
  MNI_TJGO_ENDPOINT,
  mniDateTime,
  MniFilingChannel,
  mniFilingEnvelope,
  MniFilingInputError,
  mniFilingProblems,
  mniInstant,
  mniPetitionEnvelope,
  mniPetitionProblems,
  readMniFilingAnswer,
} from "./providers/mni.ts";
import type { FilingChannel, FilingOutcome, LawsuitFiling, PetitionFiling } from "./types.ts";
import { parseXml, type XmlElement } from "./xml.ts";

// ---------- An invented lawsuit: people nobody is, numbers of 2099, the CPFs the manuals use ----------

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.7\n% ${label}\n%%EOF\n`);
/** An invented certificate: what matters here is that its lines survive the trip. */
const PEM =
  "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUVGVzdGVJbnZlbnRhZG8=\nAQIDBAUGBwgJ\n-----END CERTIFICATE-----\n";
const CMS = Uint8Array.from([0x30, 0x82, 0x01, 0x0a, 0x06, 0x09, 0x2a, 0x86, 0x48]);
/** A company's name with every character XML must escape. */
const AIRLINE = `Companhia Aérea Teste <Linhas> & "Cia" 'S.A.'`;

function lawsuit(overrides: Partial<LawsuitFiling> = {}): LawsuitFiling {
  return {
    localityCode: "9001",
    competence: 15,
    judgingBody: { code: "4321", name: "Goiânia - 3º Juizado Especial Cível", ibgeCity: "5208707" },
    classCode: 436,
    subjects: [
      { code: 4829, main: true },
      { code: 7779, main: false },
    ],
    value: 10000.5,
    plaintiffs: [
      {
        name: "Ana Teste Souza",
        sex: "F",
        kind: "fisica",
        document: "12345678909",
        address: {
          street: "Rua Inventada",
          number: "10",
          complement: null,
          district: "Setor Teste",
          city: "Goiânia",
          state: "GO",
          zip: "74000000",
        },
        lawyers: [{ name: "Bruno Advogado Teste", oab: "GO0012345A", cpf: "52998224725" }],
        representedBy: null,
      },
      {
        name: "Lia Teste Souza",
        sex: "D",
        kind: "fisica",
        document: null,
        address: null,
        lawyers: [{ name: "Bruno Advogado Teste", oab: "GO0012345A", cpf: null }],
        representedBy: { name: "Ana Teste Souza", document: "12345678909" },
      },
    ],
    defendants: [
      {
        name: AIRLINE,
        sex: "D",
        kind: "juridica",
        document: "11222333000181",
        address: null,
        lawyers: [],
        representedBy: null,
      },
    ],
    documents: [
      {
        id: "peticao-1",
        typeCode: "202",
        description: "Petição inicial",
        pdf: pdf("peticao"),
        signature: { cms: CMS, certificatePem: PEM, signedAt: new Date("2026-10-15T13:29:00.000Z") },
      },
      { id: "procuracao-1", typeCode: "99", description: "Procuração", pdf: pdf("procuracao"), signature: null },
    ],
    // 10:30 in Brasília.
    sentAt: new Date("2026-10-15T13:30:00.000Z"),
    ...overrides,
  };
}

/** A lawsuit number of TJGO of 2099, with its check digits (Resolução CNJ 65/2008, Annex VIII). */
function tjgoNumber(sequence: number): string {
  const head = String(sequence).padStart(7, "0");
  const rest = "2099" + "8" + "09" + "0051";
  return `${head}${String(98n - (BigInt(`${head}${rest}00`) % 97n)).padStart(2, "0")}${rest}`;
}
const masked = (digits: string) =>
  `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
const isCnj = (digits: string) =>
  /^\d{20}$/.test(digits) && BigInt(`${digits.slice(0, 7)}${digits.slice(9)}${digits.slice(7, 9)}`) % 97n === 1n;
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const startsAsPdf = (bytes: Uint8Array | null) =>
  bytes !== null && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

// ---------- The court, in the shapes of the MNI's WSDL ----------

const RECEIPT = pdf("recibo assinado do tribunal");

/** An answer of the operation as a JAX-WS court writes it: its own prefixes, the types' elements qualified. */
function resposta(fields: {
  sucesso: string;
  mensagem: string;
  protocolo?: string;
  data?: string;
  recibo?: string;
  parametros?: [string, string][];
}): string {
  return (
    `<ns2:entregarManifestacaoProcessualResposta xmlns:ns2="${MNI_SERVICE_NS}" xmlns:ns3="${MNI_SERVICE_TYPES_NS}" xmlns:ns4="${MNI_MODEL_NS}">` +
    `<ns3:sucesso>${fields.sucesso}</ns3:sucesso><ns3:mensagem>${fields.mensagem}</ns3:mensagem>` +
    (fields.protocolo === undefined ? "" : `<ns3:protocoloRecebimento>${fields.protocolo}</ns3:protocoloRecebimento>`) +
    `<ns3:dataOperacao>${fields.data ?? "20261015103005"}</ns3:dataOperacao>` +
    (fields.recibo === undefined ? "" : `<ns3:recibo>${fields.recibo}</ns3:recibo>`) +
    (fields.parametros ?? []).map(([nome, valor]) => `<ns3:parametro nome="${nome}" valor="${valor}"/>`).join("") +
    `</ns2:entregarManifestacaoProcessualResposta>`
  );
}
const soap = (inside: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${inside}</S:Body></S:Envelope>`;
const soapFault = (text: string) =>
  soap(`<S:Fault><faultcode>S:Server</faultcode><faultstring>${text}</faultstring></S:Fault>`);
const reply = (body: string | Uint8Array, status = 200, contentType = "text/xml; charset=utf-8") =>
  new Response(body, { status, headers: { "content-type": contentType } });

type Seen = { url: string; init: RequestInit & { dispatcher?: unknown }; body: string; envelope: XmlElement };

/**
 * The court's MNI: it reads the request with the package's own reader, answers a Fault to another SOAPAction,
 * refuses a request with no `dadosBasicos`, and otherwise files the lawsuit under a protocol and a number of its
 * own, with a receipt. `answer` replaces what it answers.
 */
function courtStandIn(answer?: (seen: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  let sequence = 0;
  const run = (async (input: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const seen: Seen = { url: String(input), init: init ?? {}, body, envelope: parseXml(body) };
    calls.push(seen);
    if (answer) return answer(seen);
    const action = new Headers(init?.headers).get("soapaction");
    if (action !== `"${MNI_FILING_SOAP_ACTION}"`) return reply(soapFault("Operação desconhecida."), 500);
    const operation = seen.envelope.children[0]?.children[0];
    if (!operation?.children.some((child) => child.name === "tip:dadosBasicos")) {
      return reply(soap(resposta({ sucesso: "false", mensagem: "Dados básicos ausentes.", protocolo: "TJGO-0" })));
    }
    sequence += 1;
    const number = tjgoNumber(sequence);
    return reply(
      soap(
        resposta({
          sucesso: "true",
          mensagem: `Processo ${masked(number)} distribuído ao 3º Juizado Especial Cível.`,
          protocolo: `TJGO-PROT-${sequence}`,
          recibo: base64(RECEIPT),
        }),
      ),
    );
  }) as typeof fetch;
  return { run, calls };
}

/** A failure of the network as undici gives it: `TypeError("fetch failed")` with the system's error as its cause. */
const networkError = (code: string) =>
  new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code} 203.0.113.9:443`), { code }) });
const throwing = (error: unknown) =>
  (async () => {
    throw error;
  }) as typeof fetch;

// ---------- The contract ----------

type Scenario = "answers" | "unreachable" | "lost";

/** What any channel to file a lawsuit must do, whatever is behind it. */
function filingContract(name: string, make: (scenario: Scenario) => FilingChannel) {
  describe(`filing channel contract: ${name}`, () => {
    it("files a lawsuit the court takes, with its protocol, its number and its receipt", async () => {
      const outcome = await make("answers").fileLawsuit(lawsuit());
      assert.equal(outcome.kind, "filed");
      if (outcome.kind !== "filed") return;
      assert.ok(outcome.protocol.length > 0);
      assert.ok(outcome.caseNumber !== null && isCnj(outcome.caseNumber), "a CNJ number with its check digits");
      assert.ok(startsAsPdf(outcome.receipt));
      assert.ok(outcome.at instanceof Date && !Number.isNaN(outcome.at.getTime()));
    });

    it("files each lawsuit sent as its own", async () => {
      const channel = make("answers");
      const first = await channel.fileLawsuit(lawsuit());
      const second = await channel.fileLawsuit(lawsuit());
      assert.ok(first.kind === "filed" && second.kind === "filed");
      assert.notEqual(first.protocol, second.protocol);
      assert.notEqual(first.caseNumber, second.caseNumber);
    });

    it("refuses a lawsuit with no plaintiff, no defendant, no petition first or a document that is no PDF", async () => {
      const [petition, power] = lawsuit().documents;
      const wrong: LawsuitFiling[] = [
        lawsuit({ plaintiffs: [] }),
        lawsuit({ defendants: [] }),
        lawsuit({ documents: [] }),
        lawsuit({ documents: [power, petition] }),
        lawsuit({ documents: [petition, { ...power, pdf: new TextEncoder().encode("não sou um PDF") }] }),
        lawsuit({ documents: [{ ...petition, pdf: new Uint8Array() }] }),
      ];
      for (const filing of wrong) {
        const channel = make("answers");
        const outcome = await channel.fileLawsuit(filing);
        assert.equal(outcome.kind, "refused");
        if (outcome.kind !== "refused") return;
        assert.equal(outcome.protocol, null);
        assert.ok(outcome.message.length > 0);
      }
    });

    it("takes a petition by its national code or a child of it", async () => {
      const [petition, power] = lawsuit().documents;
      const outcome = await make("answers").fileLawsuit(
        lawsuit({ documents: [{ ...petition, typeCode: "363" }, power] }),
      );
      assert.equal(outcome.kind, "filed");
    });

    it("says a court it could not reach is unavailable, and an answer lost on the way unknown", async () => {
      const unreachable = await make("unreachable").fileLawsuit(lawsuit());
      assert.equal(unreachable.kind, "unavailable");
      assert.ok(unreachable.kind === "unavailable" && unreachable.reason.length > 0);
      const lost = await make("lost").fileLawsuit(lawsuit());
      assert.equal(lost.kind, "unknown");
      assert.ok(lost.kind === "unknown" && lost.reason.length > 0);
    });
  });
}

filingContract("fake", (scenario) => {
  const channel = new FakeFilingChannel();
  if (scenario === "unreachable") channel.failNext("unavailable");
  if (scenario === "lost") channel.failNext("unknown");
  return channel;
});

filingContract("mni", (scenario) => {
  const standIn =
    scenario === "unreachable"
      ? throwing(networkError("ECONNREFUSED"))
      : scenario === "lost"
        ? throwing(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
        : courtStandIn().run;
  return new MniFilingChannel({
    endpoint: MNI_TJGO_ENDPOINT,
    idManifestante: "11222333000181",
    senhaManifestante: "s",
    fetch: standIn,
  });
});

// ---------- The fake, beyond the contract ----------

describe("the fake filing channel, beyond the contract", () => {
  it("numbers the lawsuits of TJGO of 2099 in order, on its clock, and keeps what reached it", async () => {
    const channel = new FakeFilingChannel();
    const first = await channel.fileLawsuit(lawsuit());
    assert.ok(first.kind === "filed");
    assert.equal(first.protocol, "FAKE-1");
    assert.equal(first.caseNumber?.slice(0, 7), "0000001");
    assert.equal(first.caseNumber?.slice(9), "2099809" + "0001");
    assert.equal(first.at.toISOString(), FAKE_FILING_CLOCK);
    await channel.fileLawsuit(lawsuit({ plaintiffs: [] }));
    channel.failNext("unknown");
    await channel.fileLawsuit(lawsuit());
    channel.failNext("unavailable");
    await channel.fileLawsuit(lawsuit());
    // Taken, refused and lost reached it; the unreachable one did not.
    assert.equal(channel.received.length, 3);
    const after = await channel.fileLawsuit(lawsuit());
    assert.ok(after.kind === "filed" && after.protocol === "FAKE-2");
    const clocked = await new FakeFilingChannel({ now: () => new Date("2099-01-02T03:04:05.000Z") }).fileLawsuit(
      lawsuit(),
    );
    assert.ok(clocked.kind === "filed" && clocked.at.toISOString() === "2099-01-02T03:04:05.000Z");
  });
});

// ---------- The MNI's envelope ----------

const named = (element: XmlElement | null | undefined, name: string) =>
  (element?.children ?? []).filter((child) => child.name === name);
const one = (element: XmlElement | null | undefined, name: string): XmlElement => {
  const found = named(element, name);
  assert.equal(found.length, 1, `one ${name}`);
  return found[0];
};
const operationOf = (envelope: string) =>
  one(one(parseXml(envelope), "soapenv:Body"), "ser:entregarManifestacaoProcessual");

describe("the MNI's envelope", () => {
  it("is the SOAP 1.1 request of entregarManifestacaoProcessual in the schemas' namespaces", () => {
    const text = mniFilingEnvelope(lawsuit());
    const root = parseXml(text);
    assert.equal(root.name, "soapenv:Envelope");
    assert.equal(root.attributes["xmlns:soapenv"], "http://schemas.xmlsoap.org/soap/envelope/");
    assert.equal(root.attributes["xmlns:ser"], "http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/");
    assert.equal(root.attributes["xmlns:tip"], "http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2");
    assert.equal(root.attributes["xmlns:int"], "http://www.cnj.jus.br/intercomunicacao-2.2.2");
    const operation = operationOf(text);
    assert.deepEqual(
      operation.children.map((child) => child.name),
      ["tip:dadosBasicos", "tip:documento", "tip:documento", "tip:dataEnvio"],
    );
    assert.equal(one(operation, "tip:dataEnvio").text, "20261015103000");
  });

  it("writes the lawsuit's basic data: class, locality, competence, poles, subjects, value and judging body", () => {
    const basics = one(operationOf(mniFilingEnvelope(lawsuit())), "tip:dadosBasicos");
    assert.deepEqual(basics.attributes, {
      numero: "00000000000000000000",
      classeProcessual: "436",
      codigoLocalidade: "9001",
      nivelSigilo: "0",
      competencia: "15",
    });
    assert.deepEqual(
      basics.children.map((child) => child.name + (child.attributes.polo ? `:${child.attributes.polo}` : "")),
      ["int:polo:AT", "int:polo:PA", "int:assunto", "int:assunto", "int:valorCausa", "int:orgaoJulgador"],
    );
    const [main, other] = named(basics, "int:assunto");
    assert.equal(main.attributes.principal, "true");
    assert.equal(one(main, "int:codigoNacional").text, "4829");
    assert.equal(other.attributes.principal, undefined);
    assert.equal(one(other, "int:codigoNacional").text, "7779");
    assert.equal(one(basics, "int:valorCausa").text, "10000.50");
    assert.deepEqual(one(basics, "int:orgaoJulgador").attributes, {
      codigoOrgao: "4321",
      nomeOrgao: "Goiânia - 3º Juizado Especial Cível",
      instancia: "ORIG",
      codigoMunicipioIBGE: "5208707",
    });
  });

  it("writes each party as the schema has it: the person, the CPF or CNPJ, the address, the lawyers, a minor's parent", () => {
    const basics = one(operationOf(mniFilingEnvelope(lawsuit())), "tip:dadosBasicos");
    const [plaintiffs, defendants] = named(basics, "int:polo");
    const [adult, minor] = named(plaintiffs, "int:parte");

    const person = one(adult, "int:pessoa");
    assert.deepEqual(person.attributes, {
      nome: "Ana Teste Souza",
      sexo: "F",
      tipoPessoa: "fisica",
      numeroDocumentoPrincipal: "12345678909",
    });
    assert.deepEqual(one(person, "int:documento").attributes, {
      codigoDocumento: "12345678909",
      emissorDocumento: "RFB",
      tipoDocumento: "CMF",
    });
    const address = one(person, "int:endereco");
    assert.equal(address.attributes.cep, "74000000");
    assert.deepEqual(
      address.children.map((child) => [child.name, child.text]),
      [
        ["int:logradouro", "Rua Inventada"],
        ["int:numero", "10"],
        ["int:bairro", "Setor Teste"],
        ["int:cidade", "Goiânia"],
        ["int:estado", "GO"],
        ["int:pais", "BR"],
      ],
    );
    assert.deepEqual(one(adult, "int:advogado").attributes, {
      nome: "Bruno Advogado Teste",
      inscricao: "GO0012345A",
      numeroDocumentoPrincipal: "52998224725",
      intimacao: "true",
      tipoRepresentante: "A",
    });
    assert.deepEqual(
      adult.children.map((child) => child.name),
      ["int:pessoa", "int:advogado"],
    );

    // A minor: no document and no address of their own, the lawyer with no CPF on record, and who answers for them.
    const child = one(minor, "int:pessoa");
    assert.deepEqual(child.attributes, { nome: "Lia Teste Souza", sexo: "D", tipoPessoa: "fisica" });
    assert.equal(child.children.length, 0);
    assert.equal(one(minor, "int:advogado").attributes.numeroDocumentoPrincipal, undefined);
    const related = one(minor, "int:pessoaProcessualRelacionada");
    assert.equal(related.attributes.relacionamentoProcessual, "RP");
    const parent = one(related, "int:pessoa");
    assert.deepEqual(parent.attributes, {
      nome: "Ana Teste Souza",
      sexo: "D",
      tipoPessoa: "fisica",
      numeroDocumentoPrincipal: "12345678909",
    });
    assert.equal(one(parent, "int:documento").attributes.tipoDocumento, "CMF");

    // The airline: a company, its CNPJ under the same cadastre, its name as written.
    const airline = one(one(defendants, "int:parte"), "int:pessoa");
    assert.deepEqual(airline.attributes, {
      nome: AIRLINE,
      sexo: "D",
      tipoPessoa: "juridica",
      numeroDocumentoPrincipal: "11222333000181",
    });
    assert.deepEqual(one(airline, "int:documento").attributes, {
      codigoDocumento: "11222333000181",
      emissorDocumento: "RFB",
      tipoDocumento: "CMF",
    });
    assert.equal(named(one(defendants, "int:parte"), "int:advogado").length, 0);
  });

  it("carries each document in order, with its SHA-256, its bytes in base64 and its signature", () => {
    const filing = lawsuit();
    const [petition, power] = named(operationOf(mniFilingEnvelope(filing)), "tip:documento");
    assert.deepEqual(petition.attributes, {
      idDocumento: "peticao-1",
      tipoDocumento: "202",
      mimetype: "application/pdf",
      descricao: "Petição inicial",
      nivelSigilo: "0",
      hash: createHash("sha256").update(filing.documents[0].pdf).digest("hex"),
    });
    assert.match(petition.attributes.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      petition.children.map((child) => child.name),
      ["int:conteudo", "int:assinatura"],
    );
    assert.equal(one(petition, "int:conteudo").text, base64(filing.documents[0].pdf));
    assert.deepEqual(one(petition, "int:assinatura").attributes, {
      assinatura: base64(CMS),
      // 10:29 in Brasília.
      dataAssinatura: "20261015102900",
      cadeiaCertificado: PEM,
      algoritmoHash: "SHA-256",
      codificacaoCertificado: "PEM",
    });
    assert.equal(power.attributes.idDocumento, "procuracao-1");
    assert.equal(power.attributes.tipoDocumento, "99");
    assert.deepEqual(
      power.children.map((child) => child.name),
      ["int:conteudo"],
    );
  });

  it("escapes what XML would read otherwise, and keeps a certificate's lines in its attribute", () => {
    const text = mniFilingEnvelope(lawsuit());
    assert.ok(text.includes("Companhia Aérea Teste &lt;Linhas&gt; &amp; &quot;Cia&quot; &apos;S.A.&apos;"));
    assert.ok(text.includes("-----BEGIN CERTIFICATE-----&#10;MIIB"));
    assert.ok(!text.includes(AIRLINE));
  });

  it("writes the credential only when given, first and escaped", () => {
    const without = operationOf(mniFilingEnvelope(lawsuit()));
    assert.equal(named(without, "tip:idManifestante").length, 0);
    assert.equal(named(without, "tip:senhaManifestante").length, 0);
    const nothing = operationOf(mniFilingEnvelope(lawsuit(), { idManifestante: null, senhaManifestante: "" }));
    assert.equal(named(nothing, "tip:idManifestante").length + named(nothing, "tip:senhaManifestante").length, 0);
    const text = mniFilingEnvelope(lawsuit(), { idManifestante: "11222333000181", senhaManifestante: "se<n>ha&1" });
    assert.ok(text.includes("<tip:senhaManifestante>se&lt;n&gt;ha&amp;1</tip:senhaManifestante>"));
    const withAuth = operationOf(text);
    assert.deepEqual(
      withAuth.children.slice(0, 3).map((child) => [child.name, child.text]),
      [
        ["tip:idManifestante", "11222333000181"],
        ["tip:senhaManifestante", "se<n>ha&1"],
        ["tip:dadosBasicos", ""],
      ],
    );
  });

  it("marks a priority of processing by the court's code, after the subjects and before the value", () => {
    const basics = one(operationOf(mniFilingEnvelope(lawsuit({ priorities: ["IDOSO"] }))), "tip:dadosBasicos");
    const order = basics.children.map((child) => child.name);
    assert.equal(one(basics, "int:prioridade").text, "IDOSO");
    assert.ok(order.indexOf("int:prioridade") > order.lastIndexOf("int:assunto"));
    assert.ok(order.indexOf("int:prioridade") < order.indexOf("int:valorCausa"));
    assert.equal(named(one(operationOf(mniFilingEnvelope(lawsuit())), "tip:dadosBasicos"), "int:prioridade").length, 0);
  });

  it("leaves out what the filing does not hold", () => {
    const text = mniFilingEnvelope(lawsuit({ value: null, competence: null }));
    const basics = one(operationOf(text), "tip:dadosBasicos");
    assert.equal(named(basics, "int:valorCausa").length, 0);
    assert.equal(basics.attributes.competencia, undefined);
    assert.ok(!/undefined|null|NaN/.test(text));
  });

  it("writes and reads a moment in Brasília's time", () => {
    assert.equal(mniDateTime(new Date("2026-01-15T02:00:00.000Z")), "20260114230000");
    assert.equal(mniInstant("20261015103000")?.toISOString(), "2026-10-15T13:30:00.000Z");
    assert.equal(mniInstant("20261315103000"), null);
    assert.equal(mniInstant("20261015106000"), null);
    assert.equal(mniInstant("2026101510300"), null);
  });

  it("is never written for a filing the MNI cannot carry, and says what keeps it without a person's data", () => {
    const [adult, minor] = lawsuit().plaintiffs;
    const filing = lawsuit({
      plaintiffs: [
        {
          ...adult,
          address: { ...adult.address!, zip: "7400000" },
          lawyers: [{ name: "Bruno Advogado Teste", oab: "GO12345", cpf: null }],
        },
        { ...minor, representedBy: { name: "Ana Teste Souza", document: "123" } },
      ],
      subjects: [{ code: 4829, main: false }],
      judgingBody: { code: "4321", name: "Juizado", ibgeCity: "52087" },
    });
    assert.throws(
      () => mniFilingEnvelope(filing),
      (error: unknown) =>
        error instanceof MniFilingInputError &&
        error.problems.includes("o CEP do autor 1 não tem 8 dígitos") &&
        error.problems.some((problem) => problem.startsWith("a inscrição na OAB de um advogado do autor 1")) &&
        error.problems.includes("o CPF de quem representa o autor 2 não tem 11 dígitos") &&
        error.problems.includes("a ação não tem um único assunto principal") &&
        error.problems.includes("o código IBGE do município do órgão julgador não tem 7 dígitos") &&
        !error.message.includes("Ana") &&
        !error.message.includes("7400000"),
    );
    assert.deepEqual(mniFilingProblems(lawsuit()), []);
    assert.ok(mniFilingProblems(lawsuit({ value: Number.NaN })).includes("o valor da causa não é um valor"));
    assert.ok(
      mniFilingProblems(lawsuit({ defendants: [{ ...lawsuit().defendants[0], name: "Cia\u0001" }] })).includes(
        "um texto da ação tem um caractere que o XML não carrega",
      ),
    );
    assert.ok(
      mniFilingProblems(lawsuit({ defendants: [{ ...lawsuit().defendants[0], document: "12345678909" }] })).includes(
        "o CNPJ do réu 1 não tem 14 dígitos",
      ),
    );
  });
});

// ---------- The MNI's request, and what it comes to ----------

const filedOf = (outcome: FilingOutcome) => {
  assert.equal(outcome.kind, "filed");
  if (outcome.kind !== "filed") throw new Error("not filed");
  return outcome;
};

describe("the MNI's request, and what each answer comes to", () => {
  it("posts the envelope with its SOAPAction to the court's address, through the dispatcher it was given", async () => {
    const standIn = courtStandIn();
    const dispatcher = { tls: "a client certificate's agent" };
    const channel = new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: standIn.run, dispatcher });
    filedOf(await channel.fileLawsuit(lawsuit()));
    assert.equal(standIn.calls.length, 1);
    const [call] = standIn.calls;
    assert.equal(call.url, "https://projudi.tjgo.jus.br/IntercomunicacaoService");
    assert.equal(call.init.method, "POST");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("content-type"), "text/xml; charset=utf-8");
    assert.equal(
      headers.get("soapaction"),
      '"http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/entregarManifestacaoProcessual"',
    );
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.init.dispatcher, dispatcher);
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.body, mniFilingEnvelope(lawsuit()));
  });

  it("reads a success: its protocol, the lawsuit's number its message writes, its receipt and its moment", async () => {
    const standIn = courtStandIn();
    const outcome = filedOf(
      await new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: standIn.run }).fileLawsuit(lawsuit()),
    );
    assert.equal(outcome.protocol, "TJGO-PROT-1");
    assert.equal(outcome.caseNumber, tjgoNumber(1));
    assert.deepEqual(outcome.receipt, RECEIPT);
    // 10:30:05 in Brasília.
    assert.equal(outcome.at.toISOString(), "2026-10-15T13:30:05.000Z");
    assert.equal(outcome.message, `Processo ${masked(tjgoNumber(1))} distribuído ao 3º Juizado Especial Cível.`);
  });

  it("reads the number from a parametro, never one whose check digits fail, and nothing when none is written", () => {
    const fromParameter = filedOf(
      readMniFilingAnswer(
        soap(
          resposta({
            sucesso: "true",
            mensagem: "Petição recebida.",
            protocolo: "P-1",
            parametros: [["numeroProcesso", tjgoNumber(7)]],
          }),
        ),
      ),
    );
    assert.equal(fromParameter.caseNumber, tjgoNumber(7));
    assert.equal(fromParameter.receipt, null);
    const wrongCheck = masked(tjgoNumber(7)).replace(
      /^(\d{7})-(\d)(\d)/,
      (_, head, a, b) => `${head}-${a}${(Number(b) + 1) % 10}`,
    );
    const notNumber = filedOf(
      readMniFilingAnswer(soap(resposta({ sucesso: "true", mensagem: `Processo ${wrongCheck}.`, protocolo: "P-2" }))),
    );
    assert.equal(notNumber.caseNumber, null);
    const now = new Date("2026-10-15T14:00:00.000Z");
    const noDate = filedOf(
      readMniFilingAnswer(soap(resposta({ sucesso: "true", mensagem: "", protocolo: "P-3", data: "ontem" })), now),
    );
    assert.equal(noDate.at, now);
    assert.equal(noDate.message, null);
    assert.equal(noDate.caseNumber, null);
  });

  it("reads a refusal with the court's words and its protocol, and a Fault as a refusal with its faultstring", async () => {
    const refusal = readMniFilingAnswer(
      soap(resposta({ sucesso: "false", mensagem: "Nenhum documento do tipo INICIAL.", protocolo: "TJGO-PROT-9" })),
    );
    assert.deepEqual(refusal, {
      kind: "refused",
      protocol: "TJGO-PROT-9",
      message: "Nenhum documento do tipo INICIAL.",
    });
    const undistributed = readMniFilingAnswer(
      soap(
        resposta({
          sucesso: "false",
          mensagem: "Distribuição automática inviável.",
          protocolo: "",
          parametros: [["competencia", "15"]],
        }),
      ),
    );
    assert.deepEqual(undistributed, {
      kind: "refused",
      protocol: null,
      message: "Distribuição automática inviável. (competencia: 15)",
    });
    const fault = await new MniFilingChannel({
      endpoint: MNI_TJGO_ENDPOINT,
      fetch: courtStandIn(() => reply(soapFault("Classe processual inválida para a localidade."), 500)).run,
    }).fileLawsuit(lawsuit());
    assert.deepEqual(fault, {
      kind: "refused",
      protocol: null,
      message: "Classe processual inválida para a localidade.",
    });
    const clientFault = await new MniFilingChannel({
      endpoint: MNI_TJGO_ENDPOINT,
      fetch: courtStandIn(() => reply(soapFault("Requisição malformada."), 400)).run,
    }).fileLawsuit(lawsuit());
    assert.equal(clientFault.kind, "refused");
  });

  it("reads an answer in Latin-1, with whatever prefixes, or none", async () => {
    const answer =
      `<?xml version="1.0" encoding="ISO-8859-1"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
      `<entregarManifestacaoProcessualResposta xmlns="${MNI_SERVICE_NS}"><sucesso xmlns="${MNI_SERVICE_TYPES_NS}">true</sucesso>` +
      `<mensagem xmlns="${MNI_SERVICE_TYPES_NS}">Petição recebida. Número ${tjgoNumber(3)}.</mensagem>` +
      `<protocoloRecebimento xmlns="${MNI_SERVICE_TYPES_NS}">PJD-77</protocoloRecebimento>` +
      `<dataOperacao xmlns="${MNI_SERVICE_TYPES_NS}">20261015103010</dataOperacao></entregarManifestacaoProcessualResposta></soap:Body></soap:Envelope>`;
    const latin1 = Uint8Array.from(answer, (letter) => letter.charCodeAt(0));
    const outcome = filedOf(
      await new MniFilingChannel({
        endpoint: MNI_TJGO_ENDPOINT,
        fetch: courtStandIn(() => reply(latin1, 200, "text/xml;charset=ISO-8859-1")).run,
      }).fileLawsuit(lawsuit()),
    );
    assert.equal(outcome.message, `Petição recebida. Número ${tjgoNumber(3)}.`);
    assert.equal(outcome.caseNumber, tjgoNumber(3));
    assert.equal(outcome.protocol, "PJD-77");
  });

  it("is unavailable only when nothing could have reached the court", async () => {
    const outcomes: [string, Promise<FilingOutcome>][] = [
      ...["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].map((code): [string, Promise<FilingOutcome>] => [
        code,
        new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: throwing(networkError(code)) }).fileLawsuit(
          lawsuit(),
        ),
      ]),
      [
        "every address refused",
        new MniFilingChannel({
          endpoint: MNI_TJGO_ENDPOINT,
          fetch: throwing(
            new TypeError("fetch failed", {
              cause: Object.assign(
                new AggregateError([networkError("ECONNREFUSED").cause, networkError("ECONNREFUSED").cause]),
                {
                  code: "ECONNREFUSED",
                },
              ),
            }),
          ),
        }).fileLawsuit(lawsuit()),
      ],
      [
        "503",
        new MniFilingChannel({
          endpoint: MNI_TJGO_ENDPOINT,
          fetch: courtStandIn(() => reply("", 503)).run,
        }).fileLawsuit(lawsuit()),
      ],
      [
        "429",
        new MniFilingChannel({
          endpoint: MNI_TJGO_ENDPOINT,
          fetch: courtStandIn(() => reply("", 429)).run,
        }).fileLawsuit(lawsuit()),
      ],
    ];
    for (const [label, outcome] of outcomes) assert.equal((await outcome).kind, "unavailable", label);

    const standIn = courtStandIn();
    for (const endpoint of ["não é um endereço", "ftp://projudi.tjgo.jus.br/IntercomunicacaoService"]) {
      const outcome = await new MniFilingChannel({ endpoint, fetch: standIn.run }).fileLawsuit(lawsuit());
      assert.deepEqual(outcome, { kind: "unavailable", reason: "mni_endpoint_invalid" });
    }
    assert.equal(standIn.calls.length, 0);
  });

  it("is unknown, never unavailable, for anything that may have reached the court with no answer to read", async () => {
    const hanging = (async (_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const cut = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<S:Envelope><S:Body>"));
            controller.error(Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }));
          },
        }),
        { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } },
      );
    const answering = (response: () => Response) =>
      new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: courtStandIn(response).run });
    const failing = (error: unknown) => new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: throwing(error) });
    const cases: [string, MniFilingChannel, string][] = [
      [
        "a timeout",
        new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: hanging, timeoutMs: 20 }),
        "mni_timeout",
      ],
      ["an abort", failing(Object.assign(new Error("aborted"), { name: "AbortError" })), "mni_aborted"],
      ["a reset after sending", failing(networkError("ECONNRESET")), "mni_no_answer: ECONNRESET"],
      ["a socket closed", failing(networkError("UND_ERR_SOCKET")), "mni_no_answer: UND_ERR_SOCKET"],
      // A port fetch itself refuses ("bad port") says no code: it is not told apart from a failure after sending.
      [
        "a failure with no code",
        failing(new TypeError("fetch failed", { cause: new Error("bad port") })),
        "mni_no_answer",
      ],
      [
        "a refused address beside a reset one",
        failing(
          new TypeError("fetch failed", {
            cause: new AggregateError([networkError("ECONNREFUSED").cause, networkError("ECONNRESET").cause]),
          }),
        ),
        "mni_no_answer: ECONNREFUSED",
      ],
      [
        "a 502",
        answering(() => reply(soap(resposta({ sucesso: "true", mensagem: "ok", protocolo: "P" })), 502)),
        "mni_http_502",
      ],
      ["a 504", answering(() => reply("<html>Gateway Timeout</html>", 504, "text/html")), "mni_http_504"],
      [
        "a 500 with no SOAP answer",
        answering(() => reply("<html><body>Erro interno</body></html>", 500, "text/html")),
        "mni_http_500",
      ],
      ["a 404", answering(() => reply("Not Found", 404, "text/plain")), "mni_http_404"],
      [
        "a redirect",
        answering(() => new Response(null, { status: 302, headers: { location: "https://outro.invalid/" } })),
        "mni_http_302",
      ],
      [
        "a 200 that is no XML",
        answering(() => reply("<html><body>Manutenção", 200, "text/html")),
        "mni_answer_unreadable",
      ],
      [
        "a 200 cut on the way",
        answering(() => reply(soap(resposta({ sucesso: "true", mensagem: "ok", protocolo: "P" })).slice(0, 180))),
        "mni_answer_unreadable",
      ],
      [
        "a 200 with no answer of the operation",
        answering(() => reply(soap("<ns2:outraCoisa xmlns:ns2='x'/>"))),
        "mni_answer_unreadable",
      ],
      [
        "a 200 whose success has no protocol",
        answering(() => reply(soap(resposta({ sucesso: "true", mensagem: "ok" })))),
        "mni_filed_without_protocol",
      ],
      [
        "a 200 whose success is neither",
        answering(() => reply(soap(resposta({ sucesso: "talvez", mensagem: "ok", protocolo: "P" })))),
        "mni_answer_unreadable",
      ],
      ["a 200 whose body breaks while read", answering(cut), "mni_answer_cut"],
      [
        "a 200 in MTOM",
        answering(() =>
          reply("--uuid\r\n\r\n<S:Envelope/>\r\n--uuid--", 200, 'multipart/related; type="application/xop+xml"'),
        ),
        "mni_answer_multipart",
      ],
    ];
    for (const [label, channel, reason] of cases) {
      assert.deepEqual(await channel.fileLawsuit(lawsuit()), { kind: "unknown", reason }, label);
    }
  });

  it("never reads a broken answer as a filing or a refusal", () => {
    for (const text of [
      "",
      "não é XML",
      "<a><b></a>",
      "<S:Envelope><S:Body>&#99999999;</S:Body></S:Envelope>",
      soap(""),
    ]) {
      assert.equal(readMniFilingAnswer(text).kind, "unknown", text);
    }
  });

  it("refuses before sending a filing the MNI cannot carry, saying what keeps it", async () => {
    const standIn = courtStandIn();
    const [adult, minor] = lawsuit().plaintiffs;
    const outcome = await new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: standIn.run }).fileLawsuit(
      lawsuit({ plaintiffs: [{ ...adult, address: { ...adult.address!, zip: "7400000" } }, minor] }),
    );
    assert.deepEqual(outcome, {
      kind: "refused",
      protocol: null,
      message: "Não enviado ao tribunal: o CEP do autor 1 não tem 8 dígitos.",
    });
    const empty = await new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: standIn.run }).fileLawsuit(
      lawsuit({ defendants: [] }),
    );
    assert.equal(empty.kind, "refused");
    assert.equal(standIn.calls.length, 0);
  });
});

// ---------- A petition into a lawsuit the court has ----------

function petition(overrides: Partial<PetitionFiling> = {}): PetitionFiling {
  return {
    caseNumber: tjgoNumber(7),
    documents: [{ id: "peca-1", typeCode: "57", description: "Réplica", pdf: pdf("réplica"), signature: null }],
    sentAt: new Date("2026-11-11T13:00:00.000Z"),
    ...overrides,
  };
}

describe("a petition into a lawsuit the court has", () => {
  it("names the lawsuit by its number, never its basic data, and carries the documents", () => {
    const operation = operationOf(mniPetitionEnvelope(petition()));
    assert.equal(one(operation, "tip:numeroProcesso").text, tjgoNumber(7));
    assert.equal(named(operation, "tip:dadosBasicos").length, 0);
    assert.equal(named(operation, "tip:documento").length, 1);
  });

  it("is never written for a number that is not one, nor with no document", () => {
    assert.deepEqual(mniPetitionProblems(petition({ caseNumber: "123" })), ["o número do processo não é um número CNJ"]);
    assert.ok(mniPetitionProblems(petition({ documents: [] })).includes("a petição não tem documento"));
    assert.throws(() => mniPetitionEnvelope(petition({ caseNumber: "123" })), MniFilingInputError);
  });

  it("is filed through the MNI with the court's protocol, and refused before sending when it cannot be carried", async () => {
    const standIn = courtStandIn(() =>
      reply(soap(resposta({ sucesso: "true", mensagem: "Petição juntada.", protocolo: "TJGO-PET-1" }))),
    );
    const channel = new MniFilingChannel({ endpoint: MNI_TJGO_ENDPOINT, fetch: standIn.run });
    const outcome = filedOf(await channel.filePetition(petition()));
    assert.equal(outcome.protocol, "TJGO-PET-1");
    assert.equal(standIn.calls[0].body, mniPetitionEnvelope(petition()));
    const refused = await channel.filePetition(petition({ documents: [] }));
    assert.equal(refused.kind, "refused");
    assert.equal(standIn.calls.length, 1);
  });

  it("is kept by the fake court, filed under the lawsuit's own number, and lost when told to", async () => {
    const fake = new FakeFilingChannel();
    const outcome = filedOf(await fake.filePetition(petition()));
    assert.equal(outcome.caseNumber, tjgoNumber(7));
    assert.equal(fake.petitions.length, 1);
    fake.failNext("unknown");
    assert.equal((await fake.filePetition(petition())).kind, "unknown");
  });
});
