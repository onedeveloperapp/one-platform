import assert from "node:assert/strict";
import test from "node:test";

import { cityKey, decideForum, type ForumInput } from "./forum.ts";
import { planProceedings, smallClaimsCeilingCents } from "./proceedings.ts";
import { countCausesByState, oneMoreNeedsSupplementary } from "./state-count.ts";
import { type StatedCause, triageSuspension } from "./suspension.ts";
import { DEFAULT_WEATHER_THRESHOLDS, readMetar, weatherSigns } from "./weather.ts";

// Every place, person and flight here is invented or public reference data (airports and their cities).

const GOIANIA = { city: "Goiânia", uf: "GO" };
const GUARULHOS = { city: "Guarulhos", uf: "SP" };
const BRASILIA = { city: "Brasília", uf: "DF" };

const forum = (overrides: Partial<ForumInput>): ForumInput => ({
  basis: "domicile",
  domicile: GOIANIA,
  chosen: null,
  tripPlaces: [GOIANIA, GUARULHOS],
  reason: null,
  ...overrides,
});

test("the forum is the passenger's domicile by default", () => {
  assert.deepEqual(decideForum(forum({})), { ok: true, basis: "domicile", place: GOIANIA, rule: "foro-v1" });
  assert.equal((decideForum(forum({ domicile: null })) as { code: string }).code, "domicile_unknown");
  assert.equal((decideForum(forum({ domicile: { city: " ", uf: "GO" } })) as { code: string }).code, "domicile_unknown");
});

test("another forum needs a link to the flight and a recorded reason, whatever the basis", () => {
  const cases: [Partial<ForumInput>, string][] = [
    [{ basis: "event_place", chosen: null }, "place_unknown"],
    [{ basis: "event_place", chosen: BRASILIA, reason: "Onde o voo foi cancelado." }, "not_linked_to_flight"],
    [{ basis: "event_place", chosen: GUARULHOS, reason: "curto" }, "reason_required"],
    [{ basis: "defendant_seat", chosen: BRASILIA, reason: "Sede da companhia." }, "not_linked_to_flight"],
    [{ basis: "other", chosen: GUARULHOS, reason: null }, "reason_required"],
  ];
  for (const [input, code] of cases) {
    const decision = decideForum(forum(input));
    assert.equal(decision.ok, false, JSON.stringify(input));
    assert.equal((decision as { code: string }).code, code, JSON.stringify(input));
  }
  const decided = decideForum(
    forum({ basis: "event_place", chosen: { city: "GUARULHOS", uf: "sp" }, reason: "O cancelamento foi em Guarulhos." }),
  );
  assert.equal(decided.ok, true);
  assert.equal(cityKey("São  Paulo"), cityKey("sao paulo"));
});

test("a family with a minor goes to the civil court together, unless a lawyer chose to split it", () => {
  const ceiling = smallClaimsCeilingCents(162_100, 40);
  assert.equal(ceiling, 6_484_000);
  const claimants = [
    { partyId: "mae", minor: false, claimCents: 1_000_000 },
    { partyId: "pai", minor: false, claimCents: null },
    { partyId: "filho", minor: true, claimCents: 1_000_000 },
  ];
  const together = planProceedings({ ceilingCents: ceiling, claimants });
  assert.equal(together.rule, "tipo-de-processo-v2");
  assert.equal(together.family, "together");
  assert.deepEqual(
    together.proceedings.map((proceeding) => [proceeding.kind, proceeding.partyIds]),
    [["comum", ["mae", "pai", "filho"]]],
  );
  assert.deepEqual(together.proceedings[0].reasons, { mae: "with_family", pai: "with_family", filho: "minor" });
  // The adults' claims no longer decide their court: nothing waits on them.
  assert.deepEqual(together.claimUnknown, []);
  assert.deepEqual(planProceedings({ ceilingCents: ceiling, claimants, familyChoice: "together" }), together);

  const split = planProceedings({ ceilingCents: ceiling, claimants, familyChoice: "split" });
  assert.equal(split.family, "split");
  assert.deepEqual(
    split.proceedings.map((proceeding) => [proceeding.kind, proceeding.partyIds]),
    [
      ["juizado", ["mae", "pai"]],
      ["comum", ["filho"]],
    ],
  );
  assert.deepEqual(split.claimUnknown, ["pai"]);
  assert.equal(split.proceedings[1].reasons.filho, "minor");
});

test("the choice matters only where somebody is bound to the civil court and somebody is not", () => {
  const ceiling = smallClaimsCeilingCents(162_100, 40);
  const adults = [
    { partyId: "a", minor: false, claimCents: 1_000_000 },
    { partyId: "b", minor: false, claimCents: null },
  ];
  for (const familyChoice of ["together", "split"] as const) {
    const plan = planProceedings({ ceilingCents: ceiling, claimants: adults, familyChoice });
    assert.equal(plan.family, "single");
    assert.deepEqual(plan.proceedings.map((proceeding) => [proceeding.kind, proceeding.partyIds]), [["juizado", ["a", "b"]]]);
    assert.deepEqual(plan.claimUnknown, ["b"]);
  }
  const minors = [
    { partyId: "x", minor: true, claimCents: null },
    { partyId: "y", minor: true, claimCents: 500_000 },
  ];
  const children = planProceedings({ ceilingCents: ceiling, claimants: minors, familyChoice: "split" });
  assert.equal(children.family, "single");
  assert.deepEqual(children.proceedings.map((proceeding) => [proceeding.kind, proceeding.partyIds]), [["comum", ["x", "y"]]]);
});

test("the ceiling is counted for each claimant, and an adult above it goes to the civil court alone", () => {
  const ceiling = smallClaimsCeilingCents(162_100, 40);
  const family = planProceedings({
    ceilingCents: ceiling,
    claimants: [
      { partyId: "a", minor: false, claimCents: 4_000_000 },
      { partyId: "b", minor: false, claimCents: 4_000_000 },
    ],
  });
  assert.deepEqual(family.proceedings.map((proceeding) => proceeding.kind), ["juizado"]);
  const claimants = [
    { partyId: "a", minor: false, claimCents: ceiling },
    { partyId: "b", minor: false, claimCents: ceiling + 1 },
  ];
  for (const familyChoice of ["together", "split"] as const) {
    const above = planProceedings({ ceilingCents: ceiling, claimants, familyChoice });
    assert.equal(above.family, "single");
    assert.deepEqual(
      above.proceedings.map((proceeding) => [proceeding.kind, proceeding.partyIds]),
      [
        ["juizado", ["a"]],
        ["comum", ["b"]],
      ],
    );
    assert.equal(above.proceedings[1].reasons.b, "above_ceiling");
  }
  // With a minor too, the family goes together, the adult above the ceiling with it.
  const withMinor = planProceedings({
    ceilingCents: ceiling,
    claimants: [...claimants, { partyId: "c", minor: true, claimCents: null }],
  });
  assert.equal(withMinor.family, "together");
  assert.deepEqual(withMinor.proceedings[0].reasons, { a: "with_family", b: "above_ceiling", c: "minor" });
  assert.deepEqual(planProceedings({ ceilingCents: ceiling, claimants: [] }).proceedings, []);
  assert.equal(planProceedings({ ceilingCents: ceiling, claimants: [] }).family, "single");
});

test("a METAR is read for what it observed, never for its trend or remarks", () => {
  const fog = readMetar("METAR SBGO 051000Z 00000KT 0800 FG VV002 19/19 Q1017=");
  assert.equal(fog.visibilityMeters, 800);
  assert.equal(fog.ceilingFeet, 200);
  assert.deepEqual(fog.weather, ["FG"]);
  assert.deepEqual(weatherSigns(fog).sort(), ["fog", "low_ceiling", "low_visibility"]);

  const storm = readMetar("METAR SBGR 052100Z 32018G38KT 3000 +TSRA BKN015 FEW030CB 22/20 Q1012 RMK FG");
  assert.equal(storm.gustKnots, 38);
  assert.deepEqual(weatherSigns(storm).sort(), ["heavy_rain", "strong_gusts", "thunderstorm"]);

  const clear = readMetar("METAR SBGO 051200Z 09008KT CAVOK 27/18 Q1016 TEMPO 2000 TSRA");
  assert.equal(clear.cavok, true);
  assert.deepEqual(weatherSigns(clear), []);

  const vicinity = readMetar("METAR SBBR 051500Z 12005KT 9999 VCSH SCT040 BKN100 28/15 Q1018");
  assert.deepEqual(vicinity.weather, ["VCSH"]);
  assert.equal(vicinity.ceilingFeet, 10000);
  assert.deepEqual(weatherSigns(vicinity), []);

  // The station's own code and the kind of report are never weather: Barreiras is SNBR, not snow and mist.
  assert.deepEqual(weatherSigns(readMetar("METAR SNBR 051200Z 09008KT CAVOK 27/18 Q1016")), []);
  assert.deepEqual(readMetar("METAR COR SBGR 052100Z 32018KT 3000 +TSRA BKN015").weather, ["+TSRA"]);
  assert.deepEqual(readMetar("SPECI SNBR 0800 FG").weather, ["FG"]);
  assert.equal(readMetar("SPECI SNBR 0800 FG").visibilityMeters, 800);

  // The thresholds are the caller's.
  assert.deepEqual(weatherSigns(readMetar("SBGO 051000Z 2000"), { ...DEFAULT_WEATHER_THRESHOLDS, visibilityBelowMeters: 3000 }), [
    "low_visibility",
  ]);
});

test("Tema 1.417: a cause of art. 256, par. 3, of the CBA is a high risk; an internal one is low", () => {
  const cases: [string, StatedCause | null, string[] | null, string, string[]][] = [
    ["delay", "weather", ["thunderstorm"], "high", ["alleged_weather", "weather_observed"]],
    ["delay", "weather", null, "high", ["alleged_weather", "weather_not_assessed"]],
    ["cancellation", "weather", [], "medium", ["alleged_weather", "weather_not_observed"]],
    ["cancellation", "authority", null, "high", ["alleged_authority"]],
    ["missed_connection", "airport_infrastructure", [], "high", ["alleged_infrastructure"]],
    ["delay", "maintenance", [], "low", ["internal_cause"]],
    ["delay", "crew", ["fog"], "medium", ["internal_cause", "weather_observed"]],
    ["delay", "none_given", ["fog"], "medium", ["no_cause_given", "weather_observed"]],
    ["delay", "none_given", [], "low", ["no_cause_given", "weather_not_observed"]],
    ["delay", "other", null, "unknown", ["no_cause_given", "weather_not_assessed"]],
    ["delay", null, null, "unknown", ["cause_not_recorded", "weather_not_assessed"]],
    ["delay", null, [], "unknown", ["cause_not_recorded", "weather_not_observed"]],
    ["delay", null, ["fog"], "medium", ["cause_not_recorded", "weather_observed"]],
    ["other", "weather", ["fog"], "unknown", ["incident_unclear"]],
    ["overbooking", "weather", ["fog"], "low", ["internal_cause"]],
    ["baggage_lost", "weather", ["fog"], "out_of_scope", ["incident_out_of_scope"]],
    ["downgrade", null, null, "out_of_scope", ["incident_out_of_scope"]],
  ];
  for (const [incident, statedCause, signs, risk, grounds] of cases) {
    const triage = triageSuspension({ incident, statedCause, weatherSigns: signs });
    assert.equal(triage.risk, risk, `${incident} ${statedCause} ${JSON.stringify(signs)}`);
    assert.deepEqual(triage.grounds, grounds, `${incident} ${statedCause} ${JSON.stringify(signs)}`);
    assert.equal(triage.rule, "tema-1417-v1");
  }
});

test("more than five causes a year in a state without a registration there calls for a supplementary one", () => {
  const causes = [
    ...Array.from({ length: 6 }, () => ({ uf: "SP", year: 2026 })),
    ...Array.from({ length: 5 }, () => ({ uf: "rj", year: 2026 })),
    ...Array.from({ length: 9 }, () => ({ uf: "GO", year: 2026 })),
    ...Array.from({ length: 7 }, () => ({ uf: "MG", year: 2025 })),
  ];
  const counted = countCausesByState({ registeredUfs: ["GO"], causes, year: 2026 });
  const byUf = Object.fromEntries(counted.states.map((state) => [state.uf, state]));
  assert.deepEqual(Object.keys(byUf).sort(), ["GO", "RJ", "SP"]);
  assert.equal(byUf.SP.needsSupplementary, true);
  assert.equal(byUf.SP.remaining, 0);
  assert.equal(byUf.RJ.habitual, false);
  assert.equal(byUf.RJ.remaining, 0);
  assert.equal(byUf.GO.habitual, true);
  assert.equal(byUf.GO.needsSupplementary, false);
  assert.equal(byUf.GO.remaining, null);
  assert.equal(oneMoreNeedsSupplementary(byUf.RJ, "RJ", ["GO"]), true);
  assert.equal(oneMoreNeedsSupplementary(undefined, "BA", ["GO"]), false);
  assert.equal(oneMoreNeedsSupplementary(byUf.GO, "go", ["GO"]), false);
});
