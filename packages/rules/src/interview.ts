import { minutesBetween } from "@flyee/rules/flight-problem";

/**
 * The interview of a passenger's case (`entrevista-v1`, the owner's decision
 * of 2026-11-04): what the piece needs of what happened, asked one question
 * at a time on WhatsApp (or one per screen on the client's link), each
 * waiting for the one before, and a question left out when ONE already knows
 * its answer or it does not apply. Summarised from the firm's own attendance
 * script; the purchase is not asked (the owner took it out: the piece speaks
 * of a purchase only where a document says it).
 *
 * Pure: it orders the questions and says why one is left out. It never reads
 * an answer (the AI does, and only to say what the passenger wrote) and never
 * decides a right: whether a change was told in time (`noticeStanding`) is the
 * rule of art. 12 of ANAC's Resolution 400 (72 hours), said for the firm to
 * weigh.
 */

export const INTERVIEW_RULE = "entrevista-v1";

export const INTERVIEW_QUESTIONS = [
  "aviso_local",
  "aviso_quando",
  "motivo",
  "solucao",
  "chegada",
  "assistencia",
  "gastos",
  "consequencias",
  "acompanhantes",
  "bagagem",
] as const;
export type InterviewQuestion = (typeof INTERVIEW_QUESTIONS)[number];

export const isInterviewQuestion = (value: unknown): value is InterviewQuestion =>
  (INTERVIEW_QUESTIONS as readonly unknown[]).includes(value);

/** What a question takes: a yes or a no, a moment (a day, and its hour when known), or the passenger's words. */
export type QuestionShape = "yes_no" | "moment" | "text";

export const QUESTION_SHAPE: Record<InterviewQuestion, QuestionShape> = {
  aviso_local: "yes_no",
  aviso_quando: "moment",
  motivo: "text",
  solucao: "text",
  chegada: "moment",
  assistencia: "text",
  gastos: "text",
  consequencias: "text",
  acompanhantes: "text",
  bagagem: "yes_no",
};

/** The problems of a flight the interview is for; a problem of a bag has its own questions, not these. */
const FLIGHT_PROBLEMS = ["delay", "cancellation", "overbooking", "missed_connection", "downgrade", "other"] as const;

export const interviewApplies = (incident: string): boolean =>
  (FLIGHT_PROBLEMS as readonly string[]).includes(incident);

/** The questions of a kind of problem, in the order they are asked. */
export function questionsFor(incident: string): InterviewQuestion[] {
  if (!interviewApplies(incident)) return [];
  if (incident === "downgrade") return ["motivo", "gastos", "consequencias", "acompanhantes", "bagagem"];
  // A delay is the same flight, later: nothing was offered in its place.
  if (incident === "delay") return INTERVIEW_QUESTIONS.filter((question) => question !== "solucao");
  return [...INTERVIEW_QUESTIONS];
}

/** An answer as the rule reads it: whether it was answered, said not known or left out, and its yes or moment. */
export type InterviewAnswer = {
  status: "answered" | "unknown" | "skipped";
  yesNo?: boolean | null;
  /** `YYYY-MM-DDTHH:MM` local, or `YYYY-MM-DD` when only the day is known. */
  moment?: string | null;
};

export type InterviewFacts = {
  incident: string;
  /** The problem ONE told the passenger of, when the case came from its word on a flight. */
  alert: { kind: "cancelled" | "changed" | "delayed"; delayMinutes: number | null } | null;
  /** What the airline said caused it, as the case records it. */
  airlineCause: string | null;
  /** The scheduled departure of the affected leg, local. */
  scheduledDeparture: string | null;
  /** The scheduled arrival at the end of the affected journey, local. */
  scheduledArrival: string | null;
  /** When the passenger arrived, as a source said it (ANAC's record, the flight ONE followed). */
  actualArrival: string | null;
  /** Who travelled is on record: the trip an agency registered or ONE followed, or more than one person in the case. */
  companionsKnown: boolean;
  answers: Partial<Record<InterviewQuestion, InterviewAnswer>>;
};

/** Why a question is left out, as the screens say it. */
export const SKIP_REASONS = [
  "at_airport",
  "cause_on_record",
  "arrival_on_record",
  "short_wait",
  "companions_on_record",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** When the passenger arrived: as a source said it, or as they answered it (only with its hour). */
export function arrivalOf(facts: InterviewFacts): string | null {
  if (facts.actualArrival && MOMENT.test(facts.actualArrival)) return facts.actualArrival;
  const answered = facts.answers.chegada?.moment;
  return answered && MOMENT.test(answered) ? answered : null;
}

/** How long the passenger waited beyond the scheduled arrival, in minutes, when it is known. */
export function waitMinutes(facts: InterviewFacts): number | null {
  const arrival = arrivalOf(facts);
  if (arrival && facts.scheduledArrival) {
    const late = minutesBetween(facts.scheduledArrival, arrival);
    if (late !== null) return Math.max(0, late);
  }
  if (facts.alert?.kind === "delayed" && typeof facts.alert.delayMinutes === "number") {
    return Math.max(0, facts.alert.delayMinutes);
  }
  return null;
}

/**
 * What the airline owed while the passenger waited (Resolution 400, art. 27), as the question asks it: food from
 * two hours, a hotel and the transport to it from four; everything when the wait is not known.
 */
export function assistanceAsked(facts: InterviewFacts): ("alimentacao" | "hospedagem" | "transporte")[] {
  const wait = waitMinutes(facts);
  if (wait === null || wait >= 240) return ["alimentacao", "hospedagem", "transporte"];
  if (wait >= 120) return ["alimentacao"];
  return [];
}

/** Why a question is not asked of this case now, or null when it is asked. */
export function skipReason(question: InterviewQuestion, facts: InterviewFacts): SkipReason | null {
  switch (question) {
    case "aviso_quando":
      return facts.answers.aviso_local?.yesNo === true ? "at_airport" : null;
    case "motivo":
      return facts.airlineCause && facts.airlineCause.trim() !== "" ? "cause_on_record" : null;
    case "chegada":
      return facts.actualArrival && MOMENT.test(facts.actualArrival) ? "arrival_on_record" : null;
    case "assistencia":
      return assistanceAsked(facts).length === 0 ? "short_wait" : null;
    case "acompanhantes":
      return facts.companionsKnown ? "companions_on_record" : null;
    default:
      return null;
  }
}

/**
 * What to do next: the questions to leave out now (each with why), and the next one to ask, or none when every
 * question of the problem has its answer, its "not known" or its reason to be left out.
 */
export function interviewPlan(facts: InterviewFacts): {
  skips: { question: InterviewQuestion; reason: SkipReason }[];
  next: InterviewQuestion | null;
} {
  const skips: { question: InterviewQuestion; reason: SkipReason }[] = [];
  for (const question of questionsFor(facts.incident)) {
    if (facts.answers[question]) continue;
    const reason = skipReason(question, facts);
    if (reason) {
      skips.push({ question, reason });
      // A question left out answers nothing the next ones read.
      continue;
    }
    return { skips, next: question };
  }
  return { skips, next: null };
}

/** How many of a problem's questions are left to ask, the one asked now included (for "Pergunta 3 de 7"). */
export function interviewProgress(facts: InterviewFacts): { position: number; total: number } {
  const all = questionsFor(facts.incident);
  const leftOut = new Set<InterviewQuestion>(
    all.filter((question) =>
      facts.answers[question] ? facts.answers[question].status === "skipped" : skipReason(question, facts) !== null,
    ),
  );
  // A question still ahead may yet be left out: until then it counts as one to ask.
  const asked = all.filter((question) => !leftOut.has(question));
  const done = asked.filter((question) => facts.answers[question]).length;
  return { position: Math.max(1, Math.min(done + 1, asked.length)), total: Math.max(asked.length, 1) };
}

const dayNumber = (day: string): number | null => {
  const match = DAY.exec(day.slice(0, 10));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
};

/**
 * How the passenger learned of the change against the 72 hours of art. 12 of Resolution 400: at the airport
 * (`at_airport`), less than 72 hours before the departure (`late`), 72 hours or more before it (`early`, the change
 * the rule allows), or not known. With the day alone, a day that cannot tell is not known.
 */
export function noticeStanding(facts: InterviewFacts): "at_airport" | "late" | "early" | null {
  if (facts.answers.aviso_local?.yesNo === true) return "at_airport";
  const notice = facts.answers.aviso_quando?.moment;
  if (!notice || !facts.scheduledDeparture) return null;
  if (MOMENT.test(notice)) {
    const minutes = minutesBetween(notice, facts.scheduledDeparture);
    if (minutes === null) return null;
    return minutes >= 72 * 60 ? "early" : "late";
  }
  const from = dayNumber(notice);
  const to = dayNumber(facts.scheduledDeparture);
  if (from === null || to === null) return null;
  const days = to - from;
  if (days >= 4) return "early";
  if (days <= 2) return "late";
  return null;
}
