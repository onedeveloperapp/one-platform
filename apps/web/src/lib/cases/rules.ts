import { type Place } from "@flyee/rules/forum";
import { isMinorOn } from "@flyee/rules/person";
import {
  type ClaimantReason,
  type FamilyChoice,
  type PlannedClaimant,
  planProceedings,
  smallClaimsCeilingCents,
} from "@flyee/rules/proceedings";
import { countCausesByState, oneMoreNeedsSupplementary } from "@flyee/rules/state-count";
import type { StatedCause, SuspensionGround, SuspensionRisk } from "@flyee/rules/suspension";
import type { WeatherSign } from "@flyee/rules/weather";

/**
 * The rules of the domain (`@flyee/rules`) fed from what a case holds: who
 * claims and what, the minimum wage in force, the airports of the trip and
 * the hours of its legs, the weather reports kept for it, the lawyers'
 * causes per state. Pure: the page, the actions and the tests share it. The
 * rules decide; this only gathers what they decide on, and names their
 * answers in the screen's words (`product` namespace).
 */

export type MinimumWage = { validFrom: string; cents: number; act: string };

/** The minimum wage in force on a day: the last one whose act took effect by then. */
export function minimumWageOn(wages: MinimumWage[], day: string): MinimumWage | null {
  return (
    [...wages].filter((wage) => wage.validFrom <= day).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0] ?? null
  );
}

export type Ceiling = { cents: number; minimumWage: MinimumWage; times: number };

export function smallClaimsCeiling(wages: MinimumWage[], times: number | null, day: string): Ceiling | null {
  const wage = minimumWageOn(wages, day);
  if (!wage || !times || times <= 0) return null;
  return { cents: smallClaimsCeilingCents(wage.cents, times), minimumWage: wage, times };
}

export type RuleParty = {
  partyId: string;
  role: "claimant" | "guardian";
  guardianPartyId: string | null;
  birthDate: string | null;
  city: string | null;
  uf: string | null;
  claimCents: number | null;
};

/**
 * A claimant is a minor on a day by their birth date; while nobody wrote it,
 * somebody a guardian answers for is one (the database decides the same in
 * `save_proceeding`).
 */
export const isMinorBy = (birthDate: string | null, hasGuardian: boolean, day: string): boolean => {
  const minor = isMinorOn(birthDate, day);
  return minor === null ? hasGuardian : minor;
};

export const isMinorParty = (party: RuleParty, day: string): boolean =>
  isMinorBy(party.birthDate, party.guardianPartyId !== null, day);

/** The parties of a case as the screens hold them, as the rules read them. */
export function ruleParties(
  parties: {
    partyId: string;
    role: "claimant" | "guardian";
    guardianPartyId: string | null;
    person: { birth_date: string | null; city: string | null; uf: string | null };
  }[],
  claims: Record<string, number | null>,
): RuleParty[] {
  return parties.map((party) => ({
    partyId: party.partyId,
    role: party.role,
    guardianPartyId: party.guardianPartyId,
    birthDate: party.person.birth_date || null,
    city: party.person.city || null,
    uf: party.person.uf || null,
    claimCents: claims[party.partyId] ?? null,
  }));
}

/** The claimants as the plan of the proceedings reads them, minor on the day given. */
export function plannedClaimants(parties: RuleParty[], day: string): PlannedClaimant[] {
  return parties
    .filter((party) => party.role === "claimant")
    .map((party) => ({
      partyId: party.partyId,
      minor: isMinorParty(party, day),
      claimCents: party.claimCents,
    }));
}

const placeOf = (party: RuleParty | undefined): Place | null =>
  party?.city?.trim() && party.uf?.trim() ? { city: party.city.trim(), uf: party.uf.trim().toUpperCase() } : null;

/**
 * The domicile a lawsuit is filed at by default, for the claimants named (all
 * of the case when none is): the first adult's; with only minors, the
 * domicile of who answers for the first of them. The parties come in the
 * order they joined the case, so "the first" is always the same one.
 */
export function caseDomicile(parties: RuleParty[], day: string, partyIds?: string[]): Place | null {
  const claimants = parties.filter(
    (party) => party.role === "claimant" && (!partyIds || partyIds.includes(party.partyId)),
  );
  const adult = claimants.find((party) => !isMinorParty(party, day) && placeOf(party));
  if (adult) return placeOf(adult);
  for (const claimant of claimants) {
    const guardian = placeOf(parties.find((party) => party.partyId === claimant.guardianPartyId));
    if (guardian) return guardian;
  }
  return null;
}

/** A lawsuit as `create_planned_proceedings` takes it: its fields and its claimants. */
export type LawsuitPlanItem = {
  fields: {
    kind: "juizado" | "comum";
    court: string | null;
    comarca: string;
    forum_basis: "domicile";
    forum_city: string;
    system: string | null;
  };
  parties: string[];
};

/**
 * The lawsuits the rules plan for a case, ready to be created: the adults in
 * the small-claims court, an adult above the ceiling in the civil court, and
 * a family with a minor together in the civil court unless a lawyer split it;
 * each at the domicile of its own claimants (for the minors, of who answers
 * for them), in that state's court, with the system the court table
 * confirms. What the case screen creates and what ONE creates by itself
 * (0039) are the same plan.
 */
export function lawsuitPlan(input: {
  parties: RuleParty[];
  wages: MinimumWage[];
  ceilingTimes: number | null;
  familyChoice: FamilyChoice;
  courts: { acronym: string; uf: string }[];
  systems: { court: string; proceeding_kind: string; system: string; confirmed: boolean }[];
  day: string;
}):
  | { ok: true; plan: LawsuitPlanItem[] }
  | { ok: false; code: "ceiling_unknown" | "no_claimants" | "domicile_unknown" } {
  const ceiling = smallClaimsCeiling(input.wages, input.ceilingTimes, input.day);
  if (!ceiling) return { ok: false, code: "ceiling_unknown" };
  const planned = planProceedings({
    claimants: plannedClaimants(input.parties, input.day),
    ceilingCents: ceiling.cents,
    familyChoice: input.familyChoice,
  });
  if (planned.proceedings.length === 0) return { ok: false, code: "no_claimants" };
  const plan: LawsuitPlanItem[] = [];
  for (const proceeding of planned.proceedings) {
    const domicile = caseDomicile(input.parties, input.day, proceeding.partyIds);
    if (!domicile) return { ok: false, code: "domicile_unknown" };
    const court = input.courts.find((row) => row.uf === domicile.uf)?.acronym ?? null;
    const known = input.systems.find(
      (row) => row.court === court && row.proceeding_kind === proceeding.kind && row.confirmed,
    );
    plan.push({
      fields: {
        kind: proceeding.kind,
        court,
        comarca: domicile.city,
        forum_basis: "domicile",
        forum_city: domicile.city,
        system: known?.system ?? null,
      },
      parties: proceeding.partyIds,
    });
  }
  return { ok: true, plan };
}

export type RuleAirport = {
  iata: string;
  icao: string | null;
  city: string | null;
  municipality: string | null;
  uf: string | null;
  country: string;
  utcOffsetMinutes: number | null;
};

export type RuleSegment = {
  originIata: string | null;
  destinationIata: string | null;
  scheduledDepartureLocal: string | null;
  scheduledArrivalLocal: string | null;
  /** The leg where the problem happened. */
  affected: boolean;
};

/** The legs the weather matters for: the ones marked as where the problem happened; all of them while none is. */
export function affectedSegments(segments: RuleSegment[]): RuleSegment[] {
  const marked = segments.filter((segment) => segment.affected);
  return marked.length > 0 ? marked : segments;
}

/** Where a fact of the trip can have happened: the city each Brazilian airport serves and the one it sits in. */
export function tripPlaces(segments: RuleSegment[], airports: RuleAirport[]): Place[] {
  const byIata = new Map(airports.map((airport) => [airport.iata, airport]));
  const places: Place[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    for (const iata of [segment.originIata, segment.destinationIata]) {
      const airport = iata ? byIata.get(iata) : undefined;
      if (!airport || airport.country !== "BR" || !airport.uf) continue;
      for (const city of [airport.city, airport.municipality]) {
        if (!city?.trim()) continue;
        const key = `${city.trim().toLowerCase()}|${airport.uf}`;
        if (seen.has(key)) continue;
        seen.add(key);
        places.push({ city: city.trim(), uf: airport.uf });
      }
    }
  }
  return places;
}

export type WeatherWindow = { icao: string; from: string; to: string };

/** A local time of an airport (`2026-09-20T08:00`) as an instant, by the airport's offset. */
function instantOf(local: string, offsetMinutes: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const asUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return asUtc - offsetMinutes * 60_000;
}

/**
 * The windows of reports to read: around the scheduled departure at the
 * origin and the scheduled arrival at the destination of each affected leg,
 * for the Brazilian airports (REDEMET's), merged when an airport's windows
 * overlap. Fog on the way back, days later, says nothing of the flight out.
 */
export function weatherWindows(
  segments: RuleSegment[],
  airports: RuleAirport[],
  hoursBefore: number,
  hoursAfter: number,
): WeatherWindow[] {
  const byIata = new Map(airports.map((airport) => [airport.iata, airport]));
  const ranges = new Map<string, [number, number][]>();
  const add = (iata: string | null, local: string | null) => {
    const airport = iata ? byIata.get(iata) : undefined;
    if (!airport?.icao || airport.country !== "BR" || airport.utcOffsetMinutes === null || !local) return;
    const at = instantOf(local, airport.utcOffsetMinutes);
    if (at === null) return;
    const list = ranges.get(airport.icao) ?? [];
    list.push([at - hoursBefore * 3_600_000, at + hoursAfter * 3_600_000]);
    ranges.set(airport.icao, list);
  };
  for (const segment of affectedSegments(segments)) {
    add(segment.originIata, segment.scheduledDepartureLocal);
    add(segment.destinationIata, segment.scheduledArrivalLocal);
  }
  const windows: WeatherWindow[] = [];
  for (const [icao, list] of ranges) {
    const sorted = [...list].sort((a, b) => a[0] - b[0]);
    let current = sorted[0];
    for (const next of sorted.slice(1)) {
      if (next[0] <= current[1]) current = [current[0], Math.max(current[1], next[1])];
      else {
        windows.push({ icao, from: new Date(current[0]).toISOString(), to: new Date(current[1]).toISOString() });
        current = next;
      }
    }
    windows.push({ icao, from: new Date(current[0]).toISOString(), to: new Date(current[1]).toISOString() });
  }
  return windows.sort((a, b) => (a.icao === b.icao ? (a.from < b.from ? -1 : 1) : a.icao < b.icao ? -1 : 1));
}

export type KeptReport = { icao: string; observedAt: string; raw: string; signs: string[] };

/** An airport of the affected legs, as the weather was (or was not) read for it. */
export type AssessedAirport = {
  /** The IATA code people know it by. */
  iata: string;
  /**
   * - `read`: its reports were read for the hours the leg has now;
   * - `stale`: never read, or read for other hours (the leg was corrected since): to be read again;
   * - `no_hour`: a Brazilian airport whose leg has no scheduled hour to read around;
   * - `uncovered`: REDEMET does not have it (abroad, or no station code on record).
   */
  state: "read" | "stale" | "no_hour" | "uncovered";
  /** How many reports are kept for it, inside the hours of the leg. */
  count: number;
  signs: string[];
};

export type WeatherAssessment = {
  /** When the reports were last read; null when they never were. */
  readAt: string | null;
  airports: AssessedAirport[];
  /**
   * What the triage reads: the signs found; an empty list only when every
   * airport of the affected legs was read for its hours and showed none; null
   * otherwise (never read, a leg corrected since, an airport REDEMET does not
   * cover, or one with no report), because "nothing found" where nothing was
   * looked at is not an answer.
   */
  signs: string[] | null;
};

export function assessWeather(input: {
  /** When the reports were last read, and the hours asked of each airport then. */
  read: { at: string; windows: WeatherWindow[] } | null;
  segments: RuleSegment[];
  airports: RuleAirport[];
  reports: KeptReport[];
  hoursBefore: number;
  hoursAfter: number;
}): WeatherAssessment {
  const byIata = new Map(input.airports.map((airport) => [airport.iata, airport]));
  // The hours the legs ask for NOW: what was read counts only where it covers them.
  const expected = weatherWindows(input.segments, input.airports, input.hoursBefore, input.hoursAfter);
  const iatas = new Set<string>();
  for (const segment of affectedSegments(input.segments)) {
    if (segment.originIata) iatas.add(segment.originIata);
    if (segment.destinationIata) iatas.add(segment.destinationIata);
  }
  const within = (inner: { from: string; to: string }, outer: { from: string; to: string }) =>
    Date.parse(outer.from) <= Date.parse(inner.from) && Date.parse(outer.to) >= Date.parse(inner.to);

  const airports: AssessedAirport[] = [...iatas].map((iata) => {
    const airport = byIata.get(iata);
    const none = { iata, count: 0, signs: [] as string[] };
    if (!airport?.icao || airport.country !== "BR" || airport.utcOffsetMinutes === null) {
      return { ...none, state: "uncovered" };
    }
    const mine = expected.filter((window) => window.icao === airport.icao);
    if (mine.length === 0) return { ...none, state: "no_hour" };
    const asked = (input.read?.windows ?? []).filter((window) => window.icao === airport.icao);
    if (!mine.every((window) => asked.some((was) => within(window, was)))) return { ...none, state: "stale" };
    const kept = input.reports.filter(
      (report) =>
        report.icao === airport.icao &&
        mine.some((window) => within({ from: report.observedAt, to: report.observedAt }, window)),
    );
    return {
      iata,
      state: "read",
      count: kept.length,
      signs: [...new Set(kept.flatMap((report) => report.signs))].sort(),
    };
  });
  const found = [...new Set(airports.flatMap((airport) => airport.signs))].sort();
  const everyAirportRead =
    airports.length > 0 && airports.every((airport) => airport.state === "read" && airport.count > 0);
  return {
    readAt: input.read?.at ?? null,
    airports,
    signs: input.read === null ? null : found.length > 0 ? found : everyAirportRead ? [] : null,
  };
}

export type LawyerCauses = { userId: string; uf: string; filed: number; planned: number };

/**
 * Whether one more cause in a state would make a lawyer's practice there
 * habitual without a registration: the causes of the year (filed, and the
 * ones planned, which will be) against their registrations at the bar.
 */
export function lawyerNeedsSupplementary(
  userId: string,
  uf: string,
  causes: LawyerCauses[],
  registrations: { userId: string; uf: string }[],
  year: number,
): { needs: boolean; count: number } {
  const registeredUfs = registrations.filter((row) => row.userId === userId).map((row) => row.uf);
  const counted = countCausesByState({
    registeredUfs,
    year,
    causes: causes
      .filter((row) => row.userId === userId)
      .flatMap((row) => Array.from({ length: row.filed + row.planned }, () => ({ uf: row.uf, year }))),
  });
  const here = counted.states.find((state) => state.uf === uf.toUpperCase());
  return { needs: oneMoreNeedsSupplementary(here, uf, registeredUfs), count: here?.count ?? 0 };
}

// ---------- The words of the rules' answers ----------

export const STATED_CAUSE_KEY: Record<StatedCause, string> = {
  weather: "case-cause-stated-weather",
  airport_infrastructure: "case-cause-stated-infrastructure",
  authority: "case-cause-stated-authority",
  pandemic: "case-cause-stated-pandemic",
  maintenance: "case-cause-stated-maintenance",
  crew: "case-cause-stated-crew",
  network: "case-cause-stated-network",
  overbooking: "case-cause-stated-overbooking",
  none_given: "case-cause-stated-none",
  other: "case-cause-stated-other",
};

export const RISK_KEY: Record<SuspensionRisk, string> = {
  high: "case-suspension-risk-high",
  medium: "case-suspension-risk-medium",
  low: "case-suspension-risk-low",
  out_of_scope: "case-suspension-risk-out",
  unknown: "case-suspension-risk-unknown",
};

export const GROUND_KEY: Record<SuspensionGround, string> = {
  incident_out_of_scope: "case-suspension-ground-out",
  alleged_weather: "case-suspension-ground-weather",
  alleged_infrastructure: "case-suspension-ground-infrastructure",
  alleged_authority: "case-suspension-ground-authority",
  alleged_pandemic: "case-suspension-ground-pandemic",
  weather_observed: "case-suspension-ground-observed",
  weather_not_observed: "case-suspension-ground-not-observed",
  internal_cause: "case-suspension-ground-internal",
  no_cause_given: "case-suspension-ground-no-cause",
  cause_not_recorded: "case-suspension-ground-cause-unknown",
  incident_unclear: "case-suspension-ground-incident-unclear",
  weather_not_assessed: "case-suspension-ground-not-assessed",
};

export const SIGN_KEY: Record<WeatherSign, string> = {
  low_visibility: "case-weather-sign-visibility",
  low_ceiling: "case-weather-sign-ceiling",
  strong_gusts: "case-weather-sign-gusts",
  thunderstorm: "case-weather-sign-thunderstorm",
  fog: "case-weather-sign-fog",
  freezing: "case-weather-sign-freezing",
  snow: "case-weather-sign-snow",
  hail: "case-weather-sign-hail",
  squall: "case-weather-sign-squall",
  funnel_cloud: "case-weather-sign-funnel",
  volcanic_ash: "case-weather-sign-ash",
  dust_or_sand_storm: "case-weather-sign-dust",
  heavy_rain: "case-weather-sign-rain",
};

export const PLAN_REASON_KEY: Record<ClaimantReason, string> = {
  adult: "case-plan-reason-adult",
  minor: "case-plan-reason-minor",
  above_ceiling: "case-plan-reason-above",
  with_family: "case-plan-reason-family",
};
