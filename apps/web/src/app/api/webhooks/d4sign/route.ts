import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

import { RETRY_SOON, syncEnvelope } from "@/lib/signatures/work";
import { createServiceClient } from "@flyee/auth/service";
import { readD4SignWebhook } from "@flyee/signatures/providers/d4sign";

/**
 * The webhook of D4Sign (migration 0253): D4Sign posts here what happens to a document ONE opened at a firm's account
 * (one signer signed, the document finished, it was cancelled, an e-mail did not reach a signer), at the address ONE
 * gave that document: ONE's envelope and the secret of the firm's connection, in its query.
 *
 * A delivery is taken only when it names the envelope ONE opened, D4Sign's document is that envelope's, and the secret
 * is the connection's: checked by its hash, kept beside the connection, before anything is opened. D4Sign's own HMAC
 * is not used: it takes a third key of the account, and D4Sign's pages disagree on what it covers. What the delivery
 * says is never taken as the state: the envelope is read again from D4Sign with the firm's keys. Nothing of a delivery
 * is written to the logs. D4Sign tries again for 27 hours what was not answered with 200.
 */

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refused = () => new NextResponse("Forbidden", { status: 403 });

/** What D4Sign posted, as form data (multipart or URL-encoded), or as JSON should it ever send one. */
async function fieldsOf(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const parsed: unknown = JSON.parse(await request.text());
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    }
    if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      return Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]),
      );
    }
    return Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return null;
  }
}

/** The secret of the address against the hash kept for the connection, in constant time. */
function sameSecret(given: string, keptSha256: string | null | undefined): boolean {
  if (!given || !/^[0-9a-f]{64}$/.test(keptSha256 ?? "")) return false;
  const received = createHash("sha256").update(given, "utf8").digest();
  return timingSafeEqual(received, Buffer.from(String(keptSha256), "hex"));
}

export async function POST(request: Request) {
  const address = new URL(request.url);
  const envelopeId = address.searchParams.get("envelope") ?? "";
  const key = address.searchParams.get("key") ?? "";
  if (!UUID.test(envelopeId) || key.length < 20 || key.length > 200) return refused();
  if (Number(request.headers.get("content-length") ?? "0") > 1_000_000) return refused();

  const fields = await fieldsOf(request);
  const event = fields ? readD4SignWebhook(fields) : null;
  // Something that is not an event about a document: nothing to do, and nothing to retry.
  if (!event) return NextResponse.json({ ok: true, ignored: true });

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return new NextResponse("Unavailable", { status: 503 });
  }
  const { data } = await service.rpc("signature_envelope_for_backend", { target_envelope: envelopeId });
  const envelope = (data ?? {}) as {
    found?: boolean;
    method?: string;
    provider_id?: string | null;
    webhook_secret_sha256?: string | null;
  };
  if (!envelope.found || envelope.method !== "d4sign") return refused();
  if (!sameSecret(key, envelope.webhook_secret_sha256)) return refused();
  // The envelope ONE opened is this document of D4Sign's; another document of the account says nothing of it.
  if (envelope.provider_id && envelope.provider_id.toLowerCase() !== event.documentUuid.toLowerCase()) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const code = await syncEnvelope(service, envelopeId);
    // What is worth trying again soon (D4Sign or the storage did not answer, the signed file was not ready) is
    // answered 503, so D4Sign delivers it again; the rest is taken.
    if (RETRY_SOON.includes(code)) return new NextResponse("Unavailable", { status: 503 });
    return NextResponse.json({ ok: true, code });
  } catch {
    return new NextResponse("Unavailable", { status: 503 });
  }
}
