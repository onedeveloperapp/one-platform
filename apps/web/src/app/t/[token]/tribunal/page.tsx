import TestCourt from "./test-court";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Paper, Typography } from "@mui/material";

import { readTestCourt } from "@/lib/test-court/actions";

/**
 * A firm's test court (migration 0061): the page behind the test chat's own
 * link, where whoever tests acts as the court of the firm's test cases. It
 * receives a filing package and hands the number and the receipt, then
 * moves each test lawsuit as a court would, and publishes to the firm's
 * lawyers as the DJEN would. No account: the token in the address is the way
 * in, for that firm only. Nothing leaves ONE. Like the test chat, it asks
 * browsers to send no referrer and search engines to keep away, and it loads
 * no tracker.
 */
export const metadata: Metadata = {
  title: { absolute: "Tribunal de teste" },
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

export default async function TestCourtPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("product");
  const read = await readTestCourt(token);
  if (!read.ok) {
    return read.code === "unavailable" ? (
      <Notice title={t("test-court-unavailable-title")} body={t("test-chat-unavailable-body")} />
    ) : (
      <Notice title={t("test-court-missing-title")} body={t("test-chat-missing-body")} />
    );
  }
  return <TestCourt token={token} initial={read.view} />;
}
