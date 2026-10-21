"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";

import { getVault } from "@/lib/connections/vault";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { openReservedEnvelopes, sendProviderCancels, SETTLED, syncEnvelope, zapSignFor } from "@/lib/signatures/work";
import { connectionRefusal, isSupportVisit } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { sendEvent } from "@flyee/jobs";
import { webhookSecretHash, ZapSignAuthError, ZapSignProvider } from "@flyee/signatures/providers/zapsign";

/**
 * What a person of a firm does with signatures (migration 0023), as server
 * actions. The rules are the database's (`request_signature`,
 * `cancel_signature`, `confirm_signature`); what is here is what it cannot
 * do: talk to ZapSign with the firm's token, and seal that token.
 *
 * A server action is a public endpoint: the firm comes from the caller's own
 * session, and every id is read again by the database under it.
 */

export type SignatureResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = [
  "not_allowed_in_support_session",
  "not_authorized",
  "case_not_found",
  "second_factor_required",
] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

type Answer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

function fold<T extends object>(
  data: unknown,
  error: { message: string } | null,
  pick: (answer: Answer) => T,
): SignatureResult<T> {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as Answer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

const refresh = (caseId?: string) => {
  revalidatePath("/settings/connections");
  if (caseId && isId(caseId)) revalidatePath(`/casos/${caseId}`);
};

// ---------- The firm's ZapSign account ----------

/**
 * Connects the firm's ZapSign account with its API token: ONE points the
 * account's webhook at itself with a secret of its own, and seals the token,
 * the secret and the webhook's id in the vault (beside the connection it
 * keeps only the secret's hash, which checks a delivery without opening the
 * vault). A connected account is disconnected first. An account reconnected
 * after an error keeps what it had when this attempt fails, and its old
 * webhook is removed when this one succeeds.
 */
export async function connectSignatureAccount(input: {
  token: string;
  environment: "production" | "sandbox";
}): Promise<SignatureResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const token = String(input?.token ?? "").trim();
  const environment = input?.environment === "sandbox" ? "sandbox" : "production";
  if (!/^[A-Za-z0-9._-]{16,200}$/.test(token)) return { ok: false, code: "invalid_token", field: "token" };
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };

  const { data: before } = await context.supabase
    .from("connections")
    .select("id, status")
    .eq("org_id", context.firm.id)
    .eq("provider", "zapsign")
    .maybeSingle();
  if (before?.status === "connected") return { ok: false, code: "already_connected" };
  const hadToken = before?.status === "error";

  const { data, error } = await context.supabase.rpc("begin_connection", {
    target_org: context.firm.id,
    target_provider: "zapsign",
    target_external_id: null,
    target_label: environment === "sandbox" ? "ZapSign (sandbox)" : "ZapSign",
  });
  const started = fold(data, error, (answer) => ({ connectionId: String(answer.connection_id) }));
  if (!started.ok) return started;
  const place = { orgId: context.firm.id, connectionId: started.connectionId };
  // What a failed attempt leaves: nothing new, and the token an errored account had stays where it was.
  const undo = async () => {
    if (!hadToken) await context.supabase.rpc("disconnect_connection", { target_connection: started.connectionId });
  };
  const previous = hadToken ? await zapSignFor(place, "signatures.reconnect") : null;

  const secret = randomBytes(32).toString("base64url");
  const provider = new ZapSignProvider({ apiToken: token, environment });

  // The envelopes still open on this connection live in one ZapSign account: a token of another
  // account would ask for them where they are not. ZapSign must know each of them.
  const { data: open } = await context.supabase
    .from("signature_envelopes")
    .select("provider_id")
    .eq("org_id", context.firm.id)
    .eq("connection_id", started.connectionId)
    .or("status.eq.pending,provider_cancel_pending.eq.true")
    .not("provider_id", "is", null)
    .limit(20);
  try {
    for (const row of (open ?? []) as { provider_id: string }[]) {
      if (!(await provider.getStatus(row.provider_id))) {
        await undo();
        return { ok: false, code: "other_account" };
      }
    }
  } catch (thrown) {
    await undo();
    return { ok: false, code: thrown instanceof ZapSignAuthError ? "token_refused" : "provider_unavailable" };
  }

  let webhookId: string;
  try {
    webhookId = await provider.registerWebhook({ url: `${BRAND.siteUrl}/api/webhooks/zapsign`, secret });
  } catch (thrown) {
    await undo();
    return { ok: false, code: thrown instanceof ZapSignAuthError ? "token_refused" : "provider_unavailable" };
  }

  const sealed = await access.vault.seal(
    place,
    { api_token: token, webhook_secret: secret, webhook_id: webhookId, environment },
    { metadata: { environment, webhook_id: webhookId, webhook_secret_sha256: webhookSecretHash(secret) } },
  );
  if (sealed.kind !== "sealed") {
    await provider.deleteWebhook(webhookId).catch(() => undefined);
    await undo();
    return { ok: false, code: `vault_${sealed.code}` };
  }
  // The webhook the account had before points nowhere useful now: removed, when the old token still opens it.
  if (previous?.ok && previous.webhookId && previous.webhookId !== webhookId) {
    await previous.provider.deleteWebhook(previous.webhookId).catch(() => undefined);
  }
  refresh();
  return { ok: true, code: "connected" };
}

/** Cuts the firm's ZapSign: its webhook is removed at ZapSign while the token still opens, then the token is discarded. */
export async function disconnectSignatureAccount(connectionId: string): Promise<SignatureResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role) || !isId(connectionId)) {
    return { ok: false, code: "not_authorized" };
  }
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  // Read under the person's session: a connection of another firm is not found.
  const { data: connection } = await context.supabase
    .from("connections")
    .select("id")
    .eq("id", connectionId)
    .eq("org_id", context.firm.id)
    .eq("provider", "zapsign")
    .maybeSingle();
  if (!connection) return { ok: false, code: "not_found" };
  const access = await zapSignFor({ orgId: context.firm.id, connectionId }, "signatures.disconnect");
  if (access.ok && access.webhookId) await access.provider.deleteWebhook(access.webhookId).catch(() => undefined);

  const { data, error } = await context.supabase.rpc("disconnect_connection", { target_connection: connectionId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh();
  return result;
}

// ---------- A document to be signed ----------

export async function requestSignature(input: {
  caseId: string;
  documentId: string;
  method: "zapsign" | "govbr" | "enotariado";
  signers: string[];
  enotariadoUrl?: string | null;
}): Promise<SignatureResult<{ envelopeId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.documentId)) return { ok: false, code: "case_not_found" };
  const signers = (Array.isArray(input.signers) ? input.signers : []).filter(isId);
  const { data, error } = await context.supabase.rpc("request_signature", {
    target_case: input.caseId,
    target_document: input.documentId,
    target_method: String(input.method ?? ""),
    target_signers: signers,
    target_enotariado_url: input.enotariadoUrl ? String(input.enotariadoUrl) : null,
  });
  const result = fold(data, error, (answer) => ({ envelopeId: String(answer.envelope_id) }));
  if (result.ok && input.method === "zapsign") {
    // Opened by the jobs at once; without them, this envelope (and only this one) is opened here.
    // The sweep catches what neither finished.
    const sent = await sendEvent("one/signature.requested", {});
    if (!sent.sent) {
      try {
        await openReservedEnvelopes(createServiceClient(), 1, result.envelopeId);
      } catch {
        // Still reserved: the sweep opens it.
      }
    }
  }
  if (result.ok) refresh(input.caseId);
  return result;
}

/**
 * Ends an envelope. The database cancels it at once (`cancel_signature`);
 * one pending at ZapSign has its cancel there recorded as owed, sent here
 * right away and by the sweep until ZapSign answered. A cut account never
 * keeps an envelope open in ONE.
 */
export async function cancelSignature(caseId: string, envelopeId: string, reason: string): Promise<SignatureResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(envelopeId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("cancel_signature", {
    target_envelope: envelopeId,
    target_reason: String(reason ?? ""),
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    try {
      await sendProviderCancels(createServiceClient(), 1, envelopeId);
    } catch {
      // Still owed: the sweep sends it.
    }
    refresh(caseId);
  }
  return result;
}

export async function confirmSignature(
  caseId: string,
  envelopeId: string,
  documentId: string,
): Promise<SignatureResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(envelopeId) || !isId(documentId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("confirm_signature", {
    target_envelope: envelopeId,
    target_document: documentId,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(caseId);
  return result;
}

/** Asks ZapSign now how an envelope of the firm stands, instead of waiting for its webhook. */
export async function refreshSignature(caseId: string, envelopeId: string): Promise<SignatureResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(envelopeId)) return { ok: false, code: "not_found" };
  // It opens the firm's token: never from a support visit.
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  // Read under the person's session: an envelope of another firm is not found.
  const { data: envelope } = await context.supabase
    .from("signature_envelopes")
    .select("id")
    .eq("id", envelopeId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!envelope) return { ok: false, code: "not_found" };
  try {
    const code = await syncEnvelope(createServiceClient(), envelopeId);
    refresh(caseId);
    if (SETTLED.includes(code)) return { ok: true, code };
    return { ok: false, code: code.startsWith("vault_") || code === "token_refused" ? "account_unavailable" : code };
  } catch {
    return { ok: false, code: "provider_unavailable" };
  }
}
