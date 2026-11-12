import { NextResponse } from "next/server";

import { handleChatwootDelivery } from "@/lib/chatwoot/webhook";

/**
 * The webhook of every firm's inbox in the panel of attendance (migration 0223): Chatwoot posts here what happens
 * in the inbox's conversations, signed with the inbox's secret (`X-Chatwoot-Signature` over the timestamp and the
 * raw body), and ONE acts on what a person of the firm wrote to the client and on a change of who answers. A
 * refusal answers with its status; nothing of what a delivery says is written to the logs, only codes.
 */

export const maxDuration = 30;

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("invalid", { status: 400 });
  }
  const outcome = await handleChatwootDelivery(rawBody, {
    timestamp: request.headers.get("x-chatwoot-timestamp"),
    signature: request.headers.get("x-chatwoot-signature"),
  });
  if (outcome.status >= 500 || (outcome.status >= 400 && outcome.status !== 401)) {
    console.warn("chatwoot_webhook_not_taken", { code: outcome.code });
  }
  return new NextResponse(outcome.code, { status: outcome.status });
}
