import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { metaApp } from "@/lib/whatsapp/config";
import { handleDelivery } from "@/lib/whatsapp/inbox";

/**
 * The one webhook of WhatsApp, for every firm: the vendor posts here whatever
 * happens on any connected number, and each event is routed by the number it
 * carries (`lib/whatsapp/inbox.ts`).
 *
 * It authenticates itself: a delivery is taken only when its
 * `X-Hub-Signature-256` is the HMAC of the raw body under the platform's app
 * secret. Nothing of what a delivery says is written to the logs, only counts.
 */

// A piece of shared history is thousands of messages in one delivery.
export const maxDuration = 60;

const sameText = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The vendor checks that the address is ours before it posts anything: it sends a token and expects its challenge back. */
export async function GET(request: Request) {
  const platform = metaApp();
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge") ?? "";
  if (
    !platform ||
    params.get("hub.mode") !== "subscribe" ||
    !sameText(params.get("hub.verify_token") ?? "", platform.verifyToken) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("Invalid webhook", { status: 400 });
  }

  const outcome = await handleDelivery(rawBody, request.headers.get("x-hub-signature-256"));
  if (!outcome.ok) {
    if (outcome.status !== 401) console.warn("whatsapp_webhook_not_taken", { code: outcome.code });
    return new NextResponse(outcome.code, { status: outcome.status });
  }

  const { report } = outcome;
  if (report.failed > 0 || report.unrouted > 0) {
    console.warn("whatsapp_webhook_delivery", {
      provider: outcome.provider,
      events: report.events,
      applied: report.applied,
      unrouted: report.unrouted,
      failed: report.failed,
    });
  }
  // Every write is idempotent, so what failed is asked for again: a second
  // delivery repeats nothing of what the first one already recorded.
  return NextResponse.json({ received: report.failed === 0 }, { status: report.failed === 0 ? 200 : 500 });
}
