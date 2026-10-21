import { readConfirmationToken } from "../confirmation-token";
import ConfirmPanel from "./confirm-panel";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  // A one-time link: nothing here for a search engine (out of the sitemap too).
  return { title: t("waitlist-confirm-meta-title"), robots: { index: false, follow: false } };
}

/**
 * Where the double opt-in link lands. The link is `/espera/confirmar?t=<token>`;
 * the middleware moves the token into an httpOnly cookie and reloads the page
 * at the clean address, so here only its presence is known.
 */
export default async function WaitlistConfirmPage() {
  const [t, token] = await Promise.all([getTranslations("marketing"), readConfirmationToken()]);

  return (
    <Section decor="glow">
      <SectionHeader
        as="h1"
        eyebrow={t("waitlist-eyebrow")}
        title={t("waitlist-confirm-title")}
        subtitle={t("waitlist-confirm-subtitle")}
      />
      <ConfirmPanel pending={token !== null} />
    </Section>
  );
}
