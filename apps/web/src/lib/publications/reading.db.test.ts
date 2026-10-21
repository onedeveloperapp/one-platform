// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import type { AiProviderName } from "@flyee/ai/types";

/**
 * ONE reading what a person triaged as a deadline or a hearing, with the
 * app's own worker against a real database (migration 0040): the AI reads
 * the term of a publication, ONE proposes the deadline, the rule counts it
 * over the court's calendar and ONE confirms it on the day counted (the
 * firm's default); the AI reads a hearing and ONE writes it in the agenda;
 * what the publication's words do not say is left to a person and watched
 * until somebody does it; a firm where a person proposes the deadlines is
 * left alone; and a model that answers badly spends a try of its own.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport and the model (the fake provider of `@flyee/ai`, told here
 * what to answer for each publication).
 *
 * Every person, firm and number here is invented: the lawsuits are of a year
 * to come.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** The model, told what to answer for the publication it is handed; and what it was handed. */
const model = vi.hoisted(() => ({
  answer: ((): unknown => ({})) as (briefing: string) => unknown,
  briefings: [] as string[],
}));

vi.mock("@flyee/ai/fake", async (original) => {
  const real = await original<typeof import("@flyee/ai/fake")>();
  class ToldProvider extends real.FakeChatProvider {
    constructor(name?: AiProviderName) {
      super(name, (_output, messages) => {
        const briefing = String(messages[0]?.content ?? "");
        model.briefings.push(briefing);
        return model.answer(briefing);
      });
    }
  }
  return { ...real, FakeChatProvider: ToldProvider };
});

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae700000-0000-4000-8000-000000000001";
const RUI = "ae700000-0000-4000-8000-000000000004";
const FIRM = "be700000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "be700000-0000-4000-8000-00000000000b";
const CNJ = { formatted: "5000505-53.2099.8.09.0051", digits: "50005055320998090051" };
const OTHER_CNJ = { formatted: "5000606-90.2099.8.09.0051", digits: "50006069020998090051" };

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });

type Answer = { ok?: boolean; code?: string } & Row;
async function call(client: ReturnType<typeof clientAs>, name: string, args: Row): Promise<Answer> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Answer;
}

/** A day some days from today, as the database counts today (Brasília), as YYYY-MM-DD and as a court writes it. */
async function dayIn(days: number): Promise<{ iso: string; written: string }> {
  const [row] = await sql.unsafe(
    `select to_char(d, 'YYYY-MM-DD') as iso, to_char(d, 'DD/MM/YYYY') as written
     from (select (now() at time zone 'America/Sao_Paulo')::date + $1::int as d) x`,
    [days],
  );
  return { iso: String(row.iso), written: String(row.written) };
}

describe.skipIf(!DB_URL)("ONE reading the deadline and the hearing a publication sets", () => {
  const lawsuits: Record<string, { caseId: string; proceedingId: string }> = {};
  const counted: string[] = [];
  const written: string[] = [];

  /** A case of a firm with a lawsuit the court has (TJGO, Goiânia), as a person of the firm records it. */
  async function lawsuitOf(who: string, org: string, cpf: string, cnj: string) {
    const opened = await call(as(who), "create_case", {
      target_org: org,
      target_incident: "delay",
      target_airline: "G3",
      target_flight_date: "2026-01-20",
      target_client: { full_name: "Maria Teste", cpf, birth_date: "1985-04-02" },
    });
    const saved = await call(as(who), "save_proceeding", {
      target_case: opened.case_id,
      target_proceeding: null,
      target_fields: {
        kind: "juizado",
        court: "TJGO",
        system: "projudi",
        comarca: "Goiânia",
        status: "filed",
        cnj,
        filed_at: "2026-02-02",
      },
      target_parties: [opened.party_id],
    });
    expect(saved.ok, "lawsuit").toBe(true);
    return { caseId: String(opened.case_id), proceedingId: String(saved.proceeding_id) };
  }

  /** A publication of a lawsuit, as the reading of the gazette keeps it, made available two days ago. */
  async function published(org: string, cnj: string, lawsuit: { caseId: string; proceedingId: string }, body: string) {
    const [row] = await sql.unsafe(
      `insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, head, proceeding_id, case_id)
       values ($1, $2, 'TJGO', $3, (now() at time zone 'America/Sao_Paulo')::date - 2, 'Intimação', $4, left($4, 120), $5, $6)
       returning id`,
      [org, `leitura-app-${Math.random().toString(36).slice(2, 14)}`, cnj, body, lawsuit.proceedingId, lawsuit.caseId],
    );
    return String(row.id);
  }

  /** ONE's worker reads the publication named, with what follows done right here: the count, the calendar noted. */
  async function read(publicationId: string) {
    const { readNext } = await import("@/lib/publications/reading-work");
    const { countDeadlines } = await import("@/lib/deadlines/count-work");
    return readNext(backend() as never, publicationId, {
      deadline: async (deadlineId) => {
        counted.push(deadlineId);
        await countDeadlines(backend() as never, { limit: 1, deadlineId });
      },
      hearing: async (hearingId) => {
        written.push(hearingId);
      },
    });
  }

  const readingOf = async (publicationId: string) =>
    (
      await sql.unsafe(
        `select status, reason, attempts, deadline_id, hearing_id from public.publication_readings
                        where publication_id = $1`,
        [publicationId],
      )
    )[0];

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    process.env.AI_FAKE_PROVIDER = "1";
    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${RUI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@leitura.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${RUI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rui@leitura.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-leitura-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-leitura-app', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${RUI}', 'owner', 'socio');
      -- In the other firm a person proposes the deadlines.
      insert into public.firm_autonomy (org_id, decision, mode) values ('${OTHER_FIRM}', 'publication_deadline', 'approval');
    `);
    lawsuits.firm = await lawsuitOf(ANA, FIRM, "12345678909", CNJ.formatted);
    lawsuits.other = await lawsuitOf(RUI, OTHER_FIRM, "52998224725", OTHER_CNJ.formatted);
  }, 120_000);

  afterAll(async () => {
    delete process.env.AI_FAKE_PROVIDER;
    // Nothing of this file is left for another file's sweep to find.
    await sql?.unsafe(`delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}')`);
    await sql?.unsafe(`delete from auth.users where id in ('${ANA}', '${RUI}')`);
    await sql?.end({ timeout: 5 });
  });

  it("proposes the deadline a publication sets, counted by the rule and confirmed by ONE", async () => {
    const excerpt =
      "Fica a parte autora intimada para, no prazo de 15 (quinze) dias, manifestar-se sobre os documentos.";
    const publication = await published(FIRM, CNJ.digits, lawsuits.firm, `<p>Vistos.</p><p>${excerpt}</p>`);
    const triaged = await call(as(ANA), "triage_publication", {
      target_publication: publication,
      target_category: "prazo",
    });
    expect(triaged.ok).toBe(true);
    expect((await readingOf(publication))?.status).toBe("due");

    model.answer = () => ({
      ha_prazo: true,
      dias: 15,
      contagem: "uteis",
      a_partir: "publicacao",
      ato: "manifestacao_documentos",
      trecho: excerpt,
      observacoes: "",
    });
    expect(await read(publication)).toBe("done");

    // The model read the text as plain text, fenced, with the acts of the list.
    const briefing = model.briefings.at(-1) ?? "";
    expect(briefing).toContain(excerpt);
    expect(briefing).not.toContain("<p>");
    expect(briefing).toContain("Atos da lista");
    expect(briefing).toContain("manifestacao_documentos");
    expect(briefing).toContain("Processo: no juizado especial cível");

    const reading = await readingOf(publication);
    expect(reading?.status).toBe("done");
    const [deadline] = await sql.unsafe(
      `select id, proposed_auto, created_by, days, counting, act, status, confirmed_auto, due_on
       from public.deadlines where publication_id = $1`,
      [publication],
    );
    expect(deadline.id).toBe(reading?.deadline_id);
    expect(deadline.proposed_auto).toBe(true);
    expect(deadline.created_by).toBeNull();
    expect([deadline.days, deadline.counting, deadline.act]).toEqual([15, "business", "manifestacao_documentos"]);
    expect(counted).toContain(String(deadline.id));
    // Counted by the rule and confirmed by ONE on that day: the firm's default for its deadlines.
    expect(deadline.status).toBe("confirmed");
    expect(deadline.confirmed_auto).toBe(true);
    expect(deadline.due_on).not.toBeNull();
    // Nothing watched: the publication has its deadline.
    const untimed = await call(as(ANA), "firm_publications_without_deadline", { target_org: FIRM });
    expect((untimed.rows as Row[]).map((row) => row.id)).not.toContain(publication);
  });

  it("writes the hearing a publication sets in the agenda, as ONE", async () => {
    const day = await dayIn(40);
    const excerpt = `Designo audiência de conciliação para o dia ${day.written}, às 14h30, por videoconferência`;
    const publication = await published(
      FIRM,
      CNJ.digits,
      lawsuits.firm,
      `${excerpt}, na sala <a href="https://sala.exemplo.invalid/aud1?x=1&amp;y=2">de audiências virtual</a>.`,
    );
    await call(as(ANA), "triage_publication", { target_publication: publication, target_category: "audiencia" });

    model.answer = () => ({
      ha_audiencia: true,
      situacao: "marcada",
      data: day.iso,
      hora: "14:30",
      tipo: "conciliacao",
      modo: "videoconferencia",
      local: null,
      link: "https://sala.exemplo.invalid/aud1?x=1&y=2",
      trecho: `${excerpt}, na sala de audiências virtual (https://sala.exemplo.invalid/aud1?x=1&y=2)`,
      observacoes: "",
    });
    expect(await read(publication)).toBe("done");
    // The model read where the link leads beside its words, as a person reads the page.
    expect(model.briefings.at(-1)).toContain("(https://sala.exemplo.invalid/aud1?x=1&y=2)");

    const [hearing] = await sql.unsafe(
      `select id, created_auto, created_by, kind, mode, link, source,
              to_char(starts_at at time zone time_zone, 'YYYY-MM-DD HH24:MI') as local_start
       from public.hearings where publication_id = $1`,
      [publication],
    );
    expect(hearing.created_auto).toBe(true);
    expect(hearing.created_by).toBeNull();
    expect([hearing.kind, hearing.mode, hearing.source]).toEqual(["conciliacao", "videoconferencia", "publication"]);
    expect(hearing.link).toBe("https://sala.exemplo.invalid/aud1?x=1&y=2");
    expect(hearing.local_start).toBe(`${day.iso} 14:30`);
    expect(written).toContain(String(hearing.id));
    // The agenda shows it as ONE's.
    const listed = await call(as(ANA), "firm_hearings", { target_org: FIRM, target_view: "proximas" });
    const row = (listed.rows as Row[]).find((found) => found.id === hearing.id);
    expect(row?.created_auto).toBe(true);
  });

  it("leaves to a person what the words do not say, and watches it until somebody does it", async () => {
    const day = await dayIn(45);
    const body = `Redesigno a audiência para o dia ${day.written}, às 9h, por videoconferência.`;
    const publication = await published(FIRM, CNJ.digits, lawsuits.firm, body);
    await call(as(ANA), "triage_publication", { target_publication: publication, target_category: "audiencia" });

    model.answer = () => ({
      ha_audiencia: true,
      situacao: "redesignada",
      data: day.iso,
      hora: "09:00",
      tipo: "outra",
      modo: "videoconferencia",
      local: null,
      link: null,
      trecho: body,
      observacoes: "",
    });
    expect(await read(publication)).toBe("unread");
    expect(await readingOf(publication)).toMatchObject({ status: "unread", reason: "hearing_moved" });
    expect((await sql.unsafe(`select 1 from public.hearings where publication_id = $1`, [publication])).length).toBe(0);

    // The agenda says it, and the home counts it, until a person writes its hearing.
    const unwritten = await call(as(ANA), "firm_publications_without_hearing", { target_org: FIRM });
    expect((unwritten.rows as Row[]).map((row) => row.id)).toContain(publication);
    const today = await call(as(ANA), "firm_today", { target_org: FIRM });
    expect(Number(today.publications_without_hearing)).toBeGreaterThanOrEqual(1);
    const saved = await call(as(ANA), "save_hearing", {
      target_hearing: null,
      target_proceeding: lawsuits.firm.proceedingId,
      target_fields: {
        kind: "outra",
        mode: "videoconferencia",
        day: day.iso,
        time: "09:00",
        publication_id: publication,
      },
    });
    expect(saved.ok).toBe(true);
    const after = await call(as(ANA), "firm_publications_without_hearing", { target_org: FIRM });
    expect((after.rows as Row[]).map((row) => row.id)).not.toContain(publication);
  });

  it("lets the firm's own people read what ONE did, and settle a hearing that needs nothing more", async () => {
    const { readingReadyKinds } = await import("@/lib/publications/reading-work");
    const { publicationProgress } = await import("@/lib/publications/facts");
    const { publicationsWithoutHearing } = await import("@/lib/hearings/facts");
    // The test's model stands in for every provider: both kinds can be read here.
    expect(await readingReadyKinds(backend() as never)).toEqual(["deadline", "hearing"]);
    // Without it, a kind is ready only where the provider its instructions in force name has a key: none here.
    delete process.env.AI_FAKE_PROVIDER;
    try {
      expect(await readingReadyKinds(backend() as never)).toEqual([]);
    } finally {
      process.env.AI_FAKE_PROVIDER = "1";
    }

    const day = await dayIn(50);
    const body = `A audiência de conciliação fica cancelada. Designada para o dia ${day.written}, às 10h.`;
    const publication = await published(FIRM, CNJ.digits, lawsuits.firm, body);
    await call(as(ANA), "triage_publication", { target_publication: publication, target_category: "audiencia" });
    model.answer = () => ({
      ha_audiencia: true,
      situacao: "cancelada",
      data: day.iso,
      hora: "10:00",
      tipo: "conciliacao",
      modo: "presencial",
      local: null,
      link: null,
      trecho: body,
      observacoes: "",
    });
    expect(await read(publication)).toBe("unread");

    // What the screens read, under the person's own session.
    const progress = await publicationProgress(as(ANA) as never, FIRM, [publication], 1);
    expect(progress[publication]?.readings).toEqual([
      { kind: "hearing", status: "unread", reason: "hearing_cancelled" },
    ]);
    expect(progress[publication]?.hearingSettled).toBe(false);
    expect(progress[publication]?.readAt).toBe(1);
    const watch = await publicationsWithoutHearing(as(ANA) as never, FIRM, "America/Sao_Paulo");
    const row = watch.rows.find((found) => found.id === publication);
    expect(row?.reading).toEqual({ kind: "hearing", status: "unread", reason: "hearing_cancelled" });
    expect(row?.lawsuitFiled).toBe(true);
    // Nobody of another firm reads it, even naming this firm: the rows are the database's to show.
    const theirs = await publicationProgress(as(RUI) as never, FIRM, [publication], 1);
    expect(theirs[publication]?.readings).toEqual([]);
    expect(theirs[publication]?.hearingSettled).toBe(false);

    // The person cancelled the hearing in the agenda, and says the publication needs nothing more.
    const settled = await call(as(ANA), "settle_publication_hearing", { target_publication: publication });
    expect(settled.code).toBe("saved");
    const after = await publicationsWithoutHearing(as(ANA) as never, FIRM, "America/Sao_Paulo");
    expect(after.rows.map((found) => found.id)).not.toContain(publication);
    // The card reads that it was settled: what ONE left to a person was done.
    expect((await publicationProgress(as(ANA) as never, FIRM, [publication], 2))[publication]?.hearingSettled).toBe(
      true,
    );
  });

  it("spends a try of its own on a model that answered badly, and leaves a firm that reads by hand alone", async () => {
    const publication = await published(
      FIRM,
      CNJ.digits,
      lawsuits.firm,
      "Intime-se a parte autora para, em 10 (dez) dias, juntar o comprovante de residência.",
    );
    await call(as(ANA), "triage_publication", { target_publication: publication, target_category: "prazo" });
    // An answer that is not what the task asks for.
    model.answer = () => ({ prazo: "dez dias" });
    expect(await read(publication)).toBe("retry");
    expect(await readingOf(publication)).toMatchObject({ status: "due", attempts: 1 });

    // The other firm proposes its deadlines itself: nothing of ONE's is owed, and nothing is read.
    const theirs = await published(
      OTHER_FIRM,
      OTHER_CNJ.digits,
      lawsuits.other,
      "Fica a parte autora intimada para, no prazo de 15 (quinze) dias, manifestar-se.",
    );
    await call(as(RUI), "triage_publication", { target_publication: theirs, target_category: "prazo" });
    expect(await readingOf(theirs)).toBeUndefined();
    const asked = model.briefings.length;
    expect(await read(theirs)).toBe("none");
    expect(model.briefings.length).toBe(asked);
  });
});
