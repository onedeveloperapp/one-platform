import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import Cta from "@/components/marketing/cta";
import FeatureGrid from "@/components/marketing/feature-grid";
import Hero from "@/components/marketing/hero";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiMessageCheck from "@/icons/nexture/ni-message-check";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("marketing")]);
  return {
    title: { absolute: t("one-home-meta-title") },
    description: t("one-home-meta-description"),
    ...publicPageMetadata({ path: "/", locale }),
  };
}

/**
 * The public home of ONE while the product is being built (M0): what it is,
 * for whom, three things it does, and the way onto the waitlist. Nothing here
 * is a number, a logo or a testimonial, because there is none to show yet.
 */
export default async function Home() {
  const t = await getTranslations("marketing");
  const waitlist = { label: t("cta-waitlist"), href: "/espera" };
  const contact = { label: t("one-home-cta-contact"), href: "/contato" };

  return (
    <>
      <Hero
        track="hero"
        eyebrow={t("one-home-eyebrow")}
        title={t("one-home-title")}
        subtitle={t("one-home-subtitle")}
        primaryCta={waitlist}
        secondaryCta={contact}
        note={t("one-home-note")}
      />
      <FeatureGrid
        title={t("one-home-points-title")}
        subtitle={t("one-home-points-subtitle")}
        features={[
          {
            icon: <NiDocumentCheck size="large" />,
            title: t("one-home-point-docs-title"),
            description: t("one-home-point-docs-body"),
          },
          {
            icon: <NiClipboard size="large" />,
            title: t("one-home-point-filing-title"),
            description: t("one-home-point-filing-body"),
          },
          {
            icon: <NiMessageCheck size="large" />,
            title: t("one-home-point-client-title"),
            description: t("one-home-point-client-body"),
          },
        ]}
      />
      <Cta
        title={t("one-home-cta-title")}
        subtitle={t("one-home-cta-subtitle")}
        cta={waitlist}
        secondaryCta={contact}
      />
    </>
  );
}
