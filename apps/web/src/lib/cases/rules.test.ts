import { describe, expect, it } from "vitest";

import {
  assessWeather,
  caseDomicile,
  GROUND_KEY,
  lawyerNeedsSupplementary,
  minimumWageOn,
  PLAN_REASON_KEY,
  plannedClaimants,
  RISK_KEY,
  type RuleAirport,
  type RuleParty,
  type RuleSegment,
  SIGN_KEY,
  smallClaimsCeiling,
  STATED_CAUSE_KEY,
  tripPlaces,
  weatherWindows,
} from "@/lib/cases/rules";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

// Every person here is invented; the airports are public reference data.

const WAGES = [
  { validFrom: "2023-01-01", cents: 130200, act: "MP 1.143/2022" },
  { validFrom: "2023-05-01", cents: 132000, act: "MP 1.172/2023" },
  { validFrom: "2026-01-01", cents: 162100, act: "Decreto 12.797/2025" },
];

const party = (overrides: Partial<RuleParty>): RuleParty => ({
  partyId: "p",
  role: "claimant",
  guardianPartyId: null,
  birthDate: "1985-04-02",
  city: "Goiânia",
  uf: "GO",
  claimCents: null,
  ...overrides,
});

const AIRPORTS: RuleAirport[] = [
  { iata: "GYN", icao: "SBGO", city: "Goiânia", municipality: null, uf: "GO", country: "BR", utcOffsetMinutes: -180 },
  {
    iata: "GRU",
    icao: "SBGR",
    city: "São Paulo",
    municipality: "Guarulhos",
    uf: "SP",
    country: "BR",
    utcOffsetMinutes: -180,
  },
  { iata: "MAO", icao: "SBEG", city: "Manaus", municipality: null, uf: "AM", country: "BR", utcOffsetMinutes: -240 },
  { iata: "LIS", icao: "LPPT", city: "Lisbon", municipality: null, uf: null, country: "PT", utcOffsetMinutes: null },
];

const leg = (overrides: Partial<RuleSegment>): RuleSegment => ({
  originIata: "GYN",
  destinationIata: "GRU",
  scheduledDepartureLocal: "2026-09-20T08:00",
  scheduledArrivalLocal: "2026-09-20T09:40",
  affected: false,
  ...overrides,
});

describe("the ceiling of the small-claims court", () => {
  it("is forty of the minimum wage in force on the day", () => {
    expect(minimumWageOn(WAGES, "2023-04-30")?.cents).toBe(130200);
    expect(minimumWageOn(WAGES, "2023-05-01")?.cents).toBe(132000);
    expect(minimumWageOn(WAGES, "2022-12-31")).toBeNull();
    expect(smallClaimsCeiling(WAGES, 40, "2026-10-09")?.cents).toBe(6_484_000);
    expect(smallClaimsCeiling(WAGES, null, "2026-10-09")).toBeNull();
    expect(smallClaimsCeiling([], 40, "2026-10-09")).toBeNull();
  });
});

describe("who claims, and where they live", () => {
  const family: RuleParty[] = [
    party({ partyId: "mae", claimCents: 1_000_000 }),
    party({ partyId: "resp", role: "guardian", city: "Anápolis" }),
    party({ partyId: "filho", birthDate: "2015-03-10", guardianPartyId: "resp", city: null, uf: null }),
    party({ partyId: "sem-data", birthDate: null, guardianPartyId: "resp", city: null, uf: null }),
  ];

  it("reads the claimants with who is a minor on the day, never the guardians", () => {
    expect(plannedClaimants(family, "2026-10-09")).toEqual([
      { partyId: "mae", minor: false, claimCents: 1_000_000 },
      { partyId: "filho", minor: true, claimCents: null },
      // A guardian answers for them and nobody wrote the birth date yet: a minor, as the database decides too.
      { partyId: "sem-data", minor: true, claimCents: null },
    ]);
    expect(plannedClaimants([party({ birthDate: null })], "2026-10-09")[0].minor).toBe(false);
  });

  it("files at the first adult claimant's domicile; a lawsuit of minors, at their guardian's", () => {
    expect(caseDomicile(family, "2026-10-09")).toEqual({ city: "Goiânia", uf: "GO" });
    expect(caseDomicile(family, "2026-10-09", ["filho", "sem-data"])).toEqual({ city: "Anápolis", uf: "GO" });
    expect(caseDomicile(family, "2026-10-09", ["mae"])).toEqual({ city: "Goiânia", uf: "GO" });
    expect(caseDomicile([party({ city: " ", uf: "GO" })], "2026-10-09")).toBeNull();
  });
});

describe("the airports of the trip", () => {
  const out = leg({});
  const onward = leg({
    originIata: "GRU",
    destinationIata: "LIS",
    scheduledDepartureLocal: "2026-09-20T11:00",
    scheduledArrivalLocal: "2026-09-21T01:00",
  });

  it("give the cities another forum may be in: the one served and the one the airport sits in", () => {
    expect(tripPlaces([out, onward], AIRPORTS)).toEqual([
      { city: "Goiânia", uf: "GO" },
      { city: "São Paulo", uf: "SP" },
      { city: "Guarulhos", uf: "SP" },
    ]);
  });

  it("give the hours to read the reports for, in UTC, merged per Brazilian airport", () => {
    expect(weatherWindows([out, onward], AIRPORTS, 3, 3)).toEqual([
      { icao: "SBGO", from: "2026-09-20T08:00:00.000Z", to: "2026-09-20T14:00:00.000Z" },
      // Arrival 09:40 and the next departure 11:00, both local (UTC-3): one window.
      { icao: "SBGR", from: "2026-09-20T09:40:00.000Z", to: "2026-09-20T17:00:00.000Z" },
    ]);
    expect(
      weatherWindows([leg({ originIata: "MAO", destinationIata: null, scheduledArrivalLocal: null })], AIRPORTS, 1, 1),
    ).toEqual([{ icao: "SBEG", from: "2026-09-20T11:00:00.000Z", to: "2026-09-20T13:00:00.000Z" }]);
    expect(
      weatherWindows([leg({ scheduledDepartureLocal: null, scheduledArrivalLocal: null })], AIRPORTS, 3, 3),
    ).toEqual([]);
  });

  it("read only the leg where the problem happened, once one is marked", () => {
    const back = leg({
      originIata: "GRU",
      destinationIata: "GYN",
      scheduledDepartureLocal: "2026-09-27T18:00",
      scheduledArrivalLocal: "2026-09-27T19:40",
    });
    expect(weatherWindows([leg({ affected: true }), back], AIRPORTS, 3, 3)).toEqual([
      { icao: "SBGO", from: "2026-09-20T08:00:00.000Z", to: "2026-09-20T14:00:00.000Z" },
      { icao: "SBGR", from: "2026-09-20T09:40:00.000Z", to: "2026-09-20T15:40:00.000Z" },
    ]);
  });
});

describe("the weather read for a case", () => {
  const fog = {
    icao: "SBGO",
    observedAt: "2026-09-20T10:00:00Z",
    raw: "METAR SBGO ...",
    signs: ["fog", "low_visibility"],
  };
  const clearGo = { icao: "SBGO", observedAt: "2026-09-20T11:00:00Z", raw: "METAR SBGO ...", signs: [] };
  const clearGr = { icao: "SBGR", observedAt: "2026-09-20T12:00:00Z", raw: "METAR SBGR ...", signs: [] };
  const base = { segments: [leg({})], airports: AIRPORTS, hoursBefore: 3, hoursAfter: 3 };
  // What a read of that leg asks: both airports, around its hours.
  const read = { at: "2026-10-09T12:00:00Z", windows: weatherWindows(base.segments, AIRPORTS, 3, 3) };

  it("is not assessed while nobody read it, whatever is kept", () => {
    const assessed = assessWeather({ ...base, read: null, reports: [fog] });
    expect(assessed.signs).toBeNull();
    expect(assessed.airports.map((airport) => airport.state)).toEqual(["stale", "stale"]);
  });

  it("shows the signs found, at whichever airport", () => {
    const assessed = assessWeather({ ...base, read, reports: [fog, clearGo] });
    expect(assessed.signs).toEqual(["fog", "low_visibility"]);
    expect(assessed.airports).toEqual([
      { iata: "GYN", state: "read", count: 2, signs: ["fog", "low_visibility"] },
      { iata: "GRU", state: "read", count: 0, signs: [] },
    ]);
  });

  it("says nothing was observed only when every airport of the leg was read", () => {
    expect(assessWeather({ ...base, read, reports: [clearGo, clearGr] }).signs).toEqual([]);
    // One airport with no report: nothing found there is not an answer.
    expect(assessWeather({ ...base, read, reports: [clearGo] }).signs).toBeNull();
    // An airport REDEMET does not cover (abroad): the same.
    const segments = [leg({ originIata: "GRU", destinationIata: "LIS" })];
    const abroad = assessWeather({
      ...base,
      segments,
      read: { at: read.at, windows: weatherWindows(segments, AIRPORTS, 3, 3) },
      reports: [{ ...clearGr, observedAt: "2026-09-20T11:00:00Z" }],
    });
    expect(abroad.signs).toBeNull();
    expect(abroad.airports.find((airport) => airport.iata === "LIS")?.state).toBe("uncovered");
    // A Brazilian airport whose leg has no hour to read around is said to be that, not "abroad".
    const noHour = assessWeather({
      ...base,
      segments: [leg({ scheduledArrivalLocal: null })],
      read,
      reports: [clearGo],
    });
    expect(noHour.airports.find((airport) => airport.iata === "GRU")?.state).toBe("no_hour");
    expect(noHour.signs).toBeNull();
  });

  it("never counts the weather of a leg that is not the affected one", () => {
    const back = leg({ originIata: "MAO", destinationIata: "GYN", scheduledDepartureLocal: "2026-09-27T18:00" });
    const storm = { icao: "SBEG", observedAt: "2026-09-27T21:00:00Z", raw: "METAR SBEG ...", signs: ["thunderstorm"] };
    const assessed = assessWeather({
      ...base,
      segments: [leg({ affected: true }), back],
      read,
      reports: [clearGo, clearGr, storm],
    });
    expect(assessed.signs).toEqual([]);
    expect(assessed.airports.map((airport) => airport.iata)).toEqual(["GYN", "GRU"]);
  });

  it("asks for a new read when the leg was corrected to other hours", () => {
    // Read for the 20th, clear; the leg is then corrected to the 21st: the 20th says nothing of it.
    const corrected = [leg({ scheduledDepartureLocal: "2026-09-21T08:00", scheduledArrivalLocal: "2026-09-21T09:40" })];
    const assessed = assessWeather({ ...base, segments: corrected, read, reports: [clearGo, clearGr] });
    expect(assessed.signs).toBeNull();
    expect(assessed.airports.map((airport) => [airport.state, airport.count])).toEqual([
      ["stale", 0],
      ["stale", 0],
    ]);
    // And a report kept from outside the leg's hours is not counted even when the airport was read.
    const early = { ...fog, observedAt: "2026-09-20T02:00:00Z" };
    expect(assessWeather({ ...base, read, reports: [early, clearGo, clearGr] }).signs).toEqual([]);
  });
});

describe("a lawyer's causes in a state", () => {
  const causes = [
    { userId: "ana", uf: "SP", filed: 3, planned: 2 },
    { userId: "ana", uf: "GO", filed: 40, planned: 5 },
    { userId: "bia", uf: "SP", filed: 1, planned: 0 },
  ];
  const registrations = [
    { userId: "ana", uf: "GO" },
    { userId: "bia", uf: "GO" },
  ];

  it("warn when one more makes the practice habitual without a registration there", () => {
    expect(lawyerNeedsSupplementary("ana", "SP", causes, registrations, 2026)).toEqual({ needs: true, count: 5 });
    expect(lawyerNeedsSupplementary("ana", "GO", causes, registrations, 2026)).toEqual({ needs: false, count: 45 });
    expect(lawyerNeedsSupplementary("bia", "SP", causes, registrations, 2026)).toEqual({ needs: false, count: 1 });
    expect(
      lawyerNeedsSupplementary("ana", "sp", causes, [...registrations, { userId: "ana", uf: "SP" }], 2026).needs,
    ).toBe(false);
  });
});

describe("the words of the rules' answers", () => {
  it("exist for every cause, risk, ground, sign and reason", () => {
    const keys = [
      ...Object.values(STATED_CAUSE_KEY),
      ...Object.values(RISK_KEY),
      ...Object.values(GROUND_KEY),
      ...Object.values(SIGN_KEY),
      ...Object.values(PLAN_REASON_KEY),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
  });
});
