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
    links: [{ key: "nav-sign-in", href: "/auth/sign-in" }],
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
 * The site closes on a light area with the logo and the columns, and under
 * it a thin deep band with the rights and the operating company, as the
 * home's blueprint of 2026-10-26 draws it. `legalEntity` is the company the
 * terms and the privacy policy point at ("identified in the site footer");
 * `primaryCta` follows the launch stage like the header, and opens the
 * account column.
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
    <footer className="w-full">
      <div className="bg-grey-25 border-grey-100 border-t">
        <Container className="flex flex-col gap-10 py-12 md:flex-row md:justify-between md:py-16">
          <div className="flex max-w-xs flex-col gap-3">
            <Link href="/" aria-label={t("nav-home")} className="flex items-center">
              <Logo classNameFull="block" classNameMobile="hidden" />
            </Link>
            <p className="text-text-secondary text-base leading-6">{t("footer-tagline")}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:gap-16">
            {COLUMNS.map((column) => (
              <div key={column.titleKey} className="flex flex-col gap-2">
                <p className="text-text-primary font-heading text-base font-bold">{t(column.titleKey)}</p>
                {column.titleKey === "footer-account" && (
                  <Link
                    href={primaryCta.href}
                    className="text-text-secondary hover:text-text-primary text-base leading-6 transition-colors"
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
                    className="text-text-secondary hover:text-text-primary text-base leading-6 transition-colors"
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
        </Container>
      </div>

      <div className="bg-background-deep text-text-contrast/70">
        <Container className="flex flex-col items-center gap-1 py-5 text-center text-sm md:flex-row md:justify-between md:text-left">
          <p>
            © {new Date().getFullYear()} {BRAND.name}. {t("footer-rights")}
          </p>
          {legalEntity && (
            <p>
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
        </Container>
      </div>
    </footer>
  );
}
