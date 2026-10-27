// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { importLimitsOf, inPieces } from "@/lib/import/limits";
import { guessColumnMapping, missingRequired } from "@/lib/import/mapping";
import { buildPortfolioPreview, portfolioHeaderScore, type PortfolioRow } from "@/lib/import/portfolio";
import { readSpreadsheet } from "@/lib/import/read";
import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { composeCnj } from "@flyee/rules/cnj";

/**
 * A firm's portfolio brought from a spreadsheet, with the app's own code
 * against a real database: a file as a system exports it is read as the
 * browser reads it, its columns are guessed, the firm is asked which of its
 * lawsuits it already has, the lines go to the server a few a call, and the
 * batch is decided until none is left; the firm's list then finds what was
 * brought, by a client's name, a CPF or a lawsuit's number (`firm_cases`,
 * through the list's own action); then the batch is undone. What the browser
 * read and what the database accepts are two halves written apart: this is
 * where a line of one is proven to be a line of the other.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims.
 *
 * Every person, firm and lawsuit here is invented: the lawsuits are of a
 * year to come, and the CPFs are the ones every manual uses as an example.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
/** Who the actions run as: what `getMemberContext` answers. */
let session: { supabase: unknown; firm: { id: string; firmFunction: string } } | null = null;
vi.mock("@/lib/member/context", () => ({ getMemberContext: async () => session }));

const ANA = "ae600000-0000-4000-8000-000000000001";
const RUI = "ae600000-0000-4000-8000-000000000003";
const FIRM = "be600000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "be600000-0000-4000-8000-00000000000b";

const signIn = (who: string, firm: string, level: "aal1" | "aal2" = "aal2") => {
  session = {
    supabase: clientAs("authenticated", { sub: who, role: "authenticated", aal: level }),
    firm: { id: firm, firmFunction: "socio" },
  };
};

/** Lawsuits that exist nowhere: numbers of a year to come, made of invented parts, with their check digits. */
const GOIAS = composeCnj({ sequence: 5600101, year: 2099, court: "09", origin: 51 });
const SAO_PAULO = composeCnj({ sequence: 1600202, year: 2099, court: "26", origin: 100 });
const HAD = composeCnj({ sequence: 5600303, year: 2099, court: "09", origin: 51 });
const ZEROS = composeCnj({ sequence: 60404, year: 2099, court: "09", origin: 51 });
const OTHER = composeCnj({ sequence: 5600505, year: 2099, court: "09", origin: 51 });

const mask = (cnj: string) =>
  `${cnj.slice(0, 7)}-${cnj.slice(7, 9)}.${cnj.slice(9, 13)}.${cnj.slice(13, 14)}.${cnj.slice(14, 16)}.${cnj.slice(16)}`;

/** A file as a management system exports it: a title line, the headers, the lawsuits. */
const SPREADSHEET = [
  "Relatório de processos;;;;;;;;;",
  "Número do processo;Cliente;CPF/CNPJ;Parte contrária;Vara;Comarca;Tipo de ação;Data de distribuição;Situação;Pasta",
  `${mask(GOIAS)};Maria Teste;529.982.247-25;Gol Linhas Aéreas S.A.;3º Juizado Especial Cível;Goiânia;Juizado Especial Cível;03/08/2026;Ativo;A-12`,
  `${mask(SAO_PAULO)};João Teste;;Azul Linhas Aéreas Brasileiras S.A.;5ª Vara Cível;São Paulo;Procedimento Comum;15/03/2025;Arquivado;A-13`,
  `${mask(HAD)};Maria Teste;529.982.247-25;Gol Linhas Aéreas S.A.;1º Juizado Especial Cível;Goiânia;Juizado Especial Cível;;Ativo;A-14`,
  `${mask(GOIAS)};Maria Teste;;;;;;;;A-12`,
  // A spreadsheet took the zeros before this number: it is the same lawsuit.
  `${String(Number(ZEROS.slice(0, 7)))}-${mask(ZEROS).slice(8)};Pedro Teste;111.111.111-11;TAM Linhas Aéreas S.A.;;Anápolis;;31/02/2026;Em andamento;A-15`,
  "1234567-00.2099.8.09.0051;Número Errado;;;;;;;;A-16",
  // A CPF the firm has for another client, under another name: Rita comes without it.
  `${mask(OTHER)};Rita Teste;111.444.777-35;Gol Linhas Aéreas S.A.;;Goiânia;;;Ativo;A-17`,
].join("\r\n");

describe.skipIf(!DB_URL)("a firm's portfolio, from the spreadsheet to its cases and back", () => {
  let batchId = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${RUI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@carteira-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${RUI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rui@carteira-app.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-carteira-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-carteira-app', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${RUI}', 'owner', 'socio');
    `);
    // The firm already has one of the lawsuits of the spreadsheet, and a client whose CPF a line gives another.
    const asAna = clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
    const opened = await asAna.rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-05-10",
      target_client: { full_name: "Maria Teste", cpf: "52998224725" },
    });
    const had = opened.data as Row;
    await asAna.rpc("save_proceeding", {
      target_case: had.case_id,
      target_proceeding: null,
      target_fields: { kind: "juizado", court: "TJGO", status: "filed", cnj: HAD },
      target_parties: [had.party_id],
    });
    await asAna.rpc("create_case", {
      target_org: FIRM,
      target_incident: "cancellation",
      target_airline: "AD",
      target_flight_date: null,
      target_client: { full_name: "Bruna Teste", cpf: "11144477735" },
    });
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql.unsafe(`delete from auth.users where id in ('${ANA}', '${RUI}')`);
    await sql.end({ timeout: 5 });
  });

  /** What the screen does with a file, up to the lines that open a case. */
  async function conferred() {
    const actions = await import("@/lib/import/actions");
    const read = readSpreadsheet(new TextEncoder().encode(SPREADSHEET), { headerScore: portfolioHeaderScore });
    if (!read.ok) throw new Error(`the file was not read: ${read.code}`);
    const mapping = guessColumnMapping(read.table.headers);
    expect(missingRequired(mapping)).toEqual([]);
    const admin = clientAs("service_role", { role: "service_role" });
    const courts = ((await admin.from("courts").select("acronym, cnj_segment, cnj_code")).data ?? []).map((court) => ({
      acronym: String(court.acronym),
      segment: String(court.cnj_segment),
      code: String(court.cnj_code),
    }));
    // Every airline, as the page reads them: the ones that no longer fly are known, and never chosen.
    const airlines = (
      (await admin.from("airlines").select("iata, name, legal_name, court_names, active")).data ?? []
    ).map((airline) => ({
      iata: String(airline.iata),
      name: String(airline.name),
      names: [airline.legal_name, ...((airline.court_names as string[] | null) ?? [])].filter(
        (name): name is string => typeof name === "string" && name !== "",
      ),
      active: airline.active === true,
    }));
    const known = await actions.knownLawsuits([GOIAS, SAO_PAULO, HAD, ZEROS, OTHER]);
    if (!known.ok) throw new Error(`the firm's lawsuits were not read: ${known.code}`);
    const limits = importLimitsOf(
      (await clientAs("authenticated", { sub: ANA, role: "authenticated" }).rpc("import_limits")).data,
    );
    const preview = buildPortfolioPreview({
      table: read.table,
      mapping,
      existing: new Set(known.known),
      courts,
      airlines,
      source: "Astrea",
      today: "2026-10-11",
      oldestDay: limits.oldestFiledOn,
    });
    return { actions, preview, known: known.known, limits };
  }

  it("reads the file, guesses its columns and says what each line would do, the lawsuit the firm has included", async () => {
    signIn(ANA, FIRM);
    const { preview, known, limits } = await conferred();
    expect(known).toEqual([HAD]);
    expect(limits).toEqual({ maxRows: 20_000, rowsPerCall: 200, oldestFiledOn: "1990-01-01" });
    expect(preview.summary).toEqual({ create: 4, exists: 1, duplicate: 1, error: 1 });
    expect(preview.rows.map((row) => [row.line, row.action])).toEqual([
      [3, "create"],
      [4, "create"],
      [5, "exists"],
      [6, "duplicate"],
      [7, "create"],
      [8, "error"],
      [9, "create"],
    ]);
    // A CPF that is none and a day that is none are left out, and the line goes on.
    expect(preview.rows[4]).toMatchObject({ warnings: ["invalid_cpf", "invalid_date"] });
    expect(preview.rows[4].row).toMatchObject({ cnj: ZEROS, cpf: null, filed_on: null, airline: "LA" });
    // Nothing in the file says the CPF of the last line is anybody else's: that is for the database to see.
    expect(preview.rows[6].row).toMatchObject({ cpf: "11144477735" });
    expect(preview.opponents.map((opponent) => [opponent.label, opponent.lines, opponent.airline])).toEqual([
      ["Gol Linhas Aéreas S.A.", 2, "G3"],
      ["Azul Linhas Aéreas Brasileiras S.A.", 1, "AD"],
      ["TAM Linhas Aéreas S.A.", 1, "LA"],
    ]);
  });

  it("sends the lines the database accepts as they are, and opens a case for each with its lawsuit", async () => {
    signIn(ANA, FIRM);
    const { actions, preview } = await conferred();
    const lines = preview.rows.flatMap((row): PortfolioRow[] => (row.row ? [row.row] : []));

    const started = await actions.startPortfolioImport({
      fileName: "processos.csv",
      source: "Astrea",
      fileCounts: { lines: 7, exists: 1, duplicate: 1, error: 1, over: 0 },
    });
    if (!started.ok) throw new Error(`the batch was not started: ${started.code}`);
    batchId = started.batchId;
    for (const piece of inPieces(lines, 2)) {
      expect(await actions.addPortfolioRows(batchId, piece)).toMatchObject({ ok: true });
    }
    // A line the database would not take is named, with what of it.
    const refused = await actions.addPortfolioRows(batchId, [{ ...lines[0], row: 99, filed_on: "1985-01-01" }]);
    expect(refused).toEqual({ ok: false, code: "invalid_row", row: 99, field: "filed_on" });

    // Without the second factor nothing is decided.
    signIn(ANA, FIRM, "aal1");
    expect(await actions.commitPortfolioImport(batchId)).toEqual({ ok: false, code: "second_factor_required" });
    signIn(ANA, FIRM);
    const done = await actions.commitPortfolioImport(batchId);
    expect(done).toEqual({
      ok: true,
      done: true,
      counts: { rows: 4, pending: 0, created: 4, exists: 0, refused: 0, reverted: 0, kept: 0 },
    });

    const cases = await sql.unsafe(
      `select c.status, c.airline_iata, c.summary, p.cnj, p.court, p.kind, p.status as lawsuit, p.unit, p.comarca,
              p.filed_at::text as filed_at, person.full_name, person.cpf
       from public.import_rows r
       join public.cases c on c.id = r.case_id
       join public.proceedings p on p.id = r.proceeding_id
       join public.people person on person.id = r.person_id
       where r.batch_id = $1 order by r.row_number`,
      [batchId],
    );
    expect(cases).toEqual([
      {
        status: "filed",
        airline_iata: "G3",
        summary: "Importado de Astrea · Pasta: A-12 · Parte contrária: Gol Linhas Aéreas S.A. · Situação: Ativo",
        cnj: GOIAS,
        court: "TJGO",
        kind: "juizado",
        lawsuit: "filed",
        unit: "3º Juizado Especial Cível",
        comarca: "Goiânia",
        filed_at: "2026-08-03",
        full_name: "Maria Teste",
        cpf: "52998224725",
      },
      {
        status: "closed",
        airline_iata: "AD",
        summary:
          "Importado de Astrea · Pasta: A-13 · Parte contrária: Azul Linhas Aéreas Brasileiras S.A. · Situação: Arquivado",
        cnj: SAO_PAULO,
        court: "TJSP",
        kind: "comum",
        lawsuit: "closed",
        unit: "5ª Vara Cível",
        comarca: "São Paulo",
        filed_at: "2025-03-15",
        full_name: "João Teste",
        cpf: null,
      },
      {
        status: "filed",
        airline_iata: "LA",
        summary: "Importado de Astrea · Pasta: A-15 · Parte contrária: TAM Linhas Aéreas S.A. · Situação: Em andamento",
        cnj: ZEROS,
        court: "TJGO",
        kind: "comum",
        lawsuit: "filed",
        unit: null,
        comarca: "Anápolis",
        filed_at: null,
        full_name: "Pedro Teste",
        cpf: null,
      },
      {
        status: "filed",
        airline_iata: "G3",
        summary: "Importado de Astrea · Pasta: A-17 · Parte contrária: Gol Linhas Aéreas S.A. · Situação: Ativo",
        cnj: OTHER,
        court: "TJGO",
        kind: "comum",
        lawsuit: "filed",
        unit: null,
        comarca: "Goiânia",
        filed_at: null,
        full_name: "Rita Teste",
        cpf: null,
      },
    ]);
    // The client the firm had by her CPF is one person, with her two cases; Bruna keeps her CPF and her one case.
    const [maria] = await sql.unsafe(
      `select count(distinct cp.case_id)::int as cases from public.people p join public.case_parties cp on cp.person_id = p.id
       where p.org_id = $1 and p.cpf = '52998224725'`,
      [FIRM],
    );
    expect(maria.cases).toBe(2);
    const [bruna] = await sql.unsafe(
      `select p.full_name, count(cp.case_id)::int as cases from public.people p
       join public.case_parties cp on cp.person_id = p.id
       where p.org_id = $1 and p.cpf = '11144477735' group by p.full_name`,
      [FIRM],
    );
    expect(bruna).toEqual({ full_name: "Bruna Teste", cases: 1 });
    // The screen learns which lines did not go as they were.
    expect(await actions.notedLines(batchId)).toEqual({
      ok: true,
      refused: [],
      withoutCpf: [{ line: 9, cnj: OTHER, outcome: "created", code: "cpf_other_name" }],
      withoutCpfCount: 1,
    });
    // The lawsuits in court are followed.
    const [followed] = await sql.unsafe(
      `select count(*)::int as n from public.proceeding_tracking t
       join public.import_rows r on r.proceeding_id = t.proceeding_id where r.batch_id = $1`,
      [batchId],
    );
    expect(followed.n).toBe(3);
    // Nothing the spreadsheet said stays in the batch; what the screen counted of the file does.
    const [kept] = await sql.unsafe(
      `select count(*)::int as n from public.import_rows where batch_id = $1 and fields <> '{}'::jsonb`,
      [batchId],
    );
    expect(kept.n).toBe(0);
    const [batch] = await sql.unsafe(`select file_counts from public.import_batches where id = $1`, [batchId]);
    expect(batch.file_counts).toEqual({ lines: 7, exists: 1, duplicate: 1, error: 1, over: 0 });
  });

  it("brings nothing twice: the same file again finds every lawsuit in the firm", async () => {
    signIn(ANA, FIRM);
    const { preview } = await conferred();
    expect(preview.summary).toEqual({ create: 0, exists: 5, duplicate: 1, error: 1 });
  });

  it("finds in the firm's list what was brought, counted and searched by the database", async () => {
    signIn(ANA, FIRM);
    const { listFirmCases } = await import("@/lib/cases/list-actions");
    const all = await listFirmCases({ filter: null, search: "", page: 0, pageSize: 25 });
    if (!all.ok) throw new Error("the list was not read");
    // Bruna's case (with the client); Maria's, which went to court with the lawsuit the firm recorded filed
    // (0062), and the three brought in court; and the one brought ended.
    expect(all.page.counts).toMatchObject({ all: 6, going: 5, open: 1, filed: 4, ended: 1, andamento: 0 });
    expect(all.page.total).toBe(5);
    expect(all.page.rows.every((row) => row.status !== "closed")).toBe(true);

    const pedro = await listFirmCases({ search: "teste pedro" });
    expect(pedro.ok && pedro.page.rows).toMatchObject([
      { client: "Pedro Teste", status: "filed", airline: "LA", incident: "other", toReview: 0, courtMoved: false },
    ]);
    // A client is found in every case of theirs, by the CPF as a person types it.
    const maria = await listFirmCases({ search: "529.982.247-25" });
    expect(maria.ok && maria.page.total).toBe(2);
    // A lawsuit that ended is found by its number, and only under the filter it is in.
    const ended = await listFirmCases({ search: mask(SAO_PAULO) });
    expect(ended.ok && ended.page.rows).toMatchObject([{ client: "João Teste", status: "closed" }]);
    const inCourt = await listFirmCases({ search: mask(SAO_PAULO), filter: "filed" });
    expect(inCourt.ok && inCourt.page.total).toBe(0);
    // A page at a time.
    const second = await listFirmCases({ filter: null, search: "", page: 1, pageSize: 25 });
    expect(second.ok && second.page.rows).toEqual([]);
    expect(second.ok && second.page.total).toBe(5);

    // Another firm lists and finds none of it.
    signIn(RUI, OTHER_FIRM);
    const other = await listFirmCases({ search: "maria" });
    expect(other.ok && other.page).toMatchObject({ total: 0, rows: [], counts: { all: 0 } });
  });

  it("keeps a firm's portfolio from another firm", async () => {
    signIn(RUI, OTHER_FIRM);
    const actions = await import("@/lib/import/actions");
    expect(await actions.knownLawsuits([GOIAS, SAO_PAULO, HAD, ZEROS, OTHER])).toEqual({ ok: true, known: [] });
    expect(await actions.commitPortfolioImport(batchId)).toEqual({ ok: false, code: "batch_not_found" });
    expect(await actions.revertPortfolioImport(batchId)).toEqual({ ok: false, code: "batch_not_found" });
    expect(await actions.notedLines(batchId)).toEqual({ ok: true, refused: [], withoutCpf: [], withoutCpfCount: 0 });
  });

  it("undoes the batch: the cases nobody touched go with the clients it wrote, the one somebody worked on stays", async () => {
    signIn(ANA, FIRM);
    const actions = await import("@/lib/import/actions");
    // Somebody works on João's case after the import.
    const [joao] = await sql.unsafe(`select case_id from public.import_rows where batch_id = $1 and cnj = $2`, [
      batchId,
      SAO_PAULO,
    ]);
    const asAna = clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
    const noted = await asAna.rpc("update_case", { target_case: joao.case_id, target_fields: { origin: "referral" } });
    expect(noted.data).toMatchObject({ ok: true });

    const undone = await actions.revertPortfolioImport(batchId);
    expect(undone).toEqual({
      ok: true,
      done: true,
      counts: { rows: 4, pending: 0, created: 0, exists: 0, refused: 0, reverted: 3, kept: 1 },
    });
    const left = await sql.unsafe(`select p.cnj from public.proceedings p where p.org_id = $1 order by p.cnj`, [FIRM]);
    expect(left.map((row) => row.cnj)).toEqual([SAO_PAULO, HAD].sort());
    // The clients the firm had stay, with the cases they had; the ones the batch wrote alone are gone.
    const people = await sql.unsafe(`select full_name from public.people where org_id = $1 order by full_name`, [FIRM]);
    expect(people.map((row) => row.full_name)).toEqual(["Bruna Teste", "João Teste", "Maria Teste"]);
  });
});
