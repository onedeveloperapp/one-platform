"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";

import { queueInterview } from "@/lib/cases/interview-work";
import { getVault } from "@/lib/connections/vault";
import { supabaseFileStore } from "@/lib/files/store";
import { isManager } from "@/lib/firm/roles";
import { soon } from "@/lib/jobs/soon";
import { getMemberContext } from "@/lib/member/context";
import { ACCOUNT_METHODS, type SignatureMethod } from "@/lib/signatures/methods";
import {
  d4signWebhookSecret,
  openReservedEnvelopes,
  sendProviderCancels,
  SETTLED,
  syncEnvelope,
  zapSignFor,
} from "@/lib/signatures/work";
import { connectionRefusal, isSupportVisit } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { D4SignProvider } from "@flyee/signatures/providers/d4sign";
import { webhookSecretHash, ZapSignAuthError, ZapSignProvider } from "@flyee/signatures/providers/zapsign";
import { SignatureAuthError, SignatureUnavailableError } from "@flyee/signatures/types";

/**
 * What a person of a firm does with signatures (migration 0023, D4Sign since 0253), as server
 * actions. The rules are the database's (`request_signature`,
 * `cancel_signature`, `confirm_signature`); what is here is what it cannot
 * do: talk to the firm's signature account (ZapSign or D4Sign) with its keys, and seal them.
 *
 * A server action is a public endpoint: the firm comes from the caller's own
 * session, and every id is read again by the database under it.
 */

export type SignatureResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

/** The D4Sign account has several safes and none was chosen (or the one chosen is gone): the firm picks one of these. */
export type D4SignSafeChoice = {
  ok: false;
  code: "choose_safe" | "safe_not_found";
  safes: { uuid: string; name: string }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
/** A safe's id at D4Sign, a UUID of any version. */
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What a provider's key looks like: never anything that could carry more than a key. */
const KEY = /^[A-Za-z0-9._-]{16,200}$/;

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

  // One signature account at a time (0253): a D4Sign account connected is cut first.
  if (await otherAccountConnected(context.supabase, context.firm.id, "zapsign")) {
    return { ok: false, code: "already_connected" };
  }
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

/**
 * Cuts the firm's signature account. ZapSign's webhook is removed at ZapSign while the token still opens; D4Sign's are
 * the documents' own and end with them. Then the keys are discarded.
 */
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
    .select("id, provider, status")
    .eq("id", connectionId)
    .eq("org_id", context.firm.id)
    .in("provider", [...ACCOUNT_METHODS])
    .maybeSingle();
  if (!connection) return { ok: false, code: "not_found" };
  // A connected account with papers still signing by it stays (0254): cut, nobody would hear of them again, while
  // their addresses keep working at the provider. They are cancelled in their cases, or signed, first. An account
  // in error is cut at once: its keys no longer answer for them anyway.
  if (connection.status === "connected") {
    const { data: open, error: openError } = await context.supabase
      .from("signature_envelopes")
      .select("id")
      .eq("org_id", context.firm.id)
      .eq("connection_id", connectionId)
      .or("status.in.(reserved,opening,pending),provider_cancel_pending.eq.true")
      .limit(1);
    if (openError) return { ok: false, code: "failed" };
    if ((open ?? []).length > 0) return { ok: false, code: "open_papers" };
  }
  if (connection.provider === "zapsign") {
    const access = await zapSignFor({ orgId: context.firm.id, connectionId }, "signatures.disconnect");
    if (access.ok && access.webhookId) await access.provider.deleteWebhook(access.webhookId).catch(() => undefined);
  }

  const { data, error } = await context.supabase.rpc("disconnect_connection", { target_connection: connectionId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh();
  return result;
}

type Session = NonNullable<Awaited<ReturnType<typeof getMemberContext>>>["supabase"];

/** Whether the firm has a signature account of the other provider connected: one account at a time (0253). */
async function otherAccountConnected(
  supabase: Session,
  orgId: string,
  provider: "zapsign" | "d4sign",
): Promise<boolean> {
  const { data } = await supabase
    .from("connections")
    .select("id")
    .eq("org_id", orgId)
    .in(
      "provider",
      ACCOUNT_METHODS.filter((method) => method !== provider),
    )
    .eq("status", "connected")
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Connects the firm's D4Sign account (0253) with its keys (D4Sign: the `tokenAPI`, and the `cryptKey` where the account
 * enabled it) in the
 * environment chosen, and the safe its clients' papers go into. ONE reads the account's safes first: one safe is taken
 * as it is; with several, the firm chooses (the answer `choose_safe` brings them). The keys, the safe and a secret of
 * ONE's own are sealed in the vault; beside the connection, only the safe's name, the environment and the secret's
 * hash, which checks a delivery of a document's webhook before the vault is opened. A ZapSign account connected is cut
 * first. An account reconnected after an error keeps what it had when this attempt fails.
 */
export async function connectD4SignAccount(input: {
  tokenApi: string;
  cryptKey: string;
  environment: "production" | "sandbox";
  safeUuid?: string | null;
}): Promise<SignatureResult | D4SignSafeChoice> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const tokenApi = String(input?.tokenApi ?? "").trim();
  const cryptKey = String(input?.cryptKey ?? "").trim();
  const environment = input?.environment === "sandbox" ? "sandbox" : "production";
  const chosen = typeof input?.safeUuid === "string" && UUID_ANY.test(input.safeUuid) ? input.safeUuid : null;
  if (!KEY.test(tokenApi)) return { ok: false, code: "invalid_token", field: "token" };
  // The cryptKey only where the account enabled it (D4Sign's reference): an empty one is not sent.
  if (cryptKey && !KEY.test(cryptKey)) return { ok: false, code: "invalid_token", field: "crypt_key" };
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  if (await otherAccountConnected(context.supabase, context.firm.id, "d4sign")) {
    return { ok: false, code: "already_connected" };
  }

  const { data: before } = await context.supabase
    .from("connections")
    .select("id, status")
    .eq("org_id", context.firm.id)
    .eq("provider", "d4sign")
    .maybeSingle();
  if (before?.status === "connected") return { ok: false, code: "already_connected" };
  const hadKeys = before?.status === "error";

  const provider = new D4SignProvider({ tokenApi, cryptKey: cryptKey || null, environment });
  let safes: { uuid: string; name: string }[];
  try {
    safes = await provider.listSafes();
  } catch (thrown) {
    // Keys that cannot read the account's own safes are, to the firm, keys D4Sign did not take.
    const refusedKeys =
      thrown instanceof SignatureAuthError ||
      (thrown instanceof SignatureUnavailableError && thrown.code === "provider_forbidden");
    if (thrown instanceof SignatureUnavailableError && thrown.code === "provider_rate_limited") {
      return { ok: false, code: "provider_rate_limited" };
    }
    return { ok: false, code: refusedKeys ? "token_refused" : "provider_unavailable" };
  }
  if (safes.length === 0) return { ok: false, code: "no_safe" };
  const safe = chosen ? safes.find((item) => item.uuid === chosen) : safes.length === 1 ? safes[0] : null;
  if (!safe) return { ok: false, code: chosen ? "safe_not_found" : "choose_safe", safes };

  const { data, error } = await context.supabase.rpc("begin_connection", {
    target_org: context.firm.id,
    target_provider: "d4sign",
    target_external_id: null,
    target_label: environment === "sandbox" ? "D4Sign (sandbox)" : "D4Sign",
  });
  const started = fold(data, error, (answer) => ({ connectionId: String(answer.connection_id) }));
  if (!started.ok) return started;
  const place = { orgId: context.firm.id, connectionId: started.connectionId };
  // What a failed attempt leaves: nothing new, and the keys an errored account had stay where they were.
  const undo = async () => {
    if (!hadKeys) await context.supabase.rpc("disconnect_connection", { target_connection: started.connectionId });
  };

  // The envelopes still open on this connection live in one D4Sign account: keys of another account would ask for
  // them where they are not. D4Sign must know each of them.
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
    return { ok: false, code: thrown instanceof SignatureAuthError ? "token_refused" : "provider_unavailable" };
  }

  // Each document's webhook carries the secret in its address (0254): an account connected again keeps the one its
  // documents already have, so their deliveries are still taken; a new one only when the old seal does not open.
  const previousSecret = hadKeys ? await d4signWebhookSecret(place, "signatures.reconnect") : null;
  const secret = previousSecret ?? randomBytes(32).toString("base64url");
  const sealed = await access.vault.seal(
    place,
    {
      provider: "d4sign",
      token_api: tokenApi,
      ...(cryptKey ? { crypt_key: cryptKey } : {}),
      safe_uuid: safe.uuid,
      environment,
      webhook_secret: secret,
    },
    {
      metadata: {
        environment,
        safe_name: safe.name.slice(0, 120),
        webhook_secret_sha256: webhookSecretHash(secret),
      },
    },
  );
  if (sealed.kind !== "sealed") {
    await undo();
    return { ok: false, code: `vault_${sealed.code}` };
  }
  refresh();
  return { ok: true, code: "connected" };
}

// ---------- A document to be signed ----------

export async function requestSignature(input: {
  caseId: string;
  documentId: string;
  method: SignatureMethod;
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
    // This envelope (and only this one) is opened here, before the answer. The sweep catches what did not finish.
    try {
      await openReservedEnvelopes(createServiceClient(), 1, result.envelopeId);
    } catch {
      // Still reserved: the sweep opens it.
    }
  }
  if (result.ok && input.method === "d4sign") {
    // D4Sign takes several calls to open one (0254): opened right after the answer, the sweep taking what did not end.
    const envelopeId = result.envelopeId;
    soon("signatures.open", () => openReservedEnvelopes(createServiceClient(), 1, envelopeId));
  }
  if (result.ok) refresh(input.caseId);
  return result;
}

/**
 * Ends an envelope. The database cancels it at once (`cancel_signature`);
 * one pending at the firm's signature account has its cancel there recorded as owed, sent here
 * right away and by the sweep until the provider answered. A cut account never
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
  if (result.ok) {
    refresh(caseId);
    // What ONE asks after the signature (0181): the interview starts now, not at the next sweep.
    queueInterview({ caseId });
  }
  return result;
}

/** Asks the firm's signature account now how an envelope stands, instead of waiting for its webhook. */
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

/**
 * A paper of a test case signed in one click (migration 0138): the database checks it is a test case's and who may
 * write on it; the backend keeps a copy of the paper as its signed document and records it through the very function a
 * provider's signature goes through, its evidence saying it was simulated. Never a real case.
 */
export async function simulateTestSignature(caseId: string, envelopeId: string): Promise<SignatureResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(envelopeId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("test_signature_to_simulate", { target_envelope: envelopeId });
  const gate = (data ?? {}) as { ok?: boolean; code?: string; org_id?: string; storage_path?: string };
  if (error || gate.ok !== true || !gate.org_id || !gate.storage_path) {
    return { ok: false, code: error ? "failed" : (gate.code ?? "failed") };
  }
  const service = createServiceClient();
  const store = supabaseFileStore(service);
  const original = await store.get(gate.storage_path);
  if (!original) return { ok: false, code: "document_not_found" };
  const reserved = await store.reserve({
    orgId: gate.org_id,
    purpose: "signed",
    name: "assinatura-simulada.pdf",
    mime: "application/pdf",
    bytes: original.length,
  });
  if (!reserved.ok) return { ok: false, code: "failed" };
  try {
    await store.put(reserved.storagePath, original, "application/pdf");
    const measure = await measureFile(original);
    const confirmed = await store.confirm(reserved.fileId, measure);
    if (!confirmed.ok) throw new Error("not confirmed");
    const { data: recorded, error: recordError } = await service.rpc("record_signature_signed", {
      target_envelope: envelopeId,
      target_file: reserved.fileId,
      target_sha256: measure.sha256,
      target_evidence: [{ signer: "Assinatura simulada em caso de teste", signed_at: new Date().toISOString() }],
    });
    const code = recordError ? "failed" : String((recorded as { code?: string } | null)?.code ?? "failed");
    if (code !== "signed") {
      await takeBackFile(store, reserved.fileId, reserved.storagePath);
      return { ok: false, code };
    }
    refresh(caseId);
    queueInterview({ caseId });
    return { ok: true, code: "signed" } as SignatureResult;
  } catch {
    await takeBackFile(store, reserved.fileId, reserved.storagePath).catch(() => undefined);
    return { ok: false, code: "failed" };
  }
}
