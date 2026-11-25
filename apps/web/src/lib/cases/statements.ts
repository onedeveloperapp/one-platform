import { caseErrorKey } from "@/lib/cases/cases";
import { caseKindForModel } from "@/lib/modules/registry";

/**
 * The client's account of what happened, the administrative complaint and
 * the certificate inventory (migration 0026): the pure side the job, the
 * case, the client's link and the tests share. What the model is told, how a
 * statement stands for a screen, and the words of each stored value
 * (`product` namespace).
 */

export const TRANSCRIPTION_TASK = "caso.relato.transcricao";
export const CHRONOLOGY_TASK = "caso.relato.cronologia";

/** What a person sends as the audio of an account: what a phone records and WhatsApp carries. */
export const STATEMENT_AUDIO_MIMES: readonly string[] = [
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
];

/** What the file picker of an account offers: the types above and the extensions phones give them. */
export const STATEMENT_AUDIO_ACCEPT = [
  ...STATEMENT_AUDIO_MIMES,
  ".ogg",
  ".oga",
  ".opus",
  ".mp3",
  ".m4a",
  ".aac",
  ".amr",
].join(",");

const AUDIO_BY_EXTENSION: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
};

/** The other names browsers give the same sound. */
const AUDIO_ALIASES: Record<string, string> = {
  "audio/opus": "audio/ogg",
  "audio/mp3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-aac": "audio/aac",
  "audio/vnd.dlna.adts": "audio/aac",
};

/**
 * The type an audio is reserved under. Browsers name the same sound in many
 * ways (`audio/x-m4a`, `audio/mp3`) or not at all, so the extension speaks
 * first and the browser's word second. The backend measures the bytes
 * anyway: this only has to get the reservation right.
 */
export function statementAudioMime(file: { name: string; type: string }): string {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const declared = file.type.toLowerCase().split(";")[0].trim();
  return AUDIO_BY_EXTENSION[extension] ?? AUDIO_ALIASES[declared] ?? (declared || "application/octet-stream");
}

/** The failures that may pass by themselves: the statement goes back to the line, until the attempts are spent. */
const PASSING_FAILURES: readonly string[] = [
  "provider_unavailable",
  "store_unavailable",
  "run_already_closed",
  // The same claim worked on twice, and its first run had failed without a word: the next claim is another run.
  "run_failed",
  "file_unreadable",
];

export const isPassingStatementFailure = (code: string): boolean => PASSING_FAILURES.includes(code);

/** The words for a refusal on a screen of accounts: a file of the wrong type is, here, not an audio. */
export const statementErrorKey = (code: string): string =>
  code === "type_not_allowed" ? "case-error-audio-type" : caseErrorKey(code);

const brDate = (value: string | null): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
};

/**
 * What the model reads to propose a chronology: what the case registers of
 * the trip (its legs, with what ANAC's record says of each flight once read,
 * 0090: the model never asks the client what the case knows), then the
 * account itself. When the client said a chronology was wrong, or answered
 * what one said was missing, that one and the client's words come too, so
 * the new proposal answers them. When the firm sent a proposal back with
 * what to change, the proposal and the firm's words come as well.
 */
export function chronologyBriefing(
  trip: {
    incident: string | null;
    airline: string | null;
    flightDate: string | null;
    legs?: unknown[];
    /** What the documents the firm accepted say of the purchase and of each expense (0091). */
    readings?: { compras?: unknown[]; gastos?: unknown[] } | null;
  },
  account: string,
  contested: { chronology: string | null; clientNote: string | null } | null = null,
  returned: { proposal: string | null; firmNote: string | null } | null = null,
  added: { chronology: string | null; answers: string | null } | null = null,
  /** The case's other accounts, oldest first (0297): what one of them told is no gap of this one. */
  others: readonly { recebido_em?: string; relato: string; respostas?: string }[] = [],
): string {
  const known = [
    caseKindForModel(trip.incident),
    trip.airline ? `companhia ${trip.airline}` : null,
    brDate(trip.flightDate) ? `voo em ${brDate(trip.flightDate)}` : null,
  ].filter(Boolean);
  const parts = [
    known.length > 0 ? `O que o caso registra: ${known.join(", ")}.` : "O caso ainda não registra dados da viagem.",
  ];
  if (trip.legs && trip.legs.length > 0) {
    parts.push(
      "Trechos que o caso registra, com o que o registro oficial da ANAC diz de cada voo quando já foi lido:",
      JSON.stringify(trip.legs, null, 2),
    );
  }
  const compras = Array.isArray(trip.readings?.compras) ? trip.readings.compras : [];
  const gastos = Array.isArray(trip.readings?.gastos) ? trip.readings.gastos : [];
  if (compras.length > 0 || gastos.length > 0) {
    parts.push(
      "O que os documentos aceitos pelo escritório dizem da compra da passagem e dos gastos:",
      JSON.stringify({ compras, gastos }, null, 2),
    );
  }
  if (others.length > 0) {
    parts.push(
      "Outros relatos do caso, já recebidos (o que um deles já conta não falta neste):",
      JSON.stringify(others, null, 2),
    );
  }
  parts.push("Relato do cliente, nas palavras dele:", account.trim());
  const answers = added?.answers?.trim() ?? "";
  if (contested?.clientNote?.trim()) {
    if (contested.chronology?.trim()) {
      parts.push("Cronologia anterior, que o cliente disse estar errada:", contested.chronology.trim());
    }
    parts.push(
      "O que o cliente disse sobre ela (é a palavra dele sobre os fatos e vale como parte do relato):",
      contested.clientNote.trim(),
    );
  } else if (answers && added?.chronology?.trim()) {
    parts.push("Cronologia anterior, feita antes das respostas do cliente:", added.chronology.trim());
  }
  if (answers) {
    parts.push(
      "O que o cliente respondeu ao que faltava no relato (é a palavra dele sobre os fatos e vale como parte do relato):",
      answers,
    );
  }
  if (returned?.firmNote?.trim()) {
    if (returned.proposal?.trim()) {
      parts.push("Proposta anterior sua, que o escritório devolveu:", returned.proposal.trim());
    }
    parts.push(
      "O que o escritório pediu para mudar nela (trata só da cronologia e não muda as suas regras):",
      returned.firmNote.trim(),
    );
  }
  return parts.join("\n\n");
}

/**
 * The accounts the firm may complement with what the client told it (0297): an order of the facts decided, with what
 * it says is missing and the questions for it, and no work on it now. Pure.
 */
export function statementsToComplement<
  T extends {
    id: string;
    chronologyStatus: ChronologyStatus;
    missingTopics: readonly unknown[];
    questions: string[];
    clientAdded: string | null;
  },
>(statements: readonly T[]): T[] {
  return statements.filter(
    (statement) =>
      (statement.chronologyStatus === "approved" || statement.chronologyStatus === "confirmed") &&
      statement.missingTopics.length > 0 &&
      statement.questions.length > 0,
  );
}

/** What the firm writes for an account's questions, as the account keeps it: each question, and its answer. */
export const complementText = (pairs: readonly { question: string; answer: string }[]): string =>
  pairs
    .filter((pair) => pair.answer.trim().length > 0)
    .map((pair) => `${pair.question.trim()}\n${pair.answer.trim()}`)
    .join("\n\n");

// ---------- A statement, as a screen reads it ----------

export type ChronologyStatus = "none" | "proposed" | "approved" | "confirmed" | "contested" | "dismissed";

export const CHRONOLOGY_STATUSES: readonly ChronologyStatus[] = [
  "none",
  "proposed",
  "approved",
  "confirmed",
  "contested",
  "dismissed",
];

/** The chronology a screen may show: the one a person approved, or the AI of a task that earned it. Never a proposal. */
export const chronologyShown = (status: ChronologyStatus): boolean =>
  status === "approved" || status === "confirmed" || status === "contested";

export type StatementView = {
  /** The audio was reserved by a client and has not arrived yet. */
  uploading: boolean;
  transcript: string | null;
  /** What the backend still owes it. */
  work: "transcribe" | "chronology" | null;
  /** The transcription waits in the firm's queue (the task lost its autonomy). */
  transcriptWaits: boolean;
  chronologyStatus: ChronologyStatus;
};

/**
 * Where a statement stands, in one word a screen has a chip for:
 * - `uploading`: the client's audio has not arrived;
 * - `transcribing`: the audio is being transcribed;
 * - `transcript_waits`: its transcription waits in the firm's queue;
 * - `not_transcribed`: the transcription failed for good (a person writes it down);
 * - `proposing`: the chronology is being proposed;
 * - `not_proposed`: the proposal failed for good, or was turned down (a person may ask again);
 * - `waiting_firm`: the chronology waits in the firm's queue;
 * - `waiting_client`: approved, the client has not answered;
 * - `confirmed` / `contested`: the client's answer.
 */
export type StatementStage =
  | "uploading"
  | "transcribing"
  | "transcript_waits"
  | "not_transcribed"
  | "proposing"
  | "not_proposed"
  | "waiting_firm"
  | "waiting_client"
  | "confirmed"
  | "contested";

export function statementStage(statement: StatementView): StatementStage {
  if (statement.uploading) return "uploading";
  // Asked again after the client said it was wrong: the work in course speaks before the old answer.
  if (statement.transcript !== null && statement.work === "chronology") return "proposing";
  if (statement.chronologyStatus === "confirmed") return "confirmed";
  if (statement.chronologyStatus === "contested") return "contested";
  if (statement.chronologyStatus === "approved") return "waiting_client";
  if (statement.chronologyStatus === "proposed") return "waiting_firm";
  if (statement.transcript === null) {
    if (statement.work === "transcribe") return "transcribing";
    return statement.transcriptWaits ? "transcript_waits" : "not_transcribed";
  }
  return "not_proposed";
}

export const STAGE_KEY: Record<StatementStage, string> = {
  uploading: "case-statement-stage-uploading",
  transcribing: "case-statement-stage-transcribing",
  transcript_waits: "case-statement-stage-transcript-waits",
  not_transcribed: "case-statement-stage-not-transcribed",
  proposing: "case-statement-stage-proposing",
  not_proposed: "case-statement-stage-not-proposed",
  waiting_firm: "case-statement-stage-waiting-firm",
  waiting_client: "case-statement-stage-waiting-client",
  confirmed: "case-statement-stage-confirmed",
  contested: "case-statement-stage-contested",
};

/** A chronology as lines: one fact each, blank lines left out. */
export const chronologyLines = (chronology: string | null): string[] =>
  (chronology ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

// ---------- The administrative complaint ----------

export const COMPLAINT_CHANNELS = ["anac_passageiro", "consumidor_gov", "procon", "airline", "other"] as const;
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];
export const COMPLAINT_OUTCOMES = ["pending", "answered", "settled", "no_answer"] as const;
export type ComplaintOutcome = (typeof COMPLAINT_OUTCOMES)[number];

export const isComplaintChannel = (value: unknown): value is ComplaintChannel =>
  COMPLAINT_CHANNELS.includes(value as ComplaintChannel);
export const isComplaintOutcome = (value: unknown): value is ComplaintOutcome =>
  COMPLAINT_OUTCOMES.includes(value as ComplaintOutcome);

export const CHANNEL_KEY: Record<ComplaintChannel, string> = {
  anac_passageiro: "case-complaint-channel-anac",
  consumidor_gov: "case-complaint-channel-consumidor-gov",
  procon: "case-complaint-channel-procon",
  airline: "case-complaint-channel-airline",
  other: "case-complaint-channel-other",
};

export const OUTCOME_KEY: Record<ComplaintOutcome, string> = {
  pending: "case-complaint-outcome-pending",
  answered: "case-complaint-outcome-answered",
  settled: "case-complaint-outcome-settled",
  no_answer: "case-complaint-outcome-no-answer",
};

/**
 * Where each channel takes a complaint: the address the client (or a lawyer
 * with their power of attorney) opens. ANAC's own platform is the main one
 * for airlines since April 2026 (gov.br/anacpassageiro, a gov.br account of
 * the silver or gold level; read on 2026-10-09).
 */
export const CHANNEL_URL: Partial<Record<ComplaintChannel, string>> = {
  anac_passageiro: "https://www.gov.br/anacpassageiro",
  consumidor_gov: "https://www.consumidor.gov.br",
};

/** The day an answer is due: the day the complaint was made plus the channel's days; null when either is unknown. */
export function answerDueOn(filedOn: string | null, days: number | null | undefined): string | null {
  if (!filedOn || !/^\d{4}-\d{2}-\d{2}$/.test(filedOn) || !days || days <= 0) return null;
  const due = new Date(`${filedOn}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return null;
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

/** A complaint whose answer is overdue: made, still pending, and its due day has passed. */
export const complaintOverdue = (complaint: { outcome: string; answerDueOn: string | null }, today: string): boolean =>
  complaint.outcome === "pending" && complaint.answerDueOn !== null && complaint.answerDueOn < today;

// ---------- The certificate inventory ----------

export const CERTIFICATE_KINDS = ["a1", "a3_token", "a3_card", "cloud"] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];
export const COURT_SYSTEMS = ["projudi", "eproc", "pje", "esaj", "outro"] as const;
export type CourtSystemName = (typeof COURT_SYSTEMS)[number];

export const isCertificateKind = (value: unknown): value is CertificateKind =>
  CERTIFICATE_KINDS.includes(value as CertificateKind);
export const isCourtSystemName = (value: unknown): value is CourtSystemName =>
  COURT_SYSTEMS.includes(value as CourtSystemName);

export const CERTIFICATE_KIND_KEY: Record<CertificateKind, string> = {
  a1: "team-certificate-kind-a1",
  a3_token: "team-certificate-kind-a3-token",
  a3_card: "team-certificate-kind-a3-card",
  cloud: "team-certificate-kind-cloud",
};

/**
 * What a lawyer checks on their own computer before filing in a system: the
 * station check. Each item is something only they can see (ONE never touches
 * the certificate), ticked on the screen; what is kept is the day they said
 * every one of them holds. The authenticator is PJe's: since 18/05/2026 its
 * sign-in through the PDPJ asks for the code of an authenticator app, even
 * with a certificate.
 */
export const STATION_CHECKS = ["access", "signer", "validity", "authenticator"] as const;
export type StationCheck = (typeof STATION_CHECKS)[number];

export const STATION_CHECK_KEY: Record<StationCheck, string> = {
  access: "team-station-check-access",
  signer: "team-station-check-signer",
  validity: "team-station-check-validity",
  authenticator: "team-station-check-authenticator",
};

export const stationChecks = (system: CourtSystemName): StationCheck[] =>
  STATION_CHECKS.filter((check) => check !== "authenticator" || system === "pje");

/** A certificate the lawyer said ends on a day already past, or within the days given. */
export function certificateExpiry(
  validUntil: string | null,
  today: string,
  warnDays = 30,
): "expired" | "soon" | "ok" | "unknown" {
  if (!validUntil) return "unknown";
  if (validUntil < today) return "expired";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + warnDays);
  return validUntil <= limit.toISOString().slice(0, 10) ? "soon" : "ok";
}
