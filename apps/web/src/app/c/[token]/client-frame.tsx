import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Box, Paper, Typography } from "@mui/material";

import { type ClientLinkView, openClientLink } from "@/lib/cases/client-link";
import { isPreviewRobot } from "@/lib/links/preview-robot";

/** The column every page of a client's link is written in. */
export function Frame({ children }: { children: React.ReactNode }) {
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

export type OpenClientLink = Extract<ClientLinkView, { state: "open" }>;

/**
 * A client's link opened for a page of it (the folder, the papers to sign): the open link, or the notice its visitor
 * reads instead. The robot a messenger sends to draw a preview gets no case at all, its visit never counted as the
 * client's.
 */
export async function openOrNotice(token: string): Promise<{ view: OpenClientLink } | { notice: React.ReactNode }> {
  const t = await getTranslations("product");
  if (isPreviewRobot((await headers()).get("user-agent") ?? "")) {
    return { notice: <Notice title={t("client-preview-title")} body={t("client-preview-body")} /> };
  }
  const view = await openClientLink(token);
  if (view.state === "unavailable") {
    return { notice: <Notice title={t("client-unavailable-title")} body={t("client-unavailable-body")} /> };
  }
  if (view.state === "missing") {
    return { notice: <Notice title={t("client-missing-link-title")} body={t("client-missing-link-body")} /> };
  }
  if (view.state === "revoked" || view.state === "expired") {
    return {
      notice: (
        <Notice
          title={t("client-ended-title")}
          body={
            view.state === "revoked"
              ? t("client-revoked-body", { firm: view.firm })
              : t("client-expired-body", { firm: view.firm })
          }
        />
      ),
    };
  }
  return { view };
}
