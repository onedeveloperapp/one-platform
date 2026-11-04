import "server-only";

import { after } from "next/server";

import { runFirmTask } from "@/lib/ai/executor";
import {
  CHRONOLOGY_TASK,
  chronologyBriefing,
  isPassingStatementFailure,
  TRANSCRIPTION_TASK,
} from "@/lib/cases/statements";
import { supabaseFileStore } from "@/lib/files/store";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a client's account (migration 0026): an audio is
 * transcribed (`caso.relato.transcricao`), and of the text (transcribed or
 * written) a chronology is proposed (`caso.relato.cronologia`), which waits
 * in the firm's queue. Nothing here approves anything, and nothing here says
 * what a model answered: the worker names the run, and the database reads
 * the run's own answer and whether it waits for a person.
 *
 * Every step is a function of the database the service role alone may call;
 * a statement claimed and never recorded goes back to the line by itself,
 * and a passing failure is tried again until the setting's attempts are
 * spent. Only ids leave this file.
 */

type StatementToProcess = {
  statement_id: string;
  org_id: string;
  case_id: string;
  work: "transcribe" | "chronology";
  /** The number of the claim: handed back with the outcome, and what makes this run its own. */
  claim: number;
  storage_path: string | null;
  detected_mime: string | null;
  sha256: string | null;
  bytes: number | null;
  max_bytes: number | null;
  transcript: string | null;
  previous_chronology: string | null;
  client_note: string | null;
  incident: string | null;
  flight_date: string | null;
  airline: string | null;
  /** The proposal the firm sent back and what it asked to change in it, while no proposal answered that. */
  returned_proposal: string | null;
  firm_note: string | null;
  /** What the client answered to what an order of the facts said was missing (0090). */
  client_added: string | null;
  /** The legs of the trip as the case registers them, with what ANAC's record says of each flight (0090). */
  trip: unknown;
};

/** A statement the sweep holds, with the number of the claim: only who holds it reads and records under it. */
export type StatementClaim = { statementId: string; claim: number };

export async function claimCaseStatements(
  service: SupabaseClient,
  limit = 10,
  statementId: string | null = null,
): Promise<StatementClaim[]> {
  const { data, error } = await service.rpc("claim_case_statements", {
    target_limit: limit,
    target_statement: statementId,
  });
  if (error) throw new Error(`claim_case_statements failed: ${error.message}`);
  return ((data ?? []) as { statement_id: string; claim: number }[]).map((row) => ({
    statementId: row.statement_id,
    claim: Number(row.claim),
  }));
}

const OUTCOMES = ["transcribed", "waiting", "proposed", "retry", "failed", "not_working"] as const;
/**
 * `not_held`: the claim is no longer this worker's (it fell behind and another took the statement).
 * `in_course`: the run of this very claim is still running elsewhere (a step that ran twice); nothing is
 * said, and whoever finishes it says what it came to.
 */
export type StatementOutcome = (typeof OUTCOMES)[number] | "not_held" | "in_course";

/**
 * Does the work a claimed statement is owed and records what came of it.
 * Never throws for what a file or a model did. A statement just transcribed
 * is left with its chronology as the next work, for the next claim.
 */
export async function processClaimedStatement(
  service: SupabaseClient,
  held: StatementClaim,
): Promise<StatementOutcome> {
  const { data, error } = await service.rpc("case_statement_to_process", {
    target_statement: held.statementId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`case_statement_to_process failed: ${error.message}`);
  const row = ((data ?? []) as StatementToProcess[])[0];
  if (!row) return "not_held";

  const record = async (
    outcome: "transcribed" | "proposed" | "failed",
    input: { runId?: string | null; code?: string | null } = {},
  ): Promise<StatementOutcome> => {
    const said = outcome === "failed" && input.code && isPassingStatementFailure(input.code) ? "retry" : outcome;
    const { data: recorded, error: recordError } = await service.rpc("record_statement_work", {
      target_statement: row.statement_id,
      target_claim: row.claim,
      target_outcome: said,
      target_run: input.runId ?? null,
      target_code: input.code ?? null,
    });
    if (recordError) throw new Error(`record_statement_work failed: ${recordError.message}`);
    // What was recorded is what the database says: it is the one that knows whether the answer waits.
    const answer = String((recorded as { code?: string } | null)?.code ?? "");
    return OUTCOMES.find((code) => code === answer) ?? "failed";
  };

  const subject = { type: "case_statement", id: row.statement_id };
  const key = (task: string) => `${task}:${row.statement_id}:${row.claim}`;

  /** What a run came to, for either task: the database reads the answer of a run that succeeded. */
  const close = async (
    result: Awaited<ReturnType<typeof runFirmTask>>,
    done: "transcribed" | "proposed",
  ): Promise<StatementOutcome> => {
    if (result.kind === "refused") return record("failed", { code: result.code });
    if (result.kind === "failed") return record("failed", { runId: result.runId, code: result.code });
    if (result.kind === "replayed" && result.status === "running") {
      // The same claim worked on twice (a step that ran again) while its first run is still going:
      // that run's own end is recorded by who reaches it, or the claim goes back to the line by itself.
      return "in_course";
    }
    if (result.kind === "replayed" && result.status !== "succeeded") {
      // Its first run had failed without a word: the next claim is another run.
      return record("failed", { code: "run_failed" });
    }
    return record(done, { runId: result.runId });
  };

  if (row.work === "transcribe") {
    if (!row.storage_path || !row.detected_mime) return record("failed", { code: "file_unreadable" });
    // The largest audio the model is handed is a setting: a longer account is left for a person to write down.
    if (row.max_bytes !== null && Number(row.bytes ?? 0) > Number(row.max_bytes)) {
      return record("failed", { code: "audio_too_large" });
    }
    const audio = await supabaseFileStore(service).get(row.storage_path);
    if (!audio) return record("failed", { code: "file_unreadable" });
    return close(
      await runFirmTask({
        orgId: row.org_id,
        task: TRANSCRIPTION_TASK,
        // Hashed for the record: the audio's own hash, never its bytes.
        input: { sha256: row.sha256 },
        messages: [
          {
            role: "user",
            content: "Transcreva o áudio anexo e responda com o objeto pedido.",
            attachments: [
              { kind: "audio", mime: row.detected_mime, dataBase64: Buffer.from(audio).toString("base64") },
            ],
          },
        ],
        subject,
        idempotencyKey: key("transcricao"),
      }),
      "transcribed",
    );
  }

  if (!row.transcript) return record("failed", { code: "not_transcribed" });
  const legs = Array.isArray(row.trip) ? (row.trip as unknown[]) : [];
  const trip = { incident: row.incident, airline: row.airline, flightDate: row.flight_date, legs };
  const contested = row.client_note ? { chronology: row.previous_chronology, clientNote: row.client_note } : null;
  const returned = row.firm_note ? { proposal: row.returned_proposal, firmNote: row.firm_note } : null;
  const added = row.client_added ? { chronology: row.previous_chronology, answers: row.client_added } : null;
  return close(
    await runFirmTask({
      orgId: row.org_id,
      task: CHRONOLOGY_TASK,
      input: { ...trip, relato: row.transcript, contestada: contested, devolvida: returned, respostas: added },
      messages: [{ role: "user", content: chronologyBriefing(trip, row.transcript, contested, returned, added) }],
      subject,
      idempotencyKey: key("cronologia"),
    }),
    "proposed",
  );
}

/** Claims and works on what waits (or the one statement named), one after the other. */
export async function processCaseStatements(
  service: SupabaseClient,
  limit = 10,
  statementId: string | null = null,
): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = {};
  for (const held of await claimCaseStatements(service, limit, statementId)) {
    const outcome = await processClaimedStatement(service, held).catch(() => "error");
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return outcomes;
}

/**
 * A statement just reached a case: the jobs work on it at once. Without them
 * (a machine with no Inngest), it is worked on after the response is sent:
 * first the transcription, then the chronology of what was transcribed.
 */
export async function queueStatementWork(statementId: string): Promise<void> {
  const sent = await sendEvent("one/case.statement.received", { statementId });
  if (sent.sent) return;
  after(async () => {
    try {
      const service = createServiceClient();
      const first = await processCaseStatements(service, 1, statementId);
      if (first.transcribed) await processCaseStatements(service, 1, statementId);
    } catch {
      // Still owed: the sweep takes it.
    }
  });
}
