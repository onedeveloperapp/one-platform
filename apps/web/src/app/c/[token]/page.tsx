import ClientFolder from "./client-folder";
import { Frame, openOrNotice } from "./client-frame";
import type { Metadata } from "next";

import { readClientTasks } from "@/lib/cases/client-link";
import { sweepWhileUsed } from "@/lib/jobs/while-used";

/**
 * A client's folder: the page behind the link a firm sends a passenger
 * (migration 0022, `client_link_open`). The passenger has no account: the
 * token in the address is their way in, for one person of one case, until
 * the firm ends it or it expires.
 *
 * The page carries the firm's name, never the platform's: its title stands
 * alone (no platform suffix), its icon is blank and the preview card of the
 * link is a plain one (`app/c/opengraph-image.tsx`). The token is in the
 * address, so the page asks browsers to send no referrer and search engines
 * to keep away, and it loads no tracker (no analytics component is mounted
 * outside the public site's layout). The robot a messenger sends to draw a
 * preview of the link gets no case at all: the client's data never leaves
 * for it, and its visit is not counted as the client's.
 */
export const metadata: Metadata = {
  title: { absolute: "Seu caso" },
  description: null,
  icons: { icon: [{ url: "data:," }], apple: [] },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// What the client sees is read on every request: never a page cached for another token.
export const dynamic = "force-dynamic";

/** The day in Brazil's official time: who is a minor is decided by it. */
const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export default async function ClientLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opened = await openOrNotice(token);
  if ("notice" in opened) return opened.notice;

  // The client is here, and the page reads itself again while something they sent waits: the sweeps that serve
  // what people wait on run now and then, after the answer (a check that failed is tried again).
  sweepWhileUsed();
  return (
    <Frame>
      <ClientFolder token={token} view={opened.view} tasks={await readClientTasks(token)} today={todayInBrazil()} />
    </Frame>
  );
}
