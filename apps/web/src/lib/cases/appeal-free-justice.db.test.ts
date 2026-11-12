// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * Free justice in the recurso of the small-claims court (migration 0218), with the app's own code against a real
 * database: Rui won less than he asked, the firm decides the recurso inominado, and Rui says on his link that he asks
 * for free justice in it. His case is already with the court, so ONE's carrying on of a case before its filing never
 * looks at it: the declaration of economic hardship is issued through the line of an appeal, a PDF of the firm's own
 * sent to sign by gov.br, once; and the round of the sweep finds nothing more to issue.
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

const ANA = "ae218000-0000-4000-8000-000000000001";
const FIRM = "be218000-0000-4000-8000-00000000000a";
const TOKEN = "token-do-rui-recurso-0123456789abcdef";
const LAWSUIT = "ab218000-0000-4000-8000-000000000003";

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });
const anon = () => clientAs("anon", { role: "anon" });

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

describe.skipIf(!DB_URL)("free justice in the recurso of the small-claims court", () => {
  let caseId = "";
  let rui = "";
  let party = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@recurso-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-recurso-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
    `);
    const opened = await as(ANA).rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-01-10",
      target_client: { full_name: "Rui Teste", birth_date: "1980-01-01", phone: "5500999990218" },
    });
    expect(opened.error).toBeNull();
    caseId = String((opened.data as Row).case_id);
    const [person] = await sql.unsafe(`select id as party, person_id from public.case_parties where case_id = $1`, [
      caseId,
    ]);
    rui = String(person.person_id);
    party = String(person.party);
    await sql.unsafe(
      `update public.people set cpf = '52998224725', nationality = 'brasileira', marital_status = 'casado',
         profession = 'Professor', street = 'Rua das Flores', address_number = '10', district = 'Centro',
         city = 'Goiânia', uf = 'GO', postal_code = '74000000' where id = $1`,
      [rui],
    );
    // His lawsuit of the small-claims court, filed, and its judgment: less than he asked.
    await sql.unsafe(
      `insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at)
       values ($1, $2, $3, 'juizado', 'TJGO', 'filed', '10003012720998090100', '2025-08-01')`,
      [LAWSUIT, FIRM, caseId],
    );
    await sql.unsafe(`insert into public.proceeding_parties (proceeding_id, party_id, org_id) values ($1, $2, $3)`, [
      LAWSUIT,
      party,
      FIRM,
    ]);
    await sql.unsafe(`update public.cases set status = 'filed' where id = $1`, [caseId]);
    await sql.unsafe(
      `insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source)
       values ($1, $2, $3, 'sentenca', 'parcial', 200000, current_date - 3, 'person')`,
      [FIRM, caseId, LAWSUIT],
    );
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

  it("asks Rui on his link once the firm decides the recurso", async () => {
    const { clientFreeJusticeOf } = await import("@/lib/cases/free-justice");
    const before = await anon().rpc("client_link_free_justice", { target_token: TOKEN });
    expect(clientFreeJusticeOf(before.data)?.items).toEqual([]);
    const [path] = await sql.unsafe(`select id from public.judgment_paths where proceeding_id = $1`, [LAWSUIT]);
    await ok(
      await as(ANA).rpc("decide_judgment_path", {
        target_path: path.id,
        target_decision: "recurso_inominado",
        target_reason: null,
      }),
    );
    const asked = await anon().rpc("client_link_free_justice", { target_token: TOKEN });
    expect(clientFreeJusticeOf(asked.data)?.items.map((item) => [item.name, item.appeal, item.asks])).toEqual([
      ["Rui Teste", true, null],
    ]);
  });

  it("issues his declaration through the line of an appeal, once, a PDF to sign by gov.br", async () => {
    await ok(
      await backend().rpc("client_link_answer_free_justice", {
        target_token: TOKEN,
        target_party: party,
        target_asks: true,
        target_evidence: { ip: "203.0.113.9" },
      }),
    );
    const { appealPapersRound, issueAppealPapers } = await import("@/lib/cases/advance-work");
    const done = await issueAppealPapers(backend() as never, caseId);
    expect(done).toEqual({ issued: 1, waiting: null, failed: false });
    const papers = await sql.unsafe(
      `select p.kind, e.method, e.status, f.name, f.storage_path, d.kind as document_kind from public.case_papers p
       join public.signature_envelopes e on e.id = p.envelope_id
       join public.case_documents d on d.id = p.document_id
       join public.files f on f.id = d.file_id
       where p.case_id = $1`,
      [caseId],
    );
    expect(papers.map((paper) => [paper.kind, paper.method, paper.status, paper.document_kind])).toEqual([
      ["declaracao_hipossuficiencia", "govbr", "pending", "free_justice_declaration"],
    ]);
    expect(String(papers[0].name)).toMatch(/^declaracao-de-hipossuficiencia-rui-teste/);
    const pdf = bucket.get(String(papers[0].storage_path));
    expect(pdf && new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");

    // Nothing more is owed: the sweep's round issues nothing, and the link says the declaration waits below.
    expect(await appealPapersRound(backend() as never, 5)).toMatchObject({ issued: 0 });
    const { clientFreeJusticeOf } = await import("@/lib/cases/free-justice");
    const asked = await anon().rpc("client_link_free_justice", { target_token: TOKEN });
    expect(clientFreeJusticeOf(asked.data)?.issued).toBe(true);
  });
});
