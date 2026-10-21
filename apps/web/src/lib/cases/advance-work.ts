import "server-only";

import { after } from "next/server";

import { lawsuitsWaiting } from "@/lib/cases/advance";
import { caseMissing, type MissingParty, type PersonData, type RequiredDocument } from "@/lib/cases/cases";
import { draftNext } from "@/lib/cases/drafts-work";
import { buildFilingPackages } from "@/lib/cases/filing-work";
import { lawsuitPlan, type MinimumWage, type RuleParty } from "@/lib/cases/rules";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of ONE carrying a case on (migration 0039): a case is
 * claimed under a number, and what is due is done through the database's own
 * functions, which make every check a person's request makes. Creating the
 * lawsuits needs the rules of the app (what the case lacks, the plan of the
 * lawsuits), so the case is read here with the same rules the case screen
 * shows; the piece and the package are the database's. What ONE then waits
 * for is recorded for the screen. Nothing of a client is kept in a job's
 * state: the steps carry case ids and outcomes only.
 */

/** A case a worker holds, and whether creating its lawsuits or asking for a package is what to look at. */
export type HeldAdvance = { caseId: string; claim: number; lawsuitsDue: boolean; packageDue: boolean };

export type AdvanceOutcome = "created" | "acted" | "waiting" | "idle" | "lost" | "failed";

/** What follows a piece or a package ONE asked for: the jobs, or the work itself where there are none. */
export type AdvanceFollow = {
  draft: (draftId: string) => Promise<void>;
  package: (packageId: string) => Promise<void>;
};

/** Today on the platform's calendar (Brasília): the day a minor is a minor on and the minimum wage is read for. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** The cases claimed, and how many the claim set aside on the way (more may be due behind them). */
export async function claimCaseAdvances(
  service: SupabaseClient,
  limit: number,
  target: string | null = null,
): Promise<{ held: HeldAdvance[]; parked: number }> {
  const { data, error } = await service.rpc("claim_case_advances", {
    target_limit: limit,
    target_case: target,
  });
  if (error) throw new Error("case advances could not be claimed");
  const answer = (data ?? {}) as { claimed?: unknown; parked?: unknown };
  const claimed = Array.isArray(answer.claimed) ? answer.claimed : [];
  return {
    held: (claimed as { case_id: string; claim: number; lawsuits_due: boolean; package_due: boolean }[]).map((row) => ({
      caseId: row.case_id,
      claim: Number(row.claim),
      lawsuitsDue: row.lawsuits_due === true,
      packageDue: row.package_due === true,
    })),
    parked: Number(answer.parked ?? 0) || 0,
  };
}

type LawsuitFacts = {
  parties: (MissingParty & { claimCents: number | null })[];
  documents: { kind: string; party_id: string | null; status: string }[];
  segments: number;
  required: RequiredDocument[];
  wages: MinimumWage[];
  ceilingTimes: number | null;
  familyChoice: "together" | "split";
  courts: { acronym: string; uf: string }[];
  systems: { court: string; proceeding_kind: string; system: string; confirmed: boolean }[];
};

/** What creating a case's lawsuits reads of it. Throws when a read failed; null for a case that is gone. */
async function loadLawsuitFacts(service: SupabaseClient, caseId: string): Promise<LawsuitFacts | null> {
  const { data: row, error } = await service.from("cases").select("id, family_choice").eq("id", caseId).maybeSingle();
  if (error) throw new Error("case unreadable");
  if (!row) return null;
  const [parties, documents, segments, settings, wages, courts, systems] = await Promise.all([
    service
      .from("case_parties")
      .select("id, person_id, role, guardian_id, claim_cents, created_at::text")
      .eq("case_id", caseId),
    // As the case screen reads them: a photo a client is still sending is not a document yet.
    service
      .from("case_documents")
      .select("kind, party_id, status")
      .eq("case_id", caseId)
      .in("status", ["received", "accepted", "rejected"]),
    service.from("flight_segments").select("id", { count: "exact", head: true }).eq("case_id", caseId),
    service.from("platform_settings").select("key, value").in("key", ["cases", "small_claims"]),
    service.from("minimum_wages").select("valid_from::text, cents, act"),
    service.from("courts").select("acronym, uf"),
    service.from("court_systems").select("court, proceeding_kind, system, confirmed"),
  ]);
  if (parties.error || documents.error || segments.error || settings.error || wages.error || courts.error) {
    throw new Error("case facts unreadable");
  }
  if (systems.error) throw new Error("court systems unreadable");
  const partyRows = (
    (parties.data ?? []) as {
      id: string;
      person_id: string;
      role: string;
      guardian_id: string | null;
      claim_cents: number | null;
      created_at: string;
    }[]
  )
    // The order they joined the case: "the first adult" is always the same one.
    .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
  const people =
    partyRows.length === 0
      ? { data: [], error: null }
      : await service
          .from("people")
          // Dates are read as text (the day as the calendar writes it), as PostgREST answers them anyway.
          .select(
            "id, full_name, cpf, birth_date::text, nationality, marital_status, profession, email, phone, postal_code, street, address_number, complement, district, city, uf",
          )
          .in(
            "id",
            partyRows.map((party) => party.person_id),
          );
  if (people.error) throw new Error("people unreadable");
  const personOf = new Map(
    ((people.data ?? []) as (Omit<PersonData, "person_id" | "party_id"> & { id: string })[]).map((person) => [
      person.id,
      person,
    ]),
  );
  const setting = (key: string) =>
    ((settings.data ?? []) as { key: string; value: Record<string, unknown> | null }[]).find((item) => item.key === key)
      ?.value ?? {};
  const times = setting("small_claims").ceiling_minimum_wages;
  return {
    parties: partyRows.flatMap((party) => {
      const person = personOf.get(party.person_id);
      if (!person || (party.role !== "claimant" && party.role !== "guardian")) return [];
      const { id, ...fields } = person;
      return [
        {
          partyId: party.id,
          role: party.role,
          guardianPartyId: party.guardian_id,
          person: { ...fields, person_id: id, party_id: party.id },
          claimCents: party.claim_cents === null ? null : Number(party.claim_cents),
        },
      ];
    }),
    documents: (documents.data ?? []) as { kind: string; party_id: string | null; status: string }[],
    segments: segments.count ?? 0,
    required: (setting("cases").required_documents ?? []) as RequiredDocument[],
    wages: ((wages.data ?? []) as { valid_from: string; cents: number; act: string }[]).map((wage) => ({
      validFrom: wage.valid_from,
      cents: Number(wage.cents),
      act: wage.act,
    })),
    ceilingTimes: typeof times === "number" && times > 0 ? times : null,
    familyChoice: row.family_choice === "split" ? "split" : "together",
    courts: (courts.data ?? []) as { acronym: string; uf: string }[],
    systems: (systems.data ?? []) as { court: string; proceeding_kind: string; system: string; confirmed: boolean }[],
  };
}

/** The facts with only the papers the firm accepted: what a package can carry. */
const acceptedOnly = (facts: LawsuitFacts): LawsuitFacts => ({
  ...facts,
  documents: facts.documents.filter((document) => document.status === "accepted"),
});

/** What the case screen says the case still lacks, read from the facts the worker read. */
const missingOf = (facts: LawsuitFacts, day: string) =>
  caseMissing({
    parties: facts.parties,
    documents: facts.documents,
    segments: facts.segments,
    required: facts.required,
    today: day,
  });

/**
 * Creates the lawsuits of a claimed case when it has what they need, with
 * the same rules the case screen runs. Answers what ONE waits for instead,
 * `created`, or `lost` when the claim is no longer this worker's. A plan the
 * case changed under (`changed`) waits for nothing: the case is looked at
 * again at once.
 */
async function createLawsuits(
  service: SupabaseClient,
  held: HeldAdvance,
  facts: LawsuitFacts,
  day: string,
): Promise<{ waiting: string | null; created: boolean; lost: boolean }> {
  const waiting = lawsuitsWaiting({
    missing: missingOf(facts, day),
    claims: facts.parties.filter((party) => party.role === "claimant").map((party) => party.claimCents),
  });
  if (waiting) return { waiting, created: false, lost: false };
  const planned = lawsuitPlan({
    parties: facts.parties.map(
      (party): RuleParty => ({
        partyId: party.partyId,
        role: party.role,
        guardianPartyId: party.guardianPartyId,
        birthDate: party.person.birth_date || null,
        city: party.person.city || null,
        uf: party.person.uf || null,
        claimCents: party.claimCents,
      }),
    ),
    wages: facts.wages,
    ceilingTimes: facts.ceilingTimes,
    familyChoice: facts.familyChoice,
    courts: facts.courts,
    systems: facts.systems,
    day,
  });
  if (!planned.ok) return { waiting: planned.code, created: false, lost: false };
  const { data, error } = await service.rpc("advance_create_lawsuits", {
    target_case: held.caseId,
    target_claim: held.claim,
    target_plan: planned.plan,
  });
  if (error) throw new Error("lawsuits could not be created");
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok) return { waiting: null, created: true, lost: false };
  if (answer.code === "not_working") return { waiting: null, created: false, lost: true };
  // Nothing to do after all (a person created them meanwhile, the firm stopped it, the case changed while it was
  // read): nothing to wait for.
  if (answer.code === "not_due" || answer.code === "not_auto" || answer.code === "changed") {
    return { waiting: null, created: false, lost: false };
  }
  return { waiting: String(answer.code ?? "failed"), created: false, lost: false };
}

/**
 * Does what is due for one claimed case and records what ONE waits for:
 * its lawsuits when they are what to look at, then the piece and the
 * package of each lawsuit. A failure of the moment is recorded as one (the
 * case is looked at again sooner, each time a little later), and what ONE
 * found it waits for before it is still said.
 */
export async function advanceClaimedCase(
  service: SupabaseClient,
  held: HeldAdvance,
  follow: AdvanceFollow,
): Promise<AdvanceOutcome> {
  let waiting: string | null = null;
  let created = false;
  let failed = false;
  const asked: { drafts: string[]; packages: string[] } = { drafts: [], packages: [] };
  try {
    const day = today();
    // The case is read when its lawsuits or a package are what to look at: both need what the screen says it lacks.
    const facts = held.lawsuitsDue || held.packageDue ? await loadLawsuitFacts(service, held.caseId) : null;
    if ((held.lawsuitsDue || held.packageDue) && !facts) return "lost";
    if (held.lawsuitsDue && facts) {
      const lawsuits = await createLawsuits(service, held, facts, day);
      if (lawsuits.lost) return "lost";
      waiting = lawsuits.waiting;
      created = lawsuits.created;
    }
    const { data, error } = await service.rpc("advance_case_steps", {
      target_case: held.caseId,
      target_claim: held.claim,
      // A package goes only with every paper the case needs accepted (a lawsuit a person created early may lack
      // them, and a paper sent again waits for the firm). Not read for a package: nothing is asked of one now.
      target_complete: facts ? missingOf(acceptedOnly(facts), day).length === 0 : null,
    });
    if (error) throw new Error("case steps failed");
    const steps = (data ?? {}) as {
      ok?: boolean;
      code?: string;
      drafts?: unknown;
      packages?: unknown;
      waiting?: string | null;
      failed?: boolean;
    };
    if (!steps.ok && steps.code === "not_working") return "lost";
    asked.drafts = Array.isArray(steps.drafts) ? steps.drafts.filter((id): id is string => typeof id === "string") : [];
    asked.packages = Array.isArray(steps.packages)
      ? steps.packages.filter((id): id is string => typeof id === "string")
      : [];
    waiting = waiting ?? (typeof steps.waiting === "string" ? steps.waiting : null);
    // A step that failed (whatever ONE says first) is a failure of the look: tried again later each time, then
    // said to need a person.
    if (steps.failed === true) failed = true;
  } catch {
    failed = true;
  }
  const { error: unrecorded } = await service.rpc("record_case_advance", {
    target_case: held.caseId,
    target_claim: held.claim,
    target_waiting: waiting,
    target_failed: failed,
  });
  // What ONE asked for is the jobs' now (or, with none, done right here); each is also owed to their sweeps.
  for (const draftId of asked.drafts) {
    try {
      await follow.draft(draftId);
    } catch {
      // Owed: the sweep of the pieces takes it.
    }
  }
  for (const packageId of asked.packages) {
    try {
      await follow.package(packageId);
    } catch {
      // Owed: the sweep of the packages takes it.
    }
  }
  if (created) return "created";
  // The claim stays held until it is stale when its record did not land: the case is looked at again then.
  if (failed || unrecorded) return "failed";
  if (asked.drafts.length > 0 || asked.packages.length > 0) return "acted";
  return waiting ? "waiting" : "idle";
}

/** The jobs take what ONE asked for. */
export const followByJobs: AdvanceFollow = {
  draft: async (draftId) => {
    await sendEvent("one/case.draft.requested", { draftId });
  },
  package: async (packageId) => {
    await sendEvent("one/case.filing.requested", { packageId });
  },
};

/** With no jobs, what ONE asked for is worked on here: a first text and what follows it, a package built. */
const followHere: AdvanceFollow = {
  draft: async (draftId) => {
    const service = createServiceClient();
    for (let turn = 0; turn < 3; turn += 1) {
      const outcome = await draftNext(service, draftId);
      if (outcome !== "generated" && outcome !== "revised" && outcome !== "checked") break;
    }
  },
  package: async (packageId) => {
    await buildFilingPackages(createServiceClient(), 1, packageId);
  },
};

/** One claim and the case it held: its outcome (none when nothing was due), and how many it set aside. */
export async function advanceOne(
  service: SupabaseClient,
  target: string | null,
  follow: AdvanceFollow,
): Promise<{ outcome: AdvanceOutcome | null; parked: number }> {
  const { held, parked } = await claimCaseAdvances(service, 1, target);
  if (!held[0]) return { outcome: null, parked };
  return { outcome: await advanceClaimedCase(service, held[0], follow), parked };
}

/**
 * Claims and carries on the cases due, one at a time, while there may be
 * more (a claim that only set cases aside may have more due behind them);
 * the outcome of each.
 */
export async function advanceCases(
  service: SupabaseClient,
  limit: number,
  target: string | null,
  follow: AdvanceFollow,
): Promise<Record<AdvanceOutcome, number>> {
  const outcomes: Record<AdvanceOutcome, number> = { created: 0, acted: 0, waiting: 0, idle: 0, lost: 0, failed: 0 };
  for (let turn = 0; turn < limit; turn += 1) {
    const round = await advanceOne(service, target, follow);
    if (round.outcome) outcomes[round.outcome] += 1;
    if (target || (!round.outcome && round.parked === 0)) break;
  }
  return outcomes;
}

/**
 * Something a person just did may have a step for ONE to take in a case
 * (the database already woke it): the jobs look at once. Without them (a
 * machine with no Inngest), the case is looked at after the response is
 * sent. Named no case (a change of the firm's, such as who signs), the jobs
 * sweep the cases it woke; with none, the sweep's next pass does.
 */
export async function queueCaseAdvance(caseId: string | null): Promise<void> {
  const sent = await sendEvent("one/case.advance", { caseId });
  if (sent.sent || !caseId) return;
  after(async () => {
    try {
      await advanceCases(createServiceClient(), 1, caseId, followHere);
    } catch {
      // Still due: the sweep takes it.
    }
  });
}
