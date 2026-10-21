// @vitest-environment node
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { eventIdOf } from "@flyee/calendar/event-id";
import { FakeCalendarProvider } from "@flyee/calendar/fake";
import { composeCnj } from "@flyee/rules/cnj";

/**
 * A firm's hearings written to its calendar by the app's own worker against
 * a real database, with the vault sealing the grant for real and Google
 * standing in as the fake: a hearing written by a person becomes its event,
 * a change replaces it, a cancelling takes it out; the grant is opened once
 * for a round however many hearings it writes; the platform's day at Google
 * running out stops the round with every try given back; a hearing that goes
 * with its lawsuit has its event taken out; a grant that no longer holds and
 * a calendar deleted in Google stop the calendar and are said to the firm,
 * the hearing's try given back; a calendar connected again takes the
 * hearings again.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped. What stands in is
 * the transport, as the same database roles with the same claims.
 *
 * Every person, firm and lawsuit here is invented: the lawsuit is of a year
 * to come.
 */

vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));
// The vault seals with a key of this test alone.
process.env.VAULT_KEYS = `1:${randomBytes(32).toString("base64")}`;

const ANA = "ae900000-0000-4000-8000-000000000001";
const FIRM = "be900000-0000-4000-8000-00000000000a";
const LAWSUIT = composeCnj({ sequence: 5900101, year: 2099, court: "09", origin: 51 });

const as = (who: string) => clientAs("authenticated", { sub: who, role: "authenticated", aal: "aal2" });
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function hearingOf(id: string): Promise<Row> {
  const [row] = await sql.unsafe(
    `select status, revision, synced_revision, synced_calendar, sync_claimed_at is not null as claimed, sync_attempts,
            sync_error
     from public.hearings where id = $1`,
    [id],
  );
  return row;
}

async function calendarOf(): Promise<Row | undefined> {
  const [row] = await sql.unsafe(`select calendar_id, status, problem from public.firm_calendars where org_id = $1`, [
    FIRM,
  ]);
  return row;
}

describe.skipIf(!DB_URL)("the firm's hearings, written to its calendar in Google", () => {
  const google = new FakeCalendarProvider();
  let lawsuitId = "";
  let hearingId = "";
  let connectionId = "";
  let calendarId = "";
  let refreshToken = "";

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@agenda-app.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-agenda-app', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
    `);
    const opened = (
      await as(ANA).rpc("create_case", {
        target_org: FIRM,
        target_incident: "delay",
        target_airline: "G3",
        target_flight_date: "2026-01-10",
        target_client: { full_name: "Maria Teste" },
      })
    ).data as Row;
    const saved = (
      await as(ANA).rpc("save_proceeding", {
        target_case: opened.case_id,
        target_proceeding: null,
        target_fields: {
          kind: "juizado",
          court: "TJGO",
          system: "projudi",
          comarca: "Goiânia",
          status: "filed",
          cnj: LAWSUIT,
        },
        target_parties: [opened.party_id],
      })
    ).data as Row;
    lawsuitId = String(saved.proceeding_id);
    // The other files' hearings of this run are theirs: none is in this firm, and the worker reads one by one here.
    await sql.unsafe(`update public.firm_calendars set status = 'lost', problem = 'disconnected' where org_id <> $1`, [
      FIRM,
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("connects the firm's calendar: the grant sealed in the vault, the calendar made in the account", async () => {
    const { getVault } = await import("@/lib/connections/vault");
    const begun = (
      await as(ANA).rpc("begin_connection", {
        target_org: FIRM,
        target_provider: "google_calendar",
        target_external_id: null,
        target_label: "Google Agenda",
      })
    ).data as Row;
    expect(begun.ok).toBe(true);
    connectionId = String(begun.connection_id);
    refreshToken = (await google.exchangeCode({ code: "consentiu", redirectUri: "https://app.one.invalid/cb" }))
      .refreshToken;
    const vault = getVault();
    if (!vault.ok) throw new Error("no vault in the test");
    const sealed = await vault.vault.seal({ orgId: FIRM, connectionId }, { refresh_token: refreshToken });
    expect(sealed.kind).toBe("sealed");
    calendarId = (
      await google.createCalendar(
        { refreshToken },
        { name: "Audiências · Souza Advogados", description: "", timeZone: "America/Sao_Paulo" },
      )
    ).id;
    const recorded = (
      await backend().rpc("record_firm_calendar", {
        target_org: FIRM,
        target_connection: connectionId,
        target_calendar: calendarId,
        target_name: "Audiências · Souza Advogados",
        target_by: ANA,
      })
    ).data as Row;
    expect(recorded.code).toBe("recorded");
    expect(await calendarOf()).toMatchObject({ calendar_id: calendarId, status: "active", problem: null });
  });

  it("writes a hearing as its event, replaces it when it changes, and takes it out when it is cancelled", async () => {
    const { syncHearings } = await import("@/lib/hearings/calendar-work");
    const saved = (
      await as(ANA).rpc("save_hearing", {
        target_hearing: null,
        target_proceeding: lawsuitId,
        target_fields: {
          kind: "conciliacao",
          mode: "videoconferencia",
          day: day(20),
          time: "14:00",
          link: "https://sala.invalid/7",
        },
      })
    ).data as Row;
    expect(saved.code).toBe("scheduled");
    // The person's screen is told the firm's calendar takes it.
    expect(saved.calendar).toBe(true);
    hearingId = String(saved.id);

    const first = await syncHearings(backend() as never, { hearingId }, google);
    expect(first).toMatchObject({ claimed: 1, synced: 1, lost: 0 });
    const events = google.calendars.get(calendarId)?.events;
    const event = events?.get(eventIdOf(hearingId));
    // Nobody of the case is named in a calendar that is shared and shows on phones.
    expect(event?.summary).toMatch(/^Audiência de conciliação · Caso \d+$/);
    expect(event?.timeZone).toBe("America/Sao_Paulo");
    expect(await hearingOf(hearingId)).toMatchObject({
      revision: 1,
      synced_revision: 1,
      synced_calendar: calendarId,
      claimed: false,
    });

    await as(ANA).rpc("save_hearing", {
      target_hearing: hearingId,
      target_proceeding: null,
      target_fields: {
        kind: "conciliacao",
        mode: "videoconferencia",
        day: day(20),
        time: "15:30",
        link: "https://sala.invalid/7",
      },
    });
    await syncHearings(backend() as never, { hearingId }, google);
    expect(events?.size).toBe(1);
    expect(new Date(String(events?.get(eventIdOf(hearingId))?.start)).getTime()).toBe(
      new Date(String(event?.start)).getTime() + 90 * 60_000,
    );
    expect(await hearingOf(hearingId)).toMatchObject({ revision: 2, synced_revision: 2 });

    await as(ANA).rpc("set_hearing_status", {
      target_hearing: hearingId,
      target_status: "cancelled",
      target_outcome: null,
      target_note: "Redesignada pelo juízo.",
    });
    await syncHearings(backend() as never, { hearingId }, google);
    expect(events?.size).toBe(0);
    expect(await hearingOf(hearingId)).toMatchObject({ status: "cancelled", revision: 3, synced_revision: 3 });
  });

  it("opens the grant once for a round, and stops the round with every try given back when Google's day runs out", async () => {
    const { syncHearings } = await import("@/lib/hearings/calendar-work");
    const written: string[] = [];
    for (const time of ["08:00", "08:30", "09:00"]) {
      const saved = (
        await as(ANA).rpc("save_hearing", {
          target_hearing: null,
          target_proceeding: lawsuitId,
          target_fields: { kind: "instrucao", mode: "videoconferencia", day: day(25), time },
        })
      ).data as Row;
      written.push(String(saved.id));
    }
    const reads = async () =>
      Number(
        (
          await sql.unsafe(
            `select count(*)::int as n from public.audit_events where action = 'vault.secret.read' and entity_id = $1`,
            [connectionId],
          )
        )[0].n,
      );
    const before = await reads();
    // Two hearings written in one round: the firm's grant is read from the vault once.
    const round = await syncHearings(backend() as never, { limit: 2 }, google);
    expect(round.synced).toBe(2);
    expect((await reads()) - before).toBe(1);

    // The third meets the platform's project out of its day at Google.
    const [third] = written.slice(2);
    google.failures.push("quota");
    const stopped = await syncHearings(backend() as never, { limit: 5 }, google);
    expect(stopped).toMatchObject({ synced: 0, failed: 0, retried: 0 });
    expect(stopped.released).toBe(stopped.claimed);
    // Its try was given back, and nothing was counted against it.
    expect(await hearingOf(third)).toMatchObject({ synced_revision: null, claimed: false, sync_attempts: 0 });
    await sql.unsafe(`update public.hearings set sync_retry_after = null where id = $1`, [third]);
    expect((await syncHearings(backend() as never, { hearingId: third }, google)).synced).toBe(1);
  });

  it("takes out the event of a hearing that went with its lawsuit", async () => {
    const { syncHearings } = await import("@/lib/hearings/calendar-work");
    // A second lawsuit of the case, filed, with a hearing written to the calendar.
    const opened = (await sql.unsafe(`select case_id from public.proceedings where id = $1`, [lawsuitId]))[0];
    const [party] = await sql.unsafe(`select id from public.case_parties where case_id = $1 limit 1`, [opened.case_id]);
    const other = (
      await as(ANA).rpc("save_proceeding", {
        target_case: opened.case_id,
        target_proceeding: null,
        target_fields: {
          kind: "juizado",
          court: "TJGO",
          system: "projudi",
          comarca: "Goiânia",
          status: "filed",
          cnj: composeCnj({ sequence: 5900102, year: 2099, court: "09", origin: 51 }),
        },
        target_parties: [party.id],
      })
    ).data as Row;
    const saved = (
      await as(ANA).rpc("save_hearing", {
        target_hearing: null,
        target_proceeding: other.proceeding_id,
        target_fields: { kind: "una", mode: "presencial", day: day(45), time: "13:00", place: "Fórum de Goiânia" },
      })
    ).data as Row;
    const gone = String(saved.id);
    await syncHearings(backend() as never, { hearingId: gone }, google);
    const events = google.calendars.get(calendarId)?.events;
    expect(events?.has(eventIdOf(gone))).toBe(true);

    // The lawsuit goes, its hearing with it: the sweep owes Google the removal of its event.
    await sql.unsafe(`delete from public.proceedings where id = $1`, [other.proceeding_id]);
    const swept = await syncHearings(backend() as never, {}, google);
    expect(swept.removed).toBe(1);
    expect(events?.has(eventIdOf(gone))).toBe(false);
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from public.hearing_event_removals where org_id = $1`, [
      FIRM,
    ]);
    expect(n).toBe(0);
  });

  it("stops the calendar when the grant no longer holds, gives the hearing's try back, and takes it again once connected", async () => {
    const { syncHearings } = await import("@/lib/hearings/calendar-work");
    const saved = (
      await as(ANA).rpc("save_hearing", {
        target_hearing: null,
        target_proceeding: lawsuitId,
        target_fields: { kind: "una", mode: "presencial", day: day(30), time: "09:00", place: "Fórum de Goiânia" },
      })
    ).data as Row;
    const second = String(saved.id);
    // The account took ONE's permission back.
    google.grants.delete(refreshToken);
    const report = await syncHearings(backend() as never, { hearingId: second }, google);
    expect(report).toMatchObject({ claimed: 1, synced: 0, lost: 1 });
    expect(await calendarOf()).toMatchObject({ status: "lost", problem: "auth" });
    expect(await hearingOf(second)).toMatchObject({ synced_revision: null, claimed: false, sync_attempts: 0 });
    // Nothing is claimed while the calendar is stopped.
    expect((await syncHearings(backend() as never, {}, google)).claimed).toBe(0);

    // Connected again: the same calendar takes the hearings again.
    google.grants.add(refreshToken);
    await backend().rpc("record_firm_calendar", {
      target_org: FIRM,
      target_connection: connectionId,
      target_calendar: calendarId,
      target_name: "Audiências · Souza Advogados",
      target_by: ANA,
    });
    await sql.unsafe(`update public.hearings set sync_retry_after = null where id = $1`, [second]);
    const again = await syncHearings(backend() as never, { hearingId: second }, google);
    expect(again).toMatchObject({ synced: 1 });
    expect(google.calendars.get(calendarId)?.events.has(eventIdOf(second))).toBe(true);
  });

  it("stops the calendar when it was deleted in Google, and says so to the firm", async () => {
    const { syncHearings } = await import("@/lib/hearings/calendar-work");
    const [{ id }] = await sql.unsafe(`select id from public.hearings where org_id = $1 and status = 'scheduled'`, [
      FIRM,
    ]);
    google.calendars.delete(calendarId);
    await as(ANA).rpc("save_hearing", {
      target_hearing: id,
      target_proceeding: null,
      target_fields: { kind: "una", mode: "presencial", day: day(30), time: "10:00", place: "Fórum de Goiânia" },
    });
    const report = await syncHearings(backend() as never, { hearingId: String(id) }, google);
    expect(report.lost).toBe(1);
    expect(await calendarOf()).toMatchObject({ status: "lost", problem: "gone" });
    const today = (await as(ANA).rpc("firm_today", { target_org: FIRM })).data as Row;
    expect(today.calendar_lost).toBe(1);
  });
});
