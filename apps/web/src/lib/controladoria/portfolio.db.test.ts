// @vitest-environment node
import { strFromU8, unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PORTFOLIO_SHEETS,
  portfolioAbout,
  portfolioBegunOf,
  portfolioLine,
  portfolioRowsOf,
  type PortfolioSheet,
  portfolioWorkbook,
  type Say,
} from "@/lib/controladoria/portfolio";
import { writeWorkbook, type XlsxCell } from "@/lib/export/xlsx-write";
import { readXlsx } from "@/lib/import/xlsx";
import { connect, DB_URL, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * "Levar a carteira inteira" from the database to the file, with the app's own rules against a real database (migrations
 * 0117 and 0118): a partner begins it, every sheet is read a page at a time as the screen reads it, the rows become lines by the
 * screens' words and the workbook is written and read back. The test cases stay out with who is only in them, and
 * nothing is read of another firm. The screen's run is this same path in the browser.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm, company, CPF and number here is invented.
 */

vi.mock("server-only", () => ({}));

const ANA = "ac170000-0000-4000-8000-000000000001";
const RUI = "ac170000-0000-4000-8000-000000000002";
const FIRM = "bc170000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bc170000-0000-4000-8000-00000000000b";

const ROOT = path.resolve(__dirname, "../../../../..");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/content/messages/pt-BR.json"), "utf8")) as {
  product: Record<string, string>;
};
/** The screen's `t`, for the words with no value in them, which is all a sheet's columns and rows use. */
const say: Say = (key) => {
  const word = CATALOG.product[key];
  if (!word) throw new Error(`no words for ${key}`);
  return word;
};

describe.skipIf(!DB_URL)("the whole portfolio, from the database to the file", () => {
  let sql: Sql;
  let clientAs: ReturnType<typeof standIn>;
  const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, {});
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${RUI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@carteira.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${RUI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rui@carteira.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-carteira', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-carteira', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${RUI}', 'owner', 'socio');
      insert into public.oab_registrations (user_id, uf, number, kind) values ('${ANA}', 'GO', '19171', 'principal');
      insert into public.people (id, org_id, full_name, cpf, birth_date, email, phone, postal_code, street, address_number, district, city, uf, marital_status) values
        ('dc170000-0000-4000-8000-000000000001', '${FIRM}', 'Maria Teste', '52998224725', '1985-04-02', 'maria@teste.invalid', '5500988880001', '01000000', 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO', 'casado'),
        ('dc170000-0000-4000-8000-000000000002', '${FIRM}', 'Teo Teste', null, null, null, null, null, null, null, null, null, null, null),
        ('dc170000-0000-4000-8000-000000000003', '${OTHER_FIRM}', 'Rui Cliente', '12345678909', null, null, null, null, null, null, null, null, null, null);
      insert into public.cases (id, org_id, seq, module, incident, status, airline_iata, flight_date) values
        ('cc170000-0000-4000-8000-000000000001', '${FIRM}', 7, 'direito-do-passageiro', 'delay', 'filed', 'G3', '2026-09-20'),
        ('cc170000-0000-4000-8000-000000000002', '${FIRM}', 8, 'direito-do-passageiro', 'delay', 'intake', null, null),
        ('cc170000-0000-4000-8000-000000000003', '${OTHER_FIRM}', 1, 'direito-do-passageiro', 'delay', 'intake', null, null);
      update public.cases set is_test = true where id = 'cc170000-0000-4000-8000-000000000002';
      insert into public.case_parties (id, org_id, case_id, person_id, role, claim_cents) values
        ('ec170000-0000-4000-8000-000000000001', '${FIRM}', 'cc170000-0000-4000-8000-000000000001', 'dc170000-0000-4000-8000-000000000001', 'claimant', 1050050),
        ('ec170000-0000-4000-8000-000000000002', '${FIRM}', 'cc170000-0000-4000-8000-000000000002', 'dc170000-0000-4000-8000-000000000002', 'claimant', null),
        ('ec170000-0000-4000-8000-000000000003', '${OTHER_FIRM}', 'cc170000-0000-4000-8000-000000000003', 'dc170000-0000-4000-8000-000000000003', 'claimant', null);
      insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
        ('fc170000-0000-4000-8000-000000000001', '${FIRM}', 'cc170000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'filed', '00051016820998090051', '2026-10-01');
      insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
        ('fc170000-0000-4000-8000-000000000001', 'ec170000-0000-4000-8000-000000000001', '${FIRM}');
      insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
        ('fc170000-0000-4000-8000-000000000001', '${ANA}', '${FIRM}');
      insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting, due_on) values
        ('${FIRM}', '00051016820998090051', 'TJGO', 'cc170000-0000-4000-8000-000000000001', 'fc170000-0000-4000-8000-000000000001',
         'Réplica à contestação', 'day', '2026-10-05', 15, 'business', '2026-10-26');
      insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, link, attendee_user_id, status) values
        ('${FIRM}', 'cc170000-0000-4000-8000-000000000001', 'fc170000-0000-4000-8000-000000000001', 'conciliacao',
         '2026-11-20 17:00+00', 'America/Sao_Paulo', 'videoconferencia', 'https://videoconferencia.teste.invalid/sala-1', '${ANA}', 'scheduled');
      insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, pages, expires_at, confirmed_at) values
        ('ac170000-0000-4000-8000-0000000000f1', '${FIRM}', 'client', 'org/${FIRM}/client/guardado', 'identidade-maria.pdf', 'application/pdf', 4000, 'stored', '${"a".repeat(64)}', 4000, 'application/pdf', 1, now() + interval '1 hour', now());
      insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status) values
        ('${FIRM}', 'cc170000-0000-4000-8000-000000000001', 'ec170000-0000-4000-8000-000000000001', 'ac170000-0000-4000-8000-0000000000f1', 'identity', 'client', 'accepted');
    `);
  }, 120_000);

  afterAll(async () => {
    await sql?.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql?.unsafe(`delete from auth.users where id in ('${ANA}', '${RUI}')`);
    await sql?.end({ timeout: 5 });
  });

  /** Begins and reads the portfolio as the screen does, then writes the file. */
  async function take(tests: boolean) {
    const client = as(ANA);
    const answer = await client.rpc("begin_portfolio_export", { target_org: FIRM, target_tests: tests });
    expect(answer.error).toBeNull();
    const begun = portfolioBegunOf(answer.data);
    if (!begun.ok) throw new Error(begun.code);
    const lines = Object.fromEntries(PORTFOLIO_SHEETS.map((sheet) => [sheet, [] as XlsxCell[][]])) as Record<
      PortfolioSheet,
      XlsxCell[][]
    >;
    for (const sheet of PORTFOLIO_SHEETS) {
      for (let offset = 0; ; offset += begun.pageSize) {
        const page = await client.rpc("firm_portfolio_page", {
          target_org: FIRM,
          target_sheet: sheet,
          target_offset: offset,
          target_tests: tests,
        });
        expect(page.error).toBeNull();
        const rows = portfolioRowsOf(page.data);
        if (!rows) throw new Error("no page");
        for (const row of rows) lines[sheet].push(portfolioLine(sheet, row, say));
        if (rows.length < begun.pageSize) break;
      }
    }
    const bytes = writeWorkbook(
      portfolioWorkbook({
        about: portfolioAbout({
          firm: "Souza Advogados",
          made: { day: "09/11/2026", time: "12:30" },
          counts: begun.counts,
          testsLeftOut: !tests,
          // The words of "Gerado em" take values the file fills: here, plainly.
          say: (key, values) => (values ? `${say(key)} ${JSON.stringify(values)}` : say(key)),
          countText: String,
        }),
        lines,
        say,
      }),
    );
    return { begun, lines, bytes };
  }

  const sheetText = (bytes: Uint8Array, at: number) => strFromU8(unzipSync(bytes)[`xl/worksheets/sheet${at}.xml`]);

  it("writes every sheet of the firm's own, with the words the screens use", async () => {
    const { begun, lines, bytes } = await take(true);
    expect(begun.counts).toEqual({ clientes: 2, casos: 2, acoes: 1, prazos: 1, audiencias: 1, documentos: 1 });
    // Each sheet read holds what was counted.
    for (const sheet of PORTFOLIO_SHEETS) expect(lines[sheet]).toHaveLength(begun.counts[sheet]);

    const clients = sheetText(bytes, 2);
    expect(clients).toContain("Maria Teste");
    expect(clients).toContain("529.982.247-25");
    expect(clients).toContain("maria@teste.invalid");
    expect(clients).toContain("5500988880001");
    // A CEP with a zero in front stays a text.
    expect(clients).toContain('<t xml:space="preserve">01000000</t>');
    expect(clients).toContain("Rua das Flores");
    expect(clients).toContain("#7");
    // Nothing of another firm, in any sheet.
    for (const at of [2, 3, 4, 5, 6, 7]) {
      expect(sheetText(bytes, at)).not.toContain("Rui Cliente");
      expect(sheetText(bytes, at)).not.toContain("123.456.789-09");
    }
    const lawsuits = sheetText(bytes, 4);
    expect(lawsuits).toContain("0005101-68.2099.8.09.0051");
    expect(lawsuits).toContain("Ana Souza (OAB/GO 19171)");
    expect(lawsuits).toContain("<v>10500.5</v>");
    expect(sheetText(bytes, 5)).toContain("Réplica à contestação");
    const hearings = sheetText(bytes, 6);
    expect(hearings).toContain(say("hearing-kind-conciliacao"));
    expect(hearings).toContain("https://videoconferencia.teste.invalid/sala-1");
    expect(hearings).toContain(say("hearing-zone-brasilia"));
    expect(hearings).toContain("Ana Souza");
    const documents = sheetText(bytes, 7);
    expect(documents).toContain("identidade-maria.pdf");
    expect(documents).toContain("a".repeat(64));
    // An index: never where the file is kept.
    expect(documents).not.toContain(`org/${FIRM}`);

    // What the file opens on says what it is, and the import reads a workbook this writes.
    const read = readXlsx(bytes);
    if (!read.ok) throw new Error("not read");
    expect(read.table.headers).toEqual([say("portfolio-about-title"), "Souza Advogados"]);
    expect(read.table.rows.map((row) => row[0])).toContain(say("portfolio-about-care"));
  });

  it("leaves the test cases out with who is only in them, and says so", async () => {
    const { begun, bytes } = await take(false);
    expect(begun.counts).toEqual({ clientes: 1, casos: 1, acoes: 1, prazos: 1, audiencias: 1, documentos: 1 });
    expect(sheetText(bytes, 2)).not.toContain("Teo Teste");
    expect(sheetText(bytes, 1)).toContain(say("portfolio-about-tests"));
  });

  it("is on the record with how many rows of each and nothing of anybody", async () => {
    const rows = await sql.unsafe(
      `select metadata from public.audit_events where org_id = $1 and action = 'portfolio.exported'`,
      [FIRM],
    );
    expect(rows.length).toBeGreaterThan(0);
    const said = JSON.stringify(rows.map((row) => row.metadata));
    expect(said).toContain("clientes");
    expect(said).not.toMatch(/Maria|52998224725|maria@|Flores/);
  });
});
