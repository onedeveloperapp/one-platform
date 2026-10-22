"use server";

import { revalidatePath } from "next/cache";

import { EXECUTOR_CHECK_TASK, type PromptDraft, promptDraftProblem } from "@/lib/admin/ai";
import { requireSuperadmin } from "@/lib/admin/session";
import { runFirmTask } from "@/lib/ai/executor";
import { recordAudit } from "@/lib/audit";

/**
 * What the AI console does: running the task that has nothing of a client in
 * it for a chosen firm, so the operator sees the whole path work (the
 * instructions in force, the model, the cost charged to that firm, the firm's
 * approval queue); publishing the next version of a task's instructions; and
 * changing how much of what a task answers waits for a person.
 *
 * A server action is a public endpoint: the role is checked here again,
 * whatever the screen that called it showed.
 */

export type ExecutorCheckResult =
  | {
      ok: true;
      /** `queued`: the answer waits in the firm's queue. `took_effect`: the task has autonomy. */
      outcome: "queued" | "took_effect";
      runId: string;
      costUsdMicros: number;
      /** False when the model that answered has no price: the cost is unknown, not zero. */
      priced: boolean;
    }
  | { ok: false; code: string; runId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The floor the product uses for an operator's reason. */
const REASON_MIN = 8;

/**
 * Puts back in the line the publications the shadow triage gave up on. The
 * database checks the role and records it; the answer is a count.
 */
export async function reopenPublicationTriage(): Promise<{ ok: true; reopened: number } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_reopen_publication_triage");
  if (error || !data) return { ok: false, code: "failed" };
  revalidatePath("/admin/ai");
  return { ok: true, reopened: Number((data as { reopened?: number }).reopened ?? 0) };
}

/**
 * Lets a category of the AI's triage of publications out of the shadow, with
 * the share of it a person checks, or puts it back (migration 0035). The
 * database checks the role, the goal and the note, and records it.
 */
export async function setTriagePolicy(input: {
  category: string;
  mode: "shadow" | "sampled";
  samplePercent: number;
  note: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const note = String(input?.note ?? "").trim();
  if (note.length < REASON_MIN) return { ok: false, code: "reason_required" };
  const { data, error } = await session.supabase.rpc("set_publication_triage_policy", {
    target_category: String(input.category ?? ""),
    target_mode: input.mode === "sampled" ? "sampled" : "shadow",
    target_sample_percent: Number.isInteger(input.samplePercent) ? input.samplePercent : null,
    target_note: note,
  });
  if (error || !data) return { ok: false, code: "failed" };
  const answer = data as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/admin/ai");
  return { ok: true };
}

export async function runExecutorCheck(orgId: string, reason: string): Promise<ExecutorCheckResult> {
  if (!UUID.test(orgId)) return { ok: false, code: "invalid" };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN) return { ok: false, code: "reason_required" };

  // Who asked and why, written before the call: the run records itself
  // (`ai.run.*`, as done by AI), and the reason survives nowhere else. It
  // carries the firm, so who manages it reads in its own trail that the
  // platform ran this there.
  await recordAudit(session.supabase, "admin.ai.executor_check", {
    orgId,
    entityType: "organization",
    entityId: orgId,
    metadata: { task: EXECUTOR_CHECK_TASK, reason: trimmed },
  });

  // The operator is not a person of the firm, so nobody is named as the
  // requester. The input is fixed: no data of a client goes into this task.
  const result = await runFirmTask({
    orgId,
    task: EXECUTOR_CHECK_TASK,
    input: { pergunta: "Confirme o recebimento desta verificação técnica.", tarefa: EXECUTOR_CHECK_TASK },
  });
  revalidatePath("/admin/ai");

  // The answer itself is never returned: it belongs to the firm.
  if (result.kind === "finished") {
    return {
      ok: true,
      outcome: result.approvalId ? "queued" : "took_effect",
      runId: result.runId,
      costUsdMicros: result.costUsdMicros,
      priced: result.priced,
    };
  }
  if (result.kind === "failed") return { ok: false, code: result.code, runId: result.runId };
  if (result.kind === "replayed") return { ok: false, code: "replayed", runId: result.runId };
  return { ok: false, code: result.code };
}

export type ConsoleWriteResult = { ok: true; version?: number } | { ok: false; code: string; message?: string };

const AUTONOMIES = ["approval", "sampled", "autonomous"] as const;

/** A known code of the database, out of the message it raised. */
const raisedCode = (message: string | null | undefined): string =>
  ["not_authorized", "unknown_task", "reason_required", "prompt_version_immutable"].find((code) =>
    (message ?? "").includes(code),
  ) ?? "failed";

/**
 * Publishes the next version of a task's instructions and puts it in force
 * (`publish_prompt_version`, 0016: superadmin only, never from a support
 * visit, audited there with the note). A published version never changes:
 * every run names the one it used, and a correction is the next version.
 */
export async function publishPromptVersion(draft: PromptDraft): Promise<ConsoleWriteResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const problem = promptDraftProblem({
    task: String(draft?.task ?? ""),
    provider: String(draft?.provider ?? ""),
    model: String(draft?.model ?? ""),
    effort: draft?.effort ? String(draft.effort) : null,
    systemPrompt: String(draft?.systemPrompt ?? ""),
    outputSchema: String(draft?.outputSchema ?? ""),
    maxTokens: Number(draft?.maxTokens),
    note: String(draft?.note ?? ""),
  });
  if (problem) return { ok: false, code: "invalid", message: problem.message };

  const { data, error } = await session.supabase.rpc("publish_prompt_version", {
    target_task: draft.task,
    target_provider: draft.provider,
    target_model: draft.model.trim(),
    target_system_prompt: draft.systemPrompt.trim(),
    target_output_schema: JSON.parse(draft.outputSchema) as Record<string, unknown>,
    target_effort: draft.effort,
    target_max_tokens: Number(draft.maxTokens),
    target_note: draft.note.trim(),
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  revalidatePath("/admin/ai");
  return { ok: true, version: Number((data as { version?: number } | null)?.version ?? 0) };
}

/**
 * Changes how much of what a task answers waits for a person
 * (`set_ai_task_autonomy`, 0016). The note is where the measured accuracy
 * that justifies it is written; the database refuses a change without one.
 */
export async function setTaskAutonomy(input: {
  task: string;
  autonomy: string;
  samplePercent: number | null;
  note: string;
}): Promise<ConsoleWriteResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!(AUTONOMIES as readonly string[]).includes(input?.autonomy)) return { ok: false, code: "invalid" };
  const note = String(input?.note ?? "").trim();
  if (note.length < REASON_MIN) return { ok: false, code: "reason_required" };
  const percent = input.autonomy === "sampled" ? Math.round(Number(input.samplePercent)) : null;
  if (percent !== null && (!Number.isFinite(percent) || percent < 1 || percent > 100)) {
    return { ok: false, code: "invalid" };
  }
  const { error } = await session.supabase.rpc("set_ai_task_autonomy", {
    target_task: String(input.task ?? ""),
    target_autonomy: input.autonomy,
    target_sample_percent: percent,
    target_note: note,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  revalidatePath("/admin/ai");
  return { ok: true };
}

/**
 * Holds a decision ONE takes alone for every firm (a person decides it everywhere), with the reason, or lets it go
 * (migration 0016, `admin_set_autonomy_hold`). The database checks the role and the reason and records it.
 */
export async function setAutonomyHold(input: {
  key: string;
  held: boolean;
  note: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const note = String(input?.note ?? "").trim();
  if (input?.held === true && note.length < REASON_MIN) return { ok: false, code: "reason_required" };
  const { data, error } = await session.supabase.rpc("admin_set_autonomy_hold", {
    target_decision: String(input?.key ?? ""),
    target_held: input?.held === true,
    target_note: input?.held === true ? note : null,
  });
  if (error || !data) return { ok: false, code: "failed" };
  const answer = data as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/admin/ai");
  return { ok: true };
}

/**
 * Releases ONE's first word to real passengers with the note of the legal opinion, or takes it back with why
 * (migration 0051, `admin_set_flight_alerts_release`). The database checks the operator, the second factor and the
 * note, and records it.
 */
export async function setFlightAlertsRelease(input: {
  released: boolean;
  note: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const note = String(input?.note ?? "").trim();
  if (note.length < 10) return { ok: false, code: "note_required" };
  const { data, error } = await session.supabase.rpc("admin_set_flight_alerts_release", {
    target_released: input?.released === true,
    target_note: note,
  });
  if (error)
    return { ok: false, code: error.message.includes("second_factor_required") ? "second_factor_required" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/admin/ai");
  return { ok: true };
}
