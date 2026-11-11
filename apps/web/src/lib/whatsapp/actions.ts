"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { discardUpload, downloadUrl, finishUpload, startUpload } from "@/lib/files/uploads";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { readWhatsAppSettings } from "@/lib/whatsapp/config";
import {
  connectMetaNumber,
  type ConnectResult,
  connectSimulatedNumber,
  disconnectWhatsApp,
  finishMetaRegistration,
  syncAccountTemplates,
} from "@/lib/whatsapp/connect";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { simulateDisconnection, simulateEcho, simulateInbound, type SimulationResult } from "@/lib/whatsapp/simulate";
import { createServiceClient } from "@flyee/auth/service";

/**
 * What a person of a firm does with its WhatsApp, as server actions.
 *
 * No rule is decided here. What may be sent is the database's
 * (`reserve_wa_send`, migration 0019: the window, the approved template, the
 * opt-out, never from a support visit); who may connect or cut a number is
 * the database's too (`begin_connection`, `disconnect_connection`). These
 * actions carry the request, run the backend's half (sending what was
 * reserved, sealing a token) and turn the answer into a code the screen has
 * words for.
 *
 * A server action is a public endpoint: the firm always comes from the
 * caller's own session, never from an id it is handed.
 */

export type ActionResult = { ok: boolean; code: string };

const KNOWN_CODES = [
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_authorized",
  "not_found",
  "number_disconnected",
  "empty",
  "too_long",
  "window_closed",
  "file_not_found",
  "type_not_allowed",
  "template_not_found",
  "template_not_approved",
  "template_params_mismatch",
  "opted_out",
  "invalid_kind",
  "note_required",
  "too_large",
  "not_uploaded",
] as const;

const codeOf = (message: string | null | undefined): string =>
  KNOWN_CODES.find((code) => (message ?? "").includes(code)) ?? "failed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath("/atendimento");
  revalidatePath("/inicio");
  revalidatePath("/settings/connections");
}

// ---------- A conversation ----------

export async function sendMessage(input: {
  conversationId: string;
  kind: "text" | "template";
  body?: string | null;
  templateId?: string | null;
  templateParams?: string[] | null;
  /** What the rule of advertising flagged in the text and the person sent all the same (`publicidade-v1`). */
  flagged?: string[] | null;
}): Promise<ActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(input.conversationId)) return { ok: false, code: "not_found" };
  if (input.kind !== "text" && input.kind !== "template") return { ok: false, code: "invalid_kind" };
  if (input.kind === "template" && !UUID.test(input.templateId ?? "")) return { ok: false, code: "template_not_found" };

  // Reserved under the person's own session: the database decides whether it may go.
  const { data, error } = await context.supabase.rpc("reserve_wa_send", {
    target_conversation: input.conversationId,
    target_kind: input.kind,
    target_body: input.kind === "text" ? (input.body ?? null) : null,
    target_template: input.kind === "template" ? input.templateId : null,
    target_template_params: input.kind === "template" ? (input.templateParams ?? []) : null,
    target_media_file: null,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const reserved = (data ?? {}) as { ok?: boolean; code?: string; message_id?: string };
  if (!reserved.ok || !reserved.message_id) return { ok: false, code: codeOf(reserved.code) };
  // Sent after the person read what the rule flagged: on the record by the rule's codes, never the text.
  const flagged = (input.flagged ?? []).filter((code) => /^[a-z_]{3,40}$/.test(code)).slice(0, 5);
  if (flagged.length > 0) {
    await recordAudit(context.supabase, "whatsapp.message_flagged_sent", {
      orgId: context.firm.id,
      entityType: "wa_message",
      entityId: reserved.message_id,
      metadata: { flagged },
    }).catch(() => undefined);
  }
  return deliverReserved(reserved.message_id);
}

/**
 * Sends at once what was just reserved, so the person sees what became of it.
 * What this does not send (the request ended first) the sweep sends.
 */
async function deliverReserved(messageId: string): Promise<ActionResult> {
  let result: ActionResult = { ok: true, code: "queued" };
  try {
    const report = await deliverOutbox(createServiceClient(), { messageId });
    const delivery = report.deliveries.find((entry) => entry.messageId === messageId);
    // Not claimed here (the sweep took it first): it is on its way, and `queued` is true.
    if (delivery) {
      result = delivery.ok
        ? { ok: true, code: "sent" }
        : // The message stays in the thread with what happened beside it. Two different things can
          // have happened: it did not go out, or nobody can tell whether it did.
          { ok: false, code: delivery.code === "unconfirmed" ? "unconfirmed" : "not_sent" };
    }
  } catch {
    // The claim itself could not be made: the message is still queued, and the sweep sends it.
    result = { ok: true, code: "queued" };
  }
  refresh();
  return result;
}

// ---------- A file of the firm, from the conversation ----------

/** What WhatsApp carries from a firm: a photo as an image, a PDF as a document. */
const FILE_KINDS: Record<string, "image" | "document"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "application/pdf": "document",
};

/** The first half of a file sent from a conversation: the reservation and the address the browser sends the bytes to. */
export async function startConversationUpload(input: {
  name: string;
  mime: string;
  bytes: number;
}): Promise<{ ok: true; fileId: string; storagePath: string; uploadToken: string } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const mime = String(input?.mime ?? "").toLowerCase();
  if (!FILE_KINDS[mime]) return { ok: false, code: "type_not_allowed" };
  const started = await startUpload(context, {
    purpose: "upload",
    name: String(input?.name ?? ""),
    mime,
    bytes: Number(input?.bytes ?? 0),
  });
  if (!started.ok) return { ok: false, code: started.code };
  return { ok: true, fileId: started.fileId, storagePath: started.storagePath, uploadToken: started.uploadToken };
}

/**
 * The second half: the backend measures what arrived, and the file goes as
 * what its bytes are (a photo as an image, a PDF as a document) with the
 * caption the person wrote. The database decides whether it may go
 * (`reserve_wa_send`: inside the 24 hours, a file of the firm, never from a
 * support visit); a file it refused is taken back, never left where no
 * screen lists it.
 */
export async function sendFile(input: {
  conversationId: string;
  fileId: string;
  caption?: string | null;
}): Promise<ActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(input?.conversationId ?? "") || !UUID.test(input?.fileId ?? "")) {
    return { ok: false, code: "not_found" };
  }
  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: codeOf(finished.code) };
  const takeBack = async () => {
    if (finished.measured && !(await isSupportVisit())) await discardUpload(context, input.fileId);
  };

  const { data: file } = await context.supabase
    .from("files")
    .select("detected_mime")
    .eq("id", input.fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  const kind = FILE_KINDS[String(file?.detected_mime ?? "")];
  if (!kind) {
    await takeBack();
    return { ok: false, code: "type_not_allowed" };
  }

  const { data, error } = await context.supabase.rpc("reserve_wa_send", {
    target_conversation: input.conversationId,
    target_kind: kind,
    target_body: input.caption?.trim() ? input.caption.trim() : null,
    target_template: null,
    target_template_params: null,
    target_media_file: input.fileId,
  });
  const reserved = (data ?? {}) as { ok?: boolean; code?: string; message_id?: string };
  if (error || !reserved.ok || !reserved.message_id) {
    await takeBack();
    return { ok: false, code: codeOf(error ? error.message : reserved.code) };
  }
  return deliverReserved(reserved.message_id);
}

/** A file chosen in the composer and not sent after all: taken back by the person who reserved it. */
export async function discardConversationUpload(fileId: string): Promise<void> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(fileId) || (await isSupportVisit())) return;
  await discardUpload(context, fileId);
}

export async function markConversationRead(conversationId: string): Promise<ActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(conversationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("wa_mark_read", { target_conversation: conversationId });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: codeOf(answer.code) };
  revalidatePath("/inicio");
  return { ok: true, code: "read" };
}

/**
 * Who answers a conversation (migration 0048): a person takes it over from
 * ONE, or gives it back. Giving it back clears a call of ONE's, and what the
 * passenger wrote last and nobody answered is then ONE's to answer.
 */
export async function setConversationAgent(conversationId: string, agent: "one" | "person"): Promise<ActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(conversationId) || (agent !== "one" && agent !== "person")) {
    return { ok: false, code: "not_found" };
  }
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const { data, error } = await context.supabase.rpc("set_conversation_agent", {
    target_conversation: conversationId,
    target_agent: agent,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: codeOf(answer.code) };
  refresh();
  if (agent === "one") {
    // Given back with something the passenger wrote and nobody answered: ONE takes its turn now.
    const { queueConversationTurn } = await import("@/lib/conversations/agent-work");
    await queueConversationTurn(conversationId).catch(() => undefined);
  }
  return { ok: true, code: answer.code ?? "changed" };
}

/** Records that a person asked the firm to stop writing, or that they agreed to be written to again. */
export async function setOptOut(input: {
  conversationId: string;
  optedOut: boolean;
  note: string;
}): Promise<ActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(input.conversationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("set_wa_optout", {
    target_conversation: input.conversationId,
    target_opted_out: input.optedOut,
    target_note: input.note,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: codeOf(answer.code) };
  refresh();
  return { ok: true, code: input.optedOut ? "opted_out" : "opted_in" };
}

/** A link of a minute to a file a person sent, for somebody of the same firm. */
export async function openMedia(fileId: string): Promise<{ ok: true; url: string } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(fileId)) return { ok: false, code: "not_found" };
  const link = await downloadUrl(context, fileId);
  return link.ok ? { ok: true, url: link.url } : { ok: false, code: link.code };
}

// ---------- The firm's number ----------

export async function connectSimulator(): Promise<ConnectResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const result = await connectSimulatedNumber(context);
  refresh();
  return result;
}

/** What the signup window of the vendor handed the browser: a code that lives 30 seconds, and which account it is. */
export async function connectWithSignup(input: {
  code: string;
  wabaId: string;
  phoneNumberId?: string | null;
}): Promise<ConnectResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const result = await connectMetaNumber(context, {
    code: String(input.code ?? ""),
    wabaId: String(input.wabaId ?? ""),
    phoneNumberId: input.phoneNumberId ? String(input.phoneNumberId) : null,
  });
  refresh();
  return result;
}

export async function finishRegistration(input: {
  connectionId: string;
  registrationCode: string;
}): Promise<ConnectResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(input.connectionId)) return { ok: false, code: "connection_not_found" };
  const result = await finishMetaRegistration(context, {
    connectionId: input.connectionId,
    registrationCode: String(input.registrationCode ?? "").replace(/\D/g, ""),
  });
  refresh();
  return result;
}

export async function disconnectNumber(connectionId: string): Promise<ActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(connectionId)) return { ok: false, code: "not_found" };
  const result = await disconnectWhatsApp(context, connectionId);
  refresh();
  return result;
}

/** Brings the templates of the firm's accounts again, with what the vendor decided about each. */
export async function refreshTemplates(): Promise<ActionResult> {
  const context = await getMemberContext();
  // It opens the firm's token, calls the vendor and rewrites what the firm knows of its templates:
  // for who manages the firm (the screen that asks for it is theirs), and never from a support
  // visit, which does nothing in the firm's name.
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };

  // The firm's numbers, read under the person's session.
  const { data, error } = await context.supabase
    .from("wa_numbers")
    .select("provider, connection_id, phone_number_id, waba_id")
    .eq("org_id", context.firm.id)
    .eq("status", "active");
  if (error) return { ok: false, code: "failed" };
  const numbers = (data ?? []) as {
    provider: string;
    connection_id: string;
    phone_number_id: string;
    waba_id: string;
  }[];
  if (numbers.length === 0) return { ok: false, code: "number_disconnected" };

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const settings = await readWhatsAppSettings(service);
  // One read per account: two numbers of the same account share their templates.
  const accounts = new Map(numbers.map((number) => [number.waba_id, number]));
  let failed = 0;
  for (const number of accounts.values()) {
    const synced = await syncAccountTemplates(service, settings, {
      provider: number.provider,
      orgId: context.firm.id,
      connectionId: number.connection_id,
      phoneNumberId: number.phone_number_id,
      wabaId: number.waba_id,
    });
    if (!synced.ok) failed += 1;
  }
  refresh();
  return failed === 0 ? { ok: true, code: "synced" } : { ok: false, code: "templates_unreadable" };
}

// ---------- The simulator ----------

export async function simulatePerson(input: {
  numberId: string;
  phone: string;
  name: string;
  text: string;
}): Promise<SimulationResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(String(input?.numberId ?? ""))) return { ok: false, code: "not_found" };
  // A server action is called with whatever the caller sends: everything is read as text.
  const result = await simulateInbound(context, {
    numberId: input.numberId,
    phone: String(input.phone ?? ""),
    name: String(input.name ?? ""),
    text: String(input.text ?? ""),
  });
  refresh();
  return result;
}

export async function simulatePhone(input: {
  numberId: string;
  phone: string;
  text: string;
}): Promise<SimulationResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(String(input?.numberId ?? ""))) return { ok: false, code: "not_found" };
  const result = await simulateEcho(context, {
    numberId: input.numberId,
    phone: String(input.phone ?? ""),
    text: String(input.text ?? ""),
  });
  refresh();
  return result;
}

export async function simulateLeave(numberId: string): Promise<SimulationResult> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(numberId)) return { ok: false, code: "not_found" };
  const result = await simulateDisconnection(context, numberId);
  refresh();
  return result;
}
