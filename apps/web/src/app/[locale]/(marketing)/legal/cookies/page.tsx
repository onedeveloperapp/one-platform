import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import LegalDocument from "@/components/marketing/legal-document";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  return { title: t("cookies-meta-title"), ...publicPageMetadata({ path: "/legal/cookies", locale }) };
}

/** Cookie policy: the `cookies` consent term in force, in the language of the address. */
export default function CookiesPage() {
  return (
    <LegalDocument
      slug="cookies"
      path="/legal/cookies"
      fallbackTitleKey="cookies-title"
      breadcrumbKey="footer-cookies"
    />
  );
}
