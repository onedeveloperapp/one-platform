import { NextResponse } from "next/server";

import { openPanel } from "@/lib/chatwoot/panel";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's panel of attendance, entered from ONE (migration 0223): this address makes the person in the panel and
 * sends them to the link that enters it signed in. What kept them out comes back to `/atendimento`, said there.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getMemberContext();
  if (!context) return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  const outcome = await openPanel(context);
  if (outcome.ok) return NextResponse.redirect(outcome.url);
  const back = new URL("/atendimento", request.url);
  back.searchParams.set("painel", outcome.code.replace(/[^a-z0-9_]/g, "").slice(0, 40) || "failed");
  return NextResponse.redirect(back);
}
