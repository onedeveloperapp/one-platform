import { maskIdentifiers } from "@/lib/cases/drafts";
import { cleanReply } from "@/lib/conversations/agent";
import {
  type IntakeFacts,
  intakeMissing,
  intakeQualificationInput,
  OPTIONS,
  optionsText,
} from "@/lib/conversations/intake";
import { qualify } from "@flyee/rules/qualification";

/**
 * A new contact's doubt answered before they decide (migration 0249, the owner's request of 2026-11-13: ONE answers
 * how much they may get, what it costs, what they may lose, with a forecast and never a promise, and sells the
 * service): what the task `atendimento.duvida` is handed, what it answered, and how the answer opens ONE's next
 * message. The forecast is the market's (`market_forecast`): its median only (the low end of its range is not to be
 * told while the reading of the values is being put right), with the decisions and the court it comes from. Pure.
 */

export const DOUBT_TASK = "atendimento.duvida";

/** What ONE asks at "Tenho dúvidas" when the firm wrote no answers to the common doubts (0249). */
export const DOUBT_ASK =
  "Pode perguntar o que quiser sobre o seu caso: quanto pode receber, se custa alguma coisa, o que pode perder, quanto tempo leva.";

/** The doubt answered, and the question of going on again, a person one choice away. */
export const doubtAnswered = (answer: string): string =>
  `${answer.trim()}\n\nQuer seguir com o seu caso?\n${optionsText(OPTIONS.duvidas)}`;

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);

const PROBLEM_WORDS: Record<string, string> = {
  cancellation: "cancelamento",
  change: "mudança do voo",
  delay: "atraso",
  missed_connection: "conexão perdida",
  overbooking: "embarque negado",
  baggage: "bagagem",
  baggage_lost: "bagagem extraviada",
  baggage_damaged: "bagagem danificada",
  baggage_delayed: "bagagem atrasada",
};

/**
 * The market's kind of problem of what the person told (0190 reads five): a change of the flight is weighed as a
 * cancellation, a connection lost as a delay, every problem of baggage as baggage; null for none told.
 */
export function marketProblemOf(problem: string | undefined): string | null {
  switch (problem) {
    case "cancellation":
    case "change":
      return "cancellation";
    case "delay":
    case "missed_connection":
      return "delay";
    case "overbooking":
      return "overbooking";
    case "baggage_lost":
    case "baggage_damaged":
    case "baggage_delayed":
      return "baggage";
    default:
      return null;
  }
}

export type Forecast = {
  courts: string[];
  airline: string | null;
  problem: string;
  merits: number;
  chancePercent: number | null;
  medianCents: number | null;
  moralCount: number;
  from: string | null;
  to: string | null;
};

const num = (value: unknown): number | null =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

/** The market's forecast as the database answers it; null for none. Only the median of the moral damages is read. */
export function forecastOf(raw: unknown): Forecast | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const cut = (row.cut ?? {}) as Record<string, unknown>;
  const moral = (row.moral ?? {}) as Record<string, unknown>;
  if (typeof cut.problem !== "string") return null;
  const courts = Array.isArray(row.courts)
    ? row.courts.filter((court): court is string => typeof court === "string")
    : typeof cut.court === "string"
      ? [cut.court]
      : [];
  return {
    courts,
    airline: typeof cut.airline === "string" ? cut.airline : null,
    problem: cut.problem,
    merits: num(row.merits) ?? 0,
    chancePercent: num(row.chance_percent),
    medianCents: num(moral.median_cents),
    moralCount: num(moral.n) ?? 0,
    from: typeof row.from === "string" ? row.from : null,
    to: typeof row.to === "string" ? row.to : null,
  };
}

const dayWords = (day: string | null): string | null =>
  day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.split("-").reverse().join("/") : null;

/** Where the case stands by the rule, in the words the task reads; ONE's own decision is never the task's. */
export function standingWords(facts: IntakeFacts, today: string): string {
  if (intakeMissing(facts).length > 0) return "ainda em avaliação: faltam respostas sobre o voo";
  const outcome = qualify(intakeQualificationInput(facts, today)).outcome;
  if (outcome === "qualifies") return "pelo que contou, o escritório pode entrar com a ação";
  if (outcome === "not_qualified") return "pela regra, o caso não tem direito";
  return "a regra não decide sozinha: uma pessoa do escritório avalia";
}

/** What the task is handed: the firm, the doubt, what the person told, the rule's word so far, the firm's texts, the forecast. */
export function doubtInput(input: {
  firm: string;
  question: string;
  facts: IntakeFacts;
  airline: string | null;
  standing: string;
  fees: string | null;
  faq: string | null;
  forecast: Forecast | null;
}): Record<string, unknown> {
  const { facts, forecast } = input;
  const from = forecast ? dayWords(forecast.from) : null;
  const to = forecast ? dayWords(forecast.to) : null;
  return {
    escritorio: input.firm,
    pergunta: maskIdentifiers(input.question).slice(0, 600),
    o_que_contou: {
      problema: PROBLEM_WORDS[facts.problema ?? ""] ?? null,
      companhia: input.airline,
      dia_do_voo: dayWords(facts.data ?? null),
      viajou_com: facts.acompanhantes && facts.acompanhantes !== "mais" ? facts.acompanhantes : null,
    },
    regra_ate_agora: input.standing,
    honorarios_do_escritorio: input.fees?.trim() || null,
    duvidas_do_escritorio: input.faq?.trim() || null,
    previsao: forecast
      ? {
          de_onde:
            forecast.courts.length > 0
              ? `decisões de primeira instância do ${forecast.courts.join(", ")}`
              : "decisões de primeira instância",
          problema: PROBLEM_WORDS[forecast.problem] ?? forecast.problem,
          companhia: forecast.airline,
          decisoes_com_merito: forecast.merits,
          chance_de_ganhar_percent: forecast.chancePercent,
          mediana_do_dano_moral: forecast.medianCents ? brl(forecast.medianCents) : null,
          decisoes_com_valor: forecast.moralCount,
          periodo: from && to ? `${from} a ${to}` : null,
        }
      : null,
  };
}

export type DoubtAnswer = { text: string; callPerson: boolean };

/** The task's answer, cleaned to the rules of copy; null when it said nothing (the message held no doubt). */
export function doubtAnswerOf(raw: unknown): DoubtAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = cleanReply(typeof row.resposta === "string" ? row.resposta : "", 900) ?? "";
  if (!text && row.chamar_pessoa !== true) return null;
  return { text, callPerson: row.chamar_pessoa === true };
}

/**
 * ONE's next message opened by the answer to the doubt: after the opening of a first message, before anything else of
 * a later one; the question ONE was asking goes on after it.
 */
export function withAnswer(answer: string | null, body: string, opening: string | null = null): string {
  if (!answer) return body;
  if (opening && body.startsWith(opening)) {
    return `${opening}\n\n${answer}\n\n${body.slice(opening.length).trim()}`;
  }
  return `${answer}\n\n${body}`;
}
