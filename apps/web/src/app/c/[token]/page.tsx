import ClientFolder from "./client-folder";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Box, Paper, Typography } from "@mui/material";

import { openClientLink, readClientTasks } from "@/lib/cases/client-link";
import { sweepWhileUsed } from "@/lib/jobs/while-used";
import { isPreviewRobot } from "@/lib/links/preview-robot";

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

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <Box className="flex min-h-screen w-full justify-center px-4 py-8 sm:py-14">
      <Box className="flex w-full max-w-3xl flex-col gap-6">{children}</Box>
    </Box>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <Paper elevation={0} className="bg-background-paper rounded-4xl px-6 py-10 sm:px-12">
        <Typography variant="h1" component="h1" className="mb-3">
          {title}
        </Typography>
        <Typography variant="body1" className="text-text-primary">
          {body}
        </Typography>
      </Paper>
    </Frame>
  );
}

/** The day in Brazil's official time: who is a minor is decided by it. */
const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export default async function ClientLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("product");
  if (isPreviewRobot((await headers()).get("user-agent") ?? "")) {
    return <Notice title={t("client-preview-title")} body={t("client-preview-body")} />;
  }
  const view = await openClientLink(token);

  if (view.state === "unavailable") {
    return <Notice title={t("client-unavailable-title")} body={t("client-unavailable-body")} />;
  }
  if (view.state === "missing") {
    return <Notice title={t("client-missing-link-title")} body={t("client-missing-link-body")} />;
  }
  if (view.state === "revoked" || view.state === "expired") {
    return (
      <Notice
        title={t("client-ended-title")}
        body={
          view.state === "revoked"
            ? t("client-revoked-body", { firm: view.firm })
            : t("client-expired-body", { firm: view.firm })
        }
      />
    );
  }

  // The client is here, and the page reads itself again while something they sent waits: the sweeps that serve
  // what people wait on run now and then, after the answer (a check that failed is tried again).
  sweepWhileUsed();
  return (
    <Frame>
      <ClientFolder token={token} view={view} tasks={await readClientTasks(token)} today={todayInBrazil()} />
    </Frame>
  );
}
