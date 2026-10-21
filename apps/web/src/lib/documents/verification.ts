/**
 * What the public verification of a document says (`verify_document`,
 * migration 0018), and the pure rules of the page that shows it. The answer
 * never carries the title or the content of a document: only who issued it,
 * what kind it is, which version, when, and the hash of its bytes.
 */

export type VerificationAnswer = {
  found?: boolean;
  status?: "issued" | "revoked";
  kind?: string;
  version?: number;
  issuedAt?: string | null;
  revokedAt?: string | null;
  contentHash?: string | null;
  firm?: string | null;
  replacedByVersion?: number | null;
};

/**
 * `valid`: issued and the latest. `replaced`: issued, and a newer version
 * exists. `revoked`: the firm withdrew it. `missing`: no such code.
 */
export type VerificationOutcome = "valid" | "replaced" | "revoked" | "missing";

export function verificationOutcome(answer: VerificationAnswer | null | undefined): VerificationOutcome {
  if (!answer?.found || !answer.firm) return "missing";
  if (answer.status === "revoked") return "revoked";
  if (answer.status !== "issued") return "missing";
  return typeof answer.replacedByVersion === "number" ? "replaced" : "valid";
}

/** The words of each kind of document ONE issues (`product` namespace). A kind with no words yet reads as a document. */
const KIND_LABEL_KEY: Record<string, string> = {
  procuracao: "verify-kind-procuracao",
  contrato: "verify-kind-contrato",
  peca: "verify-kind-peca",
  dossie: "verify-kind-dossie",
  pacote_protocolo: "verify-kind-pacote",
  declaracao_residencia: "verify-kind-declaracao",
};

export const kindLabelKey = (kind: string | null | undefined): string =>
  KIND_LABEL_KEY[kind ?? ""] ?? "verify-kind-other";

/** A day as a person reads it, "8 de outubro de 2026", on Brasília's calendar. */
export function dayLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

/** SHA-256 of a file, in hex, computed where the file is: in the browser, the file is never sent anywhere. */
export async function sha256OfFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
