import { Frame, openOrNotice } from "../client-frame";
import ClientSign from "./client-sign";
import type { Metadata } from "next";

import { readClientTasks } from "@/lib/cases/client-link";
import { sweepWhileUsed } from "@/lib/jobs/while-used";

/**
 * The papers a client signs, alone (0237): the address ONE writes in the chat with a paper signed by gov.br, so the
 * client lands on what to sign and its steps, with nothing else of the case around them (the owner's test of
 * 2026-11-13: the whole folder left the client looking for where to sign). The rest of the folder is one link away.
 * The same rules as the folder: no referrer, never indexed, no tracker, nothing for a messenger's preview robot.
 */
export const metadata: Metadata = {
  title: { absolute: "Assinar" },
  description: null,
  icons: { icon: [{ url: "data:," }], apple: [] },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// What the client sees is read on every request: never a page cached for another token.
export const dynamic = "force-dynamic";

export default async function ClientSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opened = await openOrNotice(token);
  if ("notice" in opened) return opened.notice;

  // A signed file the client sends is checked by the sweeps that serve what people wait on: they run while used.
  sweepWhileUsed();
  return (
    <Frame>
      <ClientSign token={token} view={opened.view} tasks={await readClientTasks(token)} />
    </Frame>
  );
}
