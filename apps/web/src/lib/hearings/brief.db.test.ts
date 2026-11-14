// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Sql, standIn } from "@/lib/testing/embedded-db";
import { composeCnj } from "@flyee/rules/cnj";

/**
 * The guide of a hearing for who goes (migration 0246), written by the app's own sweep against a real database, the
 * model standing in as the fake: the brief's lines, the legs with ANAC's word, the weather, the client's account in
 * order, and ONE's reading of them, kept on the hearing and run as a task of the passenger module.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm and lawsuit here is invented: the lawsuit is of a year to come.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae246000-0000-4000-8000-000000000001";
const FIRM = "be246000-0000-4000-8000-00000000000a";
const CASE = "ce246000-0000-4000-8000-000000000001";
const PERSON = "de246000-0000-4000-8000-000000000001";
const PARTY = "ee246000-0000-4000-8000-000000000001";
const LAWSUIT = "fe246000-0000-4000-8000-000000000001";
const HEARING = "a2460000-0000-4000-8000-0000000000f1";
const CNJ = composeCnj({ sequence: 5924601, year: 2099, court: "09", origin: 51 });

describe.skipIf(!DB_URL)("the guide of a hearing, for who goes", () => {
  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@guia-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-guia-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.cases (id, org_id, seq, module, incident, status, airline_iata, airline_stated_cause) values
        ('${CASE}', '${FIRM}', 1, 'direito-do-passageiro', 'cancellation', 'filed', 'AD', 'weather');
      insert into public.people (id, org_id, full_name, birth_date) values ('${PERSON}', '${FIRM}', 'Lia Teste', '1990-05-04');
      insert into public.case_parties (id, org_id, case_id, person_id, role, claim_cents) values
        ('${PARTY}', '${FIRM}', '${CASE}', '${PERSON}', 'claimant', 1000000);
      insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
        ('${LAWSUIT}', '${FIRM}', '${CASE}', 'juizado', 'TJGO', 'filed', '${CNJ}', '2099-09-01');
      insert into public.proceeding_parties (org_id, proceeding_id, party_id) values ('${FIRM}', '${LAWSUIT}', '${PARTY}');
      insert into public.flight_segments (org_id, case_id, position, flight_number, origin_iata, destination_iata,
                                          scheduled_departure_local, scheduled_arrival_local, affected, source) values
        ('${FIRM}', '${CASE}', 1, 'AD4702', 'VCP', 'BSB', '2099-10-25 07:00', '2099-10-25 08:40', true, 'firm');
      insert into public.case_weather (org_id, case_id, icao, observed_at, raw, signs) values
        ('${FIRM}', '${CASE}', 'SBKP', '2099-10-25 10:00+00', 'METAR SBKP 251000Z 12005KT 9999 FEW030 22/15 Q1018=', '{}');
      insert into public.case_statements (org_id, case_id, party_id, source, transcript, chronology_status, chronology)
      values ('${FIRM}', '${CASE}', '${PARTY}', 'client', 'O voo foi cancelado no portão.', 'confirmed',
              '1. O voo de Campinas foi cancelado no portão.');
      insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
        ('${HEARING}', '${FIRM}', '${CASE}', '${LAWSUIT}', 'conciliacao', now() + interval '1 day', 'America/Sao_Paulo', 'videoconferencia');
    `);
  });

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    if (!sql) return;
    await sql.unsafe(
      `delete from public.organizations where id = '${FIRM}'; delete from auth.users where id = '${ANA}';`,
    );
    await sql.end({ timeout: 5 });
  });

  it("writes the brief with what the case holds and ONE's reading, run as the module's task", async () => {
    const { writeBriefs } = await import("@/lib/hearings/brief-work");
    const done = await writeBriefs(backend() as never);
    expect(done.written).toBeGreaterThanOrEqual(1);
    const [brief] = await sql.unsafe(`select body from public.hearing_briefs where hearing_id = $1`, [HEARING]);
    const body = String(brief.body);
    expect(body).toContain("Audiência de conciliação, por vídeo.");
    expect(body).toContain("OS VOOS");
    expect(body).toContain("1. AD4702, de ");
    expect(body).toContain("(o trecho do problema)");
    expect(body).toContain("A companhia alegou ao passageiro: condições do tempo.");
    expect(body).toContain("1. O voo de Campinas foi cancelado no portão.");
    expect(body).toContain("A contestação da companhia ainda não está no caso.");
    expect(body).toContain("A LEITURA DO ONE PARA A AUDIÊNCIA");
    expect(body).toContain("O ONE pode errar");
    expect(body).not.toMatch(/[—–!]/);
    const [run] = await sql.unsafe(
      `select r.task, r.subject_type, r.subject_id, v.version from public.ai_runs r
       join public.prompt_versions v on v.id = r.prompt_version_id
       where r.org_id = $1 and r.task = 'audiencia.preparo'`,
      [FIRM],
    );
    expect(run).toMatchObject({ task: "audiencia.preparo", subject_type: "hearing", subject_id: HEARING, version: 1 });
  });
});
