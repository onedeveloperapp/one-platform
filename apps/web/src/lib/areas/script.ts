import { CRITERIA, type Criterion, type TriageScript } from "@flyee/rules/area-triage";

/**
 * The script of a firm's own area (migration 0273, the plan "o escritório preparado antes do primeiro atendimento",
 * phase 4, the owner, 2026-11-20): what ONE proposes from the interview and the firm publishes, a version at a time.
 * How to attend a client of the area (the kinds of case and the triage's questions, each option marked by the firm's
 * criterion), the documents each kind asks, the stages over the common cycle of a case, the work outside the lawsuit
 * (each said as the client's or the firm's), the pieces it writes, its words on fees, doubts and a refusal, the courts
 * it runs in, and the sensitive data it holds. Pure: the shape, as the task answers it or the database keeps it, every
 * text kept within the rules for everybody (the database checks them again, `area_script_problem`).
 */

export const SCRIPT_TASK = "escritorio.roteiro";

/** The kinds of document ONE reads as it does today; anything else is "other", named by the script. */
export const SCRIPT_DOCUMENT_KINDS = [
  "identity",
  "address_proof",
  "income_proof",
  "contract",
  "evidence",
  "receipt",
  "other",
] as const;
export type ScriptDocumentKind = (typeof SCRIPT_DOCUMENT_KINDS)[number];

/** Where in the common cycle of a case a stage or a work comes. */
export const SCRIPT_PHASES = ["documentos", "assinatura", "peca", "protocolo", "processo", "encerramento"] as const;
export type ScriptPhase = (typeof SCRIPT_PHASES)[number];

/** Who does a work outside the lawsuit: the client, or a person of the firm. ONE's own work is the core's. */
export const SCRIPT_WORKERS = ["cliente", "escritorio"] as const;
export type ScriptWorker = (typeof SCRIPT_WORKERS)[number];

export const SENSITIVE_DATA = ["saude", "criancas", "outro"] as const;
export type SensitiveData = (typeof SENSITIVE_DATA)[number];

export type ScriptDocument = {
  chave: string;
  nome: string;
  tipo: ScriptDocumentKind;
  /** Of the case, or of each person of it. */
  por: "caso" | "pessoa";
  /** Without it the case does not go to court; one that is not is asked once. */
  essencial: boolean;
};
export type ScriptCaseType = { chave: string; nome: string; documentos: ScriptDocument[]; pecas: string[] };
export type ScriptOption = { chave: string; texto: string; criterio: Criterion };
export type ScriptQuestion = { chave: string; texto: string; tipos: string[]; opcoes: ScriptOption[] };
export type ScriptStage = { chave: string; nome: string; fase: ScriptPhase };
export type ScriptWork = { chave: string; nome: string; quem: ScriptWorker; fase: ScriptPhase; tipos: string[] };
export type ScriptCourt = { tribunal: string; sistema: string };
export type ScriptSensitive = { dado: SensitiveData; nome: string; guarda_anos: number };

export type AreaScript = {
  tipos: ScriptCaseType[];
  perguntas: ScriptQuestion[];
  etapas: ScriptStage[];
  tarefas: ScriptWork[];
  honorarios: string;
  duvidas: string;
  recusa: string;
  tribunais: ScriptCourt[];
  sensiveis: ScriptSensitive[];
};

/** The sizes the database keeps too. */
export const SCRIPT_LIMITS = {
  types: 12,
  documents: 20,
  pieces: 10,
  questions: 12,
  options: 8,
  stages: 15,
  works: 30,
  courts: 20,
  sensitive: 10,
} as const;

/** A text kept within the rules for everybody: a dash becomes a comma, an exclamation mark a full stop, no emoji. */
export function keepCopyRules(value: string): string {
  return value
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\u{FE0F}/gu, "")
    .replace(/[ \t]+([,.])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const text = (value: unknown, most: number): string =>
  typeof value === "string" ? keepCopyRules(value.replace(/\s+/g, " ")).slice(0, most).trim() : "";

/** A long text (fees, doubts): its lines kept. */
const longText = (value: unknown, most: number): string =>
  typeof value === "string"
    ? value
        .split(/\r?\n/)
        .map((line) => keepCopyRules(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .slice(0, most)
        .trim()
    : "";

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** A key of the script: a few plain letters, made from the name where the answer gave none. */
export function keyOf(value: unknown, name: string): string {
  const raw = typeof value === "string" && value.trim() ? value : name;
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return key.length >= 2 ? key : `item_${key || "x"}`;
}

/** The items of a list, each with a key of its own (a repeated key takes a number). */
function unique<T extends { chave: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let key = item.chave;
    for (let n = 2; seen.has(key); n += 1) key = `${item.chave.slice(0, 36)}_${n}`;
    seen.add(key);
    return { ...item, chave: key };
  });
}

/** A script, as the task answers it, the person edits it or the database keeps it; null for one that is none. */
export function scriptOf(raw: unknown): AreaScript | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const tipos = unique(
    records(row.tipos)
      .map((item) => {
        const nome = text(item.nome, 80);
        return {
          chave: keyOf(item.chave, nome),
          nome,
          documentos: unique(
            records(item.documentos)
              .map((document) => {
                const name = text(document.nome, 120);
                return {
                  chave: keyOf(document.chave, name),
                  nome: name,
                  tipo: pick(document.tipo, SCRIPT_DOCUMENT_KINDS, "other"),
                  por: pick(document.por, ["caso", "pessoa"] as const, "caso"),
                  essencial: document.essencial !== false,
                };
              })
              .filter((document) => document.nome.length >= 2)
              .slice(0, SCRIPT_LIMITS.documents),
          ),
          pecas: (Array.isArray(item.pecas) ? item.pecas : [])
            .map((piece) => text(piece, 120))
            .filter((piece) => piece.length >= 2)
            .slice(0, SCRIPT_LIMITS.pieces),
        };
      })
      .filter((item) => item.nome.length >= 2)
      .slice(0, SCRIPT_LIMITS.types),
  );
  if (tipos.length === 0) return null;
  const typeKeys = new Set(tipos.map((item) => item.chave));
  const typesOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((key): key is string => typeof key === "string" && typeKeys.has(key)))]
      : [];

  const perguntas = unique(
    records(row.perguntas)
      .map((item) => {
        const texto = text(item.texto, 300);
        return {
          chave: keyOf(item.chave, texto),
          texto,
          tipos: typesOf(item.tipos),
          opcoes: unique(
            records(item.opcoes)
              .map((option) => {
                const label = text(option.texto, 80);
                return {
                  chave: keyOf(option.chave, label),
                  texto: label,
                  criterio: pick(option.criterio, CRITERIA, "pessoa"),
                };
              })
              .filter((option) => option.texto.length >= 1)
              .slice(0, SCRIPT_LIMITS.options),
          ),
        };
      })
      .filter((item) => item.texto.length >= 5 && item.opcoes.length >= 2)
      .slice(0, SCRIPT_LIMITS.questions),
  );

  const etapas = unique(
    records(row.etapas)
      .map((item) => {
        const nome = text(item.nome, 80);
        return { chave: keyOf(item.chave, nome), nome, fase: pick(item.fase, SCRIPT_PHASES, "processo") };
      })
      .filter((item) => item.nome.length >= 2)
      .slice(0, SCRIPT_LIMITS.stages),
  );

  const tarefas = unique(
    records(row.tarefas)
      .map((item) => {
        const nome = text(item.nome, 120);
        return {
          chave: keyOf(item.chave, nome),
          nome,
          quem: pick(item.quem, SCRIPT_WORKERS, "escritorio"),
          fase: pick(item.fase, SCRIPT_PHASES, "documentos"),
          tipos: typesOf(item.tipos),
        };
      })
      .filter((item) => item.nome.length >= 2)
      .slice(0, SCRIPT_LIMITS.works),
  );

  return {
    tipos,
    perguntas,
    etapas,
    tarefas,
    honorarios: longText(row.honorarios, 1500),
    duvidas: longText(row.duvidas, 3000),
    recusa: text(row.recusa, 500),
    tribunais: records(row.tribunais)
      .map((item) => ({ tribunal: text(item.tribunal, 40), sistema: text(item.sistema, 40) }))
      .filter((item) => item.tribunal.length >= 2)
      .slice(0, SCRIPT_LIMITS.courts),
    sensiveis: records(row.sensiveis)
      .map((item) => ({
        dado: pick(item.dado, SENSITIVE_DATA, "outro"),
        nome: text(item.nome, 120),
        guarda_anos: Math.min(30, Math.max(1, Math.round(Number(item.guarda_anos) || 5))),
      }))
      .filter((item) => item.nome.length >= 2)
      .slice(0, SCRIPT_LIMITS.sensitive),
  };
}

/** What the rule of the triage reads of a script (`@flyee/rules/area-triage`). */
export function triageScriptOf(script: AreaScript): TriageScript {
  return {
    types: script.tipos.map((type) => ({ key: type.chave, name: type.nome })),
    questions: script.perguntas.map((question) => ({
      key: question.chave,
      text: question.texto,
      types: question.tipos,
      options: question.opcoes.map((option) => ({ key: option.chave, text: option.texto, criterion: option.criterio })),
    })),
  };
}
