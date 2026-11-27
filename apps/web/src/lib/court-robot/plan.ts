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

/**
 * What ONE did on a screen, in order, with what came of each action: what the AI reads again of that screen. `rotulo`:
 * the words of the field it acted on, as the screen showed them (never a value), so the screen can be told again once
 * ONE has left it (`PathStep`).
 */
export type DoneAction = { acao: PlanAction; resultado: string; rotulo?: string };

/**
 * A screen ONE went through in this filing before the one it reads, with what it did there that the screen took: the
 * AI reads the path again on every screen, so a filing ONE itself started is never taken for someone's old draft (the
 * PJe of TJRJ, 2026-11-27: after the lawyer's "Continuar" on the tab of the parties, ONE asked whether to go on "com
 * este rascunho" it had made itself). Words of fields and keys of facts only, never a value.
 */
export type PathStep = {
  tela: string;
  feito: { fazer: PlanAction["fazer"]; rotulo: string | null; fato?: string }[];
};

/** How many screens of the path the AI reads, the latest, and how many actions of each. */
export const PATH_SCREENS_MOST = 30;
export const PATH_ACTIONS_MOST = 20;

/** A screen as the path keeps it: what ONE did there that the screen took, waits left out. Null when nothing was. */
export function pathStepOf(tela: string, done: readonly DoneAction[]): PathStep | null {
  const feito = done
    .filter((item) => item.resultado === "ok" && item.acao.fazer !== "esperar")
    .slice(-PATH_ACTIONS_MOST)
    .map((item) => ({
      fazer: item.acao.fazer,
      rotulo: item.rotulo ?? null,
      ...(item.acao.fato ? { fato: item.acao.fato } : {}),
    }));
  return feito.length > 0 ? { tela: tela.slice(0, 160), feito } : null;
}

/**
 * The target a plan names, as the screen shows it (`frame|selector|index`), or null. The AI is handed each field with
 * its target (`screenForAi`); one that answers with the bare selector the screen showed (as the first and second
 * instructions asked: "o seletor exatamente como veio na tela"), or with the selector and its position, is read as
 * that field when the screen has exactly one such field. Before this, every action of every plan was dropped as an
 * unknown target and only the waits ran (the PJe of TJRJ, 2026-11-26: the matéria was never chosen).
 */
export function resolveTarget(fields: ReadonlyMap<string, MappedField>, alvo: string): string | null {
  if (fields.has(alvo)) return alvo;
  const trimmed = alvo.trim();
  if (fields.has(trimmed)) return trimmed;
  const keys = [...fields.keys()];
  const only = (matches: string[]) => (matches.length === 1 ? (matches[0] ?? null) : null);
  // The bare selector of one field.
  const bySelector = keys.filter((key) => parseTarget(key)?.selector === trimmed);
  if (bySelector.length > 0) return only(bySelector);
  // The selector with its position ("selector|index"), or its frame with the selector ("frame|selector").
  const cut = trimmed.lastIndexOf("|");
  if (cut > 0) {
    const head = trimmed.slice(0, cut);
    const tail = trimmed.slice(cut + 1);
    if (/^\d+$/.test(tail)) {
      const withIndex = keys.filter((key) => {
        const target = parseTarget(key);
        return target?.selector === head && target.index === Number(tail);
      });
      if (withIndex.length > 0) return only(withIndex);
    }
    if (/^\d+$/.test(head)) {
      const inFrame = keys.filter((key) => {
        const target = parseTarget(key);
        return target?.frame === Number(head) && target.selector === tail;
      });
      if (inFrame.length > 0) return only(inFrame);
    }
  }
  return null;
}

/**
 * The screen as the AI reads it: each field, each table and each action of a line with its target (`alvo`, the key a
 * plan names it by, `frame|selector|index`), in the place of the selector and position the program keeps. The AI
 * copies the target as it came, and never has to compose it.
 */
export function screenForAi(frames: readonly MappedScreen[]): unknown[] {
  return frames.map((frame, position) => {
    const withTarget = (field: MappedField) => {
      const shown: Record<string, unknown> = { alvo: targetKey(position, field), ...field };
      delete shown.selector;
      delete shown.index;
      return shown;
    };
    return {
      quadro: position,
      system: frame.system,
      host: frame.host,
      path: frame.path,
      params: frame.params,
      title: frame.title,
      headings: frame.headings,
      fields: frame.fields.map(withTarget),
      tables: frame.tables.map((table) => ({
        headers: table.headers,
        rows: table.rows,
        ...(table.lines
          ? { lines: table.lines.map((line) => ({ cells: line.cells, actions: line.actions.map(withTarget) })) }
          : {}),
      })),
    };
  });
}

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
 * the eproc of TJSP opens the summary and elsewhere may send at once). Never "Confirmar seleção de documento", nor the
 * PJe's tab "Protocolar inicial", which opens its summary (its button "Protocolar" sends): asking the lawyer's word
 * and marking the filing as going at the tab would have said a filing went that had not (2026-11-26).
 */
export const MAY_SEND =
  /\b(confirmar ajuizamento|finalizar|concluir (o )?peticionamento|enviar peti[cç][aã]o|protocolar(?! inicial)|peticionar|ajuizar|distribuir|assinar e enviar)\b/i;

/**
 * Checks a plan against the screen and the case: every target exists (a bare selector of one field read as that
 * field's target), every fact is the case's, every code is a line of that list, every file is the package's, and
 * nothing is typed in a field of a login or a code. A click whose words send to the court is marked as sending even
 * when the plan did not mark it. The actions come back with their targets as the screen keys them. Pure.
 */
export function checkPlan(
  plan: ScreenPlan,
  frames: readonly MappedScreen[],
  facts: Pick<FilingFacts, "values" | "arquivos">,
): { actions: PlanAction[]; problems: PlanProblem[] } {
  const fields = fieldsByTarget(frames);
  const problems: PlanProblem[] = [];
  const actions: PlanAction[] = [];
  plan.acoes.forEach((asked, index) => {
    if (asked.fazer === "esperar") {
      actions.push(asked);
      return;
    }
    // The target as the screen keys it: a bare selector of one field is that field (`resolveTarget`).
    const key = resolveTarget(fields, asked.alvo);
    const field = key ? fields.get(key) : undefined;
    if (!key || !field) return problems.push({ action: index, code: "unknown_target" });
    const action = key === asked.alvo ? asked : { ...asked, alvo: key };
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
