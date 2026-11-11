import { maskIdentifiers } from "@/lib/cases/drafts";
import type { TurnContext } from "@/lib/conversations/agent";
import {
  isQualificationProblem,
  type NoticeStanding,
  type QualificationInput,
  type QualificationProblem,
} from "@flyee/rules/qualification";

/**
 * Who writes to the firm's WhatsApp with no alert of ONE's and no case (migration 0176, item 2.1 of the case journey
 * plan): the task `atendimento.entrada` reads what they told, the database keeps the facts gathered, and these rules
 * say what is still missing, ask it one question at a time, and hand the rule of qualification what it reads. Pure.
 */

export const INTAKE_TASK = "atendimento.entrada";

export type IntakeFacts = {
  problema?: string;
  companhia?: string;
  voo?: string;
  data?: string;
  origem?: string;
  destino?: string;
  atraso_horas?: string;
  aviso?: string;
  nome?: string;
  /** Who referred the person, as they said it (0183). */
  indicado_por?: string;
  result?: { outcome?: string };
};

const KEYS = [
  "problema",
  "companhia",
  "voo",
  "data",
  "origem",
  "destino",
  "atraso_horas",
  "aviso",
  "nome",
  "indicado_por",
] as const;

/** What the task read: whether it is a problem with a flight, and the facts it found. Null for an answer that is not. */
export function intakeReadingOf(raw: unknown): { flight: boolean; facts: Record<string, string> } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.assunto !== "problema_voo" && row.assunto !== "outro") return null;
  const facts: Record<string, string> = {};
  for (const key of KEYS) {
    const value = typeof row[key] === "string" ? String(row[key]).trim() : "";
    // A mark of a masked identifier is never a fact of the passenger's.
    if (value && !/\[[a-z]+ \d+\]/i.test(value)) facts[key] = value;
  }
  return { flight: row.assunto === "problema_voo", facts };
}

/** The facts as the database keeps them. */
export function intakeFactsOf(raw: unknown): IntakeFacts {
  if (typeof raw !== "object" || raw === null) return {};
  const row = raw as Record<string, unknown>;
  const facts: IntakeFacts = {};
  for (const key of KEYS) if (typeof row[key] === "string" && row[key]) facts[key] = String(row[key]);
  if (row.result && typeof row.result === "object") facts.result = row.result as { outcome?: string };
  return facts;
}

export type IntakeAsk = "problema" | "voo" | "data" | "atraso" | "aviso" | "nome";

const LATE: readonly string[] = ["delay", "missed_connection"];
const TOLD: readonly string[] = ["cancellation", "change"];

/** What the intake still lacks to decide, in the order it is asked. */
export function intakeMissing(facts: IntakeFacts): IntakeAsk[] {
  const missing: IntakeAsk[] = [];
  if (!facts.problema) missing.push("problema");
  if (!facts.voo && !(facts.origem && facts.destino)) missing.push("voo");
  if (!facts.data) missing.push("data");
  if (facts.problema && LATE.includes(facts.problema) && !facts.atraso_horas) missing.push("atraso");
  if (facts.problema && TOLD.includes(facts.problema) && !facts.aviso) missing.push("aviso");
  if (!facts.nome) missing.push("nome");
  return missing;
}

/** The first word of an intake, before its first question. */
export const INTAKE_OPENING =
  "Sinto muito pelo que aconteceu com o seu voo. Para o escritório avaliar o seu caso, vou fazer algumas perguntas rápidas.";

const QUESTIONS: Record<IntakeAsk, string> = {
  problema:
    "O que aconteceu com o voo? Ele foi cancelado, atrasou, você perdeu a conexão, não conseguiu embarcar ou teve um problema com a bagagem?",
  voo: "Qual era o número do voo e a companhia aérea? Se não souber o número, diga de qual cidade para qual cidade era o voo.",
  data: "Em que dia era o voo?",
  atraso: "Com quantas horas de atraso você chegou ao destino final?",
  aviso: "Quando a companhia avisou: no aeroporto, menos de 72 horas antes do voo ou com mais antecedência?",
  nome: "Qual é o seu nome completo?",
};

/** The question of what is missing, with the opening when it is the intake's first. */
export function intakeQuestion(ask: IntakeAsk, first: boolean): string {
  return first ? `${INTAKE_OPENING} ${QUESTIONS[ask]}` : QUESTIONS[ask];
}

/**
 * The follow-up of a lead who stopped answering (migration 0207): the question still missing, said again, opened
 * with a word that does not press. Null when nothing is missing (the intake is the database's to decide then).
 */
export function leadFollowupText(facts: IntakeFacts, count: number): string | null {
  const ask = intakeMissing(facts)[0];
  if (!ask) return null;
  const opening =
    count === 0
      ? "Oi, ainda posso te ajudar com o que aconteceu no seu voo."
      : "Sigo por aqui, se quiser continuar a avaliação do seu caso. Se preferir não receber mais mensagens, responda SAIR.";
  return `${opening} ${QUESTIONS[ask]}`;
}

/** What the rule of qualification reads of an intake (`qualificacao-v1`). */
export function intakeQualificationInput(facts: IntakeFacts, today: string): QualificationInput {
  const problem: QualificationProblem = isQualificationProblem(facts.problema) ? facts.problema : "other";
  const hours = facts.atraso_horas ? Number(facts.atraso_horas) : null;
  const notice = (["at_airport", "late", "early"] as const).includes(facts.aviso as NoticeStanding)
    ? (facts.aviso as NoticeStanding)
    : null;
  return {
    problem,
    flightDay: facts.data && /^\d{4}-\d{2}-\d{2}$/.test(facts.data) ? facts.data : null,
    today,
    international: null,
    arrivalDelayMinutes: hours !== null && Number.isFinite(hours) ? Math.round(hours * 60) : null,
    notice,
  };
}

/** What the task is handed: the conversation, with every identifier taken out, the facts so far and today. */
export function intakeInput(context: TurnContext, facts: IntakeFacts, today: string): Record<string, unknown> {
  const known = Object.fromEntries(Object.entries(facts).filter(([key]) => key !== "result"));
  return {
    escritorio: context.firm,
    hoje: today,
    fatos_anotados: known,
    mensagens: context.messages.map((message) => ({
      quem: message.author,
      tipo: message.kind,
      texto: maskIdentifiers(message.text).slice(0, 2000),
    })),
  };
}
