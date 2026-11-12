// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The check of a case's legs against ANAC's official record, with the app's
 * own worker against a real database: the legs are written as a person
 * writes them, the worker claims them, downloads the months of the record
 * they need (a stand-in serves a file in the form of a real one), finds
 * each leg's flight and records it; then the case screen reads each leg
 * beside what the record says.
 *
 * It runs only when a migrated database is at hand
 * (`npm run test:db:roundtrip`: an embedded PostgreSQL with every migration
 * applied, its address in `ONE_EMBEDDED_DB_URL`); otherwise it is skipped.
 * What stands in is the transport (a client that calls the same functions
 * and reads the same tables PostgREST would, as the same database roles)
 * and ANAC's server.
 *
 * Every person, firm and flight here is invented: real airlines and
 * airports, made-up numbers and times.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: false, hint: "no job runner in this test" }) }));

const DB_URL = process.env.ONE_EMBEDDED_DB_URL ?? "";

type Row = Record<string, unknown>;
type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<Row[]>;
  begin: <T>(run: (transaction: Sql) => Promise<T>) => Promise<T>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

let sql: Sql;

const signatures = new Map<string, { types: Map<string, string>; rows: boolean }>();
async function signatureOf(name: string) {
  const known = signatures.get(name);
  if (known) return known;
  const found = await sql.unsafe(
    `select a.name, format_type(a.type, null) as type, p.proretset as rows
     from pg_proc p
     cross join lateral unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) as a (name, type)
     where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [name],
  );
  const signature = {
    types: new Map(found.map((row) => [String(row.name), String(row.type)])),
    rows: Boolean(found[0]?.rows),
  };
  signatures.set(name, signature);
  return signature;
}

function asText(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type.endsWith("[]") && Array.isArray(value)) return `{${value.join(",")}}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A stand-in for the Supabase client, as far as the check uses one: `rpc`, and plain reads of a table. */
function clientAs(role: "service_role" | "authenticated", claims: Row) {
  const as = async <T>(work: (transaction: Sql) => Promise<T>): Promise<T> =>
    sql.begin(async (transaction) => {
      await transaction.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await transaction.unsafe(`set local role ${role}`);
      return work(transaction);
    });
  return {
    async rpc(name: string, args: Row = {}) {
      try {
        const signature = await signatureOf(name);
        const keys = Object.keys(args).filter((key) => args[key] !== undefined);
        for (const key of keys) if (!signature.types.has(key)) throw new Error(`${name} has no argument ${key}`);
        const call = keys.map((key, index) => `${key} => $${index + 1}::text::${signature.types.get(key)}`).join(", ");
        const params = keys.map((key) => asText(args[key], signature.types.get(key) as string));
        const found = await as((transaction) =>
          transaction.unsafe(
            signature.rows ? `select * from public.${name}(${call})` : `select public.${name}(${call}) as result`,
            params,
          ),
        );
        return { data: signature.rows ? found : (found[0]?.result ?? null), error: null };
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        return { data: null, error: { code: failure.code, message: failure.message ?? "failed" } };
      }
    },
    from(table: string) {
      let columns = "*";
      const filters: { clause: string; value: string }[] = [];
      const run = () =>
        as((transaction) =>
          transaction.unsafe(
            `select ${columns} from public.${table}${filters.length ? ` where ${filters.map((filter, index) => filter.clause.replace("?", `$${index + 1}`)).join(" and ")}` : ""}`,
            filters.map((filter) => filter.value),
          ),
        );
      const builder = {
        select(wanted: string) {
          columns = wanted;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ clause: `${column}::text = ?::text`, value: String(value) });
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push({
            clause: `${column}::text = any(string_to_array(?::text, ','))`,
            value: values.map(String).join(","),
          });
          return builder;
        },
        async maybeSingle() {
          try {
            return { data: (await run())[0] ?? null, error: null };
          } catch (error) {
            return { data: null, error: { message: String(error) } };
          }
        },
        then<A, B>(
          resolve: (value: { data: Row[] | null; error: { message: string } | null }) => A,
          reject?: (reason: unknown) => B,
        ) {
          return run()
            .then(
              (rows) => ({ data: rows, error: null }),
              (error: unknown) => ({ data: null, error: { message: String(error) } }),
            )
            .then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const backend = () => clientAs("service_role", { role: "service_role" });
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => backend() }));

const ANA = "ad400000-0000-4000-8000-000000000001";
const RUI = "ad400000-0000-4000-8000-000000000003";
const FIRM = "bd400000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "bd400000-0000-4000-8000-00000000000b";
const asAna = () => clientAs("authenticated", { sub: ANA, role: "authenticated", aal: "aal2" });
const asRui = () => clientAs("authenticated", { sub: RUI, role: "authenticated", aal: "aal2" });

/** A month of the record in the form of a file of August 2026, read on 2026-10-10. */
const HEADER =
  "Sigla ICAO Empresa Aérea;Empresa Aérea;Número Voo;Código DI;Código Tipo Linha;Modelo Equipamento;Número de Assentos;Sigla ICAO Aeroporto Origem;Descrição Aeroporto Origem;Partida Prevista;Partida Real;Sigla ICAO Aeroporto Destino;Descrição Aeroporto Destino;Chegada Prevista;Chegada Real;Situação Voo;Justificativa;Referência;Situação Partida;Situação Chegada;Codeshare";
const AUGUST = [
  HEADER,
  "TAM;TAM LINHAS AÉREAS S.A.;3418;0;N;A320;180;SBGO;SANTA GENOVEVA - GOIÂNIA - GO - BRASIL;05/08/2026 08:00;05/08/2026 12:20;SBSP;CONGONHAS - SÃO PAULO - SP - BRASIL;05/08/2026 09:40;05/08/2026 14:05;REALIZADO;;05/08/2026 00:00:00;Atraso > 240;Atraso > 240;",
  "GLO;GOL LINHAS AÉREAS S.A.;1000;0;N;B738;186;SBGR;GUARULHOS - SP - BRASIL;05/08/2026 06:00;05/08/2026 06:02;SBBR;BRASÍLIA - DF - BRASIL;05/08/2026 07:40;05/08/2026 07:38;REALIZADO;;05/08/2026 00:00:00;Pontual;Antecipado;AZU/7800, GLO/6804",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;4567;0;N;A20N;174;SBKP;VIRACOPOS - CAMPINAS - SP - BRASIL;31/08/2026 21:00;;SBRF;GUARARAPES - RECIFE - PE - BRASIL;01/09/2026 00:10;;CANCELADO;;31/08/2026 00:00:00;;;",
  // Its aircraft went on by a stop at Salvador no schedule foresaw (4); the repositioning after it (6) carried nobody.
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;4;N;A20N;174;SBSV;SALVADOR - BA - BRASIL;;01/09/2026 01:05;SBRF;GUARARAPES - RECIFE - PE - BRASIL;;01/09/2026 02:10;REALIZADO;;31/08/2026 00:00:00;;;",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;4;N;A20N;174;SBKP;VIRACOPOS - CAMPINAS - SP - BRASIL;;31/08/2026 21:10;SBSV;SALVADOR - BA - BRASIL;;31/08/2026 23:20;REALIZADO;;31/08/2026 00:00:00;;;",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;6;N;A20N;174;SBRF;GUARARAPES - RECIFE - PE - BRASIL;;01/09/2026 04:00;SBKP;VIRACOPOS - CAMPINAS - SP - BRASIL;;01/09/2026 07:10;REALIZADO;;31/08/2026 00:00:00;;;",
  // Another airline's flight with the same number: never the leg's.
  "AAL;AMERICAN AIRLINES, INC.;3418;0;I;B772;288;KMIA;MIAMI - ESTADOS UNIDOS DA AMÉRICA;05/08/2026 08:00;05/08/2026 08:10;SBGL;GALEÃO - RIO DE JANEIRO - RJ - BRASIL;05/08/2026 16:20;05/08/2026 16:30;REALIZADO;;05/08/2026 00:00:00;;;",
].join("\r\n");

/** ANAC's server: August is out, September not yet, April never came. */
function anac() {
  const asked: string[] = [];
  const run = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.endsWith("/2026/VRA_2026_08.csv")) {
      // Sent in pieces, as a large file arrives: a line may be cut between two of them.
      const bytes = new TextEncoder().encode(AUGUST);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += 97) controller.enqueue(bytes.slice(at, at + 97));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    return new Response("<html>not found</html>", { status: 404 });
  }) as typeof fetch;
  return { run, asked };
}

const NOW = () => Date.parse("2026-10-10T12:00:00Z");

describe.skipIf(!DB_URL)("the legs of a case, checked against ANAC's official record", () => {
  let caseId = "";
  const legs: Record<string, string> = {};

  const statusOf = async (segment: string) =>
    (
      await sql.unsafe(
        `select status, matched_by, month, record, work_error from public.flight_checks where segment_id = $1 and source = 'vra'`,
        [segment],
      )
    )[0];

  beforeAll(async () => {
    const root = path.resolve(process.cwd(), "..", "..");
    const cacheRequire = createRequire(path.join(root, ".cache", "db-embedded", "package.json"));
    const postgres = cacheRequire("postgres") as (url: string, options: object) => Sql;
    sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} });

    await sql.unsafe(`
      delete from public.organizations where id in ('${FIRM}', '${OTHER_FIRM}');
      delete from auth.users where id in ('${ANA}', '${RUI}');
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('${ANA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@voos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
             ('${RUI}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rui@voos.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());
      insert into public.organizations (id, name, slug, created_by) values
        ('${FIRM}', 'Souza Advogados', 'souza-voos-app', '${ANA}'),
        ('${OTHER_FIRM}', 'Costa Advocacia', 'costa-voos-app', '${RUI}');
      insert into public.memberships (org_id, user_id, role, firm_function) values
        ('${FIRM}', '${ANA}', 'owner', 'socio'), ('${OTHER_FIRM}', '${RUI}', 'owner', 'socio');
    `);
    const opened = await asAna().rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "LA",
      target_flight_date: "2026-08-05",
      target_client: { full_name: "Maria Teste" },
    });
    caseId = String((opened.data as Row).case_id);
    const write = async (name: string, fields: Row) => {
      const saved = await asAna().rpc("save_flight_segment", {
        target_case: caseId,
        target_segment: null,
        target_fields: fields,
      });
      legs[name] = String((saved.data as Row).segment_id);
    };
    // The leg the case says arrived at 15:00: the record says 14:05.
    await write("late", {
      flight_number: "LA3418",
      origin_iata: "GYN",
      destination_iata: "CGH",
      scheduled_departure_local: "2026-08-05T08:00",
      scheduled_arrival_local: "2026-08-05T09:40",
      actual_arrival_local: "2026-08-05T15:00",
    });
    // A ticket of Azul for a flight Gol operates.
    await write("shared", {
      flight_number: "AD7800",
      origin_iata: "GRU",
      destination_iata: "BSB",
      scheduled_departure_local: "2026-08-05T06:00",
    });
    // A flight the record does not have.
    await write("unknown", {
      flight_number: "G39999",
      origin_iata: "GRU",
      destination_iata: "REC",
      scheduled_departure_local: "2026-08-10T10:00",
    });
    // A flight of September: not out yet.
    await write("recent", {
      flight_number: "G31234",
      origin_iata: "GRU",
      destination_iata: "SDU",
      scheduled_departure_local: "2026-09-20T10:00",
    });
    // The last day of August: looked for in August and September; cancelled.
    await write("cancelled", {
      flight_number: "AD4567",
      origin_iata: "VCP",
      destination_iata: "REC",
      scheduled_departure_local: "2026-08-31T21:00",
    });
    // April: a month that never came.
    await write("old", {
      flight_number: "G35555",
      origin_iata: "GRU",
      destination_iata: "POA",
      scheduled_departure_local: "2026-04-10T10:00",
    });
  }, 120_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("checks every leg the record can answer, a few months of the record a run, each downloaded once", async () => {
    const { checkFlights } = await import("@/modules/direito-do-passageiro/flights/checks-work");
    const server = anac();
    const first = await checkFlights(backend() as never, { fetch: server.run, now: NOW });
    // August and September in this run; April waits for the next one, with no attempt spent.
    expect(first).toMatchObject({ found: 3, not_found: 1, not_published: 1, later: 1, retry: 0, failed: 0 });
    expect(server.asked).toEqual([
      "https://siros.anac.gov.br/siros/registros/diversos/vra/2026/VRA_2026_08.csv",
      "https://siros.anac.gov.br/siros/registros/diversos/vra/2026/VRA_2026_09.csv",
    ]);

    expect(await statusOf(legs.late)).toMatchObject({ status: "found", matched_by: "operator", month: "2026-08" });
    expect((await statusOf(legs.late)).record).toMatchObject({
      airline: "TAM",
      number: "3418",
      actualArrival: "2026-08-05T14:05",
    });
    expect(await statusOf(legs.shared)).toMatchObject({ status: "found", matched_by: "codeshare" });
    expect(await statusOf(legs.cancelled)).toMatchObject({
      status: "found",
      record: expect.objectContaining({ state: "cancelado" }),
    });
    expect((await statusOf(legs.cancelled)).record).toMatchObject({
      reference: "2026-08-31",
      unscheduled: [
        {
          origin: "SBKP",
          destination: "SBSV",
          actualDeparture: "2026-08-31T21:10",
          actualArrival: "2026-08-31T23:20",
          kind: "included",
        },
        {
          origin: "SBSV",
          destination: "SBRF",
          actualDeparture: "2026-09-01T01:05",
          actualArrival: "2026-09-01T02:10",
          kind: "included",
        },
      ],
    });
    expect(await statusOf(legs.unknown)).toMatchObject({ status: "not_found", month: "2026-08" });
    expect(await statusOf(legs.recent)).toMatchObject({ status: "not_published", month: "2026-09" });

    // The next run reaches April: gone for half a year, it is not coming. Its file was never read, so the leg is
    // never "not found": the check is given up saying why, and a person asks again.
    const second = anac();
    const next = await checkFlights(backend() as never, { fetch: second.run, now: NOW });
    expect(next).toMatchObject({ failed: 1, not_found: 0 });
    expect(second.asked).toEqual(["https://siros.anac.gov.br/siros/registros/diversos/vra/2026/VRA_2026_04.csv"]);
    expect(await statusOf(legs.old)).toMatchObject({ status: "failed", work_error: "vra_month_missing" });
    // Nothing is left owed: a month not out yet waits for its day.
    expect(await checkFlights(backend() as never, { fetch: anac().run, now: NOW })).toMatchObject({
      found: 0,
      not_found: 0,
    });
  });

  it("shows each leg beside what the record says, in each airport's own time", async () => {
    const { loadFlightChecks } = await import("@/modules/direito-do-passageiro/flights/facts");
    const segments = await sql.unsafe(
      `select id, flight_number, origin_iata, destination_iata,
              to_char(scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI') as scheduled_departure_local,
              to_char(actual_arrival_local, 'YYYY-MM-DD"T"HH24:MI') as actual_arrival_local
       from public.flight_segments where case_id = $1`,
      [caseId],
    );
    const read = await loadFlightChecks(asAna() as never, FIRM, caseId, segments as never, "America/Sao_Paulo");
    expect(read.toleranceMinutes).toBe(15);
    expect(read.lookupAvailable).toBe(false);

    const late = read.bySegment[legs.late].vra;
    expect(late?.comparison).toMatchObject({
      agreement: "differs",
      actualArrivalDifference: 55,
      arrivalDelayMinutes: 265,
    });
    expect(late?.times?.actualArrival).toEqual({ wall: "2026-08-05T14:05", basis: "airport" });
    expect(late?.operatedAs).toBeNull();

    const shared = read.bySegment[legs.shared].vra;
    expect(shared?.operatedAs).toBe("GLO 1000");
    expect(shared?.comparison?.agreement).toBe("agrees");

    const cancelled = read.bySegment[legs.cancelled].vra;
    expect(cancelled?.comparison).toMatchObject({ agreement: "cancelled", reachedDestinationDelayMinutes: 120 });
    // The legs no schedule foresaw, by the codes a ticket prints, in each airport's own time.
    expect(cancelled?.unscheduled).toEqual([
      {
        origin: "VCP",
        destination: "SSA",
        departure: { wall: "2026-08-31T21:10", basis: "airport" },
        arrival: { wall: "2026-08-31T23:20", basis: "airport" },
        kind: "included",
      },
      {
        origin: "SSA",
        destination: "REC",
        departure: { wall: "2026-09-01T01:05", basis: "airport" },
        arrival: { wall: "2026-09-01T02:10", basis: "airport" },
        kind: "included",
      },
    ]);
    expect(cancelled?.reachedDestination).toEqual({ wall: "2026-09-01T02:10", basis: "airport" });
    expect(late?.unscheduled).toEqual([]);
    expect(read.bySegment[legs.recent].vra?.status).toBe("not_published");
    expect(read.bySegment[legs.unknown].vra?.status).toBe("not_found");
    expect(read.bySegment[legs.late].flightaware).toBeNull();

    // A person of another firm reads nothing of it.
    const theirs = await loadFlightChecks(asRui() as never, FIRM, caseId, segments as never, null);
    expect(Object.values(theirs.bySegment).every((checks) => checks.vra === null && checks.flightaware === null)).toBe(
      true,
    );
  });

  it("starts the check of a leg over when its flight changes, and keeps it when only its arrival does", async () => {
    const { checkFlights } = await import("@/modules/direito-do-passageiro/flights/checks-work");
    await asAna().rpc("save_flight_segment", {
      target_case: caseId,
      target_segment: legs.late,
      target_fields: { actual_arrival_local: "2026-08-05T14:05" },
    });
    expect((await statusOf(legs.late)).status).toBe("found");
    await asAna().rpc("save_flight_segment", {
      target_case: caseId,
      target_segment: legs.unknown,
      target_fields: {
        flight_number: "G31000",
        destination_iata: "BSB",
        scheduled_departure_local: "2026-08-05T06:00",
      },
    });
    expect((await statusOf(legs.unknown)).status).toBe("waiting");
    const again = await checkFlights(backend() as never, { fetch: anac().run, now: NOW });
    expect(again.found).toBe(1);
    expect(await statusOf(legs.unknown)).toMatchObject({ status: "found", matched_by: "operator" });
  });

  it("marks the leg of the problem by itself: the one the record gives as late, and none while it cannot tell", async () => {
    const { checkFlights } = await import("@/modules/direito-do-passageiro/flights/checks-work");
    // The case above still has legs the record could not answer: ONE marks none of them.
    const marked = (await sql.unsafe(
      `select count(*)::int as count from public.flight_segments where case_id = $1 and affected`,
      [caseId],
    )) as { count: number }[];
    expect(marked[0].count).toBe(0);

    // A trip of two legs: the record gives the first as four hours late and the second as on time.
    const opened = await asAna().rpc("create_case", {
      target_org: FIRM,
      target_incident: "delay",
      target_airline: "LA",
      target_flight_date: "2026-08-05",
      target_client: { full_name: "Joana Teste" },
    });
    const trip = String((opened.data as Row).case_id);
    const leg = async (fields: Row) =>
      String(
        (
          (await asAna().rpc("save_flight_segment", { target_case: trip, target_segment: null, target_fields: fields }))
            .data as Row
        ).segment_id,
      );
    const late = await leg({
      flight_number: "LA3418",
      origin_iata: "GYN",
      destination_iata: "CGH",
      scheduled_departure_local: "2026-08-05T08:00",
      scheduled_arrival_local: "2026-08-05T09:40",
    });
    const onTime = await leg({
      flight_number: "AD7800",
      origin_iata: "GRU",
      destination_iata: "BSB",
      scheduled_departure_local: "2026-08-05T06:00",
    });
    await checkFlights(backend() as never, { fetch: anac().run, now: NOW });

    const legsOf = (await sql.unsafe(
      `select id, affected, affected_by from public.flight_segments where case_id = $1`,
      [trip],
    )) as { id: string; affected: boolean; affected_by: string | null }[];
    expect(legsOf.find((row) => row.id === late)).toMatchObject({ affected: true, affected_by: "one" });
    expect(legsOf.find((row) => row.id === onTime)).toMatchObject({ affected: false, affected_by: null });
    const told = (await sql.unsafe(
      `select actor_type, data ->> 'flight' as flight from public.case_events where case_id = $1 and kind = 'leg_marked_by_one'`,
      [trip],
    )) as { actor_type: string; flight: string }[];
    expect(told).toEqual([{ actor_type: "system", flight: "LA3418" }]);
  });
});
