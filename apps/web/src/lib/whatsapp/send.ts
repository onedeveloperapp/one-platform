import "server-only";

import { queueChatwootMirror } from "@/lib/chatwoot/mirror";
import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import { readWhatsAppSettings, simulatorSecret, type WhatsAppSettings } from "@/lib/whatsapp/config";
import { handleDelivery } from "@/lib/whatsapp/inbox";
import { providerFor } from "@/lib/whatsapp/provider";
import { choicesOf, failureCodeOf } from "@flyee/whatsapp/rules";
import { signedDelivery, statusDelivery } from "@flyee/whatsapp/simulator";
import type { OutboundMessage, SendResult, WhatsAppProvider } from "@flyee/whatsapp/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sending what was reserved (migration 0019): claim, then send.
 *
 * A message a person wrote is first reserved by the database, which decides
 * whether it may go at all (`reserve_wa_send`). Here the backend claims it
 * (`claim_wa_outbox`: once claimed it is never claimed again), hands it to the
 * provider of its number and records what the vendor answered
 * (`mark_wa_send`). A crash between the claim and the answer leaves the
 * message `sending`, and the next claim closes it as `unconfirmed`: it may or
 * may not have gone out, so it is never sent again by itself.
 */

/** How long the vendor has to fetch a file the firm sends. */
const MEDIA_LINK_SECONDS = 600;

type Claimed = {
  message_id: string;
  org_id: string;
  number_id: string;
  kind: string;
  body: string | null;
  template_name: string | null;
  template_language: string | null;
  template_params: unknown;
  media_path: string | null;
  media_filename: string | null;
  to: string;
  provider: string;
  phone_number_id: string;
  waba_id: string;
  connection_id: string;
  number_status: string;
};

export type Delivery = { messageId: string; ok: boolean; code: string };
export type OutboxReport = { claimed: number; sent: number; failed: number; deliveries: Delivery[] };

async function messageOf(service: SupabaseClient, row: Claimed): Promise<OutboundMessage | { problem: string }> {
  if (row.kind === "text") {
    if (!row.body) return { problem: "empty" };
    // Its numbered choices go as buttons or a list where the vendor has them; the text stays as it is (0227).
    const choices = choicesOf(row.body);
    return choices ? { kind: "text", text: row.body, choices } : { kind: "text", text: row.body };
  }
  if (row.kind === "template") {
    if (!row.template_name) return { problem: "template_not_found" };
    const params = Array.isArray(row.template_params) ? row.template_params.map((value) => String(value)) : [];
    return {
      kind: "template",
      name: row.template_name,
      ...(row.template_language ? { language: row.template_language } : {}),
      bodyParams: params,
    };
  }
  if (row.kind === "image" || row.kind === "document") {
    if (!row.media_path) return { problem: "file_not_found" };
    // The vendor fetches the file from a signed address that stops working in minutes.
    const { data, error } = await service.storage
      .from(FIRM_FILES_BUCKET)
      .createSignedUrl(row.media_path, MEDIA_LINK_SECONDS);
    if (error || !data) return { problem: "file_unavailable" };
    return {
      kind: row.kind,
      url: data.signedUrl,
      ...(row.body ? { caption: row.body } : {}),
      ...(row.media_filename ? { filename: row.media_filename } : {}),
    };
  }
  return { problem: "invalid_kind" };
}

/** Records what came of a claimed message. Never throws: a message it could not record stays `sending` and is closed as unconfirmed, which is the truth. */
async function mark(
  service: SupabaseClient,
  row: Claimed,
  ok: boolean,
  providerMessageId: string | null,
  code: string | null,
) {
  try {
    const { error } = await service.rpc("mark_wa_send", {
      target_org: row.org_id,
      target_message: row.message_id,
      target_ok: ok,
      target_wa_message_id: providerMessageId,
      target_error_code: code,
    });
    if (error) console.error("whatsapp_mark_send_failed", { state: error.code ?? null });
  } catch {
    console.error("whatsapp_mark_send_failed", { state: null });
  }
}

/** What a pass shares between its messages: the settings, and one provider per number (a firm's token is opened once for the work at hand). */
type Pass = {
  settings: WhatsAppSettings;
  providers: Map<string, WhatsAppProvider | { problem: string }>;
  tokenReported: Set<string>;
};

/** Sends one claimed message and records what came of it. Never throws. */
async function deliverOne(service: SupabaseClient, row: Claimed, pass: Pass): Promise<Delivery> {
  const fail = async (code: string): Promise<Delivery> => {
    await mark(service, row, false, null, code);
    return { messageId: row.message_id, ok: false, code };
  };

  // Everything decided before the vendor is called is certain: the message did not go out.
  let provider: WhatsAppProvider;
  let message: OutboundMessage;
  try {
    if (row.number_status !== "active") return await fail("number_disconnected");
    if (!pass.providers.has(row.number_id)) {
      const access = await providerFor(
        {
          provider: row.provider,
          orgId: row.org_id,
          connectionId: row.connection_id,
          phoneNumberId: row.phone_number_id,
          wabaId: row.waba_id,
        },
        pass.settings,
        "whatsapp.send",
      );
      pass.providers.set(row.number_id, access.ok ? access.provider : { problem: access.code });
    }
    const found = pass.providers.get(row.number_id)!;
    if ("problem" in found) return await fail(found.problem);
    provider = found;

    const built = await messageOf(service, row);
    if ("problem" in built) return await fail(built.problem);
    message = built;
  } catch {
    // The token could not be read, the file could not be signed: nothing left the platform.
    return fail("not_attempted");
  }

  let result: SendResult;
  try {
    result = await provider.send(row.to, message);
  } catch {
    // A provider answers and never throws. If one did, whether the message left is not known.
    result = { ok: false, error: "unconfirmed", detail: "provider_threw" };
  }

  if (!result.ok) {
    const failed = await fail(failureCodeOf(result.error, result.detail));
    if (result.error === "token_invalid" && !pass.tokenReported.has(row.connection_id)) {
      pass.tokenReported.add(row.connection_id);
      // The connection says so on the firm's screen until it is made again.
      await service
        .rpc("vault_report_status", {
          target_org: row.org_id,
          target_connection: row.connection_id,
          target_ok: false,
          target_error_code: "token_invalid",
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }
    return failed;
  }

  await mark(service, row, true, result.providerMessageId, null);

  if (row.provider === "test") {
    // A test chat's page is the phone: what is kept there was delivered (the page says it read it, 0047).
    try {
      await service.rpc("wa_apply_status", {
        target_org: row.org_id,
        target_number: row.number_id,
        target_wa_message_id: result.providerMessageId,
        target_status: "delivered",
        target_error_code: null,
        target_pricing_category: null,
        target_pricing_type: null,
      });
    } catch {
      // The message was sent and recorded; only its receipt is missing.
    }
  }

  if (row.provider === "simulator") {
    // The vendor would say next that the message reached the person's phone:
    // the simulator says it through the same door a real status comes in by.
    try {
      const delivered = signedDelivery(
        statusDelivery(
          { wabaId: row.waba_id, phoneNumberId: row.phone_number_id, displayPhoneNumber: "" },
          result.providerMessageId,
          row.to,
          "delivered",
        ),
        simulatorSecret(),
      );
      await handleDelivery(delivered.rawBody, delivered.signature);
    } catch {
      // The message was sent and recorded; only its simulated receipt is missing.
    }
  }
  return { messageId: row.message_id, ok: true, code: "sent" };
}

/**
 * How long a sweep keeps taking messages. With the limit a provider puts on
 * one call, a pass that stops taking at this point still ends well inside the
 * minute a job step has.
 */
const SWEEP_BUDGET_MS = 30_000;

/**
 * Claims and sends: the one message a person just reserved, or the oldest
 * queued ones (the sweep).
 *
 * One message is claimed at a time, and what came of it is recorded before
 * the next is taken. Whatever stops a pass (a slow vendor, the end of the
 * job's time) then leaves at most ONE message claimed with nothing known
 * about it. Claiming a batch up front would turn every message the pass never
 * reached into "may or may not have gone out", for messages that never left.
 *
 * It throws only when the first claim itself fails, in which case nothing was
 * claimed and what was queued is still queued.
 */
export async function deliverOutbox(
  service: SupabaseClient,
  input: { messageId?: string; limit?: number; budgetMs?: number } = {},
): Promise<OutboxReport> {
  const report: OutboxReport = { claimed: 0, sent: 0, failed: 0, deliveries: [] };
  const started = Date.now();
  const budget = input.budgetMs ?? SWEEP_BUDGET_MS;
  const most = input.messageId ? 1 : Math.max(input.limit ?? 20, 1);
  let pass: Pass | null = null;

  for (let taken = 0; taken < most; taken += 1) {
    if (taken > 0 && Date.now() - started > budget) break;

    const { data, error } = await service.rpc("claim_wa_outbox", {
      target_message: input.messageId ?? null,
      target_limit: 1,
    });
    if (error) {
      if (taken === 0) throw new Error(`claim_wa_outbox failed: ${error.message}`);
      break;
    }
    const row = (Array.isArray(data) ? (data as Claimed[]) : [])[0];
    if (!row) break;
    report.claimed += 1;

    pass ??= { settings: await readWhatsAppSettings(service), providers: new Map(), tokenReported: new Set() };
    const delivery = await deliverOne(service, row, pass);
    report.deliveries.push(delivery);
    if (delivery.ok) report.sent += 1;
    else report.failed += 1;
  }
  // What went (or did not) shows in the firm's panel at once (0223).
  if (report.claimed > 0) queueChatwootMirror();
  return report;
}
