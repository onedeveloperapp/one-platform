import { NextResponse } from "next/server";

import { createServiceClient } from "@flyee/auth/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one-click exit of the partner's weekly digest (RFC 8058, migration 0200): the mail client posts here when the
 * reader presses its own "unsubscribe" button. The person's own unsubscribe token stops that e-mail, and nothing else.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!UUID.test(token)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { error } = await createServiceClient().rpc("stop_weekly_digest", { target_token: token });
  return error
    ? NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The link in the body, followed by a person (or opened by a mail scanner): it changes nothing, and leads to the
 * person's settings, where they stop the digest in one click. The redirect is relative, as the agenda's is.
 */
export function GET() {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/settings#resumo-semanal", "Cache-Control": "no-store" },
  });
}
