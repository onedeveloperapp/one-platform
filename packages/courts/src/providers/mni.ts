import { createHash } from "node:crypto";

import { brasiliaInstant } from "@flyee/courts/providers/projudi";
import type { FilingChannel, FilingDocument, FilingOutcome, FilingParty, LawsuitFiling, PetitionFiling } from "@flyee/courts/types";
import { parseXml, type XmlElement } from "@flyee/courts/xml";

/**
 * A new lawsuit filed in a court's system through the CNJ's channel for
 * machines, the MNI 2.2.2 (Modelo Nacional de Interoperabilidade, Resolução
 * Conjunta CNJ/CNMP 3/2013): the operation `entregarManifestacaoProcessual`
 * with `dadosBasicos` (a lawsuit that has no number yet) and its documents,
 * the petition first. Never a lawyer's login on the court's screen.
 *
 * Written from the CNJ's WSDL and XSDs of the version 2.2.2
 * (`servico-intercomunicacao-2.2.2.wsdl`, `tipos-servico-intercomunicacao-2.2.2.xsd`
 * and `intercomunicacao-2.2.2.xsd`, read on 2026-10-14 for the research on
 * filing by machine and again on 2026-11-05 for this client) and from the WSDL
 * TJGO's Projudi publishes at `https://projudi.tjgo.jus.br/IntercomunicacaoService?wsdl`
 * (read on the same days: the same operation, the same SOAPAction, the same
 * qualified elements, and one operation of its own,
 * `consultarRelatorioDeIntimacoesTJGO`). None of it ran against a court: the
 * contract test answers from a stand-in in the shapes of the WSDL.
 *
 * What the schemas say, and what this writes by: SOAP 1.1, document/literal,
 * SOAPAction `http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/entregarManifestacaoProcessual`;
 * the operation's element in the service's namespace, its children
 * (`idManifestante`, `senhaManifestante`, `dadosBasicos`, `documento`,
 * `dataEnvio`) in the namespace of the service's types, and what is inside
 * `dadosBasicos` and `documento` in the model's namespace, every attribute
 * unqualified; a lawsuit not yet filed is numbered with twenty zeros; `polo`,
 * `assunto`, `valorCausa` and `orgaoJulgador` in that order, the judging body
 * required even of an initial petition; a CPF and a CNPJ are both a document
 * `CMF` ("cadastro no Ministério da Fazenda Brasileiro": the enumeration
 * `modalidadeDocumentoIdentificador` has no other code for either, and
 * `numeroDocumentoPrincipal` takes 11 or 14 digits); the CEP is an attribute
 * of `endereco`, eight digits; a registration at the bar is UF, seven digits
 * and a letter; moments are `AAAAMMDDHHMMSS` with no zone, written here in
 * Brasília's time, as the courts keep them; the answer carries `sucesso`,
 * `mensagem`, `protocoloRecebimento` ("sendo bem sucedida ou não"),
 * `dataOperacao`, a `recibo` (a signed PDF, on success) and `parametro`s (the
 * competences a lawsuit could go to when the court could not distribute it
 * by itself).
 *
 * To be confirmed in each court's homologation, each also said where it is
 * written below: which authentication the court grants (`idManifestante` and
 * `senhaManifestante`, or a TLS client certificate, in which case the schema
 * tells the court to ignore the two); what the signature of a document is
 * (the CMS whole, the RAW value of the signature with the chain beside it,
 * or a `conteudo` already signed, as TJRJ asks); whether `hash` is written in
 * hexadecimal or in base64; how a minor's parent or guardian is named; the
 * schema's extension point `<any namespace="##other">` inside `documento`,
 * which has no `minOccurs` (strictly one element of another namespace per
 * document; nothing is written there); whether a petition's type is 202 or
 * one of its children; how the answer carries the new lawsuit's number (read
 * here from `mensagem` or a `parametro`); whether the court answers in MTOM
 * (a multipart answer is an answer this cannot read, so `unknown`); and the
 * court's own codes (`codigoLocalidade`, `competencia`, `orgaoJulgador`),
 * which come from the platform's table, never from here.
 */

export const MNI_TJGO_ENDPOINT = "https://projudi.tjgo.jus.br/IntercomunicacaoService";

const SOAP_ENVELOPE_NS = "http://schemas.xmlsoap.org/soap/envelope/";
export const MNI_SERVICE_NS = "http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/";
export const MNI_SERVICE_TYPES_NS = "http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2";
export const MNI_MODEL_NS = "http://www.cnj.jus.br/intercomunicacao-2.2.2";
export const MNI_FILING_SOAP_ACTION = `${MNI_SERVICE_NS}entregarManifestacaoProcessual`;

/**
 * The national codes of an initial petition (Resolução CNJ 46, its table of documents, read on 2026-10-14): 202
 * "Petição Inicial" and its children 361 (with secrecy asked), 362 (with an injunction asked) and 363 (others),
 * which a court may ask for instead. The schema asks for one document of the kind "INICIAL"; which code each court
 * reads as that is confirmed in its homologation.
 */
export const MNI_INITIAL_PETITION_TYPES: readonly string[] = ["202", "361", "362", "363"];

/** A filing that is not one the MNI can carry: what is wrong, by field and position, never a person's data. */
export class MniFilingInputError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`mni_filing_invalid: ${problems.join("; ")}`);
    this.name = "MniFilingInputError";
    this.problems = problems;
  }
}

export type MniAuth = {
  /**
   * Who files, as the court registered them (the firm's CNPJ or a lawyer's CPF, or the id the court gave). The
   * schema tells the court to ignore it when the connection carries a TLS client certificate.
   */
  idManifestante?: string | null;
  /** The password the court gave for its webservice; ignored likewise under a client certificate. */
  senhaManifestante?: string | null;
};

export type MniConfig = MniAuth & {
  /** The court's address of the service, e.g. `MNI_TJGO_ENDPOINT`, or its homologation's. */
  endpoint: string;
  fetch?: typeof fetch;
  /**
   * An undici `Agent` carrying the firm's ICP-Brasil certificate as the TLS client certificate, when the court
   * authenticates so. Passed through to `fetch` as its `dispatcher`.
   */
  dispatcher?: unknown;
  /** How long to wait for the whole answer. 120 seconds unless said. */
  timeoutMs?: number;
};

// ---------- What the MNI cannot carry ----------

const isValidDate = (value: Date): boolean => value instanceof Date && !Number.isNaN(value.getTime());

/** The bytes of a PDF: its header within the first 1,024 bytes, as readers of PDF accept it. */
function isPdf(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) return false;
  const head = bytes.subarray(0, 1024);
  for (let at = 0; at + 5 <= head.length; at += 1) {
    if (
      head[at] === 0x25 &&
      head[at + 1] === 0x50 &&
      head[at + 2] === 0x44 &&
      head[at + 3] === 0x46 &&
      head[at + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

/** A character XML 1.0 cannot carry at all (a control other than tab and line ends, a lone surrogate, U+FFFE, U+FFFF). */
const NOT_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** A registration at the bar as the MNI writes it (`tipoCadastroOAB`): UF, seven digits, a letter. */
const OAB_MNI = /^[A-Za-z]{2}\d{7}[A-Za-z]$/;

const blank = (value: string | null | undefined): boolean => !value || !value.trim();

/**
 * What keeps a filing from being one the MNI can carry, in plain words with the position of each thing (never a
 * name, a number or anything else of a person). Empty when it can be sent.
 */
export function mniFilingProblems(filing: LawsuitFiling): string[] {
  const problems: string[] = [];
  const say = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem);
  };
  const texts: string[] = [];

  if (filing.plaintiffs.length === 0) say("a ação não tem autor");
  if (filing.defendants.length === 0) say("a ação não tem réu");
  const sides: [string, FilingParty[]][] = [
    ["autor", filing.plaintiffs],
    ["réu", filing.defendants],
  ];
  for (const [side, parties] of sides) {
    parties.forEach((party, index) => {
      const label = `${side} ${index + 1}`;
      texts.push(party.name);
      if (blank(party.name)) say(`o ${label} não tem nome`);
      if (party.document !== null) {
        const digits = party.kind === "fisica" ? 11 : 14;
        if (!new RegExp(`^\\d{${digits}}$`).test(party.document)) {
          say(`o ${party.kind === "fisica" ? "CPF" : "CNPJ"} do ${label} não tem ${digits} dígitos`);
        }
      }
      if (party.address) {
        const { street, number, complement, district, city, state, zip } = party.address;
        texts.push(street, number ?? "", complement ?? "", district ?? "", city, state);
        if (zip !== null && !/^\d{8}$/.test(zip)) say(`o CEP do ${label} não tem 8 dígitos`);
        if (!/^[A-Za-z]{2}$/.test(state)) say(`a UF do endereço do ${label} não tem duas letras`);
      }
      for (const lawyer of party.lawyers) {
        texts.push(lawyer.name, lawyer.oab);
        if (blank(lawyer.name)) say(`um advogado do ${label} não tem nome`);
        if (!OAB_MNI.test(lawyer.oab)) {
          say(
            `a inscrição na OAB de um advogado do ${label} não está no formato do MNI (UF, sete dígitos e uma letra)`,
          );
        }
        if (lawyer.cpf !== null && !/^\d{11}$/.test(lawyer.cpf))
          say(`o CPF de um advogado do ${label} não tem 11 dígitos`);
      }
      if (party.representedBy) {
        texts.push(party.representedBy.name);
        if (blank(party.representedBy.name)) say(`quem representa o ${label} não tem nome`);
        if (party.representedBy.document !== null && !/^\d{11}$/.test(party.representedBy.document)) {
          say(`o CPF de quem representa o ${label} não tem 11 dígitos`);
        }
      }
    });
  }

  if (filing.documents.length === 0) say("a ação não tem documento");
  else if (!MNI_INITIAL_PETITION_TYPES.includes(filing.documents[0].typeCode)) {
    say("o primeiro documento não é a petição inicial");
  }
  const ids = new Set<string>();
  filing.documents.forEach((document, index) => {
    const label = `o documento ${index + 1}`;
    texts.push(document.id, document.description, document.typeCode);
    if (blank(document.id)) say(`${label} não tem id`);
    else if (ids.has(document.id)) say(`dois documentos têm o mesmo id`);
    ids.add(document.id);
    if (!/^\d+$/.test(document.typeCode)) say(`${label} não tem o código nacional do seu tipo`);
    if (!isPdf(document.pdf)) say(`${label} não é um PDF`);
    if (document.signature) {
      texts.push(document.signature.certificatePem);
      if (!(document.signature.cms instanceof Uint8Array) || document.signature.cms.length === 0) {
        say(`a assinatura d${label} não tem o CMS`);
      }
      if (!/-----BEGIN CERTIFICATE-----/.test(document.signature.certificatePem)) {
        say(`a assinatura d${label} não tem o certificado em PEM`);
      }
      if (!isValidDate(document.signature.signedAt)) say(`a assinatura d${label} não tem data`);
    }
  });

  texts.push(filing.localityCode, filing.judgingBody.code, filing.judgingBody.name);
  if (blank(filing.localityCode)) say("a ação não tem o código da localidade");
  if (filing.competence !== null && !Number.isInteger(filing.competence)) say("a competência não é um número inteiro");
  if (blank(filing.judgingBody.code) || blank(filing.judgingBody.name)) say("o órgão julgador não tem código ou nome");
  if (!/^\d{7}$/.test(filing.judgingBody.ibgeCity))
    say("o código IBGE do município do órgão julgador não tem 7 dígitos");
  if (!Number.isInteger(filing.classCode) || filing.classCode <= 0) say("a classe da ação não é um código");
  if (filing.subjects.length === 0) say("a ação não tem assunto");
  if (filing.subjects.some((subject) => !Number.isInteger(subject.code) || subject.code <= 0)) {
    say("um assunto da ação não é um código");
  }
  if (filing.subjects.length > 0 && filing.subjects.filter((subject) => subject.main).length !== 1) {
    say("a ação não tem um único assunto principal");
  }
  if (filing.value !== null && (!Number.isFinite(filing.value) || filing.value < 0 || filing.value >= 1e13)) {
    say("o valor da causa não é um valor");
  }
  if (!isValidDate(filing.sentAt)) say("a data de envio não é uma data");
  if (texts.some((text) => NOT_XML.test(text))) say("um texto da ação tem um caractere que o XML não carrega");
  return problems;
}

/** What keeps a petition into a lawsuit the court has from being one the MNI can carry. Empty when it can be sent. */
export function mniPetitionProblems(filing: PetitionFiling): string[] {
  const problems: string[] = [];
  const say = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem);
  };
  const texts: string[] = [];
  if (!isCnj(filing.caseNumber)) say("o número do processo não é um número CNJ");
  if (filing.documents.length === 0) say("a petição não tem documento");
  const ids = new Set<string>();
  filing.documents.forEach((document, index) => {
    const label = `o documento ${index + 1}`;
    texts.push(document.id, document.description, document.typeCode);
    if (blank(document.id)) say(`${label} não tem id`);
    else if (ids.has(document.id)) say(`dois documentos têm o mesmo id`);
    ids.add(document.id);
    if (!/^\d+$/.test(document.typeCode)) say(`${label} não tem o código nacional do seu tipo`);
    if (!isPdf(document.pdf)) say(`${label} não é um PDF`);
    if (document.signature) texts.push(document.signature.certificatePem);
  });
  if (!isValidDate(filing.sentAt)) say("a data de envio não é uma data");
  if (texts.some((text) => NOT_XML.test(text))) say("um texto da petição tem um caractere que o XML não carrega");
  return problems;
}

// ---------- The request ----------

const ESCAPE_TEXT: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
  "\r": "&#13;",
};
// In an attribute, a line end or a tab would be read back as a space (XML 1.0, 3.3.3): a PEM keeps its lines.
const ESCAPE_ATTRIBUTE: Record<string, string> = { ...ESCAPE_TEXT, "\n": "&#10;", "\t": "&#9;" };
const escapeText = (value: string): string => value.replace(/[&<>"'\r]/g, (char) => ESCAPE_TEXT[char]);
const escapeAttribute = (value: string): string => value.replace(/[&<>"'\r\n\t]/g, (char) => ESCAPE_ATTRIBUTE[char]);

type Attributes = Record<string, string | number | null | undefined>;

/** An element: its attributes (those with no value left out), then its children or its text. */
function element(name: string, attributes: Attributes, content?: string | string[]): string {
  const written = Object.entries(attributes)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined && entry[1] !== "",
    )
    .map(([key, value]) => ` ${key}="${escapeAttribute(String(value))}"`)
    .join("");
  if (content === undefined || (Array.isArray(content) && content.length === 0)) return `<${name}${written}/>`;
  const inside = Array.isArray(content) ? content.join("") : escapeText(content);
  return `<${name}${written}>${inside}</${name}>`;
}

/** An element of text only when there is text: what is not on record is not written. */
const textElement = (name: string, value: string | null | undefined): string[] =>
  value && value.trim() ? [element(name, {}, value.trim())] : [];

const base64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");

/** The SHA-256 of the bytes, lowercase hexadecimal. */
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const BRASILIA = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** A moment as the MNI writes it (`tipoDataHora`, `AAAAMMDDHHMMSS`), in Brasília's time. */
export function mniDateTime(moment: Date): string {
  const parts = BRASILIA.formatToParts(moment);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

/** A moment the MNI wrote (`AAAAMMDDHHMMSS`), read as Brasília's time; null when it is not one. */
export function mniInstant(stamp: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (Number(minute) > 59 || Number(second) > 59) return null;
  const instant = brasiliaInstant(`${day}/${month}/${year} ${hour}:${minute}:${second}`);
  return instant ? new Date(instant) : null;
}

/**
 * A person of the lawsuit. The CPF and the CNPJ are both `CMF`: the schema's enumeration
 * (`modalidadeDocumentoIdentificador`) names the cadastre of the Ministério da Fazenda once for both, and has no
 * code "CNPJ"; that a court's implementation reads a CNPJ under it, and the issuer "RFB", is confirmed in its
 * homologation.
 */
function person(attributes: Attributes, document: string | null, address: FilingParty["address"]): string {
  return element("int:pessoa", { ...attributes, numeroDocumentoPrincipal: document }, [
    ...(document
      ? [element("int:documento", { codigoDocumento: document, emissorDocumento: "RFB", tipoDocumento: "CMF" })]
      : []),
    ...(address
      ? [
          // The CEP is an attribute of `endereco` (`tipoEndereco`, eight digits); with a valid one the court may read
          // the rest from the postal directory, and is told to ignore the state and the country.
          element("int:endereco", { cep: address.zip }, [
            ...textElement("int:logradouro", address.street),
            ...textElement("int:numero", address.number),
            ...textElement("int:complemento", address.complement),
            ...textElement("int:bairro", address.district),
            ...textElement("int:cidade", address.city),
            ...textElement("int:estado", address.state.toUpperCase()),
            element("int:pais", {}, "BR"),
          ]),
        ]
      : []),
  ]);
}

function party(filingParty: FilingParty): string {
  return element("int:parte", {}, [
    person(
      { nome: filingParty.name.trim(), sexo: filingParty.sex, tipoPessoa: filingParty.kind },
      filingParty.document,
      filingParty.address,
    ),
    ...filingParty.lawyers.map((lawyer) =>
      element("int:advogado", {
        nome: lawyer.name.trim(),
        inscricao: lawyer.oab,
        numeroDocumentoPrincipal: lawyer.cpf,
        intimacao: "true",
        tipoRepresentante: "A",
      }),
    ),
    // Who answers for a minor. The schema offers two ways: a `pessoaProcessualRelacionada` of the part (a `parte`
    // of its own, here with `relacionamentoProcessual` "RP", representante processual), which the research notes
    // name for a minor's parent or guardian, and a `pessoaRelacionada` of the person (`modalidadeRelacionamento`
    // "P" for a parent, "T" for a guardian). The first is written; which one a court reads, and whether it wants
    // the relationship said on the minor's part instead, is confirmed in its homologation. Their sex is not on
    // record: "D".
    ...(filingParty.representedBy
      ? [
          element("int:pessoaProcessualRelacionada", { relacionamentoProcessual: "RP" }, [
            person(
              { nome: filingParty.representedBy.name.trim(), sexo: "D", tipoPessoa: "fisica" },
              filingParty.representedBy.document,
              null,
            ),
          ]),
        ]
      : []),
  ]);
}

function filingDocument(document: FilingDocument): string {
  return element(
    "tip:documento",
    {
      idDocumento: document.id,
      tipoDocumento: document.typeCode,
      mimetype: "application/pdf",
      descricao: document.description.trim(),
      nivelSigilo: 0,
      // "Resumo matemático do documento enviado pelo algoritmo SHA-256": the schema does not say in which encoding.
      // Lowercase hexadecimal here; base64 is the other reading, confirmed in the homologation.
      hash: sha256Hex(document.pdf),
    },
    [
      element("int:conteudo", {}, base64(document.pdf)),
      // The schema calls `assinatura` "hash da assinatura, em base64" and puts the chain and the algorithm beside
      // it, which points to the RAW value of the signature; ONE has the CMS (the `.p7s`) and sends it whole. Whether
      // the court takes the CMS here, the RAW value, or a `conteudo` already signed is confirmed in its homologation.
      ...(document.signature
        ? [
            element("int:assinatura", {
              assinatura: base64(document.signature.cms),
              dataAssinatura: mniDateTime(document.signature.signedAt),
              cadeiaCertificado: document.signature.certificatePem,
              algoritmoHash: "SHA-256",
              codificacaoCertificado: "PEM",
            }),
          ]
        : []),
    ],
  );
}

/**
 * The SOAP 1.1 envelope of `entregarManifestacaoProcessual` for a new lawsuit, with nothing in it the filing does
 * not hold (and the credential, only when given). Throws `MniFilingInputError` for a filing the MNI cannot carry.
 */
export function mniFilingEnvelope(filing: LawsuitFiling, auth: MniAuth = {}): string {
  const problems = mniFilingProblems(filing);
  if (problems.length > 0) throw new MniFilingInputError(problems);
  const basics = element(
    "tip:dadosBasicos",
    {
      numero: "0".repeat(20),
      classeProcessual: filing.classCode,
      codigoLocalidade: filing.localityCode.trim(),
      nivelSigilo: 0,
      competencia: filing.competence,
    },
    [
      element("int:polo", { polo: "AT" }, filing.plaintiffs.map(party)),
      element("int:polo", { polo: "PA" }, filing.defendants.map(party)),
      ...filing.subjects.map((subject) =>
        element("int:assunto", subject.main ? { principal: "true" } : {}, [
          element("int:codigoNacional", {}, String(subject.code)),
        ]),
      ),
      // The priorities come before the value of the cause in the header (MNI 2.2.2, tipoCabecalhoProcesso).
      ...(filing.priorities ?? []).map((code) => element("int:prioridade", {}, code)),
      ...(filing.value === null ? [] : [element("int:valorCausa", {}, filing.value.toFixed(2))]),
      element("int:orgaoJulgador", {
        codigoOrgao: filing.judgingBody.code.trim(),
        nomeOrgao: filing.judgingBody.name.trim(),
        instancia: "ORIG",
        codigoMunicipioIBGE: filing.judgingBody.ibgeCity,
      }),
    ],
  );
  const operation = element("ser:entregarManifestacaoProcessual", {}, [
    ...(auth.idManifestante ? [element("tip:idManifestante", {}, auth.idManifestante)] : []),
    ...(auth.senhaManifestante ? [element("tip:senhaManifestante", {}, auth.senhaManifestante)] : []),
    basics,
    ...filing.documents.map(filingDocument),
    element("tip:dataEnvio", {}, mniDateTime(filing.sentAt)),
  ]);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}" xmlns:ser="${MNI_SERVICE_NS}"` +
    ` xmlns:tip="${MNI_SERVICE_TYPES_NS}" xmlns:int="${MNI_MODEL_NS}">` +
    `<soapenv:Body>${operation}</soapenv:Body></soapenv:Envelope>`
  );
}

/**
 * The SOAP 1.1 envelope of `entregarManifestacaoProcessual` for a petition into a lawsuit the court has: its number
 * (`numeroProcesso`, the schema's choice beside `dadosBasicos`) and the documents. Throws `MniFilingInputError` for a
 * petition the MNI cannot carry.
 */
export function mniPetitionEnvelope(filing: PetitionFiling, auth: MniAuth = {}): string {
  const problems = mniPetitionProblems(filing);
  if (problems.length > 0) throw new MniFilingInputError(problems);
  const operation = element("ser:entregarManifestacaoProcessual", {}, [
    ...(auth.idManifestante ? [element("tip:idManifestante", {}, auth.idManifestante)] : []),
    ...(auth.senhaManifestante ? [element("tip:senhaManifestante", {}, auth.senhaManifestante)] : []),
    element("tip:numeroProcesso", {}, filing.caseNumber),
    ...filing.documents.map(filingDocument),
    element("tip:dataEnvio", {}, mniDateTime(filing.sentAt)),
  ]);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}" xmlns:ser="${MNI_SERVICE_NS}"` +
    ` xmlns:tip="${MNI_SERVICE_TYPES_NS}" xmlns:int="${MNI_MODEL_NS}">` +
    `<soapenv:Body>${operation}</soapenv:Body></soapenv:Envelope>`
  );
}

// ---------- The answer ----------

/** An element's name without its prefix: the answer is read whatever prefixes the court gives its namespaces. */
const localName = (name: string): string => name.slice(name.indexOf(":") + 1);
const childByLocal = (parent: XmlElement | null, name: string): XmlElement | null =>
  parent?.children.find((child) => localName(child.name) === name) ?? null;
const childrenByLocal = (parent: XmlElement | null, name: string): XmlElement[] =>
  parent ? parent.children.filter((child) => localName(child.name) === name) : [];
const plain = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

function findByLocal(parent: XmlElement, name: string): XmlElement | null {
  for (const child of parent.children) {
    if (localName(child.name) === name) return child;
    const deeper = findByLocal(child, name);
    if (deeper) return deeper;
  }
  return null;
}

/** A CNJ number whose check digits hold (Resolução CNJ 65/2008, Annex VIII: the whole number modulo 97 is 1). */
const isCnj = (digits: string): boolean =>
  /^\d{20}$/.test(digits) && BigInt(`${digits.slice(0, 7)}${digits.slice(9, 20)}${digits.slice(7, 9)}`) % 97n === 1n;

/** The first CNJ number a text writes, masked (NNNNNNN-DD.AAAA.J.TR.OOOO) or as twenty digits, as its digits. */
function cnjIn(text: string): string | null {
  const found: { at: number; digits: string }[] = [];
  for (const match of text.matchAll(/(?<!\d)(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})(?!\d)/g)) {
    found.push({ at: match.index ?? 0, digits: match.slice(1).join("") });
  }
  for (const match of text.matchAll(/(?<!\d)\d{20}(?!\d)/g)) found.push({ at: match.index ?? 0, digits: match[0] });
  return found.sort((a, b) => a.at - b.at).find((candidate) => isCnj(candidate.digits))?.digits ?? null;
}

/** The receipt's bytes, from its base64; null when there is none or it is not base64. */
function receiptOf(text: string | undefined): Uint8Array | null {
  const clean = (text ?? "").replace(/\s+/g, "");
  if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  const bytes = Buffer.from(clean, "base64");
  return bytes.length > 0 ? new Uint8Array(bytes) : null;
}

const unknown = (reason: string): FilingOutcome => ({ kind: "unknown", reason });

/**
 * What the court answered to `entregarManifestacaoProcessual`, whatever prefixes it gives: `sucesso` true is a
 * lawsuit filed, with its protocol, its moment (`dataOperacao`, Brasília's time, or `now` when it is not one), its
 * receipt, its message and the lawsuit's number when the message or a `parametro` writes one; `sucesso` false is a
 * refusal with the court's words; a SOAP Fault is a refusal with its `faultstring`; anything else is `unknown`
 * (never a refusal, never a filing). A success with no protocol (the schema requires one) is `unknown` too.
 *
 * A Fault is taken as the court's refusal, as its schema has the operation answer one; that a court never files a
 * lawsuit and then answers a Fault (an error after its own commit) is confirmed in its homologation.
 */
export function readMniFilingAnswer(xml: string, now: Date = new Date()): FilingOutcome {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ""));
  } catch {
    return unknown("mni_answer_unreadable");
  }
  if (localName(root.name) !== "Envelope") return unknown("mni_answer_unreadable");
  const body = childByLocal(root, "Body");
  if (!body) return unknown("mni_answer_unreadable");

  const fault = childByLocal(body, "Fault");
  if (fault) {
    // SOAP 1.1 writes `faultstring`; SOAP 1.2, `Reason/Text`.
    const reason =
      plain(childByLocal(fault, "faultstring")?.text) ||
      plain(childByLocal(childByLocal(fault, "Reason"), "Text")?.text);
    return {
      kind: "refused",
      protocol: null,
      message: reason || "O tribunal respondeu com uma falha, sem dizer qual.",
    };
  }

  const answer = findByLocal(body, "entregarManifestacaoProcessualResposta");
  if (!answer) return unknown("mni_answer_unreadable");
  const success = plain(childByLocal(answer, "sucesso")?.text).toLowerCase();
  const message = plain(childByLocal(answer, "mensagem")?.text);
  const protocol = plain(childByLocal(answer, "protocoloRecebimento")?.text);
  const parameters = childrenByLocal(answer, "parametro").map((parameter) => ({
    name: plain(parameter.attributes.nome),
    value: plain(parameter.attributes.valor),
  }));

  if (success === "false" || success === "0") {
    // On a refusal, the `parametro`s are the competences the lawsuit could go to when the court could not
    // distribute it by itself: said, for whoever sends it again with one.
    const listed = parameters
      .filter((parameter) => parameter.name || parameter.value)
      .map((parameter) => [parameter.name, parameter.value].filter(Boolean).join(": "));
    const words = message || "O tribunal não recebeu a petição e não disse por quê.";
    return {
      kind: "refused",
      protocol: protocol || null,
      message: listed.length > 0 ? `${words} (${listed.join("; ")})` : words,
    };
  }
  if (success !== "true" && success !== "1") return unknown("mni_answer_unreadable");
  if (!protocol) return unknown("mni_filed_without_protocol");

  const caseNumber = [message, ...parameters.map((parameter) => parameter.value)].map(cnjIn).find(Boolean) ?? null;
  return {
    kind: "filed",
    protocol,
    caseNumber,
    receipt: receiptOf(childByLocal(answer, "recibo")?.text),
    at: mniInstant(plain(childByLocal(answer, "dataOperacao")?.text)) ?? now,
    message: message || null,
  };
}

// ---------- The channel ----------

/**
 * The codes of a failure that happened before any byte of the request could reach the court: the name did not
 * resolve, the connection was refused or never made, or the court's own certificate failed its check in the TLS
 * handshake. Anything else (a reset, a socket closed, a timeout, an abort) may have come after the court read the
 * request, so it is never taken as "not sent".
 */
const NEVER_SENT = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_INVALID_URL",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** The codes and names along an error's causes (and an AggregateError's errors, as a connection to several addresses fails). */
function failureOf(error: unknown): { codes: string[]; aborted: string | null } {
  const codes: string[] = [];
  let aborted: string | null = null;
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 8) return;
    seen.add(value);
    const { name, code, cause, errors } = value as {
      name?: unknown;
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (name === "AbortError" || name === "TimeoutError") aborted ??= name;
    if (typeof code === "string" && code) codes.push(code);
    visit(cause, depth + 1);
    if (Array.isArray(errors)) for (const each of errors) visit(each, depth + 1);
  };
  visit(error, 0);
  return { codes, aborted };
}

function failedToSend(error: unknown): FilingOutcome {
  const { codes, aborted } = failureOf(error);
  if (aborted) return unknown(aborted === "TimeoutError" ? "mni_timeout" : "mni_aborted");
  if (codes.length > 0 && codes.every((code) => NEVER_SENT.has(code))) {
    return { kind: "unavailable", reason: `mni_unreachable: ${codes[0]}` };
  }
  return unknown(codes.length > 0 ? `mni_no_answer: ${codes[0]}` : "mni_no_answer");
}

const LATIN1 = new Set(["iso-8859-1", "iso8859-1", "iso_8859-1", "latin1", "l1", "windows-1252", "cp1252"]);

/** The answer's text: Latin-1 when the header (or, saying nothing, the XML declaration) says so, else UTF-8. */
function decodeAnswer(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  const charset = fromHeader ?? declared ?? "utf-8";
  return new TextDecoder(LATIN1.has(charset) ? "latin1" : "utf-8").decode(bytes);
}

/**
 * A court's MNI as a `FilingChannel`. What it answers decides whether a lawsuit may be sent again, so it is strict:
 * `unavailable` only when nothing could have reached the court (a name that does not resolve, a connection refused
 * or never made, an address that is no address, a 503 or a 429); `unknown` for anything that may have reached it
 * with no answer to read (a timeout, an abort, a connection reset, a 502 or a 504, a redirect, any other status
 * with no SOAP answer in it, a body that cannot be read or decoded); the court's own answer read otherwise, from a
 * 2xx, a 500 or any other status that carries one. A filing the MNI cannot carry is refused before anything is
 * sent, saying what keeps it.
 */
export class MniFilingChannel implements FilingChannel {
  readonly name = "mni";
  private readonly config: MniConfig;

  constructor(config: MniConfig) {
    this.config = config;
  }

  async fileLawsuit(filing: LawsuitFiling): Promise<FilingOutcome> {
    const problems = mniFilingProblems(filing);
    if (problems.length > 0) {
      return { kind: "refused", protocol: null, message: `Não enviado ao tribunal: ${problems.join("; ")}.` };
    }
    return this.send(
      mniFilingEnvelope(filing, {
        idManifestante: this.config.idManifestante,
        senhaManifestante: this.config.senhaManifestante,
      }),
    );
  }

  async filePetition(filing: PetitionFiling): Promise<FilingOutcome> {
    const problems = mniPetitionProblems(filing);
    if (problems.length > 0) {
      return { kind: "refused", protocol: null, message: `Não enviado ao tribunal: ${problems.join("; ")}.` };
    }
    return this.send(
      mniPetitionEnvelope(filing, {
        idManifestante: this.config.idManifestante,
        senhaManifestante: this.config.senhaManifestante,
      }),
    );
  }

  /** Posts an envelope and reads what it came to, as the class says. */
  private async send(body: string): Promise<FilingOutcome> {
    let url: URL;
    try {
      url = new URL(this.config.endpoint);
    } catch {
      return { kind: "unavailable", reason: "mni_endpoint_invalid" };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return { kind: "unavailable", reason: "mni_endpoint_invalid" };

    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        soapaction: `"${MNI_FILING_SOAP_ACTION}"`,
        accept: "text/xml, application/soap+xml",
      },
      body,
      // A redirect is never followed: a POST sent again elsewhere, or turned into a GET, is not this filing.
      redirect: "manual",
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
    };
    if (this.config.dispatcher !== undefined) (init as { dispatcher?: unknown }).dispatcher = this.config.dispatcher;

    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(url, init);
    } catch (error) {
      return failedToSend(error);
    }
    const status = response.status;
    if (status === 503 || status === 429) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "unavailable", reason: `mni_http_${status}` };
    }
    if (status === 502 || status === 504) {
      await response.body?.cancel().catch(() => undefined);
      return unknown(`mni_http_${status}`);
    }
    let text: string;
    try {
      text = decodeAnswer(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type"));
    } catch (error) {
      const { aborted } = failureOf(error);
      return unknown(aborted === "TimeoutError" ? "mni_timeout" : "mni_answer_cut");
    }
    // An answer in MTOM (the receipt as an attachment) is not read here: what it said is for a person to see.
    if (/^\s*multipart\//i.test(response.headers.get("content-type") ?? "")) return unknown("mni_answer_multipart");
    const outcome = readMniFilingAnswer(text);
    if (outcome.kind === "unknown" && (status < 200 || status > 299)) return unknown(`mni_http_${status}`);
    return outcome;
  }
}
