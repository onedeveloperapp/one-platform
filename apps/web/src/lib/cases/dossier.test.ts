// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildDossier,
  DOSSIER_ZONE_NAME,
  dossierDay,
  type DossierFacts,
  dossierMoment,
  type DossierSignature,
  dossierSignature,
  type EnvelopeFacts,
  maskCpf,
  officialWords,
  registryWords,
  signatureWords,
} from "@/lib/cases/dossier";
import type { TextBlock } from "@flyee/documents/text-pdf";

const signature = (changes: Partial<DossierSignature> = {}): DossierSignature => ({
  document: "Procuração",
  method: "ZapSign",
  state: "pending",
  by: null,
  signedOn: null,
  signers: [
    { name: "Maria Teste", signedOn: "01/10/2026, 14:02" },
    { name: "José Teste", signedOn: null },
  ],
  fingerprint: null,
  ...changes,
});

/** Every person, firm and number here is invented. */
const facts = (changes: Partial<DossierFacts> = {}): DossierFacts => ({
  firm: "Souza Advogados",
  caseLabel: "#12",
  issuedOn: "09/10/2026, 10:30",
  zone: DOSSIER_ZONE_NAME,
  incident: "Atraso de voo",
  airline: "Companhia Exemplo",
  flightDate: "20/09/2026",
  segments: [
    {
      flight: "G3 1234",
      route: "GYN para CGH",
      scheduled: "20/09/2026 às 08:00",
      actual: "20/09/2026 às 14:10",
      affected: true,
    },
    { flight: null, route: "CGH para SDU", scheduled: null, actual: null, affected: false },
  ],
  people: [
    {
      name: "Maria Teste",
      cpfMasked: "***.456.789-**",
      role: "claimant",
      guardianName: null,
      registry: { result: "found", nameMatches: true, regular: true, checkedOn: "01/10/2026" },
      lastChangeByClient: true,
    },
    {
      name: "Pedro Teste",
      cpfMasked: null,
      role: "claimant",
      guardianName: "Maria Teste",
      registry: null,
      lastChangeByClient: false,
    },
    {
      name: "José Teste",
      cpfMasked: "***.111.222-**",
      role: "guardian",
      guardianName: null,
      registry: { result: "not_found", nameMatches: null, regular: null, checkedOn: "02/10/2026" },
      lastChangeByClient: false,
    },
  ],
  links: [
    { person: "Maria Teste", createdOn: "28/09/2026", opened: 3, finishedOn: "30/09/2026" },
    { person: "José Teste", createdOn: "29/09/2026", opened: 0, finishedOn: null },
  ],
  consents: [{ person: "Maria Teste", title: "Tratamento de dados", version: 2, acceptedOn: "30/09/2026" }],
  signatures: [
    signature(),
    signature({
      document: "Contrato",
      method: "gov.br",
      state: "signed",
      by: "firm",
      signedOn: "03/10/2026, 09:15",
      signers: [{ name: "José Teste", signedOn: null }],
      fingerprint: "ab12cd34ef56ab78",
    }),
  ],
  statements: [
    { person: "Maria Teste", source: "áudio pelo WhatsApp", confirmedOn: "02/10/2026", status: "confirmada" },
    {
      person: null,
      source: "texto escrito pelo escritório",
      confirmedOn: null,
      status: "cronologia ainda sem confirmação",
    },
  ],
  complaints: [
    {
      channel: "consumidor.gov.br",
      protocol: "2026.10/000123",
      filedOn: "22/09/2026",
      outcome: "sem resposta no prazo",
    },
  ],
  documents: [
    { kind: "Documento de identidade", person: "Maria Teste", acceptedOn: "30/09/2026", fingerprint: "ab12cd34" },
    { kind: "Cartão de embarque", person: null, acceptedOn: null, fingerprint: null },
  ],
  proceedings: [{ kind: "Juizado especial cível", forum: "Goiânia", number: null, filedOn: null }],
  ...changes,
});

const empty = (): DossierFacts =>
  facts({
    airline: null,
    flightDate: null,
    segments: [],
    people: [],
    links: [],
    consents: [],
    signatures: [],
    statements: [],
    complaints: [],
    documents: [],
    proceedings: [],
  });

/** Everything a block says, as one text. */
function words(block: TextBlock): string {
  if (block.kind === "list") return block.items.join("\n");
  if (block.kind === "fields") return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
  if (block.kind === "space" || block.kind === "pageBreak") return "";
  return block.text;
}
const textOf = (blocks: TextBlock[]) => blocks.map(words).join("\n");
const headings = (blocks: TextBlock[]) => blocks.flatMap((block) => (block.kind === "heading" ? [block.text] : []));
/** What a section says: the blocks between its heading and the next one. */
function section(blocks: TextBlock[], heading: string): string {
  const start = blocks.findIndex((block) => block.kind === "heading" && block.text === heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((block) => block.kind === "heading");
  return textOf(end === -1 ? rest : rest.slice(0, end));
}

describe("the dossier of a case", () => {
  it("says who issued it, when and in which zone, and goes through the case in one order", () => {
    const dossier = buildDossier(facts());
    expect(dossier.title).toBe("Dossiê do caso #12");
    expect(dossier.blocks[0]).toEqual({ kind: "title", text: "Dossiê do caso #12" });
    expect(words(dossier.blocks[1])).toContain(
      "Emitido por Souza Advogados em 09/10/2026, 10:30 (horário de Brasília).",
    );
    expect(words(dossier.blocks[1])).toContain("os horários estão no horário de Brasília");
    expect(headings(dossier.blocks)).toEqual([
      "O caso",
      "Quem são as pessoas",
      "O que as pessoas fizeram pelo link do escritório",
      "O que foi aceito",
      "O que foi assinado",
      "O que a pessoa contou",
      "O que foi tentado antes da ação",
      "Documentos aceitos pelo escritório",
      "Processos",
    ]);
  });

  it("says who each person is, how that was checked and who wrote the data last", () => {
    const people = section(buildDossier(facts()).blocks, "Quem são as pessoas");
    expect(people).toContain("Nome: Maria Teste");
    expect(people).toContain("CPF: ***.456.789-**");
    expect(people).toContain("No caso: pede em nome próprio");
    expect(people).toContain(
      "CPF no cadastro da Receita: consultado em 01/10/2026: CPF encontrado, o nome confere, situação regular",
    );
    // The data may have been written by both: what is on record is who wrote it last, and the dossier says that.
    expect(people).toContain("Última alteração dos dados: feita pela própria pessoa, pelo link do escritório");
    // A minor, with who answers for them; a CPF that is not on record is said as such.
    expect(people).toContain("No caso: pede em nome próprio, é menor e tem Maria Teste como responsável");
    expect(people).toContain("CPF: não registrado");
    expect(people).toContain("CPF no cadastro da Receita: não consultado");
    expect(people).toContain("No caso: responde por quem é menor");
    expect(people).toContain("consultado em 02/10/2026: o cadastro não encontrou este CPF");
    expect(people).toContain("Última alteração dos dados: feita pelo escritório");
  });

  it("says each answer of the registry by its own name, and never a regular CPF nobody said was one", () => {
    const asked = (result: "found" | "not_found" | "birth_date_mismatch" | "minor", more = {}) =>
      registryWords({ result, nameMatches: null, regular: null, checkedOn: "05/10/2026", ...more });
    expect(registryWords(null)).toBe("não consultado");
    expect(asked("found")).toBe("consultado em 05/10/2026: CPF encontrado, o nome não foi comparado");
    expect(asked("found", { nameMatches: false, regular: false })).toBe(
      "consultado em 05/10/2026: CPF encontrado, o nome não confere, situação que não é regular",
    );
    expect(asked("not_found")).toBe("consultado em 05/10/2026: o cadastro não encontrou este CPF");
    // A birth date that is not the registry's is not "CPF not found": the dossier says which of the two it was.
    expect(asked("birth_date_mismatch")).toBe(
      "consultado em 05/10/2026: a data de nascimento registrada no caso não é a do cadastro",
    );
    expect(asked("minor")).toBe("consultado em 05/10/2026: o cadastro não responde por CPF de pessoa menor de idade");
  });

  it("says what each person did, accepted, signed and told, with the day of each", () => {
    const { blocks } = buildDossier(facts());
    expect(section(blocks, "O caso")).toContain(
      "Voo G3 1234, GYN para CGH, chegada prevista para 20/09/2026 às 08:00, hora local do aeroporto, chegada real em 20/09/2026 às 14:10, hora local do aeroporto, trecho em que o problema aconteceu",
    );
    expect(section(blocks, "O caso")).toContain("Voo sem número registrado, CGH para SDU");
    const links = section(blocks, "O que as pessoas fizeram pelo link do escritório");
    expect(links).toContain(
      "Maria Teste: link criado em 28/09/2026, aberto 3 vezes, a pessoa disse que terminou em 30/09/2026",
    );
    expect(links).toContain(
      "José Teste: link criado em 29/09/2026, nunca aberto, a pessoa ainda não disse que terminou",
    );
    expect(section(blocks, "O que foi aceito")).toBe(
      'Maria Teste aceitou "Tratamento de dados", versão 2, em 30/09/2026',
    );
    const signed = section(blocks, "O que foi assinado");
    expect(signed).toContain(
      "Procuração, por ZapSign: aguardando assinatura. Maria Teste em 01/10/2026, 14:02; José Teste, ainda sem assinar",
    );
    expect(signed).toContain(
      "Contrato, por gov.br: o escritório conferiu o arquivo assinado e registrou a assinatura em 03/10/2026, 09:15. Quem assina: José Teste, impressão digital do arquivo assinado ab12cd34ef56ab78",
    );
    const told = section(blocks, "O que a pessoa contou");
    expect(told).toContain(
      "Relato de Maria Teste, áudio pelo WhatsApp, cronologia confirmada pela pessoa em 02/10/2026",
    );
    expect(told).toContain("Relato, texto escrito pelo escritório, cronologia ainda sem confirmação");
    expect(section(blocks, "O que foi tentado antes da ação")).toBe(
      "consumidor.gov.br, protocolo 2026.10/000123, feita em 22/09/2026, sem resposta no prazo",
    );
    const documents = section(blocks, "Documentos aceitos pelo escritório");
    expect(documents).toContain(
      "Documento de identidade, de Maria Teste, aceito em 30/09/2026, impressão digital do arquivo ab12cd34",
    );
    expect(documents).toContain("Cartão de embarque");
    expect(section(blocks, "Processos")).toContain("Juizado especial cível, Goiânia, ainda sem número");
  });

  it("says who answers for a signature: the provider that reported it, or the firm that confirmed a file", () => {
    // What the provider reported is said as the provider's word, with the hour of each signature it gave.
    expect(
      signatureWords(
        signature({
          state: "signed",
          by: "provider",
          signedOn: "01/10/2026, 15:00",
          signers: [
            { name: "Maria Teste", signedOn: "01/10/2026, 14:02" },
            { name: "José Teste", signedOn: "01/10/2026, 14:40" },
          ],
          fingerprint: "0011223344556677",
        }),
      ),
    ).toBe(
      "Procuração, por ZapSign: assinado, conforme informado pelo serviço de assinatura em 01/10/2026, 15:00. Quem assinou: Maria Teste em 01/10/2026, 14:02; José Teste em 01/10/2026, 14:40, impressão digital do arquivo assinado 0011223344556677",
    );
    // A signed envelope whose signers carry no hour is still signed: never "ainda sem assinar".
    const noHours = signatureWords(
      signature({ state: "signed", by: "provider", signers: [{ name: "Maria Teste", signedOn: null }] }),
    );
    expect(noHours).toBe(
      "Procuração, por ZapSign: assinado, conforme informado pelo serviço de assinatura. Quem assinou: Maria Teste",
    );
    expect(noHours).not.toContain("sem assinar");
    // What the firm confirmed from a file is never written as a day somebody signed.
    const byFirm = signatureWords(
      signature({
        method: "e-Notariado",
        state: "signed",
        by: "firm",
        signers: [{ name: "Maria Teste", signedOn: null }],
      }),
    );
    expect(byFirm).toBe(
      "Procuração, por e-Notariado: o escritório conferiu o arquivo assinado e registrou a assinatura. Quem assina: Maria Teste",
    );
    expect(
      signatureWords(
        signature({ method: "gov.br", state: "received", signers: [{ name: "Maria Teste", signedOn: null }] }),
      ),
    ).toBe(
      "Procuração, por gov.br: a pessoa devolveu um arquivo, que o escritório ainda não conferiu. Quem assina: Maria Teste",
    );
    expect(signatureWords(signature({ state: "refused" }))).toBe(
      "Procuração, por ZapSign: houve recusa de assinatura. Quem assinaria: Maria Teste; José Teste",
    );
    expect(signatureWords(signature({ state: "expired" }))).toBe(
      "Procuração, por ZapSign: o prazo passou sem todas as assinaturas. Maria Teste em 01/10/2026, 14:02; José Teste, ainda sem assinar",
    );
  });

  it("says what is not on record instead of leaving it out", () => {
    const { blocks, summary } = buildDossier(empty());
    for (const heading of [
      "Quem são as pessoas",
      "O que as pessoas fizeram pelo link do escritório",
      "O que foi aceito",
      "O que foi assinado",
      "O que a pessoa contou",
      "O que foi tentado antes da ação",
      "Documentos aceitos pelo escritório",
      "Processos",
    ]) {
      expect(section(blocks, heading).trim(), heading).toMatch(/^Nada registrado\./);
    }
    const about = section(blocks, "O caso");
    expect(about).toContain("Companhia: não registrada");
    expect(about).toContain("Dia do voo: não registrado");
    expect(about).toContain("Nada registrado.");
    expect(Object.values(summary).every((count) => count === 0)).toBe(true);
    // A complaint with no protocol and a signature nobody is named in are said as they are.
    const partial = buildDossier(
      facts({
        complaints: [{ channel: "SAC da companhia", protocol: null, filedOn: null, outcome: "aguardando resposta" }],
        signatures: [signature({ method: "gov.br", signers: [] })],
      }),
    ).blocks;
    expect(section(partial, "O que foi tentado antes da ação")).toBe(
      "SAC da companhia, sem protocolo registrado, aguardando resposta",
    );
    expect(section(partial, "O que foi assinado")).toBe(
      "Procuração, por gov.br: aguardando assinatura. Sem signatários registrados",
    );
  });

  it("keeps beside the dossier what it holds by counts, never the values", () => {
    const { summary } = buildDossier(facts());
    expect(summary).toEqual({
      people: 3,
      // Only a CPF the registry found counts as checked.
      registry_checks: 1,
      links_finished: 1,
      consents: 1,
      // What counts is an envelope that ended signed: one that still waits is no signature yet.
      signatures: 1,
      statements_confirmed: 1,
      complaints: 1,
      documents: 2,
    });
    expect(Object.values(summary).every((count) => Number.isInteger(count))).toBe(true);
  });

  it("is written for people: no dash, no exclamation mark, and the code explained where it ends", () => {
    for (const dossier of [buildDossier(facts()), buildDossier(empty())]) {
      const text = textOf(dossier.blocks);
      for (const mark of [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014), "!"]) {
        expect(text.includes(mark), mark).toBe(false);
      }
      expect(words(dossier.blocks[dossier.blocks.length - 1])).toContain(
        "O código ao pé de cada página permite a qualquer pessoa conferir que ele foi emitido pelo escritório, sem ver o conteúdo.",
      );
    }
  });
});

describe("a signature as the database records it", () => {
  const envelope = (changes: Partial<EnvelopeFacts> = {}): EnvelopeFacts => ({
    document_id: "d1",
    method: "zapsign",
    status: "pending",
    signers: [
      { position: 1, person_id: "p1", name: "Maria Teste", sign_url: "https://example.invalid/a", signed_at: null },
      { position: 2, person_id: "p2", name: "José Teste", sign_url: null, signed_at: null },
    ],
    evidence: [],
    signed_sha256: null,
    updated_at: "2026-10-02T01:30:00Z",
    ...changes,
  });
  const told = { document: "Procuração", method: "ZapSign" };

  it("reads who signed from the evidence of a signed envelope, where the database keeps it", () => {
    // Once an envelope is signed, when each person signed is in `evidence`, by the signer's name: the list
    // of signers keeps the hours of the last poll only, which may be none.
    const signed = dossierSignature(
      envelope({
        status: "signed",
        evidence: [
          { signer: "maria teste ", signed_at: "2026-10-01T17:02:00Z" },
          { signer: "José Teste", signed_at: "2026-10-02T01:10:00Z" },
        ],
        signed_sha256: "a".repeat(64),
      }),
      told,
    );
    expect(signed).toEqual({
      document: "Procuração",
      method: "ZapSign",
      state: "signed",
      by: "provider",
      // 01:30 UTC of the 2nd is 22:30 of the 1st in Brasília: the day is the dossier's zone's.
      signedOn: "01/10/2026, 22:30",
      signers: [
        { name: "Maria Teste", signedOn: "01/10/2026, 14:02" },
        { name: "José Teste", signedOn: "01/10/2026, 22:10" },
      ],
      fingerprint: "a".repeat(16),
    });
    expect(signatureWords(signed as DossierSignature)).not.toContain("sem assinar");
  });

  it("says a signature a person of the firm confirmed is the firm's word, and keeps the hours of one that waits", () => {
    const byFirm = dossierSignature(envelope({ method: "govbr", status: "signed", signed_sha256: "b".repeat(64) }), {
      document: "Contrato",
      method: "gov.br",
    });
    expect(byFirm?.by).toBe("firm");
    expect(byFirm?.signers.every((signer) => signer.signedOn === null)).toBe(true);
    const waiting = dossierSignature(
      envelope({
        signers: [
          { position: 1, name: "Maria Teste", signed_at: "2026-10-01T17:02:00Z" },
          { position: 2, name: "José Teste", signed_at: null },
        ],
      }),
      told,
    );
    expect(waiting).toMatchObject({
      state: "pending",
      by: null,
      signedOn: null,
      fingerprint: null,
      signers: [
        { name: "Maria Teste", signedOn: "01/10/2026, 14:02" },
        { name: "José Teste", signedOn: null },
      ],
    });
  });

  it("is nothing for what nobody could sign, and survives what is not what it should be", () => {
    for (const status of ["reserved", "opening", "cancelled", "failed", "uncertain", "other"]) {
      expect(dossierSignature(envelope({ status }), told), status).toBeNull();
    }
    const odd = dossierSignature(envelope({ status: "refused", signers: "x", evidence: { a: 1 } }), told);
    expect(odd).toMatchObject({ state: "refused", signers: [] });
    expect(
      dossierSignature(envelope({ status: "expired", signers: [null, 3, { name: 7 }, { name: "Ana" }] }), told),
    ).toMatchObject({
      signers: [{ name: "Ana", signedOn: null }],
    });
  });
});

describe("what the official record says of a leg", () => {
  const found = {
    status: "found" as const,
    month: "2026-08",
    cancelled: false,
    scheduledArrival: "05/08/2026 às 09:40",
    actualArrival: "05/08/2026 às 14:05",
    delayMinutes: 265,
  };

  it("names the record and its month, with the arrival it gives and the delay", () => {
    expect(officialWords(found)).toBe(
      "no registro oficial da ANAC (VRA, 08/2026), chegada prevista para 05/08/2026 às 09:40, chegada real em 05/08/2026 às 14:05, 265 minutos de atraso na chegada",
    );
    expect(officialWords({ ...found, delayMinutes: -5 })).not.toContain("atraso");
  });

  it("says a flight recorded as cancelled as such, and what is not on record or not out yet", () => {
    expect(officialWords({ ...found, cancelled: true })).toBe(
      "no registro oficial da ANAC (VRA, 08/2026), voo registrado como cancelado",
    );
    expect(officialWords({ status: "not_found", month: "2026-08" })).toBe(
      "sem registro deste voo nesta data no registro oficial da ANAC",
    );
    expect(officialWords({ status: "not_published", month: "2026-09" })).toBe(
      "o registro oficial da ANAC deste mês ainda não tinha sido publicado",
    );
    expect(officialWords(null)).toBeNull();
    expect(officialWords(undefined)).toBeNull();
  });

  it("tells the legs of the same flight no schedule foresaw, and where they took the aircraft, never who was on it", () => {
    const diverted = officialWords({
      ...found,
      cancelled: true,
      unscheduled: [
        {
          kind: "included",
          origin: "GRU",
          destination: "SJU",
          departure: "13/08/2026 às 22:28",
          arrival: "14/08/2026 às 04:58 (horário de Brasília)",
        },
        {
          kind: "included",
          origin: "SJU",
          destination: "JFK",
          departure: null,
          arrival: "14/08/2026 às 11:57 (horário de Brasília)",
        },
      ],
      reachedDestination: "14/08/2026 às 11:57 (horário de Brasília)",
      reachedDelayMinutes: 232,
    });
    expect(diverted).toBe(
      "no registro oficial da ANAC (VRA, 08/2026), voo registrado como cancelado; o registro traz etapas do mesmo voo que nenhum horário previa: " +
        "etapa incluída no voo de GRU para SJU, partida real em 13/08/2026 às 22:28, chegada real em 14/08/2026 às 04:58 (horário de Brasília); " +
        "etapa incluída no voo de SJU para JFK, chegada real em 14/08/2026 às 11:57 (horário de Brasília); " +
        "por essas etapas, a aeronave chegou ao destino do voo em 14/08/2026 às 11:57 (horário de Brasília), 232 minutos depois da chegada prevista (o registro não diz quem estava a bordo)",
    );
    // A flight that was flown keeps its own arrival; a return before it is told beside it.
    const returned = officialWords({
      ...found,
      unscheduled: [
        {
          kind: "return",
          origin: "GYN",
          destination: "GYN",
          departure: "05/08/2026 às 08:20",
          arrival: "05/08/2026 às 08:55",
        },
      ],
      reachedDestination: null,
      reachedDelayMinutes: null,
    });
    expect(returned).toContain("265 minutos de atraso na chegada; o registro traz etapas do mesmo voo");
    expect(returned).toContain("retorno ao aeroporto de origem de GYN para GYN, partida real em 05/08/2026 às 08:20");
    expect(returned).not.toContain("a aeronave chegou");
  });

  it("says a flight's stops, a leg of it given as cancelled, a flight that ends elsewhere and the airline's reason", () => {
    expect(
      officialWords({
        ...found,
        cancelled: true,
        stops: ["BEL"],
        cancelledLegs: ["BEL para MCP"],
        justification: "ATRASOS NÃO ESPECÍFICOS",
      }),
    ).toBe(
      "no registro oficial da ANAC (VRA, 08/2026), com escala em BEL sob o mesmo número, voo registrado como cancelado (a etapa de BEL para MCP), justificativa da companhia no registro: ATRASOS NÃO ESPECÍFICOS",
    );
    expect(
      officialWords({ ...found, scheduledArrival: null, actualArrival: null, delayMinutes: null, endsAt: "BEL" }),
    ).toBe("no registro oficial da ANAC (VRA, 08/2026), o voo termina em BEL, não no destino deste trecho");
  });

  it("is written beside its leg in the dossier", () => {
    const base = facts();
    const withRecord = {
      ...base,
      segments: base.segments.map((segment, index) => (index === 0 ? { ...segment, official: found } : segment)),
    };
    expect(section(buildDossier(withRecord).blocks, "O caso")).toContain(
      "trecho em que o problema aconteceu; no registro oficial da ANAC (VRA, 08/2026), chegada prevista para 05/08/2026 às 09:40",
    );
  });
});

describe("a moment in a document that travels", () => {
  it("is written in the dossier's zone, whoever asked for it", () => {
    expect(dossierMoment("2026-10-02T01:30:00Z")).toBe("01/10/2026, 22:30");
    expect(dossierDay("2026-10-02T01:30:00Z")).toBe("01/10/2026");
    expect(dossierDay("2026-10-02T12:00:00+00:00")).toBe("02/10/2026");
    for (const nothing of [null, undefined, "", "not a day"]) {
      expect(dossierMoment(nothing)).toBeNull();
      expect(dossierDay(nothing)).toBeNull();
    }
  });
});

describe("a CPF in a document that travels", () => {
  it("shows its middle and hides the rest, and is nothing when it is not a CPF", () => {
    expect(maskCpf("12345678909")).toBe("***.456.789-**");
    expect(maskCpf("123.456.789-09")).toBe("***.456.789-**");
    expect(maskCpf("1234567890")).toBeNull();
    expect(maskCpf("")).toBeNull();
    expect(maskCpf(null)).toBeNull();
    expect(maskCpf(undefined)).toBeNull();
  });
});
