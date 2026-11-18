import "server-only";

import { getVault } from "@/lib/connections/vault";
import { tellSignatureLinks } from "@/lib/conversations/signature-links-work";
import { supabaseFileStore } from "@/lib/files/store";
import { type AccountMethod, isAccountMethod } from "@/lib/signatures/methods";
import { BRAND } from "@flyee/content";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { D4SignProvider, d4signWebhookUrl } from "@flyee/signatures/providers/d4sign";
import { type ZapSignEnvironment, ZapSignProvider } from "@flyee/signatures/providers/zapsign";
import { type AccountSignatureProvider, SignatureAuthError, SignatureUnavailableError } from "@flyee/signatures/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a signature (migration 0023, D4Sign since 0253): opening at the firm's signature account
 * (ZapSign or D4Sign) the envelopes a person or ONE reserved, and keeping ONE in step with what the provider says of
 * them. Every step is a function of the database that the service role alone may call; the firm's keys are opened
 * from the vault per piece of work and never leave this file.
 */

export type ZapSignAccess =
  | { ok: true; provider: ZapSignProvider; webhookId: string | null }
  | { ok: false; code: string };

/** The firm's signature account, whichever its provider: what the sweeps and the webhooks work with. */
export type SignatureAccess =
  | { ok: true; method: AccountMethod; provider: AccountSignatureProvider }
  | { ok: false; code: string };

type Place = { orgId: string; connectionId: string };

const isEnvironment = (value: unknown): value is ZapSignEnvironment => value === "production" || value === "sandbox";

/** The firm's ZapSign, from the token sealed for that connection: its connection and its webhook (`actions.ts`). */
export async function zapSignFor(place: Place, purpose: string): Promise<ZapSignAccess> {
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const opened = await access.vault.open(place, purpose);
  if (opened.kind !== "opened") return { ok: false, code: `vault_${opened.code}` };
  if (opened.payload.provider === "d4sign") return { ok: false, code: "vault_token_missing" };
  const token = opened.payload.api_token;
  const environment = opened.payload.environment;
  if (!token || !isEnvironment(environment)) return { ok: false, code: "vault_token_missing" };
  return {
    ok: true,
    provider: new ZapSignProvider({ apiToken: token, environment }),
    webhookId: opened.payload.webhook_id ?? null,
  };
}

/**
 * The firm's signature account, from what was sealed for that connection: D4Sign's keys and safe (0253), or
 * ZapSign's token (a seal with no provider is ZapSign's, as every seal made before D4Sign).
 */
export async function signatureAccountFor(place: Place, purpose: string): Promise<SignatureAccess> {
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const opened = await access.vault.open(place, purpose);
  if (opened.kind !== "opened") return { ok: false, code: `vault_${opened.code}` };
  const payload = opened.payload;
  const environment = payload.environment;
  if (!isEnvironment(environment)) return { ok: false, code: "vault_token_missing" };
  if (payload.provider === "d4sign") {
    // The cryptKey only where the account enabled it (D4Sign's reference).
    if (!payload.token_api || !payload.safe_uuid || !payload.webhook_secret) {
      return { ok: false, code: "vault_token_missing" };
    }
    const secret = payload.webhook_secret;
    return {
      ok: true,
      method: "d4sign",
      provider: new D4SignProvider({
        tokenApi: payload.token_api,
        cryptKey: payload.crypt_key ?? null,
        safeUuid: payload.safe_uuid,
        environment,
        webhookFor: (envelopeId) => d4signWebhookUrl(BRAND.siteUrl, envelopeId, secret),
      }),
    };
  }
  if (!payload.api_token) return { ok: false, code: "vault_token_missing" };
  return { ok: true, method: "zapsign", provider: new ZapSignProvider({ apiToken: payload.api_token, environment }) };
}

/**
 * The secret in the webhook addresses of a D4Sign connection's documents, from its seal (0254): an account connected
 * again keeps it, so the documents already open are still heard. Null when the seal does not open or is not D4Sign's.
 */
export async function d4signWebhookSecret(place: Place, purpose: string): Promise<string | null> {
  const access = getVault();
  if (!access.ok) return null;
  const opened = await access.vault.open(place, purpose).catch(() => null);
  if (!opened || opened.kind !== "opened" || opened.payload.provider !== "d4sign") return null;
  const secret = opened.payload.webhook_secret;
  return typeof secret === "string" && secret.length >= 20 ? secret : null;
}

/** D4Sign's limit of calls an hour was reached (0254): what this account still owes waits for the next hour. */
const isRateLimited = (thrown: unknown): boolean =>
  thrown instanceof SignatureUnavailableError && thrown.code === "provider_rate_limited";

/** How long an envelope given back for the provider's limit waits before it is claimed again, in minutes. */
const RATE_LIMIT_WAIT = 60;

/** The provider refused the account's keys: the connection is marked, so the firm is told to reconnect. */
export async function reportTokenRefused(place: Place): Promise<void> {
  const vault = getVault();
  if (vault.ok) await vault.vault.report(place, false, "token_refused").catch(() => undefined);
}

type Claimed = {
  envelope_id: string;
  org_id: string;
  connection_id: string | null;
  file_id: string;
  storage_path: string;
  title: string;
  signers: { position: number; name: string; person_id?: string | null }[];
};

const title = (name: string) => name.replace(/\.pdf$/i, "").slice(0, 200) || "Documento";

/**
 * Opens at the firm's signature account the envelopes waiting for it (or the one named). One whose
 * answer never came (the network, a 5xx, a success that could not be read)
 * stays claimed and becomes uncertain by itself: it is never opened twice.
 * One the provider read and refused is failed, with a short code. One the provider would not take for its limit of
 * calls an hour (D4Sign, 0254) is given back to wait, with the account's other envelopes of this round, which are
 * not tried: nothing was opened, and the next hour opens them. The provider gets the signers' names (and, for
 * D4Sign, their e-mails) only: it writes to nobody, and the signature is on screen.
 */
export async function openReservedEnvelopes(
  service: SupabaseClient,
  limit = 10,
  envelopeId: string | null = null,
): Promise<{ opened: number; failed: number; waiting: number }> {
  const { data, error } = await service.rpc("claim_signature_envelopes", {
    target_limit: limit,
    target_envelope: envelopeId,
  });
  if (error) throw new Error(`claim_signature_envelopes failed: ${error.message}`);
  const store = supabaseFileStore(service);
  let opened = 0;
  let failed = 0;
  let waiting = 0;
  // The accounts whose limit of calls this round reached: their envelopes wait without a call.
  const limited = new Set<string>();
  for (const envelope of (data ?? []) as Claimed[]) {
    const fail = async (code: string) => {
      failed += 1;
      await service.rpc("record_signature_failed", { target_envelope: envelope.envelope_id, target_code: code });
    };
    const wait = async (code: string, minutes: number) => {
      waiting += 1;
      await service.rpc("record_signature_retry", {
        target_envelope: envelope.envelope_id,
        target_code: code,
        target_minutes: minutes,
      });
    };
    if (!envelope.connection_id) {
      await fail("no_account");
      continue;
    }
    if (limited.has(envelope.connection_id)) {
      await wait("provider_rate_limited", RATE_LIMIT_WAIT);
      continue;
    }
    const place = { orgId: envelope.org_id, connectionId: envelope.connection_id };
    const access = await signatureAccountFor(place, "signatures.open");
    if (!access.ok) {
      await fail(access.code);
      continue;
    }
    const pdf = await store.get(envelope.storage_path);
    if (!pdf) {
      await fail("file_unreadable");
      continue;
    }
    const signers = [...envelope.signers].sort((a, b) => a.position - b.position);
    // D4Sign names every signer by an e-mail and sends it the token of the signature (0253): each signer's e-mail on
    // record goes, and only to D4Sign. ZapSign gets the names alone. E-mails that could not be read are not taken
    // as missing: the envelope waits a little and is tried again.
    let emails: Map<string, string> | null = null;
    if (access.method === "d4sign") {
      emails = await signerEmails(service, signers);
      if (!emails) {
        await wait("emails_unreadable", 10);
        continue;
      }
    }
    try {
      const made = await access.provider.createEnvelope({
        pdf,
        title: title(envelope.title),
        signers: signers.map((signer) => ({
          name: signer.name,
          ...(emails ? { email: emails.get(signer.person_id ?? "") ?? undefined } : {}),
        })),
        externalId: envelope.envelope_id,
      });
      const { data: recorded } = await service.rpc("record_signature_opened", {
        target_envelope: envelope.envelope_id,
        target_provider_id: made.id,
        target_sign_urls: made.signers.map((signer) => signer.signUrl),
      });
      if ((recorded as { ok?: boolean } | null)?.ok) opened += 1;
    } catch (thrown) {
      if (thrown instanceof SignatureAuthError) {
        await fail("token_refused");
        await reportTokenRefused(place);
      } else if (isRateLimited(thrown)) {
        // D4Sign took no more calls this hour: nothing was sent to the signers (a document left half made was
        // cancelled, or is a draft nobody was sent), and this envelope is opened again in an hour.
        limited.add(place.connectionId);
        await wait("provider_rate_limited", RATE_LIMIT_WAIT);
      } else if (thrown instanceof SignatureUnavailableError && thrown.status !== null && thrown.status < 500) {
        // The provider read the request and said no (or ONE could not ask it, a signer with no e-mail): nothing was
        // opened, and what it said is kept when it tells more than a refusal.
        await fail(thrown.code ?? "refused_by_provider");
      }
      // Anything else: nobody can tell whether the provider opened it. It stays claimed and becomes uncertain.
    }
  }
  // The links just opened go to the people who sign in the chat, now (0231); the sweep takes what this did not.
  if (opened > 0) await tellSignatureLinks(service).catch(() => undefined);
  return { opened, failed, waiting };
}

/** Each signer's e-mail on record, by person: what D4Sign names a signer by. Null when they could not be read. */
async function signerEmails(
  service: SupabaseClient,
  signers: { person_id?: string | null }[],
): Promise<Map<string, string> | null> {
  const ids = signers.map((signer) => signer.person_id).filter((id): id is string => typeof id === "string" && !!id);
  if (ids.length === 0) return new Map();
  const { data, error } = await service.from("people").select("id, email").in("id", ids);
  if (error) return null;
  return new Map(
    ((data ?? []) as { id: string; email: string | null }[])
      .filter((person) => person.email)
      .map((person) => [person.id, String(person.email)]),
  );
}

class StorageUnavailable extends Error {}

type EnvelopeState = {
  found: boolean;
  org_id: string;
  method: string;
  status: string;
  connection_id: string | null;
  provider_id: string | null;
};

/** What `syncEnvelope` settled: the envelope's new state, or why it could not. */
export const SETTLED = ["pending", "refused", "expired", "signed", "already_signed", "unchanged", "nothing_to_do"];

/**
 * What a sync could not settle and is worth asking again soon: the provider or the
 * storage did not answer, or the signed file was not ready yet. The webhook
 * answers these with 503, so the provider delivers again; the rest (an account
 * cut, a document the provider does not know) would fail the same way.
 */
export const RETRY_SOON = ["provider_unavailable", "provider_rate_limited", "storage_unavailable", "not_recorded"];

/**
 * Asks the firm's signature account how an envelope stands and records it: the signatures so far,
 * an end (refused, expired), or the signed PDF, which the backend keeps in the
 * firm's files and adds to the case. What it could not settle (the account
 * cut, a document the provider does not know, no answer) is recorded too, so the
 * sweep asks the others first and the case screen can say why. A delivery
 * that already opened the firm's account hands it over instead of opening the
 * vault again.
 */
export async function syncEnvelope(
  service: SupabaseClient,
  envelopeId: string,
  opened: SignatureAccess | null = null,
): Promise<string> {
  const { data, error } = await service.rpc("signature_envelope_for_backend", { target_envelope: envelopeId });
  if (error) throw new Error(`signature_envelope_for_backend failed: ${error.message}`);
  const envelope = (data ?? { found: false }) as EnvelopeState;
  if (!envelope.found) return "not_found";
  if (
    !isAccountMethod(envelope.method) ||
    envelope.status !== "pending" ||
    !envelope.provider_id ||
    !envelope.connection_id
  ) {
    return "nothing_to_do";
  }
  const place = { orgId: envelope.org_id, connectionId: envelope.connection_id };
  const unsettled = async (code: string) => {
    await service.rpc("record_signature_checked", { target_envelope: envelopeId, target_code: code });
    return code;
  };

  const access = opened ?? (await signatureAccountFor(place, "signatures.sync"));
  if (!access.ok) return unsettled(access.code);

  try {
    const state = await access.provider.getStatus(envelope.provider_id);
    if (!state) return unsettled("unknown_at_provider");
    if (state.status !== "signed") {
      const { data: recorded, error: statusError } = await service.rpc("record_signature_status", {
        target_envelope: envelopeId,
        target_status: state.status,
        target_signed_at: state.signers.map((signer) => signer.signedAt ?? ""),
      });
      if (statusError) return "not_recorded";
      return String((recorded as { code?: string } | null)?.code ?? "not_recorded");
    }

    // The state just read is handed over, so the download asks no status again (one call fewer, 0254).
    const signed = await access.provider.downloadSigned(envelope.provider_id, state);
    const store = supabaseFileStore(service);
    const reserved = await store.reserve({
      orgId: envelope.org_id,
      purpose: "signed",
      name: `assinado-${envelope.provider_id}.pdf`,
      mime: "application/pdf",
      bytes: signed.pdf.length,
    });
    // The purpose refused it (too large, not a PDF): delivering it again would not change that.
    if (!reserved.ok) return unsettled("signed_file_refused");
    await store.put(reserved.storagePath, signed.pdf, "application/pdf").catch(() => {
      throw new StorageUnavailable();
    });
    const measure = await measureFile(signed.pdf);
    const confirmed = await store.confirm(reserved.fileId, measure);
    if (!confirmed.ok) return unsettled("signed_file_refused");
    const { data: recorded, error: recordError } = await service.rpc("record_signature_signed", {
      target_envelope: envelopeId,
      target_file: reserved.fileId,
      target_sha256: measure.sha256,
      target_evidence: signed.evidence.map((entry) => ({ signer: entry.signerName, signed_at: entry.signedAt })),
    });
    const code = recordError ? "not_recorded" : String((recorded as { code?: string } | null)?.code ?? "not_recorded");
    // A file that did not become the envelope's (two deliveries at once, an envelope that ended) is taken
    // back, record first: when it is the answer that got lost and the file is the signed document of the
    // case after all, the database refuses to forget it.
    if (code !== "signed") await takeBackFile(store, reserved.fileId, reserved.storagePath);
    return code === "signed" || code === "already_signed" ? code : unsettled(code);
  } catch (thrown) {
    // A refusal here is not taken as the token's end (ZapSign also answers 403 for a document it
    // will not show): it is recorded on the envelope; opening an envelope is what judges the token.
    if (thrown instanceof StorageUnavailable) return unsettled("storage_unavailable");
    if (isRateLimited(thrown)) return unsettled("provider_rate_limited");
    return unsettled(thrown instanceof SignatureAuthError ? "token_refused" : "provider_unavailable");
  }
}

/**
 * The envelopes of a signature account nobody heard of for a while: asked again, the ones settled least recently
 * first. An account whose limit of calls is reached is asked no more this round (D4Sign, 0254).
 */
export async function pollPendingEnvelopes(service: SupabaseClient, limit = 50): Promise<number> {
  const { data, error } = await service.rpc("signature_envelopes_to_poll", { target_limit: limit });
  if (error) throw new Error(`signature_envelopes_to_poll failed: ${error.message}`);
  let asked = 0;
  const limited = new Set<string>();
  for (const row of (data ?? []) as { envelope_id: string; connection_id: string | null }[]) {
    if (row.connection_id && limited.has(row.connection_id)) continue;
    try {
      const code = await syncEnvelope(service, row.envelope_id);
      if (code === "provider_rate_limited" && row.connection_id) limited.add(row.connection_id);
      asked += 1;
    } catch {
      // The database did not answer for this one: the next sweep asks again.
    }
  }
  return asked;
}

/**
 * Sends to the firm's signature account the cancels a person made in ONE (`cancel_signature` marks
 * them owed): the signing addresses stop working there. What the provider answered
 * is recorded; one it did not answer stays owed for the next sweep.
 */
export async function sendProviderCancels(
  service: SupabaseClient,
  limit = 20,
  envelopeId: string | null = null,
): Promise<number> {
  const { data, error } = await service.rpc("signature_cancels_to_send", {
    target_limit: limit,
    target_envelope: envelopeId,
  });
  if (error) throw new Error(`signature_cancels_to_send failed: ${error.message}`);
  let sent = 0;
  const limited = new Set<string>();
  for (const row of (data ?? []) as {
    envelope_id: string;
    org_id: string;
    connection_id: string;
    provider_id: string;
    reason: string | null;
  }[]) {
    const failed = (code: string) =>
      service.rpc("record_signature_cancel_failed", { target_envelope: row.envelope_id, target_code: code });
    // The account took no more calls this hour (D4Sign, 0254): the cancel stays owed, for the next sweep.
    if (limited.has(row.connection_id)) continue;
    const access = await signatureAccountFor(
      { orgId: row.org_id, connectionId: row.connection_id },
      "signatures.cancel",
    );
    if (!access.ok) {
      await failed(access.code);
      continue;
    }
    try {
      const answer = await access.provider.cancelDocument(row.provider_id, row.reason ?? "");
      await service.rpc("record_signature_cancel_sent", { target_envelope: row.envelope_id, target_answer: answer });
      sent += 1;
    } catch (thrown) {
      // Still owed, asked again after the others.
      if (isRateLimited(thrown)) limited.add(row.connection_id);
      await failed(
        thrown instanceof SignatureAuthError
          ? "token_refused"
          : isRateLimited(thrown)
            ? "provider_rate_limited"
            : "provider_unavailable",
      );
    }
  }
  return sent;
}
