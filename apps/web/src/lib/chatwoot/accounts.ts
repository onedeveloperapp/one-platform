import "server-only";

import { randomBytes } from "node:crypto";

import { chatwootFeatures, chatwootWebhookUrl, REPLY_WINDOW_HOURS } from "@/lib/chatwoot/provider";
import { type ChatwootProvider, ChatwootRequestError, ChatwootUnavailableError } from "@flyee/chatwoot/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's account in the panel (migration 0223): made once, step by step, each step kept as it ends, so a
 * failure halfway is finished by the next try and never makes a second account. Four things make it: the account,
 * its service person (ONE, an administrator of this account only, who writes the conversations), the person of the
 * firm's phone ("Celular do WhatsApp", who writes what the firm typed on its phone), and the inbox of the API kind
 * whose webhook is ONE's. Only Chatwoot's numbers are kept; a token is read when a work needs it and kept in this
 * server's memory for a few minutes, never written anywhere.
 */

export type ReadyAccount = {
  orgId: string;
  accountId: number;
  serviceUserId: number;
  phoneUserId: number;
  inboxId: number;
  mirrorFrom: string;
};

type AccountRow = {
  org_id: string | null;
  status: string | null;
  account_id: number | null;
  service_user_id: number | null;
  phone_user_id: number | null;
  inbox_id: number | null;
  mirror_from: string | null;
};

export type AccountOutcome = { ok: true; account: ReadyAccount } | { ok: false; code: string };

/** A password nobody types: the panel is always entered through ONE. Letters, digits and the symbol Chatwoot asks. */
const password = (): string => `${randomBytes(24).toString("base64url")}Aa1!`;

/** Addresses of the account's own people, of a domain that receives nothing: nobody enters with them. */
const serviceEmail = (orgId: string): string => `one-${orgId}@servico.one.invalid`;
const phoneEmail = (orgId: string): string => `celular-${orgId}@servico.one.invalid`;

export const SERVICE_NAME = "ONE";
export const PHONE_NAME = "Celular do WhatsApp";

function readyOf(row: AccountRow | null): ReadyAccount | null {
  if (!row?.org_id || row.status !== "ready") return null;
  if (!row.account_id || !row.service_user_id || !row.phone_user_id || !row.inbox_id || !row.mirror_from) return null;
  return {
    orgId: row.org_id,
    accountId: row.account_id,
    serviceUserId: row.service_user_id,
    phoneUserId: row.phone_user_id,
    inboxId: row.inbox_id,
    mirrorFrom: row.mirror_from,
  };
}

/** The firm's account when it is ready, read only. */
export async function readyAccount(service: SupabaseClient, orgId: string): Promise<ReadyAccount | null> {
  const { data } = await service
    .from("chatwoot_accounts")
    .select("org_id, status, account_id, service_user_id, phone_user_id, inbox_id, mirror_from")
    .eq("org_id", orgId)
    .maybeSingle();
  return readyOf((data ?? null) as AccountRow | null);
}

/** The account of a delivery, by Chatwoot's number of it. */
export async function accountByChatwootId(service: SupabaseClient, accountId: number): Promise<ReadyAccount | null> {
  const { data } = await service
    .from("chatwoot_accounts")
    .select("org_id, status, account_id, service_user_id, phone_user_id, inbox_id, mirror_from")
    .eq("account_id", accountId)
    .maybeSingle();
  return readyOf((data ?? null) as AccountRow | null);
}

const codeOf = (error: unknown): string =>
  error instanceof ChatwootRequestError
    ? `chatwoot_${error.status}`
    : error instanceof ChatwootUnavailableError
      ? "chatwoot_unavailable"
      : "failed";

/**
 * The firm's account, made or finished here when it is not ready. Another server making it at the same moment
 * answers `busy`, and the next try finds it ready.
 */
export async function ensureAccount(
  service: SupabaseClient,
  provider: ChatwootProvider,
  orgId: string,
): Promise<AccountOutcome> {
  const { data: claimed, error } = await service.rpc("chatwoot_claim_account", { target_org: orgId });
  if (error) return { ok: false, code: "failed" };
  const row = (claimed ?? null) as AccountRow | null;
  const ready = readyOf(row);
  if (ready) return { ok: true, account: ready };
  if (!row?.org_id) return { ok: false, code: "busy" };

  const keep = async (fields: {
    target_account?: number;
    target_service_user?: number;
    target_phone_user?: number;
    target_inbox?: number;
    target_ready?: boolean;
    target_error?: string;
  }) => {
    const { error: kept } = await service.rpc("chatwoot_keep_account", { target_org: orgId, ...fields });
    if (kept) throw new Error(`chatwoot_keep_account failed: ${kept.message}`);
  };

  try {
    let accountId = row.account_id;
    if (!accountId) {
      const { data: firm } = await service.from("organizations").select("name").eq("id", orgId).maybeSingle();
      const name = String((firm as { name?: string } | null)?.name ?? "Escritório").slice(0, 100);
      accountId = (await provider.platform.createAccount({ name, features: chatwootFeatures() })).id;
      await keep({ target_account: accountId });
    }

    let serviceUserId = row.service_user_id;
    if (!serviceUserId) {
      serviceUserId = (
        await provider.platform.createUser({ name: SERVICE_NAME, email: serviceEmail(orgId), password: password() })
      ).id;
      await provider.platform.addAccountUser(accountId, serviceUserId, "administrator");
      await keep({ target_service_user: serviceUserId });
    }

    let phoneUserId = row.phone_user_id;
    if (!phoneUserId) {
      phoneUserId = (
        await provider.platform.createUser({ name: PHONE_NAME, email: phoneEmail(orgId), password: password() })
      ).id;
      await provider.platform.addAccountUser(accountId, phoneUserId, "agent");
      await keep({ target_phone_user: phoneUserId });
    }

    let inboxId = row.inbox_id;
    const token = await userToken(provider, serviceUserId);
    const account = provider.account(accountId, token);
    if (!inboxId) {
      const inbox = await account.createApiInbox({
        name: "WhatsApp",
        webhookUrl: chatwootWebhookUrl(),
        replyWindowHours: REPLY_WINDOW_HOURS,
      });
      inboxId = inbox.id;
      if (inbox.secret) remember(secrets, inboxId, inbox.secret);
      await keep({ target_inbox: inboxId });
    }
    // The person of the phone writes in the inbox's conversations: an agent reaches only an inbox they are in.
    await account.addInboxMembers(inboxId, [phoneUserId]);

    await keep({ target_ready: true });
    const after = await readyAccount(service, orgId);
    return after ? { ok: true, account: after } : { ok: false, code: "failed" };
  } catch (failure) {
    const code = codeOf(failure);
    await service.rpc("chatwoot_keep_account", { target_org: orgId, target_error: code });
    return { ok: false, code };
  }
}

// ---------- Tokens and the inbox's secret, read when needed ----------

const TOKEN_TTL_MS = 10 * 60_000;
type Remembered = { value: string; at: number };
const memory = globalThis as typeof globalThis & {
  __oneChatwootTokens?: Map<number, Remembered>;
  __oneChatwootSecrets?: Map<number, Remembered>;
};
const tokens = (memory.__oneChatwootTokens ??= new Map());
const secrets = (memory.__oneChatwootSecrets ??= new Map());

function remember(store: Map<number, Remembered>, key: number, value: string): void {
  store.set(key, { value, at: Date.now() });
}

function recall(store: Map<number, Remembered>, key: number): string | null {
  const found = store.get(key);
  if (!found || Date.now() - found.at > TOKEN_TTL_MS) return null;
  return found.value;
}

/** A person's token of the panel's API, read through the platform's app. */
export async function userToken(provider: ChatwootProvider, userId: number): Promise<string> {
  const known = recall(tokens, userId);
  if (known) return known;
  const user = await provider.platform.user(userId);
  if (!user.accessToken) throw new ChatwootRequestError(200, "no_token_for_person");
  remember(tokens, userId, user.accessToken);
  return user.accessToken;
}

/** The secret the inbox signs its webhook with, read by the account's service person. */
export async function inboxSecret(
  provider: ChatwootProvider,
  account: ReadyAccount,
  fresh = false,
): Promise<string | null> {
  if (!fresh) {
    const known = recall(secrets, account.inboxId);
    if (known) return known;
  }
  const token = await userToken(provider, account.serviceUserId);
  const inbox = await provider.account(account.accountId, token).inbox(account.inboxId);
  if (inbox.secret) remember(secrets, account.inboxId, inbox.secret);
  return inbox.secret;
}

/** The service person's view of the firm's account. */
export async function serviceAccount(provider: ChatwootProvider, account: ReadyAccount) {
  return provider.account(account.accountId, await userToken(provider, account.serviceUserId));
}
