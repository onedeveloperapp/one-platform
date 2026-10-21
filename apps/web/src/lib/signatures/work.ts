import "server-only";

import { getVault } from "@/lib/connections/vault";
import { supabaseFileStore } from "@/lib/files/store";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import {
  ZapSignAuthError,
  type ZapSignEnvironment,
  ZapSignProvider,
  ZapSignUnavailableError,
} from "@flyee/signatures/providers/zapsign";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a signature (migration 0023): opening at ZapSign the
 * envelopes a person reserved, and keeping ONE in step with what ZapSign says
 * of them. Every step is a function of the database that the service role
 * alone may call; the firm's token is opened from the vault per piece of work
 * and never leaves this file.
 */

export type ZapSignAccess =
  | { ok: true; provider: ZapSignProvider; webhookId: string | null }
  | { ok: false; code: string };

type Place = { orgId: string; connectionId: string };

const isEnvironment = (value: unknown): value is ZapSignEnvironment => value === "production" || value === "sandbox";

/** The firm's ZapSign, from the token sealed for that connection. */
export async function zapSignFor(place: Place, purpose: string): Promise<ZapSignAccess> {
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const opened = await access.vault.open(place, purpose);
  if (opened.kind !== "opened") return { ok: false, code: `vault_${opened.code}` };
  const token = opened.payload.api_token;
  const environment = opened.payload.environment;
  if (!token || !isEnvironment(environment)) return { ok: false, code: "vault_token_missing" };
  return {
    ok: true,
    provider: new ZapSignProvider({ apiToken: token, environment }),
    webhookId: opened.payload.webhook_id ?? null,
  };
}

/** ZapSign refused the token: the connection is marked, so the firm is told to reconnect. */
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
  signers: { position: number; name: string }[];
};

const title = (name: string) => name.replace(/\.pdf$/i, "").slice(0, 200) || "Documento";

/**
 * Opens at ZapSign the envelopes waiting for it (or the one named). One whose
 * answer never came (the network, a 5xx, a success that could not be read)
 * stays claimed and becomes uncertain by itself: it is never opened twice.
 * One ZapSign read and refused is failed, with a short code. ZapSign gets the
 * signers' names only: it writes to nobody, and the signature is on screen.
 */
export async function openReservedEnvelopes(
  service: SupabaseClient,
  limit = 10,
  envelopeId: string | null = null,
): Promise<{ opened: number; failed: number }> {
  const { data, error } = await service.rpc("claim_signature_envelopes", {
    target_limit: limit,
    target_envelope: envelopeId,
  });
  if (error) throw new Error(`claim_signature_envelopes failed: ${error.message}`);
  const store = supabaseFileStore(service);
  let opened = 0;
  let failed = 0;
  for (const envelope of (data ?? []) as Claimed[]) {
    const fail = async (code: string) => {
      failed += 1;
      await service.rpc("record_signature_failed", { target_envelope: envelope.envelope_id, target_code: code });
    };
    if (!envelope.connection_id) {
      await fail("no_account");
      continue;
    }
    const place = { orgId: envelope.org_id, connectionId: envelope.connection_id };
    const access = await zapSignFor(place, "signatures.open");
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
    try {
      const made = await access.provider.createEnvelope({
        pdf,
        title: title(envelope.title),
        signers: signers.map((signer) => ({ name: signer.name })),
        externalId: envelope.envelope_id,
      });
      const { data: recorded } = await service.rpc("record_signature_opened", {
        target_envelope: envelope.envelope_id,
        target_provider_id: made.id,
        target_sign_urls: made.signers.map((signer) => signer.signUrl),
      });
      if ((recorded as { ok?: boolean } | null)?.ok) opened += 1;
    } catch (thrown) {
      if (thrown instanceof ZapSignAuthError) {
        await fail("token_refused");
        await reportTokenRefused(place);
      } else if (thrown instanceof ZapSignUnavailableError && thrown.status !== null && thrown.status < 500) {
        // ZapSign read the request and said no: nothing was opened.
        await fail("refused_by_provider");
      }
      // Anything else: nobody can tell whether ZapSign opened it. It stays claimed and becomes uncertain.
    }
  }
  return { opened, failed };
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
 * What a sync could not settle and is worth asking again soon: ZapSign or the
 * storage did not answer, or the signed file was not ready yet. The webhook
 * answers these with 503, so ZapSign delivers again; the rest (an account
 * cut, a document ZapSign does not know) would fail the same way.
 */
export const RETRY_SOON = ["provider_unavailable", "storage_unavailable", "not_recorded"];

/**
 * Asks ZapSign how an envelope stands and records it: the signatures so far,
 * an end (refused, expired), or the signed PDF, which the backend keeps in the
 * firm's files and adds to the case. What it could not settle (the account
 * cut, a document ZapSign does not know, no answer) is recorded too, so the
 * sweep asks the others first and the case screen can say why. A delivery
 * that already opened the firm's ZapSign hands it over instead of opening the
 * vault again.
 */
export async function syncEnvelope(
  service: SupabaseClient,
  envelopeId: string,
  opened: ZapSignAccess | null = null,
): Promise<string> {
  const { data, error } = await service.rpc("signature_envelope_for_backend", { target_envelope: envelopeId });
  if (error) throw new Error(`signature_envelope_for_backend failed: ${error.message}`);
  const envelope = (data ?? { found: false }) as EnvelopeState;
  if (!envelope.found) return "not_found";
  if (
    envelope.method !== "zapsign" ||
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

  const access = opened ?? (await zapSignFor(place, "signatures.sync"));
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

    const signed = await access.provider.downloadSigned(envelope.provider_id);
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
    return unsettled(thrown instanceof ZapSignAuthError ? "token_refused" : "provider_unavailable");
  }
}

/** The ZapSign envelopes nobody heard of for a while: asked again, the ones settled least recently first. */
export async function pollPendingEnvelopes(service: SupabaseClient, limit = 50): Promise<number> {
  const { data, error } = await service.rpc("signature_envelopes_to_poll", { target_limit: limit });
  if (error) throw new Error(`signature_envelopes_to_poll failed: ${error.message}`);
  let asked = 0;
  for (const row of (data ?? []) as { envelope_id: string }[]) {
    try {
      await syncEnvelope(service, row.envelope_id);
      asked += 1;
    } catch {
      // The database did not answer for this one: the next sweep asks again.
    }
  }
  return asked;
}

/**
 * Sends to ZapSign the cancels a person made in ONE (`cancel_signature` marks
 * them owed): the signing addresses stop working there. What ZapSign answered
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
  for (const row of (data ?? []) as {
    envelope_id: string;
    org_id: string;
    connection_id: string;
    provider_id: string;
    reason: string | null;
  }[]) {
    const failed = (code: string) =>
      service.rpc("record_signature_cancel_failed", { target_envelope: row.envelope_id, target_code: code });
    const access = await zapSignFor({ orgId: row.org_id, connectionId: row.connection_id }, "signatures.cancel");
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
      await failed(thrown instanceof ZapSignAuthError ? "token_refused" : "provider_unavailable");
    }
  }
  return sent;
}
