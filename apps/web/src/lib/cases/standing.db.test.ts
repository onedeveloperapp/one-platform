// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ADVANCE_WAITING, WAIT_PLACE } from "@/lib/cases/advance";
import { caseBoardOf } from "@/lib/cases/board";
import { caseStockOf, HOLDER_VIEW, HOLDERS, standingCounts } from "@/lib/cases/standing";
import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { isStagnant, STAGNANT_DAYS, stepDays } from "@flyee/rules/stock";

/**
 * Who has each case, said once (migration 0111): the controladoria's rule in the database (`case_standing`, through
 * `firm_cases`) and the top of each case (`caseNow`, read through the very read of the case screen, `loadCase`, and
 * the very assembly of its facts, `caseFacts`) say the same person, case by case; and the same step of the way. The
 * table of who owns each wait of ONE (`WAIT_PLACE`) and `wait_owner` agree, and so do the days at a step and whether
 * a case stagnated (`estoque-v1`).
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped. What
 * stands in is the transport (the stand-in client reads embedded resources as PostgREST does).
 *
 * Every person, firm, company, CPF and number here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: () => false, get: () => undefined, getAll: () => [] }),
}));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const bucket = new Map<string, Uint8Array>();

const ANA = "aea10000-0000-4000-8000-000000000001";
const FIRM = "bea10000-0000-4000-8000-00000000000a";

const as = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const backend = () => clientAs("service_role", { role: "service_role" });

vi.mock("@/lib/member/context", () => ({
  getMemberContext: async () => ({
    userId: ANA,
    email: "ana@posicao.invalid",
    orgId: FIRM,
    firm: { id: FIRM, name: "Souza Advogados", role: "owner", firmFunction: "socio" },
    supabase: as(),
    profile: { timezone: "America/Sao_Paulo" },
    modules: ["direito-do-passageiro"],
    catalog: [],
  }),
}));

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

describe.skipIf(!DB_URL)("who has each case: the controladoria and the top of the case agree", () => {
  /** The cases of the file, by what each is meant to show. */
  const cases: Record<string, string> = {};

  /** A file the backend measured and kept, of the firm. */
  async function stored(name: string): Promise<string> {
    const reserved = await call(backend(), "reserve_file", {
      target_org: FIRM,
      target_purpose: "upload",
      target_name: name,
      target_mime: "application/pdf",
      target_bytes: 4000,
    });
    const fileId = String(reserved.file_id);
    await call(backend(), "confirm_file", {
      target_file: fileId,
      target_sha256: "b".repeat(64),
      target_bytes: 4000,
      target_detected_mime: "application/pdf",
      target_pages: 1,
    });
    return fileId;
  }

  /** A document of the case: accepted, or received and left as `processing` says. */
  async function paper(caseId: string, kind: string, partyId: string | null, received?: string): Promise<string> {
    const attached = await call(as(), "attach_case_document", {
      target_case: caseId,
      target_file: await stored(`${kind}.pdf`),
      target_kind: kind,
      target_party: partyId,
    });
    const documentId = String(attached.document_id);
    if (received) {
      await sql.unsafe(`update public.case_documents set processing = $2 where id = $1`, [documentId, received]);
    } else {
      const decided = await call(as(), "decide_case_document", {
        target_document: documentId,
        target_decision: "accepted",
      });
      expect(decided.ok, `${kind} accepted`).toBe(true);
    }
    return documentId;
  }

  /**
   * A case of one adult. With `whole`, every datum, a leg and the papers the setting names are there: those cases
   * share one client (a CPF is one per person in a firm, and the fixtures use a manual's example), each with papers
   * of its own. Without, the client is a name alone, a person of that case only.
   */
  async function opened(name: string, whole: boolean) {
    const made = await call(as(), "create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-09-20",
      target_client: whole
        ? { full_name: "Caio Teste", cpf: "52998224725", birth_date: "1985-04-02" }
        : { full_name: name, birth_date: "1985-04-02" },
    });
    expect(made.ok, `${name}: case opened (${String(made.code)})`).toBe(true);
    const caseId = String(made.case_id);
    const partyId = String(made.party_id);
    if (whole) {
      const saved = await call(as(), "save_case_person", {
        target_case: caseId,
        target_person: made.person_id,
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
      const leg = await call(as(), "save_flight_segment", {
        target_case: caseId,
        target_segment: null,
        target_fields: { flight_number: "G3 1234", origin_iata: "GYN", destination_iata: "GRU", affected: true },
      });
      expect(leg.ok, "leg").toBe(true);
      await paper(caseId, "identity", partyId);
      await paper(caseId, "address_proof", partyId);
      await paper(caseId, "ticket", null);
    }
    return { caseId, partyId };
  }

  /** A lawsuit of the case: planned at a court, or filed with a number. */
  async function lawsuit(caseId: string, court: string, filed: string | null) {
    await sql.unsafe(
      `insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at)
       values ($1, $2, 'juizado', $3, $4, $5, $6)`,
      [FIRM, caseId, court, filed ? "filed" : "planned", filed, filed ? "2026-09-01" : null],
    );
  }

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql, { bucket });
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@posicao.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-posicao-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
    `);

    // The client still owes their data.
    cases.lacks = (await opened("Lia Teste", false)).caseId;
    // Everything there, and no account of what happened yet: the client's.
    cases.account = (await opened("Caio Teste", true)).caseId;
    // A document waits for the firm to decide it.
    const waits = await opened("Duda Teste", true);
    await paper(waits.caseId, "receipt", waits.partyId, "done");
    cases.documents = waits.caseId;
    // ONE checks a document now.
    const checking = await opened("Eva Teste", true);
    await paper(checking.caseId, "receipt", checking.partyId, "working");
    cases.checking = checking.caseId;
    // ONE looks at the case now.
    cases.looking = (await opened("Gil Teste", true)).caseId;
    // A lawsuit planned at a court whose system the platform knows: the firm approves it.
    const planned = await opened("Ivo Teste", true);
    await lawsuit(planned.caseId, "TJGO", null);
    await sql.unsafe(`update public.cases set status = 'drafting', status_changed_at = now() where id = $1`, [
      planned.caseId,
    ]);
    cases.system = planned.caseId;
    // A lawsuit planned at a court whose system the platform does not know: the platform's.
    const unknown = (
      await sql.unsafe(
        `select c.acronym from public.courts c
         where not exists (select 1 from public.court_systems s where s.court = c.acronym and s.proceeding_kind = 'juizado')
         order by c.acronym limit 1`,
      )
    )[0]?.acronym as string | undefined;
    if (unknown) {
      const platform = await opened("Jade Teste", true);
      await lawsuit(platform.caseId, unknown, null);
      await sql.unsafe(`update public.cases set status = 'drafting', status_changed_at = now() where id = $1`, [
        platform.caseId,
      ]);
      cases.platform = platform.caseId;
    }
    // In court with nothing to do: the court's.
    const court = await opened("Lara Teste", true);
    await lawsuit(court.caseId, "TJGO", "00051016820998090051");
    await sql.unsafe(`update public.cases set status = 'filed', status_changed_at = now() where id = $1`, [
      court.caseId,
    ]);
    cases.court = court.caseId;
    // In court with a deadline to confirm: the firm's.
    const deadline = await opened("Mel Teste", true);
    await lawsuit(deadline.caseId, "TJGO", "00051025320998090051");
    await sql.unsafe(`update public.cases set status = 'filed', status_changed_at = now() where id = $1`, [
      deadline.caseId,
    ]);
    await sql.unsafe(
      `insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting)
       select $1, p.cnj, p.court, p.case_id, p.id, 'Manifestação', 'day', current_date, 15, 'business'
       from public.proceedings p where p.case_id = $2`,
      [FIRM, deadline.caseId],
    );
    cases.deadline = deadline.caseId;
    // Ended.
    const ended = await opened("Nina Teste", false);
    await sql.unsafe(
      `update public.cases set status = 'closed', closed_at = now(), status_changed_at = now() where id = $1`,
      [ended.caseId],
    );
    cases.ended = ended.caseId;
    // A case at its first step for 20 days: past the limit of 7.
    const old = await opened("Otto Teste", false);
    await sql.unsafe(
      `update public.cases set status_changed_at = now() - interval '20 days', created_at = now() - interval '20 days'
       where id = $1`,
      [old.caseId],
    );
    cases.old = old.caseId;

    // The client of each case was sent their link already (this firm has no WhatsApp, so a link owed would be the
    // firm's to send, and every case before the court would be the firm's).
    await sql.unsafe(
      `insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at)
       select cp.org_id, cp.case_id, cp.person_id, encode(sha256(convert_to(cp.id::text || 'posicao', 'utf8')), 'hex'), now() + interval '30 days'
       from public.case_parties cp where cp.org_id = $1`,
      [FIRM],
    );
    // What ONE does on its own rounds is settled here: no case owes a look, but the one it is looking at now.
    await sql.unsafe(
      `update public.case_advances set woken_at = null, checked_at = now(), claimed_at = null where org_id = $1`,
      [FIRM],
    );
    await sql.unsafe(`update public.case_advances set claimed_at = now() where case_id = $1`, [cases.looking]);
  }, 120_000);

  afterAll(async () => {
    await sql?.unsafe(
      `delete from public.organizations where id = '${FIRM}'; delete from auth.users where id = '${ANA}';`,
    );
    await sql?.end({ timeout: 5 });
  });

  /** Every case of the firm as the controladoria reads it (`firm_cases`, with every case, ended or not). */
  async function listed(): Promise<Map<string, Row>> {
    const going = await call(as(), "firm_cases", { target_org: FIRM, target_limit: 100 });
    const ended = await call(as(), "firm_cases", { target_org: FIRM, target_filter: "ended", target_limit: 100 });
    return new Map(
      [...((going.rows as Row[]) ?? []), ...((ended.rows as Row[]) ?? [])].map((row) => [String(row.id), row]),
    );
  }

  it("says the same person, and the same step, as the top of each case", async () => {
    const { loadCase } = await import("@/app/(dashboard)/casos/[id]/load-case");
    const { caseFacts } = await import("@/app/(dashboard)/casos/[id]/case-facts");
    const rows = await listed();
    const seen: Record<string, string> = {};
    for (const [name, caseId] of Object.entries(cases)) {
      const read = await loadCase(caseId);
      expect(read.kind, `${name}: the case screen reads the case`).toBe("ready");
      if (read.kind !== "ready") continue;
      const facts = caseFacts(read);
      const row = rows.get(caseId);
      expect(row, `${name}: in the list`).toBeDefined();
      const holder = (row?.holder as string | null) ?? "ended";
      expect(holder, `${name}: who has the case (the top says ${facts.now.holder})`).toBe(facts.now.holder);
      if (facts.now.holder !== "ended") {
        expect(row?.step, `${name}: the step of its way`).toBe(facts.journey.current);
      }
      seen[name] = holder;
    }
    // Each case shows what it was made to show, so the comparison went through every kind of holder.
    expect(seen).toMatchObject({
      lacks: "client",
      account: "client",
      documents: "firm",
      checking: "one",
      looking: "one",
      system: "firm",
      court: "court",
      deadline: "firm",
      ended: "ended",
    });
    if (cases.platform) expect(seen.platform).toBe("platform");
  }, 120_000);

  it("counts who has the cases as the list holds them, and each view lists them", async () => {
    // A page's rows are read for those cases alone, each view for every case of the firm, the counts from the stock:
    // the three must say the same of every case.
    const page = await call(as(), "firm_cases", { target_org: FIRM, target_limit: 100 });
    const rows = (page.rows as Row[]) ?? [];
    const of = (holder: string) =>
      rows
        .filter((row) => row.holder === holder)
        .map((row) => String(row.id))
        .sort();
    const stock = caseStockOf(await call(as(), "firm_case_stock", { target_org: FIRM }));
    expect(stock).not.toBeNull();
    if (!stock) return;
    const counts = standingCounts(stock);
    for (const holder of HOLDERS) {
      const view = HOLDER_VIEW[holder];
      expect(counts[view], `the count of ${view}`).toBe(of(holder).length);
      const listed = await call(as(), "firm_cases", { target_org: FIRM, target_filter: view, target_limit: 100 });
      expect(((listed.rows as Row[]) ?? []).map((row) => String(row.id)).sort(), `the cases of ${view}`).toEqual(
        of(holder),
      );
    }
    expect(counts.estagnados).toBe(rows.filter((row) => row.stagnant === true).length);
    expect(stock.total).toBe(rows.length);
  });

  it("puts each case on the board at the step and with whom the list says", async () => {
    const rows = await listed();
    const board = caseBoardOf(await call(as(), "firm_case_board", { target_org: FIRM, target_limit: 50 }));
    expect(board).not.toBeNull();
    if (!board) return;
    const going = [...rows.values()].filter((row) => row.holder);
    expect(board.reduce((sum, column) => sum + column.cases, 0)).toBe(going.length);
    for (const column of board) {
      for (const item of column.items) {
        const row = rows.get(item.id);
        expect(row?.step, `the step of case ${item.seq}`).toBe(column.step);
        expect(row?.holder, `who has case ${item.seq}`).toBe(item.holder);
        expect(row?.step_days, `the days of case ${item.seq}`).toBe(item.days);
        expect(row?.stagnant, `case ${item.seq} stagnant`).toBe(item.stagnant);
      }
      const days = column.items.map((item) => item.days);
      expect(days, `the longest at ${column.step} first`).toEqual([...days].sort((a, b) => b - a));
    }
  });

  it("counts the days at a step and the stagnant cases by the rule of the stock", async () => {
    const page = await call(as(), "firm_cases", { target_org: FIRM, target_limit: 100 });
    const rows = (page.rows as Row[]) ?? [];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    for (const row of rows) {
      const days = stepDays(row.step_since as string, today);
      expect(row.step_days, `days of case ${row.seq}`).toBe(days);
      expect(row.stagnant, `stagnant case ${row.seq}`).toBe(isStagnant(row.step as string, days, STAGNANT_DAYS));
    }
    const old = rows.find((row) => row.id === cases.old);
    expect(old?.step_days).toBe(20);
    expect(old?.stagnant).toBe(true);
    const stagnant = await call(as(), "firm_cases", {
      target_org: FIRM,
      target_filter: "estagnados",
      target_limit: 100,
    });
    expect(((stagnant.rows as Row[]) ?? []).map((row) => row.id)).toEqual([cases.old]);
  });

  it("owns each wait of ONE as the screens do", async () => {
    for (const code of ADVANCE_WAITING) {
      const [{ owner }] = await sql.unsafe(`select public.wait_owner($1) as owner`, [code]);
      expect(owner, code).toBe(WAIT_PLACE[code].owner);
    }
    const [{ owner }] = await sql.unsafe(`select public.wait_owner('no_such_wait') as owner`);
    expect(owner).toBe("firm");
  });
});
