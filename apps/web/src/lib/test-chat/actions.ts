"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, randomUUID } from "node:crypto";

import { firstNameOf } from "@/lib/cases/cases";
import { isManager } from "@/lib/firm/roles";
import { evaluateTrip, tellFlightAlerts } from "@/lib/flight-alerts/work";
import { getMemberContext } from "@/lib/member/context";
import {
  isQuickReply,
  type TestChatCard,
  testChatCardOf,
  type TestChatView,
  testChatViewOf,
  type TestMessage,
  testMessagesOf,
  toolOf,
} from "@/lib/test-chat/test-chat";
import { connectTestChatNumber } from "@/lib/whatsapp/connect";
import { applyEvents } from "@/lib/whatsapp/events";
import { supabaseInbox } from "@/lib/whatsapp/inbox";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the firm's test chat does (migration 0047): who manages the firm turns
 * it on, changes its link or turns it off on the connections screen; and its
 * page, opened by the link with no account, reads the trips and their
 * conversations, sends what the passenger writes through the same door a
 * real delivery enters by, and makes a trip's problem happen. Every page
 * action is a public endpoint: it acts only by the link's secret, which the
 * database checks, and only on the firm's own test trips.
 */

export type TestChatResult = { ok: boolean; code: string };

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- The connections screen ----------

/** The test chat as the connections screen shows it; null when it could not be read. */
export async function readTestChatCard(): Promise<TestChatCard | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data, error } = await context.supabase.rpc("test_chat_link", { target_org: context.firm.id });
  return error ? null : testChatCardOf(data);
}

/** Turns the test chat on: its number connected as a real one is, then the chat with its link and its four trips. */
export async function startTestChat(): Promise<TestChatResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const connected = await connectTestChatNumber(context);
  if (!connected.ok) return { ok: false, code: connected.code };
  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const { data, error } = await service.rpc("start_test_chat", {
    target_org: context.firm.id,
    target_number: connected.numberId,
    target_token: randomBytes(32).toString("base64url"),
    target_by: context.userId,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  revalidatePath("/settings/connections");
  return answer.ok || answer.code === "already_on"
    ? { ok: true, code: String(answer.code) }
    : { ok: false, code: String(answer.code ?? "failed") };
}

/** A new link for the test chat in use: the one before stops opening anything. */
export async function renewTestChatLink(): Promise<TestChatResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isManager(context.firm.role) && context.firm.firmFunction !== "socio")
    return { ok: false, code: "not_authorized" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const { data, error } = await service.rpc("renew_test_chat", {
    target_org: context.firm.id,
    target_token: randomBytes(32).toString("base64url"),
    target_by: context.userId,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  revalidatePath("/settings/connections");
  return { ok: Boolean(answer.ok), code: String(answer.code ?? "failed") };
}

/** Turns the test chat off: its link opens nothing more; its conversations and cases stay. */
export async function endTestChat(): Promise<TestChatResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("end_test_chat", { target_org: context.firm.id });
  if (error) {
    return { ok: false, code: error.message.includes("not_authorized") ? "not_authorized" : "failed" };
  }
  revalidatePath("/settings/connections");
  return { ok: true, code: String((data as { code?: string } | null)?.code ?? "ended") };
}

// ---------- The page, by the link's secret ----------

function backendOrNull(): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/** The test chat a link opens: the firm and its four trips; `missing` for a link that opens nothing. */
export async function readTestChat(
  token: string,
): Promise<{ ok: true; view: TestChatView } | { ok: false; code: "missing" | "unavailable" }> {
  if (!TOKEN.test(String(token ?? ""))) return { ok: false, code: "missing" };
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const { data, error } = await service.rpc("test_chat_view", { target_token: token });
  if (error) return { ok: false, code: "unavailable" };
  const view = testChatViewOf(data);
  return view ? { ok: true, view } : { ok: false, code: "missing" };
}

/** What is new in one trip's conversation after the last message the page has. */
export async function readTestThread(
  token: string,
  tripId: string,
  after: string | null,
): Promise<{ ok: true; messages: TestMessage[] } | { ok: false; code: string }> {
  if (!TOKEN.test(String(token ?? "")) || !UUID.test(String(tripId ?? ""))) return { ok: false, code: "missing" };
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const since = after && !Number.isNaN(Date.parse(after)) ? after : null;
  const { data, error } = await service.rpc("test_chat_thread", {
    target_token: token,
    target_trip: tripId,
    target_after: since,
  });
  if (error) return { ok: false, code: "unavailable" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; messages?: unknown };
  return answer.ok ? { ok: true, messages: testMessagesOf(answer.messages) } : { ok: false, code: String(answer.code) };
}

type OpenedChat = { orgId: string; phoneNumberId: string; trip: { phone: string; name: string; label: string } };

/** The chat a link opens and one of its test trips, read by the backend; null when the link or the trip is not one. */
async function openedTrip(service: SupabaseClient, token: string, tripId: string): Promise<OpenedChat | null> {
  if (!TOKEN.test(String(token ?? "")) || !UUID.test(String(tripId ?? ""))) return null;
  const { data, error } = await service.rpc("test_chat_by_token", { target_token: token });
  const chat = (data ?? {}) as { found?: boolean; org_id?: string; phone_number_id?: string };
  if (error || !chat.found || !chat.org_id || !chat.phone_number_id) return null;
  const { data: trip } = await service
    .from("tracked_trips")
    .select("phone, passenger_name, label")
    .eq("id", tripId)
    .eq("org_id", chat.org_id)
    .eq("is_test", true)
    .maybeSingle();
  if (!trip) return null;
  return {
    orgId: chat.org_id,
    phoneNumberId: chat.phone_number_id,
    trip: { phone: String(trip.phone), name: String(trip.passenger_name), label: String(trip.label) },
  };
}

/** Whether the chat takes one more thing from its tester this minute. */
async function hasRoom(service: SupabaseClient, token: string): Promise<boolean> {
  const { data, error } = await service.rpc("test_chat_room", { target_token: token });
  return !error && data === true;
}

/**
 * What the passenger writes, or the reply they tap under ONE's first word:
 * delivered through the same door a real message enters by (the inbox of
 * 0019), from the passenger's mobile to the test chat's number.
 */
export async function sendTestMessage(
  token: string,
  tripId: string,
  input: { text?: string; reply?: string },
): Promise<TestChatResult> {
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const opened = await openedTrip(service, token, tripId);
  if (!opened) return { ok: false, code: "missing" };
  const reply = isQuickReply(input?.reply) ? input.reply : null;
  const text = reply ?? String(input?.text ?? "").trim();
  if (!text || text.length > 4096) return { ok: false, code: "invalid_message" };
  if (!(await hasRoom(service, token))) return { ok: false, code: "too_many" };

  const report = await applyEvents(supabaseInbox(service), "test", [
    {
      type: "message",
      phoneNumberId: opened.phoneNumberId,
      from: opened.trip.phone,
      contactName: firstNameOf(opened.trip.name) || opened.trip.name,
      providerMessageId: `test.in.${randomUUID()}`,
      kind: reply ? "button" : "text",
      body: text,
      media: null,
      replyTo: null,
      timestamp: new Date(),
    },
  ]);
  return report.applied > 0 ? { ok: true, code: "delivered" } : { ok: false, code: "not_delivered" };
}

/**
 * A tool of the test chat: the trip's problem made to happen as a source
 * would say it (or undone, `reset`), read by the rule, and told by ONE when
 * it is one. Answers what came of it: `told`, `quiet` (nothing the rule
 * tells), `already` (told before: undo it to tell it again), `not_told`
 * (with why), `reset`.
 */
export async function runTestTool(
  token: string,
  tripId: string,
  toolKey: string,
): Promise<TestChatResult & { reason?: string }> {
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const opened = await openedTrip(service, token, tripId);
  if (!opened) return { ok: false, code: "missing" };
  if (!(await hasRoom(service, token))) return { ok: false, code: "too_many" };

  if (toolKey === "reset") {
    const { data, error } = await service.rpc("test_chat_set_legs", {
      target_token: token,
      target_trip: tripId,
      target_legs: null,
      target_reset: true,
    });
    return !error && (data as { ok?: boolean } | null)?.ok
      ? { ok: true, code: "reset" }
      : { ok: false, code: "failed" };
  }

  const tool = toolOf(opened.trip.label, String(toolKey ?? ""));
  if (!tool) return { ok: false, code: "invalid_tool" };
  const { data, error } = await service.rpc("test_chat_set_legs", {
    target_token: token,
    target_trip: tripId,
    target_legs: tool.legs,
    target_reset: false,
  });
  const legs = (data ?? {}) as { ok?: boolean; legs?: unknown; delay_minutes?: number };
  if (error || !legs.ok) return { ok: false, code: "failed" };

  try {
    const found = await evaluateTrip(service, {
      tripId,
      legs: legs.legs,
      delayMinutes: typeof legs.delay_minutes === "number" ? legs.delay_minutes : 240,
    });
    if (!found.problem) return { ok: true, code: "quiet" };
    if (!found.alertId) return { ok: true, code: "already" };
    const told = await tellFlightAlerts(service, { alertId: found.alertId });
    if (told.queued > 0) return { ok: true, code: "told" };
    const { data: alert } = await service.from("flight_alerts").select("reason").eq("id", found.alertId).maybeSingle();
    return { ok: true, code: "not_told", reason: String(alert?.reason ?? "failed") };
  } catch {
    return { ok: false, code: "failed" };
  }
}
