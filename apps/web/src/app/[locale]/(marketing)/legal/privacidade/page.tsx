import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import LegalDocument from "@/components/marketing/legal-document";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  return { title: t("privacy-meta-title"), ...publicPageMetadata({ path: "/legal/privacidade", locale }) };
}

/** Privacy policy: the `privacy` consent term in force, in the language of the address. */
export default function PrivacyPage() {
  return (
    <LegalDocument
      slug="privacy"
      path="/legal/privacidade"
      fallbackTitleKey="privacy-title"
      breadcrumbKey="footer-privacy"
    />
  );
}
