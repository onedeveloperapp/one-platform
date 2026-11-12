import { NextResponse } from "next/server";

import { handleOpenWaDelivery } from "@/lib/whatsapp/inbox";

/**
 * The webhook of the platform's OpenWA (migration 0221), for every firm whose number is linked by WhatsApp Web:
 * OpenWA posts here what happens on each session, and each event is routed by its session to the one firm whose
 * number it is (`lib/whatsapp/inbox.ts`). A delivery is taken only when its `X-OpenWA-Signature` is the HMAC of the
 * raw body under the platform's secret. A 503 asks OpenWA to bring the delivery again (it retries what was not
 * taken). Nothing of what a delivery says is written to the logs, only counts.
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("Invalid webhook", { status: 400 });
  }

  const outcome = await handleOpenWaDelivery(rawBody, request.headers.get("x-openwa-signature"));
  if (!outcome.ok) {
    if (outcome.status !== 401 && outcome.code !== "sending_now") {
      console.warn("openwa_webhook_not_taken", { code: outcome.code });
    }
    return new NextResponse(outcome.code, { status: outcome.status });
  }

  const { report } = outcome;
  if (report.failed > 0 || report.unrouted > 0) {
    console.warn("openwa_webhook_delivery", {
      events: report.events,
      failed: report.failed,
      unrouted: report.unrouted,
    });
  }
  return new NextResponse("ok", { status: 200 });
}
