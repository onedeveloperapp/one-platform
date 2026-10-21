import "server-only";

import {
  type CivilCourtNeed,
  civilCourtOf,
  type CourtNote,
  courtNotesOf,
  familyOf,
  type FamilyState,
} from "@/lib/cases/family";
import type {
  KeptReport,
  LawyerCauses,
  MinimumWage,
  RuleAirport,
  RuleParty,
  RuleSegment,
  WeatherWindow,
} from "@/lib/cases/rules";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the rules of a case decide on, read under the person's own session
 * (row-level security keeps it inside their firm): the claimants with what
 * each asks and where they live, the legs and their airports, the minimum
 * wages and the settings of the small-claims court and of the triage, the
 * weather reports kept for the case, the lawyers' causes per state, how
 * the family goes to court and what each court decided of a split.
 * Used by the case page and by the actions that act on the rules' answers.
 */

export type WeatherSettings = {
  visibilityBelowMeters: number;
  ceilingBelowFeet: number;
  gustAboveKnots: number;
  hoursBefore: number;
  hoursAfter: number;
};

export type RuleFacts = {
  incident: string;
  statedCause: string | null;
  decision: "pending" | "file" | "hold";
  /** The decision was ONE's, from the triage, where the firm lets it (0016, `file_or_hold`). */
  decisionAuto: boolean;
  triage: { risk: string; grounds: string[]; rule: string; at: string | null } | null;
  /** When the weather reports were last read for the case, and the hours asked then; null when they never were. */
  weatherRead: { at: string; windows: WeatherWindow[] } | null;
  parties: RuleParty[];
  segments: RuleSegment[];
  airports: RuleAirport[];
  wages: MinimumWage[];
  ceilingTimes: number | null;
  weather: WeatherSettings;
  reports: KeptReport[];
  causes: LawyerCauses[];
  registrations: { userId: string; uf: string }[];
  /** How the family goes to court: together (the default) or split by a lawyer's choice (0025). */
  family: FamilyState;
  /** What the platform read of each court on a family split. */
  courtNotes: CourtNote[];
};

const DEFAULT_WEATHER: WeatherSettings = {
  visibilityBelowMeters: 1500,
  ceilingBelowFeet: 500,
  gustAboveKnots: 35,
  hoursBefore: 3,
  hoursAfter: 3,
};

type Embedded<T> = T | T[] | null;
const one = <T>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);
const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** What `cases.weather_read` holds, when it is what the backend wrote. */
function readOf(value: unknown): RuleFacts["weatherRead"] {
  const read = value as { at?: unknown; windows?: unknown } | null;
  if (!read || typeof read.at !== "string") return null;
  const windows = (Array.isArray(read.windows) ? read.windows : []).flatMap((window): WeatherWindow[] => {
    const item = window as { icao?: unknown; from?: unknown; to?: unknown } | null;
    return item && typeof item.icao === "string" && typeof item.from === "string" && typeof item.to === "string"
      ? [{ icao: item.icao, from: item.from, to: item.to }]
      : [];
  });
  return { at: read.at, windows };
}

/** Null when the case is not one of the person's firm. Throws when a read failed. */
export async function loadRuleFacts(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  year: number,
): Promise<RuleFacts | null> {
  const { data: row, error } = await supabase
    .from("cases")
    .select(
      "id, incident, airline_stated_cause, suspension_decision, suspension_decided_auto, suspension_triage, weather_read, family_choice, family_choice_reason, family_choice_by, family_choice_at",
    )
    .eq("id", caseId)
    .eq("org_id", firmId)
    .maybeSingle();
  if (error) throw new Error("case_unreadable");
  if (!row) return null;

  const [parties, segments, wages, settings, reports, causes, registrations, notes] = await Promise.all([
    supabase
      .from("case_parties")
      .select("id, role, guardian_id, claim_cents, people(birth_date, city, uf)")
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      // The order they joined the case: "the first adult" is always the same one.
      .order("created_at")
      .order("id"),
    supabase
      .from("flight_segments")
      .select("origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local, affected")
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .order("position"),
    supabase.from("minimum_wages").select("valid_from, cents, act"),
    supabase.from("platform_settings").select("key, value").in("key", ["small_claims", "tema_1417"]),
    supabase
      .from("case_weather")
      .select("icao, observed_at, raw, signs")
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .order("observed_at"),
    supabase.rpc("firm_causes_by_state", { target_org: firmId, target_year: year }),
    supabase.from("oab_registrations").select("user_id, uf"),
    supabase.from("court_notes").select("court, stance, summary, sources, read_on").eq("topic", "family_split"),
  ]);
  if (
    parties.error ||
    segments.error ||
    wages.error ||
    settings.error ||
    reports.error ||
    causes.error ||
    registrations.error ||
    notes.error
  ) {
    throw new Error("rule_facts_unreadable");
  }

  const legs = (segments.data ?? []) as {
    origin_iata: string | null;
    destination_iata: string | null;
    scheduled_departure_local: string | null;
    scheduled_arrival_local: string | null;
    affected: boolean | null;
  }[];
  const iatas = [
    ...new Set(legs.flatMap((leg) => [leg.origin_iata, leg.destination_iata]).filter(Boolean)),
  ] as string[];
  const airports =
    iatas.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("airports")
          .select("iata, icao, city, municipality, uf, country, utc_offset_minutes")
          .in("iata", iatas);
  if (airports.error) throw new Error("airports_unreadable");

  const setting = (key: string) =>
    ((settings.data ?? []) as { key: string; value: Record<string, unknown> | null }[]).find((item) => item.key === key)
      ?.value ?? {};
  const tema = setting("tema_1417");
  const triage = row.suspension_triage as { risk?: string; grounds?: unknown; rule?: string; at?: string } | null;

  return {
    incident: String(row.incident),
    statedCause: (row.airline_stated_cause as string | null) ?? null,
    decision:
      row.suspension_decision === "file" || row.suspension_decision === "hold" ? row.suspension_decision : "pending",
    decisionAuto: row.suspension_decided_auto === true,
    triage:
      triage && typeof triage.risk === "string"
        ? {
            risk: triage.risk,
            grounds: Array.isArray(triage.grounds) ? triage.grounds.map(String) : [],
            rule: String(triage.rule ?? ""),
            at: typeof triage.at === "string" ? triage.at : null,
          }
        : null,
    weatherRead: readOf(row.weather_read),
    parties: (
      (parties.data ?? []) as {
        id: string;
        role: string;
        guardian_id: string | null;
        claim_cents: number | null;
        people: Embedded<{ birth_date: string | null; city: string | null; uf: string | null }>;
      }[]
    ).flatMap((party): RuleParty[] =>
      party.role === "claimant" || party.role === "guardian"
        ? [
            {
              partyId: party.id,
              role: party.role,
              guardianPartyId: party.guardian_id,
              birthDate: one(party.people)?.birth_date ?? null,
              city: one(party.people)?.city ?? null,
              uf: one(party.people)?.uf ?? null,
              claimCents: party.claim_cents === null ? null : Number(party.claim_cents),
            },
          ]
        : [],
    ),
    segments: legs.map((leg) => ({
      originIata: leg.origin_iata,
      destinationIata: leg.destination_iata,
      scheduledDepartureLocal: leg.scheduled_departure_local,
      scheduledArrivalLocal: leg.scheduled_arrival_local,
      affected: leg.affected === true,
    })),
    airports: (
      (airports.data ?? []) as {
        iata: string;
        icao: string | null;
        city: string | null;
        municipality: string | null;
        uf: string | null;
        country: string;
        utc_offset_minutes: number | null;
      }[]
    ).map((airport) => ({
      iata: airport.iata,
      icao: airport.icao,
      city: airport.city,
      municipality: airport.municipality,
      uf: airport.uf,
      country: airport.country,
      utcOffsetMinutes: airport.utc_offset_minutes,
    })),
    wages: ((wages.data ?? []) as { valid_from: string; cents: number; act: string }[]).map((wage) => ({
      validFrom: wage.valid_from,
      cents: Number(wage.cents),
      act: wage.act,
    })),
    ceilingTimes: num(setting("small_claims").ceiling_minimum_wages, 0) || null,
    weather: {
      visibilityBelowMeters: num(tema.visibility_below_meters, DEFAULT_WEATHER.visibilityBelowMeters),
      ceilingBelowFeet: num(tema.ceiling_below_feet, DEFAULT_WEATHER.ceilingBelowFeet),
      gustAboveKnots: num(tema.gust_above_knots, DEFAULT_WEATHER.gustAboveKnots),
      hoursBefore: num(tema.hours_before, DEFAULT_WEATHER.hoursBefore),
      hoursAfter: num(tema.hours_after, DEFAULT_WEATHER.hoursAfter),
    },
    reports: ((reports.data ?? []) as { icao: string; observed_at: string; raw: string; signs: string[] | null }[]).map(
      (report) => ({ icao: report.icao, observedAt: report.observed_at, raw: report.raw, signs: report.signs ?? [] }),
    ),
    causes: ((causes.data ?? []) as { user_id: string; uf: string; filed: number; planned: number }[]).map((cause) => ({
      userId: cause.user_id,
      uf: cause.uf,
      filed: Number(cause.filed),
      planned: Number(cause.planned),
    })),
    registrations: ((registrations.data ?? []) as { user_id: string; uf: string }[]).map((registration) => ({
      userId: registration.user_id,
      uf: registration.uf,
    })),
    family: familyOf(row),
    courtNotes: courtNotesOf(notes.data),
  };
}

/**
 * Whose word on the civil court the case needs (`case_civil_court`, 0025): each claimant of a lawsuit planned
 * there, who may give it and the word in force. Throws when it could not be read.
 */
export async function loadCivilCourt(supabase: SupabaseClient, caseId: string): Promise<CivilCourtNeed[]> {
  const { data, error } = await supabase.rpc("case_civil_court", { target_case: caseId });
  const needs = error ? null : civilCourtOf(data);
  if (!needs) throw new Error("civil_court_unreadable");
  return needs;
}
