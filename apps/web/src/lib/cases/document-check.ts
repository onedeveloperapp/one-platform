import type { DocumentKind, Incident } from "@/lib/cases/cases";
import type { DocumentQuality, PhotoProblem } from "@/lib/cases/document-quality";

/**
 * The AI's check of a document of a case (migration 0024): what the model is
 * told beside the file, what each file goes through, and how its answer is
 * read back by the screens. Pure, so the job, the case and the queue share
 * one reading of it.
 *
 * The answer is a suggestion: it waits for a person in the queue or on the
 * case, and only what a person approved acts on the document.
 */

export const DOCUMENT_CHECK_TASK = "caso.documento.conferencia";

/** What a person sends that the backend turns into a page of a PDF. */
export const IMAGE_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** What the backend does with one claimed document. */
export type ProcessingPlan = {
  /** A photo becomes a PDF kept beside it. */
  normalize: boolean;
  /** What the model is given: the photo (as the reduced JPEG the backend made of it), the PDF itself, or nothing. */
  check: "image" | "document" | null;
};

export function processingPlan(input: { mime: string | null; wantsCheck: boolean }): ProcessingPlan {
  const mime = (input.mime ?? "").toLowerCase();
  const image = IMAGE_MIMES.includes(mime);
  const check = !input.wantsCheck ? null : image ? "image" : mime === "application/pdf" ? "document" : null;
  return { normalize: image, check };
}

// What the model is told, in its own language: never words of the screen (they may change), never a dash.

const KIND_FOR_MODEL: Record<DocumentKind, string> = {
  identity: "documento de identidade com foto (RG, CNH, passaporte, carteira de trabalho ou outro documento oficial)",
  address_proof: "comprovante de endereço (conta de água, luz, telefone, internet, banco ou contrato de aluguel)",
  ticket: "bilhete ou confirmação de reserva da passagem aérea",
  boarding_pass: "cartão de embarque",
  receipt: "recibo, nota fiscal ou comprovante de uma despesa",
  evidence: "prova do que aconteceu (foto, conversa, aviso da companhia)",
  power_of_attorney: "procuração",
  contract: "contrato",
  petition: "petição do processo",
  other: "outro documento do caso",
};

const INCIDENT_FOR_MODEL: Record<Incident, string> = {
  delay: "atraso de voo",
  cancellation: "cancelamento de voo",
  overbooking: "preterição de embarque",
  missed_connection: "perda de conexão",
  downgrade: "rebaixamento de classe",
  baggage_lost: "extravio de bagagem",
  baggage_damaged: "bagagem danificada",
  baggage_delayed: "atraso na entrega da bagagem",
  other: "outro problema com a viagem",
};

const brDate = (value: string | null): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
};

/** What the rule measured of a photo, as the model is told: what it is, never a word of the screen. */
const PROBLEM_FOR_MODEL: Record<PhotoProblem, string> = {
  too_small: "pequena demais para o texto de uma página",
  blurry: "tremida ou sem foco",
  too_dark: "escura",
  too_bright: "clara demais, estourada ou quase em branco",
  flat: "sem contraste entre o texto e o papel",
};

export type CheckBriefingInput = {
  kind: string;
  personName: string | null;
  incident: string | null;
  airline: string | null;
  flightDate: string | null;
  /** What the rule measured of the photo where it arrived, when it measured one. */
  quality?: DocumentQuality | null;
};

/**
 * What the model reads beside the file: what the document is said to be,
 * whose it is, of which trip, and, for a photo the rule measured, what the
 * measure says (its size, how sharp it is and its light: the rule reads no
 * word of it, and the model is told so in its instructions).
 */
export function checkBriefing(input: CheckBriefingInput): string {
  const kind = KIND_FOR_MODEL[input.kind as DocumentKind] ?? KIND_FOR_MODEL.other;
  const trip = [
    INCIDENT_FOR_MODEL[input.incident as Incident] ?? null,
    input.airline ? `companhia ${input.airline}` : null,
    brDate(input.flightDate) ? `voo em ${brDate(input.flightDate)}` : null,
  ].filter(Boolean);
  return [
    `Documento dito: ${kind}.`,
    input.personName
      ? `Pessoa a quem pertence: ${input.personName}.`
      : "Pessoa a quem pertence: não se aplica, é um documento do caso.",
    trip.length > 0 ? `O caso: ${trip.join(", ")}.` : "O caso: sem dados da viagem ainda.",
    ...(input.quality
      ? [
          input.quality.problems.length > 0
            ? [
                `Medida da foto: ${input.quality.problems.map((problem) => PROBLEM_FOR_MODEL[problem]).join("; ")}.`,
                input.quality.insisted ? "O cliente foi avisado disso e enviou a foto assim mesmo." : null,
              ]
                .filter(Boolean)
                .join(" ")
            : "Medida da foto: nada apontado em tamanho, nitidez e luz.",
        ]
      : []),
    "Confira o arquivo anexo e responda com o objeto pedido.",
  ].join("\n");
}

// ---------- The answer ----------

export type CheckLeg = {
  flight: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  booking: string;
};

export type CheckAnswer = {
  decision: "aceitar" | "recusar";
  reason: string;
  identified: string;
  legible: boolean;
  nameOnDocument: string;
  matches: "sim" | "nao" | "sem_nome";
  notes: string;
  legs: CheckLeg[];
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The model's answer (or the one a person approved) as the screens read it; null when it is not one. */
export function readCheckAnswer(output: unknown): CheckAnswer | null {
  if (!isRecord(output)) return null;
  const decision = output.decisao;
  if (decision !== "aceitar" && decision !== "recusar") return null;
  const matches = output.confere_com_a_pessoa;
  return {
    decision,
    reason: text(output.motivo),
    identified: text(output.tipo_identificado),
    legible: output.legivel !== false,
    nameOnDocument: text(output.nome_no_documento),
    matches: matches === "sim" || matches === "nao" ? matches : "sem_nome",
    notes: text(output.observacoes),
    legs: (Array.isArray(output.trechos) ? output.trechos : []).filter(isRecord).map((leg) => ({
      flight: text(leg.voo),
      origin: text(leg.origem).toUpperCase(),
      destination: text(leg.destino).toUpperCase(),
      departure: text(leg.saida_prevista),
      arrival: text(leg.chegada_prevista),
      booking: text(leg.reserva).toUpperCase(),
    })),
  };
}

/**
 * The answer a person approves on the queue: the model's, with the decision
 * they took, the reason they wrote when refusing, and the legs left out when
 * they refuse or choose not to keep them. The same fields as the model gave
 * (the database refuses anything else), so it is measured as a correction
 * exactly when it differs.
 */
export function decidedOutput(
  output: Record<string, unknown>,
  decision: { accept: true; keepLegs: boolean } | { accept: false; reason: string },
): Record<string, unknown> {
  if (decision.accept) {
    return {
      ...output,
      decisao: "aceitar",
      ...(decision.keepLegs || !Array.isArray(output.trechos) ? {} : { trechos: [] }),
    };
  }
  // The legs stay as the model read them: they act only on an accepted ticket, and agreeing with a
  // refusal is not a correction.
  return { ...output, decisao: "recusar", motivo: decision.reason.trim() };
}

/** True when the approved answer says what the model said: the queue sends nothing then, and it counts as right. */
export function sameOutput(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/** "20/09/2026 08:05" from "2026-09-20T08:05", as the ticket prints it; what is not a moment comes back as it was. */
export function localMoment(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : value;
}

/**
 * The failures that may pass by themselves (the provider or the storage did not answer, a run of the
 * same attempt is still going): the document goes back to the line, until the attempts are spent.
 */
const PASSING_FAILURES: readonly string[] = [
  "provider_unavailable",
  "store_unavailable",
  "run_already_closed",
  "check_running",
  "check_failed",
  "file_unreadable",
];

export const isPassingFailure = (code: string): boolean => PASSING_FAILURES.includes(code);

/** What the backend recorded when the processing of a document failed, as words a person reads (`product` namespace). */
const PROCESSING_ERROR_KEYS: Record<string, string> = {
  file_unreadable: "case-document-check-error-file",
  image_unreadable: "case-document-check-error-image",
  provider_not_configured: "case-document-check-error-off",
  backend_not_configured: "case-document-check-error-off",
  no_prompt_version: "case-document-check-error-off",
};

export const processingErrorKey = (code: string | null): string =>
  (code && PROCESSING_ERROR_KEYS[code]) || "case-document-check-error-other";
