/**
 * The firm's personality (migration 0272, the plan "o escritório preparado antes do primeiro atendimento", phase 3):
 * the profile ONE writes of how the firm speaks to its clients, approved by the firm on three example messages, and
 * followed by every message ONE writes on the firm's behalf, within the rules for everybody, which it never
 * overrides. Pure: what the task's answer is, the rules kept on it before the database checks them again, and what of
 * it reaches the model of a conversation.
 */

export const PERSONALITY_TASK = "escritorio.personalidade";

export type FirmProfile = {
  apresentacao: { nome: string; sobre: string; cidades: string[] };
  tratamento: "voce" | "senhor";
  tom: "proximo" | "formal";
  tamanho: "curtas" | "explicadas";
  areas: { area: string; aceita: string; nao_aceita: string }[];
  fora_do_horario: string;
  honorarios: string;
  duvidas: string;
  evitar: string[];
};

export type ProfileExample = { situacao: string; mensagem: string };

const text = (value: unknown, most: number): string =>
  typeof value === "string" ? keepRules(value).slice(0, most) : "";

/**
 * A text kept within the rules for everybody: a dash becomes a comma, an exclamation mark a full stop, an emoji
 * nothing. The database refuses what is left of a promise.
 */
export function keepRules(value: string): string {
  return value
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\u{FE0F}/gu, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];

/** A profile, as the task answers it or the database keeps it, every text kept within the rules. */
export function profileOf(raw: unknown): FirmProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const presentation = (row.apresentacao ?? {}) as Record<string, unknown>;
  return {
    apresentacao: {
      nome: text(presentation.nome, 120),
      sobre: text(presentation.sobre, 300),
      cidades: Array.isArray(presentation.cidades)
        ? presentation.cidades
            .map((city) => text(city, 80))
            .filter(Boolean)
            .slice(0, 20)
        : [],
    },
    tratamento: pick(row.tratamento, ["voce", "senhor"] as const, "voce"),
    tom: pick(row.tom, ["proximo", "formal"] as const, "proximo"),
    tamanho: pick(row.tamanho, ["curtas", "explicadas"] as const, "curtas"),
    areas: records(row.areas)
      .map((item) => ({
        area: text(item.area, 80),
        aceita: text(item.aceita, 300),
        nao_aceita: text(item.nao_aceita, 300),
      }))
      .filter((item) => item.area)
      .slice(0, 30),
    fora_do_horario: text(row.fora_do_horario, 300),
    honorarios: text(row.honorarios, 800),
    duvidas: text(row.duvidas, 1200),
    evitar: Array.isArray(row.evitar)
      ? row.evitar
          .map((item) => text(item, 200))
          .filter(Boolean)
          .slice(0, 10)
      : [],
  };
}

/** The examples written with a profile, kept within the rules. */
export function examplesOf(raw: unknown): ProfileExample[] {
  return records(raw)
    .map((item) => ({ situacao: text(item.situacao, 120), mensagem: text(item.mensagem, 700) }))
    .filter((item) => item.situacao && item.mensagem)
    .slice(0, 3);
}

/** The task's answer as a profile and its examples; null for an answer that is none. */
export function personalityOutputOf(raw: unknown): { profile: FirmProfile; examples: ProfileExample[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const profile = profileOf(row);
  const examples = examplesOf(row.exemplos);
  return profile && examples.length > 0 ? { profile, examples } : null;
}

/**
 * What of the profile a conversation's model reads, as data (never as instructions): how the firm presents itself
 * and treats its clients, its out-of-hours words and what it does not want said; a doubt's model also the firm's
 * words on fees and common doubts.
 */
export function profileForModel(profile: FirmProfile, withDoubts = false): Record<string, unknown> {
  return {
    apresentacao: profile.apresentacao,
    tratamento: profile.tratamento,
    tom: profile.tom,
    tamanho: profile.tamanho,
    fora_do_horario: profile.fora_do_horario,
    evitar: profile.evitar,
    ...(withDoubts ? { honorarios: profile.honorarios, duvidas: profile.duvidas } : {}),
  };
}
