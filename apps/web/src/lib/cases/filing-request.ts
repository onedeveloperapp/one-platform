import type { FilingDocument, FilingParty, LawsuitFiling } from "@flyee/courts/types";

/**
 * What ONE sends a court to file a lawsuit (migration 0101): the lawsuit as
 * the database hands it to the worker that holds its submission
 * (`filing_submission_to_send`), read and turned into the court's filing
 * (`LawsuitFiling` of `@flyee/courts`). Pure: no I/O. What is not on record
 * goes as such (no sex, no address), never invented; a code the court's
 * channel needs and its table lacks keeps the filing from going, except in
 * the test court, which takes the placeholders it shows.
 */

export type SubmissionChannel = "mni" | "test_court";

type Person = {
  name: string;
  cpf: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  guardian: { name: string; cpf: string | null } | null;
};

export type SubmissionItem = {
  position: number;
  name: string;
  part: number;
  parts: number;
  documentKind: string;
  storagePath: string;
  signedStoragePath: string | null;
};

/** What the worker holding a submission reads of it (`filing_submission_to_send`). */
export type SubmissionToSend = {
  submissionId: string;
  claim: number;
  channel: SubmissionChannel;
  orgId: string;
  /** The firm's name, as the test court's receipt says it. */
  firm: string;
  caseId: string;
  caseSeq: number | null;
  incident: string;
  packageId: string;
  proceedingId: string;
  kind: "juizado" | "comum";
  court: string;
  courtState: string | null;
  comarca: string | null;
  testNumber: string | null;
  endpoint: string | null;
  codes: Record<string, unknown>;
  valueCents: number | null;
  claimants: Person[];
  defendant: { name: string; cnpj: string | null } | null;
  lawyers: { name: string; cpf: string | null; oab: { uf: string; number: string } | null }[];
  items: SubmissionItem[];
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const digits = (value: unknown): string | null => {
  const only = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return only === "" ? null : only;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map(record) : [];

/** The database's answer, read; null when it is not one (a claim no longer held). */
export function submissionOf(value: unknown): SubmissionToSend | null {
  const row = record(value);
  const submissionId = text(row.submission_id);
  const channel = row.channel === "mni" || row.channel === "test_court" ? row.channel : null;
  const kind = row.kind === "juizado" || row.kind === "comum" ? row.kind : null;
  if (!submissionId || !channel || !kind || typeof row.claim !== "number") return null;
  const defendant = record(row.defendant);
  return {
    submissionId,
    claim: row.claim,
    channel,
    orgId: text(row.org_id) ?? "",
    firm: text(row.firm) ?? "",
    caseId: text(row.case_id) ?? "",
    caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
    incident: text(row.incident) ?? "other",
    packageId: text(row.package_id) ?? "",
    proceedingId: text(row.proceeding_id) ?? "",
    kind,
    court: text(row.court) ?? "",
    courtState: text(row.court_state),
    comarca: text(row.comarca),
    testNumber: digits(row.test_number),
    endpoint: text(row.endpoint),
    codes: record(row.codes),
    valueCents: typeof row.value_cents === "number" && row.value_cents > 0 ? row.value_cents : null,
    claimants: list(row.claimants).map((person) => {
      const guardian = record(person.guardian);
      return {
        name: text(person.name) ?? "",
        cpf: digits(person.cpf),
        street: text(person.street),
        number: text(person.number),
        complement: text(person.complement),
        district: text(person.district),
        city: text(person.city),
        state: text(person.state),
        zip: digits(person.zip),
        guardian: text(guardian.name) ? { name: text(guardian.name) ?? "", cpf: digits(guardian.cpf) } : null,
      };
    }),
    defendant: text(defendant.name) ? { name: text(defendant.name) ?? "", cnpj: digits(defendant.cnpj) } : null,
    lawyers: list(row.lawyers).map((lawyer) => {
      const oab = record(lawyer.oab);
      return {
        name: text(lawyer.name) ?? "",
        cpf: digits(lawyer.cpf),
        oab: text(oab.uf) && text(oab.number) ? { uf: text(oab.uf) ?? "", number: text(oab.number) ?? "" } : null,
      };
    }),
    items: list(row.items)
      .map((item) => ({
        position: typeof item.position === "number" ? item.position : 0,
        name: text(item.name) ?? "",
        part: typeof item.part === "number" ? item.part : 1,
        parts: typeof item.parts === "number" ? item.parts : 1,
        documentKind: text(item.document_kind) ?? "other",
        storagePath: text(item.storage_path) ?? "",
        signedStoragePath: text(item.signed_storage_path),
      }))
      .filter((item) => item.position > 0 && item.storagePath !== "")
      .sort((a, b) => a.position - b.position),
  };
}

/**
 * A registration at the bar as the MNI writes it: the state, seven digits and a letter. The letter the bar's
 * number carries, or "A" when it carries none (the letter Projudi writes after a principal registration; to
 * confirm in the court's homologation).
 */
export function mniOab(uf: string, number: string): string | null {
  const state = uf.trim().toUpperCase();
  const numeral = number.replace(/\D/g, "");
  if (!/^[A-Z]{2}$/.test(state) || numeral === "" || numeral.length > 7) return null;
  const letter = /([A-Za-z])\s*$/.exec(number.trim())?.[1]?.toUpperCase() ?? "A";
  return `${state}${numeral.padStart(7, "0")}${letter}`;
}

/** What a document is called in the filing, by its kind (data the court reads, never the firm's screen). */
const DESCRIPTION: Record<string, string> = {
  petition: "Petição inicial",
  power_of_attorney: "Procuração",
  identity: "Documento de identidade",
  address_proof: "Comprovante de endereço",
  residence_declaration: "Declaração de residência",
  ticket: "Bilhete da passagem",
  boarding_pass: "Cartão de embarque",
  receipt: "Comprovante de gasto",
  evidence: "Prova",
  contract: "Contrato",
  other: "Outro documento",
};

export type FileOf = (item: SubmissionItem) => {
  pdf: Uint8Array;
  signature: { cms: Uint8Array; certificatePem: string; signedAt: Date } | null;
};

type FilingAnswer = { ok: true; filing: LawsuitFiling } | { ok: false; code: string; missing?: string[] };

/** The court's code of something, by its key in the channel's table (a number, or text). */
const codeOf = (table: unknown, key: string): string | null => {
  const value = record(table)[key];
  return typeof value === "number" ? String(value) : text(value);
};

/** The lawsuit as the court's channel takes it, or why it cannot go. */
export function lawsuitFilingOf(sub: SubmissionToSend, fileOf: FileOf, now: Date): FilingAnswer {
  const test = sub.channel === "test_court";
  const missing: string[] = [];
  const comarca = sub.comarca ?? "";
  const unitKey = `${comarca}|${sub.kind}`;

  const classCode = Number(codeOf(sub.codes.classes, sub.kind) ?? (test ? (sub.kind === "juizado" ? 436 : 7) : NaN));
  if (!Number.isFinite(classCode)) missing.push("class");
  const localityCode = codeOf(sub.codes.localities, comarca) ?? (test ? "teste" : null);
  if (!localityCode) missing.push("locality");
  const body = record(record(sub.codes.judging_bodies)[unitKey]);
  const judgingBody =
    text(body.code) && text(body.name)
      ? { code: text(body.code) ?? "", name: text(body.name) ?? "", ibgeCity: text(body.ibge) ?? "" }
      : test
        ? { code: "teste", name: "Tribunal de teste do ONE", ibgeCity: "" }
        : null;
  if (!judgingBody) missing.push("judging_body");
  const competenceCode = codeOf(sub.codes.competences, unitKey);
  const competence = competenceCode !== null && Number.isFinite(Number(competenceCode)) ? Number(competenceCode) : null;

  const subjectsTable = record(sub.codes.subjects);
  const codesIn = (value: unknown): number[] =>
    (Array.isArray(value) ? value : [value])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
  const main = codesIn(subjectsTable[sub.incident]);
  const moral = codesIn(subjectsTable.moral);
  const subjects = [...main, ...moral.filter((code) => !main.includes(code))].map((code, index) => ({
    code,
    main: index === 0,
  }));
  if (subjects.length === 0 && !test) missing.push("subject");

  const documents: FilingDocument[] = [];
  for (const item of sub.items) {
    const typeCode =
      codeOf(sub.codes.document_types, item.documentKind) ??
      (test ? (item.documentKind === "petition" ? "202" : "0") : null);
    if (!typeCode) {
      missing.push(`document:${item.documentKind}`);
      continue;
    }
    const file = fileOf(item);
    const description = DESCRIPTION[item.documentKind] ?? DESCRIPTION.other;
    documents.push({
      id: String(item.position),
      typeCode,
      description: item.parts > 1 ? `${description} (parte ${item.part} de ${item.parts})` : description,
      pdf: file.pdf,
      signature: file.signature,
    });
  }
  if (missing.length > 0) return { ok: false, code: "court_codes_missing", missing };
  if (documents.length === 0 || sub.items[0]?.documentKind !== "petition") return { ok: false, code: "no_petition" };
  if (sub.claimants.length === 0) return { ok: false, code: "no_claimant" };
  if (!sub.defendant) return { ok: false, code: "no_defendant" };

  const lawyers = sub.lawyers.flatMap((lawyer) => {
    const oab = lawyer.oab ? mniOab(lawyer.oab.uf, lawyer.oab.number) : null;
    return oab && lawyer.name ? [{ name: lawyer.name, oab, cpf: lawyer.cpf }] : [];
  });
  if (lawyers.length === 0) return { ok: false, code: "no_lawyer" };

  const plaintiffs: FilingParty[] = sub.claimants.map((person) => ({
    name: person.name,
    sex: "D",
    kind: "fisica",
    document: person.cpf && person.cpf.length === 11 ? person.cpf : null,
    address:
      person.street && person.city && person.state
        ? {
            street: person.street,
            number: person.number,
            complement: person.complement,
            district: person.district,
            city: person.city,
            state: person.state,
            zip: person.zip,
          }
        : null,
    lawyers,
    representedBy: person.guardian
      ? {
          name: person.guardian.name,
          document: person.guardian.cpf && person.guardian.cpf.length === 11 ? person.guardian.cpf : null,
        }
      : null,
  }));
  const defendants: FilingParty[] = [
    {
      name: sub.defendant.name,
      sex: "D",
      kind: "juridica",
      document: sub.defendant.cnpj && sub.defendant.cnpj.length === 14 ? sub.defendant.cnpj : null,
      address: null,
      lawyers: [],
      representedBy: null,
    },
  ];

  return {
    ok: true,
    filing: {
      localityCode: localityCode ?? "",
      competence,
      judgingBody: judgingBody ?? { code: "", name: "", ibgeCity: "" },
      classCode,
      subjects,
      value: sub.valueCents === null ? null : Math.round(sub.valueCents) / 100,
      plaintiffs,
      defendants,
      documents,
      sentAt: now,
    },
  };
}
