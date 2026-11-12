import TestChat from "./test-chat";
import TestFirmTools from "./test-firm-tools";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Paper, Typography } from "@mui/material";

import { readTestChat, readTestFirm } from "@/lib/test-chat/actions";

/**
 * A firm's test chat (migration 0047): the page behind the link who manages
 * the firm hands to whoever tests, standing where a passenger's phone
 * stands. No account: the token in the address is the way in, for that
 * firm's test chat only, until the firm changes the link or turns the chat
 * off. Nothing written here leaves ONE. Like a client's page, it asks
 * browsers to send no referrer and search engines to keep away, and it
 * loads no tracker. Since 2026-11-03 it is the agency's passenger's only
 * (migration 0087): the ready passengers and the real flight are gone.
 */
export const metadata: Metadata = {
  title: { absolute: "Chat de teste" },
  description: null,
  icons: { icon: [{ url: "data:," }], apple: [] },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Read on every request: never a page cached for another link.
export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Box className="flex min-h-screen w-full justify-center px-4 py-8 sm:py-14">
      <Paper elevation={0} className="bg-background-paper w-full max-w-3xl rounded-4xl px-6 py-10 sm:px-12">
        <Typography variant="h1" component="h1" className="mb-3">
          {title}
        </Typography>
        <Typography variant="body1" className="text-text-primary">
          {body}
        </Typography>
      </Paper>
    </Box>
  );
}

export default async function TestChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("product");
  const read = await readTestChat(token);
  if (!read.ok && read.code === "missing") {
    // A test firm's link (0220): its tools, with no chat, since the firm tests with its real WhatsApp number.
    const firm = await readTestFirm(token);
    if (firm.ok) return <TestFirmTools token={token} initial={firm.view} />;
  }
  if (!read.ok) {
    return read.code === "unavailable" ? (
      <Notice title={t("test-chat-unavailable-title")} body={t("test-chat-unavailable-body")} />
    ) : (
      <Notice title={t("test-chat-missing-title")} body={t("test-chat-missing-body")} />
    );
  }
  return <TestChat token={token} initial={read.view} />;
}
