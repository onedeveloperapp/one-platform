import { useTranslations } from "next-intl";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";
import Container from "@/components/marketing/container";
import Link from "@/components/marketing/locale-link";
import type { LegalEntity } from "@/lib/platform-settings";
import { formatCnpj } from "@flyee/fields";

// Internal paths, written as public addresses by LocaleLink.
const COLUMNS = [
  {
    titleKey: "footer-product",
    links: [
      { key: "footer-blog", href: "/blog" },
      { key: "footer-help", href: "/ajuda" },
    ],
  },
  {
    titleKey: "footer-account",
    links: [
      { key: "nav-sign-in", href: "/auth/sign-in" },
      { key: "footer-waitlist", href: "/espera" },
    ],
  },
  {
    titleKey: "footer-company",
    links: [
      { key: "nav-contact", href: "/contato" },
      { key: "footer-terms", href: "/legal/termos" },
      { key: "footer-privacy", href: "/legal/privacidade" },
      { key: "footer-cookies", href: "/legal/cookies" },
    ],
  },
] as const;

/**
 * The site closes on the deep band. `legalEntity` is the operating
 * company the terms and the privacy policy point at ("identified in the site
 * footer"); `primaryCta` follows the launch stage like the header.
 */
export default function MarketingFooter({
  primaryCta,
  legalEntity,
}: {
  primaryCta: { label: string; href: string };
  legalEntity: LegalEntity | null;
}) {
  const t = useTranslations("marketing");

  return (
    <footer className="bg-background-deep text-text-contrast w-full">
      <Container className="flex flex-col gap-10 py-12 md:py-16">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="flex max-w-xs flex-col gap-3">
            <Link href="/" aria-label={t("nav-home")} className="flex items-center">
              <Logo classNameFull="block" classNameMobile="hidden" tone="contrast" />
            </Link>
            <p className="text-text-contrast/65 text-base leading-5">{t("footer-tagline")}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.titleKey} className="flex flex-col gap-2">
                <p className="text-text-contrast/80 font-eyebrow tracking-eyebrow text-xs uppercase">
                  {t(column.titleKey)}
                </p>
                {column.titleKey === "footer-account" && (
                  <Link
                    href={primaryCta.href}
                    className="text-text-contrast/60 hover:text-text-contrast text-base leading-6 transition-colors"
                    data-track="cta_click"
                    data-track-cta-id="footer"
                  >
                    {primaryCta.label}
                  </Link>
                )}
                {column.links.map((link) => (
                  <Link
                    key={link.key}
                    href={link.href}
                    className="text-text-contrast/60 hover:text-text-contrast text-base leading-6 transition-colors"
                    {...(link.key === "nav-contact"
                      ? { "data-track": "contact_click", "data-track-location": "footer" }
                      : {})}
                  >
                    {t(link.key)}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="border-text-contrast/15 flex flex-col gap-2 border-t pt-6">
          <div className="flex flex-col gap-1">
            <p className="text-text-contrast/60 text-sm">
              © {new Date().getFullYear()} {BRAND.name}. {t("footer-rights")}
            </p>
            {legalEntity && (
              <p className="text-text-contrast/60 text-sm">
                {[
                  legalEntity.name,
                  legalEntity.document
                    ? t("footer-legal-document", { document: formatCnpj(legalEntity.document) })
                    : null,
                  legalEntity.city,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
      </Container>
    </footer>
  );
}
