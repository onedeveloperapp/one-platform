import { formatNumber, ratio } from "@/lib/admin/format";
import { FIRM_FUNCTION_LABEL, labelOf } from "@/lib/admin/labels";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the operator reads about the platform's use of AI: what it cost and to
 * which firm (`admin_ai_spend_overview`, migration 0014), and how the answers
 * of each task fared with the people who decided them
 * (`admin_ai_task_accuracy`, migration 0016).
 *
 * Counts and cost only. An answer is about a client of a firm: the operator
 * never reads one, and nothing here could carry it.
 */

export type AiSpendTotals = {
  costUsdMicros: number;
  calls: number;
  /** Calls whose model has no price: their cost is unknown, not zero. */
  unpricedCalls: number;
  tokensIn: number;
  tokensOut: number;
};

export type AiSpendByTask = { feature: string; costUsdMicros: number; calls: number; unpricedCalls: number };

export type AiSpendByModel = { provider: string; model: string; costUsdMicros: number; calls: number; priced: boolean };

export type AiSpendByFirm = {
  /** Null for the platform's own calls, charged to no firm. */
  orgId: string | null;
  name: string | null;
  costUsdMicros: number;
  calls: number;
  unpricedCalls: number;
};

export type AiSpendOverview = {
  generatedAt: string;
  windowDays: number;
  since: string;
  /** The first call ever recorded: a small total may only mean the counting just began. */
  measuringSince: string | null;
  usdToBrl: number | null;
  pricedModels: number;
  totals: AiSpendTotals;
  byFeature: AiSpendByTask[];
  byModel: AiSpendByModel[];
  /** How many firms cost something in the window; `byFirm` holds the fifty that cost the most. */
  firmsWithSpend: number;
  byFirm: AiSpendByFirm[];
};

export type AiAutonomy = "approval" | "sampled" | "autonomous";

export type AiTaskMeasure = {
  task: string;
  name: string;
  autonomy: AiAutonomy;
  /** In shadow mode: it watches, decides nothing, and its answers are not the firm's to read. */
  shadow: boolean;
  samplePercent: number;
  /** The functions of a firm that may decide an answer of this task. */
  approvers: string[];
  /** Null when the task has no instructions in force: it cannot run. */
  activeVersion: number | null;
  provider: string | null;
  model: string | null;
  /** Runs started in the window, whatever came of them. */
  runs: number;
  succeeded: number;
  /** Failed, refused by the provider or given up as abandoned. */
  failed: number;
  /** Answers waiting for a person right now. */
  pending: number;
  /** Approved exactly as the model answered. */
  approved: number;
  /** Approved after the person corrected the answer. */
  approvedEdited: number;
  rejected: number;
  /** Sent back with what to change: the task answered again, and that answer is counted on its own. */
  returned: number;
  /** An answer of this task may be sent back with what to change. */
  revisable: boolean;
};

export type AiAccuracy = { generatedAt: string; windowDays: number; tasks: AiTaskMeasure[] };

export type FirmChoice = { id: string; name: string };

/** The task with nothing of a client in it, which the operator runs to see the whole path work. */
export const EXECUTOR_CHECK_TASK = "plataforma.verificacao";

/** How many firms the picker loads at most. Past it, the console says the list is cut. */
export const FIRM_CHOICE_LIMIT = 500;

// ---------- Reads (the operator's session; the functions check the role) ----------

export async function loadAiSpend(supabase: SupabaseClient, windowDays = 30): Promise<AiSpendOverview> {
  const { data, error } = await supabase.rpc("admin_ai_spend_overview", { window_days: windowDays });
  if (error || !data) throw new Error("ai_spend_overview_failed");
  return data as AiSpendOverview;
}

export async function loadAiAccuracy(supabase: SupabaseClient, windowDays = 90): Promise<AiAccuracy> {
  const { data, error } = await supabase.rpc("admin_ai_task_accuracy", { window_days: windowDays });
  if (error || !data) throw new Error("ai_task_accuracy_failed");
  return data as AiAccuracy;
}

/**
 * How the shadow triage of publications compares with the people's
 * (`admin_publication_triage_measure`, migration 0028): of the publications
 * both the AI and a person classified, how often they said the same. One
 * window for every number (the day a publication was captured), so each is
 * a part of the one before it.
 */
export type TriageMeasure = {
  windowDays: number;
  /** Publications captured in the window. */
  captured: number;
  /** Of those, the ones the AI classified. */
  classifiedByAi: number;
  /** Of those captured, the ones the AI gave up on: they are not asked again until the operator says so. */
  gaveUp: number;
  /** Of the ones the AI classified, the ones a person triaged too without the AI's word in front of them. */
  compared: number;
  /** Of those, the ones where both said the same. */
  agreed: number;
  /** The same, by what the person said. */
  byCategory: { category: string; compared: number; agreed: number }[];
  /** Publications whose triage is the AI's own (a category out of the shadow), and the ones of them that wait for a person's check. */
  applied: number;
  waitingReview: number;
  /** Of the AI's own triage, the ones a person checked (no comparison: the person read the AI's word first). */
  checked: number;
  /** What a category must meet to leave the shadow (migration 0035). */
  goal: { windowDays: number; minCompared: number; minAgreedPercent: number; maxMisses: number };
  /** Each category of the AI's own answer: its policy and its measure against the goal. */
  byAiCategory: TriageCategory[];
};

/** A category of the AI's answer: in the shadow, or out of it with a share checked; and how it fared. */
export type TriageCategory = {
  category: string;
  mode: "shadow" | "sampled";
  samplePercent: number;
  /** Publications the AI said were of it that a person triaged blind too, in the window of the goal. */
  compared: number;
  agreed: number;
  /** Publications of it where a person found a deadline or a hearing the AI had not seen, however found. */
  misses: number;
  /** When it went back to the shadow by itself, at such a miss. */
  demotedAt: string | null;
};

/** Whether a category's measure meets the goal: what the database checks again before letting it out. */
export function meetsGoal(
  category: Pick<TriageCategory, "compared" | "agreed" | "misses">,
  goal: TriageMeasure["goal"],
): boolean {
  return (
    category.compared >= goal.minCompared &&
    category.agreed * 100 >= category.compared * goal.minAgreedPercent &&
    category.misses <= goal.maxMisses
  );
}

/** The categories whose triage asks a person for what comes after it: never let out of the shadow (0035, `triage_acting`). */
export const ACTING_CATEGORIES: ReadonlySet<string> = new Set(["prazo", "audiencia", "decisao", "pagamento"]);

/** The operator's words for what a publication is. */
export const TRIAGE_CATEGORY_LABEL: Record<string, string> = {
  prazo: "Prazo",
  audiencia: "Audiência",
  decisao: "Decisão",
  pagamento: "Pagamento",
  ciencia: "Ciência",
  outro: "Outro",
};

export async function loadTriageMeasure(supabase: SupabaseClient, windowDays = 90): Promise<TriageMeasure> {
  const { data, error } = await supabase.rpc("admin_publication_triage_measure", { window_days: windowDays });
  if (error || !data) throw new Error("publication_triage_measure_failed");
  const answer = data as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const rows = Array.isArray(answer.by_category) ? (answer.by_category as Record<string, unknown>[]) : [];
  const own = Array.isArray(answer.by_ai_category) ? (answer.by_ai_category as Record<string, unknown>[]) : [];
  const goal = (answer.goal ?? {}) as Record<string, unknown>;
  return {
    windowDays: count(answer.window_days),
    captured: count(answer.captured),
    classifiedByAi: count(answer.classified_by_ai),
    gaveUp: count(answer.gave_up),
    compared: count(answer.compared),
    agreed: count(answer.agreed),
    byCategory: rows.map((row) => ({
      category: String(row.category ?? ""),
      compared: count(row.compared),
      agreed: count(row.agreed),
    })),
    applied: count(answer.applied),
    waitingReview: count(answer.waiting_review),
    checked: count(answer.checked),
    goal: {
      windowDays: count(goal.window_days),
      minCompared: count(goal.min_compared),
      minAgreedPercent: count(goal.min_agreed_percent),
      maxMisses: count(goal.max_misses),
    },
    byAiCategory: own.map((row) => ({
      category: String(row.category ?? ""),
      mode: row.mode === "sampled" ? "sampled" : "shadow",
      samplePercent: count(row.sample_percent),
      compared: count(row.compared),
      agreed: count(row.agreed),
      misses: count(row.misses),
      demotedAt: typeof row.demoted_at === "string" ? row.demoted_at : null,
    })),
  };
}

/**
 * How the reading of the DJEN is doing across every firm (`admin_djen_health`,
 * migration 0028). Counts only: a reading that is late or keeps failing is a
 * firm that may be missing what the courts told it.
 */
export type DjenHealth = {
  /** After how many hours a reading is late, as the setting says. */
  lateHours: number;
  registrations: number;
  firms: number;
  /**
   * Three parts of the registrations, each one in one of them: read within the time the setting gives,
   * not read for longer than that, and waiting for a first reading that is not late yet.
   */
  inTime: number;
  late: number;
  waitingFirst: number;
  neverRead: number;
  firmsLate: number;
  /** Being read right now. */
  reading: number;
  /** Registrations held by somebody of a firm that no sweep has seen yet, and since when the oldest waits. */
  unseen: number;
  unseenSince: string | null;
  /** Registrations whose last reading left a communication out, and how many communications in all. */
  incomplete: number;
  leftOut: number;
  /** Readings that stopped: nobody of the firm holds the registration anymore. */
  stopped: number;
  /** Registrations whose last try failed, by why. */
  failing: { code: string; registrations: number }[];
  oldestReadAt: string | null;
  capturedLastDay: number;
};

/** The operator's words for why a reading failed. */
export const DJEN_FAILURE_LABEL: Record<string, string> = {
  djen_rate_limited: "O DJEN limitou as consultas",
  djen_unavailable: "O DJEN não respondeu, ou recusou o pedido",
  djen_too_many: "Um dia com mais publicações do que uma leitura alcança",
  djen_invalid_registration: "Inscrição que o DJEN não aceita como está cadastrada",
  abandoned: "Leituras que ninguém terminou",
  capture_failed: "Falha do próprio código da leitura",
};

export async function loadDjenHealth(supabase: SupabaseClient): Promise<DjenHealth> {
  const { data, error } = await supabase.rpc("admin_djen_health");
  if (error || !data) throw new Error("djen_health_failed");
  const answer = data as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const failing = Array.isArray(answer.failing) ? (answer.failing as Record<string, unknown>[]) : [];
  return {
    lateHours: count(answer.late_hours),
    registrations: count(answer.registrations),
    firms: count(answer.firms),
    inTime: count(answer.in_time),
    late: count(answer.late),
    waitingFirst: count(answer.waiting_first),
    neverRead: count(answer.never_read),
    firmsLate: count(answer.firms_late),
    reading: count(answer.reading),
    unseen: count(answer.unseen),
    unseenSince: typeof answer.unseen_since === "string" ? answer.unseen_since : null,
    incomplete: count(answer.incomplete),
    leftOut: count(answer.left_out),
    stopped: count(answer.stopped),
    failing: failing.map((row) => ({ code: String(row.code ?? ""), registrations: count(row.registrations) })),
    oldestReadAt: typeof answer.oldest_read_at === "string" ? answer.oldest_read_at : null,
    capturedLastDay: count(answer.captured_last_day),
  };
}

export async function loadFirmChoices(supabase: SupabaseClient): Promise<FirmChoice[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name")
    .limit(FIRM_CHOICE_LIMIT);
  if (error) throw new Error("firm_choices_failed");
  return (data ?? []) as FirmChoice[];
}

// ---------- How the numbers are written ----------

const LOCALE = "pt-BR";

/**
 * An amount that may be a fraction of a cent: one call of a small task costs
 * less than a hundredth of a dollar, and "US$ 0,00" beside 40 calls would read
 * as free. The digits grow as the amount shrinks, never past six.
 */
function formatSmallMoney(amount: number, currency: "USD" | "BRL"): string {
  const digits = amount === 0 || amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Cost as the ledger keeps it (millionths of a dollar), written in dollars. */
export const formatUsdMicros = (micros: number | null | undefined): string =>
  formatSmallMoney((micros ?? 0) / 1_000_000, "USD");

/** The same cost in reais, at the rate of the price list. Null without a rate: currencies are never mixed. */
export function formatBrlFromMicros(
  micros: number | null | undefined,
  usdToBrl: number | null | undefined,
): string | null {
  if (!usdToBrl || usdToBrl <= 0) return null;
  return formatSmallMoney(((micros ?? 0) / 1_000_000) * usdToBrl, "BRL");
}

/**
 * Answers a person has decided in the window: what the accuracy is measured over. One sent back with what
 * to change was not good as it came, like one corrected or turned down.
 */
export const decidedCount = (task: AiTaskMeasure): number =>
  task.approved + task.approvedEdited + task.rejected + (task.returned ?? 0);

/**
 * The share of decided answers that were approved exactly as the model gave
 * them. Null when nobody decided anything yet: a task with no decisions has no
 * accuracy, and it is on this number that a task earns autonomy.
 */
export const acceptedShare = (task: AiTaskMeasure): number | null => ratio(task.approved, decidedCount(task));

/** How much of what a task answers waits for a person, in the operator's words. */
export function autonomyLabel(task: Pick<AiTaskMeasure, "autonomy" | "samplePercent"> & { shadow?: boolean }): string {
  if (task.shadow) return "modo sombra: não decide nada";
  if (task.autonomy === "autonomous") return "age sozinha";
  if (task.autonomy === "sampled") return `amostra de ${formatNumber(task.samplePercent)}% espera uma pessoa`;
  return "toda resposta espera uma pessoa";
}

/** Who in a firm decides an answer of the task: "Sociedade ou Advocacia". */
export function approversLabel(approvers: readonly string[]): string {
  const names = approvers.map((slug) => labelOf(FIRM_FUNCTION_LABEL, slug, slug));
  return new Intl.ListFormat(LOCALE, { style: "long", type: "disjunction" }).format(names);
}

export type ProviderState = "fake" | "ready" | "missing" | "none";

/** What a run of the task would find in this environment. */
export function providerState(
  task: Pick<AiTaskMeasure, "provider" | "activeVersion">,
  readiness: { fake: boolean; configured: Record<string, boolean> },
): ProviderState {
  if (task.activeVersion === null || !task.provider) return "none";
  if (readiness.fake) return "fake";
  return readiness.configured[task.provider] ? "ready" : "missing";
}

/** The firm a row of cost belongs to, or what the row is when it belongs to none. */
export const spendFirmName = (row: Pick<AiSpendByFirm, "orgId" | "name">): string =>
  row.orgId === null ? "Plataforma (nenhum escritório)" : (row.name ?? "Escritório sem nome");

// ---------- The instructions of each task ----------

/** A version of a task's instructions, as the operator reads it to write the next one. */
export type PromptVersion = {
  task: string;
  version: number;
  provider: string;
  model: string;
  effort: string | null;
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
  maxTokens: number;
  isActive: boolean;
  note: string | null;
  createdAt: string;
};

/** Per task: the version in force (null when none) and how many were published. */
export type TaskPrompts = Record<
  string,
  { active: PromptVersion | null; versions: number; lastPublishedAt: string | null }
>;

type PromptRow = {
  task: string;
  version: number;
  provider: string;
  model: string;
  effort: string | null;
  system_prompt: string;
  output_schema: Record<string, unknown>;
  max_tokens: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
};

/** The instructions of every task (the operator reads them; a firm never does: RLS of 0016). */
export async function loadTaskPrompts(supabase: SupabaseClient): Promise<TaskPrompts> {
  const { data, error } = await supabase
    .from("prompt_versions")
    .select(
      "task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note, created_at",
    )
    .order("version", { ascending: false })
    .limit(500);
  if (error) throw new Error("prompt_versions_failed");
  const result: TaskPrompts = {};
  for (const row of (data ?? []) as PromptRow[]) {
    const entry = (result[row.task] ??= { active: null, versions: 0, lastPublishedAt: null });
    entry.versions += 1;
    if (!entry.lastPublishedAt || row.created_at > entry.lastPublishedAt) entry.lastPublishedAt = row.created_at;
    if (row.is_active) {
      entry.active = {
        task: row.task,
        version: row.version,
        provider: row.provider,
        model: row.model,
        effort: row.effort,
        systemPrompt: row.system_prompt,
        outputSchema: row.output_schema,
        maxTokens: row.max_tokens,
        isActive: true,
        note: row.note,
        createdAt: row.created_at,
      };
    }
  }
  return result;
}

/**
 * The fields of an answer the code of each task reads: a new version of its
 * instructions keeps asking for them, or what reads the approved answer (the
 * check of a document accepting it and adding the legs) would find nothing.
 */
export const TASK_OUTPUT_KEYS: Record<string, readonly string[]> = {
  "plataforma.verificacao": ["resposta", "tarefa"],
  "caso.documento.conferencia": [
    "decisao",
    "motivo",
    "tipo_identificado",
    "legivel",
    "nome_no_documento",
    "confere_com_a_pessoa",
    // What the document says of its person: the database writes it where the record has nothing (0063).
    "dados_lidos",
    "observacoes",
    "trechos",
  ],
  "caso.relato.transcricao": ["texto"],
  "caso.relato.cronologia": ["cronologia", "perguntas"],
  "publicacao.triagem": ["categoria", "urgente", "resumo"],
  "caso.peca.minuta": ["texto", "observacoes"],
  // Read by the database, which takes each only where the publication's words say it (0040).
  "publicacao.prazo": ["ha_prazo", "dias", "contagem", "a_partir", "ato", "trecho"],
  "publicacao.audiencia": ["ha_audiencia", "situacao", "data", "hora", "tipo", "modo", "local", "link", "trecho"],
};

export const PROMPT_PROVIDERS = ["anthropic", "gemini", "openai", "openrouter"] as const;
export const PROMPT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type PromptDraft = {
  task: string;
  provider: string;
  model: string;
  effort: string | null;
  systemPrompt: string;
  outputSchema: string;
  maxTokens: number;
  note: string;
};

/**
 * What is wrong with a draft of the next version, in the operator's words, or
 * null when it may be published. The database checks the same limits; this
 * says which field before anything is sent, and keeps the fields the task's
 * code reads.
 */
export function promptDraftProblem(draft: PromptDraft): { field: keyof PromptDraft; message: string } | null {
  if (!(PROMPT_PROVIDERS as readonly string[]).includes(draft.provider)) {
    return { field: "provider", message: "Escolha um provedor." };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,99}$/.test(draft.model.trim())) {
    return { field: "model", message: "Escreva o identificador do modelo, como o provedor o chama." };
  }
  if (draft.effort !== null && !(PROMPT_EFFORTS as readonly string[]).includes(draft.effort)) {
    return { field: "effort", message: "Escolha um esforço da lista, ou nenhum." };
  }
  if (!Number.isInteger(draft.maxTokens) || draft.maxTokens < 64 || draft.maxTokens > 64000) {
    return { field: "maxTokens", message: "O limite da resposta vai de 64 a 64000." };
  }
  const prompt = draft.systemPrompt.trim();
  if (prompt.length < 20 || prompt.length > 60000) {
    return { field: "systemPrompt", message: "As instruções têm de 20 a 60000 caracteres." };
  }
  let schema: unknown;
  try {
    schema = JSON.parse(draft.outputSchema);
  } catch {
    return { field: "outputSchema", message: "O formato da resposta não é um JSON válido." };
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { field: "outputSchema", message: "O formato da resposta é um objeto JSON Schema." };
  }
  const root = schema as { type?: unknown; required?: unknown; properties?: unknown };
  if (root.type !== "object" || typeof root.properties !== "object" || root.properties === null) {
    return { field: "outputSchema", message: "A raiz do formato é um objeto (type object) com as suas propriedades." };
  }
  const required = Array.isArray(root.required) ? root.required : [];
  const missing = (TASK_OUTPUT_KEYS[draft.task] ?? []).filter(
    (key) => !required.includes(key) || !(key in (root.properties as Record<string, unknown>)),
  );
  if (missing.length > 0) {
    return {
      field: "outputSchema",
      message: `O código desta tarefa lê ${missing.join(", ")}: o formato continua pedindo esses campos.`,
    };
  }
  if (draft.note.trim().length < 8) {
    return { field: "note", message: "Diga o que muda nesta versão e por quê (pelo menos 8 caracteres)." };
  }
  return null;
}

/**
 * One decision ONE may take alone in the firms, and whether the operator holds it for every firm (migration 0016):
 * here, with its reason, or through the autonomy of the task that takes it.
 */
export type AutonomyCatalogEntry = { key: string; held: boolean; heldNote: string | null; taskHeld: boolean };

/** The catalog of what ONE decides alone (`admin_autonomy_catalog`): nothing of a firm. Throws when it could not be read. */
export async function loadAutonomyCatalog(supabase: SupabaseClient): Promise<AutonomyCatalogEntry[]> {
  const { data, error } = await supabase.rpc("admin_autonomy_catalog");
  if (error || !Array.isArray(data)) throw new Error("the autonomy catalog could not be read");
  return (data as { key: string; held: boolean; held_note: string | null; task_held: boolean }[]).map((row) => ({
    key: row.key,
    held: row.held === true,
    heldNote: row.held_note,
    taskHeld: row.task_held === true,
  }));
}

/**
 * How the flights ONE follows stand (migration 0051): whether its first word to real passengers is released, when,
 * by whom and on what note, the reads at FlightAware today against the ceiling, and how many trips it follows.
 */
export type FlightWatchStatus = {
  released: boolean;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedNote: string | null;
  readsToday: number;
  dailyReads: number;
  /** Each firm's share of the day's reads (migration 0072), and the firms that read the most today. */
  firmDailyReads: number;
  firmsToday: { firm: string; reads: number }[];
  followingReal: number;
  followingTest: number;
  heldAlerts: number;
};

/** `admin_flight_watch_status`, read. Throws when it could not be read. */
export async function loadFlightWatch(supabase: SupabaseClient): Promise<FlightWatchStatus> {
  const { data, error } = await supabase.rpc("admin_flight_watch_status");
  if (error || !data || typeof data !== "object") throw new Error("the flight watch could not be read");
  const row = data as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    released: row.released === true,
    releasedAt: text(row.released_at),
    releasedBy: text(row.released_by),
    releasedNote: text(row.released_note),
    readsToday: count(row.reads_today),
    dailyReads: count(row.daily_reads),
    firmDailyReads: count(row.firm_daily_reads),
    firmsToday: (Array.isArray(row.firms_today) ? row.firms_today : []).flatMap((item) => {
      const firm = (item ?? {}) as Record<string, unknown>;
      return typeof firm.firm === "string" ? [{ firm: firm.firm, reads: count(firm.reads) }] : [];
    }),
    followingReal: count(row.following_real),
    followingTest: count(row.following_test),
    heldAlerts: count(row.held_alerts),
  };
}
