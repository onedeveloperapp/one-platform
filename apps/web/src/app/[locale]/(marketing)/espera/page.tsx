import WaitlistForm from "./waitlist-form";
import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import BreadcrumbJsonLd from "@/components/marketing/breadcrumb-json-ld";
import Faq from "@/components/marketing/faq";
import Hero from "@/components/marketing/hero";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  return {
    title: t("waitlist-meta-title"),
    description: t("waitlist-meta-description"),
    ...publicPageMetadata({ path: "/espera", locale }),
  };
}

const FAQ_ITEMS = [1, 2, 3] as const;

/**
 * The waitlist: who ONE is for, the form in the hero, and the plain answers a
 * visitor needs before giving an e-mail. Nothing here promises a date, a price
 * or a number the database does not hold.
 */
export default async function WaitlistPage() {
  const t = await getTranslations("marketing");

  return (
    <>
      <BreadcrumbJsonLd home={t("nav-home")} trail={[{ name: t("waitlist-eyebrow"), path: "/espera" }]} />
      <Hero
        track="hero"
        eyebrow={t("waitlist-eyebrow")}
        title={t.rich("waitlist-title", { em: (chunks) => <em>{chunks}</em> })}
        subtitle={t("waitlist-subtitle")}
        action={<WaitlistForm />}
        note={t("waitlist-note")}
      />

      <Faq
        track="faq"
        eyebrow={t("waitlist-faq-eyebrow")}
        title={t("waitlist-faq-title")}
        items={FAQ_ITEMS.map((index) => ({
          question: t(`waitlist-faq-${index}-question`),
          answer: t(`waitlist-faq-${index}-answer`),
        }))}
      />
    </>
  );
}
