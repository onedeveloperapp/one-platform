// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AiProviderName } from "@flyee/ai/types";
import { PLAIN_CODES, unwritableCharacters } from "@flyee/documents/text-pdf";
import { canonicalCitation, extractCitations, sourceKey } from "@flyee/knowledge/citations";
import { signature, similarity } from "@flyee/knowledge/similarity";

/**
 * The piece of a lawsuit, with the app's own worker against a real database:
 * a lawyer's sources enter the firm's library, the AI writes the first text
 * from the firm's model, the worker reads what each version cites, the
 * approval is refused while a source is outside the library and, once it
 * passes, the approved text becomes a PDF that is the petition of its case.
 * A piece is approved on its case and nowhere else, as the text a lawyer
 * just read: the approval carries the version and the mark of that text.
 * A lawyer who would rather say what to change sends the text back to the
 * AI: it is handed over with what identifies a person under numbered marks,
 * and what the AI writes is the next version, with every word back.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * What stands in is the transport (a client that calls the same functions
 * with the same named arguments PostgREST would, as the same database
 * roles), the bucket (kept in memory) and the model (the fake provider of
 * `@flyee/ai`, told here what to write).
 *
 * Every person, firm, company, CPF, CNPJ and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what to write: the executor still reaches it through the fake provider's own door. */
const model = vi.hoisted(() => ({
  text: "",
  notes: [] as string[],
  /** When set, the next call fails with it instead of answering. */
  failure: null as unknown,
  /** What the model was handed, call by call. */
  heard: [] as string[],
}));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        model.heard.push(
          messages
            .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
            .join("\n"),
        );
        if (model.failure !== null) {
          const failure = model.failure;
          model.failure = null;
          throw failure;
        }
        return { texto: model.text, pendencias: [], observacoes: model.notes };
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

const DB_URL = process.env.ONE_EMBEDDED_DB_URL ?? "";

type Row = Record<string, unknown>;
type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<Row[]>;
  begin: <T>(run: (transaction: Sql) => Promise<T>) => Promise<T>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

let sql: Sql;

/** The bucket, in memory: what the worker writes through the storage API. */
const bucket = new Map<string, Uint8Array>();
/** When set, the upload of that number from now (1 is the next) fails as a storage that did not answer. */
let failUploadIn = 0;

const storage = {
  from: () => ({
    async upload(storagePath: string, bytes: Uint8Array) {
      if (failUploadIn > 0) {
        failUploadIn -= 1;
        if (failUploadIn === 0) return { data: null, error: { message: "storage did not answer" } };
      }
      bucket.set(storagePath, new Uint8Array(bytes));
      return { data: { path: storagePath }, error: null };
    },
    async download(storagePath: string) {
      const bytes = bucket.get(storagePath);
      if (!bytes) return { data: null, error: { message: "not found" } };
      return { data: { arrayBuffer: async () => bytes.slice().buffer }, error: null };
    },
    async remove(storagePaths: string[]) {
      for (const storagePath of storagePaths) bucket.delete(storagePath);
      return { data: [], error: null };
    },
  }),
};

/** The arguments of a function and whether it answers rows, read from the catalog once. */
const signatures = new Map<string, { types: Map<string, string>; rows: boolean }>();
async function signatureOf(name: string) {
  const known = signatures.get(name);
  if (known) return known;
  const found = await sql.unsafe(
    `select a.name, format_type(a.type, null) as type, p.proretset as rows
     from pg_proc p
     cross join lateral unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) as a (name, type)
     where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [name],
  );
  const read = {
    types: new Map(found.map((row) => [String(row.name), String(row.type)])),
    rows: Boolean(found[0]?.rows),
  };
  signatures.set(name, read);
  return read;
}

/** A value as the text PostgreSQL casts to the parameter's type: an array as an array literal, an object as JSON. */
function asText(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type.endsWith("[]") && Array.isArray(value)) return `{${value.join(",")}}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A stand-in for the Supabase client, as far as the drafts code uses one: `rpc` and the bucket. */
function clientAs(role: "service_role" | "authenticated", claims: Row) {
  return {
    storage,
    async rpc(name: string, args: Row = {}) {
      try {
        const known = await signatureOf(name);
        const keys = Object.keys(args).filter((key) => args[key] !== undefined);
        for (const key of keys) if (!known.types.has(key)) throw new Error(`${name} has no argument ${key}`);
        const call = keys.map((key, index) => `${key} => $${index + 1}::text::${known.types.get(key)}`).join(", ");
        const params = keys.map((key) => asText(args[key], known.types.get(key) as string));
        const found = await sql.begin(async (transaction) => {
          await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
          await transaction.unsafe(`set local role ${role}`);
          return transaction.unsafe(
            known.rows ? `select * from public.${name}(${call})` : `select public.${name}(${call}) as result`,
            params,
          );
        });
        return { data: known.rows ? found : (found[0]?.result ?? null), error: null };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return { data: null, error: { code: failure.code, message: failure.message ?? "failed" } };
      }
    },
  };
}

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

/** A backend whose word about a piece just issued never arrives: the database did it, and the worker cannot know. */
function backendThatLosesTheAnswer() {
  const real = backend();
  return {
    ...real,
    async rpc(name: string, args: Row = {}) {
      const answer = await real.rpc(name, args);
      if (name === "record_draft_work" && args.target_outcome === "issued") {
        return { data: null, error: { code: undefined, message: "the answer got lost on the way" } };
      }
      return answer;
    },
  };
}

const ANA = "ad300000-0000-4000-8000-000000000001";
const BIA = "ad300000-0000-4000-8000-000000000002";
const RUI = "ad300000-0000-4000-8000-000000000003";
const FIRM = "bd300000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bd300000-0000-4000-8000-00000000000b";

const asAna = (aal = "aal2") => clientAs("authenticated", { sub: ANA, role: "authenticated", aal });
const asBia = () => clientAs("authenticated", { sub: BIA, role: "authenticated", aal: "aal2" });
const asRui = () => clientAs("authenticated", { sub: RUI, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

/** The firm's model of a petition: the marks the platform fills, and two sources. */
const MODEL = [
  "EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]",
  "[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização por danos morais em face de [[RE]], pelos fatos e fundamentos que seguem.",
  "DOS FATOS",
  "Descreva aqui o que aconteceu com o voo, o que a companhia informou ao passageiro e a assistência que deixou de prestar.",
  // What a model written from a real petition may still carry: the AI is handed none of it.
  "Modelo feito a partir do caso de Fulano Exemplo, CPF 111.444.777-35, contato (62) 3333-4444.",
  "DO DIREITO",
  "A companhia responde pelos danos que causa na prestação do serviço, na forma do art. 14 do CDC, e a Súmula 999 do STJ trata do dano moral que decorre do atraso.",
  "DOS PEDIDOS",
  "Pede-se a condenação da ré ao pagamento de indenização por danos morais, assim: [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].",
  "Nestes termos, pede deferimento.",
  "[[NOMES_DAS_PARTES]]",
].join("\n\n");

/** What the model writes from it: the facts of the case in their place, the marks and the sources kept. */
const FIRST_TEXT = MODEL.replace(
  "Descreva aqui o que aconteceu com o voo, o que a companhia informou ao passageiro e a assistência que deixou de prestar.",
  "O voo contratado chegou ao destino com mais de quatro horas de atraso. A companhia não informou o motivo e não ofereceu alimentação nem meio de comunicação durante a espera.",
);
/** The same text with the source nobody verified taken out, as a lawyer corrects it. */
const CORRECTED = FIRST_TEXT.replace(
  ", e a Súmula 999 do STJ trata do dano moral que decorre do atraso.",
  ". O atraso de mais de quatro horas, sem assistência, é dano que dispensa outra prova.",
);

describe.skipIf(!DB_URL)("the piece of a lawsuit, written and issued by the worker against the database", () => {
  let caseId = "";
  let proceedingId = "";
  let otherCaseId = "";
  let otherProceedingId = "";
  let templateId = "";
  let draftId = "";
  const airline: { legal_name: unknown; cnpj: unknown } = { legal_name: null, cnpj: null };

  const draftOf = async (id: string) =>
    (
      await sql.unsafe(
        `select status, work, work_claimed_at, work_after, work_error, work_attempts, version, checked_version, run_id,
                approved_version, approved_body, approved_by, document_id, alike
         from public.case_drafts where id = $1`,
        [id],
      )
    )[0];
  const bodyOf = async (id: string, version: number) =>
    String(
      (
        await sql.unsafe(`select body from public.case_draft_versions where draft_id = $1 and version = $2`, [
          id,
          version,
        ])
      )[0]?.body ?? "",
    );
  const citedBy = async (id: string, version: number) =>
    (
      await sql.unsafe(
        `select key from public.case_draft_citations where draft_id = $1 and version = $2 order by position`,
        [id, version],
      )
    ).map((row) => String(row.key));
  const count = async (query: string, params: unknown[]) => Number((await sql.unsafe(query, params))[0].n);
  const petitionFiles = () =>
    sql.unsafe(
      `select id, status, storage_path, sha256, name from public.files where org_id = $1 and purpose = 'petition'`,
      [FIRM],
    );
  /** A lawyer approves what the preview just showed them: its version and the mark of that very text. */
  async function approve(client: ReturnType<typeof clientAs>, id: string): Promise<Answer> {
    const preview = await call(client, "preview_case_draft", { target_draft: id });
    return call(client, "approve_case_draft", {
      target_draft: id,
      target_version: preview.version ?? 0,
      target_hash: preview.hash ?? null,
    });
  }
  /** A lawyer saves a text written on the latest version. */
  async function save(client: ReturnType<typeof clientAs>, id: string, body: string): Promise<Answer> {
    return call(client, "save_draft_version", {
      target_draft: id,
      target_body: body,
      target_base: Number((await draftOf(id)).version),
    });
  }
  /** The wait after a passing failure, taken as over. */
  const waitIsOver = (id: string) => sql.unsafe(`update public.case_drafts set work_after = null where id = $1`, [id]);

  /** A case of the firm with one adult whose data is complete, what they ask, and a lawsuit still to be filed. */
  async function openCase(client: { full_name: string; cpf?: string; birth_date: string }, street: string) {
    const opened = await call(asAna(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-09-20",
      target_client: client,
    });
    const saved = await call(asAna(), "save_case_person", {
      target_case: opened.case_id,
      target_person: opened.person_id,
      target_fields: {
        nationality: "brasileira",
        marital_status: "casado",
        profession: "professora",
        postal_code: "74000000",
        street,
        address_number: "10",
        district: "Centro",
        city: "Goiânia",
        uf: "GO",
      },
    });
    expect(saved.ok, "person").toBe(true);
    const asked = await call(asAna(), "set_party_claim", {
      target_case: opened.case_id,
      target_party: opened.party_id,
      target_cents: 1000000,
    });
    expect(asked.ok, "claim").toBe(true);
    const lawsuit = await call(asAna(), "save_proceeding", {
      target_case: opened.case_id,
      target_proceeding: null,
      target_fields: { kind: "juizado", court: "TJGO", comarca: "Goiânia", forum_basis: "domicile", system: "projudi" },
      target_parties: [opened.party_id],
      target_lawyers: [ANA],
    });
    expect(lawsuit.code, "lawsuit").toBe("saved");
    return { caseId: String(opened.case_id), proceedingId: String(lawsuit.proceeding_id) };
  }

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });
    process.env.AI_FAKE_PROVIDER = "1";

    const people = [
      [ANA, "ana", "Ana Souza", FIRM, "owner", "socio"],
      // Who answers clients: works on cases, and signs nothing.
      [BIA, "bia", "Bia Lima", FIRM, "member", "atendimento"],
      [RUI, "rui", "Rui Costa", OTHER_FIRM, "owner", "socio"],
    ] as const;
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in (${people.map(([id]) => `'${id}'`).join(", ")});
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ${people
        .map(
          ([id, slug, name]) =>
            `('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${slug}@pecas.invalid', '', now(), '{}', '{"display_name":"${name}"}', now(), now())`,
        )
        .join(", ")};
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-pecas', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-pecas', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ${people
        .map(([id, , , firm, role, work]) => `('${firm}', '${id}', '${role}', '${work}')`)
        .join(", ")};
      insert into public.oab_registrations (user_id, uf, number, kind) values ('${ANA}', 'GO', '12121', 'principal');
      -- Both firms have a lawyer approve each piece (0016): what follows is that path, until the last test lets ONE.
      insert into public.firm_autonomy (org_id, decision, mode) values
        ('${FIRM}', 'piece_text', 'approval'), ('${OTHER_FIRM}', 'piece_text', 'approval');
    `);
    // The company an airline answers in court by is what the operator recorded of it: put back at the end.
    const before = (await sql.unsafe(`select legal_name, cnpj from public.airlines where iata = 'G3'`))[0];
    airline.legal_name = before?.legal_name ?? null;
    airline.cnpj = before?.cnpj ?? null;
    await sql.unsafe(
      `update public.airlines set legal_name = 'Companhia Aérea Exemplo S.A.', cnpj = '11222333000181' where iata = 'G3'`,
    );

    const first = await openCase(
      { full_name: "Maria Teste", cpf: "12345678909", birth_date: "1985-04-02" },
      "Rua das Flores",
    );
    caseId = first.caseId;
    proceedingId = first.proceedingId;
    const second = await openCase(
      { full_name: "João Teste", cpf: "98765432100", birth_date: "1990-01-15" },
      "Avenida Central",
    );
    otherCaseId = second.caseId;
    otherProceedingId = second.proceedingId;
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    await sql?.unsafe(`update public.airlines set legal_name = $1, cnpj = $2 where iata = 'G3'`, [
      airline.legal_name,
      airline.cnpj,
    ]);
    await sql?.end({ timeout: 5 });
  });

  it("keeps a source a lawyer checked under the key its own citation is read into", async () => {
    const { sourceFromCitation } = await import("@/lib/cases/drafts");
    const typed = [
      "art. 14 do CDC",
      "art. 42-A do CDC",
      "Lei 9.099/95",
      "Lei Complementar nº 123",
      "art. 5º da Constituição Federal",
      "Convenção de Montreal",
      "art. 19 do Decreto nº 5.910/2006",
      "Resolução nº 400 da ANAC",
      "art. 21 da Resolução nº 400 da ANAC",
      "Súmula 387 do STJ",
      "Súmula Vinculante 10",
      "Tema 1.417 do STF",
      "Enunciado 161 do FONAJE",
      "REsp 1.584.465/MG",
      "5000202-39.2099.8.09.0051",
      // A decision of a class more than one court has, with its court; and the norms that are no law.
      "HC 123.456 do STJ",
      "Súmula 45 da TNU",
      "Medida Provisória nº 925/2020",
      "Regulamento (CE) nº 261/2004",
    ];
    for (const citation of typed) {
      const read = sourceFromCitation(citation);
      expect(read.ok, citation).toBe(true);
      if (!read.ok) continue;
      const saved = await call(asAna(), "save_legal_source", {
        target_org: FIRM,
        target_source: null,
        fields: { ...read.source, title: `Fonte conferida: ${citation}`, source_url: "https://fontes.invalid/texto" },
      });
      expect(saved.code, citation).toBe("verified");
    }
    // Who answers clients says nothing of what was checked, and a source is said once.
    const byBia = await call(asBia(), "save_legal_source", {
      target_org: FIRM,
      target_source: null,
      fields: {
        kind: "lei",
        issuer: "",
        number: "10406",
        article: null,
        title: "Código Civil",
        source_url: "https://fontes.invalid/cc",
      },
    });
    expect(byBia.code).toBe("not_allowed");
    const again = sourceFromCitation("art. 14 da Lei nº 8.078/90");
    expect(again.ok).toBe(true);
    if (again.ok) {
      const twice = await call(asAna(), "save_legal_source", {
        target_org: FIRM,
        target_source: null,
        fields: { ...again.source, title: "A mesma fonte", source_url: "https://fontes.invalid/texto" },
      });
      expect(twice.code).toBe("already_in_library");
    }

    const kept = await sql.unsafe(
      `select kind, issuer, number, article, key, citation from public.legal_sources where org_id = $1 order by key`,
      [FIRM],
    );
    expect(kept).toHaveLength(typed.length);
    for (const source of kept) {
      const where = String(source.citation);
      // What the database says a source is cited as is read back, by the reader of a piece, into that very source...
      const read = extractCitations(where);
      expect(
        read.map((citation) => citation.key),
        where,
      ).toEqual([source.key]);
      // ...the app writes the key the database writes...
      expect(
        sourceKey({
          kind: read[0].kind,
          issuer: String(source.issuer),
          number: String(source.number),
          article: source.article === null ? null : String(source.article),
        }),
        where,
      ).toBe(source.key);
      // ...the name the app shows a source by is the one the database says it is cited as...
      expect(
        canonicalCitation({
          kind: read[0].kind,
          issuer: String(source.issuer),
          number: String(source.number),
          article: source.article === null ? null : String(source.article),
        }),
        where,
      ).toBe(where);
      // ...and the same words typed in the library again name the same source.
      const typedAgain = sourceFromCitation(where);
      expect(typedAgain.ok && sourceKey(typedAgain.source), where).toBe(source.key);
    }
    // What nobody could check as written never enters a library, whoever sends it.
    for (const fields of [
      { kind: "precedente", issuer: "", number: "HC 123456", article: null },
      { kind: "decreto", issuer: "", number: "5910", article: null },
      { kind: "tema", issuer: "", number: "1417", article: null },
      { kind: "ilegivel", issuer: "", number: "lei estadual 1", article: null },
      { kind: "artigo", issuer: "", number: "", article: "6" },
    ]) {
      const refused = await call(asAna(), "save_legal_source", {
        target_org: FIRM,
        target_source: null,
        fields: { ...fields, title: "Fonte sem dono", source_url: "https://fontes.invalid/texto" },
      });
      expect(refused.ok, JSON.stringify(fields)).toBe(false);
    }
    // Compared in one order, whatever the order the database sorts text in.
    expect(kept.map((source) => String(source.key)).sort()).toEqual(
      [
        "constituicao::1988#5",
        "decreto::5910/2006",
        "decreto::5910/2006#19",
        "enunciado:FONAJE:161",
        "lei::8078#14",
        "lei::8078#42A",
        "lei::9099",
        "lei_complementar::123",
        "norma::MP 925/2020",
        "norma::REGCE 261/2004",
        "precedente::RESP 1584465",
        "precedente:STJ:HC 123456",
        "processo::50002023920998090051",
        "resolucao:ANAC:400",
        "resolucao:ANAC:400#21",
        "sumula:STJ:387",
        "sumula:TNU:45",
        "sumula_vinculante:STF:10",
        "tema:STF:1417",
      ].sort(),
    );
    // Nothing of it is the other firm's.
    expect(await count(`select count(*)::int as n from public.legal_sources where org_id = $1`, [OTHER_FIRM])).toBe(0);
  });

  it("has the AI write the first text from the firm's model, handing it nothing that names a person", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    const byBia = await call(asBia(), "save_draft_template", {
      target_org: FIRM,
      target_template: null,
      fields: { name: "Petição inicial", proceeding_kind: "juizado", body: MODEL },
    });
    expect(byBia.code).toBe("not_allowed");
    const saved = await call(asAna(), "save_draft_template", {
      target_org: FIRM,
      target_template: null,
      fields: { name: "Petição inicial", proceeding_kind: "juizado", body: MODEL },
    });
    expect(saved.code).toBe("saved");
    templateId = String(saved.template_id);

    // What the client told and confirmed is on record, in their own words: their name, a telephone, an e-mail.
    await sql.unsafe(
      `insert into public.case_statements (org_id, case_id, source, transcript, chronology, chronology_status, client_answered_at)
       values ($1, $2, 'firm', 'relato', $3, 'confirmed', now())`,
      [
        FIRM,
        caseId,
        "1. Maria  Teste chegou ao aeroporto às 6h. 2. O voo atrasou e MARIA TESTE ligou do (62) 99999-0000. 3. Escreveu de maria.teste@exemplo.invalid e não teve resposta. 4. Mária esperou com a filha, e a Testemunha viu.",
      ],
    );

    // Anybody who works on the case asks for the piece.
    const asked = await call(asBia(), "request_case_draft", {
      target_proceeding: proceedingId,
      target_template: templateId,
      target_mode: "ai",
    });
    expect(asked.code).toBe("requested");
    draftId = String(asked.draft_id);
    // One piece is written at a time for a lawsuit: a second request names the one in course.
    expect(
      await call(asAna(), "request_case_draft", {
        target_proceeding: proceedingId,
        target_template: templateId,
        target_mode: "blank",
      }),
    ).toMatchObject({ ok: true, code: "requested" });
    // That second request replaced the first, which had no text yet: the one that counts is the latest.
    const replaced = await draftOf(draftId);
    expect(replaced.status).toBe("cancelled");
    const blankFirst = String(
      (
        await sql.unsafe(`select id from public.case_drafts where proceeding_id = $1 and status = 'proposed'`, [
          proceedingId,
        ])
      )[0].id,
    );
    // With a text to review, another request is refused: the text is worked on, or given up first.
    expect(
      await call(asBia(), "request_case_draft", {
        target_proceeding: proceedingId,
        target_template: templateId,
        target_mode: "ai",
      }),
    ).toMatchObject({ ok: false, code: "draft_in_course" });
    expect(await call(asBia(), "cancel_case_draft", { target_draft: blankFirst })).toMatchObject({ code: "cancelled" });
    const again = await call(asBia(), "request_case_draft", {
      target_proceeding: proceedingId,
      target_template: templateId,
      target_mode: "ai",
    });
    expect(again.code).toBe("requested");
    draftId = String(again.draft_id);

    model.text = FIRST_TEXT.replace(/\n/g, "\r\n");
    model.notes = ["Confirme o horário em que o voo chegou."];
    expect(await draftNext(backend() as never, draftId)).toBe("generated");

    expect(model.heard).toHaveLength(1);
    const heard = model.heard[0];
    expect(heard).toContain("MODELO DO ESCRITÓRIO");
    expect(heard).toContain("Descreva aqui o que aconteceu com o voo");
    expect(heard).toContain('"ocorrencia": "delay"');
    expect(heard).toContain('"quantas_partes": 1');
    // The library says how each source is cited, so that what the model writes is read back into it.
    expect(heard).toContain('"como_citar": "art. 14 da Lei nº 8.078"');
    expect(heard).toContain('"como_citar": "Súmula 387 do STJ"');
    // The key a source has in the database is the app's own business.
    expect(heard).not.toContain("lei::8078#14");
    // What the client told goes in their words, with whatever names somebody taken out by the database.
    expect(heard).toContain('"confirmado_pelo_cliente": true');
    expect(heard).toContain(
      "1. [nome] chegou ao aeroporto às 6h. 2. O voo atrasou e [nome] ligou do [telefone]. 3. Escreveu de [e-mail] e não teve resposta. 4. [nome] esperou com a filha, e a Testemunha viu.",
    );
    // The model of the firm goes the same way: what is written as an identifier of somebody is taken out of it.
    expect(heard).toContain("Modelo feito a partir do caso de Fulano Exemplo, CPF [CPF], contato [telefone].");
    // Who the person is comes from the marks, written in by the database: the model is told none of it.
    for (const personal of [
      "Maria",
      "MARIA",
      "12345678909",
      "123.456.789-09",
      "Rua das Flores",
      "professora",
      "74000000",
      "99999-0000",
      "exemplo.invalid",
      "Mária",
      "111.444.777-35",
      "3333-4444",
    ]) {
      expect(heard, personal).not.toContain(personal);
    }

    const draft = await draftOf(draftId);
    expect([draft.status, draft.version, draft.work, draft.work_claimed_at]).toEqual(["proposed", 1, "check", null]);
    // The first version is the run's own answer, with the line endings of the database.
    expect(await bodyOf(draftId, 1)).toBe(FIRST_TEXT);
    const waiting = await sql.unsafe(
      `select a.status, a.task, r.status as run_status, r.subject_id from public.approvals a
       join public.ai_runs r on r.id = a.run_id where a.run_id = $1`,
      [draft.run_id],
    );
    expect(waiting).toEqual([
      { status: "pending", task: "caso.peca.minuta", run_status: "succeeded", subject_id: draftId },
    ]);

    // The next work reads what the text cites.
    expect(await draftNext(backend() as never, draftId)).toBe("checked");
    expect(await citedBy(draftId, 1)).toEqual(["lei::8078#14", "sumula:STJ:999"]);
    const read = await draftOf(draftId);
    expect([read.checked_version, read.work]).toEqual([1, null]);
    expect(await draftNext(backend() as never, draftId)).toBe("none");
  });

  it("refuses the approval while a source is outside the library, and approves a piece nowhere but on its case", async () => {
    const { claimCaseDrafts, draftNext, workClaimedDraft } = await import("@/lib/cases/drafts-work");
    const run = (await draftOf(draftId)).run_id;
    const approval = String((await sql.unsafe(`select id from public.approvals where run_id = $1`, [run]))[0].id);

    expect(await approve(asAna(), draftId)).toMatchObject({ ok: false, code: "citations_not_verified" });
    // The queue approves no piece, as it came or corrected there: a piece is read on its case, with what it
    // cites beside it and as its document will say it.
    for (const corrected of [null, { texto: CORRECTED, pendencias: [], observacoes: [] }]) {
      const inQueue = await asAna().rpc("decide_approval", {
        target_approval: approval,
        target_decision: "approved",
        target_final_output: corrected,
        target_note: null,
      });
      expect(inQueue.error?.message).toContain("approve_on_case");
    }
    expect(
      await count(`select count(*)::int as n from public.approvals where id = $1 and status = 'pending'`, [approval]),
    ).toBe(1);

    // Anybody of the firm sees how the piece reads with the facts written in, and why it cannot be approved.
    const preview = await call(asBia(), "preview_case_draft", { target_draft: draftId });
    expect(preview.blocker).toBe("citations_not_verified");
    expect(String(preview.text)).toContain("MARIA TESTE");
    expect(String(preview.text)).not.toContain("[[");
    expect(preview.version).toBe(1);
    expect(String(preview.hash)).toMatch(/^[0-9a-f]{32}$/);
    expect(preview.unwritable).toEqual([]);
    // What the screens show of each source is what the gate reads: each once, the ones it refuses first.
    const { sourceOfRow } = await import("@/lib/cases/drafts");
    const shown = await asBia().rpc("case_draft_sources", { target_draft: draftId });
    expect(((shown.data ?? []) as Row[]).map((row) => sourceOfRow(row))).toEqual([
      {
        key: "sumula:STJ:999",
        kind: "sumula",
        label: "Súmula 999 do STJ",
        raw: "Súmula 999 do STJ",
        times: 1,
        covered: false,
        gap: null,
      },
      {
        key: "lei::8078#14",
        kind: "lei",
        label: "art. 14 da Lei nº 8.078",
        raw: "art. 14 do CDC",
        times: 1,
        covered: true,
        gap: null,
      },
    ]);
    // Nothing of it for who is of another firm.
    expect((await asRui().rpc("case_draft_sources", { target_draft: draftId })).data).toEqual([]);

    // Who corrects it is who signs.
    expect(await save(asBia(), draftId, CORRECTED)).toMatchObject({ ok: false, code: "not_allowed" });
    expect(await save(asAna(), draftId, CORRECTED)).toMatchObject({ code: "saved", version: 2 });
    // A text written on a version that is no longer the latest is refused: nobody's version is written over unseen.
    expect(
      await call(asAna(), "save_draft_version", {
        target_draft: draftId,
        target_body: `${CORRECTED}\n\nEscrito sobre a versão 1.`,
        target_base: 1,
      }),
    ).toMatchObject({ ok: false, code: "draft_changed", version: 2 });
    // Until the new version is read, the old reading says nothing of it.
    expect(await approve(asAna(), draftId)).toMatchObject({ ok: false, code: "citations_not_checked" });
    expect(await draftNext(backend() as never, draftId)).toBe("checked");
    expect(await citedBy(draftId, 2)).toEqual(["lei::8078#14"]);

    // What a lawyer read is what they approve: a preview of a version that is no longer the latest approves nothing.
    const read = await call(asAna(), "preview_case_draft", { target_draft: draftId });
    expect([read.version, read.blocker]).toEqual([2, null]);
    // A lawyer who saves again while a worker holds the text: the worker's claim is over, and the latest version is read.
    const third = `${CORRECTED}\n\nRequer a inversão do ônus da prova.`;
    expect(await save(asAna(), draftId, third)).toMatchObject({ version: 3 });
    expect(
      await call(asAna(), "approve_case_draft", {
        target_draft: draftId,
        target_version: read.version,
        target_hash: read.hash,
      }),
    ).toMatchObject({ ok: false, code: "draft_changed" });
    const held = (await claimCaseDrafts(backend() as never, 1, draftId))[0];
    expect(held).toBeTruthy();
    const fourth = `${third}\n\nRequer a citação da ré.`;
    expect(await save(asAna(), draftId, fourth)).toMatchObject({ version: 4 });
    expect(await workClaimedDraft(backend() as never, held)).toBe("not_held");
    expect(await draftNext(backend() as never, draftId)).toBe("checked");
    const draft = await draftOf(draftId);
    expect([draft.version, draft.checked_version, draft.work]).toEqual([4, 4, null]);
    expect(await citedBy(draftId, 4)).toEqual(["lei::8078#14"]);
  });

  it("approves with the second factor, writes the facts in, and makes the approved text the petition of its case", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    const { measureFile } = await import("@flyee/documents/measure");

    const read = await call(asAna("aal1"), "preview_case_draft", { target_draft: draftId });
    expect([read.version, read.blocker]).toEqual([4, null]);
    const weak = await asAna("aal1").rpc("approve_case_draft", {
      target_draft: draftId,
      target_version: read.version,
      target_hash: read.hash,
    });
    expect(weak.error?.message).toContain("second_factor_required");
    expect(await approve(asBia(), draftId)).toMatchObject({ code: "not_allowed" });
    expect(await approve(asRui(), draftId)).toMatchObject({ code: "draft_not_found" });
    expect(await call(asRui(), "preview_case_draft", { target_draft: draftId })).toMatchObject({
      code: "draft_not_found",
    });
    // The right version with the mark of another text, or with none, approves nothing.
    for (const mark of ["0".repeat(32), null]) {
      expect(
        await call(asAna(), "approve_case_draft", { target_draft: draftId, target_version: 4, target_hash: mark }),
      ).toMatchObject({ ok: false, code: "draft_changed" });
    }
    expect((await draftOf(draftId)).status).toBe("proposed");

    expect(await approve(asAna(), draftId)).toMatchObject({ ok: true, code: "approved" });
    // The text kept as approved is the very text the preview showed.
    expect(String((await draftOf(draftId)).approved_body)).toBe(String(read.text));
    const approved = await draftOf(draftId);
    expect([approved.status, approved.work, approved.approved_version, approved.approved_by]).toEqual([
      "approved",
      "issue",
      4,
      ANA,
    ]);
    const text = String(approved.approved_body);
    for (const fact of [
      "MARIA TESTE",
      "CPF nº 123.456.789-09",
      "Rua das Flores",
      "Companhia Aérea Exemplo S.A.",
      "11.222.333/0001-81",
      "R$ 10.000,00",
      "OAB/GO 12121",
      "Comarca de Goiânia",
      "Requer a citação da ré.",
    ]) {
      expect(text, fact).toContain(fact);
    }
    expect(text).not.toContain("[[");
    expect(text).not.toMatch(/completar/i);
    // The AI's answer left the queue as the corrected text a lawyer approved: what the measure of the task counts.
    const decided = await sql.unsafe(
      `select status, decided_by, final_output ->> 'texto' as texto from public.approvals where run_id = $1`,
      [approved.run_id],
    );
    expect(decided).toEqual([{ status: "approved", decided_by: ANA, texto: await bodyOf(draftId, 4) }]);

    // The storage does not answer: nothing is left behind, and the work is tried again after a wait.
    failUploadIn = 1;
    expect(await draftNext(backend() as never, draftId)).toBe("retry");
    expect(await petitionFiles()).toEqual([]);
    expect(bucket.size).toBe(0);
    const waiting = await draftOf(draftId);
    expect([waiting.status, waiting.work, waiting.work_error]).toEqual(["approved", "issue", "store_unavailable"]);
    expect(waiting.work_after).not.toBeNull();
    expect(await draftNext(backend() as never, draftId)).toBe("none");

    // An approval whose document was not made is taken back by who signs, and the text is a text to correct again.
    expect(await call(asBia(), "reopen_case_draft", { target_draft: draftId })).toMatchObject({ code: "not_allowed" });
    expect(await call(asAna(), "reopen_case_draft", { target_draft: draftId })).toMatchObject({ code: "reopened" });
    const reopened = await draftOf(draftId);
    expect([reopened.status, reopened.work, reopened.approved_body, reopened.version]).toEqual([
      "proposed",
      null,
      null,
      4,
    ]);
    expect(await draftNext(backend() as never, draftId)).toBe("none");
    expect(await approve(asAna(), draftId)).toMatchObject({ ok: true, code: "approved" });

    // The work owed by what a person just did is done before they are answered: the document is made at once.
    const { settleDraftWork } = await import("@/lib/cases/drafts-work");
    await settleDraftWork(draftId);
    const issued = await draftOf(draftId);
    expect([issued.status, issued.work]).toEqual(["issued", null]);
    const files = await petitionFiles();
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("stored");
    expect(String(files[0].name)).toMatch(/^Petição inicial, caso \d+, juizado especial\.pdf$/);
    const document = await sql.unsafe(
      `select id, kind, status, source, decided_by, file_id from public.case_documents where case_id = $1`,
      [caseId],
    );
    expect(document).toEqual([
      {
        id: issued.document_id,
        kind: "petition",
        status: "accepted",
        source: "firm",
        decided_by: ANA,
        file_id: files[0].id,
      },
    ]);

    // The PDF is the firm's own: what the database kept is the hash of the very bytes, and nothing in the file names the platform.
    const bytes = bucket.get(String(files[0].storage_path));
    expect(bytes).toBeTruthy();
    expect((await measureFile(bytes as Uint8Array)).sha256).toBe(files[0].sha256);
    const pdf = await PDFDocument.load(bytes as Uint8Array, { updateMetadata: false });
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getProducer()).toBe("Souza Advogados");
    expect(pdf.getAuthor()).toBe("Souza Advogados");
    expect(pdf.getTitle()).toMatch(/^Petição inicial, caso \d+, juizado especial$/);

    const timeline = (
      await sql.unsafe(
        `select kind from public.case_events where case_id = $1 and kind like 'draft_%' order by "at", id`,
        [caseId],
      )
    ).map((row) => row.kind);
    expect(timeline).toEqual([
      // The first request was replaced before it had a text, and the model started from was given up.
      "draft_requested",
      "draft_requested",
      "draft_cancelled",
      "draft_requested",
      "draft_proposed",
      "draft_edited",
      "draft_edited",
      "draft_edited",
      "draft_approved",
      "draft_reopened",
      "draft_approved",
      "draft_issued",
    ]);
    // An issued piece is nobody's to reopen, and its approval stays as it was given.
    expect(await call(asAna(), "reopen_case_draft", { target_draft: draftId })).toMatchObject({ code: "not_editable" });
  });

  it("measures how alike a piece is to the firm's pieces of other cases, as the reader of a piece measures it", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    // The model itself as the start, for a lawyer to write on: nothing of the AI waits for anybody.
    const asked = await call(asAna(), "request_case_draft", {
      target_proceeding: otherProceedingId,
      target_template: templateId,
      target_mode: "blank",
    });
    expect(asked.code).toBe("requested");
    const blank = String(asked.draft_id);
    expect(model.heard).toHaveLength(1);
    expect(await draftNext(backend() as never, blank)).toBe("checked");
    const draft = await draftOf(blank);
    expect([draft.status, draft.version, draft.checked_version, draft.run_id]).toEqual(["proposed", 1, 1, null]);

    const mine = signature(MODEL);
    const theirs = signature(await bodyOf(draftId, 4));
    const percent = Math.round(similarity(mine, theirs) * 100);
    // Two pieces of the same model are alike: the screen says so, and decides nothing.
    expect(percent).toBeGreaterThan(30);
    expect(draft.alike).toEqual([{ draft: draftId, case: caseId, percent }]);
    // The piece of the other case is not measured against itself, and the first one was measured before this one existed.
    expect((await draftOf(draftId)).alike).toEqual([]);
  });

  it("keeps the petition when the database's answer gets lost after it made the file the document", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    const blank = String(
      (
        await sql.unsafe(`select id from public.case_drafts where case_id = $1 and status = 'proposed'`, [otherCaseId])
      )[0].id,
    );
    // The model cites a source nobody verified: a lawyer takes it out, and approves.
    expect(await approve(asAna(), blank)).toMatchObject({ code: "citations_not_verified" });
    const body = MODEL.replace(
      "Descreva aqui o que aconteceu com o voo, o que a companhia informou ao passageiro e a assistência que deixou de prestar.",
      "O voo foi cancelado na véspera e a companhia só ofereceu reacomodação para dois dias depois.",
    ).replace(", e a Súmula 999 do STJ trata do dano moral que decorre do atraso.", ".");
    // A character the document cannot write keeps the piece from being approved, and the preview names it.
    const arrow = String.fromCodePoint(0x2192);
    expect(await save(asAna(), blank, `${body}\n\nAtraso ${arrow} dano.`)).toMatchObject({ code: "saved" });
    expect(await draftNext(backend() as never, blank)).toBe("checked");
    const odd = await call(asAna(), "preview_case_draft", { target_draft: blank });
    expect([odd.blocker, odd.unwritable]).toEqual(["unwritable_characters", [arrow]]);
    expect(await approve(asAna(), blank)).toMatchObject({ ok: false, code: "unwritable_characters" });
    expect(await save(asAna(), blank, body)).toMatchObject({ code: "saved" });
    expect(await draftNext(backend() as never, blank)).toBe("checked");
    expect(await approve(asAna(), blank)).toMatchObject({ code: "approved" });

    const before = bucket.size;
    await expect(draftNext(backendThatLosesTheAnswer() as never, blank)).rejects.toThrow(/record_draft_work failed/);

    // The worker could not know, and took nothing back: the piece is issued, its document is in the case and its bytes are in the bucket.
    const issued = await draftOf(blank);
    expect([issued.status, issued.work]).toEqual(["issued", null]);
    const kept = await sql.unsafe(
      `select f.status, f.storage_path from public.case_documents d join public.files f on f.id = d.file_id
       where d.id = $1 and d.case_id = $2 and d.kind = 'petition'`,
      [issued.document_id, otherCaseId],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe("stored");
    expect(bucket.size).toBe(before + 1);
    expect(bucket.has(String(kept[0].storage_path))).toBe(true);
    // Nothing more is owed, and the database would not forget the file whoever asked.
    expect(await draftNext(backend() as never, blank)).toBe("none");
    const forgotten = await call(backend(), "discard_file", {
      target_file: (
        await sql.unsafe(`select file_id from public.case_documents where id = $1`, [issued.document_id])
      )[0].file_id,
    });
    expect(forgotten).toMatchObject({ ok: false, code: "in_use" });
  });

  it("tries a passing failure of the model again, and leaves a final one for a person to put back", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    // The lawsuit of the first case has its petition: asking again starts another draft, and the one issued stays.
    const asked = await call(asAna(), "request_case_draft", {
      target_proceeding: proceedingId,
      target_template: templateId,
      target_mode: "ai",
    });
    expect(asked.code).toBe("requested");
    const second = String(asked.draft_id);
    expect((await draftOf(draftId)).status).toBe("issued");
    const heardBefore = model.heard.length;

    // The provider is overloaded: tried again after a wait, and nothing is taken in the meantime.
    model.failure = Object.assign(new Error("overloaded"), { status: 529 });
    expect(await draftNext(backend() as never, second)).toBe("retry");
    const waiting = await draftOf(second);
    expect([waiting.status, waiting.work, waiting.work_error]).toEqual([
      "generating",
      "generate",
      "provider_unavailable",
    ]);
    expect(waiting.work_after).not.toBeNull();
    expect(await draftNext(backend() as never, second)).toBe("none");

    // The provider refuses the request itself: trying again would change nothing.
    await waitIsOver(second);
    model.failure = Object.assign(new Error("bad request"), { status: 400 });
    expect(await draftNext(backend() as never, second)).toBe("failed");
    const failed = await draftOf(second);
    expect([failed.status, failed.work, failed.work_error]).toEqual(["failed", null, "provider_rejected"]);
    expect(await draftNext(backend() as never, second)).toBe("none");
    expect(
      await count(`select count(*)::int as n from public.case_events where case_id = $1 and kind = 'draft_failed'`, [
        caseId,
      ]),
    ).toBe(1);

    // A person puts it back, and the model answers something that is no piece.
    expect(await call(asBia(), "resume_case_draft_work", { target_draft: second })).toMatchObject({
      code: "resumed",
      work: "generate",
    });
    model.text = "Não sei.";
    expect(await draftNext(backend() as never, second)).toBe("failed");
    expect((await draftOf(second)).work_error).toBe("invalid_answer");
    // An answer that is no piece never waits for a lawyer as one.
    expect(
      await count(
        `select count(*)::int as n from public.approvals a join public.ai_runs r on r.id = a.run_id
         where r.subject_type = 'case_draft' and r.subject_id = $1 and a.status = 'pending'`,
        [second],
      ),
    ).toBe(0);

    // Put back once more, the model writes the piece: each try of the model was a run of its own. It writes
    // its lines with the endings of another system, which the database keeps as plain ones.
    expect(await call(asAna(), "resume_case_draft_work", { target_draft: second })).toMatchObject({ code: "resumed" });
    model.text = CORRECTED.replace(/\n/g, "\r\n");
    model.notes = [];
    expect(await draftNext(backend() as never, second)).toBe("generated");
    expect(await draftNext(backend() as never, second)).toBe("checked");
    expect(model.heard.length - heardBefore).toBe(4);
    const runs = await sql.unsafe(
      `select status, error_code from public.ai_runs where subject_type = 'case_draft' and subject_id = $1 order by started_at, id`,
      [second],
    );
    expect(runs.map((run) => [run.status, run.error_code])).toEqual([
      ["failed", "provider_unavailable"],
      ["failed", "provider_rejected"],
      ["succeeded", null],
      ["succeeded", null],
    ]);
    const ready = await draftOf(second);
    expect([ready.status, ready.version, ready.checked_version, ready.work]).toEqual(["proposed", 1, 1, null]);
    expect(await bodyOf(second, 1)).toBe(CORRECTED);
    // Every source it cites is in the library: a lawyer may approve it as it came.
    expect(await approve(asAna(), second)).toMatchObject({ code: "approved" });
    // Approved as the AI wrote it: its answer leaves the queue unedited, whatever its line endings were. It is
    // what the measure of the task counts before the task earns any autonomy.
    const decided = await sql.unsafe(
      `select a.status, a.edited from public.approvals a join public.case_drafts d on d.run_id = a.run_id where d.id = $1`,
      [second],
    );
    expect(decided).toEqual([{ status: "approved", edited: false }]);
    expect(await draftNext(backend() as never, second)).toBe("issued");
    expect(await petitionFiles()).toHaveLength(3);
  });

  it("sends a text back to the AI with what to change, handing it nothing that names a person, and gives the words back", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    const third = await openCase(
      { full_name: "Lia Prado", cpf: "52998224725", birth_date: "1992-07-09" },
      "Rua do Lago",
    );
    const asked = await call(asAna(), "request_case_draft", {
      target_proceeding: third.proceedingId,
      target_template: templateId,
      target_mode: "blank",
    });
    expect(asked.code).toBe("requested");
    const piece = String(asked.draft_id);
    expect(await draftNext(backend() as never, piece)).toBe("checked");

    // A lawyer writes on it, with what identifies the client typed into the text.
    const WRITTEN = CORRECTED.replace(
      "O voo contratado chegou ao destino",
      "Lia Prado, CPF 529.982.247-25, avisou a companhia pelo telefone (62) 98888-7777. O voo contratado chegou ao destino",
    );
    expect(WRITTEN).not.toBe(CORRECTED);
    expect(await save(asAna(), piece, WRITTEN)).toMatchObject({ code: "saved", version: 2 });
    expect(await draftNext(backend() as never, piece)).toBe("checked");

    // Who signs sends it back with what to change; who only attends cannot.
    const note = "Diga que Lia Prado ficou sem hospedagem e tire o telefone dela.";
    const request = { target_draft: piece, target_version: 2, target_note: note };
    expect(await call(asBia(), "return_case_draft", request)).toMatchObject({ ok: false, code: "not_allowed" });
    expect(await call(asAna(), "return_case_draft", request)).toMatchObject({ ok: true, code: "returned" });
    const owed = await draftOf(piece);
    expect([owed.status, owed.version, owed.work]).toEqual(["proposed", 2, "revise"]);
    // While the AI rewrites it, the text is nobody's to edit.
    expect(await save(asAna(), piece, CORRECTED)).toMatchObject({ ok: false, code: "revision_in_course" });

    // The model keeps the marks it was shown and changes what it was asked to.
    const heardBefore = model.heard.length;
    model.text = WRITTEN.replace(
      "Lia Prado, CPF 529.982.247-25, avisou a companhia pelo telefone (62) 98888-7777.",
      "[nome 1], CPF [CPF 1], avisou a companhia e ficou sem hospedagem.",
    ).replace("CPF 111.444.777-35, contato (62) 3333-4444", "CPF [CPF 2], contato [telefone 2]");
    model.notes = ["Acrescentei que [nome 1] ficou sem hospedagem e tirei o telefone."];
    expect(await draftNext(backend() as never, piece)).toBe("revised");

    expect(model.heard.length - heardBefore).toBe(1);
    const heard = model.heard[model.heard.length - 1];
    expect(heard.split("\n")[0]).toBe("PEDIDO: ajuste de uma peça já escrita.");
    // The text and the request, with the same person under the same mark in both.
    expect(heard).toContain("[nome 1], CPF [CPF 1], avisou a companhia pelo telefone [telefone 1].");
    expect(heard).toContain("Diga que [nome 1] ficou sem hospedagem e tire o telefone dela.");
    expect(heard).toContain("CPF [CPF 2], contato [telefone 2].");
    expect(heard).toContain('"ocorrencia": "delay"');
    expect(heard).toContain('"como_citar": "art. 14 da Lei nº 8.078"');
    for (const personal of [
      "Lia",
      "Prado",
      "529.982.247-25",
      "52998224725",
      "98888-7777",
      "111.444.777-35",
      "3333-4444",
      "Rua do Lago",
    ]) {
      expect(heard, personal).not.toContain(personal);
    }

    // What the AI wrote is the next version, with every word back in its place; the one before stays as it was.
    const revised = await draftOf(piece);
    expect([revised.status, revised.version, revised.work]).toEqual(["proposed", 3, "check"]);
    expect(await bodyOf(piece, 3)).toBe(
      WRITTEN.replace(
        "avisou a companhia pelo telefone (62) 98888-7777.",
        "avisou a companhia e ficou sem hospedagem.",
      ),
    );
    expect(await bodyOf(piece, 2)).toBe(WRITTEN);
    const written = (
      await sql.unsafe(
        `select author, based_on, note, asked_by, restored from public.case_draft_versions where draft_id = $1 and version = 3`,
        [piece],
      )
    )[0];
    expect(written).toEqual({ author: "ai", based_on: 2, note, asked_by: ANA, restored: false });
    // What the AI said it changed is kept beside the version with the same words back, for the screens to show;
    // before it, what identifies a person and the answer has fewer times than the text had (here, as asked).
    expect(
      (await sql.unsafe(`select notes from public.case_draft_versions where draft_id = $1 and version = 3`, [piece]))[0]
        .notes,
    ).toEqual([
      'Conferir: "(62) 98888-7777" aparecia 1 vez no texto anterior e não aparece neste.',
      "Acrescentei que Lia Prado ficou sem hospedagem e tirei o telefone.",
    ]);
    // One name under one mark: the model was told of no marks that hold the same name.
    expect(heard).not.toContain("MARCAS DO MESMO NOME");
    // Nothing of the request stays on the draft once it is answered.
    expect(
      (await sql.unsafe(`select revision_note, revision_keys from public.case_drafts where id = $1`, [piece]))[0],
    ).toEqual({ revision_note: null, revision_keys: null });

    // It waits for a lawyer as a first text does, and approved as the AI wrote it, it counts as such.
    expect(await draftNext(backend() as never, piece)).toBe("checked");
    expect(await approve(asAna(), piece)).toMatchObject({ code: "approved" });
    const decided = await sql.unsafe(
      `select a.status, a.edited from public.approvals a join public.case_drafts d on d.run_id = a.run_id where d.id = $1`,
      [piece],
    );
    expect(decided).toEqual([{ status: "approved", edited: false }]);
    expect(await draftNext(backend() as never, piece)).toBe("issued");
    const issued = await draftOf(piece);
    expect(issued.status).toBe("issued");
    expect(String(issued.approved_body)).toContain(
      "Lia Prado, CPF 529.982.247-25, avisou a companhia e ficou sem hospedagem.",
    );
  });

  it("has ONE approve the AI's first text where the firm lets it, once read and let by the gate, and issue it", async () => {
    const { draftNext } = await import("@/lib/cases/drafts-work");
    // A partner lets ONE approve the firm's pieces, with the second factor.
    expect(
      await call(asAna("aal1"), "set_firm_autonomy", {
        target_org: FIRM,
        target_decision: "piece_text",
        target_mode: "auto",
      })
        .then(() => "allowed")
        .catch((error: Error) => error.message),
    ).toContain("second_factor_required");
    expect(
      await call(asAna(), "set_firm_autonomy", {
        target_org: FIRM,
        target_decision: "piece_text",
        target_mode: "auto",
      }),
    ).toMatchObject({ ok: true, code: "saved" });

    // A model with nothing to cite, and a text the AI writes from it as it is: nothing the gate refuses.
    const plain = [
      "EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]",
      "[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização por danos morais em face de [[RE]].",
      "DOS FATOS",
      "O voo contratado chegou ao destino com mais de quatro horas de atraso, sem assistência.",
      "DOS PEDIDOS",
      "Pede-se a condenação da ré ao pagamento de indenização, assim: [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].",
      "[[NOMES_DAS_PARTES]]",
    ].join("\n\n");
    const model_ = await call(asAna(), "save_draft_template", {
      target_org: FIRM,
      target_template: null,
      fields: { name: "Petição simples", proceeding_kind: "juizado", body: plain },
    });
    const opened = await openCase(
      { full_name: "Rita Teste", cpf: "52998224725", birth_date: "1979-06-06" },
      "Rua das Flores",
    );
    const asked = await call(asAna(), "request_case_draft", {
      target_proceeding: opened.proceedingId,
      target_template: model_.template_id,
      target_mode: "ai",
    });
    const id = String(asked.draft_id);
    model.text = plain;
    expect(await draftNext(backend() as never, id)).toBe("generated");
    // Read, and approved by ONE in the same work: its document is owed next, and made.
    expect(await draftNext(backend() as never, id)).toBe("checked");
    const approved = await draftOf(id);
    expect([approved.status, approved.work, approved.approved_version, approved.approved_by]).toEqual([
      "approved",
      "issue",
      1,
      null,
    ]);
    expect(await draftNext(backend() as never, id)).toBe("issued");
    expect((await draftOf(id)).status).toBe("issued");
    expect(
      await count(
        `select count(*) as n from public.case_events where case_id = $1 and kind = 'draft_approved' and actor_type = 'system'
           and (data ->> 'auto')::boolean`,
        [opened.caseId],
      ),
    ).toBe(1);
    // The answer that waited in the queue was decided with it, as the AI wrote it.
    expect(
      await count(
        `select count(*) as n from public.approvals a join public.case_drafts d on d.run_id = a.run_id
          where d.id = $1 and a.status = 'approved' and not a.edited and a.decided_by is null`,
        [id],
      ),
    ).toBe(1);

    // A text a lawyer edited before it was read is the lawyer's to approve: ONE leaves it waiting.
    const second = await openCase(
      { full_name: "Rosa Teste", cpf: "11144477735", birth_date: "1981-03-03" },
      "Rua dos Ipês",
    );
    const again = await call(asAna(), "request_case_draft", {
      target_proceeding: second.proceedingId,
      target_template: model_.template_id,
      target_mode: "ai",
    });
    const edited = String(again.draft_id);
    expect(await draftNext(backend() as never, edited)).toBe("generated");
    expect((await save(asAna(), edited, `${plain}\n\nRequer a juntada dos documentos.`)).code).toBe("saved");
    // The reading of version 1 was owed when the lawyer saved: the latest is read, and nothing is approved.
    for (let turn = 0; turn < 3; turn += 1) {
      if ((await draftNext(backend() as never, edited)) === "none") break;
    }
    const waiting = await draftOf(edited);
    expect([waiting.status, waiting.version, waiting.checked_version, waiting.approved_by]).toEqual([
      "proposed",
      2,
      2,
      null,
    ]);
    // A first text the gate refuses (it cites a source outside the library) waits for a lawyer, and ONE does not try
    // it again later, even once the source is registered.
    const third = await openCase({ full_name: "Lara Teste", birth_date: "1983-02-02" }, "Rua das Palmas");
    const blocked = String(
      (
        await call(asAna(), "request_case_draft", {
          target_proceeding: third.proceedingId,
          target_template: templateId,
          target_mode: "ai",
        })
      ).draft_id,
    );
    model.text = FIRST_TEXT;
    expect(await draftNext(backend() as never, blocked)).toBe("generated");
    expect(await draftNext(backend() as never, blocked)).toBe("checked");
    const left = await draftOf(blocked);
    expect([left.status, left.approved_by]).toEqual(["proposed", null]);
    expect(
      await count(`select count(*) as n from public.case_drafts where id = $1 and auto_approval_owed`, [blocked]),
    ).toBe(0);
    // Nor does the sweep approve either of them.
    const { approveWaitingDrafts } = await import("@/lib/cases/drafts-work");
    expect(await approveWaitingDrafts(backend() as never)).toBe(0);

    // An approval owed when the firm takes the piece off ONE's hands is spent: going back to ONE approves nothing
    // read before.
    await sql.unsafe(`update public.case_drafts set auto_approval_owed = true where id = $1`, [blocked]);
    await sql.unsafe(
      `update public.firm_autonomy set mode = 'approval' where org_id = $1 and decision = 'piece_text'`,
      [FIRM],
    );
    expect(await call(backend(), "approve_case_draft_unattended", { target_draft: blocked })).toMatchObject({
      ok: false,
      code: "not_auto",
    });
    await sql.unsafe(`update public.firm_autonomy set mode = 'auto' where org_id = $1 and decision = 'piece_text'`, [
      FIRM,
    ]);
    expect(await approveWaitingDrafts(backend() as never)).toBe(0);
    expect((await draftOf(blocked)).status).toBe("proposed");
  });

  it("calls unwritable, in the database, the very characters the document cannot write", async () => {
    const unwritable = async (text: string) =>
      ((await sql.unsafe(`select public.unwritable_characters($1) as found`, [text]))[0].found as string[]) ?? [];
    // Every character the document writes in a plain form is one the database lets through...
    for (const code of PLAIN_CODES) {
      const text = `a${String.fromCodePoint(code)}b`;
      expect(await unwritable(text), code.toString(16)).toEqual([]);
      expect(unwritableCharacters(text), code.toString(16)).toEqual([]);
    }
    // ...and what one of them refuses, the other refuses: the gate and the document read the same text.
    const samples = [
      "Ação, coração, § 2º, à vista: nada a dizer.",
      `Atraso ${String.fromCodePoint(0x2265)} 4 horas ${String.fromCodePoint(0x2192)} dano`,
      `Dvo${String.fromCodePoint(0x0159)}ák e ${String.fromCodePoint(0x4e2d)}${String.fromCodePoint(0x6587)}`,
      `rosto ${String.fromCodePoint(0x1f600)} e aspas ${String.fromCodePoint(0x0093)}de outro sistema${String.fromCodePoint(0x0094)}`,
      // An accent written apart from its letter is that letter, for both.
      `ae${String.fromCodePoint(0x0301)}reo`,
      `linha um${String.fromCodePoint(0x000d)}${String.fromCodePoint(0x000a)}linha dois${String.fromCodePoint(0x0009)}fim`,
      `sino ${String.fromCodePoint(0x0007)} e apagar ${String.fromCodePoint(0x007f)}`,
    ];
    for (const text of samples) {
      expect((await unwritable(text)).sort(), text).toEqual(unwritableCharacters(text).sort());
    }
  });
});
