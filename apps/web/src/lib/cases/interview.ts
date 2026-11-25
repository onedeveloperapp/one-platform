import {
  assistanceAsked,
  type InterviewAnswer,
  type InterviewFacts,
  interviewPlan,
  interviewProgress,
  type InterviewQuestion,
  isInterviewQuestion,
  noticeStanding,
  QUESTION_SHAPE,
  questionsFor,
  questionsOf,
  SKIP_REASONS,
  type SkipReason,
  skipReason,
} from "@flyee/rules/interview";

/**
 * The passenger's interview (migration 0095, `@flyee/rules/interview`) as
 * the app says and reads it: the words of each question on WhatsApp and on
 * the client's link, what ONE says around them, what the AI read of an
 * answer, and what the firm's screen reads. Pure. The client reads the
 * firm, never ONE.
 */

export const INTERVIEW_TASK = "atendimento.entrevista.resposta";

export type InterviewStatus = "open" | "done" | "closed";
export type AnswerSource = "chat" | "link" | "firm" | "one";

export type InterviewAnswerView = {
  status: "answered" | "unknown" | "skipped";
  answer: string | null;
  words: string | null;
  source: AnswerSource;
  reason: SkipReason | null;
  yesNo: boolean | null;
  moment: string | null;
  answeredAt: string | null;
};

/** An interview as the database answers it (`interview_facts`), read. */
export type InterviewView = {
  id: string;
  caseId: string;
  status: InterviewStatus;
  currentQuestion: InterviewQuestion | null;
  askedAt: string | null;
  asks: number;
  remindedAt: string | null;
  resumedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  firstName: string;
  /** ONE may ask in a conversation it holds, inside the 24 hours, now. */
  inChat: boolean;
  flightDate: string | null;
  facts: InterviewFacts;
  answers: Partial<Record<InterviewQuestion, InterviewAnswerView>>;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const MOMENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

export function interviewViewOf(value: unknown): InterviewView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const caseId = text(row.case_id);
  const status = row.status === "open" || row.status === "done" || row.status === "closed" ? row.status : null;
  if (!id || !caseId || !status) return null;
  const answers: Partial<Record<InterviewQuestion, InterviewAnswerView>> = {};
  const ruleAnswers: Partial<Record<InterviewQuestion, InterviewAnswer>> = {};
  const raw =
    row.answers && typeof row.answers === "object" ? (row.answers as Record<string, Record<string, unknown>>) : {};
  for (const [question, item] of Object.entries(raw)) {
    if (!isInterviewQuestion(question) || !item || typeof item !== "object") continue;
    const answerStatus =
      item.status === "answered" || item.status === "unknown" || item.status === "skipped" ? item.status : null;
    if (!answerStatus) continue;
    const yesNo = item.sim_nao === "sim" ? true : item.sim_nao === "nao" ? false : null;
    const moment = typeof item.quando === "string" && MOMENT.test(item.quando) ? item.quando : null;
    const source =
      item.source === "chat" || item.source === "link" || item.source === "firm" || item.source === "one"
        ? item.source
        : "chat";
    const reason = (SKIP_REASONS as readonly unknown[]).includes(item.reason) ? (item.reason as SkipReason) : null;
    answers[question] = {
      status: answerStatus,
      answer: text(item.answer),
      words: text(item.words),
      source,
      reason,
      yesNo,
      moment,
      answeredAt: text(item.answered_at),
    };
    ruleAnswers[question] = { status: answerStatus, yesNo, moment };
  }
  const alert = row.alert && typeof row.alert === "object" ? (row.alert as Record<string, unknown>) : null;
  const alertKind =
    alert && (alert.kind === "cancelled" || alert.kind === "changed" || alert.kind === "delayed") ? alert.kind : null;
  const current = isInterviewQuestion(row.current_question) ? row.current_question : null;
  // The questions it asks when it asks what a piece lacks (0099).
  const only = Array.isArray(row.scope) ? (row.scope as unknown[]).filter(isInterviewQuestion) : [];
  return {
    id,
    caseId,
    status,
    currentQuestion: current,
    askedAt: text(row.asked_at),
    asks: typeof row.asks === "number" ? row.asks : 0,
    remindedAt: text(row.reminded_at),
    resumedAt: text(row.resumed_at),
    startedAt: text(row.started_at),
    finishedAt: text(row.finished_at),
    firstName: text(row.first_name) ?? "",
    inChat: row.in_chat === true,
    flightDate: text(row.flight_date),
    facts: {
      incident: text(row.incident) ?? "other",
      alert: alertKind
        ? { kind: alertKind, delayMinutes: typeof alert?.delay_minutes === "number" ? alert.delay_minutes : null }
        : null,
      airlineCause: text(row.airline_cause),
      scheduledDeparture: text(row.scheduled_departure),
      scheduledArrival: text(row.scheduled_arrival),
      actualArrival: text(row.actual_arrival),
      companionsKnown: row.companions_known === true,
      answers: ruleAnswers,
      only: only.length > 0 ? only : null,
    },
    answers,
  };
}

// ---------- The words of each question ----------

/** What the passenger learned of, after "soube": the problem of the case, in their words. */
const LEARNED_OF: Record<string, string> = {
  delay: "do atraso",
  cancellation: "do cancelamento",
  overbooking: "que não poderia embarcar",
  missed_connection: "que tinha perdido a conexão",
  downgrade: "da mudança de classe",
  other: "do problema",
};

const ASSISTANCE_WORDS: Record<"alimentacao" | "hospedagem" | "transporte", string> = {
  alimentacao: "alimentação",
  hospedagem: "hotel",
  transporte: "transporte até o hotel e de volta ao aeroporto",
};

const list = (items: string[]): string =>
  new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(items);

/** A question as the passenger reads it, on WhatsApp and on their link. */
export function questionText(question: InterviewQuestion, facts: InterviewFacts): string {
  const learned = LEARNED_OF[facts.incident] ?? LEARNED_OF.other;
  switch (question) {
    case "aviso_local":
      return `Quando você soube ${learned}, já estava no aeroporto?`;
    case "aviso_quando":
      return `Em que dia e a que horas a companhia avisou ${learned}, e por onde? Por exemplo: por e-mail, pelo aplicativo ou por SMS.`;
    case "motivo":
      return "A companhia disse por que isso aconteceu? Se você pegou no balcão a declaração de contingência, pode mandar a foto aqui.";
    case "solucao":
      return "O que a companhia ofereceu no lugar do voo: outro voo, o reembolso ou outro transporte? E você aceitou?";
    case "chegada":
      return "Em que dia e a que horas você chegou de fato ao destino?";
    case "assistencia":
      return `Enquanto esperava, a companhia deu ${list(assistanceAsked(facts).map((item) => ASSISTANCE_WORDS[item]))}?`;
    case "gastos":
      return "Você teve algum gasto por causa disso, como comida, hotel, transporte ou outra passagem? Se tiver os comprovantes, pode mandar as fotos aqui.";
    case "consequencias":
      return "Você perdeu algum compromisso por causa disso, como trabalho, um evento ou uma consulta? Conte em poucas palavras.";
    case "acompanhantes":
      return "Alguém viajou com você? Se havia criança, diga a idade dela.";
    case "bagagem":
      return "Teve algum problema com a sua mala, como extravio, atraso ou dano?";
  }
}

/** How a question that did not get a usable answer says what it takes. */
const SHAPE_HINT: Record<"yes_no" | "moment" | "text", string> = {
  yes_no: "Responda sim ou não.",
  moment: "Por exemplo: 21/09, às 10h.",
  text: "Pode responder com poucas palavras.",
};

export type AskMode = "ask" | "again" | "remind" | "back";

/**
 * ONE's message with a question: its place among the ones asked, and the question; asked again with what it
 * takes; reminded; or taken up again after ONE answered something the passenger asked.
 */
export function askMessage(question: InterviewQuestion, facts: InterviewFacts, mode: AskMode, firstName = ""): string {
  const { position, total } = interviewProgress(facts);
  const asked = questionText(question, facts);
  const name = firstName.trim();
  switch (mode) {
    case "again":
      return [
        `Não entendi a sua resposta. ${asked}`,
        SHAPE_HINT[QUESTION_SHAPE[question]],
        "Se não lembrar, é só dizer que não lembra.",
      ].join(" ");
    case "remind":
      return `${name ? `${name}, o` : "O"} escritório ainda precisa desta resposta para preparar a sua ação. ${asked}`;
    case "back":
      return `Voltando à pergunta ${position} de ${total}: ${asked}`;
    default:
      // An interview that asks what the piece lacks says why first, once (0099).
      if (position === 1 && (facts.only?.length ?? 0) > 0) {
        return `Para terminar a sua ação, o escritório precisa de mais ${total === 1 ? "uma resposta" : `${total} respostas`}. Pergunta 1 de ${total}: ${asked}`;
      }
      return `Pergunta ${position} de ${total}: ${asked}`;
  }
}

/** ONE's word once every question has its answer. */
export const interviewDoneMessage = (firstName: string): string =>
  `Obrigado${firstName.trim() ? `, ${firstName.trim()}` : ""}. Com isso, o escritório já tem o que precisa sobre o que aconteceu. Se lembrar de mais alguma coisa, é só escrever aqui.`;

/** What the firm's template says is still owed, as its value: "uma resposta", "3 respostas". */
export function resumeWhat(facts: InterviewFacts): string {
  const left = questionsOf(facts).filter((question) => !facts.answers[question] && !skipReason(question, facts)).length;
  return left <= 1 ? "uma resposta" : `${left} respostas`;
}

/** The questions still to come after the one asked now: what the AI may find answered in the same message. */
export function pendingQuestions(facts: InterviewFacts, current: InterviewQuestion | null): InterviewQuestion[] {
  return questionsOf(facts).filter(
    (question) => question !== current && !facts.answers[question] && !skipReason(question, facts),
  );
}

/** The next question to ask, and the questions to leave out before it (the rule's). */
export const nextStep = interviewPlan;

// ---------- What the AI read of an answer ----------

export type InterviewReading = {
  situation: "respondida" | "nao_sabe" | "confusa" | "pergunta" | "outro_assunto";
  answer: string;
  yesNo: "sim" | "nao" | null;
  when: string | null;
  others: { question: InterviewQuestion; answer: string; yesNo: "sim" | "nao" | null; when: string | null }[];
};

const SITUATIONS = ["respondida", "nao_sabe", "confusa", "pergunta", "outro_assunto"] as const;

const yesNoOf = (value: unknown): "sim" | "nao" | null => (value === "sim" || value === "nao" ? value : null);
const whenOf = (value: unknown): string | null => (typeof value === "string" && MOMENT.test(value) ? value : null);

/** The task's answer, read; null when it is not the object the task asks for. */
export function interviewReadingOf(output: unknown): InterviewReading | null {
  if (!output || typeof output !== "object") return null;
  const row = output as Record<string, unknown>;
  if (!(SITUATIONS as readonly unknown[]).includes(row.situacao)) return null;
  const others: InterviewReading["others"] = [];
  for (const item of Array.isArray(row.outras) ? (row.outras as Record<string, unknown>[]) : []) {
    if (!item || !isInterviewQuestion(item.pergunta)) continue;
    const answer = text(item.resposta);
    if (!answer) continue;
    others.push({
      question: item.pergunta,
      answer: answer.trim(),
      yesNo: yesNoOf(item.sim_nao),
      when: whenOf(item.quando),
    });
  }
  return {
    situation: row.situacao as InterviewReading["situation"],
    answer: (text(row.resposta) ?? "").trim(),
    yesNo: yesNoOf(row.sim_nao),
    when: whenOf(row.quando),
    others,
  };
}

// ---------- What the firm's screen reads ----------

/** The short name of each question, as the firm's card lists it (`product` namespace). */
export const QUESTION_LABEL_KEY: Record<InterviewQuestion, string> = {
  aviso_local: "interview-q-aviso-local",
  aviso_quando: "interview-q-aviso-quando",
  motivo: "interview-q-motivo",
  solucao: "interview-q-solucao",
  chegada: "interview-q-chegada",
  assistencia: "interview-q-assistencia",
  gastos: "interview-q-gastos",
  consequencias: "interview-q-consequencias",
  acompanhantes: "interview-q-acompanhantes",
  bagagem: "interview-q-bagagem",
};

/** Why a question was left out (`product` namespace). */
export const SKIP_REASON_KEY: Record<SkipReason, string> = {
  at_airport: "interview-skip-at-airport",
  cause_on_record: "interview-skip-cause",
  arrival_on_record: "interview-skip-arrival",
  short_wait: "interview-skip-short-wait",
  companions_on_record: "interview-skip-companions",
};

/** Where an answer came from (`product` namespace). */
export const SOURCE_KEY: Record<AnswerSource, string> = {
  chat: "interview-source-chat",
  link: "interview-source-link",
  firm: "interview-source-firm",
  one: "interview-source-one",
};

/** How the change was told against the 72 hours of art. 12 of Resolution 400 (`product` namespace). */
export const NOTICE_STANDING_KEY: Record<"at_airport" | "late" | "early", string> = {
  at_airport: "interview-notice-at-airport",
  late: "interview-notice-late",
  early: "interview-notice-early",
};

/** The piece's word for the same (what `caso.peca.minuta` reads as `aviso_72h`). */
export const NOTICE_STANDING_PIECE: Record<"at_airport" | "late" | "early", string> = {
  at_airport: "no_aeroporto",
  late: "menos_de_72h",
  early: "72h_ou_mais",
};

/**
 * Each question of the interview, with where it stands: answered, not known, left out, asked now, to come. Every
 * answer stays in sight, also one of a round before (0099); a question never answered is listed while it may still
 * be asked (the round's, open or closed), never once the interview is done.
 */
export function interviewRows(view: InterviewView): {
  question: InterviewQuestion;
  state: "answered" | "unknown" | "skipped" | "asked" | "next";
  answer: InterviewAnswerView | null;
  reason: SkipReason | null;
}[] {
  const asked = new Set(questionsOf(view.facts));
  return questionsFor(view.facts.incident)
    .filter((question) => view.answers[question] || (view.status !== "done" && asked.has(question)))
    .map((question) => {
      const answer = view.answers[question] ?? null;
      if (answer) return { question, state: answer.status, answer, reason: answer.reason };
      const reason = skipReason(question, view.facts);
      if (reason) return { question, state: "skipped", answer: null, reason };
      return { question, state: view.currentQuestion === question ? "asked" : "next", answer: null, reason: null };
    });
}

/** Where the round stands: the question asked now among the ones it asks, and how many of them have an answer. */
/** The questions of an open interview still to answer: the one asked now, and those still to come (2026-11-25). */
export function openInterviewQuestions(view: InterviewView | null): InterviewQuestion[] {
  if (!view || view.status !== "open") return [];
  return interviewRows(view)
    .filter((row) => row.state === "asked" || row.state === "next")
    .map((row) => row.question);
}

export function interviewCounts(view: InterviewView): { position: number; total: number; done: number } {
  const { position, total } = interviewProgress(view.facts);
  const asked = new Set(questionsOf(view.facts));
  const done = interviewRows(view).filter(
    (row) => asked.has(row.question) && (row.state === "answered" || row.state === "unknown"),
  ).length;
  return { position, total, done };
}

/** What the interview says of the 72 hours, for the firm and the piece; null when it cannot tell. */
export const noticeOf = noticeStanding;
