// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * What a lawsuit came to (migration 0130), with the app's own worker against a real database: the court's movements
 * and the judgment's words are read by the rule `resultado-v1`, each fact recorded once as ONE's with the court's
 * words; once the release is received and the lawsuit archived, ONE closes the case. A firm that keeps the result to
 * a person sees what ONE read wait for a person.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. Every
 * person, firm, name and number here is invented.
 */

vi.mock("server-only", () => ({}));

let sql: Sql;
let backend: ReturnType<ReturnType<typeof standIn>>;

const ANA = "ae960000-0000-4000-8000-000000000001";
const FIRM = "be960000-0000-4000-8000-00000000000a";
const CASE = "ce960000-0000-4000-8000-000000000001";
const LAWSUIT = "fe960000-0000-4000-8000-000000000001";
const CASE_2 = "ce960000-0000-4000-8000-000000000002";
const LAWSUIT_2 = "fe960000-0000-4000-8000-000000000002";

describe.skipIf(!DB_URL)("what a lawsuit came to", () => {
  beforeAll(async () => {
    sql = connect();
    backend = standIn(sql)("service_role", { role: "service_role" });
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@resultado-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-resultado-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.cases (id, org_id, seq, module, incident, status) values
        ('${CASE}', '${FIRM}', 1, 'direito-do-passageiro', 'delay', 'filed');
      insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
        ('${LAWSUIT}', '${FIRM}', '${CASE}', 'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
      insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title) values
        ('${FIRM}', '${CASE}', '${LAWSUIT}', 'projudi', 'r1', now() - interval '20 days', 'Julgado procedente o pedido'),
        ('${FIRM}', '${CASE}', '${LAWSUIT}', 'projudi', 'r2', now() - interval '10 days', 'Certificado o trânsito em julgado da sentença'),
        ('${FIRM}', '${CASE}', '${LAWSUIT}', 'projudi', 'r3', now() - interval '6 days', 'Expedido alvará eletrônico em favor da parte autora'),
        ('${FIRM}', '${CASE}', '${LAWSUIT}', 'projudi', 'r4', now() - interval '5 days', 'Juntada de petição'),
        ('${FIRM}', '${CASE}', '${LAWSUIT}', 'projudi', 'r5', now() - interval '4 days', 'Arquivado provisoriamente');
      insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id, category, triaged_at, judgment)
      values
        ('${FIRM}', 'resultado-app-sentenca', 'TJGO', '10003012720998090100', current_date - 19, 'Intimação',
         'SENTENÇA. Dispensado o relatório. Ante o exposto, JULGO PROCEDENTE o pedido para condenar a ré a pagar à parte autora indenização por danos morais de R$ 5.000,00 (cinco mil reais) por autor, com correção monetária.',
         '${LAWSUIT}', '${CASE}', 'decisao', now(), true),
        ('${FIRM}', 'resultado-app-alvara', 'TJGO', '10003012720998090100', current_date - 5, 'Intimação',
         'Expeça-se alvará eletrônico em favor da parte autora no valor de R$ 10.000,00, para levantamento do valor depositado pela ré.',
         '${LAWSUIT}', '${CASE}', 'pagamento', now(), null);
      -- A second lawsuit whose trânsito reaches the firm only as a published certificate, triaged as a notice (0142).
      insert into public.cases (id, org_id, seq, module, incident, status) values
        ('${CASE_2}', '${FIRM}', 2, 'direito-do-passageiro', 'cancellation', 'filed');
      insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
        ('${LAWSUIT_2}', '${FIRM}', '${CASE_2}', 'juizado', 'TJGO', 'filed', '10003021220998090100', '2026-09-01');
      insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id, category, triaged_at, judgment)
      values
        ('${FIRM}', 'resultado-app-ordem', 'TJGO', '10003021220998090100', current_date - 8, 'Intimação',
         'Intimem-se as partes. Após o trânsito em julgado, arquivem-se os autos.',
         '${LAWSUIT_2}', '${CASE_2}', 'ciencia', now(), null),
        ('${FIRM}', 'resultado-app-certidao', 'TJGO', '10003021220998090100', current_date - 3, 'Intimação',
         '<p>CERTIDÃO</p><p>Certifico, para os devidos fins, que a sentença proferida nestes autos <b>transitou em julgado</b>.</p>',
         '${LAWSUIT_2}', '${CASE_2}', 'ciencia', now(), null);
    `);
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("reads the movements and the words by rule, each fact once and as ONE's, nothing of a provisional archiving", async () => {
    const { outcomesRound } = await import("@/lib/courts/outcome-work");
    const counts = await outcomesRound(backend as never, Date.now() + 20_000);
    expect(counts.recorded).toBeGreaterThanOrEqual(3);
    const facts = (await sql.unsafe(
      `select kind, result, cents, per_claimant, by_one, words from public.lawsuit_facts where case_id = $1 order by happened_on, kind`,
      [CASE],
    )) as Row[];
    expect(
      facts.map((fact) => [fact.kind, fact.result, fact.cents === null ? null : Number(fact.cents), fact.per_claimant]),
    ).toEqual([
      ["sentenca", "procedente", 500000, true],
      ["transito", null, null, false],
      ["alvara", null, 1000000, false],
    ]);
    expect(facts.every((fact) => fact.by_one === true)).toBe(true);
    expect(String(facts[0].words)).toContain("JULGO PROCEDENTE");
    // Read again, nothing is recorded twice.
    const again = await outcomesRound(backend as never, Date.now() + 20_000);
    expect(again.recorded).toBe(0);
  });

  it("reads the certificate that the judgment became final where it is only published, never the order after it", async () => {
    const { outcomesRound } = await import("@/lib/courts/outcome-work");
    await outcomesRound(backend as never, Date.now() + 20_000);
    const facts = (await sql.unsafe(
      `select f.kind, f.happened_on = current_date - 3 as on_its_day, f.by_one, p.hash
       from public.lawsuit_facts f left join public.publications p on p.id = f.publication_id
       where f.case_id = $1`,
      [CASE_2],
    )) as Row[];
    expect(facts.map((fact) => [fact.kind, fact.on_its_day, fact.by_one, fact.hash])).toEqual([
      ["transito", true, true, "resultado-app-certidao"],
    ]);
    const [unread] = (await sql.unsafe(
      `select count(*)::int as n from public.publications where case_id = $1 and final_read_at is null`,
      [CASE_2],
    )) as Row[];
    expect(unread.n).toBe(0);
  });

  it("closes the case once the release was received and the lawsuit archived definitively", async () => {
    const { outcomesRound } = await import("@/lib/courts/outcome-work");
    await sql.unsafe(
      `update public.lawsuit_facts set received_cents = 1000000, received_on = current_date where case_id = $1 and kind = 'alvara'`,
      [CASE],
    );
    await sql.unsafe(
      `insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title)
       values ($1, $2, $3, 'projudi', 'r6', now(), 'Arquivado definitivamente')`,
      [FIRM, CASE, LAWSUIT],
    );
    const counts = await outcomesRound(backend as never, Date.now() + 20_000);
    expect(counts.closed).toBe(1);
    const [closed] = (await sql.unsafe(`select status, closed_by_one from public.cases where id = $1`, [
      CASE,
    ])) as Row[];
    expect([closed.status, closed.closed_by_one]).toEqual(["closed", true]);
  });
});
