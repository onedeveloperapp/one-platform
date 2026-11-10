// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";

/**
 * The firm's own passenger (migration 0170), with the app's own actions against a real database and the test chat
 * where the passenger's phone stands: the firm registers a passenger with the test WhatsApp, the identity it sent and
 * the trip, ONE follows the trip in the test chat, the flight is cancelled, the passenger answers SIM, and ONE opens
 * the case with the firm's person (no second record) and the identity as the case's document; the same CPF under
 * another name is the same person; the firm stops following a trip.
 *
 * It runs only when a migrated database is at hand (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm and number here is invented; the CPF is one manuals use as an example.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => undefined,
}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));
vi.mock("@/lib/whatsapp/session", () => ({ isSupportVisit: async () => false }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae970000-0000-4000-8000-000000000001";
const FIRM = "be970000-0000-4000-8000-00000000000a";
const CONNECTION = "de970000-0000-4000-8000-00000000000a";
const IDENTITY = "fe970000-0000-4000-8000-000000000001";
const TOKEN = "p".repeat(43);

vi.mock("@/lib/member/context", () => ({
  getMemberContext: async () => ({
    userId: ANA,
    firm: { id: FIRM, name: "Souza Advogados", role: "owner", firmFunction: "atendimento" },
    supabase: clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" }),
    profile: { timezone: "America/Sao_Paulo" },
  }),
}));

async function ok(result: { data: unknown; error: { message: string } | null }): Promise<Row> {
  expect(result.error).toBeNull();
  const answer = result.data as Row;
  expect(answer.ok, JSON.stringify(answer)).toBe(true);
  return answer;
}

/** A trip in so many days, at the airports' own time. */
function legsInDays(days: number) {
  const day = new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return [
    {
      flight_number: "LA3456",
      origin_iata: "GYN",
      destination_iata: "GRU",
      scheduled_departure_local: `${day}T08:00`,
      scheduled_arrival_local: `${day}T09:45`,
    },
  ];
}

describe.skipIf(!DB_URL)("a passenger the firm registers itself", () => {
  let personId = "";
  let tripId = "";
  // ONE takes a conversation's turn some seconds after the passenger's last message: none here.
  let debounce: unknown = null;

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    [{ debounce }] = await sql.unsafe(
      `select value -> 'debounce_seconds' as debounce from public.platform_settings where key = 'conversation_agent'`,
    );
    await sql.unsafe(
      `update public.platform_settings set value = jsonb_set(value, '{debounce_seconds}', '0') where key = 'conversation_agent'`,
    );
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@passageiro-escritorio.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-passageiro-escritorio', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'atendimento');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION}', '${FIRM}', 'whatsapp', 'test-waba-pax', 'Chat de teste', 'connected', '${ANA}', now());
      insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
        detected_mime, expires_at, confirmed_at, uploaded_by)
      values ('${IDENTITY}', '${FIRM}', 'upload', 'org/${FIRM}/upload/${IDENTITY}', 'rg.jpg', 'image/jpeg', 100, 'stored',
        repeat('a', 64), 100, 'image/jpeg', now() + interval '1 hour', now(), '${ANA}');
    `);
    const number = await ok(
      await backend().rpc("register_wa_number", {
        target_org: FIRM,
        target_connection: CONNECTION,
        target_provider: "test",
        target_phone_number_id: "test-number-pax",
        target_waba_id: "test-waba-pax",
        target_display_phone_number: "5500900000097",
        target_verified_name: "Souza Advogados",
        target_mode: "cloud",
      }),
    );
    await ok(
      await backend().rpc("start_test_chat", {
        target_org: FIRM,
        target_number: number.number_id,
        target_token: TOKEN,
        target_by: ANA,
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    if (debounce !== null && debounce !== undefined) {
      await sql.unsafe(
        `update public.platform_settings set value = jsonb_set(value, '{debounce_seconds}', $1::jsonb) where key = 'conversation_agent'`,
        [JSON.stringify(debounce)],
      );
    }
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("registers the passenger at the test WhatsApp and has ONE follow the trip there, the identity kept with it", async () => {
    const { personTrips, registerPassenger } = await import("@/modules/direito-do-passageiro/passengers/actions");
    const result = await registerPassenger({
      person: { full_name: "Mariana Teste", cpf: "52998224725", phone: "00988880001" },
      legs: legsInDays(3),
      how: "whatsapp",
      documents: [{ fileId: IDENTITY, kind: "identity" }],
    });
    expect(result).toMatchObject({ ok: true, reused: false, test: true });
    personId = result.ok ? result.personId : "";

    const trips = await personTrips(personId);
    expect(trips).toHaveLength(1);
    expect(trips?.[0]).toMatchObject({ status: "watching", test: true, documents: 1 });
    tripId = trips?.[0]?.id ?? "";

    const { readTestChat } = await import("@/lib/test-chat/actions");
    const read = await readTestChat(TOKEN);
    expect(read.ok && read.view.trips.map((trip) => [trip.label, trip.passengerName])).toEqual([
      ["escritorio", "Mariana Teste"],
    ]);
  });

  it("refuses a trip that ended and a passenger with no WhatsApp", async () => {
    const { registerPassenger } = await import("@/modules/direito-do-passageiro/passengers/actions");
    expect(await registerPassenger({ personId, legs: legsInDays(-5), how: "telefone", documents: [] })).toMatchObject({
      ok: false,
      code: "trip_past",
    });
    expect(
      await registerPassenger({
        person: { full_name: "Rui Teste" },
        legs: legsInDays(3),
        how: "telefone",
        documents: [],
      }),
    ).toMatchObject({ ok: false, code: "no_phone" });
  });

  it("opens the case at the passenger's yes with the firm's person and the identity", async () => {
    const { runTestTool, sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    expect(await runTestTool(TOKEN, tripId, "cancel")).toEqual({ ok: true, code: "told" });
    expect(await sendTestMessage(TOKEN, tripId, { reply: "SIM" })).toEqual({ ok: true, code: "delivered" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ claimed: 1, opened: 1 });

    const cases = await sql.unsafe(
      `select c.id, c.is_test, cp.person_id from public.cases c
       join public.case_parties cp on cp.case_id = c.id and cp.role = 'claimant'
       where c.org_id = $1`,
      [FIRM],
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ is_test: true, person_id: personId });
    const [people] = await sql.unsafe(`select count(*)::int as n from public.people where org_id = $1`, [FIRM]);
    expect(people.n).toBe(1);

    const documents = await sql.unsafe(
      `select d.kind, d.source, d.status, d.file_id, pp.person_id from public.case_documents d
       left join public.case_parties pp on pp.id = d.party_id
       where d.case_id = $1`,
      [cases[0].id],
    );
    expect(documents).toEqual([
      { kind: "identity", source: "firm", status: "received", file_id: IDENTITY, person_id: personId },
    ]);
    const [kept] = await sql.unsafe(`select count(*)::int as n from public.tracked_trip_documents where org_id = $1`, [
      FIRM,
    ]);
    expect(kept.n).toBe(0);

    const { personTrips } = await import("@/modules/direito-do-passageiro/passengers/actions");
    const trips = await personTrips(personId);
    expect(trips?.[0]).toMatchObject({ status: "case_opened", caseId: cases[0].id, documents: 0 });
  });

  it("takes the same CPF as the same person, and stops following a trip", async () => {
    const { personTrips, registerPassenger, stopFollowing } = await import(
      "@/modules/direito-do-passageiro/passengers/actions"
    );
    const again = await registerPassenger({
      person: { full_name: "Outro Nome", cpf: "529.982.247-25", phone: "62999990001" },
      legs: legsInDays(10),
      how: "telefone",
      documents: [],
    });
    expect(again).toMatchObject({ ok: true, personId, reused: true });

    // The test chat holds one passenger of the firm: the new trip takes the place of the one that became the case,
    // which stays.
    const trips = await personTrips(personId);
    expect(trips?.map((trip) => trip.status)).toEqual(["watching"]);
    const [cases] = await sql.unsafe(`select count(*)::int as n from public.cases where org_id = $1`, [FIRM]);
    expect(cases.n).toBe(1);
    expect(await stopFollowing({ tripId: trips?.[0]?.id ?? "", personId })).toEqual({ ok: true, code: "stopped" });
    expect((await personTrips(personId))?.map((trip) => trip.status)).toEqual(["stopped"]);
  });

  it("follows the way back of a trip whose way out became a case, and opens its own case at its yes (0172)", async () => {
    const { registerPassenger } = await import("@/modules/direito-do-passageiro/passengers/actions");
    const { runTestTool, sendTestMessage } = await import("@/lib/test-chat/actions");
    const { takeConversationTurns } = await import("@/lib/conversations/agent-work");
    const day = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const roundTrip = await registerPassenger({
      personId,
      legs: [
        {
          flight_number: "LA3456",
          origin_iata: "GYN",
          destination_iata: "GRU",
          scheduled_departure_local: `${day(3)}T08:00`,
          scheduled_arrival_local: `${day(3)}T09:45`,
        },
        {
          flight_number: "LA3457",
          origin_iata: "GRU",
          destination_iata: "GYN",
          scheduled_departure_local: `${day(10)}T18:00`,
          scheduled_arrival_local: `${day(10)}T19:45`,
        },
      ],
      how: "whatsapp",
      documents: [],
    });
    expect(roundTrip).toMatchObject({ ok: true, test: true });
    const [{ id: trip }] = await sql.unsafe(
      `select id from public.tracked_trips where org_id = $1 and label = 'escritorio'`,
      [FIRM],
    );
    const before = await sql.unsafe(`select id from public.cases where org_id = $1`, [FIRM]);
    const casesSince = async () =>
      sql.unsafe(
        `select c.id, array_agg(s.flight_number order by s.position) as flights
         from public.cases c join public.flight_segments s on s.case_id = c.id
         where c.org_id = $1 and not (c.id = any ($2::uuid[]))
         group by c.id, c.created_at order by c.created_at`,
        [FIRM, before.map((row) => String(row.id))],
      );

    // The way out is cancelled: the yes opens a case of that journey alone.
    expect(await runTestTool(TOKEN, String(trip), "cancel")).toEqual({ ok: true, code: "told" });
    expect(await sendTestMessage(TOKEN, String(trip), { reply: "SIM" })).toEqual({ ok: true, code: "delivered" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 1 });
    expect((await casesSince()).map((row) => row.flights)).toEqual([["LA3456"]]);

    // The way back lands six hours late: ONE still follows it, tells it, and its yes opens a case of its own.
    expect(await runTestTool(TOKEN, String(trip), "late_6h")).toEqual({ ok: true, code: "told" });
    expect(await sendTestMessage(TOKEN, String(trip), { reply: "SIM" })).toEqual({ ok: true, code: "delivered" });
    expect(await takeConversationTurns(backend() as never)).toMatchObject({ opened: 1 });
    expect((await casesSince()).map((row) => row.flights)).toEqual([["LA3456"], ["LA3457"]]);
    const [kept] = await sql.unsafe(
      `select t.status, (select count(*)::int from public.tracked_legs l where l.trip_id = t.id and l.case_id is null) as open
       from public.tracked_trips t where t.id = $1`,
      [trip],
    );
    expect(kept).toEqual({ status: "case_opened", open: 0 });
  });
});
