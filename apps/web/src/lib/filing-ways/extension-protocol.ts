import {
  COURT_SYSTEMS,
  type CourtSystemKey,
  isCodeTable,
  type MappedField,
  type MappedLine,
  type MappedScreen,
  type MappedTable,
  redact,
  screenParams,
} from "@/lib/court-extension/capture";
import type { FilingFacts } from "@/lib/court-robot/facts";
import type { CaseShape, LearnedStep, ScreenSignature } from "@/lib/court-robot/map";
import {
  type DoneAction,
  parseTarget,
  type PlanAction,
  type ScreenKind,
  type ScreenPlan,
} from "@/lib/court-robot/plan";

/**
 * The calls ONE's browser extension makes to ONE (`/api/extensao/v1/...`; the owner's second way to file, 2026-11-20:
 * the lawyer files a batch they approved in ONE through their own session, and ONE fills and sends it there): what
 * each call sends and answers, and the checks of what the backend takes from a lawyer's browser before it reaches the
 * AI that reads screens or the platform's map of a system, which every firm follows. Pure: the backend's routes and
 * the extension import it.
 */

export const EXTENSION_API = "/api/extensao/v1";

/** What the extension holds once linked: `onex_` and 43 letters, kept as its SHA-256 alone (0263). */
export const TOKEN_PATTERN = /^onex_[A-Za-z0-9_-]{43}$/;

/** The letters of a link code: no 0, O, 1, I or L, which a person misreads. */
export const LINK_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 7;

/** A link code as the lawyer typed it (small letters, spaces, a dash), or null when it cannot be one. */
export function linkCodeOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s.-]/g, "");
  if (code.length !== LINK_CODE_LENGTH) return null;
  return [...code].every((letter) => LINK_CODE_LETTERS.includes(letter)) ? code : null;
}

// ---------- What each call answers ----------

export type ExtensionSystem = { key: string; name: string; host: string };

export type ExtensionBatch = {
  id: string;
  system: ExtensionSystem;
  status: "approved" | "running" | "awaiting_confirmation";
  /** How many lawsuits it holds, and how many are still to be filed. */
  packages: number;
  left: number;
  /** ONE still learns the system: the first filing stops before sending, for the lawyer's word. */
  learning: boolean;
};

export type ExtensionSituation = { lawyer: string; firm: string; batches: ExtensionBatch[] };

export type ExtensionLinked = { token: string; lawyer: string; firm: string };

export type ExtensionStarted = {
  claim: number;
  system: ExtensionSystem;
  learning: boolean;
  /** The path ONE follows at the system, or null where it reads every screen. */
  map: LearnedStep[] | null;
};

export type ExtensionFile = { position: number; name: string; type: string; url: string };

export type ExtensionFiling = {
  id: string;
  claim: number;
  learning: boolean;
  /** Its lawyer already confirmed it (in ONE, while it waited). */
  confirmed: boolean;
  caseSeq: number | null;
  /** Who the lawsuit is for, as the panel names it: the first claimant's first name. */
  client: string;
  facts: FilingFacts;
  files: ExtensionFile[];
};

export type ExtensionFilingState = {
  status: string;
  confirmed: boolean;
  batch: string;
};

/** What the extension says came of a filing the database marked as going. */
export type ExtensionOutcome = {
  outcome: "filed" | "unknown";
  number?: string | null;
  message?: string | null;
  receipt?: string | null;
};

export type ExtensionPlanned = { plan: ScreenPlan | null };

/** A refusal, as the extension reads it, with the HTTP status of each. */
export const REFUSAL_STATUS: Record<string, number> = {
  missing_token: 401,
  invalid_token: 401,
  invalid_code: 400,
  invalid_body: 400,
  invalid_screen: 400,
  invalid_steps: 400,
  not_found: 404,
  not_available: 409,
  interrupted: 409,
  not_working: 409,
  too_many_screens: 429,
  unavailable: 503,
};

// ---------- What the backend takes of a screen ----------

const FRAMES_MOST = 8;
const FIELDS_MOST = 600;
const OPTIONS_MOST = 400;
const SCREEN_BYTES_MOST = 600_000;

const text = (value: unknown, most: number): string => (typeof value === "string" ? value.slice(0, most) : "");
const textOrNull = (value: unknown, most: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, most) : null;

const FIELD_KINDS: readonly MappedField["kind"][] = ["input", "select", "textarea", "button", "link"];

/** Parameters as an address writes them, for the capture's own rule of what names a screen. */
function paramsSearch(raw: unknown): string {
  const search = new URLSearchParams();
  if (typeof raw === "object" && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
      if (typeof value === "string") search.append(key, value);
    }
  }
  return search.toString();
}

function fieldOf(raw: unknown): MappedField | null {
  if (typeof raw !== "object" || raw === null) return null;
  const field = raw as Record<string, unknown>;
  if (!FIELD_KINDS.includes(field.kind as MappedField["kind"])) return null;
  if (typeof field.selector !== "string" || !field.selector || typeof field.index !== "number") return null;
  const options = Array.isArray(field.options)
    ? field.options.slice(0, OPTIONS_MOST).flatMap((option) => {
        if (typeof option !== "object" || option === null) return [];
        const line = option as Record<string, unknown>;
        // What the map keeps of a line, whatever the page said: never a person's number or e-mail.
        return [{ value: redact(text(line.value, 60)).slice(0, 60), text: redact(text(line.text, 120)) }];
      })
    : null;
  return {
    kind: field.kind as MappedField["kind"],
    type: textOrNull(field.type, 30),
    id: textOrNull(field.id, 80),
    name: textOrNull(field.name, 80),
    label: field.label === null ? null : redact(text(field.label, 120)) || null,
    required: field.required === true,
    disabled: field.disabled === true,
    readOnly: field.readOnly === true,
    visible: field.visible !== false,
    options,
    optionCount: typeof field.optionCount === "number" ? field.optionCount : null,
    selector: field.selector.slice(0, 300),
    index: Math.max(0, Math.floor(field.index)),
    // What the field holds now (2026-11-26): the code chosen only in a list whose lines are the system's own (a list
    // of people keeps no lines, so it keeps no choice), a box ticked, a field filled; never a value.
    ...(options !== null && (typeof field.chosen === "string" || field.chosen === null)
      ? { chosen: field.chosen === null ? null : redact(text(field.chosen, 60)).slice(0, 60) }
      : {}),
    ...(typeof field.checked === "boolean" ? { checked: field.checked } : {}),
    ...(typeof field.filled === "boolean" ? { filled: field.filled } : {}),
  };
}

const LINES_MOST = 60;
const CELLS_MOST = 8;
const LINE_ACTIONS_MOST = 4;

/**
 * The lines of a table the extension read line by line: only where its column names make it a table of the system's
 * own codes (the same rule as the capture's, read again here), every cell redacted again, each action a button or a
 * link. Null when there is none to take.
 */
function linesOf(raw: unknown, headers: readonly string[]): MappedLine[] | null {
  if (!Array.isArray(raw) || !isCodeTable(headers)) return null;
  return raw.slice(0, LINES_MOST).flatMap((item): MappedLine[] => {
    if (typeof item !== "object" || item === null) return [];
    const line = item as Record<string, unknown>;
    const cells = Array.isArray(line.cells)
      ? line.cells.slice(0, CELLS_MOST).map((cell) => redact(text(cell, 120)))
      : [];
    const actions = Array.isArray(line.actions)
      ? line.actions
          .slice(0, LINE_ACTIONS_MOST)
          .flatMap((action) => fieldOf(action) ?? [])
          .filter((action) => action.kind === "button" || action.kind === "link")
          .map((action) => ({ ...action, options: null, optionCount: null }))
      : [];
    return [{ cells, actions }];
  });
}

function tableOf(raw: unknown): MappedTable | null {
  if (typeof raw !== "object" || raw === null) return null;
  const table = raw as Record<string, unknown>;
  if (typeof table.selector !== "string" || typeof table.index !== "number") return null;
  const headers = Array.isArray(table.headers) ? table.headers.slice(0, 30).map((cell) => redact(text(cell, 120))) : [];
  const lines = linesOf(table.lines, headers);
  return {
    selector: table.selector.slice(0, 300),
    index: Math.max(0, Math.floor(table.index)),
    headers,
    rows: typeof table.rows === "number" ? Math.max(0, Math.floor(table.rows)) : 0,
    ...(lines ? { lines } : {}),
  };
}

/**
 * A screen as the backend takes it from the extension, frame by frame, before the AI reads it: only the keys a capture
 * writes, every text redacted again (an e-mail, a long number), sizes kept. Null for what is not a screen.
 */
export function readScreen(raw: unknown): MappedScreen[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > FRAMES_MOST) return null;
  if (JSON.stringify(raw).length > SCREEN_BYTES_MOST) return null;
  const frames: MappedScreen[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const frame = item as Record<string, unknown>;
    if (!Array.isArray(frame.fields) || frame.fields.length > FIELDS_MOST) return null;
    // Only the parameters that name a screen, as the capture keeps them: never a hash, a token or a number.
    const params = screenParams(paramsSearch(frame.params));
    frames.push({
      system:
        typeof frame.system === "string" && Object.hasOwn(COURT_SYSTEMS, frame.system)
          ? (frame.system as CourtSystemKey)
          : null,
      host: text(frame.host, 120),
      path: redact(text(frame.path, 200)),
      params,
      title: redact(text(frame.title, 120)),
      headings: Array.isArray(frame.headings) ? frame.headings.slice(0, 40).map((line) => redact(text(line, 120))) : [],
      fields: frame.fields.flatMap((field) => fieldOf(field) ?? []),
      tables: Array.isArray(frame.tables) ? frame.tables.slice(0, 40).flatMap((table) => tableOf(table) ?? []) : [],
      capturedAt: text(frame.capturedAt, 40),
    });
  }
  return frames;
}

// ---------- What the backend takes of a path ONE learned ----------

const STEPS_MOST = 80;
const ACTIONS_MOST = 40;
const STEPS_BYTES_MOST = 400_000;

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

/** A fact's key as `filingFactsOf` writes them: `processo.classe`, `autor.1.cpf`, `autor.2.representante.nome`. */
const FACT_KEY = /^(processo|autor|reu|advogado)(\.[a-z0-9_]{1,40}){1,3}$/;

function actionOf(raw: unknown): PlanAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const action = raw as Record<string, unknown>;
  if (!DOINGS.includes(action.fazer as PlanAction["fazer"])) return null;
  if (typeof action.alvo !== "string" || action.alvo.length > 300) return null;
  if (action.fazer !== "esperar" && !parseTarget(action.alvo)) return null;
  const kept: PlanAction = { fazer: action.fazer as PlanAction["fazer"], alvo: action.alvo };
  if (action.fato !== undefined) {
    if (typeof action.fato !== "string" || !FACT_KEY.test(action.fato)) return null;
    kept.fato = action.fato;
  }
  if (action.opcao !== undefined) {
    // A code of the system's own list, as the capture kept it: never a person's number or e-mail.
    if (typeof action.opcao !== "string" || action.opcao.length > 60 || redact(action.opcao) !== action.opcao)
      return null;
    kept.opcao = action.opcao;
  }
  if (action.arquivo !== undefined) {
    if (
      typeof action.arquivo !== "number" ||
      !Number.isInteger(action.arquivo) ||
      action.arquivo < 1 ||
      action.arquivo > 200
    ) {
      return null;
    }
    kept.arquivo = action.arquivo;
  }
  if (action.envia === true) kept.envia = true;
  // What the AI said of why it chose an action never goes into the map.
  return kept;
}

function signatureOf(raw: unknown): ScreenSignature | null {
  if (typeof raw !== "object" || raw === null) return null;
  const signature = raw as Record<string, unknown>;
  const given = typeof signature.params === "object" && signature.params !== null ? signature.params : {};
  const params = screenParams(paramsSearch(given));
  // A parameter the capture would not keep names no screen: the path is not taken.
  if (Object.keys(params).length !== Object.keys(given).length) return null;
  if (
    typeof signature.titulo !== "string" ||
    signature.titulo.length > 160 ||
    redact(signature.titulo) !== signature.titulo.trim()
  ) {
    return null;
  }
  if (!Array.isArray(signature.campos) || signature.campos.length > 40) return null;
  const campos: string[] = [];
  for (const field of signature.campos) {
    if (typeof field !== "string" || field.length > 130 || /\d{10,}|@/.test(field)) return null;
    campos.push(field);
  }
  return { params, titulo: signature.titulo, campos };
}

function shapeOf(raw: unknown): CaseShape | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return undefined;
  const shape = raw as Record<string, unknown>;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 50 ? value : null;
  const autores = count(shape.autores);
  const reus = count(shape.reus);
  const arquivos = count(shape.arquivos);
  return autores === null || reus === null || arquivos === null ? undefined : { autores, reus, arquivos };
}

/**
 * A path ONE learned, as the backend takes it from the extension before it becomes the platform's map of a system:
 * each screen by what tells it apart, each action by a target, a fact's key, a code of the system's list or a file's
 * position, never a value, a person or a lawsuit's number. Null when anything of it is not so: a path is taken whole
 * or not at all.
 */
export function readSteps(raw: unknown): LearnedStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > STEPS_MOST) return null;
  if (JSON.stringify(raw).length > STEPS_BYTES_MOST) return null;
  const steps: LearnedStep[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const step = item as Record<string, unknown>;
    const assinatura = signatureOf(step.assinatura);
    if (!assinatura || !KINDS.includes(step.tipo as ScreenKind)) return null;
    if (!Array.isArray(step.acoes) || step.acoes.length > ACTIONS_MOST) return null;
    const acoes: PlanAction[] = [];
    for (const action of step.acoes) {
      const kept = actionOf(action);
      if (!kept) return null;
      acoes.push(kept);
    }
    const forma = shapeOf(step.forma);
    if (forma === undefined) return null;
    steps.push({
      assinatura,
      tipo: step.tipo as ScreenKind,
      acoes,
      forma,
      // A step that pressed the line a search found is never followed again: the mark is kept as it came.
      ...(step.linhas === true ? { linhas: true as const } : {}),
    });
  }
  return steps;
}

/** What came of an action, as the runner says it: done, not taken by the screen, or why it was not tried. */
const DONE_RESULTS = ["ok", "not_done", "unknown_target", "unknown_fact", "unknown_file"] as const;
const DONE_MOST = 40;

/**
 * What ONE did on the screen it reads again (2026-11-26), as the backend takes it before the AI reads it: each action
 * checked as a path's action is (a target, a fact's key, a code of the system's list, a file's position, never a
 * value) with what came of it. What is not so is left out; none when nothing came.
 */
export function readDone(raw: unknown): DoneAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-DONE_MOST).flatMap((item): DoneAction[] => {
    if (typeof item !== "object" || item === null) return [];
    const done = item as Record<string, unknown>;
    const acao = actionOf(done.acao);
    const resultado = (DONE_RESULTS as readonly unknown[]).includes(done.resultado) ? String(done.resultado) : null;
    return acao && resultado ? [{ acao, resultado }] : [];
  });
}

/** A lawsuit's number as the extension read it from the receipt: twenty digits, or null. */
export const receiptDigits = (raw: unknown): string | null => {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  return digits.length === 20 ? digits : null;
};

/** The words of the court's receipt as the extension read them, kept short and plain. */
export const receiptText = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const clean = raw
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20_000);
  return clean.length > 0 ? clean : null;
};
