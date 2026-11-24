import { STOPS_ASKED } from "@/lib/filing-ways/batches";

/**
 * What ONE's browser waits for, told to the lawyer of the batch (migration 0284, the owner, 2026-11-24): the court
 * asked their code, ONE holds the first filing at a system it still learns for their word, or ONE stopped the batch
 * for a reason not a person's own. Each is told the moment the browser stops, on the bell and on their WhatsApp as the
 * firm's template `filing_batch_waits`, with the way to /protocolo; the court's code is never asked there, only in
 * ONE. Pure: what is told, and its words.
 */

export type BatchStopKind = "code" | "confirm" | "stopped";

/** How long ONE's browser waits for the code the lawyer types in ONE: the worker's wait and the notice's words. */
export const CODE_WAIT_MINUTES = 5;

/** A stop the lawyer is told of: every stop of ONE's browser but one a person of the firm asked, who knows why. */
export const toldStop = (why: string | null | undefined): boolean =>
  Boolean(why) && !(STOPS_ASKED as readonly string[]).includes(why ?? "");

/** What the template says the protocol needs of the lawyer, after "precisa de você:". */
const WHAT: Record<"code_app" | "code_email" | "confirm" | "stopped", string> = {
  code_app: "o tribunal pediu o código do seu aplicativo",
  code_email: "o tribunal mandou um código ao seu e-mail",
  confirm: "o ONE parou antes do primeiro envio e espera a sua confirmação",
  stopped: "o lote parou, e o motivo e o que fazer estão em Protocolo",
};

/** The values of the template `filing_batch_waits`: the lawyer's first name, the court's system, what it needs. */
export function batchStopParams(input: {
  name: string;
  systemName: string;
  kind: BatchStopKind;
  codeKind?: "app" | "email";
}): string[] {
  const first = input.name.trim().split(/\s+/)[0] || "equipe";
  const what = input.kind === "code" ? WHAT[input.codeKind === "email" ? "code_email" : "code_app"] : WHAT[input.kind];
  return [first, input.systemName, what];
}

/** The bell's key of a stop: once per batch, kind and stop, so a stop told twice rings once. */
export const batchStopKey = (batchId: string, kind: BatchStopKind, subject: string): string =>
  `filing-batch:${batchId}:${kind}:${subject}`;
