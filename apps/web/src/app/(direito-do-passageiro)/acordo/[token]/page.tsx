import AgreementView from "./agreement-view";
import RightsSection from "./rights-section";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Box, Paper, Typography } from "@mui/material";

import { sweepWhileUsed } from "@/lib/jobs/while-used";
import { isPreviewRobot } from "@/lib/links/preview-robot";
import { openAgreement } from "@/modules/direito-do-passageiro/agency/link";

/**
 * The page behind the link a travel agency sends its passenger (migration 0070, `pax_link_open`): the passenger
 * agrees, or not, that ONE follows their flights and that the firm the agency works with tells them of a problem,
 * for themself and the children they answer for, and may send their documents. No account: the token in the
 * address is the way in, until the agency issues another or it expires.
 *
 * The token is in the address, so the page asks browsers to send no referrer and search engines to keep away, and
 * it loads no tracker. The robot a messenger sends to draw a preview of the link gets nothing of the passenger.
 */
export const metadata: Metadata = {
  title: { absolute: "Seus voos" },
  description: null,
  icons: { icon: [{ url: "data:," }], apple: [] },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// What the passenger sees is read on every request: never a page cached for another token.
export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <Box className="flex min-h-screen w-full justify-center px-4 py-8 sm:py-14">
      <Box className="flex w-full max-w-3xl flex-col gap-6">{children}</Box>
    </Box>
  );
}

/** What the link says when there is nothing to agree to, and, under it, what the passenger may still do. */
function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
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
      {children}
    </Frame>
  );
}

export default async function AgreementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("product");
  if (isPreviewRobot((await headers()).get("user-agent") ?? "")) {
    return <Notice title={t("pax-link-preview-title")} body={t("pax-link-preview-body")} />;
  }
  const view = await openAgreement(token);
  if (!view) return <Notice title={t("pax-link-unavailable-title")} body={t("pax-link-unavailable-body")} />;
  if (view.state === "missing") return <Notice title={t("pax-link-missing-title")} body={t("pax-link-missing-body")} />;
  if (view.state === "ended" || view.state === "expired") {
    return <Notice title={t("pax-link-ended-title")} body={t("pax-link-ended-body", { agency: view.agency })} />;
  }
  // The agency may still keep the passenger for a few days after the partnership ended or their data went to the
  // firm: their rights over it stay on the link meanwhile.
  if (view.state === "partnership_ended") {
    if (!view.rights) {
      return (
        <Notice title={t("pax-link-ended-title")} body={t("pax-link-partnership-body", { agency: view.agency })} />
      );
    }
    return (
      <Notice title={t("pax-link-ended-title")} body={t("pax-link-partnership-rights-body", { agency: view.agency })}>
        <RightsSection token={token} agency={view.agency} firm={null} variant="ended" />
      </Notice>
    );
  }
  if (view.state === "handed_over") {
    return (
      <Notice title={t("pax-link-handed-title")} body={t("pax-link-handed-body", { firm: view.firm })}>
        <RightsSection token={token} agency={view.agency} firm={view.firm} variant="handed_over" />
      </Notice>
    );
  }
  // The passenger is here, waiting for what ONE reads of what they send: the sweeps that serve what people wait on
  // run now and then, after the answer.
  sweepWhileUsed();
  return (
    <Frame>
      <AgreementView token={token} initial={view} />
    </Frame>
  );
}
