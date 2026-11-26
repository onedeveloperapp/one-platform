import type { MappedField, MappedScreen } from "@/lib/court-extension/capture";
import type { FilingFacts } from "@/lib/court-robot/facts";

/**
 * What ONE does on one screen of a court's system (migration 0264, task `protocolo.tela`): the kind of screen, the
 * actions in order, whether the screen will be done after them, and what only the lawyer can answer. An action names
 * its field by the target the screen was shown with (`frame|selector|index`), a fact by its key, a list's line by the
 * system's own code and a file by its position in the package: never a value. Pure: no I/O.
 */

export type ScreenKind = "login" | "segundo_fator" | "formulario" | "resumo" | "recibo" | "erro" | "aviso" | "outra";

export type PlanAction = {
  fazer: "preencher" | "escolher" | "marcar" | "desmarcar" | "clicar" | "anexar" | "esperar";
  alvo: string;
  fato?: string;
  opcao?: string;
  arquivo?: number;
  /** The action sends something to the court ("Confirmar ajuizamento"). */
  envia?: boolean;
  motivo?: string;
};

export type ScreenPlan = {
  tela: { tipo: ScreenKind; titulo: string };
  acoes: PlanAction[];
  pronto: boolean;
  pergunta: string;
};

/** Where a field is: which frame of the page, its selector, and which of the elements it matches. */
export type Target = { frame: number; selector: string; index: number };

export const targetKey = (frame: number, field: Pick<MappedField, "selector" | "index">): string =>
  `${frame}|${field.selector}|${field.index}`;

export function parseTarget(key: string): Target | null {
  const first = key.indexOf("|");
  const last = key.lastIndexOf("|");
  if (first <= 0 || last <= first) return null;
  const frame = Number(key.slice(0, first));
  const index = Number(key.slice(last + 1));
  const selector = key.slice(first + 1, last);
  if (!Number.isInteger(frame) || frame < 0 || !Number.isInteger(index) || index < 0 || !selector) return null;
  return { frame, selector, index };
}

/**
 * The fields of every frame by the target each is shown with, the actions of the lines of a table of the system's own
 * codes included ("Adicionar" on the line of the subject ONE searched).
 */
export function fieldsByTarget(frames: readonly MappedScreen[]): Map<string, MappedField> {
  const found = new Map<string, MappedField>();
  frames.forEach((frame, index) => {
    for (const field of frame.fields) found.set(targetKey(index, field), field);
    for (const table of frame.tables) {
      for (const line of table.lines ?? []) {
        for (const action of line.actions) {
          const key = targetKey(index, action);
          if (!found.has(key)) found.set(key, action);
        }
      }
    }
  });
  return found;
}

/** Whether a target is an action of a line of a table: what it presses depends on what the search found. */
export function isLineTarget(frames: readonly MappedScreen[], alvo: string): boolean {
  return frames.some((frame, index) =>
    frame.tables.some((table) =>
      (table.lines ?? []).some((line) => line.actions.some((action) => targetKey(index, action) === alvo)),
    ),
  );
}

/** What ONE did on a screen, in order, with what came of each action: what the AI reads again of that screen. */
export type DoneAction = { acao: PlanAction; resultado: string };

const KINDS: readonly ScreenKind[] = [
  "login",
  "segundo_fator",
  "formulario",
  "resumo",
  "recibo",
  "erro",
  "aviso",
  "outra",
];
const DOINGS: readonly PlanAction["fazer"][] = [
  "preencher",
  "escolher",
  "marcar",
  "desmarcar",
  "clicar",
  "anexar",
  "esperar",
];

/** A model's answer read as a plan, or null when it is not one. */
export function readPlan(output: unknown): ScreenPlan | null {
  if (typeof output !== "object" || output === null) return null;
  const raw = output as Record<string, unknown>;
  const tela = raw.tela as Record<string, unknown> | undefined;
  if (!tela || !KINDS.includes(tela.tipo as ScreenKind) || !Array.isArray(raw.acoes)) return null;
  const acoes: PlanAction[] = [];
  for (const item of raw.acoes) {
    if (typeof item !== "object" || item === null) return null;
    const action = item as Record<string, unknown>;
    if (!DOINGS.includes(action.fazer as PlanAction["fazer"]) || typeof action.alvo !== "string") return null;
    acoes.push({
      fazer: action.fazer as PlanAction["fazer"],
      alvo: action.alvo,
      ...(typeof action.fato === "string" && action.fato ? { fato: action.fato } : {}),
      ...(typeof action.opcao === "string" && action.opcao ? { opcao: action.opcao } : {}),
      ...(typeof action.arquivo === "number" ? { arquivo: action.arquivo } : {}),
      ...(action.envia === true ? { envia: true } : {}),
      ...(typeof action.motivo === "string" && action.motivo ? { motivo: action.motivo.slice(0, 200) } : {}),
    });
  }
  return {
    tela: { tipo: tela.tipo as ScreenKind, titulo: typeof tela.titulo === "string" ? tela.titulo.slice(0, 160) : "" },
    acoes,
    pronto: raw.pronto === true,
    pergunta: typeof raw.pergunta === "string" ? raw.pergunta.trim().slice(0, 300) : "",
  };
}

/** Why an action cannot be done on this screen, or null. */
export type PlanProblem = { action: number; code: string };

/**
 * The words a person reads on a button that may send something to the court, whatever the model said of it: one that
 * surely sends ("Confirmar ajuizamento", "Protocolar") and one that may, depending on the system ("Finalizar", which in
 * the eproc of TJSP opens the summary and elsewhere may send at once). Never "Confirmar seleção de documento".
 */
export const MAY_SEND =
  /\b(confirmar ajuizamento|finalizar|concluir (o )?peticionamento|enviar peti[cç][aã]o|protocolar|peticionar|ajuizar|distribuir|assinar e enviar)\b/i;

/**
 * Checks a plan against the screen and the case: every target exists, every fact is the case's, every code is a line
 * of that list, every file is the package's, and nothing is typed in a field of a login or a code. A click whose words
 * send to the court is marked as sending even when the plan did not mark it. Pure.
 */
export function checkPlan(
  plan: ScreenPlan,
  frames: readonly MappedScreen[],
  facts: Pick<FilingFacts, "values" | "arquivos">,
): { actions: PlanAction[]; problems: PlanProblem[] } {
  const fields = fieldsByTarget(frames);
  const problems: PlanProblem[] = [];
  const actions: PlanAction[] = [];
  plan.acoes.forEach((action, index) => {
    if (action.fazer === "esperar") {
      actions.push(action);
      return;
    }
    const field = fields.get(action.alvo);
    if (!field) return problems.push({ action: index, code: "unknown_target" });
    const about = `${field.label ?? ""} ${field.name ?? ""} ${field.id ?? ""}`;
    if (
      /(senha|password|token|c[oó]digo de (acesso|autentica|verifica)|2fa|captcha)/i.test(about) &&
      action.fazer !== "clicar"
    ) {
      return problems.push({ action: index, code: "credential_field" });
    }
    if (action.fazer === "preencher") {
      if (!action.fato || !(action.fato in facts.values)) return problems.push({ action: index, code: "unknown_fact" });
    }
    if (action.fazer === "escolher") {
      if (action.opcao) {
        if (!field.options?.some((option) => option.value === action.opcao)) {
          return problems.push({ action: index, code: "unknown_option" });
        }
      } else if (!action.fato || !(action.fato in facts.values)) {
        return problems.push({ action: index, code: "unknown_fact" });
      }
    }
    if (action.fazer === "anexar") {
      if (!facts.arquivos.some((file) => file.posicao === action.arquivo)) {
        return problems.push({ action: index, code: "unknown_file" });
      }
    }
    const sends = action.envia === true || (action.fazer === "clicar" && MAY_SEND.test(field.label ?? ""));
    actions.push(sends ? { ...action, envia: true } : action);
  });
  return { actions, problems };
}

/** The lawsuit's number a court's receipt shows, read in ONE's own code from the page's text: never by the model. */
export function receiptNumber(text: string): string | null {
  const found = text.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/);
  if (found) return found[0].replace(/\D/g, "");
  const plain = text.match(/\b\d{20}\b/);
  return plain ? plain[0] : null;
}
