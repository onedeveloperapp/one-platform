import { NextResponse } from "next/server";

import { openPanel } from "@/lib/chatwoot/panel";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's panel of attendance, entered from ONE's list of the conversations (migration 0223): this address makes
 * the person in the panel and sends them to the link that enters it signed in, on the conversation of `?c=` when
 * there is one. What kept them out comes back to `/atendimento`, said there, with the conversation still chosen.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getMemberContext();
  if (!context) return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  const asked = new URL(request.url).searchParams.get("c");
  const conversation = asked && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null;
  const outcome = await openPanel(context, { conversation });
  if (outcome.ok) return NextResponse.redirect(outcome.url);
  const back = new URL("/atendimento", request.url);
  if (conversation) back.searchParams.set("c", conversation);
  back.searchParams.set("painel", outcome.code.replace(/[^a-z0-9_]/g, "").slice(0, 40) || "failed");
  return NextResponse.redirect(back);
}
