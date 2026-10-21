import type { TextBlock } from "@flyee/documents/text-pdf";

/**
 * The dossier of a case: what the firm has on record that shows the case is
 * of a real person who knows of it. Who each person is and how that was
 * checked, what they did themselves on the firm's link, what they accepted
 * and signed, what they told and confirmed, what was tried before suing, and
 * the documents the firm accepted, each with the day it was recorded.
 *
 * Pure: the facts come in already read and already in words (a day as
 * people write it, a kind by its name); this file only decides what the
 * document says and in which order, and says plainly what is NOT on record
 * instead of leaving it out. A dossier that hid a gap would be worth less
 * than none. It also says who answers for each thing it tells: a signature
 * the provider reported is one thing, one the firm confirmed from a file is
 * another, and the document never writes the second as the first.
 */

/** What the federal registry answered for a CPF asked with its birth date. */
export type RegistryResult = "found" | "not_found" | "birth_date_mismatch" | "minor";

export type DossierPerson = {
  name: string;
  /** The CPF with its middle shown and the rest hidden: a dossier travels. */
  cpfMasked: string | null;
  role: "claimant" | "guardian";
  /** For a claimant who is a minor: who answers for them. */
  guardianName: string | null;
  /** What the federal registry answered for the CPF, when somebody asked. */
  registry: {
    result: RegistryResult;
    nameMatches: boolean | null;
    /** Whether the registry gave the CPF as regular. Null when it did not say. */
    regular: boolean | null;
    checkedOn: string;
  } | null;
  /** Who wrote the person's data last: the person, on the firm's link, or the firm. */
  lastChangeByClient: boolean;
};

/**
 * Where a signature stands. `signed` is known in one of two ways, and the
 * document says which: the provider reported each signature (`provider`),
 * or a person of the firm checked a signed file and recorded it (`firm`).
 */
export type DossierSignature = {
  document: string;
  method: string;
  state: "signed" | "pending" | "received" | "refused" | "expired";
  by: "provider" | "firm" | null;
  /** When it was recorded as signed. */
  signedOn: string | null;
  /** Who was asked to sign, with when each one signed as far as the provider said. */
  signers: { name: string; signedOn: string | null }[];
  /** The start of the signed file's hash. */
  fingerprint: string | null;
};

/** A leg of the same flight no schedule foresaw, as the record writes it: its kind, airports and real times. */
export type DossierUnscheduledLeg = {
  kind: "extra" | "return" | "included" | "duplicated" | "other";
  origin: string;
  destination: string;
  departure: string | null;
  arrival: string | null;
};

/**
 * What ANAC's official record of the flights (VRA) says of a leg: its arrival, scheduled and real, with
 * the delay the record gives, or that it was recorded as cancelled; the legs of the same flight no schedule
 * foresaw, and when they took the aircraft to the destination of a cancelled flight; or that the record has
 * no such flight, or is not out yet. Times come already in words, each with its zone when it is not the
 * airport's.
 */
export type DossierRecord =
  | {
      status: "found";
      month: string;
      cancelled: boolean;
      scheduledArrival: string | null;
      actualArrival: string | null;
      delayMinutes: number | null;
      unscheduled?: DossierUnscheduledLeg[];
      reachedDestination?: string | null;
      reachedDelayMinutes?: number | null;
      /** The airports the flight stopped at under the same number, and its legs given as cancelled ("BEL para MCP"). */
      stops?: string[];
      cancelledLegs?: string[];
      /** Where the record's flight ends when it never reaches the leg's destination. */
      endsAt?: string | null;
      /** The reason the airline gave in the record, when it gave one. */
      justification?: string | null;
    }
  | { status: "not_found" | "not_published"; month: string | null };

const UNSCHEDULED_WORDS: Record<DossierUnscheduledLeg["kind"], string> = {
  extra: "etapa extra",
  return: "retorno ao aeroporto de origem",
  included: "etapa incluída no voo",
  duplicated: "etapa levada por outro voo da companhia",
  other: "etapa não prevista",
};

/** What the record says of a leg, in the words of the dossier. Null when nothing was checked. */
export function officialWords(record: DossierRecord | null | undefined): string | null {
  if (!record) return null;
  if (record.status !== "found") {
    return record.status === "not_published"
      ? "o registro oficial da ANAC deste mês ainda não tinha sido publicado"
      : "sem registro deste voo nesta data no registro oficial da ANAC";
  }
  const source = `no registro oficial da ANAC (VRA, ${record.month.slice(5, 7)}/${record.month.slice(0, 4)})`;
  const cancelledLegs = record.cancelledLegs ?? [];
  const flight = [
    source,
    record.stops && record.stops.length > 0 ? `com escala em ${record.stops.join(", ")} sob o mesmo número` : null,
    record.endsAt ? `o voo termina em ${record.endsAt}, não no destino deste trecho` : null,
    record.cancelled
      ? `voo registrado como cancelado${cancelledLegs.length > 0 ? ` (a etapa de ${cancelledLegs.join(" e a de ")})` : ""}`
      : null,
    !record.cancelled && record.scheduledArrival ? `chegada prevista para ${record.scheduledArrival}` : null,
    !record.cancelled && record.actualArrival ? `chegada real em ${record.actualArrival}` : null,
    !record.cancelled && record.delayMinutes !== null && record.delayMinutes > 0
      ? `${record.delayMinutes} minutos de atraso na chegada`
      : null,
    record.justification ? `justificativa da companhia no registro: ${record.justification}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const legs = (record.unscheduled ?? []).map((leg) =>
    [
      `${UNSCHEDULED_WORDS[leg.kind] ?? UNSCHEDULED_WORDS.other} de ${leg.origin} para ${leg.destination}`,
      leg.departure ? `partida real em ${leg.departure}` : null,
      leg.arrival ? `chegada real em ${leg.arrival}` : null,
    ]
      .filter(Boolean)
      .join(", "),
  );
  if (legs.length === 0) return flight;
  const reached =
    record.cancelled && record.reachedDestination && record.reachedDelayMinutes != null
      ? `; por essas etapas, a aeronave chegou ao destino do voo em ${record.reachedDestination}, ${Math.max(record.reachedDelayMinutes, 0)} minutos depois da chegada prevista (o registro não diz quem estava a bordo)`
      : "";
  return `${flight}; o registro traz etapas do mesmo voo que nenhum horário previa: ${legs.join("; ")}${reached}`;
}

export type DossierFacts = {
  firm: string;
  caseLabel: string;
  issuedOn: string;
  /** The zone every hour of the document is written in, by its name for people. */
  zone: string;
  incident: string;
  airline: string | null;
  flightDate: string | null;
  segments: {
    flight: string | null;
    route: string;
    scheduled: string | null;
    actual: string | null;
    affected: boolean;
    /** What ANAC's official record says of the leg's flight, when it was checked. */
    official?: DossierRecord | null;
  }[];
  people: DossierPerson[];
  links: { person: string; createdOn: string; opened: number; finishedOn: string | null }[];
  consents: { person: string; title: string; version: number; acceptedOn: string }[];
  signatures: DossierSignature[];
  statements: { person: string | null; source: string; confirmedOn: string | null; status: string }[];
  complaints: { channel: string; protocol: string | null; filedOn: string | null; outcome: string }[];
  documents: { kind: string; person: string | null; acceptedOn: string | null; fingerprint: string | null }[];
  proceedings: { kind: string; forum: string | null; number: string | null; filedOn: string | null }[];
};

/** The zone a dossier is written in, and its name for people. A dossier travels: its hours are not its reader's. */
export const DOSSIER_ZONE = "America/Sao_Paulo";
export const DOSSIER_ZONE_NAME = "horário de Brasília";

const instant = (value: string | null | undefined): Date | null => {
  const at = value ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
};

/** A moment as the dossier writes it: the day and the hour, in the dossier's zone. */
export function dossierMoment(value: string | null | undefined): string | null {
  const at = instant(value);
  return at
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: DOSSIER_ZONE }).format(at)
    : null;
}

/** The day of a moment in the dossier's zone: what happened at 22:30 of Brasília is of that day, not of the next. */
export function dossierDay(value: string | null | undefined): string | null {
  const at = instant(value);
  return at ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: DOSSIER_ZONE }).format(at) : null;
}

/** What the database records of an envelope of signatures (migration 0023), as the dossier reads it. */
export type EnvelopeFacts = {
  document_id: string;
  method: string;
  status: string;
  signers: unknown;
  evidence: unknown;
  signed_sha256: string | null;
  updated_at: string | null;
};

const SIGNATURE_STATES: readonly DossierSignature["state"][] = ["signed", "pending", "received", "refused", "expired"];

/**
 * A signature as the dossier tells it, from what the database records of its envelope. When each person
 * signed is the provider's word: while the envelope waits it is on each signer (`signers[].signed_at`), and
 * once it is signed it is the evidence the provider gave (`evidence[]`, by the signer's name). An envelope
 * a person of the firm confirmed (gov.br, e-Notariado) has no such word, and the dossier says who
 * confirmed it instead of a day nobody reported. Null for what nobody could sign (cancelled, never opened).
 */
export function dossierSignature(
  envelope: EnvelopeFacts,
  words: { document: string; method: string },
): DossierSignature | null {
  const state = SIGNATURE_STATES.find((known) => known === envelope.status);
  if (!state) return null;
  const evidence = new Map<string, string>();
  for (const entry of Array.isArray(envelope.evidence) ? envelope.evidence : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { signer, signed_at: signedAt } = entry as Record<string, unknown>;
    if (typeof signer === "string" && typeof signedAt === "string") evidence.set(signer.trim().toLowerCase(), signedAt);
  }
  const signers = (Array.isArray(envelope.signers) ? envelope.signers : []).flatMap((signer) => {
    if (typeof signer !== "object" || signer === null) return [];
    const { name, signed_at: signedAt } = signer as Record<string, unknown>;
    if (typeof name !== "string") return [];
    const told = evidence.get(name.trim().toLowerCase()) ?? (typeof signedAt === "string" ? signedAt : null);
    return [{ name, signedOn: dossierMoment(told) }];
  });
  return {
    document: words.document,
    method: words.method,
    state,
    by: state !== "signed" ? null : envelope.method === "zapsign" ? "provider" : "firm",
    signedOn: state === "signed" ? dossierMoment(envelope.updated_at) : null,
    signers,
    fingerprint: state === "signed" ? (envelope.signed_sha256?.slice(0, 16) ?? null) : null,
  };
}

const NOTHING = "Nada registrado.";

const list = (items: string[]): TextBlock =>
  items.length > 0 ? { kind: "list", items } : { kind: "paragraph", text: NOTHING };

/** What the registry said of a CPF, in words: each answer by its own name, never a "not found" for all of them. */
export function registryWords(registry: DossierPerson["registry"]): string {
  if (!registry) return "não consultado";
  const asked = `consultado em ${registry.checkedOn}`;
  if (registry.result === "not_found") return `${asked}: o cadastro não encontrou este CPF`;
  if (registry.result === "birth_date_mismatch")
    return `${asked}: a data de nascimento registrada no caso não é a do cadastro`;
  if (registry.result === "minor") return `${asked}: o cadastro não responde por CPF de pessoa menor de idade`;
  const name =
    registry.nameMatches === true
      ? "o nome confere"
      : registry.nameMatches === false
        ? "o nome não confere"
        : "o nome não foi comparado";
  const situation =
    registry.regular === true ? ", situação regular" : registry.regular === false ? ", situação que não é regular" : "";
  return `${asked}: CPF encontrado, ${name}${situation}`;
}

/** Where a signature stands, in words, with who answers for it. */
export function signatureWords(signature: DossierSignature): string {
  const head = `${signature.document}, por ${signature.method}`;
  const names = signature.signers.map((signer) => signer.name).join("; ") || "sem signatários registrados";
  const each = signature.signers
    .map((signer) => (signer.signedOn ? `${signer.name} em ${signer.signedOn}` : `${signer.name}, ainda sem assinar`))
    .join("; ");
  const file = signature.fingerprint ? `, impressão digital do arquivo assinado ${signature.fingerprint}` : "";
  if (signature.state === "signed") {
    const when = signature.signedOn ? ` em ${signature.signedOn}` : "";
    if (signature.by === "firm")
      return `${head}: o escritório conferiu o arquivo assinado e registrou a assinatura${when}. Quem assina: ${names}${file}`;
    const told = signature.signers.some((signer) => signer.signedOn)
      ? signature.signers
          .map((signer) => (signer.signedOn ? `${signer.name} em ${signer.signedOn}` : signer.name))
          .join("; ")
      : names;
    return `${head}: assinado, conforme informado pelo serviço de assinatura${when}. Quem assinou: ${told}${file}`;
  }
  if (signature.state === "received")
    return `${head}: a pessoa devolveu um arquivo, que o escritório ainda não conferiu. Quem assina: ${names}`;
  if (signature.state === "refused") return `${head}: houve recusa de assinatura. Quem assinaria: ${names}`;
  if (signature.state === "expired")
    return `${head}: o prazo passou sem todas as assinaturas. ${each || "Sem signatários registrados"}`;
  return `${head}: aguardando assinatura. ${each || "Sem signatários registrados"}`;
}

export function buildDossier(facts: DossierFacts): {
  title: string;
  blocks: TextBlock[];
  /** What it holds, by counts: kept beside the dossier, never the values. */
  summary: Record<string, number>;
} {
  const title = `Dossiê do caso ${facts.caseLabel}`;
  const blocks: TextBlock[] = [
    { kind: "title", text: title },
    {
      kind: "paragraph",
      text: `Emitido por ${facts.firm} em ${facts.issuedOn} (${facts.zone}). Este documento reúne o que o escritório tem registrado sobre quem são as pessoas deste caso, o que elas mesmas fizeram, aceitaram e assinaram, o que contaram e o que foi tentado antes da ação. Cada item traz o dia em que foi registrado, e os horários estão no ${facts.zone}. O que não está registrado aparece dito como tal.`,
    },

    { kind: "heading", text: "O caso" },
    {
      kind: "fields",
      rows: [
        { label: "Ocorrência", value: facts.incident },
        { label: "Companhia", value: facts.airline ?? "não registrada" },
        { label: "Dia do voo", value: facts.flightDate ?? "não registrado" },
      ],
    },
    list(
      facts.segments.map(
        (segment) =>
          [
            segment.flight ? `Voo ${segment.flight}` : "Voo sem número registrado",
            segment.route,
            segment.scheduled ? `chegada prevista para ${segment.scheduled}, hora local do aeroporto` : null,
            segment.actual ? `chegada real em ${segment.actual}, hora local do aeroporto` : null,
            segment.affected ? "trecho em que o problema aconteceu" : null,
          ]
            .filter(Boolean)
            .join(", ") + (officialWords(segment.official) ? `; ${officialWords(segment.official)}` : ""),
      ),
    ),

    { kind: "heading", text: "Quem são as pessoas" },
  ];

  if (facts.people.length === 0) blocks.push({ kind: "paragraph", text: NOTHING });
  for (const person of facts.people) {
    blocks.push({
      kind: "fields",
      rows: [
        { label: "Nome", value: person.name },
        { label: "CPF", value: person.cpfMasked ?? "não registrado" },
        {
          label: "No caso",
          value:
            person.role === "guardian"
              ? "responde por quem é menor"
              : person.guardianName
                ? `pede em nome próprio, é menor e tem ${person.guardianName} como responsável`
                : "pede em nome próprio",
        },
        { label: "CPF no cadastro da Receita", value: registryWords(person.registry) },
        {
          label: "Última alteração dos dados",
          value: person.lastChangeByClient
            ? "feita pela própria pessoa, pelo link do escritório"
            : "feita pelo escritório",
        },
      ],
    });
    blocks.push({ kind: "space", points: 4 });
  }

  blocks.push(
    { kind: "heading", text: "O que as pessoas fizeram pelo link do escritório" },
    list(
      facts.links.map((link) =>
        [
          `${link.person}: link criado em ${link.createdOn}`,
          link.opened > 0 ? `aberto ${link.opened} ${link.opened === 1 ? "vez" : "vezes"}` : "nunca aberto",
          link.finishedOn
            ? `a pessoa disse que terminou em ${link.finishedOn}`
            : "a pessoa ainda não disse que terminou",
        ].join(", "),
      ),
    ),

    { kind: "heading", text: "O que foi aceito" },
    list(
      facts.consents.map(
        (consent) =>
          `${consent.person} aceitou "${consent.title}", versão ${consent.version}, em ${consent.acceptedOn}`,
      ),
    ),

    { kind: "heading", text: "O que foi assinado" },
    list(facts.signatures.map(signatureWords)),

    { kind: "heading", text: "O que a pessoa contou" },
    list(
      facts.statements.map((statement) =>
        [
          statement.person ? `Relato de ${statement.person}` : "Relato",
          statement.source,
          statement.confirmedOn ? `cronologia confirmada pela pessoa em ${statement.confirmedOn}` : statement.status,
        ].join(", "),
      ),
    ),

    { kind: "heading", text: "O que foi tentado antes da ação" },
    list(
      facts.complaints.map((complaint) =>
        [
          complaint.channel,
          complaint.protocol ? `protocolo ${complaint.protocol}` : "sem protocolo registrado",
          complaint.filedOn ? `feita em ${complaint.filedOn}` : null,
          complaint.outcome,
        ]
          .filter(Boolean)
          .join(", "),
      ),
    ),

    { kind: "heading", text: "Documentos aceitos pelo escritório" },
    list(
      facts.documents.map((document) =>
        [
          document.kind,
          document.person ? `de ${document.person}` : null,
          document.acceptedOn ? `aceito em ${document.acceptedOn}` : null,
          document.fingerprint ? `impressão digital do arquivo ${document.fingerprint}` : null,
        ]
          .filter(Boolean)
          .join(", "),
      ),
    ),

    { kind: "heading", text: "Processos" },
    list(
      facts.proceedings.map((proceeding) =>
        [
          proceeding.kind,
          proceeding.forum,
          proceeding.number ? `número ${proceeding.number}` : "ainda sem número",
          proceeding.filedOn ? `protocolado em ${proceeding.filedOn}` : null,
        ]
          .filter(Boolean)
          .join(", "),
      ),
    ),

    { kind: "space", points: 8 },
    {
      kind: "paragraph",
      text: "Este documento foi gerado a partir dos registros do escritório. O código ao pé de cada página permite a qualquer pessoa conferir que ele foi emitido pelo escritório, sem ver o conteúdo.",
    },
  );

  return {
    title,
    blocks,
    summary: {
      people: facts.people.length,
      registry_checks: facts.people.filter((person) => person.registry?.result === "found").length,
      links_finished: facts.links.filter((link) => link.finishedOn).length,
      consents: facts.consents.length,
      signatures: facts.signatures.filter((signature) => signature.state === "signed").length,
      statements_confirmed: facts.statements.filter((statement) => statement.confirmedOn).length,
      complaints: facts.complaints.length,
      documents: facts.documents.length,
    },
  };
}

/** A CPF with its middle shown and the rest hidden: "***.456.789-**". Null when it is not one. */
export function maskCpf(cpf: string | null | undefined): string | null {
  const digits = String(cpf ?? "").replace(/\D/g, "");
  return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : null;
}
