// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * A family with a minor asks for free justice in the civil court (migration 0125), with the app's own code against a
 * real database: Rui and his son Pedro go to the civil court together; Rui says on his link that he asks for free
 * justice for both; once he finished, the worker issues one declaration of economic hardship for the father and the
 * son, a PDF of the firm's own sent to sign by gov.br beside the power of attorney; the filing waits for it, and the
 * case screen reads each answer.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. What stands
 * in is the transport, as the same database roles with the same claims, and the bucket (in memory).
 *
 * Every person, firm and number here is invented.
 */

vi.mock("server-only", () => ({}));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const bucket = new Map<string, Uint8Array>();
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae940000-0000-4000-8000-000000000001";
const FIRM = "be940000-0000-4000-8000-00000000000a";
const TOKEN = "token-do-rui-gratuita-0123456789abcdef";
const LAWSUIT = "ab940000-0000-4000-8000-000000000003";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });
const anon = () => clientAs("anon", { role: "anon" });

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

async function carry(caseId: string) {
  const { advanceCases, followSoon } = await import("@/lib/cases/advance-work");
  return advanceCases(backend() as never, 1, caseId, followSoon);
}

describe.skipIf(!DB_URL)("free justice for a father and his son", () => {
  let caseId = "";
  let rui = "";
  const parties: Record<string, string> = {};

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@gratuita-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-gratuita-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.oab_registrations (user_id, uf, number, kind) values ('${ANA}', 'GO', '94001', 'principal');
      insert into public.firm_signers (org_id, user_id, added_by) values ('${FIRM}', '${ANA}', '${ANA}');
    `);
    const opened = await as(ANA).rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-01-10",
      target_client: { full_name: "Rui Teste", birth_date: "1980-01-01", phone: "5500999990194" },
    });
    expect(opened.error).toBeNull();
    caseId = String((opened.data as Row).case_id);
    const [person] = await sql.unsafe(`select id as party, person_id from public.case_parties where case_id = $1`, [
      caseId,
    ]);
    rui = String(person.person_id);
    parties.rui = String(person.party);
    await sql.unsafe(
      `update public.people set cpf = '52998224725', nationality = 'brasileira', marital_status = 'casado',
         profession = 'Professor', street = 'Rua das Flores', address_number = '10', district = 'Centro',
         city = 'Goiânia', uf = 'GO', postal_code = '74000000' where id = $1`,
      [rui],
    );
    // Pedro, a minor Rui answers for, and the family's lawsuit planned in the civil court, which both accepted.
    const [pedro] = await sql.unsafe(
      `insert into public.people (org_id, full_name, birth_date, cpf) values ($1, 'Pedro Teste', '2018-05-05', '11144477735')
       returning id`,
      [FIRM],
    );
    const [son] = await sql.unsafe(
      `insert into public.case_parties (org_id, case_id, person_id, role, guardian_id)
       values ($1, $2, $3, 'claimant', $4) returning id`,
      [FIRM, caseId, pedro.id, parties.rui],
    );
    parties.pedro = String(son.id);
    await sql.unsafe(
      `insert into public.proceedings (id, org_id, case_id, kind, court, status) values ($1, $2, $3, 'comum', 'TJGO', 'planned')`,
      [LAWSUIT, FIRM, caseId],
    );
    await sql.unsafe(
      `update public.proceedings set system = 'projudi', system_approved_at = now(), system_approved_by = $2 where id = $1`,
      [LAWSUIT, ANA],
    );
    for (const party of [parties.rui, parties.pedro]) {
      await sql.unsafe(`insert into public.proceeding_parties (proceeding_id, party_id, org_id) values ($1, $2, $3)`, [
        LAWSUIT,
        party,
        FIRM,
      ]);
      await sql.unsafe(
        `insert into public.civil_court_answers (org_id, case_id, party_id, person_id, accepted, wording, version, source, note)
         values ($1, $2, $3, $4, true, repeat('Aceito que a ação seja proposta na vara cível. ', 2), 1, 'firm', 'Disse ao telefone hoje.')`,
        [FIRM, caseId, party, rui],
      );
    }
    await ok(
      await as(ANA).rpc("create_client_link", {
        target_case: caseId,
        target_person: rui,
        target_token_hash: createHash("sha256").update(TOKEN, "utf8").digest("hex"),
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("asks Rui for himself and for his son, and the filing waits for the answers", async () => {
    const { clientFreeJusticeOf } = await import("@/lib/cases/free-justice");
    const asked = await anon().rpc("client_link_free_justice", { target_token: TOKEN });
    expect(asked.error).toBeNull();
    const view = clientFreeJusticeOf(asked.data);
    expect(view?.items.map((item) => [item.name, item.minor, item.asks])).toEqual([
      ["Rui Teste", false, null],
      ["Pedro Teste", true, null],
    ]);
    const [blocked] = await sql.unsafe(`select public.filing_blocker($1) as code`, [LAWSUIT]);
    expect(blocked.code).toBe("free_justice_unanswered");

    for (const party of [parties.rui, parties.pedro]) {
      await ok(
        await backend().rpc("client_link_answer_free_justice", {
          target_token: TOKEN,
          target_party: party,
          target_asks: true,
          target_evidence: { ip: "203.0.113.9" },
        }),
      );
    }
    const { freeJusticeOf } = await import("@/lib/cases/free-justice");
    const read = await as(ANA).rpc("case_free_justice", { target_case: caseId });
    expect(freeJusticeOf(read.data)?.map((need) => [need.name, need.standing])).toEqual([
      ["Rui Teste", "issuing"],
      ["Pedro Teste", "issuing"],
    ]);
  });

  it("issues one declaration for the father and the son once Rui finished, a PDF to sign by gov.br", async () => {
    await ok(await anon().rpc("client_link_finish", { target_token: TOKEN }));
    await carry(caseId);
    const papers = await sql.unsafe(
      `select p.kind, e.method, e.status, f.name, f.storage_path, d.kind as document_kind from public.case_papers p
       join public.signature_envelopes e on e.id = p.envelope_id
       join public.case_documents d on d.id = p.document_id
       join public.files f on f.id = d.file_id
       where p.case_id = $1 order by p.kind`,
      [caseId],
    );
    expect(papers.map((paper) => [paper.kind, paper.method, paper.status, paper.document_kind])).toEqual([
      ["declaracao_hipossuficiencia", "govbr", "pending", "free_justice_declaration"],
      ["procuracao", "govbr", "pending", "power_of_attorney"],
    ]);
    expect(String(papers[0].name)).toMatch(/^declaracao-de-hipossuficiencia-rui-teste/);
    const pdf = bucket.get(String(papers[0].storage_path));
    expect(pdf && new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    const [blocked] = await sql.unsafe(`select public.filing_blocker($1) as code`, [LAWSUIT]);
    expect(["power_of_attorney_unsigned", "free_justice_unsigned"]).toContain(blocked.code);

    const { clientFreeJusticeOf } = await import("@/lib/cases/free-justice");
    const asked = await anon().rpc("client_link_free_justice", { target_token: TOKEN });
    expect(clientFreeJusticeOf(asked.data)?.issued).toBe(true);
  });
});
