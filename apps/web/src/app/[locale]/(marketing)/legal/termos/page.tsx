import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import LegalDocument from "@/components/marketing/legal-document";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  return { title: t("terms-meta-title"), ...publicPageMetadata({ path: "/legal/termos", locale }) };
}

/** Terms of use: the `terms` consent term in force, in the language of the address. */
export default function TermsPage() {
  return (
    <LegalDocument slug="terms" path="/legal/termos" fallbackTitleKey="terms-title" breadcrumbKey="footer-terms" />
  );
}
