// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * ONE carrying a case on by itself, with the app's own worker against a real
 * database (migration 0039): a case that has what its lawsuits need has them
 * created with the rules the case screen runs, signed by the firm's signer
 * at the bar in that state; the first text of the piece is asked of the AI
 * from the firm's default model, read, approved by ONE and issued as the
 * petition; and the filing package is asked for with the papers that go to
 * court. A case that still lacks something says what ONE waits for, and a
 * firm where a person creates the lawsuits is left alone.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, the bucket (in memory) and the model (the fake provider of
 * `@flyee/ai`, told here what to write).
 *
 * Every person, firm, company, CPF and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what to write. */
const model = vi.hoisted(() => ({ text: "" }));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, () => ({ texto: model.text, observacoes: [] }));
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;

/** The bucket, in memory: what the worker writes through the storage API. */
const bucket = new Map<string, Uint8Array>();
const storage = {
  from: () => ({
    async upload(storagePath: string, bytes: Uint8Array) {
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

const backend = () => ({ ...clientAs("service_role", { role: "service_role" }), storage });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae900000-0000-4000-8000-000000000001";
const RUI = "ae900000-0000-4000-8000-000000000004";
const FIRM = "be900000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "be900000-0000-4000-8000-00000000000b";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

/** The firm's default model for the small-claims court: the marks the platform fills, and no source to verify. */
const MODEL = [
  "EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]",
  "[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização por danos morais em face de [[RE]].",
  "DOS FATOS",
  "Descreva aqui o que aconteceu com o voo.",
  "DOS PEDIDOS",
  "Pede-se a condenação da ré, assim: [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].",
  "Nestes termos, pede deferimento.",
  "[[NOMES_DAS_PARTES]]",
].join("\n\n");

describe.skipIf(!DB_URL)("ONE carrying a case on, from its lawsuits to its filing package", () => {
  const airline: { legal_name: unknown; cnpj: unknown } = { legal_name: null, cnpj: null };
  const confirmed: { value: unknown } = { value: null };

  /** A file the backend measured and kept, of the firm. */
  async function stored(org: string, name: string): Promise<string> {
    const reserved = await call(backend(), "reserve_file", {
      target_org: org,
      target_purpose: "upload",
      target_name: name,
      target_mime: "application/pdf",
      target_bytes: 4000,
    });
    const fileId = String(reserved.file_id);
    await call(backend(), "confirm_file", {
      target_file: fileId,
      target_sha256: "a".repeat(64),
      target_bytes: 4000,
      target_detected_mime: "application/pdf",
      target_pages: 1,
    });
    return fileId;
  }

  /** A document of the case, accepted by Ana. */
  async function accepted(
    who: string,
    org: string,
    caseId: string,
    kind: string,
    partyId: string | null,
  ): Promise<string> {
    const attached = await call(as(who), "attach_case_document", {
      target_case: caseId,
      target_file: await stored(org, `${kind}.pdf`),
      target_kind: kind,
      target_party: partyId,
    });
    const documentId = String(attached.document_id);
    const decided = await call(as(who), "decide_case_document", {
      target_document: documentId,
      target_decision: "accepted",
    });
    expect(decided.ok, `${kind} accepted`).toBe(true);
    return documentId;
  }

  /**
   * A case of a firm with one adult of Goiânia whose data is whole, a leg of the trip and, unless told
   * otherwise, what they ask and the papers the setting names (an identity, a proof of address, a ticket).
   */
  async function readyCase(
    who: string,
    org: string,
    cpf: string,
    options: { claim?: boolean; addressProof?: boolean } = {},
  ) {
    const opened = await call(as(who), "create_case", {
      target_org: org,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-09-20",
      target_client: { full_name: "Maria Teste", cpf, birth_date: "1985-04-02" },
    });
    const caseId = String(opened.case_id);
    const partyId = String(opened.party_id);
    const saved = await call(as(who), "save_case_person", {
      target_case: caseId,
      target_person: opened.person_id,
      target_fields: {
        nationality: "brasileira",
        marital_status: "casado",
        profession: "professora",
        postal_code: "74000000",
        street: "Rua das Flores",
        address_number: "10",
        district: "Centro",
        city: "Goiânia",
        uf: "GO",
      },
    });
    expect(saved.ok, "person").toBe(true);
    const leg = await call(as(who), "save_flight_segment", {
      target_case: caseId,
      target_segment: null,
      target_fields: { flight_number: "G3 1234", origin_iata: "GYN", destination_iata: "GRU", affected: true },
    });
    expect(leg.ok, "leg").toBe(true);
    if (options.claim !== false) {
      const asked = await call(as(who), "set_party_claim", {
        target_case: caseId,
        target_party: partyId,
        target_cents: 1000000,
      });
      expect(asked.ok, "claim").toBe(true);
    }
    const papers: Record<string, string> = {
      identity: await accepted(who, org, caseId, "identity", partyId),
      ticket: await accepted(who, org, caseId, "ticket", null),
    };
    if (options.addressProof !== false)
      papers.address_proof = await accepted(who, org, caseId, "address_proof", partyId);
    return { caseId, partyId, papers };
  }

  const advanceOf = async (caseId: string) =>
    (await sql.unsafe(`select waiting, after, claimed_at from public.case_advances where case_id = $1`, [caseId]))[0];

  /** What follows a piece or a package ONE asked for, done right here: the piece written and issued, the package noted. */
  const packagesAsked: string[] = [];
  async function carry(caseId: string) {
    const { advanceCases } = await import("@/lib/cases/advance-work");
    const { draftNext } = await import("@/lib/cases/drafts-work");
    return advanceCases(backend() as never, 1, caseId, {
      draft: async (draftId) => {
        for (let turn = 0; turn < 3; turn += 1) {
          const outcome = await draftNext(backend() as never, draftId);
          if (outcome !== "generated" && outcome !== "revised" && outcome !== "checked") break;
        }
      },
      package: async (packageId) => {
        packagesAsked.push(packageId);
      },
      // No client here is owed a link ONE can send: the firms of this file have no WhatsApp connected.
      message: async () => undefined,
    });
  }

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${RUI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@adiante.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${RUI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rui@adiante.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-adiante-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-adiante-app', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${RUI}', 'owner', 'socio');
      insert into public.oab_registrations (user_id, uf, number, kind) values
        ('${ANA}', 'GO', '19191', 'principal'), ('${RUI}', 'GO', '19194', 'principal');
      -- In the other firm a person creates the lawsuits.
      insert into public.firm_autonomy (org_id, decision, mode) values ('${OTHER_FIRM}', 'create_lawsuits', 'approval');
    `);
    // What the operator recorded of the airline and of the court's system: put back at the end.
    const company = (await sql.unsafe(`select legal_name, cnpj from public.airlines where iata = 'G3'`))[0];
    airline.legal_name = company?.legal_name ?? null;
    airline.cnpj = company?.cnpj ?? null;
    await sql.unsafe(
      `update public.airlines set legal_name = 'Companhia Aérea Exemplo S.A.', cnpj = '11222333000181' where iata = 'G3'`,
    );
    confirmed.value = (
      await sql.unsafe(
        `select confirmed from public.court_systems where court = 'TJGO' and proceeding_kind = 'juizado' and system = 'projudi'`,
      )
    )[0]?.confirmed;
    // As in production today: the platform has not confirmed the court's system yet.
    await sql.unsafe(
      `update public.court_systems set confirmed = false where court = 'TJGO' and proceeding_kind = 'juizado' and system = 'projudi'`,
    );
    // A partner names who signs what ONE prepares, and which model ONE writes from.
    const signer = await call(as(ANA), "set_firm_signer", { target_org: FIRM, target_user: ANA, target_signs: true });
    expect(signer.code).toBe("saved");
    const template = await call(as(ANA), "save_draft_template", {
      target_org: FIRM,
      target_template: null,
      fields: { name: "Atraso de voo", proceeding_kind: "juizado", is_default: true, body: MODEL },
    });
    expect(template.code).toBe("saved");
    model.text = MODEL.replace(
      "Descreva aqui o que aconteceu com o voo.",
      "O voo chegou ao destino com mais de quatro horas de atraso, sem assistência da companhia.",
    );
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    // What this file asked for (a package, pieces) is never left for another file's sweep to find: the files of
    // the round trip run one at a time, in an order of the runner's own.
    await sql?.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql?.unsafe(`delete from auth.users where id in ('${ANA}', '${RUI}')`);
    await sql?.unsafe(`update public.airlines set legal_name = $1, cnpj = $2 where iata = 'G3'`, [
      airline.legal_name,
      airline.cnpj,
    ]);
    await sql?.unsafe(
      `update public.court_systems set confirmed = $1 where court = 'TJGO' and proceeding_kind = 'juizado' and system = 'projudi'`,
      [confirmed.value ?? false],
    );
    await sql?.end({ timeout: 5 });
  });

  it("carries a case that has what it needs from its lawsuits to its filing package", async () => {
    const ready = await readyCase(ANA, FIRM, "12345678909");
    const contract = await accepted(ANA, FIRM, ready.caseId, "contract", ready.partyId);

    // The lawsuits, the piece asked, written, read, approved by ONE and issued.
    const first = await carry(ready.caseId);
    expect(first.created).toBe(1);
    const [lawsuit] = await sql.unsafe(
      `select p.id, p.kind, p.court, p.system, p.status, array(select pl.user_id::text from public.proceeding_lawyers pl where pl.proceeding_id = p.id) as lawyers
       from public.proceedings p where p.case_id = $1`,
      [ready.caseId],
    );
    // No system the platform confirmed: the lawsuit names none yet.
    expect(lawsuit).toMatchObject({ kind: "juizado", court: "TJGO", system: null, status: "planned", lawyers: [ANA] });
    const [stage] = await sql.unsafe(`select status from public.cases where id = $1`, [ready.caseId]);
    expect(stage.status).toBe("drafting");
    const [draft] = await sql.unsafe(
      `select status, requested_auto, requested_by, approved_auto, document_id from public.case_drafts where case_id = $1`,
      [ready.caseId],
    );
    expect(draft).toMatchObject({ status: "issued", requested_auto: true, requested_by: null, approved_auto: true });

    // The package waits for the court's system; once the platform confirms it, ONE names it and asks for the package,
    // with the papers that go to court and never the firm's contract.
    expect((await carry(ready.caseId)).waiting).toBe(1);
    expect((await advanceOf(ready.caseId)).waiting).toBe("system_unknown");
    await sql.unsafe(
      `update public.court_systems set confirmed = true where court = 'TJGO' and proceeding_kind = 'juizado' and system = 'projudi'`,
    );
    expect((await advanceOf(ready.caseId)).after).toBeNull();
    const second = await carry(ready.caseId);
    expect(second.acted).toBe(1);
    expect(packagesAsked).toHaveLength(1);
    const [named] = await sql.unsafe(`select system from public.proceedings where case_id = $1`, [ready.caseId]);
    expect(named.system).toBe("projudi");
    const [filing] = await sql.unsafe(
      `select status, requested_by, petition_document_id::text as petition, array(select unnest(document_ids)::text) as documents
       from public.filing_packages where id = $1`,
      [packagesAsked[0]],
    );
    expect(filing.status).toBe("requested");
    expect(filing.requested_by).toBeNull();
    expect(filing.petition).toBe(String(draft.document_id));
    expect([...(filing.documents as string[])].sort()).toEqual(
      [ready.papers.identity, ready.papers.ticket, ready.papers.address_proof].sort(),
    );
    expect(filing.documents).not.toContain(contract);

    // Nothing left for ONE: the case is not claimed again, and ONE waits for nothing.
    const third = await carry(ready.caseId);
    expect(Object.values(third).every((count) => count === 0)).toBe(true);
    expect((await advanceOf(ready.caseId)).waiting).toBeNull();

    // The timeline says it was ONE, as the screen reads it.
    const kinds = (
      await sql.unsafe(`select kind from public.case_events where case_id = $1 and actor_type = 'system' order by at`, [
        ready.caseId,
      ])
    ).map((row) => String(row.kind));
    expect(kinds).toEqual(
      expect.arrayContaining(["proceeding_saved", "status_changed", "draft_requested", "filing_package_requested"]),
    );
  });

  it("says what it waits for when a case still lacks something, and looks again once it is there", async () => {
    const lacking = await readyCase(ANA, FIRM, "52998224725", { addressProof: false });
    expect((await carry(lacking.caseId)).waiting).toBe(1);
    expect((await advanceOf(lacking.caseId)).waiting).toBe("case_incomplete");
    expect(
      Number(
        (await sql.unsafe(`select count(*) as n from public.proceedings where case_id = $1`, [lacking.caseId]))[0].n,
      ),
    ).toBe(0);

    const unasked = await readyCase(ANA, FIRM, "11144477735", { claim: false });
    await carry(unasked.caseId);
    expect((await advanceOf(unasked.caseId)).waiting).toBe("claims_missing");

    // The proof of address arrives and is accepted: the case is woken, and ONE goes on.
    await accepted(ANA, FIRM, lacking.caseId, "address_proof", lacking.partyId);
    expect((await advanceOf(lacking.caseId)).after).toBeNull();
    expect((await carry(lacking.caseId)).created).toBe(1);
  });

  it("leaves alone a firm where a person creates the lawsuits", async () => {
    const theirs = await readyCase(RUI, OTHER_FIRM, "12345678909");
    const outcome = await carry(theirs.caseId);
    expect(Object.values(outcome).every((count) => count === 0)).toBe(true);
    expect(
      Number(
        (await sql.unsafe(`select count(*) as n from public.proceedings where case_id = $1`, [theirs.caseId]))[0].n,
      ),
    ).toBe(0);
    expect((await advanceOf(theirs.caseId)).waiting).toBeNull();
  });
});
