// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connect, DB_URL, type Row, type Sql, standIn } from "@/lib/testing/embedded-db";
import { FakeFlightData } from "@flyee/flights/fake";

/**
 * ONE following flights at their source (migration 0051), with the app's own
 * actions and worker against a real database, FlightAware's fake where
 * AeroAPI stands and the test chat's provider where the vendor stands: the
 * test chat follows a real flight its tester names, read at once, and when
 * the source says it will land five hours late ONE writes its first word in
 * the test chat; a real passenger's cancelled flight is kept as an alert and
 * not told while the platform has not released ONE's first word to real
 * passengers; a flight the source does not know is said so, and nothing is
 * told of it.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`); otherwise it is skipped.
 *
 * Every person, firm, number and flight here is invented.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

/** FlightAware, as a test declares what its flights do. */
const flights = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/flights/status", () => ({ flightStatusProvider: () => flights.data }));

let sql: Sql;
let clientAs: ReturnType<typeof standIn>;
const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ae960000-0000-4000-8000-000000000001";
const FIRM = "be960000-0000-4000-8000-00000000000a";
const CONNECTION = "de960000-0000-4000-8000-00000000000a";
const TOKEN = "w".repeat(43);
const SOFIA = "5500988880005";

async function call(name: string, args: Row): Promise<Row> {
  const { data, error } = await backend().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return (data ?? {}) as Row;
}

/** An instant some whole minutes from now, ISO. */
const inMinutes = (minutes: number) =>
  new Date(Math.floor((Date.now() + minutes * 60_000) / 60_000) * 60_000).toISOString();
/** The day of an instant in Brasília, "YYYY-MM-DD": the day a flight leaving then is of. */
const dayOf = (instant: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(instant));

describe.skipIf(!DB_URL)("ONE following flights at their source", () => {
  const fake = new FakeFlightData();
  flights.data = fake;

  beforeAll(async () => {
    sql = connect();
    clientAs = standIn(sql);
    await sql.unsafe(`
      delete from public.organizations where id = '${FIRM}';
      delete from auth.users where id = '${ANA}';
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@voo-real.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values ('${FIRM}', 'Souza Advogados', 'souza-voo-real', '${ANA}');
      insert into public.memberships (org_id, user_id, role, firm_function) values ('${FIRM}', '${ANA}', 'owner', 'socio');
      insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
        ('${CONNECTION}', '${FIRM}', 'whatsapp', 'test-waba-voo-real', 'Chat de teste', 'connected', '${ANA}', now());
    `);
    const number = await call("register_wa_number", {
      target_org: FIRM,
      target_connection: CONNECTION,
      target_provider: "test",
      target_phone_number_id: "test-number-voo-real",
      target_waba_id: "test-waba-voo-real",
      target_display_phone_number: "5500900000096",
      target_verified_name: "Souza Advogados",
      target_mode: "cloud",
    });
    await call("start_test_chat", {
      target_org: FIRM,
      target_number: number.number_id,
      target_token: TOKEN,
      target_by: ANA,
    });
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    // Nothing of this file is left for another file's sweep to find.
    await sql.unsafe(`delete from public.organizations where id = '${FIRM}'`);
    await sql.unsafe(`delete from auth.users where id = '${ANA}'`);
    await sql.end({ timeout: 5 });
  });

  it("follows a real flight the tester names, and writes in the test chat when it will land five hours late", async () => {
    const { followRealFlight } = await import("@/lib/test-chat/actions");
    fake.addFlight({
      flight: "LA3300",
      date: dayOf(inMinutes(60)),
      origin: "GRU",
      destination: "BSB",
      scheduledDeparture: inMinutes(60),
      scheduledArrival: inMinutes(160),
      actualDeparture: inMinutes(-5),
      actualArrival: null,
      estimatedArrival: inMinutes(460),
      originTimeZone: "America/Sao_Paulo",
      destinationTimeZone: "America/Sao_Paulo",
    });
    expect(await followRealFlight(TOKEN, { flight: "LA3300", date: "amanhã" })).toEqual({
      ok: false,
      code: "invalid_flight",
    });
    expect(await followRealFlight(TOKEN, { flight: "LA 9999", date: dayOf(inMinutes(60)) })).toEqual({
      ok: false,
      code: "flight_not_found",
    });
    const followed = await followRealFlight(TOKEN, { flight: "la 3300", date: dayOf(inMinutes(60)) });
    expect(followed).toMatchObject({ ok: true, code: "following" });

    const [trip] = await sql.unsafe(
      `select t.label, t.watch, t.watched_at is not null as read, l.status, l.flight_number,
              extract(epoch from l.estimated_arrival_local - l.scheduled_arrival_local) / 60 as late
       from public.tracked_trips t join public.tracked_legs l on l.trip_id = t.id where t.id = $1`,
      [followed.tripId],
    );
    expect(trip).toMatchObject({
      label: "voo_real",
      watch: "flightaware",
      read: true,
      status: "delayed",
      flight_number: "LA3300",
    });
    expect(Number(trip.late)).toBe(300);

    const told = await sql.unsafe(
      `select m.kind, m.body, m.status from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
       where c.org_id = $1 and c.contact_wa_id = $2 and m.direction = 'out'`,
      [FIRM, SOFIA],
    );
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: "template" });
    expect(String(told[0].body)).toContain("Olá, Sofia.");
    expect(String(told[0].body)).toContain("está previsto para chegar ao destino com 5 horas de atraso");
  });

  it("keeps a real passenger's cancelled flight as an alert, untold until the platform releases it", async () => {
    const { watchTrips } = await import("@/lib/flight-alerts/watch");
    fake.addFlight({
      flight: "G31702",
      date: dayOf(inMinutes(90)),
      origin: "CGH",
      destination: "SDU",
      scheduledDeparture: inMinutes(90),
      scheduledArrival: inMinutes(150),
      actualDeparture: null,
      actualArrival: null,
      state: "cancelled",
    });
    const [real] = await sql.unsafe(
      `with trip as (
         insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel)
         values ($1, 'Helena Teste', '5511988887771', 'G3', 'Concordo em receber avisos sobre a minha viagem.', now(), 'firm')
         returning id)
       insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                        scheduled_departure_local, scheduled_arrival_local)
       select $1, trip.id, 1, 'G31702', 'CGH', 'SDU',
              (now() at time zone 'America/Sao_Paulo')::timestamp(0) + interval '90 minutes',
              (now() at time zone 'America/Sao_Paulo')::timestamp(0) + interval '150 minutes'
       from trip returning trip_id`,
      [FIRM],
    );
    const report = await watchTrips(backend() as never, fake, { tripId: String(real.trip_id) });
    expect(report).toMatchObject({ claimed: 1, read: 1, failed: 0, stopped: false });
    const [alert] = await sql.unsafe(`select kind, status, reason from public.flight_alerts where trip_id = $1`, [
      real.trip_id,
    ]);
    expect(alert).toEqual({ kind: "cancelled", status: "skipped", reason: "not_released" });
    // Read once within the setting's minutes: the next sweep leaves it.
    expect(await watchTrips(backend() as never, fake)).toMatchObject({ claimed: 0 });
  });

  it("says a flight its source does not know, and tells nothing of it", async () => {
    const { watchTrips } = await import("@/lib/flight-alerts/watch");
    const [unknown] = await sql.unsafe(
      `with trip as (
         insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel)
         values ($1, 'Otávio Teste', '5511988887772', 'AD', 'Concordo em receber avisos sobre a minha viagem.', now(), 'firm')
         returning id)
       insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                        scheduled_departure_local, scheduled_arrival_local)
       select $1, trip.id, 1, 'AD9999', 'VCP', 'CNF',
              (now() at time zone 'America/Sao_Paulo')::timestamp(0) + interval '2 hours',
              (now() at time zone 'America/Sao_Paulo')::timestamp(0) + interval '3 hours'
       from trip returning trip_id`,
      [FIRM],
    );
    expect(await watchTrips(backend() as never, fake, { tripId: String(unknown.trip_id) })).toMatchObject({ read: 1 });
    const [trip] = await sql.unsafe(`select watch_error from public.tracked_trips where id = $1`, [unknown.trip_id]);
    expect(trip).toEqual({ watch_error: "flight_not_found" });
    const alerts = await sql.unsafe(`select 1 from public.flight_alerts where trip_id = $1`, [unknown.trip_id]);
    expect(alerts).toHaveLength(0);
  });
});
