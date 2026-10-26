import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import Section from "@/components/marketing/section";

export type HeroCta = { label: string; href: string; icon?: React.ReactNode };

/**
 * Funnel stage: attention + value proposition. Above the fold it must answer
 * what the product is, for whom, and the outcome — before any scrolling.
 * `media` is the product-as-proof slot (usually <ProductFrame> with a real
 * screenshot); the primary CTA label is THE conversion action of the page.
 *
 * Entrance is the page's ONE orchestrated motion moment (committed direction):
 * copy staggers in, then the media rises — a load sequence, not a scroll
 * reveal. It is CSS (style/layout/marketing-motion.css, keyed on `data-hero`),
 * so it starts with the first paint instead of after hydration, and this
 * component needs no script. Reduced motion renders everything static and
 * visible.
 */
export default function Hero({
  eyebrow,
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  action,
  note,
  highlights,
  strip,
  media,
  layout = "center",
  decor = "glow",
  track,
}: {
  eyebrow?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  /** Accepts rich content (e.g. t.rich with <em> for the two-tone blueprint headline). */
  title: React.ReactNode;
  subtitle: string;
  /** The page's conversion action. Required unless `action` replaces the buttons. */
  primaryCta?: HeroCta;
  secondaryCta?: HeroCta;
  /**
   * Replaces the CTA buttons with the conversion itself when it fits in the
   * hero (the waitlist form). It joins the copy column, so it enters with the
   * load timeline like the buttons would.
   */
  action?: React.ReactNode;
  /** Risk-reducing microcopy under the CTAs (e.g. "No card required"). */
  note?: string;
  /**
   * Short reassurance chips under the copy ("Bilíngue", "Na IA que você já
   * usa"…). Split layout only; rendered as a hairline-topped row.
   */
  highlights?: string[];
  /**
   * Center layout only: a quiet "works with" line between the actions and the
   * media (a label, then names as muted wordmarks). Names are text, never logos
   * of other companies (docs/DESIGN.md).
   */
  strip?: { label: string; items: string[] };
  /** Product evidence. Required in practice — a hero without it fails the premium bar. */
  media?: React.ReactNode;
  /** "center": stacked, media below. "split": copy left, media right (data/product-heavy pages). */
  layout?: "center" | "split";
  decor?: "glow" | "grid" | "none";
}) {
  // How many lines the copy column renders, for the delay of the media.
  const extra = layout === "split" ? highlights?.length : strip?.items.length;
  const lines = [eyebrow, title, subtitle, true, note, extra].filter(Boolean).length;
  const entrance = { "--hero-media-delay": `${((lines - 1) * 0.12 + 0.25).toFixed(2)}s` } as React.CSSProperties;

  const ctas = action ?? (
    <div className="flex flex-col items-center gap-2 sm:flex-row">
      {primaryCta && (
        <Button
          size="large"
          variant="contained"
          color="primary"
          href={primaryCta.href}
          LinkComponent={Link}
          data-track="cta_click"
          data-track-cta-id="hero"
        >
          {primaryCta.label}
        </Button>
      )}
      {secondaryCta && (
        <Button
          size="large"
          variant="pastel"
          color="primary"
          href={secondaryCta.href}
          LinkComponent={Link}
          startIcon={secondaryCta.icon}
          data-track="cta_click"
          data-track-cta-id="hero_secondary"
        >
          {secondaryCta.label}
        </Button>
      )}
    </div>
  );

  const noteLine = note ? <p className="text-text-secondary -mt-2 text-sm">{note}</p> : null;

  if (layout === "split") {
    return (
      <Section spacing="default" decor={decor} className="overflow-hidden" track={track}>
        {/* 0.84/1.16 = the blueprint's copy/visual ratio (attachment hero). */}
        <div
          data-hero
          style={entrance}
          className="grid grid-cols-1 items-center gap-10 md:grid-cols-[0.84fr_1.16fr] md:gap-10"
        >
          <div data-hero-copy className="flex flex-col items-start gap-6 text-left">
            {eyebrow && <p className="text-primary font-eyebrow tracking-eyebrow text-xs uppercase">{eyebrow}</p>}
            <h1 className="font-display text-display-xl text-text-primary [&_em]:text-primary font-extrabold [&_em]:not-italic">
              {title}
            </h1>
            <p className="text-text-secondary text-lg leading-6 md:text-xl md:leading-7">{subtitle}</p>
            {ctas}
            {noteLine}
            {highlights && highlights.length > 0 && (
              <ul className="border-grey-100 flex w-full flex-wrap gap-x-5 gap-y-2 border-t pt-4">
                {highlights.map((item) => (
                  <li key={item} className="text-text-secondary flex items-center gap-1.5 text-sm font-semibold">
                    <span aria-hidden className="bg-accent-1 h-1.5 w-1.5 flex-none rounded-full" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {media && (
            <div data-hero-media className="w-full">
              {media}
            </div>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section spacing="default" decor={decor} className="overflow-hidden" track={track}>
      <div data-hero style={entrance} className="flex flex-col items-center">
        <div data-hero-copy className="flex flex-col items-center gap-6 text-center">
          {eyebrow && <p className="text-primary font-eyebrow tracking-eyebrow text-xs uppercase">{eyebrow}</p>}

          {/* display-xl over a wider measure: the title takes two lines and the
              product below it starts above the fold (docs/HOME-COPY.md). */}
          <h1 className="font-display text-display-xl text-text-primary [&_em]:text-primary max-w-5xl font-extrabold [&_em]:not-italic">
            {title}
          </h1>

          <p className="text-text-secondary max-w-2xl text-lg leading-6 md:text-xl md:leading-7">{subtitle}</p>

          {ctas}
          {noteLine}
          {strip && strip.items.length > 0 && (
            <div className="mt-2 flex flex-col items-center gap-2">
              <p className="text-text-secondary text-sm">{strip.label}</p>
              <ul className="flex flex-row flex-wrap items-center justify-center gap-x-8 gap-y-2">
                {strip.items.map((item) => (
                  <li key={item} className="text-text-secondary font-heading text-xl font-bold tracking-tight">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {media && (
          <div data-hero-media className="mt-10 w-full max-w-4xl">
            {media}
          </div>
        )}
      </div>
    </Section>
  );
}
