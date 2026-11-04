import "server-only";

import { createHash } from "node:crypto";

import { runFirmTask } from "@/lib/ai/executor";
import { maskIdentifiers } from "@/lib/cases/drafts";
import {
  askMessage,
  type AskMode,
  INTERVIEW_TASK,
  interviewDoneMessage,
  type InterviewReading,
  interviewReadingOf,
  type InterviewView,
  interviewViewOf,
  nextStep,
  NOTICE_STANDING_PIECE,
  noticeOf,
  pendingQuestions,
  questionText,
  resumeWhat,
} from "@/lib/cases/interview";
import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import { type InterviewFacts, type InterviewQuestion, QUESTION_SHAPE } from "@flyee/rules/interview";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the passenger's interview (migration 0095): it is
 * opened for a case of a flight's problem being gathered; each step records
 * what the rule leaves out (with why) and asks the next question in the
 * conversation ONE holds, inside the 24 hours, one at a time; an answer the
 * passenger writes there is read by the task `atendimento.entrevista.resposta`
 * (which only says what they wrote) and recorded, and the next question goes;
 * a reply that does not serve is asked again once, then kept as not known;
 * a question not answered is reminded once; outside the 24 hours, the firm's
 * template asks to go on; with every question settled it is done, and ONE
 * creates the lawsuits. Every write is a function of the database the
 * service role alone may call. Only ids and counts leave this file.
 */

/** Today on the platform's calendar (Brasília). */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function rpc(
  service: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`${name} failed`);
  return (data ?? {}) as Record<string, unknown>;
}

async function send(service: SupabaseClient, messageId: unknown): Promise<void> {
  if (typeof messageId !== "string") return;
  try {
    await deliverOutbox(service, { messageId });
  } catch {
    // Queued: the outbox's sweep sends it.
  }
}

/** An interview as the backend reads it, by its id or its case's. */
export async function readInterview(
  service: SupabaseClient,
  by: { interviewId?: string | null; caseId?: string | null },
): Promise<InterviewView | null> {
  const { data, error } = await service.rpc("interview_for_work", {
    target_interview: by.interviewId ?? null,
    target_case: by.caseId ?? null,
  });
  if (error) throw new Error("interview_for_work failed");
  return interviewViewOf(data);
}

/** Opens a case's interview when it is owed one; answers its id, or null. */
export async function startInterview(service: SupabaseClient, caseId: string): Promise<string | null> {
  const started = await rpc(service, "interview_start", { target_case: caseId });
  return started.ok && typeof started.interview_id === "string" ? started.interview_id : null;
}

/** ONE asks a question in the conversation; what it wrote, the outbox sends. Answers the database's code. */
async function ask(
  service: SupabaseClient,
  view: InterviewView,
  question: InterviewQuestion,
  mode: AskMode,
): Promise<string> {
  const answer = await rpc(service, "interview_ask", {
    target_interview: view.id,
    target_question: question,
    target_body: askMessage(question, view.facts, mode, view.firstName),
    target_mode: mode,
  });
  if (answer.ok) await send(service, answer.message_id);
  return typeof answer.code === "string" ? answer.code : "failed";
}

export type StepOutcome = "asked" | "waiting" | "done" | "unreachable" | "closed";

/**
 * Carries an interview one step: what the rule leaves out is recorded with
 * why; with nothing left to ask it is done (and ONE says so where it may);
 * else, when no question waits and ONE may write, the next is asked. `back`
 * asks again the question that waits, after ONE answered something the
 * passenger asked meanwhile.
 */
export async function advanceInterview(
  service: SupabaseClient,
  interviewId: string,
  mode: "ask" | "back" = "ask",
): Promise<StepOutcome> {
  let view = await readInterview(service, { interviewId });
  if (!view || view.status !== "open") return "closed";
  let plan = nextStep(view.facts);
  if (plan.skips.length > 0) {
    for (const skip of plan.skips) {
      await rpc(service, "interview_answer", {
        target_interview: view.id,
        target_question: skip.question,
        target_status: "skipped",
        target_reason: skip.reason,
      });
    }
    view = await readInterview(service, { interviewId });
    if (!view || view.status !== "open") return "closed";
    plan = nextStep(view.facts);
  }
  if (!plan.next) {
    const finished = await rpc(service, "interview_finish", {
      target_interview: view.id,
      target_body: interviewDoneMessage(view.firstName),
    });
    if (finished.ok) await send(service, finished.message_id);
    return "done";
  }
  if (view.currentQuestion) {
    if (mode === "back" && view.inChat) await ask(service, view, view.currentQuestion, "back");
    return "waiting";
  }
  if (!view.inChat) return "unreachable";
  const code = await ask(service, view, plan.next, "ask");
  return code === "queued" ? "asked" : code === "unreachable" ? "unreachable" : "waiting";
}

/** What the task is handed: the question asked now, the ones still to come, the flight's days, and the words. */
export function readingBriefing(input: {
  facts: InterviewFacts;
  current: InterviewQuestion | null;
  flightDate: string | null;
  today: string;
  words: string[];
}): string {
  const shapeWord = { yes_no: "pede sim ou não", moment: "pede um dia e uma hora", text: "pede as palavras dele" };
  const pending = pendingQuestions(input.facts, input.current);
  return [
    input.current
      ? `Pergunta feita agora: [${input.current}] ${questionText(input.current, input.facts)} (${shapeWord[QUESTION_SHAPE[input.current]]})`
      : "Pergunta feita agora: nenhuma.",
    pending.length > 0
      ? `Outras perguntas que ainda faltam:\n${pending.map((question) => `[${question}] ${questionText(question, input.facts)}`).join("\n")}`
      : "Outras perguntas que ainda faltam: nenhuma.",
    `Dia do voo: ${input.flightDate ?? "não informado"}. Partida prevista: ${input.facts.scheduledDeparture ?? "não informada"}. Chegada prevista: ${input.facts.scheduledArrival ?? "não informada"}. Hoje: ${input.today}.`,
    `O que o passageiro escreveu:\n"""\n${maskIdentifiers(input.words.join("\n")).slice(0, 3000)}\n"""`,
  ].join("\n\n");
}

/** Records one answer; a question answered before keeps its first answer (the database decides). */
async function record(
  service: SupabaseClient,
  view: InterviewView,
  question: InterviewQuestion,
  status: "answered" | "unknown",
  answer: string | null,
  words: string | null,
  facts: { sim_nao?: string | null; quando?: string | null },
  runId: string | null,
): Promise<void> {
  await rpc(service, "interview_answer", {
    target_interview: view.id,
    target_question: question,
    target_status: status,
    target_answer: answer,
    target_words: words,
    target_facts: facts,
    target_run: runId,
  });
}

export type AnswerOutcome = "answered" | "asked_again" | "unknown" | "question" | "none";

/**
 * What the passenger wrote, read as the answer to the question that waits
 * (and to any other still to come it also answers): recorded, and the next
 * question goes. A question of theirs instead of an answer is left to ONE's
 * reply (`question`: the caller asks the question again after it). A reply
 * that does not serve is asked again once, then kept as not known. With no
 * model at hand, their words are kept as they wrote them.
 */
export async function answerInterview(
  service: SupabaseClient,
  input: { orgId: string; view: InterviewView; words: string[]; key: string },
): Promise<AnswerOutcome> {
  const { view } = input;
  const words = input.words.map((word) => word.trim()).filter(Boolean);
  if (words.length === 0) return "none";
  const current = view.currentQuestion;
  const joined = words.join("\n").slice(0, 4000);
  const run = await runFirmTask({
    orgId: input.orgId,
    task: INTERVIEW_TASK,
    input: { pergunta: current, faltam: pendingQuestions(view.facts, current), palavras: maskIdentifiers(joined) },
    messages: [
      {
        role: "user",
        content: readingBriefing({ facts: view.facts, current, flightDate: view.flightDate, today: today(), words }),
      },
    ],
    subject: { type: "case_interview", id: view.id },
    idempotencyKey: `interview:${view.id}:${createHash("sha256").update(input.key, "utf8").digest("hex").slice(0, 32)}`,
  });
  const reading: InterviewReading | null =
    run.kind === "finished" && !run.approvalId ? interviewReadingOf(run.output) : null;
  const runId = run.kind === "finished" ? run.runId : null;

  if (!reading) {
    // No model at hand, or an answer that is not one: the passenger's words are the answer, as they wrote them.
    if (!current) return "none";
    await record(service, view, current, "answered", joined.slice(0, 2000), joined, {}, null);
    await advanceInterview(service, view.id);
    return "answered";
  }

  for (const other of reading.others) {
    if (other.question === current) continue;
    await record(
      service,
      view,
      other.question,
      "answered",
      other.answer,
      joined,
      { sim_nao: other.yesNo, quando: other.when },
      runId,
    );
  }

  if (reading.situation === "pergunta") return "question";
  if (!current) {
    await advanceInterview(service, view.id);
    return reading.others.length > 0 ? "answered" : "none";
  }
  if (reading.situation === "respondida" || reading.situation === "nao_sabe") {
    await record(
      service,
      view,
      current,
      reading.situation === "nao_sabe" ? "unknown" : "answered",
      reading.situation === "nao_sabe" ? null : reading.answer || joined.slice(0, 2000),
      joined,
      { sim_nao: reading.yesNo, quando: reading.when },
      runId,
    );
    await advanceInterview(service, view.id);
    return "answered";
  }
  // Not an answer that serves: asked once more with what it takes, then kept as not known.
  const again = await ask(service, view, current, "again");
  if (again === "queued") return "asked_again";
  await record(service, view, current, "unknown", null, joined, {}, runId);
  await advanceInterview(service, view.id);
  return "unknown";
}

/**
 * A paper the passenger sent in the conversation while the question that waits asks for one (the airline's
 * declaration, the receipts of what they spent): it is their answer, and the paper joins the case as any other.
 */
export async function answerWithPaper(service: SupabaseClient, view: InterviewView): Promise<boolean> {
  if (view.currentQuestion !== "motivo" && view.currentQuestion !== "gastos") return false;
  await record(
    service,
    view,
    view.currentQuestion,
    "answered",
    view.currentQuestion === "motivo"
      ? "O passageiro enviou pela conversa um documento sobre o motivo."
      : "O passageiro enviou pela conversa comprovantes dos gastos.",
    null,
    {},
    null,
  );
  await advanceInterview(service, view.id);
  return true;
}

/**
 * An audio the passenger sent in the conversation while a question waited, once it is transcribed: its text is
 * read as their answer. Never throws.
 */
export async function answerFromStatement(service: SupabaseClient, statementId: string): Promise<void> {
  try {
    const { data } = await service
      .from("case_statements")
      .select("org_id, case_id, source, transcript, created_at")
      .eq("id", statementId)
      .maybeSingle();
    const row = data as {
      org_id: string;
      case_id: string;
      source: string;
      transcript: string | null;
      created_at: string;
    } | null;
    if (!row || row.source !== "whatsapp" || !row.transcript) return;
    const view = await readInterview(service, { caseId: row.case_id });
    if (!view || view.status !== "open" || !view.currentQuestion || !view.askedAt) return;
    if (new Date(row.created_at).getTime() < new Date(view.askedAt).getTime()) return;
    await answerInterview(service, {
      orgId: row.org_id,
      view,
      words: [row.transcript],
      key: `statement:${statementId}`,
    });
  } catch {
    // The question still waits: its reminder, or a person, takes it.
  }
}

/** What the piece reads of the interview: each answer, and how the change was told against the 72 hours. */
export async function interviewForPiece(
  service: SupabaseClient,
  caseId: string,
): Promise<{ entrevista: unknown; aviso_72h: string | null } | null> {
  const [piece, view] = await Promise.all([
    service.rpc("case_interview_for_piece", { target_case: caseId }),
    readInterview(service, { caseId }).catch(() => null),
  ]);
  if (piece.error || !piece.data) return null;
  const standing = view ? noticeOf(view.facts) : null;
  return { entrevista: piece.data, aviso_72h: standing ? NOTICE_STANDING_PIECE[standing] : null };
}

/**
 * The sweep of the interviews: the cases owed one are opened and asked;
 * each open one goes a step (the next question where none waits, a reminder
 * where one waits long enough, the database deciding); and the passengers
 * outside the 24 hours are asked by the firm's template to go on. Counts only.
 */
export async function sweepInterviews(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = {};
  const tally = (key: string) => {
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  };

  const { data: owed, error: owedError } = await service.rpc("interviews_to_start", { target_limit: 10 });
  if (owedError) throw new Error("interviews_to_start failed");
  for (const caseId of (owed ?? []) as string[]) {
    if (Date.now() >= until) break;
    const started = await startInterview(service, caseId).catch(() => null);
    if (started) tally("started");
  }

  const { data: open, error: openError } = await service.rpc("interviews_open", { target_limit: 50 });
  if (openError) throw new Error("interviews_open failed");
  for (const interviewId of (open ?? []) as string[]) {
    if (Date.now() >= until) break;
    try {
      const view = await readInterview(service, { interviewId });
      if (!view || view.status !== "open") continue;
      if (view.currentQuestion) {
        if (view.inChat && (await ask(service, view, view.currentQuestion, "remind")) === "queued") tally("reminded");
        continue;
      }
      tally(await advanceInterview(service, interviewId));
    } catch {
      tally("failed");
    }
  }

  const { data: resumes, error: resumeError } = await service.rpc("interview_resumes_owed", { target_limit: 20 });
  if (resumeError) throw new Error("interview_resumes_owed failed");
  for (const row of (resumes ?? []) as { interview_id: string; first_name: string | null; firm: string | null }[]) {
    if (Date.now() >= until) break;
    try {
      const view = await readInterview(service, { interviewId: row.interview_id });
      if (!view) continue;
      const resumed = await rpc(service, "interview_resume", {
        target_interview: row.interview_id,
        target_params: [row.first_name || "tudo bem", row.firm ?? "", resumeWhat(view.facts)],
      });
      if (resumed.ok) {
        await send(service, resumed.message_id);
        tally("resumed");
      }
    } catch {
      tally("failed");
    }
  }
  return outcomes;
}

/**
 * Right after a case opens, or after something the interview reads changed
 * (a paper accepted, a person's answer, an answer on the link): the
 * interview is opened when owed and goes a step, on the same server, never
 * waited for. The sweep takes what this did not finish.
 */
export function queueInterview(by: { caseId?: string | null; interviewId?: string | null }): void {
  soon("case-interview", async () => {
    const service = createServiceClient();
    let interviewId = by.interviewId ?? null;
    if (!interviewId && by.caseId) {
      interviewId =
        (await startInterview(service, by.caseId).catch(() => null)) ??
        (await readInterview(service, { caseId: by.caseId }))?.id ??
        null;
    }
    if (interviewId) await advanceInterview(service, interviewId);
  });
}
