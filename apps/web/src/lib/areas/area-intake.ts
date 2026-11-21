import { firstNameOf } from "@/lib/cases/cases";

/**
 * Where the triage of a client of a firm's own area stands on the WhatsApp (migration 0274, phase 4 of the plan "o
 * escritório preparado antes do primeiro atendimento"), and the few words of ONE's around the script's own: the name
 * asked before the offer, an answer not understood, and the case opened. Pure.
 */

export const TRIAGE_TASK = "atendimento.triagem";

export type AreaIntakeStep = "perguntas" | "nome" | "oferta" | "duvidas" | "recusou" | "fim";
const STEPS: readonly AreaIntakeStep[] = ["perguntas", "nome", "oferta", "duvidas", "recusou", "fim"];

export type AreaIntakeState = {
  area_id: string;
  /** The version of the script the triage follows. */
  script_id: string;
  type: string | null;
  answers: Record<string, string>;
  /** What ONE asked last: "tipo", a question's key, or null. */
  asked: string | null;
  /** How many replies to it ONE did not understand. */
  tries: number;
  nome: string | null;
  etapa: AreaIntakeStep;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function areaIntakeOf(raw: unknown): AreaIntakeState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const areaId = text(row.area_id);
  const scriptId = text(row.script_id);
  if (!areaId || !scriptId) return null;
  const answers =
    typeof row.answers === "object" && row.answers !== null
      ? Object.fromEntries(
          Object.entries(row.answers as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    area_id: areaId,
    script_id: scriptId,
    type: text(row.type) || null,
    answers,
    asked: text(row.asked) || null,
    tries: Number.isFinite(Number(row.tries)) ? Math.max(0, Math.round(Number(row.tries))) : 0,
    nome: text(row.nome) || null,
    etapa: STEPS.includes(row.etapa as AreaIntakeStep) ? (row.etapa as AreaIntakeStep) : "perguntas",
  };
}

/** A triage that waits for the client: begun and not ended. */
export const isAreaIntakeOpen = (state: AreaIntakeState | null): state is AreaIntakeState =>
  state !== null && state.etapa !== "fim";

/**
 * The client's full name, as they wrote it: two words or more of letters, with no number, at most 120 characters;
 * "meu nome é" and the like left out. Null for anything else, which ONE asks again.
 */
export function nameOfReply(reply: string): string | null {
  const said = reply
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(meu nome (é|e)|me chamo|sou (o|a)?|eu sou( o| a)?|nome:?)\s+/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  if (!said || said.length > 120 || /\d/.test(said) || /[^\p{L}\s'.-]/u.test(said)) return null;
  const words = said.split(" ").filter((word) => /\p{L}{2,}/u.test(word));
  return words.length >= 2 ? said : null;
}

export const NAME_QUESTION = "Para seguir, qual é o seu nome completo?";

export const NOT_UNDERSTOOD = "Não entendi a resposta. Responda com o número de uma das opções.";

/** ONE's word before the first question, when it did not greet the person before. */
export const areaOpening = (firm: string): string =>
  firm.trim()
    ? `Oi, aqui é o assistente virtual do escritório ${firm.trim()}.`
    : "Oi, aqui é o assistente virtual do escritório.";

/** The case opened: where the client sends the documents of the kind of case. */
export function areaOpenedText(input: { name: string; firm: string; link: string }): string {
  const name = firstNameOf(input.name) || input.name;
  const firm = input.firm.trim() ? `no escritório ${input.firm.trim()}` : "no escritório";
  return [
    `Pronto, ${name}. O seu caso está aberto ${firm}.`,
    `Pelo link abaixo você envia os documentos do caso, cada um no seu lugar, e acompanha o que falta:`,
    input.link,
  ].join("\n");
}

/** What the task read of the client's answer: one option's key, none, or another subject. */
export function triageReadingOf(raw: unknown): { option: string | null; elsewhere: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  return { option: text(row.opcao) || null, elsewhere: row.outro_assunto === true };
}
