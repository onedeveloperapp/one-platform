"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { firstNameOf, waIdCandidates } from "@/lib/cases/cases";
import { queueDocumentProcessing } from "@/lib/cases/documents-work";
import { cpfLookup } from "@/lib/cases/identity";
import { discardUpload, downloadUrl, finishUpload, startUpload } from "@/lib/files/uploads";
import { getMemberContext } from "@/lib/member/context";
import { WHATSAPP_COPY } from "@/lib/messages/whatsapp-copy";
import { sendMessage } from "@/lib/whatsapp/actions";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { queueFlightCheck } from "@/modules/direito-do-passageiro/flights/checks-work";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { InvalidBirthDateError, InvalidCpfError } from "@flyee/identity";

/**
 * What a person of a firm does to its cases, as server actions.
 *
 * No rule is decided here: each action calls the function of migration 0022
 * that takes the case (and through it the firm), checks who is asking,
 * refuses a support visit, writes and records the event. What this file adds
 * is what the database cannot do: mint the token of a client's link (only
 * its hash is stored), send that link over WhatsApp, ask the CPF registry,
 * and turn an answer into a code the screen has words for.
 *
 * A server action is a public endpoint: nothing here trusts an id it is
 * handed; the database re-reads every one under the caller's session.
 */

export type CaseResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

const KNOWN_ERRORS = [
  "not_allowed_in_support_session",
  "not_authorized",
  "case_not_found",
  "second_factor_required",
  "document_already_decided",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

/** Folds the two ways a function answers (a raised error, or `{ ok, code }`) into one result. */
function fold<T extends object>(
  data: unknown,
  error: { message: string } | null,
  pick: (answer: RpcAnswer) => T,
): CaseResult<T> {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

/** Only the plain values a form sends: never a nested object, never a value of another type. */
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
const CASE_FIELDS = [
  "incident",
  "airline_iata",
  "flight_date",
  "origin",
  "summary",
  "responsible_id",
  "cause",
] as const;
const PROCEEDING_FIELDS = [
  "kind",
  "court",
  "comarca",
  "unit",
  "system",
  "cnj",
  "forum_basis",
  "forum_reason",
  "forum_city",
  "status",
  "filed_at",
] as const;

function refresh(caseId?: string) {
  revalidatePath("/casos");
  revalidatePath("/inicio");
  if (caseId) revalidatePath(`/casos/${caseId}`);
}

// ---------- The case ----------

export async function createCase(input: {
  incident: string;
  airline: string | null;
  flightDate: string | null;
  client: Record<string, unknown>;
  origin?: string | null;
  summary?: string | null;
}): Promise<CaseResult<{ caseId: string; seq: number; partyId: string | null }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("create_case", {
    target_org: context.firm.id,
    target_incident: String(input?.incident ?? ""),
    target_airline: input?.airline ? String(input.airline) : null,
    target_flight_date: input?.flightDate ? String(input.flightDate) : null,
    target_client: plainFields(input?.client, PERSON_FIELDS),
    target_origin: input?.origin ? String(input.origin) : null,
    target_summary: input?.summary ? String(input.summary) : null,
  });
  const result = fold(data, error, (answer) => ({
    caseId: String(answer.case_id),
    seq: Number(answer.seq),
    partyId: answer.party_id ? String(answer.party_id) : null,
  }));
  if (result.ok) refresh();
  return result;
}

export async function updateCase(caseId: string, fields: Record<string, unknown>): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("update_case", {
    target_case: caseId,
    target_fields: plainFields(fields, CASE_FIELDS),
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(caseId);
  return result;
}

export async function setCaseStatus(caseId: string, status: string, reason?: string | null): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("set_case_status", {
    target_case: caseId,
    target_status: String(status ?? ""),
    target_reason: reason ? String(reason) : null,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(caseId);
  return result;
}

// ---------- People ----------

export async function saveCasePerson(input: {
  caseId: string;
  personId: string | null;
  fields: Record<string, unknown>;
  role?: "claimant" | "guardian" | null;
  guardianPartyId?: string | null;
}): Promise<CaseResult<{ personId: string; partyId: string | null }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId)) return { ok: false, code: "case_not_found" };
  if (input.personId !== null && !isId(input.personId)) return { ok: false, code: "person_not_found" };
  if (input.guardianPartyId && !isId(input.guardianPartyId)) return { ok: false, code: "person_not_found" };
  const { data, error } = await context.supabase.rpc("save_case_person", {
    target_case: input.caseId,
    target_person: input.personId,
    target_fields: plainFields(input.fields, PERSON_FIELDS),
    target_role: input.role ?? null,
    target_guardian: input.guardianPartyId ?? null,
  });
  const result = fold(data, error, (answer) => ({
    personId: String(answer.person_id),
    partyId: answer.party_id ? String(answer.party_id) : null,
  }));
  if (result.ok) {
    refresh(input.caseId);
    // A person's data may be what ONE waited for to create the lawsuits (0039).
    await queueCaseAdvance(input.caseId);
  }
  return result;
}

export async function removeCaseParty(caseId: string, partyId: string): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(partyId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("remove_case_party", { target_party: partyId });
  const result = fold(data, error, () => ({}));
  if (result.ok && isId(caseId)) refresh(caseId);
  return result;
}

/**
 * Asks the CPF registry about a client: the database says whether this
 * person may (their firm, an adult with a CPF and a birth date, within the
 * daily ceiling), the registry answers for the pair, and the backend records
 * the answer. A refusal of the registry is recorded as what it is.
 */
export async function checkCpf(
  caseId: string,
  personId: string,
): Promise<CaseResult<{ result: string; matches: boolean | null }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(personId)) return { ok: false, code: "not_found" };
  const lookup = cpfLookup();
  if (!lookup) return { ok: false, code: "lookup_not_configured" };

  const { data, error } = await context.supabase.rpc("begin_cpf_check", { target_person: personId });
  const begun = fold(data, error, (answer) => ({
    orgId: String(answer.org_id),
    cpf: String(answer.cpf),
    birthDate: String(answer.birth_date),
  }));
  if (!begun.ok) return begun;

  let result;
  try {
    result = await lookup.lookupCpf(begun.cpf, begun.birthDate);
  } catch (lookupError) {
    if (lookupError instanceof InvalidCpfError) return { ok: false, code: "invalid_cpf" };
    if (lookupError instanceof InvalidBirthDateError) return { ok: false, code: "invalid_birth_date" };
    return { ok: false, code: "lookup_unavailable" };
  }
  if (result.kind === "unavailable") return { ok: false, code: "lookup_unavailable" };

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const found = result.kind === "found" ? result.record : null;
  const { data: recorded, error: recordError } = await service.rpc("record_cpf_check", {
    target_org: begun.orgId,
    target_person: personId,
    target_cpf: begun.cpf,
    target_birth_date: begun.birthDate,
    target_result: result.kind,
    target_name: found?.name ?? null,
    target_situation: found?.situation ?? null,
    target_regular: found?.regular ?? null,
  });
  const done = fold(recorded, recordError, (answer) => ({
    result: String(answer.result ?? result.kind),
    matches: typeof answer.name_matches === "boolean" ? answer.name_matches : null,
  }));
  if (done.ok && isId(caseId)) refresh(caseId);
  return done;
}

// ---------- The trip ----------

export async function saveFlightSegment(
  caseId: string,
  segmentId: string | null,
  fields: Record<string, unknown>,
): Promise<CaseResult<{ segmentId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  if (segmentId !== null && !isId(segmentId)) return { ok: false, code: "segment_not_found" };
  const { data, error } = await context.supabase.rpc("save_flight_segment", {
    target_case: caseId,
    target_segment: segmentId,
    target_fields: plainFields(fields, SEGMENT_FIELDS),
  });
  const result = fold(data, error, (answer) => ({ segmentId: String(answer.segment_id) }));
  if (result.ok) {
    refresh(caseId);
    // The leg owes its check against the official record: done right after instead of at the next sweep.
    await queueFlightCheck();
    await queueCaseAdvance(caseId);
  }
  return result;
}

export async function removeFlightSegment(caseId: string, segmentId: string): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(segmentId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("remove_flight_segment", { target_segment: segmentId });
  const result = fold(data, error, () => ({}));
  if (result.ok && isId(caseId)) refresh(caseId);
  return result;
}

// ---------- Lawsuits ----------

export async function saveProceeding(input: {
  caseId: string;
  proceedingId: string | null;
  fields: Record<string, unknown>;
  parties: string[];
  lawyers: string[];
}): Promise<CaseResult<{ proceedingId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId)) return { ok: false, code: "case_not_found" };
  if (input.proceedingId !== null && !isId(input.proceedingId)) return { ok: false, code: "proceeding_not_found" };
  const parties = (Array.isArray(input.parties) ? input.parties : []).filter(isId);
  const lawyers = (Array.isArray(input.lawyers) ? input.lawyers : []).filter(isId);
  const { data, error } = await context.supabase.rpc("save_proceeding", {
    target_case: input.caseId,
    target_proceeding: input.proceedingId,
    target_fields: plainFields(input.fields, PROCEEDING_FIELDS),
    target_parties: parties,
    target_lawyers: lawyers,
  });
  const result = fold(data, error, (answer) => ({ proceedingId: String(answer.proceeding_id) }));
  if (result.ok) {
    refresh(input.caseId);
    // Who signs it, its court's system: ONE may now ask for its piece or its package (0039).
    await queueCaseAdvance(input.caseId);
  }
  return result;
}

/**
 * The firm's word on the court system ONE named for a planned lawsuit (migration 0066): approved, as the decision
 * of who approves it, or not approved, with the reason the platform reads to check the court's acts.
 */
export async function decideCourtSystem(input: {
  caseId: string;
  proceedingId: string;
  approve: boolean;
  reason?: string | null;
}): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.proceedingId)) {
    return { ok: false, code: "proceeding_not_found" };
  }
  const approve = input.approve === true;
  const { data, error } = await context.supabase.rpc("decide_court_system", {
    target_proceeding: input.proceedingId,
    target_approve: approve,
    target_reason: approve ? null : typeof input.reason === "string" ? input.reason.slice(0, 600) : null,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(input.caseId);
    // Approved, ONE may now ask for the lawsuit's package (0039).
    await queueCaseAdvance(input.caseId);
  }
  return result;
}

export async function removeProceeding(caseId: string, proceedingId: string): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(proceedingId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("remove_proceeding", { target_proceeding: proceedingId });
  const result = fold(data, error, () => ({}));
  if (result.ok && isId(caseId)) refresh(caseId);
  return result;
}

// ---------- The client's link ----------

/**
 * Gives a client their link. The token is minted here and shown once on the
 * case: `client_links` keeps only its SHA-256, so a lost link is replaced,
 * never read back. Sent over WhatsApp when asked and the client wrote to the
 * firm in the last 24 hours (outside them, the firm writes with an approved
 * template); a link sent that way stays in the conversation like any message
 * the firm sent, which is why it ends by itself, ends when the person leaves
 * the case, and can be ended by the firm at any time.
 */
export type LinkDelivery =
  | "sent"
  | "queued"
  | "unconfirmed"
  | "not_sent"
  | "window_closed"
  | "opted_out"
  | "no_conversation";

export async function createClientLink(input: {
  caseId: string;
  personId: string;
  sendOnWhatsApp: boolean;
}): Promise<CaseResult<{ url: string; whatsapp: LinkDelivery | null }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.personId)) return { ok: false, code: "case_not_found" };

  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data, error } = await context.supabase.rpc("create_client_link", {
    target_case: input.caseId,
    target_person: input.personId,
    target_token_hash: hash,
  });
  const created = fold(data, error, () => ({}));
  if (!created.ok) return created;

  const url = `${BRAND.siteUrl}/c/${token}`;
  let whatsapp: LinkDelivery | null = null;

  if (input.sendOnWhatsApp) {
    whatsapp = "no_conversation";
    const { data: person } = await context.supabase
      .from("people")
      .select("full_name, phone")
      .eq("id", input.personId)
      .eq("org_id", context.firm.id)
      .maybeSingle();
    const candidates = waIdCandidates((person?.phone as string | null) ?? "");
    if (candidates.length > 0) {
      // The latest conversation of the firm with that number, on a number of the firm still connected.
      const { data: conversation } = await context.supabase
        .from("wa_conversations")
        .select("id, wa_numbers!inner(status)")
        .eq("org_id", context.firm.id)
        .in("contact_wa_id", candidates)
        .eq("wa_numbers.status", "active")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (conversation?.id) {
        const sent = await sendMessage({
          conversationId: conversation.id as string,
          kind: "text",
          body: WHATSAPP_COPY["pt-BR"].clientLink({
            firstName: firstNameOf(person?.full_name as string | null),
            firm: context.firm.name,
            url,
          }),
        });
        const known: LinkDelivery[] = ["sent", "queued", "unconfirmed", "window_closed", "opted_out"];
        whatsapp = known.includes(sent.code as LinkDelivery) ? (sent.code as LinkDelivery) : "not_sent";
      }
    }
  }

  refresh(input.caseId);
  return { ok: true, code: "created", url, whatsapp };
}

export async function revokeClientLink(caseId: string, linkId: string): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(linkId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("revoke_client_link", { target_link: linkId });
  const result = fold(data, error, () => ({}));
  if (result.ok && isId(caseId)) refresh(caseId);
  return result;
}

// ---------- Documents ----------

export async function decideCaseDocument(
  caseId: string,
  documentId: string,
  decision: "accepted" | "rejected",
  reason?: string | null,
): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(documentId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("decide_case_document", {
    target_document: documentId,
    target_decision: decision === "accepted" ? "accepted" : "rejected",
    target_reason: reason ? String(reason) : null,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok && isId(caseId)) {
    refresh(caseId);
    // The last paper ONE waited for may be this one (0039).
    await queueCaseAdvance(caseId);
  }
  return result;
}

/** The first half of a file the firm adds to a case: the reservation and the address to send the bytes to. */
export async function startCaseUpload(input: {
  name: string;
  mime: string;
  bytes: number;
}): Promise<CaseResult<{ fileId: string; storagePath: string; uploadToken: string }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const started = await startUpload(context, {
    purpose: "upload",
    name: String(input?.name ?? ""),
    mime: String(input?.mime ?? ""),
    bytes: Number(input?.bytes ?? 0),
  });
  if (!started.ok) return { ok: false, code: started.code };
  return {
    ok: true,
    code: "reserved",
    fileId: started.fileId,
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
  };
}

/** The second half: the backend measures what arrived and the file joins the case as a document of its kind. */
export async function finishCaseUpload(input: {
  caseId: string;
  fileId: string;
  kind: string;
  partyId: string | null;
}): Promise<CaseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.fileId)) return { ok: false, code: "not_found" };
  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };
  const { data, error } = await context.supabase.rpc("attach_case_document", {
    target_case: input.caseId,
    target_file: input.fileId,
    target_kind: String(input.kind ?? ""),
    target_party: input.partyId && isId(input.partyId) ? input.partyId : null,
    target_source: "firm",
  });
  const result = fold(data, error, (answer) => ({ documentId: String(answer.document_id ?? "") }));
  if (result.ok) {
    refresh(input.caseId);
    if (isId(result.documentId)) await queueDocumentProcessing(result.documentId);
  }
  // A file this request has just measured and that found no place in the case is taken back,
  // never left where nobody sees it. A file that was already kept is somebody else's to decide.
  else if (finished.measured && !(await isSupportVisit())) await discardUpload(context, input.fileId);
  return result;
}

/** A link of a minute to a file of the case, for somebody of the same firm. */
export async function openCaseFile(fileId: string): Promise<{ ok: true; url: string } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(fileId)) return { ok: false, code: "not_found" };
  const link = await downloadUrl(context, fileId);
  return link.ok ? { ok: true, url: link.url } : { ok: false, code: link.code };
}
