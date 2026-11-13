import { NextResponse } from "next/server";

import { openPanel } from "@/lib/chatwoot/panel";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's panel of attendance, entered from ONE's list of the conversations (migration 0223): this address makes
 * the person in the panel and sends them to the link that enters it signed in, on the conversation of `?c=`, or on
 * the team's room of `?sala=` (0238), when there is one. What kept them out comes back where they tried, said
 * there: `/atendimento` with the conversation still chosen, or the rooms.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getMemberContext();
  if (!context) return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  const params = new URL(request.url).searchParams;
  const id = (name: string) => {
    const value = params.get(name);
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  };
  const room = id("sala");
  const conversation = room ? null : id("c");
  const outcome = await openPanel(context, { conversation, room });
  if (outcome.ok) return NextResponse.redirect(outcome.url);
  const back = new URL(room ? "/atendimento/salas" : "/atendimento", request.url);
  if (conversation) back.searchParams.set("c", conversation);
  back.searchParams.set("painel", outcome.code.replace(/[^a-z0-9_]/g, "").slice(0, 40) || "failed");
  return NextResponse.redirect(back);
}
