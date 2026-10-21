import ContactForm from "./contact-form";
import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import BreadcrumbJsonLd from "@/components/marketing/breadcrumb-json-ld";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  return {
    title: t("contact-meta-title"),
    description: t("contact-meta-description"),
    ...publicPageMetadata({ path: "/contato", locale }),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("marketing");

  return (
    <Section spacing="compact">
      <BreadcrumbJsonLd home={t("nav-home")} trail={[{ name: t("nav-contact"), path: "/contato" }]} />
      <SectionHeader title={t("contact-title")} subtitle={t("contact-subtitle")} as="h1" />
      <Reveal>
        <ContactForm />
      </Reveal>
    </Section>
  );
}
