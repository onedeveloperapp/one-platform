import { getLocale, getTranslations } from "next-intl/server";

import BreadcrumbJsonLd from "@/components/marketing/breadcrumb-json-ld";
import Link from "@/components/marketing/locale-link";
import MarkdownProse from "@/components/marketing/markdown-prose";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { getLegalTerm, type LegalSlug } from "@/lib/legal";

/**
 * One legal page: the version in force of a consent term, in the language of
 * the address (`consent_terms`, migration 0001, v1 seeded in 0018). The page
 * shows exactly the text a person accepts, with its version and date; the
 * message catalogs hold only the chrome around it.
 *
 * When the text cannot be read, the page says so and points at the contact
 * page. It never falls back to another text presented as the terms.
 */
export default async function LegalDocument({
  slug,
  path,
  fallbackTitleKey,
  breadcrumbKey,
}: {
  slug: LegalSlug;
  /** Internal (Portuguese) path of the page, for the breadcrumb. */
  path: string;
  /** Marketing key of the page title when the text is unavailable. */
  fallbackTitleKey: string;
  /** Marketing key of the breadcrumb label. */
  breadcrumbKey: string;
}) {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  const term = await getLegalTerm(slug, locale);

  const version = term
    ? t("legal-version", {
        version: term.version,
        date: new Date(term.publishedAt).toLocaleDateString(locale, {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      })
    : undefined;

  return (
    <Section spacing="compact">
      <BreadcrumbJsonLd home={t("nav-home")} trail={[{ name: t(breadcrumbKey), path }]} />
      <SectionHeader
        as="h1"
        align="start"
        className="mx-0"
        title={term?.title ?? t(fallbackTitleKey)}
        subtitle={version}
      />
      {term ? (
        <MarkdownProse className="mx-0">{term.bodyMd}</MarkdownProse>
      ) : (
        <div className="border-grey-100 flex max-w-2xl flex-col gap-2 rounded-3xl border border-dashed p-6">
          <p className="text-text-primary font-semibold">{t("legal-unavailable-title")}</p>
          <p className="text-text-secondary text-base leading-6">
            {t("legal-unavailable-body")}{" "}
            <Link href="/contato" className="text-primary underline">
              {t("nav-contact")}
            </Link>
          </p>
        </div>
      )}
    </Section>
  );
}
