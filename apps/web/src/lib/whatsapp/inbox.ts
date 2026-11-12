import "server-only";

import { isSimulatorOn, metaApp, openWaPlatform, simulatorSecret } from "@/lib/whatsapp/config";
import {
  type AccountNumber,
  applyEvents,
  type DeliveryReport,
  type NumberRoute,
  RefusedEvent,
  type WhatsAppInbox,
} from "@/lib/whatsapp/events";
import { queueMediaFetch } from "@/lib/whatsapp/media";
import { createServiceClient } from "@flyee/auth/service";
import { vendorFailureCode } from "@flyee/whatsapp/providers/meta";
import { parseOpenWaDelivery, verifyOpenWaSignature } from "@flyee/whatsapp/providers/openwa";
import type { WhatsAppProviderName } from "@flyee/whatsapp/types";
import { parseWebhook, verifySignature } from "@flyee/whatsapp/webhook";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one door every WhatsApp delivery enters by: the vendor's, posted to the
 * webhook, and the simulator's, built inside the app. Each is checked by its
 * signature, read by the same parser and routed by the number it carries to
 * the one firm that number is active in.
 *
 * Everything is written through the functions of migration 0019, which take
 * the firm and are idempotent: the vendor delivers again whatever was not
 * answered with a 200, and a delivery that arrives twice changes nothing
 * twice.
 */

type Rpc = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A database answer that will be the same on every retry (the data itself was
 * refused: SQLSTATE classes 22 and 23) is told apart from one that may pass
 * next time (the database was not reachable).
 */
function unwrap(name: string, { data, error }: Rpc): Record<string, unknown> {
  if (error) {
    const state = error.code ?? "";
    if (state.startsWith("22") || state.startsWith("23")) {
      console.error("whatsapp_event_refused", { rpc: name, state });
      throw new RefusedEvent(name);
    }
    throw new Error(`${name} failed: ${error.message}`);
  }
  return (data ?? {}) as Record<string, unknown>;
}

const iso = (moment: Date | null): string | null => (moment ? moment.toISOString() : null);

/**
 * A client who just wrote may now be sent their link by ONE (migration 0046):
 * the database already woke the cases that owe it, and naming them here has
 * them looked at now instead of at the next sweep. Never fails the message:
 * the sweep takes the cases anyway.
 */
async function askForLinks(service: SupabaseClient, orgId: string, contact: string): Promise<void> {
  try {
    const { data, error } = await service.rpc("wa_contact_link_cases", {
      target_org: orgId,
      target_contact: contact,
    });
    if (error || !Array.isArray(data) || data.length === 0) return;
    // Loaded when needed: the worker that sends a link sends it through this inbox's outbox.
    const { queueCaseAdvance } = await import("@/lib/cases/advance-work");
    for (const caseId of data) {
      if (typeof caseId === "string") await queueCaseAdvance(caseId);
    }
  } catch {
    // The sweep looks at the cases anyway.
  }
}

/**
 * A passenger wrote in a conversation: ONE takes its turn there once they
 * stop writing (migration 0048), where ONE answers it; the database decides
 * whether it does. Never fails the message: the sweep takes the turn anyway.
 */
async function askForTurn(conversationId: unknown): Promise<void> {
  if (typeof conversationId !== "string") return;
  try {
    // Loaded when needed: the turn sends its answer through this inbox's outbox.
    const { queueConversationTurn } = await import("@/lib/conversations/agent-work");
    await queueConversationTurn(conversationId);
  } catch {
    // The sweep takes the turn.
  }
}

export function supabaseInbox(service: SupabaseClient): WhatsAppInbox {
  return {
    async route(provider, phoneNumberId): Promise<NumberRoute | null> {
      const answer = unwrap(
        "wa_route",
        await service.rpc("wa_route", { target_provider: provider, target_phone_number_id: phoneNumberId }),
      );
      if (answer.found !== true) return null;
      return {
        orgId: String(answer.org_id),
        numberId: String(answer.number_id),
        connectionId: String(answer.connection_id),
        wabaId: String(answer.waba_id),
        mode: String(answer.mode),
      };
    },

    async accountNumbers(provider, wabaId): Promise<AccountNumber[]> {
      const { data, error } = await service.rpc("wa_account_numbers", {
        target_provider: provider,
        target_waba_id: wabaId,
      });
      if (error) throw new Error(`wa_account_numbers failed: ${error.message}`);
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      return rows.map((row) => ({
        orgId: String(row.org_id),
        numberId: String(row.number_id),
        connectionId: String(row.connection_id),
      }));
    },

    async inbound(route, event) {
      const answer = unwrap(
        "wa_ingest_inbound",
        await service.rpc("wa_ingest_inbound", {
          target_org: route.orgId,
          target_number: route.numberId,
          target_contact: event.from,
          target_contact_name: event.contactName,
          target_wa_message_id: event.providerMessageId,
          target_kind: event.kind,
          target_body: event.body,
          target_media: event.media
            ? { id: event.media.id, mime_type: event.media.mimeType, filename: event.media.filename }
            : null,
          target_reply_to: event.replyTo,
          target_wa_timestamp: iso(event.timestamp),
        }),
      );
      if (answer.code === "received") {
        // The ad the conversation came from, kept once (0207); a failure here never holds the message back.
        if (event.adReferral && typeof answer.conversation_id === "string") {
          await service
            .rpc("wa_record_ad_referral", {
              target_conversation: answer.conversation_id,
              target_referral: {
                source_type: event.adReferral.sourceType,
                source_id: event.adReferral.sourceId,
                source_url: event.adReferral.sourceUrl,
                headline: event.adReferral.headline,
                ctwa_clid: event.adReferral.ctwaClid,
              },
            })
            .then(
              () => undefined,
              () => undefined,
            );
        }
        await askForLinks(service, route.orgId, event.from);
        await askForTurn(answer.conversation_id);
      }
      return { mediaPending: answer.code === "received" && answer.media_pending === true };
    },

    async status(route, event) {
      unwrap(
        "wa_apply_status",
        await service.rpc("wa_apply_status", {
          target_org: route.orgId,
          target_number: route.numberId,
          target_wa_message_id: event.providerMessageId,
          target_status: event.status,
          target_error_code: event.status === "failed" ? vendorFailureCode(event.errorCode) : null,
          target_pricing_category: event.pricingCategory,
          target_pricing_type: event.pricingType,
        }),
      );
    },

    async echo(route, event) {
      unwrap(
        "wa_ingest_mirrored",
        await service.rpc("wa_ingest_mirrored", {
          target_org: route.orgId,
          target_number: route.numberId,
          target_contact: event.to,
          target_wa_message_id: event.providerMessageId,
          target_direction: "out",
          target_origin: "app",
          target_kind: event.kind,
          target_body: event.body,
          target_wa_timestamp: iso(event.timestamp),
          target_status: "sent",
        }),
      );
    },

    async contact(route, event) {
      unwrap(
        "wa_sync_contact",
        await service.rpc("wa_sync_contact", {
          target_org: route.orgId,
          target_number: route.numberId,
          target_contact: event.contact,
          target_saved_name: event.name,
          target_action: event.action,
        }),
      );
    },

    async history(route, event) {
      const messages = event.threads.flatMap((thread) =>
        thread.messages.map((message) => ({
          contact: thread.contact,
          wa_message_id: message.providerMessageId,
          direction: message.direction,
          kind: message.kind,
          body: message.body,
          wa_timestamp: iso(message.timestamp),
          status: message.status,
        })),
      );
      unwrap(
        "wa_ingest_history",
        await service.rpc("wa_ingest_history", {
          target_org: route.orgId,
          target_number: route.numberId,
          target_messages: messages,
          target_progress: event.progress === null ? null : Math.round(event.progress),
        }),
      );
    },

    async disconnect(number, reason) {
      unwrap(
        "wa_disconnect_number",
        await service.rpc("wa_disconnect_number", {
          target_org: number.orgId,
          target_number: number.numberId,
          target_reason: reason,
        }),
      );
      // The firm's token no longer works at the vendor: the connection says so until it is made again.
      const { error } = await service.rpc("vault_report_status", {
        target_org: number.orgId,
        target_connection: number.connectionId,
        target_ok: false,
        target_error_code: "partner_removed",
      });
      if (error) throw new Error(`vault_report_status failed: ${error.message}`);
    },

    async templateStatus(provider, event) {
      unwrap(
        "wa_set_template_status",
        await service.rpc("wa_set_template_status", {
          target_provider: provider,
          target_waba_id: event.wabaId,
          target_name: event.name,
          target_language: event.language,
          target_status: event.status,
        }),
      );
    },

    // A template the vendor now calls marketing no longer carries a notice to clients (migration 0038).
    async templateCategory(provider, event) {
      unwrap(
        "wa_set_template_category",
        await service.rpc("wa_set_template_category", {
          target_provider: provider,
          target_waba_id: event.wabaId,
          target_name: event.name,
          target_language: event.language,
          target_category: event.category,
        }),
      );
    },
  };
}

/** Whose signature a delivery carries: the vendor's app secret, or the simulator's own. Null when neither. */
function signedBy(rawBody: string, signature: string | null): WhatsAppProviderName | null {
  const platform = metaApp();
  if (platform && verifySignature(rawBody, signature, platform.appSecret)) return "meta";
  if (isSimulatorOn() && verifySignature(rawBody, signature, simulatorSecret())) return "simulator";
  return null;
}

export type DeliveryOutcome =
  | { ok: true; provider: WhatsAppProviderName; report: DeliveryReport }
  | { ok: false; status: 400 | 401 | 503; code: string };

export async function handleDelivery(rawBody: string, signature: string | null): Promise<DeliveryOutcome> {
  const provider = signedBy(rawBody, signature);
  if (!provider) return { ok: false, status: 401, code: "invalid_signature" };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, status: 503, code: "backend_not_configured" };
  }

  const report = await applyEvents(supabaseInbox(service), provider, parseWebhook(payload));
  // The sweep fetches a pending media anyway; this only makes it sooner (and ONE's turn after it).
  if (report.mediaPending) await queueMediaFetch();
  return { ok: true, provider, report };
}

/**
 * A delivery of the platform's OpenWA (migration 0221): taken only with the HMAC of its raw body under the
 * platform's secret (`X-OpenWA-Signature`), read into the same events a delivery of Meta gives, and applied by the
 * same door, under the provider `openwa`, each event routed by its session to the one firm whose number it is.
 * OpenWA tells of every message the number sent, ONE's own included, and may do so before ONE recorded the id the
 * send got back: while a message of ONE to that person is being sent, the delivery is answered 503 and OpenWA
 * brings it again (it retries what was not taken), so ONE's own message is never read as the phone's.
 */
export async function handleOpenWaDelivery(rawBody: string, signature: string | null): Promise<DeliveryOutcome> {
  const platform = openWaPlatform();
  if (!platform) return { ok: false, status: 503, code: "openwa_not_configured" };
  if (!verifyOpenWaSignature(rawBody, signature, platform.webhookSecret)) {
    return { ok: false, status: 401, code: "invalid_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, status: 503, code: "backend_not_configured" };
  }

  const events = parseOpenWaDelivery(payload);
  for (const event of events) {
    if (event.type !== "echo") continue;
    const { data: number } = await service
      .from("wa_numbers")
      .select("id")
      .eq("provider", "openwa")
      .eq("phone_number_id", event.phoneNumberId)
      .eq("status", "active")
      .maybeSingle();
    if (!number) continue;
    const { data: sending } = await service.rpc("wa_sending_to", {
      target_number: number.id,
      target_contact: event.to,
    });
    if (sending === true) return { ok: false, status: 503, code: "sending_now" };
  }

  const report = await applyEvents(supabaseInbox(service), "openwa", events);
  if (report.mediaPending) await queueMediaFetch();
  return { ok: true, provider: "openwa", report };
}
