"use server";

import { headers } from "next/headers";

import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import { createAnonClient } from "@/lib/public-content";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { type AgreementView, isAgreementToken } from "@/modules/direito-do-passageiro/agency/agreement";
import { openAgreement } from "@/modules/direito-do-passageiro/agency/link";
import { PAX_DOCUMENT_KINDS } from "@/modules/direito-do-passageiro/agency/passengers";
import { removeForgottenBytes } from "@/modules/direito-do-passageiro/agency/retention-work";
import { finishPaxUpload } from "@/modules/direito-do-passageiro/agency/uploads";
import { createServiceClient } from "@flyee/auth/service";

/**
 * What a passenger does on the link of a travel agency (migration 0070), as server actions. The token is the only
 * credential: each action hands it to a `pax_link_*` function, which finds the link by its hash, checks that it
 * is open and that its partnership goes on, and writes. The anonymous client is used on purpose, so what the
 * passenger does is recorded as theirs whoever's browser it is; a support visit writes nothing through a link.
 */

export type LinkResult<T extends object = object> = ({ ok: true; code: string } & T) | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const unavailable = { ok: false as const, code: "unavailable" };

/** Why a write through the link is refused before the database is asked: a token of the wrong shape, or a support visit. */
async function refusal(token: unknown): Promise<{ ok: false; code: string } | null> {
  if (!isAgreementToken(String(token ?? ""))) return { ok: false, code: "link_not_found" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  return null;
}

function service() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/** The page read again: after an answer, and while a document is being read. */
export async function readAgreement(token: string): Promise<LinkResult<{ view: AgreementView }>> {
  const view = await openAgreement(String(token ?? ""));
  return view ? { ok: true, code: "read", view } : unavailable;
}

/**
 * The passenger's answer, in the very words the page showed them, with what the server saw of the request as the
 * evidence: never something the passenger typed. An agreement of a passenger the agency has no WhatsApp for
 * carries the one they write here.
 */
export async function answerAgreement(input: {
  token: string;
  answer: "agreed" | "declined" | "withdrawn";
  wording: string;
  phone: string | null;
}): Promise<LinkResult<{ followed: number }>> {
  const closed = await refusal(input?.token);
  if (closed) return closed;
  if (!["agreed", "declined", "withdrawn"].includes(input?.answer)) return { ok: false, code: "invalid_answer" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const seen = await headers();
  const evidence = {
    user_agent: (seen.get("user-agent") ?? "").slice(0, 300),
    ip: (seen.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) ?? "",
  };
  const { data, error } = await supabase.rpc("pax_link_answer", {
    target_token: input.token,
    target_answer: input.answer,
    target_wording: String(input.wording ?? "").slice(0, 5000),
    target_evidence: evidence,
    target_phone: input.phone ? String(input.phone).slice(0, 30) : null,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; followed?: number };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  return {
    ok: true,
    code: String(answer.code ?? input.answer),
    followed: Math.max(0, Number(answer.followed ?? 0) || 0),
  };
}

/** The first half of sending a document on the link: the reservation, and the signed address the bytes go to. */
export async function startAgreementUpload(
  token: string,
  input: { travelerId: string; kind: string; tripId: string | null; name: string; mime: string; bytes: number },
): Promise<LinkResult<{ fileId: string; storagePath: string; uploadToken: string }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  if (!isId(input?.travelerId) || !(PAX_DOCUMENT_KINDS as readonly string[]).includes(input?.kind)) {
    return { ok: false, code: "invalid_kind" };
  }
  const backend = service();
  const supabase = createAnonClient();
  if (!backend || !supabase) return unavailable;
  const { data, error } = await supabase.rpc("pax_link_reserve_upload", {
    target_token: token,
    target_traveler: input.travelerId,
    target_kind: input.kind,
    target_trip: isId(input.tripId) ? input.tripId : null,
    target_name: String(input.name ?? "").slice(0, 200),
    target_mime: String(input.mime ?? ""),
    target_bytes: Math.trunc(Number(input.bytes ?? 0)),
  });
  if (error) return { ok: false, code: "failed" };
  const reserved = (data ?? {}) as { ok?: boolean; code?: string; file_id?: string; storage_path?: string };
  if (!reserved.ok || !reserved.file_id || !reserved.storage_path) {
    return { ok: false, code: String(reserved.code ?? "failed") };
  }
  const { data: signed, error: signError } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(reserved.storage_path);
  // The reservation stays: it expires by itself and the upkeep removes it.
  if (signError || !signed) return { ok: false, code: "storage_unavailable" };
  return {
    ok: true,
    code: "reserved",
    fileId: reserved.file_id,
    storagePath: reserved.storage_path,
    uploadToken: signed.token,
  };
}

/** The second half: the backend measures what arrived, and the AI reads what was kept. */
export async function finishAgreementUpload(token: string, fileId: string): Promise<LinkResult> {
  const closed = await refusal(token);
  if (closed) return closed;
  const backend = service();
  if (!backend) return unavailable;
  if (!isId(fileId)) return { ok: false, code: "not_found" };
  const finished = await finishPaxUpload(backend, fileId, { token });
  return finished.ok ? { ok: true, code: finished.code } : finished;
}

/** What is kept of the passenger and of the children they answer for, for them to take (their right of access). */
export async function exportAgreement(token: string): Promise<LinkResult<{ data: unknown }>> {
  if (!isAgreementToken(String(token ?? ""))) return { ok: false, code: "link_not_found" };
  const supabase = createAnonClient();
  if (!supabase) return unavailable;
  const { data, error } = await supabase.rpc("pax_link_export", { target_token: token });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; data?: unknown };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  return { ok: true, code: "exported", data: answer.data ?? [] };
}

/**
 * The passenger deletes what is kept of them and of the children they answer for: the backend asks the database
 * by the token (with what the server saw of the request), then removes the bytes of their files.
 */
export async function forgetAgreement(token: string): Promise<LinkResult<{ people: number }>> {
  const closed = await refusal(token);
  if (closed) return closed;
  const backend = service();
  if (!backend) return unavailable;
  const seen = await headers();
  const evidence = {
    user_agent: (seen.get("user-agent") ?? "").slice(0, 300),
    ip: (seen.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 64) ?? "",
  };
  const { data, error } = await backend.rpc("pax_link_forget", { target_token: token, target_evidence: evidence });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; people?: number };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  await removeForgottenBytes(backend).catch(() => undefined);
  return { ok: true, code: "forgotten", people: Math.max(0, Number(answer.people ?? 0) || 0) };
}
