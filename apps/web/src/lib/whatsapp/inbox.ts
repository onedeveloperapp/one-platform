import "server-only";

import { isSimulatorOn, metaPlatform, simulatorSecret } from "@/lib/whatsapp/config";
import {
  type AccountNumber,
  applyEvents,
  type DeliveryReport,
  type NumberRoute,
  RefusedEvent,
  type WhatsAppInbox,
} from "@/lib/whatsapp/events";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";
import { vendorFailureCode } from "@flyee/whatsapp/providers/meta";
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
  const platform = metaPlatform();
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
  // The sweep fetches a pending media anyway; the event only makes it sooner.
  if (report.mediaPending) await sendEvent("one/whatsapp.media.pending", {});
  return { ok: true, provider, report };
}
