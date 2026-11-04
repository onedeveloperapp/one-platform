import "server-only";

import { providerReadiness, runFirmTask } from "@/lib/ai/executor";
import { countDeadlines } from "@/lib/deadlines/count-work";
import { syncHearings } from "@/lib/hearings/calendar-work";
import { soon } from "@/lib/jobs/soon";
import { triageText } from "@/lib/publications/publications";
import { READING_TASK, type ReadingAct, readingBriefing, readingFailure } from "@/lib/publications/reading";
import { isReadingKind, READING_KINDS, type ReadingKind } from "@/lib/publications/reading-words";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a publication ONE reads (migration 0040): claim a
 * publication a person triaged as a deadline or a hearing, hand the AI its
 * text, and let the database say what came of it. The database reads the
 * AI's answer from the run, never from here; it takes it only where the
 * publication's own words say it, and records the deadline or the hearing
 * through the person's own functions, as ONE. Only ids leave this file.
 */

/**
 * The kinds a run of a reading would find a model for in this environment:
 * the provider the instructions in force of its task name has a key (or the
 * test provider stands in). Only those are claimed: a reading waits for a
 * model, and the database gives it to a person when it waited too long
 * (`settle_publication_readings`), never marks it as one that failed.
 */
export async function readingReadyKinds(service: SupabaseClient): Promise<ReadingKind[]> {
  const readiness = providerReadiness();
  if (readiness.fake) return [...READING_KINDS];
  const { data, error } = await service
    .from("prompt_versions")
    .select("task, provider")
    .in(
      "task",
      READING_KINDS.map((kind) => READING_TASK[kind]),
    )
    .eq("is_active", true);
  if (error || !data) return [];
  const configured = readiness.configured as Record<string, boolean>;
  const ready = new Set(
    (data as { task: string; provider: string }[])
      .filter((row) => configured[String(row.provider)] === true)
      .map((row) => row.task),
  );
  return READING_KINDS.filter((kind) => ready.has(READING_TASK[kind]));
}

/**
 * What is due that ONE will not read (a person did it first, the firm or the
 * operator holds it, old work, tries spent, a wait too long for a model) is
 * settled by the database: also where no model can be asked, so a reading
 * never says ONE is reading it for longer than the setting's hours.
 */
export async function settlePublicationReadings(service: SupabaseClient): Promise<number> {
  const { data, error } = await service.rpc("settle_publication_readings", {});
  if (error) throw new Error(`settle_publication_readings failed: ${error.code ?? "unknown"}`);
  return typeof data === "number" ? data : 0;
}

/** A reading the sweep holds, with the number of the claim. */
export type ReadingClaim = { publicationId: string; kind: ReadingKind; claim: number };

export async function claimPublicationReadings(
  service: SupabaseClient,
  limit = 1,
  publicationId: string | null = null,
  kinds: readonly ReadingKind[] = READING_KINDS,
): Promise<ReadingClaim[]> {
  if (kinds.length === 0) return [];
  const { data, error } = await service.rpc("claim_publication_readings", {
    target_limit: limit,
    target_publication: publicationId,
    target_kinds: [...kinds],
  });
  if (error) throw new Error(`claim_publication_readings failed: ${error.code ?? "unknown"}`);
  return ((data ?? []) as { publication_id: string; kind: string; claim: number }[]).flatMap((row) =>
    isReadingKind(row.kind) ? [{ publicationId: row.publication_id, kind: row.kind, claim: Number(row.claim) }] : [],
  );
}

/** What follows what ONE recorded: the deadline counted, the hearing written to the firm's calendar. */
export type ReadingFollow = {
  deadline: (deadlineId: string) => Promise<void>;
  hearing: (hearingId: string) => Promise<void>;
};

/** What follows is done in the same work: the count, and the event of the calendar; the sweeps take what fails. */
const followReadingHere: ReadingFollow = {
  deadline: async (deadlineId) => {
    await countDeadlines(createServiceClient(), { limit: 1, deadlineId });
  },
  hearing: async (hearingId) => {
    await syncHearings(createServiceClient(), { limit: 1, hearingId });
  },
};

type PublicationToRead = {
  publication_id: string;
  org_id: string;
  kind: string;
  claim: number;
  court: string;
  communication: string | null;
  document_type: string | null;
  class_name: string | null;
  body: string;
  truncated: boolean;
  proceeding_kind: string | null;
  acts: { codigo?: unknown; nome?: unknown; dias?: unknown }[];
};

const OUTCOMES = ["done", "unread", "skipped", "retry", "failed", "released"] as const;
/**
 *   done      ONE recorded the deadline or the hearing;
 *   unread    the words of the publication did not say what the AI read, or the person's own function
 *             refused it: left to a person, with why;
 *   skipped   a person did it first, the triage changed, or the firm no longer lets ONE read;
 *   retry     the model answered badly for this text: tried again after a wait, a few times;
 *   failed    final for this reading;
 *   released  nothing was learned of the publication (the provider is out, a key was refused): the try
 *             does not count;
 *   not_held  the claim is no longer this worker's;
 *   in_course the run of this very claim is still running elsewhere (a step that ran twice).
 */
export type ReadingOutcome = (typeof OUTCOMES)[number] | "not_held" | "in_course";

const acts = (raw: PublicationToRead["acts"]): ReadingAct[] =>
  (Array.isArray(raw) ? raw : []).flatMap((act) =>
    typeof act?.codigo === "string" && typeof act.nome === "string"
      ? [{ code: act.codigo, name: act.nome, days: typeof act.dias === "number" ? act.dias : null }]
      : [],
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hands the AI a claimed publication and records what came of it. Never throws for what a model did. */
export async function readClaimedPublication(
  service: SupabaseClient,
  held: ReadingClaim,
  follow: ReadingFollow,
): Promise<ReadingOutcome> {
  const { data, error } = await service.rpc("publication_reading_to_read", {
    target_publication: held.publicationId,
    target_kind: held.kind,
    target_claim: held.claim,
  });
  if (error) throw new Error(`publication_reading_to_read failed: ${error.code ?? "unknown"}`);
  const row = data as PublicationToRead | null;
  if (!row || !isReadingKind(row.kind)) return "not_held";
  const kind = row.kind;

  const record = async (
    outcome: "done" | "retry" | "released",
    input: { runId?: string | null; code?: string | null } = {},
  ): Promise<ReadingOutcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_publication_reading", {
      target_publication: row.publication_id,
      target_kind: kind,
      target_claim: row.claim,
      target_outcome: outcome,
      target_run: input.runId ?? null,
      target_code: input.code ?? null,
    });
    if (recordError) throw new Error(`record_publication_reading failed: ${recordError.code ?? "unknown"}`);
    // What was recorded is what the database says: it is the one that read the publication's words.
    const answer = (recorded ?? {}) as { code?: string; deadline_id?: unknown; hearing_id?: unknown };
    const code = OUTCOMES.find((known) => known === answer.code) ?? "not_held";
    if (code === "done") {
      // What follows is asked for and never waited on: the sweeps of the count and of the calendar reach it anyway.
      try {
        if (typeof answer.deadline_id === "string" && UUID.test(answer.deadline_id)) {
          await follow.deadline(answer.deadline_id);
        }
        if (typeof answer.hearing_id === "string" && UUID.test(answer.hearing_id)) {
          await follow.hearing(answer.hearing_id);
        }
      } catch {
        // The sweeps take it.
      }
    }
    return code;
  };
  /** A failure, said as what it says of the publication: a try of its own, or nothing at all. */
  const failed = (code: string, runId: string | null = null) => record(readingFailure(code), { runId, code });

  const facts = {
    kind,
    court: row.court,
    communication: row.communication,
    documentType: row.document_type,
    className: row.class_name,
    proceedingKind: row.proceeding_kind,
    body: row.body,
    truncated: Boolean(row.truncated),
    acts: acts(row.acts),
  };
  const result = await runFirmTask({
    orgId: row.org_id,
    task: READING_TASK[kind],
    // Hashed for the record: what the model was handed, never kept as text by the run.
    input: { ...facts, body: triageText(row.body) },
    messages: [{ role: "user", content: readingBriefing(facts) }],
    subject: { type: "publication", id: row.publication_id },
    idempotencyKey: `leitura:${row.publication_id}:${kind}:${row.claim}`,
  });

  if (result.kind === "refused") return failed(result.code);
  if (result.kind === "failed") return failed(result.code, result.runId);
  if (result.kind === "replayed" && result.status === "running") return "in_course";
  // Its first run had ended without a word: nothing is known of the publication, and the next claim is another run.
  if (result.kind === "replayed" && result.status !== "succeeded") return failed("run_failed");
  return record("done", { runId: result.runId });
}

/**
 * Claims the reading that waits the longest (or one of the publication
 * named) and reads it: one piece of work, so a claim is never held while its
 * worker waits in a line for its turn. `none` when nothing waits.
 */
export async function readNext(
  service: SupabaseClient,
  publicationId: string | null = null,
  follow: ReadingFollow = followReadingHere,
  kinds: readonly ReadingKind[] = READING_KINDS,
): Promise<ReadingOutcome | "none"> {
  const held = (await claimPublicationReadings(service, 1, publicationId, kinds))[0];
  return held ? readClaimedPublication(service, held, follow) : "none";
}

/**
 * A person just triaged a publication as a deadline or a hearing: it is read
 * right after the response is sent. Never waited for: the sweep reads it
 * anyway.
 */
export async function queuePublicationReading(publicationId: string): Promise<void> {
  soon("publication-reading", async () => {
    const service = createServiceClient();
    const kinds = await readingReadyKinds(service);
    for (let turn = 0; turn < READING_KINDS.length; turn += 1) {
      const outcome = await readNext(service, publicationId, followReadingHere, kinds);
      if (outcome === "none" || outcome === "released") break;
    }
  });
}
