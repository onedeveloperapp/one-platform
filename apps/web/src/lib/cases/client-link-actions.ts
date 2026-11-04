"use server";

import { headers } from "next/headers";
import { createHash } from "node:crypto";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { isTokenShape } from "@/lib/cases/client-link";
import { finishLinkUpload, takeBackClientUpload } from "@/lib/cases/client-uploads";
import { readLinkUpload } from "@/lib/cases/document-prefill-work";
import { queueDocumentProcessing } from "@/lib/cases/documents-work";
import { queueStatementWork } from "@/lib/cases/statements-work";
import { FIRM_FILES_BUCKET, supabaseFileStore } from "@/lib/files/store";
import { settleNotices } from "@/lib/notices/work";
import { createAnonClient } from "@/lib/public-content";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { queueFlightCheck } from "@/modules/direito-do-passageiro/flights/checks-work";
import { createServiceClient } from "@flyee/auth/service";
import { measureFile } from "@flyee/documents/measure";

/**
 * What a client does through their link, as server actions. The token is the
 * only credential: each action hands it to a `client_link_*` function of
 * migration 0022, which finds the link by its hash, checks that it is open
 * and that its case still takes what the client sends, and writes. The
 * anonymous client is used on purpose, so what the client does is recorded
 * as the client's whoever's browser it is; a support visit writes nothing.
 *
 * Files go from the browser straight to storage: the reservation is the
 * database's, the signed address and the measuring are the backend's, as for
 * a person of the firm (lib/files/uploads.ts).
 */

export type ClientResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | {
      ok: false;
      code: string;
      field?: string | null;
      /** For a photo hard to read (`photo_poor`): what keeps it from being read. */
      problems?: readonly string[];
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

/** Folds a function's answer (`{ ok, code, field }`) into a result. Every call names its function as a literal, for `check:db-refs`. */
function fold<T extends object>(
  reply: { data: unknown; error: { message: string } | null },
  pick: (answer: RpcAnswer) => T,
): ClientResult<T> {
  if (reply.error) return { ok: false, code: "failed" };
  const answer = (reply.data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

const nothing = () => ({});
const unavailable = { ok: false as const, code: "unavailable" };

/** Only the plain values a form sends. */
function plainFields(input: unknown, allowed: readonly string[]): Record<string, string | boolean | null> {
  const fields: Record<string, string | boolean | null> = {};
  if (typeof input !== "object" || input === null) return fields;
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "boolean") fields[key] = value;
  }
  return fields;
}

const PERSON_FIELDS = [
  "full_name",
  "cpf",
  "birth_date",
  "nationality",
  "marital_status",
  "profession",
  "email",
  "phone",
  "postal_code",
  "street",
  "address_number",
  "complement",
  "district",
  "city",
  "uf",
] as const;
const SEGMENT_FIELDS = [
  "flight_number",
  "origin_iata",
  "destination_iata",
  "scheduled_departure_local",
  "scheduled_arrival_local",
  "actual_departure_local",
  "actual_arrival_local",
  "booking_reference",
  "affected",
] as const;

const refused = { ok: false as const, code: "link_not_open" };

/**
 * Why a write through a link is refused before the database is asked: a token
 * of the wrong shape, or a support visit. A support visit does nothing in the
 * firm's name, and a link is the client's voice: whoever is visiting a firm
 * may read a link they find in a conversation, never write through it.
 */
async function refusal(token: unknown): Promise<{ ok: false; code: string } | null> {
  if (!isTokenShape(String(token ?? ""))) return refused;
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  return null;
}

export async function saveClientPerson(
  token: string,
  personId: string,
  fields: Record<string, unknown>,
): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(personId)) return { ok: false, code: "person_not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  return fold(
    await supabase.rpc("client_link_save_person", {
      target_token: token,
      target_person: personId,
      target_fields: plainFields(fields, PERSON_FIELDS),
    }),
    nothing,
  );
}

export async function addClientDependent(
  token: string,
  fields: Record<string, unknown>,
): Promise<ClientResult<{ partyId: string | null }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  return fold(
    await supabase.rpc("client_link_add_dependent", {
      target_token: token,
      target_fields: plainFields(fields, PERSON_FIELDS),
    }),
    (answer) => ({ partyId: isId(answer.party_id) ? answer.party_id : null }),
  );
}

/**
 * ONE reads the document of a child the client sends before the child is in the case (migration 0085): an
 * identity this link reserved for nobody yet and is still sending, within the link's reads of the day. The answer
 * comes back for the client to confirm the child's data; nothing is written here.
 */
export async function readClientChildDocument(
  token: string,
  documentId: string,
): Promise<ClientResult<{ output: Record<string, unknown> }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(documentId)) return { ok: false, code: "not_found" };
  const backend = service();
  if (!backend) return unavailable;
  const { data, error } = await backend.rpc("client_link_prefill_to_read", {
    target_token: token,
    target_document: documentId,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok || typeof answer.org_id !== "string" || typeof answer.storage_path !== "string") {
    return { ok: false, code: String(answer.code ?? "failed") };
  }
  const read = await readLinkUpload(backend, {
    orgId: answer.org_id,
    documentId,
    storagePath: answer.storage_path,
  });
  return read.ok ? { ok: true, code: "read", output: read.output } : { ok: false, code: read.code };
}

/** The child's document, read before the child was in the case, becomes the child's, to be sent as any upload. */
export async function assignClientUpload(token: string, documentId: string, partyId: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(documentId) || !isId(partyId)) return { ok: false, code: "not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  return fold(
    await supabase.rpc("client_link_assign_upload", {
      target_token: token,
      target_document: documentId,
      target_party: partyId,
    }),
    nothing,
  );
}

export async function saveClientSegment(
  token: string,
  segmentId: string | null,
  fields: Record<string, unknown>,
): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (segmentId !== null && !isId(segmentId)) return { ok: false, code: "segment_not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const saved = fold(
    await supabase.rpc("client_link_save_segment", {
      target_token: token,
      target_segment: segmentId,
      target_fields: plainFields(fields, SEGMENT_FIELDS),
    }),
    nothing,
  );
  // The leg the client wrote owes its check against the official record: done now, not at the next sweep.
  if (saved.ok) await queueFlightCheck(null);
  return saved;
}

export async function removeClientSegment(token: string, segmentId: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(segmentId)) return { ok: false, code: "segment_not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  return fold(
    await supabase.rpc("client_link_remove_segment", { target_token: token, target_segment: segmentId }),
    nothing,
  );
}

export async function finishClientLink(token: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const result = fold(await supabase.rpc("client_link_finish", { target_token: token }), nothing);
  // The case the client finished woke in the database (0054): ONE looks at it now, sends the papers they sign and
  // tells them what comes next (0055). Named, so that with no jobs it is looked at right after the response.
  if (result.ok) {
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    const backend = service();
    const link = backend
      ? (await backend.from("client_links").select("case_id").eq("token_hash", hash).maybeSingle()).data
      : null;
    await queueCaseAdvance(typeof link?.case_id === "string" ? link.case_id : null);
  }
  return result;
}

function service() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/** The first half of sending a file: the reservation, and the signed address the browser sends the bytes to. */
export async function startClientUpload(
  token: string,
  input: { kind: string; partyId: string | null; name: string; mime: string; bytes: number },
): Promise<ClientResult<{ documentId: string; storagePath: string; uploadToken: string }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  const reserved = fold(
    await supabase.rpc("client_link_reserve_upload", {
      target_token: token,
      target_kind: String(input?.kind ?? ""),
      target_party: input?.partyId && isId(input.partyId) ? input.partyId : null,
      target_name: String(input?.name ?? "").slice(0, 200),
      target_mime: String(input?.mime ?? ""),
      target_bytes: Math.trunc(Number(input?.bytes ?? 0)),
    }),
    (answer) => ({ documentId: String(answer.document_id), storagePath: String(answer.storage_path) }),
  );
  if (!reserved.ok) return reserved;

  const { data: signed, error } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(reserved.storagePath);
  // The reservation stays: it expires by itself and the upkeep removes it.
  if (error || !signed) return { ok: false, code: "storage_unavailable" };
  return {
    ok: true,
    code: "reserved",
    documentId: reserved.documentId,
    storagePath: reserved.storagePath,
    uploadToken: signed.token,
  };
}

/**
 * The second half: the backend measures what arrived, keeps it or refuses it,
 * and the firm receives it, or the client is told why not (`finishLinkUpload`).
 * The photo of a paper to be read that is hard to read is answered
 * `photo_poor`, with what is wrong with it: the client takes another, or
 * sends this one all the same (`insist`).
 */
export async function finishClientUpload(
  token: string,
  documentId: string,
  options?: { insist?: boolean },
): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(documentId)) return { ok: false, code: "not_found" };
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  let result: ClientResult;
  try {
    result = await finishLinkUpload(supabase, backend, token, documentId, { insist: options?.insist === true });
  } catch {
    // What nobody foresaw (a file no measure could be taken of): nothing was decided, and the client may try again.
    return { ok: false, code: "failed" };
  }
  if (result.ok) await queueDocumentProcessing(documentId);
  return result;
}

/**
 * The client took another photo instead of the one they were told is hard to
 * read: the one that waited is taken back at once, its record first, so that
 * nothing of it stays in storage until its reservation runs out. Only an
 * upload of this very link that was never sent (the database checks both).
 */
export async function discardClientUpload(token: string, documentId: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(documentId)) return { ok: false, code: "not_found" };
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  return takeBackClientUpload(supabase, backend, token, documentId);
}

// ---------- Signatures and acceptances (migration 0023) ----------

/** A link of a minute to the PDF the client signs at gov.br. */
export async function downloadSignatureOriginal(
  token: string,
  envelopeId: string,
): Promise<ClientResult<{ url: string }>> {
  if (!isTokenShape(String(token ?? ""))) return refused;
  if (!isId(envelopeId)) return { ok: false, code: "not_found" };
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  const found = fold(
    await supabase.rpc("client_link_signature_original", { target_token: token, target_envelope: envelopeId }),
    (answer) => ({ storagePath: String(answer.storage_path), name: String(answer.name ?? "documento.pdf") }),
  );
  if (!found.ok) return found;
  const { data: signed, error } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUrl(found.storagePath, 60, { download: found.name });
  if (error || !signed) return { ok: false, code: "storage_unavailable" };
  return { ok: true, code: "ready", url: signed.signedUrl };
}

/** The first half of sending back the PDF signed at gov.br; the second is `finishClientUpload`. */
export async function startClientSignedUpload(
  token: string,
  input: { envelopeId: string; name: string; mime: string; bytes: number },
): Promise<ClientResult<{ documentId: string; storagePath: string; uploadToken: string }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(input?.envelopeId)) return { ok: false, code: "not_found" };
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  const reserved = fold(
    await supabase.rpc("client_link_reserve_signed", {
      target_token: token,
      target_envelope: input.envelopeId,
      target_name: String(input?.name ?? "").slice(0, 200),
      target_mime: String(input?.mime ?? ""),
      target_bytes: Math.trunc(Number(input?.bytes ?? 0)),
    }),
    (answer) => ({ documentId: String(answer.document_id), storagePath: String(answer.storage_path) }),
  );
  if (!reserved.ok) return reserved;
  const { data: signed, error } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(reserved.storagePath);
  if (error || !signed) return { ok: false, code: "storage_unavailable" };
  return {
    ok: true,
    code: "reserved",
    documentId: reserved.documentId,
    storagePath: reserved.storagePath,
    uploadToken: signed.token,
  };
}

/**
 * The client accepts the texts they read, by their ids. The backend records
 * it (the database takes it from the service role only), with what the server
 * saw of the request as the evidence: never something the client typed.
 */
export async function acceptClientTerms(token: string, termIds: string[]): Promise<ClientResult<{ added: number }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  const ids = (Array.isArray(termIds) ? termIds : []).filter(isId).slice(0, 20);
  if (ids.length === 0) return { ok: false, code: "terms_required" };
  const backend = service();
  if (!backend) return unavailable;
  const seen = await headers();
  const evidence = {
    user_agent: (seen.get("user-agent") ?? "").slice(0, 300),
    ip: (seen.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) ?? "",
  };
  return fold(
    await backend.rpc("client_link_accept_terms", {
      target_token: token,
      target_terms: ids,
      target_evidence: evidence,
    }),
    (answer) => ({ added: Number(answer.added ?? 0) }),
  );
}

// ---------- The notices on WhatsApp (migration 0038) ----------

/**
 * The client stops the notices of their lawsuit on WhatsApp (`receive`
 * false), or asks to be told again (true). Nobody is asked to agree (0088):
 * the notices go unless the client stopped them. The backend records it (the
 * database takes it from the service role only), with what the server saw of
 * the request as the evidence.
 */
export async function setClientNotices(token: string, receive: boolean): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (typeof receive !== "boolean") return { ok: false, code: "failed" };
  const backend = service();
  if (!backend) return unavailable;
  const seen = await headers();
  const evidence = {
    user_agent: (seen.get("user-agent") ?? "").slice(0, 300),
    ip: (seen.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) ?? "",
  };
  const result = fold(
    await backend.rpc("client_link_set_notices", {
      target_token: token,
      target_agree: receive,
      target_wording: null,
      target_evidence: evidence,
    }),
    nothing,
  );
  // Only being told again may make something due: an answer that changed nothing asks for nothing.
  if (result.ok && result.code === "resumed") await settleNotices();
  return result;
}

// ---------- The civil court (migration 0025) ----------

/**
 * The client says whether they accept that a claim (their own, or a minor's
 * they answer for) goes to the civil court, in the very words the page
 * showed (`wording`: when they changed since, nothing is recorded and the
 * page reads again). The backend records it (the database takes it from the
 * service role only), with what the server saw of the request as the evidence.
 */
export async function answerCivilCourt(
  token: string,
  partyId: string,
  accepted: boolean,
  wording: string,
): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(partyId) || typeof accepted !== "boolean" || typeof wording !== "string")
    return { ok: false, code: "failed" };
  const backend = service();
  if (!backend) return unavailable;
  const seen = await headers();
  const evidence = {
    user_agent: (seen.get("user-agent") ?? "").slice(0, 300),
    ip: (seen.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) ?? "",
  };
  const result = fold(
    await backend.rpc("client_link_answer_civil_court", {
      target_token: token,
      target_party: partyId,
      target_accepted: accepted,
      target_wording: wording.slice(0, 2200),
      target_evidence: evidence,
    }),
    nothing,
  );
  // A yes may be what the filing package of the lawsuit waited for (0039): the cases it woke are looked at now.
  if (result.ok && accepted) await queueCaseAdvance(null);
  return result;
}

// ---------- The client's account of what happened (migration 0026) ----------

/** The client writes what happened, in their own words. */
export async function writeClientStatement(token: string, text: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const result = fold(
    await supabase.rpc("client_link_write_statement", {
      target_token: token,
      target_text: String(text ?? "").slice(0, 20000),
    }),
    (answer) => ({ statementId: String(answer.statement_id ?? "") }),
  );
  if (!result.ok) return result;
  if (isId(result.statementId)) await queueStatementWork(result.statementId);
  return { ok: true, code: result.code };
}

/** The first half of sending an audio of the account: the reservation, and the signed address for its bytes. */
export async function startClientStatement(
  token: string,
  input: { name: string; mime: string; bytes: number },
): Promise<ClientResult<{ statementId: string; storagePath: string; uploadToken: string }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  const reserved = fold(
    await supabase.rpc("client_link_reserve_statement", {
      target_token: token,
      target_name: String(input?.name ?? "").slice(0, 200),
      target_mime: String(input?.mime ?? ""),
      target_bytes: Math.trunc(Number(input?.bytes ?? 0)),
    }),
    (answer) => ({ statementId: String(answer.statement_id), storagePath: String(answer.storage_path) }),
  );
  if (!reserved.ok) return reserved;
  const { data: signed, error } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(reserved.storagePath);
  // The reservation stays: it expires by itself, and the sweep drops the statement that waited for it.
  if (error || !signed) return { ok: false, code: "storage_unavailable" };
  return {
    ok: true,
    code: "reserved",
    statementId: reserved.statementId,
    storagePath: reserved.storagePath,
    uploadToken: signed.token,
  };
}

/**
 * The second half: the backend measures the audio that arrived (only one this
 * link reserved and has not sent yet), keeps it or refuses it, and the
 * database turns it into a statement to transcribe, or tells the client why
 * not.
 */
export async function finishClientStatement(token: string, statementId: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(statementId)) return { ok: false, code: "not_found" };
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;

  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data: link } = await backend.from("client_links").select("id").eq("token_hash", hash).maybeSingle();
  if (!link) return refused;
  const { data: statement } = await backend
    .from("case_statements")
    .select("id, status, audio_file_id")
    .eq("id", statementId)
    .eq("link_id", link.id as string)
    .maybeSingle();
  if (!statement) return { ok: false, code: "not_found" };

  if (statement.status === "uploading" && statement.audio_file_id) {
    const { data: file } = await backend
      .from("files")
      .select("id, storage_path, status")
      .eq("id", statement.audio_file_id as string)
      .maybeSingle();
    if (file?.status === "reserved") {
      const store = supabaseFileStore(backend);
      const bytes = await store.get(file.storage_path as string);
      if (!bytes) return { ok: false, code: "not_uploaded" };
      const confirmed = await store.confirm(file.id as string, await measureFile(bytes));
      // What was refused does not stay in the bucket.
      if (!confirmed.ok) await store.remove([file.storage_path as string]).catch(() => undefined);
    }
  }

  const result = fold(
    await supabase.rpc("client_link_finish_statement", { target_token: token, target_statement: statementId }),
    nothing,
  );
  if (result.ok) await queueStatementWork(statementId);
  return result;
}

/**
 * The client confirms the chronology the firm approved, or says what is wrong in it. What they say is wrong is
 * ordered again by ONE at once, within the setting's rounds (0090): the work starts now.
 */
export async function answerClientChronology(
  token: string,
  statementId: string,
  agrees: boolean,
  note: string | null,
): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(statementId)) return { ok: false, code: "not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const result = fold(
    await supabase.rpc("client_link_answer_chronology", {
      target_token: token,
      target_statement: statementId,
      target_agrees: agrees === true,
      target_note: agrees === true ? null : String(note ?? "").slice(0, 2000),
    }),
    (answer) => ({ reordering: answer.reordering === true }),
  );
  if (result.ok && result.reordering) await queueStatementWork(statementId);
  return result;
}

/**
 * The client answers, on their link, what the order of the facts says is missing of their account (0090): the
 * answers join the account, and ONE orders it again at once.
 */
export async function completeClientStatement(token: string, statementId: string, text: string): Promise<ClientResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(statementId) || typeof text !== "string") return { ok: false, code: "not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const result = fold(
    await supabase.rpc("client_link_complete_statement", {
      target_token: token,
      target_statement: statementId,
      target_text: text.slice(0, 4000),
    }),
    nothing,
  );
  if (result.ok) await queueStatementWork(statementId);
  return result;
}
