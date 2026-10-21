import { NextResponse } from "next/server";

import { RETRY_SOON, syncEnvelope } from "@/lib/signatures/work";
import { createServiceClient } from "@flyee/auth/service";
import { readZapSignWebhook, ZAPSIGN_WEBHOOK_HEADER, zapSignExternalId } from "@flyee/signatures/providers/zapsign";

/**
 * The webhook of ZapSign, for every firm that connected its account: ZapSign
 * posts here what happens to any document of that account (migration 0023).
 *
 * ZapSign does not sign the body. A delivery is taken only when it names an
 * envelope ONE opened (its `external_id`) and carries, in its own header, the
 * secret ONE gave that firm's account when it connected. The secret is
 * checked by its hash, kept beside the connection, before the vault is
 * opened: a stranger who knows an envelope's id opens nothing. What the
 * delivery says is never taken as the state: the envelope is read again from
 * ZapSign with the firm's token. Nothing of a delivery is written to the logs.
 */

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const refused = () => new NextResponse("Forbidden", { status: 403 });

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 1_000_000) return refused();
  const externalId = zapSignExternalId(body);
  // A document ONE did not open (made by hand in the firm's account): nothing to do, and nothing to retry.
  if (!externalId || !UUID.test(externalId)) return NextResponse.json({ ok: true, ignored: true });

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return new NextResponse("Unavailable", { status: 503 });
  }
  const { data } = await service.rpc("signature_envelope_for_backend", { target_envelope: externalId });
  const envelope = (data ?? {}) as { found?: boolean; webhook_secret_sha256?: string | null };
  if (!envelope.found) return refused();
  const event = readZapSignWebhook({
    header: request.headers.get(ZAPSIGN_WEBHOOK_HEADER),
    secretSha256: envelope.webhook_secret_sha256,
    body,
  });
  if (!event) return refused();

  try {
    const code = await syncEnvelope(service, externalId);
    // What is worth trying again soon (ZapSign or the storage did not answer, the signed file was not
    // ready) is answered 503, so ZapSign delivers it again; the rest is taken.
    if (RETRY_SOON.includes(code)) return new NextResponse("Unavailable", { status: 503 });
    return NextResponse.json({ ok: true, code });
  } catch {
    // ZapSign retries what was not answered with 200: the next delivery, or the sweep, tries again.
    return new NextResponse("Unavailable", { status: 503 });
  }
}
