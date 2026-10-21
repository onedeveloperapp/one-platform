import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type FakeFlight, FakeFlightData } from "./fake.ts";
import {
  FlightAwareAuthError,
  FlightAwareProvider,
  FlightAwareQueryError,
  FlightAwareUnavailableError,
} from "./providers/flightaware.ts";
import { AnacVraSource } from "./providers/anac-vra.ts";
import { RedemetAuthError, RedemetProvider, RedemetUnavailableError } from "./providers/redemet.ts";
import {
  arrivalDelayMinutes,
  type FlightRecordSource,
  type FlightStatusProvider,
  type Metar,
  type WeatherProvider,
} from "./types.ts";

/** Goiânia to Congonhas, scheduled 08:00 to 09:40 local time (UTC-3). */
const SCHEDULE = {
  date: "2026-10-05",
  origin: "GYN",
  destination: "CGH",
  scheduledDeparture: "2026-10-05T11:00:00Z",
  scheduledArrival: "2026-10-05T12:40:00Z",
};

const FLIGHTS: FakeFlight[] = [
  // Landed 4 hours and 25 minutes late.
  {
    ...SCHEDULE,
    flight: "LA3418",
    actualDeparture: "2026-10-05T15:20:00Z",
    actualArrival: "2026-10-05T17:05:00Z",
  },
  // Did not operate.
  { ...SCHEDULE, flight: "G31234", actualDeparture: null, actualArrival: null, state: "cancelled" },
  // Has not left yet.
  {
    ...SCHEDULE,
    flight: "AD4567",
    date: "2026-10-06",
    scheduledDeparture: "2026-10-06T11:00:00Z",
    scheduledArrival: "2026-10-06T12:40:00Z",
    actualDeparture: null,
    actualArrival: null,
  },
  // Landed somewhere else.
  {
    ...SCHEDULE,
    flight: "LA3420",
    actualDeparture: "2026-10-05T11:10:00Z",
    actualArrival: "2026-10-05T13:30:00Z",
    state: "diverted",
  },
];

const OBSERVATIONS: Metar[] = [
  { icao: "SBGO", observedAt: "2026-10-05T12:00:00Z", raw: "METAR SBGO 051200Z 09008KT 9999 SCT030 27/18 Q1016" },
  { icao: "SBGO", observedAt: "2026-10-05T10:00:00Z", raw: "METAR SBGO 051000Z 00000KT 0800 FG VV002 19/19 Q1017" },
  { icao: "SBGO", observedAt: "2026-10-05T11:00:00Z", raw: "METAR SBGO 051100Z 07004KT 3000 BR BKN005 21/20 Q1017" },
  { icao: "SBSP", observedAt: "2026-10-05T11:00:00Z", raw: "METAR SBSP 051100Z 15006KT 9999 FEW020 20/14 Q1020" },
];

/**
 * What any flight status provider must do, whatever is behind it. It runs
 * against the fake and against FlightAware's AeroAPI in the shapes of its
 * reference.
 */
function flightStatusContract(name: string, make: (flights: FakeFlight[]) => FlightStatusProvider) {
  describe(`flight status contract: ${name}`, () => {
    it("tells what happened to a flight that landed, with the delay counted at the arrival", async () => {
      const status = await make(FLIGHTS).getFlightStatus({ flight: "LA3418", date: "2026-10-05" });
      assert.equal(status?.state, "landed");
      assert.equal(status?.arrivalDelayMinutes, 265);
      assert.equal(status?.origin, "GYN");
      assert.equal(status?.destination, "CGH");
    });

    it("has no arrival and no delay for a flight that was cancelled or has not left", async () => {
      const provider = make(FLIGHTS);
      const cancelled = await provider.getFlightStatus({ flight: "G31234", date: "2026-10-05" });
      assert.equal(cancelled?.state, "cancelled");
      assert.equal(cancelled?.actualArrival, null);
      assert.equal(cancelled?.arrivalDelayMinutes, null);

      const scheduled = await provider.getFlightStatus({ flight: "AD4567", date: "2026-10-06" });
      assert.equal(scheduled?.state, "scheduled");
      assert.equal(scheduled?.arrivalDelayMinutes, null);
    });

    it("counts no delay at the destination for a flight that landed somewhere else", async () => {
      const diverted = await make(FLIGHTS).getFlightStatus({ flight: "LA3420", date: "2026-10-05" });
      assert.equal(diverted?.state, "diverted");
      assert.equal(diverted?.arrivalDelayMinutes, null);
    });

    it("does not know a flight on another day, or a flight that does not exist", async () => {
      const provider = make(FLIGHTS);
      assert.equal(await provider.getFlightStatus({ flight: "LA3418", date: "2026-10-04" }), null);
      assert.equal(await provider.getFlightStatus({ flight: "XX0000", date: "2026-10-05" }), null);
    });

    it("reads the flight code whatever its case or spacing, and answers it normalized", async () => {
      const status = await make(FLIGHTS).getFlightStatus({ flight: "la 3418", date: "2026-10-05" });
      assert.equal(status?.flight, "LA3418");
    });
  });
}

/** The same for the weather: the REDEMET provider (M2) joins with recorded responses. */
function weatherContract(name: string, make: (observations: Metar[]) => WeatherProvider) {
  describe(`weather contract: ${name}`, () => {
    it("lists the observations of the airport inside the window, oldest first", async () => {
      const listed = await make(OBSERVATIONS).getMetar({
        icao: "SBGO",
        from: "2026-10-05T10:00:00Z",
        to: "2026-10-05T11:00:00Z",
      });
      assert.deepEqual(
        listed.map((metar) => metar.observedAt),
        ["2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z"],
      );
      assert.ok(listed.every((metar) => metar.icao === "SBGO" && metar.raw.includes("SBGO")));
    });

    it("answers an airport or a window with nothing observed with an empty list", async () => {
      const provider = make(OBSERVATIONS);
      assert.deepEqual(
        await provider.getMetar({ icao: "SBBR", from: "2026-10-05T00:00:00Z", to: "2026-10-06T00:00:00Z" }),
        [],
      );
      assert.deepEqual(
        await provider.getMetar({ icao: "SBGO", from: "2026-10-06T00:00:00Z", to: "2026-10-07T00:00:00Z" }),
        [],
      );
    });
  });
}

const fakeWith = (flights: FakeFlight[], observations: Metar[]) => {
  const data = new FakeFlightData();
  for (const flight of flights) data.addFlight(flight);
  for (const metar of observations) data.addMetar(metar);
  return data;
};

flightStatusContract("fake", (flights) => fakeWith(flights, []));
weatherContract("fake", (observations) => fakeWith([], observations));

/** The day after the flights of the contract: what is recent is asked of AeroAPI's flights, not its history. */
const AFTER = Date.parse("2026-10-07T00:00:00Z");

type AeroCall = { url: URL; key: string | null };

/**
 * AeroAPI in the shapes of its reference (OpenAPI 4.17.1, read on 2026-10-10): `/flights/{ident}` and
 * `/history/flights/{ident}` with `ident_type`, `start` and `end` compared against `scheduled_out`, pages
 * of `{ flights, links, num_pages }`, airports with their IATA code and zone, times at the gate.
 */
function aeroStandIn(flights: FakeFlight[], answer?: (url: URL) => Response | null, pageSize = 50) {
  const calls: AeroCall[] = [];
  const run = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url, key: headers.get("x-apikey") });
    const special = answer?.(url);
    if (special) return special;
    const ident = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const start = Date.parse(url.searchParams.get("start") ?? "");
    const end = Date.parse(url.searchParams.get("end") ?? "");
    const all = flights
      .filter((flight) => flight.flight === ident || `ICAO${flight.flight}` === ident)
      .filter((flight) => Date.parse(flight.scheduledDeparture) >= start && Date.parse(flight.scheduledDeparture) < end)
      .map((flight) => ({
        ident: flight.flight,
        ident_iata: flight.flight,
        fa_flight_id: `${flight.flight}-${Date.parse(flight.scheduledDeparture)}-airline-0001`,
        cancelled: flight.state === "cancelled",
        diverted: flight.state === "diverted",
        blocked: false,
        position_only: false,
        origin: { code: `SB${flight.origin.slice(0, 2)}`, code_iata: flight.origin, timezone: "America/Sao_Paulo" },
        destination: { code: `SB${flight.destination.slice(0, 2)}`, code_iata: flight.destination, timezone: "America/Sao_Paulo" },
        scheduled_out: flight.scheduledDeparture,
        actual_out: flight.state === "cancelled" ? null : flight.actualDeparture,
        scheduled_in: flight.scheduledArrival,
        actual_in: flight.state === "cancelled" ? null : flight.actualArrival,
        departure_delay: null,
        arrival_delay: null,
        status: "Scheduled",
      }));
    const page = Number(url.searchParams.get("cursor") ?? 0);
    const slice = all.slice(page * pageSize, page * pageSize + pageSize);
    const more = (page + 1) * pageSize < all.length;
    const next = new URL(url);
    next.searchParams.set("cursor", String(page + 1));
    return new Response(
      JSON.stringify({ links: more ? { next: `${next.pathname.replace("/aeroapi", "")}${next.search}` } : null, num_pages: 1, flights: slice }),
      { status: 200, headers: { "content-type": "application/json; charset=UTF-8" } },
    );
  }) as typeof fetch;
  return { run, calls };
}

flightStatusContract("flightaware", (flights) =>
  new FlightAwareProvider({ apiKey: "chave-de-teste", fetch: aeroStandIn(flights).run, now: () => AFTER }),
);

describe("FlightAware, beyond the contract", () => {
  it("asks for the flight as a designator, with the key in its header, and the days around the ticket's date", async () => {
    const standIn = aeroStandIn(FLIGHTS);
    const provider = new FlightAwareProvider({ apiKey: "chave-de-teste", fetch: standIn.run, now: () => AFTER });
    const status = await provider.getFlightStatus({ flight: "LA3418", date: "2026-10-05" });
    assert.equal(status?.basis, "gate");
    assert.equal(status?.originTimeZone, "America/Sao_Paulo");
    const call = standIn.calls[0];
    assert.equal(call.key, "chave-de-teste");
    assert.equal(call.url.pathname, "/aeroapi/flights/LA3418");
    assert.equal(call.url.searchParams.get("ident_type"), "designator");
    assert.equal(call.url.searchParams.get("start"), "2026-10-04T00:00:00.000Z");
    assert.equal(call.url.searchParams.get("end"), "2026-10-07T00:00:00.000Z");
  });

  it("asks the history for an older flight, never for a time ahead, and the ICAO ident when it has one", async () => {
    const standIn = aeroStandIn(FLIGHTS.map((flight) => ({ ...flight })));
    const later = Date.parse("2026-12-01T00:00:00Z");
    const provider = new FlightAwareProvider({ apiKey: "k", fetch: standIn.run, now: () => later });
    const status = await provider.getFlightStatus({ flight: "LA3418", date: "2026-10-05", icaoFlight: "ICAOLA3418" });
    assert.equal(status?.state, "landed");
    assert.equal(status?.flight, "LA3418");
    const call = standIn.calls[0];
    assert.equal(call.url.pathname, "/aeroapi/history/flights/ICAOLA3418");
    assert.ok(Date.parse(call.url.searchParams.get("end") ?? "") <= later);
    // Nothing is asked for a day more than two ahead: AeroAPI knows no flight there.
    const ahead = await provider.getFlightStatus({ flight: "LA3418", date: "2026-12-10" });
    assert.equal(ahead, null);
    assert.equal(standIn.calls.length, 1);
  });

  it("tells apart the legs one number flies on a day by their origin, and follows the pages", async () => {
    const legs: FakeFlight[] = [
      { ...SCHEDULE, flight: "G31000", origin: "GRU", destination: "BSB", scheduledDeparture: "2026-10-05T09:00:00Z", scheduledArrival: "2026-10-05T10:40:00Z", actualDeparture: "2026-10-05T09:05:00Z", actualArrival: "2026-10-05T10:41:00Z" },
      { ...SCHEDULE, flight: "G31000", origin: "BSB", destination: "MAO", scheduledDeparture: "2026-10-05T11:30:00Z", scheduledArrival: "2026-10-05T14:10:00Z", actualDeparture: "2026-10-05T13:30:00Z", actualArrival: "2026-10-05T16:20:00Z" },
    ];
    const standIn = aeroStandIn(legs, undefined, 1);
    const provider = new FlightAwareProvider({ apiKey: "k", fetch: standIn.run, now: () => AFTER });
    const second = await provider.getFlightStatus({ flight: "G31000", date: "2026-10-05", origin: "bsb" });
    assert.equal(second?.destination, "MAO");
    assert.equal(second?.arrivalDelayMinutes, 130);
    assert.equal(standIn.calls.length, 2);
    // With no origin, the first leg of the day.
    const first = await provider.getFlightStatus({ flight: "G31000", date: "2026-10-05" });
    assert.equal(first?.destination, "BSB");
  });

  it("keeps no time of a cancelled flight, and says when it only had runway times", async () => {
    const standIn = aeroStandIn([], (url) => {
      if (!url.pathname.endsWith("AD4000")) return null;
      return new Response(
        JSON.stringify({
          links: null,
          num_pages: 1,
          flights: [
            {
              ident: "AZU4000",
              ident_iata: "AD4000",
              cancelled: false,
              diverted: false,
              origin: { code: "SBKP", code_iata: "VCP", timezone: "America/Sao_Paulo" },
              destination: { code: "SBRF", code_iata: "REC", timezone: "America/Recife" },
              scheduled_out: null,
              actual_out: null,
              scheduled_off: "2026-10-05T12:00:00Z",
              actual_off: "2026-10-05T12:20:00Z",
              scheduled_on: "2026-10-05T15:00:00Z",
              actual_on: "2026-10-05T15:31:00Z",
              scheduled_in: null,
              actual_in: null,
            },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new FlightAwareProvider({ apiKey: "k", fetch: standIn.run, now: () => AFTER });
    const runway = await provider.getFlightStatus({ flight: "AD4000", date: "2026-10-05" });
    assert.equal(runway?.basis, "runway");
    assert.equal(runway?.arrivalDelayMinutes, 31);
    assert.equal(runway?.destinationTimeZone, "America/Recife");

    const cancelledStandIn = aeroStandIn([
      { ...SCHEDULE, flight: "G31234", actualDeparture: "2026-10-05T11:00:00Z", actualArrival: null, state: "cancelled" },
    ]);
    const cancelled = await new FlightAwareProvider({ apiKey: "k", fetch: cancelledStandIn.run, now: () => AFTER }).getFlightStatus({
      flight: "G31234",
      date: "2026-10-05",
    });
    assert.equal(cancelled?.state, "cancelled");
    assert.equal(cancelled?.actualDeparture, null);
  });

  it("tells a refused key, a refused query and an AeroAPI that did not answer apart from a flight it does not know", async () => {
    const query = { flight: "LA3418", date: "2026-10-05" };
    const withAnswer = (response: () => Response) =>
      new FlightAwareProvider({ apiKey: "k", fetch: aeroStandIn([], () => response()).run, now: () => AFTER });
    await assert.rejects(withAnswer(() => new Response("{}", { status: 401 })).getFlightStatus(query), FlightAwareAuthError);
    await assert.rejects(
      withAnswer(() => new Response(JSON.stringify({ title: "Bad", reason: "x", detail: "span too long", status: 400 }), { status: 400 })).getFlightStatus(query),
      FlightAwareQueryError,
    );
    await assert.rejects(
      withAnswer(() => new Response("", { status: 503 })).getFlightStatus(query),
      (error: unknown) => error instanceof FlightAwareUnavailableError && error.status === 503,
    );
    await assert.rejects(
      withAnswer(() => new Response("not json", { status: 200 })).getFlightStatus(query),
      FlightAwareUnavailableError,
    );
    assert.equal(await withAnswer(() => new Response("{}", { status: 404 })).getFlightStatus(query), null);
    const silent = new FlightAwareProvider({
      apiKey: "k",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      now: () => AFTER,
    });
    await assert.rejects(silent.getFlightStatus(query), (error: unknown) => error instanceof FlightAwareUnavailableError && error.status === null);
  });

  it("asks the history for a flight of nine to eleven days ago, whose whole day the flights no longer cover", async () => {
    const standIn = aeroStandIn(FLIGHTS);
    const tenDaysLater = Date.parse("2026-10-15T15:00:00Z");
    const status = await new FlightAwareProvider({ apiKey: "k", fetch: standIn.run, now: () => tenDaysLater }).getFlightStatus({
      flight: "LA3418",
      date: "2026-10-05",
    });
    assert.equal(status?.state, "landed");
    assert.equal(standIn.calls[0].url.pathname, "/aeroapi/history/flights/LA3418");
    assert.equal(standIn.calls[0].url.searchParams.get("start"), "2026-10-04T00:00:00.000Z");
  });

  it("follows a number through its stop to where the passenger got off", async () => {
    const legs: FakeFlight[] = [
      { ...SCHEDULE, flight: "G32601", origin: "GIG", destination: "BEL", scheduledDeparture: "2026-10-05T11:30:00Z", scheduledArrival: "2026-10-05T15:00:00Z", actualDeparture: "2026-10-05T11:31:00Z", actualArrival: "2026-10-05T14:51:00Z" },
      { ...SCHEDULE, flight: "G32601", origin: "BEL", destination: "MCP", scheduledDeparture: "2026-10-05T15:45:00Z", scheduledArrival: "2026-10-05T16:40:00Z", actualDeparture: "2026-10-05T16:30:00Z", actualArrival: "2026-10-05T17:25:00Z" },
    ];
    const provider = new FlightAwareProvider({ apiKey: "k", fetch: aeroStandIn(legs).run, now: () => AFTER });
    const through = await provider.getFlightStatus({ flight: "G32601", date: "2026-10-05", origin: "GIG", destination: "MCP" });
    assert.equal(through?.origin, "GIG");
    assert.equal(through?.destination, "MCP");
    assert.deepEqual(through?.stops, ["BEL"]);
    assert.equal(through?.actualDeparture, "2026-10-05T11:31:00Z");
    assert.equal(through?.arrivalDelayMinutes, 45);
    // A first leg that landed late is still the one the onward leg waited for.
    const late = [{ ...legs[0], actualArrival: "2026-10-05T17:00:00Z" }, { ...legs[1], actualDeparture: "2026-10-05T17:40:00Z", actualArrival: "2026-10-05T18:35:00Z" }];
    const delayed = await new FlightAwareProvider({ apiKey: "k", fetch: aeroStandIn(late).run, now: () => AFTER }).getFlightStatus({
      flight: "G32601",
      date: "2026-10-05",
      origin: "GIG",
      destination: "MCP",
    });
    assert.equal(delayed?.destination, "MCP");
    assert.equal(delayed?.arrivalDelayMinutes, 115);
    // An onward leg cancelled: the flight never arrived, whatever the first leg did.
    const stranded = [legs[0], { ...legs[1], actualDeparture: null, actualArrival: null, state: "cancelled" as const }];
    const cut = await new FlightAwareProvider({ apiKey: "k", fetch: aeroStandIn(stranded).run, now: () => AFTER }).getFlightStatus({
      flight: "G32601",
      date: "2026-10-05",
      origin: "GIG",
      destination: "MCP",
    });
    assert.equal(cut?.state, "cancelled");
    assert.equal(cut?.actualDeparture, "2026-10-05T11:31:00Z");
    assert.equal(cut?.actualArrival, null);
    // A destination no leg reaches: the leg from the origin, which says where it landed.
    const elsewhere = await provider.getFlightStatus({ flight: "G32601", date: "2026-10-05", origin: "GIG", destination: "SSA" });
    assert.equal(elsewhere?.destination, "BEL");
    assert.equal(elsewhere?.stops, undefined);
  });

  it("takes each pair of times of one kind, and never calls a flight that left cancelled", async () => {
    const one = (flight: Record<string, unknown>) =>
      new FlightAwareProvider({
        apiKey: "k",
        fetch: aeroStandIn([], () => new Response(JSON.stringify({ links: null, num_pages: 1, flights: [flight] }), { status: 200 })).run,
        now: () => AFTER,
      }).getFlightStatus({ flight: "AD4000", date: "2026-10-05" });
    const base = {
      ident: "AZU4000",
      cancelled: false,
      diverted: false,
      origin: { code: "SBKP", code_iata: "VCP", timezone: "America/Sao_Paulo" },
      destination: { code: "SBRF", code_iata: "REC", timezone: "America/Recife" },
      scheduled_out: "2026-10-05T12:00:00Z",
      actual_out: "2026-10-05T12:10:00Z",
      scheduled_off: "2026-10-05T12:15:00Z",
      actual_off: "2026-10-05T12:25:00Z",
      scheduled_on: "2026-10-05T14:50:00Z",
      actual_on: "2026-10-05T15:10:00Z",
      scheduled_in: "2026-10-05T15:00:00Z",
      actual_in: null,
    };
    // The gate's arrival never came: the runway's pair, scheduled and real, not the gate's scheduled with the runway's real.
    const runway = await one(base);
    assert.equal(runway?.basis, "runway");
    assert.equal(runway?.scheduledArrival, "2026-10-05T14:50:00Z");
    assert.equal(runway?.arrivalDelayMinutes, 20);
    assert.equal(runway?.actualDeparture, "2026-10-05T12:25:00Z");
    const gate = await one({ ...base, actual_in: "2026-10-05T15:20:00Z" });
    assert.equal(gate?.basis, "gate");
    assert.equal(gate?.arrivalDelayMinutes, 20);
    assert.equal(gate?.actualDeparture, "2026-10-05T12:10:00Z");
    // "No longer tracked" after it left is not a cancellation.
    const left = await one({ ...base, cancelled: true });
    assert.notEqual(left?.state, "cancelled");
    assert.equal(left?.actualDeparture, "2026-10-05T12:25:00Z");
  });

  it("asks nothing for what is not a flight or a day", async () => {
    const standIn = aeroStandIn(FLIGHTS);
    const provider = new FlightAwareProvider({ apiKey: "k", fetch: standIn.run, now: () => AFTER });
    assert.equal(await provider.getFlightStatus({ flight: "voo", date: "2026-10-05" }), null);
    assert.equal(await provider.getFlightStatus({ flight: "LA3418", date: "05/10/2026" }), null);
    assert.equal(standIn.calls.length, 0);
  });
});

/**
 * A month of ANAC's record in the form of its file (August 2026, read on 2026-10-10): a flight asked, one not
 * asked, a leg no schedule foresaw (4) and one nobody paid for (6). Invented flights.
 */
const RECORD_HEADER =
  "Sigla ICAO Empresa Aérea;Empresa Aérea;Número Voo;Código DI;Código Tipo Linha;Modelo Equipamento;Número de Assentos;Sigla ICAO Aeroporto Origem;Descrição Aeroporto Origem;Partida Prevista;Partida Real;Sigla ICAO Aeroporto Destino;Descrição Aeroporto Destino;Chegada Prevista;Chegada Real;Situação Voo;Justificativa;Referência;Situação Partida;Situação Chegada;Codeshare";
const RECORD_MONTH = [
  RECORD_HEADER,
  "TAM;TAM LINHAS AÉREAS S.A.;3418;0;N;A320;180;SBGO;SANTA GENOVEVA - GOIÂNIA - GO - BRASIL;05/08/2026 08:00;05/08/2026 12:20;SBSP;CONGONHAS - SÃO PAULO - SP - BRASIL;05/08/2026 09:40;05/08/2026 14:05;REALIZADO;;05/08/2026 00:00:00;;;",
  "GLO;GOL LINHAS AÉREAS S.A.;1000;0;N;B738;186;SBGR;GUARULHOS - SP - BRASIL;05/08/2026 06:00;05/08/2026 06:02;SBBR;BRASÍLIA - DF - BRASIL;05/08/2026 07:40;05/08/2026 07:38;REALIZADO;;05/08/2026 00:00:00;;;AZU/7800",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;4;N;A20N;174;SBSV;SALVADOR - BA - BRASIL;;06/08/2026 01:05;SBRF;RECIFE - PE - BRASIL;;06/08/2026 02:10;REALIZADO;;05/08/2026 00:00:00;;;",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;6;N;A20N;174;SBRF;RECIFE - PE - BRASIL;;06/08/2026 04:00;SBKP;VIRACOPOS - SP - BRASIL;;06/08/2026 07:10;REALIZADO;;05/08/2026 00:00:00;;;",
].join("\r\n");
const WANTED = { numbers: new Set(["3418"]), codeshares: new Set(["AZU7800"]) };

/** What any source of the official record must do. */
function recordContract(name: string, make: (months: Record<string, string>) => FlightRecordSource) {
  describe(`official record contract: ${name}`, () => {
    it("reads the flights asked, by number or codeshare, and every leg no schedule foresaw but the ones nobody paid for", async () => {
      const month = await make({ "2026-08": RECORD_MONTH }).readMonth("2026-08", WANTED);
      assert.equal(month.kind, "read");
      if (month.kind !== "read") return;
      assert.deepEqual(month.records.map((record) => `${record.airline}${record.number}`), ["TAM3418", "GLO1000"]);
      assert.deepEqual(month.unscheduled.map((leg) => `${leg.origin}-${leg.destination} ${leg.kind}`), ["SBSV-SBRF included"]);
    });

    it("says a month that is not out, and a file of another shape, apart from a month with no such flight", async () => {
      const source = make({ "2026-08": RECORD_MONTH, "2026-07": "Voo;Data\nG31000;05/07/2026" });
      assert.deepEqual(await source.readMonth("2026-09", WANTED), { kind: "missing" });
      assert.deepEqual(await source.readMonth("2026-07", WANTED), { kind: "unavailable", code: "anac_format" });
      const none = await source.readMonth("2026-08", { numbers: new Set(["9999"]), codeshares: new Set() });
      assert.equal(none.kind === "read" && none.records.length, 0);
    });
  });
}

recordContract("fake", (months) => {
  const data = new FakeFlightData();
  for (const [month, file] of Object.entries(months)) data.addRecordMonth(month, file);
  return data;
});

/** ANAC's server: each month's file sent in pieces of a few bytes, as a large file arrives. */
function anacStandIn(months: Record<string, Uint8Array | string>, answer?: (url: string) => Response | null, piece = 7) {
  const asked: string[] = [];
  const run = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    const special = answer?.(url);
    if (special) return special;
    const match = /\/(\d{4})\/VRA_\d{4}_(\d{2})\.csv$/.exec(url);
    const file = match ? months[`${match[1]}-${match[2]}`] : undefined;
    if (file === undefined) return new Response("<html>404 - File or directory not found.</html>", { status: 404 });
    const bytes = typeof file === "string" ? new TextEncoder().encode(file) : file;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += piece) controller.enqueue(bytes.slice(at, at + piece));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { run, asked };
}

recordContract("anac", (months) => new AnacVraSource({ fetch: anacStandIn(months).run }));

describe("ANAC's record, beyond the contract", () => {
  it("asks the month at the address of the pattern, and reads a file of before 2021, written in Latin-1, the same", async () => {
    // Every letter of the file is one of Latin-1's: each is the byte of its code.
    const text = RECORD_MONTH.replace("REALIZADO;;05/08/2026", "REALIZADO;ATRASOS NÃO ESPECÍFICOS;05/08/2026");
    const latin1 = Uint8Array.from(text, (letter) => letter.charCodeAt(0));
    const standIn = anacStandIn({ "2018-08": latin1 });
    const month = await new AnacVraSource({ fetch: standIn.run }).readMonth("2018-08", WANTED);
    assert.equal(standIn.asked[0], "https://siros.anac.gov.br/siros/registros/diversos/vra/2018/VRA_2018_08.csv");
    assert.equal(month.kind, "read");
    if (month.kind !== "read") return;
    assert.equal(month.records.length, 2);
    assert.equal(month.records[0].justification, "ATRASOS NÃO ESPECÍFICOS");
    // The same file in UTF-8, cut between the two bytes of a letter, reads the same.
    const utf8 = await new AnacVraSource({ fetch: anacStandIn({ "2026-08": RECORD_MONTH }, undefined, 3).run }).readMonth("2026-08", WANTED);
    assert.equal(utf8.kind === "read" && utf8.records.length, 2);
  });

  it("tells no answer, another status, a file cut on the way and an empty one apart", async () => {
    const answering = (response: () => Response) => new AnacVraSource({ fetch: anacStandIn({}, () => response()).run });
    assert.deepEqual(await answering(() => new Response("", { status: 500 })).readMonth("2026-08", WANTED), {
      kind: "unavailable",
      code: "anac_http_500",
    });
    assert.deepEqual(await answering(() => new Response("", { status: 200 })).readMonth("2026-08", WANTED), {
      kind: "unavailable",
      code: "anac_empty",
    });
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${RECORD_HEADER}\n`));
        controller.error(new Error("connection reset"));
      },
    });
    assert.deepEqual(await answering(() => new Response(cut, { status: 200 })).readMonth("2026-08", WANTED), {
      kind: "unavailable",
      code: "anac_cut",
    });
    const silent = new AnacVraSource({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    assert.deepEqual(await silent.readMonth("2026-08", WANTED), { kind: "unavailable", code: "anac_no_answer" });
  });
});

/**
 * REDEMET in the shapes of its reference (ajuda.decea.mil.br, read on
 * 2026-10-09): whole UTC hours asked as AAAAMMDDHH, pages of messages, times
 * written without a zone, newest first here so the provider has to order them.
 */
function redemetStandIn(observations: Metar[], answer?: (url: URL) => Response | null) {
  const calls: URL[] = [];
  const hourOf = (stamp: string) =>
    Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)));
  const run = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const special = answer?.(url);
    if (special) return special;
    const icao = url.pathname.split("/").pop() ?? "";
    const start = hourOf(url.searchParams.get("data_ini") ?? "");
    const end = hourOf(url.searchParams.get("data_fim") ?? "") + 3_599_999;
    const size = Number(url.searchParams.get("page_tam") ?? 150);
    const page = Number(url.searchParams.get("page") ?? 1);
    const all = observations
      .filter((metar) => metar.icao === icao && Date.parse(metar.observedAt) >= start && Date.parse(metar.observedAt) <= end)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
      .map((metar) => ({
        id_localidade: icao,
        validade_inicial: metar.observedAt.replace("T", " ").replace("Z", ""),
        mens: `${metar.raw}=`,
        recebimento: metar.observedAt.replace("T", " ").replace("Z", ""),
      }));
    const lastPage = Math.max(1, Math.ceil(all.length / size));
    return new Response(
      JSON.stringify({
        status: true,
        message: 200,
        data: { current_page: page, last_page: lastPage, per_page: size, total: all.length, data: all.slice((page - 1) * size, page * size) },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { run, calls };
}

weatherContract("redemet", (observations) =>
  new RedemetProvider({ apiKey: "chave-de-teste", fetch: redemetStandIn(observations).run, pageSize: 1 }),
);

describe("REDEMET, beyond the contract", () => {
  it("asks for the whole UTC hours of the window with the platform's key, and follows every page", async () => {
    const standIn = redemetStandIn(OBSERVATIONS);
    const provider = new RedemetProvider({ apiKey: "chave-de-teste", fetch: standIn.run, pageSize: 1 });
    const listed = await provider.getMetar({ icao: "sbgo", from: "2026-10-05T10:30:00Z", to: "2026-10-05T12:00:00Z" });
    assert.deepEqual(
      listed.map((metar) => metar.observedAt),
      ["2026-10-05T11:00:00Z", "2026-10-05T12:00:00Z"],
    );
    assert.ok(listed.every((metar) => !metar.raw.endsWith("=")));
    const first = standIn.calls[0];
    assert.equal(first.pathname, "/mensagens/metar/SBGO");
    assert.equal(first.searchParams.get("api_key"), "chave-de-teste");
    assert.equal(first.searchParams.get("data_ini"), "2026100510");
    assert.equal(first.searchParams.get("data_fim"), "2026100512");
    assert.equal(standIn.calls.length, 3);
  });

  it("tells a refused key apart from a REDEMET that did not answer", async () => {
    const refused = new RedemetProvider({
      apiKey: "errada",
      fetch: redemetStandIn([], () => new Response("{}", { status: 403 })).run,
    });
    await assert.rejects(refused.getMetar({ icao: "SBGO", from: "2026-10-05T10:00:00Z", to: "2026-10-05T11:00:00Z" }), RedemetAuthError);
    const down = new RedemetProvider({ apiKey: "k", fetch: redemetStandIn([], () => new Response("", { status: 503 })).run });
    await assert.rejects(
      down.getMetar({ icao: "SBGO", from: "2026-10-05T10:00:00Z", to: "2026-10-05T11:00:00Z" }),
      (error: unknown) => error instanceof RedemetUnavailableError && error.status === 503,
    );
    const silent = new RedemetProvider({
      apiKey: "k",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await assert.rejects(
      silent.getMetar({ icao: "SBGO", from: "2026-10-05T10:00:00Z", to: "2026-10-05T11:00:00Z" }),
      (error: unknown) => error instanceof RedemetUnavailableError && error.status === null,
    );
  });

  it("asks nothing for a window that is not one", async () => {
    const standIn = redemetStandIn(OBSERVATIONS);
    const provider = new RedemetProvider({ apiKey: "k", fetch: standIn.run });
    assert.deepEqual(await provider.getMetar({ icao: "SBGO", from: "2026-10-05T12:00:00Z", to: "2026-10-05T10:00:00Z" }), []);
    assert.deepEqual(await provider.getMetar({ icao: "GYN", from: "2026-10-05T10:00:00Z", to: "2026-10-05T12:00:00Z" }), []);
    assert.equal(standIn.calls.length, 0);
  });
});

describe("the delay of an arrival", () => {
  it("is the minutes from the scheduled to the actual arrival, negative when early", () => {
    assert.equal(arrivalDelayMinutes("2026-10-05T12:40:00Z", "2026-10-05T17:05:00Z"), 265);
    assert.equal(arrivalDelayMinutes("2026-10-05T12:40:00Z", "2026-10-05T12:40:00Z"), 0);
    assert.equal(arrivalDelayMinutes("2026-10-05T12:40:00Z", "2026-10-05T12:31:00Z"), -9);
  });
});
