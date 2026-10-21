import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareLeg,
  factsOfRecord,
  factsOfStatus,
  type LegToCheck,
  matchLeg,
  monthsToSearch,
  wallAt,
  withUnscheduled,
} from "./check.ts";
import type { FlightStatus } from "./types.ts";
import {
  parseVraLine,
  parseVraUnscheduled,
  readCodeshares,
  readVraHeader,
  VraFormatError,
  VraMonthReader,
  type VraRecord,
  type VraUnscheduledLine,
  vraMonthUrl,
  zonedInstant,
} from "./vra.ts";

/**
 * The official record of the flights operated in Brazil, in the form of a
 * file of August 2026 (read on 2026-10-10). The flights below are invented:
 * real airlines and airports, made-up numbers and times.
 */
const HEADER =
  "Sigla ICAO Empresa Aérea;Empresa Aérea;Número Voo;Código DI;Código Tipo Linha;Modelo Equipamento;Número de Assentos;Sigla ICAO Aeroporto Origem;Descrição Aeroporto Origem;Partida Prevista;Partida Real;Sigla ICAO Aeroporto Destino;Descrição Aeroporto Destino;Chegada Prevista;Chegada Real;Situação Voo;Justificativa;Referência;Situação Partida;Situação Chegada;Codeshare";

const LINES = [
  "TAM;TAM LINHAS AÉREAS S.A.;3418;0;N;A320;180;SBGO;SANTA GENOVEVA - GOIÂNIA - GO - BRASIL;05/08/2026 08:00;05/08/2026 12:20;SBSP;CONGONHAS - SÃO PAULO - SP - BRASIL;05/08/2026 09:40;05/08/2026 14:05;REALIZADO;;05/08/2026 00:00:00;Atraso > 240;Atraso > 240;",
  "GLO;GOL LINHAS AÉREAS S.A.;1000;0;N;B738;186;SBGR;GUARULHOS - SP - BRASIL;05/08/2026 06:00;05/08/2026 06:02;SBBR;BRASÍLIA - DF - BRASIL;05/08/2026 07:40;05/08/2026 07:38;REALIZADO;;05/08/2026 00:00:00;Pontual;Antecipado;AZU/7800, GLO/6804",
  "GLO;GOL LINHAS AÉREAS S.A.;1000;0;N;B738;186;SBBR;BRASÍLIA - DF - BRASIL;05/08/2026 08:30;05/08/2026 10:30;SBEG;EDUARDO GOMES - MANAUS - AM - BRASIL;05/08/2026 11:10;05/08/2026 13:20;REALIZADO;;05/08/2026 00:00:00;Atraso 120-240;Atraso 120-240;",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;4567;0;N;A20N;174;SBKP;VIRACOPOS - CAMPINAS - SP - BRASIL;05/08/2026 21:00;05/08/2026 20:55;SBRF;GUARARAPES - RECIFE - PE - BRASIL;06/08/2026 00:10;;CANCELADO;;05/08/2026 00:00:00;;;",
  "AAL;AMERICAN AIRLINES, INC.;0905;0;I;B772;288;KMIA;MIAMI INTERNATIONAL AIRPORT - MIAMI - ESTADOS UNIDOS DA AMÉRICA;05/08/2026 23:55;06/08/2026 01:51;SBGL;GALEÃO - RIO DE JANEIRO - RJ - BRASIL;06/08/2026 08:20;06/08/2026 09:48;REALIZADO;;05/08/2026 00:00:00;Atraso 60-120;Atraso 60-120;",
  "",
  "XYZ;?;abc;0;N;;;SBGR;;05/08/2026 06:00;;SBBR;;05/08/2026 07:40;;REALIZADO;;;;;",
];

/**
 * Legs no schedule foresaw, in the form the same file writes them ("Z" before the flight's number, no
 * scheduled times, the day of the flight they belong to): Azul's 4567 above, cancelled, went on by a stop at
 * Salvador nobody planned (code 4) and an empty repositioning (6); LATAM's 3418 took off at 08:20 and came
 * back to Goiânia (3) before it flew at 12:20. Invented too.
 */
const UNSCHEDULED = [
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;4;N;A20N;174;SBSV;SALVADOR - BA - BRASIL;;06/08/2026 01:05;SBRF;GUARARAPES - RECIFE - PE - BRASIL;;06/08/2026 02:10;REALIZADO;;05/08/2026 00:00:00;;;",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;4;N;A20N;174;SBKP;VIRACOPOS - CAMPINAS - SP - BRASIL;;05/08/2026 21:10;SBSV;SALVADOR - BA - BRASIL;;05/08/2026 23:20;REALIZADO;;05/08/2026 00:00:00;;;",
  "AZU;AZUL LINHAS AÉREAS BRASILEIRAS S.A.;Z4567;6;N;A20N;174;SBRF;GUARARAPES - RECIFE - PE - BRASIL;;06/08/2026 04:00;SBKP;VIRACOPOS - CAMPINAS - SP - BRASIL;;06/08/2026 07:10;REALIZADO;;05/08/2026 00:00:00;;;",
  "TAM;TAM LINHAS AÉREAS S.A.;Z3418;3;N;A320;180;SBGO;SANTA GENOVEVA - GOIÂNIA - GO - BRASIL;;05/08/2026 08:20;SBGO;SANTA GENOVEVA - GOIÂNIA - GO - BRASIL;;05/08/2026 08:55;REALIZADO;;05/08/2026 00:00:00;;;",
  "TAM;TAM LINHAS AÉREAS S.A.;Z3418;4;N;A320;180;SBGO;SANTA GENOVEVA - GOIÂNIA - GO - BRASIL;;06/08/2026 08:20;SBBR;BRASÍLIA - DF - BRASIL;;06/08/2026 09:20;REALIZADO;;06/08/2026 00:00:00;;;",
];

const COLUMNS = readVraHeader(HEADER);
const RECORDS = LINES.map((line) => parseVraLine(COLUMNS, line)).filter((record): record is VraRecord => record !== null);

describe("the official record of a month", () => {
  it("reads a flight by the names of its columns: its airline, number, airports and Brasília times", () => {
    assert.equal(RECORDS.length, 5);
    assert.deepEqual(RECORDS[0], {
      airline: "TAM",
      number: "3418",
      origin: "SBGO",
      destination: "SBSP",
      scheduledDeparture: "2026-08-05T08:00",
      actualDeparture: "2026-08-05T12:20",
      scheduledArrival: "2026-08-05T09:40",
      actualArrival: "2026-08-05T14:05",
      state: "realizado",
      codeshares: [],
      reference: "2026-08-05",
      justification: null,
    });
    // A number with zeros before it is the number; the codeshares are designator and number together.
    assert.equal(RECORDS[4].number, "905");
    assert.deepEqual(RECORDS[1].codeshares, ["AZU7800", "GLO6804"]);
    // A cancelled flight keeps no real time, whatever its line carries.
    assert.equal(RECORDS[3].state, "cancelado");
    assert.equal(RECORDS[3].actualDeparture, null);
    assert.equal(RECORDS[3].actualArrival, null);
  });

  it("reads the columns in any order, with or without accents, and refuses a file without what a flight is read from", () => {
    const shuffled = readVraHeader(
      `${String.fromCharCode(0xfeff)}Numero Voo;sigla icao empresa aerea;SIGLA ICAO AEROPORTO ORIGEM;Sigla ICAO Aeroporto Destino;Partida Prevista;Partida Real;Chegada Prevista;Chegada Real;Situacao Voo`,
    );
    assert.equal(shuffled.number, 0);
    assert.equal(shuffled.airline, 1);
    assert.equal(shuffled.codeshare, null);
    assert.equal(shuffled.reference, null);
    assert.equal(shuffled.code, null);
    const record = parseVraLine(shuffled, "0042;GLO;SBGR;SBRJ;05/08/2026 06:00;;05/08/2026 07:00;;CANCELADO");
    assert.equal(record?.number, "42");
    assert.deepEqual(record?.codeshares, []);
    assert.throws(
      () => readVraHeader("Sigla ICAO Empresa Aérea;Número Voo;Partida Prevista"),
      (error: unknown) => (error as VraFormatError).missing?.includes("sigla icao aeroporto origem") === true,
    );
  });

  it("leaves out a line that is no flight, and a time that is no time", () => {
    assert.equal(parseVraLine(COLUMNS, ""), null);
    assert.equal(parseVraLine(COLUMNS, LINES[6]), null);
    const odd = LINES[0].replace("05/08/2026 14:05", "31/02/2026 25:00");
    assert.equal(parseVraLine(COLUMNS, odd)?.actualArrival, null);
    // A scheduled flight numbered with a Z is the flight of the number after it.
    assert.equal(parseVraLine(COLUMNS, LINES[1].replace(";1000;", ";Z1000;"))?.number, "1000");
    assert.equal(parseVraLine(COLUMNS, LINES[1].replace(";1000;", ";ZZ1000;")), null);
    assert.deepEqual(readCodeshares("AZU/7800, nada, GLO/06804, AZU/7800"), ["AZU7800", "GLO6804"]);
  });

  it("reads a leg no schedule foresaw as one of the flight it belongs to, never as a flight of the schedule", () => {
    const lines = UNSCHEDULED.map((line) => parseVraUnscheduled(COLUMNS, line));
    assert.deepEqual(lines[0], {
      airline: "AZU",
      number: "4567",
      origin: "SBSV",
      destination: "SBRF",
      actualDeparture: "2026-08-06T01:05",
      actualArrival: "2026-08-06T02:10",
      kind: "included",
      reference: "2026-08-05",
    });
    assert.equal(lines[3]?.kind, "return");
    // A leg nobody paid for carries no passenger of the flight.
    assert.equal(lines[2], null);
    for (const line of UNSCHEDULED) assert.equal(parseVraLine(COLUMNS, line), null);
    // A scheduled flight, a leg not flown, a charter and a leg with no time are not legs of this kind.
    assert.equal(parseVraUnscheduled(COLUMNS, LINES[0]), null);
    assert.equal(parseVraUnscheduled(COLUMNS, UNSCHEDULED[0].replace("REALIZADO", "CANCELADO")), null);
    assert.equal(parseVraUnscheduled(COLUMNS, UNSCHEDULED[0].replace("Z4567;4;", "Z4567;9;")), null);
    assert.equal(parseVraUnscheduled(COLUMNS, UNSCHEDULED[0].replace("Z4567;4;", "Z4567;E;"))?.kind, "other");
    assert.equal(
      parseVraUnscheduled(COLUMNS, UNSCHEDULED[0].replace("06/08/2026 01:05", "").replace("06/08/2026 02:10", "")),
      null,
    );
    assert.equal(parseVraUnscheduled(COLUMNS, UNSCHEDULED[0].replace("Z4567", "Z45X7")), null);
  });

  it("ties to a flight the legs of the same flight and day, in the order they were flown", () => {
    const lines = UNSCHEDULED.map((line) => parseVraUnscheduled(COLUMNS, line)).filter(
      (line): line is VraUnscheduledLine => line !== null,
    );
    const azul = withUnscheduled(RECORDS[3], lines);
    assert.deepEqual(
      azul.unscheduled?.map((leg) => `${leg.origin}-${leg.destination} ${leg.kind}`),
      ["SBKP-SBSV included", "SBSV-SBRF included"],
    );
    // The flight of the 6th is another flight: its leg is not the 5th's.
    const latam = withUnscheduled(RECORDS[0], lines);
    assert.deepEqual(latam.unscheduled?.map((leg) => leg.kind), ["return"]);
    // None for a flight with none, and none from a file with no day of the flight.
    assert.equal(withUnscheduled(RECORDS[1], lines).unscheduled, undefined);
    assert.equal(withUnscheduled({ ...RECORDS[3], reference: null }, lines).unscheduled, undefined);
    const many = Array.from({ length: 9 }, (_, index) => ({ ...lines[0], actualDeparture: `2026-08-06T0${index}:00` }));
    assert.equal(withUnscheduled(RECORDS[3], many).unscheduled?.length, 6);
  });

  it("reads the files of other years: the day of the flight written as 2021 writes it, and the airline's justification", () => {
    // June 2021: no codeshares, the day of the flight as "2021-06-01". Invented flights.
    const of2021 = readVraHeader(HEADER.replace(";Codeshare", ""));
    assert.equal(of2021.codeshare, null);
    const flight = parseVraLine(of2021, "AAL;AMERICAN AIRLINES, INC.;0904;0;I;B772;288;SBGL;GALEÃO;01/06/2021 23:00;;KMIA;MIAMI;02/06/2021 07:50;;CANCELADO;;2021-06-01;;");
    assert.equal(flight?.reference, "2021-06-01");
    const extra = parseVraUnscheduled(of2021, "AAL;AMERICAN AIRLINES, INC.;0905;2;X;B772;272;KMIA;MIAMI;;01/06/2021 23:52;SBGL;GALEÃO;;02/06/2021 08:03;REALIZADO;;2021-06-01;;");
    assert.deepEqual([extra?.kind, extra?.reference], ["extra", "2021-06-01"]);
    // December 2018: the reason the airline gave, kept as written.
    const of2018 = parseVraLine(
      of2021,
      "AAL;AMERICAN AIRLINES, INC.;0213;0;I;B752;171;KMIA;MIAMI;01/12/2018 02:15;01/12/2018 03:11;SBBR;BRASÍLIA;01/12/2018 09:50;01/12/2018 10:35;REALIZADO;ATRASOS NÃO ESPECÍFICOS,   OUTROS;01/12/2018 00:00:00;;",
    );
    assert.equal(of2018?.justification, "ATRASOS NÃO ESPECÍFICOS, OUTROS");
  });

  it("reads a month whole or says it could not: a file whose lines are no flights is of another shape", () => {
    const wanted = { numbers: new Set(["3418"]), codeshares: new Set<string>() };
    const month = new VraMonthReader(wanted);
    for (const line of [HEADER, ...LINES, ...UNSCHEDULED]) month.take(line);
    const read = month.finish();
    assert.deepEqual(read.records.map((record) => `${record.airline}${record.number}`), ["TAM3418"]);
    // Every leg no schedule foresaw is kept (a codeshare's operator flies another number), but the one nobody paid for.
    assert.equal(read.unscheduled.length, 4);
    const odd = new VraMonthReader(wanted);
    odd.take(HEADER);
    for (const line of LINES.slice(0, 5)) odd.take(line.replaceAll("/08/2026 ", "-08-2026T"));
    assert.throws(() => odd.finish(), VraFormatError);
    const empty = new VraMonthReader(wanted);
    empty.take("");
    assert.equal(empty.started, false);
  });

  it("is found at the address of its month", () => {
    assert.equal(
      vraMonthUrl("https://siros.anac.gov.br/siros/registros/diversos/vra/{ano}/VRA_{ano}_{mes}.csv", "2026-08"),
      "https://siros.anac.gov.br/siros/registros/diversos/vra/2026/VRA_2026_08.csv",
    );
  });
});

describe("a time of a zone, as the instant it was", () => {
  it("takes the offset the zone had that day: Brasília with no summer time now, and with it in 2018", () => {
    assert.equal(zonedInstant("2026-08-05T08:00", "America/Sao_Paulo"), "2026-08-05T11:00:00.000Z");
    assert.equal(zonedInstant("2018-12-20T08:00", "America/Sao_Paulo"), "2018-12-20T10:00:00.000Z");
    assert.equal(zonedInstant("2026-08-05T08:00", "America/Manaus"), "2026-08-05T12:00:00.000Z");
    assert.throws(() => zonedInstant("ontem", "America/Sao_Paulo"));
  });

  it("is read at an airport with its offset, in the zone a source names, or else in Brasília time", () => {
    assert.deepEqual(wallAt("2026-08-05T17:05:00Z", { offsetMinutes: -240 }), { wall: "2026-08-05T13:05", basis: "airport" });
    assert.deepEqual(wallAt("2026-08-06T12:48:00Z", { offsetMinutes: null, timeZone: "America/New_York" }), {
      wall: "2026-08-06T08:48",
      basis: "airport",
    });
    assert.deepEqual(wallAt("2026-08-06T12:48:00Z", { offsetMinutes: null }), { wall: "2026-08-06T09:48", basis: "brasilia" });
    assert.equal(wallAt(null, { offsetMinutes: -180 }), null);
  });
});

/** A leg as the case holds it. */
const leg = (changes: Partial<LegToCheck> = {}): LegToCheck => ({
  designators: ["TAM", "LAN"],
  number: "3418",
  originIcao: "SBGO",
  destinationIcao: "SBSP",
  scheduledDepartureLocal: "2026-08-05T08:00:00",
  originOffsetMinutes: -180,
  ...changes,
});

describe("which flight of the record is the leg's", () => {
  it("is the one the airline operates under the leg's number, from its origin, at the ticket's time", () => {
    const found = matchLeg(leg(), RECORDS);
    assert.equal(found?.matchedBy, "operator");
    assert.equal(found?.record.destination, "SBSP");
    // A ticket printed a little off the registered schedule is still the same flight.
    assert.equal(matchLeg(leg({ scheduledDepartureLocal: "2026-08-05T09:30" }), RECORDS)?.record.number, "3418");
    // Another day is another flight.
    assert.equal(matchLeg(leg({ scheduledDepartureLocal: "2026-08-07T08:00" }), RECORDS), null);
    // Another airline is another flight.
    assert.equal(matchLeg(leg({ designators: ["GLO"] }), RECORDS), null);
  });

  it("tells apart the legs one number flies on a day by their origin", () => {
    const fromBrasilia = matchLeg(
      leg({ designators: ["GLO"], number: "1000", originIcao: "SBBR", destinationIcao: "SBEG", scheduledDepartureLocal: "2026-08-05T08:30" }),
      RECORDS,
    );
    assert.equal(fromBrasilia?.record.destination, "SBEG");
    const fromGuarulhos = matchLeg(
      leg({ designators: ["GLO"], number: "1000", originIcao: "SBGR", destinationIcao: null, scheduledDepartureLocal: "2026-08-05T06:00" }),
      RECORDS,
    );
    assert.equal(fromGuarulhos?.record.destination, "SBBR");
  });

  it("finds a flight sold under another airline's number by its codeshare", () => {
    const sold = matchLeg(
      leg({ designators: ["AZU"], number: "7800", originIcao: "SBGR", destinationIcao: "SBBR", scheduledDepartureLocal: "2026-08-05T06:00" }),
      RECORDS,
    );
    assert.equal(sold?.matchedBy, "codeshare");
    assert.equal(sold?.record.airline, "GLO");
  });

  it("reads a leg from an airport abroad by the wall times, and an unknown airline only on the same route", () => {
    const fromMiami = matchLeg(
      leg({ designators: ["AAL"], number: "905", originIcao: "KMIA", destinationIcao: "SBGL", scheduledDepartureLocal: "2026-08-05T22:55", originOffsetMinutes: null }),
      RECORDS,
    );
    assert.equal(fromMiami?.record.destination, "SBGL");
    const unknown = matchLeg(leg({ designators: [], number: "4567", originIcao: "SBKP", destinationIcao: "SBRF", scheduledDepartureLocal: "2026-08-05T21:00" }), RECORDS);
    assert.equal(unknown?.matchedBy, "route");
    assert.equal(matchLeg(leg({ designators: [], number: "4567", originIcao: "SBKP", destinationIcao: null, scheduledDepartureLocal: "2026-08-05T21:00" }), RECORDS), null);
  });
});

describe("what the case says, next to what the record says", () => {
  const informed = (changes = {}) => ({
    scheduledDepartureLocal: "2026-08-05T08:00:00",
    actualArrivalLocal: "2026-08-05T14:05:00",
    originOffsetMinutes: -180,
    destinationOffsetMinutes: -180,
    ...changes,
  });

  it("agrees when the times are within the tolerance, with the record's own delays", () => {
    const compared = compareLeg(informed(), factsOfRecord(RECORDS[0]), 15);
    assert.deepEqual(compared, {
      departureDelayMinutes: 260,
      arrivalDelayMinutes: 265,
      scheduledDepartureDifference: 0,
      actualArrivalDifference: 0,
      agreement: "agrees",
      reachedDestinationDelayMinutes: null,
    });
    assert.equal(compareLeg(informed({ actualArrivalLocal: "2026-08-05T14:15" }), factsOfRecord(RECORDS[0]), 15).agreement, "agrees");
  });

  it("differs when the arrival the case tells is not the record's, or the ticket's schedule is not", () => {
    const later = compareLeg(informed({ actualArrivalLocal: "2026-08-05T15:00" }), factsOfRecord(RECORDS[0]), 15);
    assert.equal(later.agreement, "differs");
    assert.equal(later.actualArrivalDifference, 55);
    const moved = compareLeg(informed({ scheduledDepartureLocal: "2026-08-05T07:00", actualArrivalLocal: null }), factsOfRecord(RECORDS[0]), 15);
    assert.equal(moved.agreement, "differs");
    assert.equal(moved.scheduledDepartureDifference, -60);
  });

  it("says a cancelled flight is cancelled, and has nothing to compare without an airport's offset", () => {
    const cancelled = compareLeg(informed(), factsOfRecord(RECORDS[3]), 15);
    assert.equal(cancelled.agreement, "cancelled");
    assert.equal(cancelled.arrivalDelayMinutes, null);
    assert.equal(cancelled.reachedDestinationDelayMinutes, null);
    const abroad = compareLeg(informed({ originOffsetMinutes: null, destinationOffsetMinutes: null }), factsOfRecord(RECORDS[4]), 15);
    assert.equal(abroad.agreement, "nothing_to_compare");
    assert.equal(abroad.arrivalDelayMinutes, 88);
  });

  it("says when a cancelled flight's aircraft still reached the destination by legs no schedule foresaw", () => {
    const lines = UNSCHEDULED.map((line) => parseVraUnscheduled(COLUMNS, line)).filter(
      (line): line is VraUnscheduledLine => line !== null,
    );
    const facts = factsOfRecord(withUnscheduled(RECORDS[3], lines));
    assert.equal(facts.cancelled, true);
    assert.equal(facts.reachedDestination, "2026-08-06T05:10:00.000Z");
    const compared = compareLeg(informed(), facts, 15);
    assert.equal(compared.agreement, "cancelled");
    assert.equal(compared.arrivalDelayMinutes, null);
    assert.equal(compared.reachedDestinationDelayMinutes, 120);
    // A flight that was flown has its own arrival: a return before it changes nothing of it.
    const flown = factsOfRecord(withUnscheduled(RECORDS[0], lines));
    assert.equal(flown.reachedDestination, null);
    assert.equal(compareLeg(informed(), flown, 15).reachedDestinationDelayMinutes, null);
  });

  it("reads a provider's answer the same way", () => {
    const status: FlightStatus = {
      flight: "LA3418",
      date: "2026-08-05",
      origin: "GYN",
      destination: "CGH",
      scheduledDeparture: "2026-08-05T11:00:00Z",
      scheduledArrival: "2026-08-05T12:40:00Z",
      actualDeparture: "2026-08-05T15:20:00Z",
      actualArrival: "2026-08-05T17:05:00Z",
      state: "landed",
      arrivalDelayMinutes: 265,
    };
    assert.equal(compareLeg(informed(), factsOfStatus(status), 15).agreement, "agrees");
    assert.equal(compareLeg(informed(), factsOfStatus({ ...status, state: "diverted" }), 15).agreement, "diverted");
  });
});

/**
 * One number through a stop, in the form of the file (Gol's 2006 of 11 August 2026 flew Galeão to Belém and on
 * to Macapá; the number here is invented).
 */
const THROUGH = [
  "GLO;GOL LINHAS AÉREAS S.A.;2601;0;N;B738;186;SBBE;BELÉM - PA - BRASIL;11/08/2026 12:45;11/08/2026 12:48;SBMQ;MACAPÁ - AP - BRASIL;11/08/2026 13:40;11/08/2026 13:38;REALIZADO;;11/08/2026 00:00:00;;;",
  "GLO;GOL LINHAS AÉREAS S.A.;2601;0;N;B738;186;SBGL;GALEÃO - RJ - BRASIL;11/08/2026 08:30;11/08/2026 08:31;SBBE;BELÉM - PA - BRASIL;11/08/2026 12:00;11/08/2026 11:51;REALIZADO;;11/08/2026 00:00:00;;;",
  // The same number the next day, whose second leg was cancelled.
  "GLO;GOL LINHAS AÉREAS S.A.;2601;0;N;B738;186;SBGL;GALEÃO - RJ - BRASIL;12/08/2026 08:30;12/08/2026 09:10;SBBE;BELÉM - PA - BRASIL;12/08/2026 12:00;12/08/2026 12:35;REALIZADO;;12/08/2026 00:00:00;;;",
  "GLO;GOL LINHAS AÉREAS S.A.;2601;0;N;B738;186;SBBE;BELÉM - PA - BRASIL;12/08/2026 12:45;;SBMQ;MACAPÁ - AP - BRASIL;12/08/2026 13:40;;CANCELADO;;12/08/2026 00:00:00;;;",
].map((line) => parseVraLine(COLUMNS, line) as VraRecord);

describe("a flight with a stop under one number", () => {
  const gol = (changes: Partial<LegToCheck>): LegToCheck => ({
    designators: ["GLO"],
    number: "2601",
    originIcao: "SBGL",
    destinationIcao: "SBMQ",
    scheduledDepartureLocal: "2026-08-11T08:30",
    originOffsetMinutes: -180,
    ...changes,
  });

  it("arrives where the ticket gets off: the stop's arrival is never the leg's", () => {
    const through = matchLeg(gol({}), THROUGH);
    assert.equal(through?.record.origin, "SBGL");
    assert.deepEqual(through?.record.continuation?.map((leg) => leg.destination), ["SBMQ"]);
    const facts = factsOfRecord(through?.record as VraRecord);
    assert.equal(facts.scheduledDeparture, "2026-08-11T11:30:00.000Z");
    assert.equal(facts.actualArrival, "2026-08-11T16:38:00.000Z");
    // A ticket to the stop, and one from it, are the legs themselves.
    assert.equal(matchLeg(gol({ destinationIcao: "SBBE" }), THROUGH)?.record.continuation, undefined);
    const fromStop = matchLeg(gol({ originIcao: "SBBE", scheduledDepartureLocal: "2026-08-11T12:45" }), THROUGH);
    assert.equal(fromStop?.record.origin, "SBBE");
  });

  it("is cancelled when a leg of it was, keeping the departure that happened", () => {
    const facts = factsOfRecord(matchLeg(gol({ scheduledDepartureLocal: "2026-08-12T08:30" }), THROUGH)?.record as VraRecord);
    assert.equal(facts.cancelled, true);
    assert.equal(facts.actualDeparture, "2026-08-12T12:10:00.000Z");
    assert.equal(facts.actualArrival, null);
  });

  it("says a flight that never reaches the leg's destination is that, and compares no arrival with it", () => {
    const elsewhere = matchLeg(gol({ destinationIcao: "SBSV" }), THROUGH);
    assert.equal(elsewhere?.record.arrivalElsewhere, true);
    const facts = factsOfRecord(elsewhere?.record as VraRecord);
    assert.equal(facts.scheduledArrival, null);
    assert.equal(facts.actualArrival, null);
    const compared = compareLeg(
      { scheduledDepartureLocal: "2026-08-11T08:30", actualArrivalLocal: "2026-08-11T13:00", originOffsetMinutes: -180, destinationOffsetMinutes: -180 },
      facts,
      15,
    );
    assert.equal(compared.actualArrivalDifference, null);
    assert.equal(compared.agreement, "agrees");
    // Of two flights from the origin, the one that reaches the destination, though further from the ticket's time.
    const direct = parseVraLine(
      COLUMNS,
      "GLO;GOL LINHAS AÉREAS S.A.;2601;0;N;B738;186;SBGL;GALEÃO - RJ - BRASIL;11/08/2026 10:00;11/08/2026 10:00;SBSV;SALVADOR - BA - BRASIL;11/08/2026 12:00;11/08/2026 12:00;REALIZADO;;11/08/2026 00:00:00;;;",
    ) as VraRecord;
    const reaching = matchLeg(gol({ destinationIcao: "SBSV" }), [...THROUGH, direct]);
    assert.equal(reaching?.record.scheduledDeparture, "2026-08-11T10:00");
    assert.equal(reaching?.record.arrivalElsewhere, undefined);
  });
});

describe("the months a leg is looked for in", () => {
  it("is the month of the ticket's date, and the one beside it at the ends of a month", () => {
    assert.deepEqual(monthsToSearch("2026-08-05T08:00"), ["2026-08"]);
    assert.deepEqual(monthsToSearch("2026-08-01T00:30"), ["2026-08", "2026-07"]);
    // A later leg of a long flight is filed under the day its first leg left, up to two days before.
    assert.deepEqual(monthsToSearch("2026-08-02T10:00"), ["2026-08", "2026-07"]);
    assert.deepEqual(monthsToSearch("2026-08-03T10:00"), ["2026-08"]);
    assert.deepEqual(monthsToSearch("2026-08-31T23:30"), ["2026-08", "2026-09"]);
    assert.deepEqual(monthsToSearch("2026-12-31T23:30"), ["2026-12", "2027-01"]);
    assert.deepEqual(monthsToSearch("2027-01-01T00:10"), ["2027-01", "2026-12"]);
    assert.deepEqual(monthsToSearch("2028-02-29T10:00"), ["2028-02", "2028-03"]);
    assert.deepEqual(monthsToSearch("ontem"), []);
  });
});
