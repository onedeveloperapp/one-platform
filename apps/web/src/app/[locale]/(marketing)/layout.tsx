import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BRAND } from "@/brand";
import CookieConsent from "@/components/consent/cookie-consent";
import MarketingAnalytics from "@/components/consent/marketing-analytics";
import MarketingTrackers from "@/components/consent/marketing-trackers";
import MarketingFooter from "@/components/marketing/marketing-footer";
import MarketingHeader from "@/components/marketing/marketing-header";
import SiteJsonLd from "@/components/marketing/site-json-ld";
import SupportWidget from "@/components/support/support-widget";
import { getLaunchStage, navCtaFor, primaryCtaFor } from "@/lib/launch";
import { getLegalEntity, getSupportChannels } from "@/lib/platform-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  // Defaults only: every page states its own address and Open Graph URL
  // through publicPageMetadata (lib/seo.ts).
  return {
    description: t("home-meta-description"),
    openGraph: { siteName: BRAND.name, type: "website" },
  };
}

/**
 * Public site chrome: no admin layout, no auth required. Every page in this
 * group is declared in src/i18n/routing.ts, which is also what makes the
 * middleware treat it as public.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [t, support, stage, legalEntity] = await Promise.all([
    getTranslations("marketing"),
    getSupportChannels(),
    getLaunchStage(),
    getLegalEntity(),
  ]);
  const cta = primaryCtaFor(stage);
  const primaryCta = { label: t(cta.labelKey), href: cta.href };
  const nav = navCtaFor(stage);
  const navCta = { label: t(nav.labelKey), href: nav.href };
  return (
    <div className="bg-background flex min-h-[100dvh] flex-col">
      {/* Site-wide identity for search + AI engines; rebrands with @flyee/content. */}
      <SiteJsonLd />
      <MarketingHeader navCta={navCta} />
      <main className="flex flex-1 flex-col">{children}</main>
      <MarketingFooter primaryCta={primaryCta} legalEntity={legalEntity} />
      <SupportWidget support={support} />
      <CookieConsent />
      {/* SSR Pixel/GA4 (opt-out) + SPA pageviews, on the public site only:
          no tracker runs inside the logged area. */}
      <MarketingTrackers />
      <MarketingAnalytics />
    </div>
  );
}
