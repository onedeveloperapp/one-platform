"use server";

import { revalidatePath } from "next/cache";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { loadRuleFacts, type RuleFacts } from "@/lib/cases/rule-facts";
import { assessWeather, lawsuitPlan, smallClaimsCeiling, weatherWindows } from "@/lib/cases/rules";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { weatherProvider } from "@/modules/direito-do-passageiro/flights/weather";
import { createServiceClient } from "@flyee/auth/service";
import { RedemetAuthError } from "@flyee/flights/providers/redemet";
import { STATED_CAUSES, type StatedCause, triageSuspension } from "@flyee/rules/suspension";
import { readMetar, weatherSigns } from "@flyee/rules/weather";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a person of the firm does with the rules of a case (migration 0025):
 * what each claimant asks, what the airline said and the decision on the
 * Tema 1.417, reading the weather of the trip, how the family goes to court,
 * creating the lawsuits the rules plan, and a claimant's word on the civil
 * court given to the firm. The rules run here, on what the database holds, never on what
 * a screen hands in; and what a rule answers (the triage, a weather report)
 * is written by the backend, never by the person: the service-role client is
 * used only for those two records, after the person's own call was accepted
 * by the database.
 */

export type RuleResult<T extends object = object> = ({ ok: true; code: string } & T) | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const KNOWN_ERRORS = ["not_allowed_in_support_session", "not_authorized", "case_not_found"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

function answerOf(data: unknown, error: { message: string } | null): RuleResult {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return answer.ok
    ? { ok: true, code: String(answer.code ?? "saved") }
    : { ok: false, code: String(answer.code ?? "failed") };
}

const refresh = (caseId: string) => revalidatePath(`/casos/${caseId}`);

/** Today on the platform's calendar (Brasília): the day a minor is a minor on and the minimum wage is read for. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

type Facts = { kind: "found"; facts: RuleFacts } | { kind: "missing" } | { kind: "unavailable" };

async function factsOf(supabase: SupabaseClient, firmId: string, caseId: string): Promise<Facts> {
  try {
    const facts = await loadRuleFacts(supabase, firmId, caseId, Number(today().slice(0, 4)));
    return facts ? { kind: "found", facts } : { kind: "missing" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Runs the Tema 1.417 rule on what the database holds for the case now (the
 * incident, what the airline said, the weather kept and how far it covers
 * the affected leg) and has the backend record the answer. Called after
 * anything the rule reads has changed. A failure leaves the last triage, and
 * the screen shows the rule's live answer anyway.
 */
async function recordTriage(supabase: SupabaseClient, firmId: string, caseId: string): Promise<void> {
  const loaded = await factsOf(supabase, firmId, caseId);
  if (loaded.kind !== "found") return;
  const { facts } = loaded;
  const statedCause = (STATED_CAUSES as readonly string[]).includes(facts.statedCause ?? "")
    ? (facts.statedCause as StatedCause)
    : null;
  const weather = assessWeather({
    read: facts.weatherRead,
    segments: facts.segments,
    airports: facts.airports,
    reports: facts.reports,
    hoursBefore: facts.weather.hoursBefore,
    hoursAfter: facts.weather.hoursAfter,
  });
  const triage = triageSuspension({ incident: facts.incident, statedCause, weatherSigns: weather.signs });
  try {
    await createServiceClient().rpc("record_suspension_triage", { target_case: caseId, target_triage: triage });
  } catch {
    // No service key in this environment: nothing is recorded, and nothing is invented.
  }
}

export async function setPartyClaim(caseId: string, partyId: string, cents: number | null): Promise<RuleResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(partyId)) return { ok: false, code: "case_not_found" };
  if (cents !== null && (!Number.isInteger(cents) || cents < 1 || cents > 100_000_000_000)) {
    return { ok: false, code: "invalid_amount" };
  }
  const { data, error } = await context.supabase.rpc("set_party_claim", {
    target_case: caseId,
    target_party: partyId,
    target_cents: cents,
  });
  const result = answerOf(data, error);
  if (result.ok) {
    refresh(caseId);
    // What each claimant asks may be what ONE waited for to create the lawsuits (0039).
    await queueCaseAdvance(caseId);
  }
  return result;
}

/**
 * Keeps what the airline said was the cause and, when the person changed it,
 * the firm's decision (a lawyer's: the database refuses anybody else's). A
 * decision left out stays as it is. The triage is then run again and
 * recorded by the backend.
 */
export async function saveSuspension(
  caseId: string,
  input: { statedCause: string | null; decision: "pending" | "file" | "hold" | null },
): Promise<RuleResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  const statedCause =
    input?.statedCause && (STATED_CAUSES as readonly string[]).includes(input.statedCause) ? input.statedCause : null;
  const decision = input?.decision ?? null;
  if (decision !== null && !["pending", "file", "hold"].includes(decision)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("save_suspension", {
    target_case: caseId,
    target_stated_cause: statedCause,
    target_decision: decision,
  });
  const result = answerOf(data, error);
  if (result.ok) {
    await recordTriage(context.supabase, context.firm.id, caseId);
    refresh(caseId);
    // A case no longer held may have its filing package asked for by ONE (0039).
    await queueCaseAdvance(caseId);
  }
  return result;
}

/**
 * Reads from REDEMET the reports of the Brazilian airports of the affected
 * legs, around their scheduled hours, and keeps them in the case with the
 * signs the rule finds in them. The database says whether the read may
 * happen now (a person of the firm, never a support visit, a while after the
 * last one); the backend writes what was read, replacing what was kept, and
 * the triage is run again on it.
 */
export async function readCaseWeather(caseId: string): Promise<RuleResult<{ count: number }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const provider = weatherProvider();
  if (!provider) return { ok: false, code: "weather_not_configured" };
  const loaded = await factsOf(context.supabase, context.firm.id, caseId);
  if (loaded.kind === "unavailable") return { ok: false, code: "unavailable" };
  if (loaded.kind === "missing") return { ok: false, code: "case_not_found" };
  const { facts } = loaded;

  const windows = weatherWindows(facts.segments, facts.airports, facts.weather.hoursBefore, facts.weather.hoursAfter);
  if (windows.length === 0) return { ok: false, code: "no_airports" };
  // Everything that could stop the read before REDEMET is asked is checked before the wait is spent.
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "unavailable" };
  }

  const begun = await context.supabase.rpc("begin_case_weather_read", { target_case: caseId });
  const started = answerOf(begun.data, begun.error);
  if (!started.ok) return started;
  // A read that fails from here on gives the wait back: the person may try again at once.
  const release = async () => {
    await service.rpc("release_case_weather_read", { target_case: caseId });
  };

  const thresholds = {
    visibilityBelowMeters: facts.weather.visibilityBelowMeters,
    ceilingBelowFeet: facts.weather.ceilingBelowFeet,
    gustAboveKnots: facts.weather.gustAboveKnots,
  };
  const observations: { icao: string; observed_at: string; raw: string; signs: string[] }[] = [];
  try {
    for (const window of windows) {
      for (const metar of await provider.getMetar(window)) {
        observations.push({
          icao: metar.icao,
          observed_at: metar.observedAt,
          raw: metar.raw,
          signs: weatherSigns(readMetar(metar.raw), thresholds),
        });
      }
    }
  } catch (thrown) {
    await release();
    return { ok: false, code: thrown instanceof RedemetAuthError ? "weather_key_refused" : "weather_unavailable" };
  }

  const { data, error } = await service.rpc("record_case_weather", {
    target_case: caseId,
    target_observations: observations,
    target_windows: windows,
  });
  const answer = (data ?? {}) as { ok?: boolean; code?: string; count?: number };
  if (error || !answer.ok) {
    await release();
    return { ok: false, code: error ? "unavailable" : String(answer.code ?? "failed") };
  }
  await recordTriage(context.supabase, context.firm.id, caseId);
  refresh(caseId);
  return { ok: true, code: "recorded", count: Number(answer.count ?? 0) };
}

/**
 * How a family goes to court (a partner's or a lawyer's: the database refuses
 * anybody else's): together, the default, or split with the reason. Before
 * the lawsuits are planned the choice plans them; once some are, the database
 * takes only a choice that says what they are.
 */
export async function setFamilyChoice(
  caseId: string,
  choice: "together" | "split",
  reason: string | null,
): Promise<RuleResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  if (choice !== "together" && choice !== "split") return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("set_family_choice", {
    target_case: caseId,
    target_choice: choice,
    target_reason: choice === "split" ? String(reason ?? "").slice(0, 1000) : null,
  });
  const result = answerOf(data, error);
  if (result.ok) {
    refresh(caseId);
    await queueCaseAdvance(caseId);
  }
  return result;
}

/**
 * A claimant's word on the civil court (for a minor, who answers for them),
 * given to the firm some other way than the link: a person of the firm
 * records it, saying how, in the words the screen showed, over the answer
 * they read (the database refuses it when the words changed or another answer
 * was given since). A "no" gives up the filing package in course of that
 * lawsuit (the database does it).
 */
export async function recordCivilCourtAnswer(
  caseId: string,
  partyId: string,
  accepted: boolean,
  note: string,
  seenAnswerId: string | null,
  wording: string,
): Promise<RuleResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(partyId)) return { ok: false, code: "case_not_found" };
  if (typeof accepted !== "boolean" || (seenAnswerId !== null && !isId(seenAnswerId)) || typeof wording !== "string") {
    return { ok: false, code: "invalid_data" };
  }
  const { data, error } = await context.supabase.rpc("record_civil_court_answer", {
    target_case: caseId,
    target_party: partyId,
    target_accepted: accepted,
    target_note: String(note ?? "").slice(0, 500),
    // The answer the person read: another one given since is never overwritten unseen.
    target_seen: seenAnswerId,
    target_wording: wording.slice(0, 2200),
  });
  const result = answerOf(data, error);
  if (result.ok) {
    refresh(caseId);
    // A yes may be what the filing package waited for (0039).
    await queueCaseAdvance(caseId);
  }
  return result;
}

/**
 * Creates the lawsuits the rules plan for a case that has none yet, as the
 * screen showed them (a family choice changed since is refused,
 * `family_changed`): the adults in the small-claims court, an adult above the
 * ceiling in the civil court, and a family with a minor together in the
 * civil court, unless a lawyer split it (the adults in the small-claims court,
 * the minors in the civil court); each at the domicile of its own claimants
 * (for the minors, of who answers for them), in that state's court, with the
 * system the court table confirms. A claimant with no Valor da Causa Pedido
 * is given the firm's value for the case's kind of problem first, and with
 * none goes with no value, for the judge to define. The database creates
 * them all at once, under the case's lock, each with every check of a
 * lawsuit. The lawyers who sign are chosen afterwards, on each lawsuit.
 */
export async function createPlannedProceedings(
  caseId: string,
  familyChoice: "together" | "split",
): Promise<RuleResult<{ created: number }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  const day = today();
  const loaded = await factsOf(context.supabase, context.firm.id, caseId);
  if (loaded.kind === "unavailable") return { ok: false, code: "unavailable" };
  if (loaded.kind === "missing") return { ok: false, code: "case_not_found" };
  const { facts } = loaded;
  // What the screen showed is what is created: a family a colleague split, or put back together, since is
  // shown again first.
  if (facts.family.choice !== familyChoice) {
    refresh(caseId);
    return { ok: false, code: "family_changed" };
  }

  // What the rules cannot plan from is said before anything else is read, as it always was.
  if (!smallClaimsCeiling(facts.wages, facts.ceilingTimes, day)) return { ok: false, code: "ceiling_unknown" };
  if (!facts.parties.some((party) => party.role === "claimant")) return { ok: false, code: "no_claimants" };
  const [courts, systems] = await Promise.all([
    context.supabase.from("courts").select("acronym, uf"),
    context.supabase.from("court_systems").select("court, proceeding_kind, system, confirmed"),
  ]);
  if (courts.error || systems.error) return { ok: false, code: "unavailable" };
  // A claimant with no Valor da Causa Pedido takes the firm's value for the case's kind of problem, as when ONE
  // creates the lawsuits (0052), before the plan reads it; with none, the claim goes with no value and the judge
  // defines it (0064).
  const claimDefault = facts.claimDefault;
  const unvalued = facts.parties.filter((party) => party.role === "claimant" && party.claimCents === null);
  if (claimDefault !== null) {
    for (const party of unvalued) {
      const { data, error } = await context.supabase.rpc("set_party_claim", {
        target_case: caseId,
        target_party: party.partyId,
        target_cents: claimDefault,
      });
      const written = answerOf(data, error);
      if (!written.ok) {
        refresh(caseId);
        return written;
      }
    }
  }
  const parties =
    claimDefault === null
      ? facts.parties
      : facts.parties.map((party) => (unvalued.includes(party) ? { ...party, claimCents: claimDefault } : party));
  const planned = lawsuitPlan({
    parties,
    wages: facts.wages,
    ceilingTimes: facts.ceilingTimes,
    familyChoice: facts.family.choice,
    courts: (courts.data ?? []) as { acronym: string; uf: string }[],
    systems: (systems.data ?? []) as { court: string; proceeding_kind: string; system: string; confirmed: boolean }[],
    day,
  });
  if (!planned.ok) return { ok: false, code: planned.code };
  const plan = planned.plan;

  const { data, error } = await context.supabase.rpc("create_planned_proceedings", {
    target_case: caseId,
    target_plan: plan,
  });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; count?: number };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  refresh(caseId);
  // ONE may now ask for the piece of each lawsuit (0039).
  await queueCaseAdvance(caseId);
  return { ok: true, code: "created", created: Number(answer.count ?? 0) };
}
