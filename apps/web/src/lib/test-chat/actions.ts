"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, randomUUID } from "node:crypto";

import { firstNameOf } from "@/lib/cases/cases";
import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import { isManager } from "@/lib/firm/roles";
import { sweepWhileUsed } from "@/lib/jobs/while-used";
import { getMemberContext } from "@/lib/member/context";
import { stagedPath } from "@/lib/test-chat/staging";
import {
  firmToolOf,
  flightNumberOf,
  followableDay,
  isQuickReply,
  legForTool,
  type TestChatCard,
  testChatCardOf,
  type TestChatView,
  testChatViewOf,
  type TestFirmView,
  testFirmViewOf,
  type TestMessage,
  testMessagesOf,
  type TestTool,
  type ToolLeg,
  toolOf,
} from "@/lib/test-chat/test-chat";
import { connectTestChatNumber } from "@/lib/whatsapp/connect";
import { applyEvents } from "@/lib/whatsapp/events";
import { supabaseInbox } from "@/lib/whatsapp/inbox";
import { queueMediaFetch } from "@/lib/whatsapp/media";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { localOf } from "@/modules/direito-do-passageiro/flight-alerts/source";
import { settleTripDay } from "@/modules/direito-do-passageiro/flight-alerts/trip-day-work";
import { watchTrips } from "@/modules/direito-do-passageiro/flight-alerts/watch";
import { evaluateTrip, tellFlightAlerts } from "@/modules/direito-do-passageiro/flight-alerts/work";
import { flightStatusProvider } from "@/modules/direito-do-passageiro/flights/status";
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
  // The tester waits in front of the chat, which asks for what is new every few seconds: the sweeps that serve
  // what people wait on run now and then, after the answer (lib/jobs/while-used.ts).
  sweepWhileUsed();
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
 * The test chat follows a real flight (0051): the flight and day the tester
 * names, read at FlightAware with the platform's key, become a trip of the
 * test chat, read again there as a real passenger's would be, ONE writing
 * in the test chat when the rule finds a problem. No screen offers it since
 * the test chat is the agency's passenger's only (0087): it stays as the way
 * the round trip of the watch follows a flight at FlightAware's fake, and
 * as the way back to a real flight in the test chat. Answers `following`, or
 * why not: `no_source` (no key in this environment), `invalid_flight`,
 * `flight_not_found`, `source_unavailable`.
 */
export async function followRealFlight(
  token: string,
  input: { flight: string; date: string },
): Promise<TestChatResult & { tripId?: string }> {
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  if (!TOKEN.test(String(token ?? ""))) return { ok: false, code: "missing" };
  const { data: chat, error } = await service.rpc("test_chat_by_token", { target_token: token });
  if (error || !(chat as { found?: boolean } | null)?.found) return { ok: false, code: "missing" };
  const flight = flightNumberOf(input?.flight ?? "");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const day = String(input?.date ?? "");
  if (!flight || !followableDay(day, today)) return { ok: false, code: "invalid_flight" };
  const provider = flightStatusProvider();
  if (!provider) return { ok: false, code: "no_source" };
  if (!(await hasRoom(service, token))) return { ok: false, code: "too_many" };

  let status;
  try {
    status = await provider.getFlightStatus({ flight, date: day });
  } catch {
    return { ok: false, code: "source_unavailable" };
  }
  const departure = localOf(status?.scheduledDeparture, status?.originTimeZone);
  const arrival = localOf(status?.scheduledArrival, status?.destinationTimeZone);
  if (!status || !departure || !arrival || !status.origin || !status.destination) {
    return { ok: false, code: "flight_not_found" };
  }
  const { data: followed, error: followError } = await service.rpc("test_chat_follow_flight", {
    target_token: token,
    target_legs: [
      {
        position: 1,
        flight_number: flight,
        origin: status.origin,
        destination: status.destination,
        departure,
        arrival,
      },
    ],
  });
  const answer = (followed ?? {}) as { ok?: boolean; code?: string; trip_id?: string };
  if (followError || !answer.ok || !answer.trip_id) return { ok: false, code: answer.code ?? "failed" };
  // Read at once, as the watch would: what FlightAware says now is on the trip before the tester looks.
  await watchTrips(service, provider, { tripId: answer.trip_id }).catch(() => undefined);
  return { ok: true, code: "following", tripId: answer.trip_id };
}

/** The files the test chat sends as the passenger, as a WhatsApp message carries them (0050). */
const TEST_MEDIA: Record<string, "image" | "document" | "audio"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "document",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "audio/amr": "audio",
};

/** The largest file the test chat sends: what WhatsApp carries of an audio. */
const TEST_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The first half of a file the passenger sends: a place for it where the
 * vendor would keep it, and the signed address the page sends the bytes to.
 */
export async function startTestMedia(
  token: string,
  tripId: string,
  input: { mime: string; bytes: number },
): Promise<{ ok: true; mediaId: string; storagePath: string; uploadToken: string } | { ok: false; code: string }> {
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const opened = await openedTrip(service, token, tripId);
  if (!opened) return { ok: false, code: "missing" };
  const mime = String(input?.mime ?? "").toLowerCase();
  if (!TEST_MEDIA[mime]) return { ok: false, code: "type_not_allowed" };
  const bytes = Number(input?.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > TEST_MEDIA_MAX_BYTES) return { ok: false, code: "too_large" };
  if (!(await hasRoom(service, token))) return { ok: false, code: "too_many" };
  const mediaId = randomUUID();
  const storagePath = stagedPath(opened.orgId, mediaId);
  if (!storagePath) return { ok: false, code: "failed" };
  const { data, error } = await service.storage.from(FIRM_FILES_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return { ok: false, code: "unavailable" };
  return { ok: true, mediaId, storagePath, uploadToken: data.token };
}

/**
 * The second half: the file the page sent goes in as the passenger's
 * message, through the same door a real one enters by, and the backend
 * brings it into the firm's files at once.
 */
export async function sendTestMedia(
  token: string,
  tripId: string,
  input: { mediaId: string; mime: string; name: string },
): Promise<TestChatResult> {
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const opened = await openedTrip(service, token, tripId);
  if (!opened) return { ok: false, code: "missing" };
  const mime = String(input?.mime ?? "").toLowerCase();
  const kind = TEST_MEDIA[mime];
  if (!kind || !UUID.test(String(input?.mediaId ?? ""))) return { ok: false, code: "invalid_message" };
  // The name a PDF shows with, as a phone sends it; a photo and an audio go with none, as WhatsApp sends them.
  const name = [...String(input?.name ?? "")]
    .filter((char) => char.charCodeAt(0) > 31)
    .join("")
    .trim()
    .slice(0, 200);

  const report = await applyEvents(supabaseInbox(service), "test", [
    {
      type: "message",
      phoneNumberId: opened.phoneNumberId,
      from: opened.trip.phone,
      contactName: firstNameOf(opened.trip.name) || opened.trip.name,
      providerMessageId: `test.in.${randomUUID()}`,
      kind,
      body: null,
      media: { id: input.mediaId, mimeType: mime, filename: kind === "document" ? name || "arquivo.pdf" : null },
      replyTo: null,
      timestamp: new Date(),
    },
  ]);
  if (report.applied === 0) return { ok: false, code: "not_delivered" };
  await queueMediaFetch();
  return { ok: true, code: "delivered" };
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
  return applyTool(service, tripId, tool, (legs) =>
    service.rpc("test_chat_set_legs", {
      target_token: token,
      target_trip: tripId,
      target_legs: legs,
      target_reset: false,
    }),
  );
}

type SetLegs = (legs: ToolLeg[]) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * A tool on a trip: its special legs found among the trip's own, the legs set as a source would say them
 * (`setLegs`: the test chat's or the test firm's), the rule's reading, and ONE's word when it is one.
 */
async function applyTool(
  service: SupabaseClient,
  tripId: string,
  tool: TestTool,
  setLegs: SetLegs,
): Promise<TestChatResult & { reason?: string }> {
  // A tool's special legs are the trip's own: its last one (an agency's trip has the legs the agency wrote), the
  // next to leave and the one in the air (0084).
  let legsOfTool = tool.legs;
  if (legsOfTool.some((leg) => leg.position <= 0)) {
    const { data: rows, error: legsError } = await service
      .from("tracked_legs")
      .select("position, scheduled_departure_local, status, departed_local, arrived_local")
      .eq("trip_id", tripId);
    if (legsError || !rows) return { ok: false, code: "failed" };
    const legsNow = rows.map((row) => ({
      position: Number(row.position),
      departure: String(row.scheduled_departure_local ?? ""),
      status: String(row.status ?? ""),
      departed: row.departed_local !== null,
      arrived: row.arrived_local !== null,
    }));
    const resolved = legsOfTool.map((leg) => ({ ...leg, position: legForTool(leg.position, legsNow) }));
    // Every leg left already, or none is in the air: there is nothing for the tool to move.
    if (resolved.some((leg) => leg.position === null)) return { ok: true, code: "nothing" };
    legsOfTool = resolved.map((leg) => ({ ...leg, position: leg.position as number }));
  }
  const { data, error } = await setLegs(legsOfTool);
  const legs = (data ?? {}) as { ok?: boolean; legs?: unknown; delay_minutes?: number };
  if (error || !legs.ok) return { ok: false, code: "failed" };

  try {
    const found = await evaluateTrip(service, {
      tripId,
      legs: legs.legs,
      delayMinutes: typeof legs.delay_minutes === "number" ? legs.delay_minutes : 240,
    });
    // A leg the tester made leave or land owes its journey's word of the day now (0173): no wait for the clock.
    for (const leg of legsOfTool) {
      if ("event" in leg) await settleTripDay(service, { tripId, event: { kind: leg.event, position: leg.position } });
    }
    // The flight went on as it should: nothing to tell, and the agency sees it step by step.
    if (!found.problem) return { ok: true, code: tool.legs.every((leg) => "event" in leg) ? "moved" : "quiet" };
    if (!found.alertId) return { ok: true, code: "already" };
    const told = await tellFlightAlerts(service, { alertId: found.alertId });
    if (told.queued > 0) return { ok: true, code: "told" };
    const { data: alert } = await service.from("flight_alerts").select("reason").eq("id", found.alertId).maybeSingle();
    return { ok: true, code: "not_told", reason: String(alert?.reason ?? "failed") };
  } catch {
    return { ok: false, code: "failed" };
  }
}

// ---------- A test firm's tools, by the firm's link (migration 0220) ----------

/** The test firm a link opens, with its real number and its test trips; `missing` for a link that opens nothing. */
export async function readTestFirm(
  token: string,
): Promise<{ ok: true; view: TestFirmView } | { ok: false; code: "missing" | "unavailable" }> {
  if (!TOKEN.test(String(token ?? ""))) return { ok: false, code: "missing" };
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  // The tester waits in front of the page, which reads the trips again: what follows a tool runs meanwhile.
  sweepWhileUsed();
  const { data, error } = await service.rpc("test_firm_view", { target_token: token });
  if (error) return { ok: false, code: "unavailable" };
  const view = testFirmViewOf(data);
  return view ? { ok: true, view } : { ok: false, code: "missing" };
}

/**
 * A tool of a test firm's trip: the flight cancelled, six hours late at the end, the next leg leaving or the one
 * in the air landing, as a source would say it, or the trip started over (`reset`). What ONE tells of it goes to
 * the passenger's real WhatsApp, through the firm's real number.
 */
export async function runTestFirmTool(
  token: string,
  tripId: string,
  toolKey: string,
): Promise<TestChatResult & { reason?: string }> {
  if (!TOKEN.test(String(token ?? "")) || !UUID.test(String(tripId ?? ""))) return { ok: false, code: "missing" };
  const service = backendOrNull();
  if (!service) return { ok: false, code: "unavailable" };
  const { data: firm, error } = await service.rpc("test_firm_by_token", { target_token: token });
  const found = (firm ?? {}) as { found?: boolean; org_id?: string };
  if (error || !found.found || !found.org_id) return { ok: false, code: "missing" };

  if (toolKey === "reset") {
    const { data, error: resetError } = await service.rpc("test_firm_set_legs", {
      target_token: token,
      target_trip: tripId,
      target_legs: null,
      target_reset: true,
    });
    return !resetError && (data as { ok?: boolean } | null)?.ok
      ? { ok: true, code: "reset" }
      : { ok: false, code: "failed" };
  }

  const tool = firmToolOf(String(toolKey ?? ""));
  if (!tool) return { ok: false, code: "invalid_tool" };
  return applyTool(service, tripId, tool, (legs) =>
    service.rpc("test_firm_set_legs", {
      target_token: token,
      target_trip: tripId,
      target_legs: legs,
      target_reset: false,
    }),
  );
}
