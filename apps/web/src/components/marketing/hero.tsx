import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import Section from "@/components/marketing/section";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import { cn } from "@/lib/utils";

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
  tone = "default",
  badge,
  track,
}: {
  eyebrow?: string;
  /**
   * "deep": the top of the page on the deep band (center layout only): the copy
   * in the contrast text, the second part of the title (`<em>`) in a gradient
   * from the primary to the secondary, a slow wash of both behind it, and the
   * deep band ending halfway down the media, so the product's screen sits
   * across the edge between the dark top and the light page.
   */
  tone?: "default" | "deep";
  /** A short pill over the title (center layout): a fact about the product, never a claim it cannot show. */
  badge?: { label: string; icon?: React.ReactNode };
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
  const deep = tone === "deep" && layout === "center";
  // How many lines the copy column renders, for the delay of the media.
  const extra = layout === "split" ? highlights?.length : strip?.items.length;
  const lines = [badge, eyebrow, title, subtitle, true, note, extra].filter(Boolean).length;
  const entrance = { "--hero-media-delay": `${((lines - 1) * 0.12 + 0.25).toFixed(2)}s` } as React.CSSProperties;

  const ctas = action ?? (
    // Stacked on a phone, the buttons line up with the copy: centred in the centre layout, at its start in the split.
    // A row too narrow for both (the split's copy column around 1024px) puts the second under the first, never a label
    // on two lines. data-hero-actions is what <StickyCta> watches: its bar shows once these buttons left the screen.
    <div
      data-hero-actions
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap",
        layout === "split" ? "items-start" : "items-center",
      )}
    >
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
      {secondaryCta &&
        (deep ? (
          // On the deep band a pastel button reads as a grey slab: an outline in the contrast text, an arrow after it.
          <Button
            size="large"
            variant="outlined"
            href={secondaryCta.href}
            LinkComponent={Link}
            endIcon={secondaryCta.icon ?? <NiArrowRight size="small" />}
            className="border-text-contrast/35! text-text-contrast! hover:border-text-contrast! hover:bg-text-contrast/10!"
            data-track="cta_click"
            data-track-cta-id="hero_secondary"
          >
            {secondaryCta.label}
          </Button>
        ) : (
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
        ))}
    </div>
  );

  const noteLine = note ? (
    <p className={cn("-mt-2 text-sm", deep ? "text-text-contrast/65" : "text-text-secondary")}>{note}</p>
  ) : null;

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
            {/* display-lg beside the media: the title holds two lines in the narrower copy column,
                as the home's blueprint (2026-10-26) sets it, and balanced, so a screen that needs three
                never leaves one word alone on the last. */}
            <h1 className="font-display text-display-lg text-text-primary [&_em]:text-primary font-extrabold text-balance [&_em]:not-italic">
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
    <Section
      spacing="default"
      decor={deep ? "none" : decor}
      // isolate: the deep backdrop sits at -z-10 inside this section, over the page's own background.
      className={cn("overflow-hidden", deep && "isolate")}
      track={track}
    >
      <div data-hero style={entrance} className="flex flex-col items-center">
        <div data-hero-copy className="flex flex-col items-center gap-6 text-center">
          {badge && (
            <p
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                deep
                  ? "border-text-contrast/20 bg-text-contrast/5 text-text-contrast/85"
                  : "border-grey-100 bg-background-paper text-text-secondary",
              )}
            >
              {badge.icon && (
                <span aria-hidden className={cn("flex", deep ? "text-secondary-light" : "text-primary")}>
                  {badge.icon}
                </span>
              )}
              {badge.label}
            </p>
          )}
          {eyebrow && <p className="text-primary font-eyebrow tracking-eyebrow text-xs uppercase">{eyebrow}</p>}

          {/* display-xl over a wider measure: the title takes two lines and the
              product below it starts above the fold (docs/HOME-COPY.md). On the
              deep band the second part rides a gradient of the primary into the
              secondary, a step lighter so it holds 3:1 as large text on the band. */}
          <h1
            className={cn(
              "font-display text-display-xl max-w-5xl font-extrabold text-balance [&_em]:not-italic",
              deep
                ? "text-text-contrast [&_em]:from-primary-light [&_em]:to-secondary-light [&_em]:bg-linear-to-r [&_em]:[box-decoration-break:clone] [&_em]:bg-clip-text [&_em]:text-transparent"
                : "text-text-primary [&_em]:text-primary",
            )}
          >
            {title}
          </h1>

          <p
            className={cn(
              "max-w-2xl text-lg leading-6 md:text-xl md:leading-7",
              deep ? "text-text-contrast/75" : "text-text-secondary",
            )}
          >
            {subtitle}
          </p>

          {ctas}
          {noteLine}
          {strip &&
            strip.items.length > 0 &&
            (deep ? (
              // The names under a spaced capital label, both quiet: who the product works with, never a client's logo.
              <div className="mt-4 flex flex-col items-center gap-3">
                <p className="text-text-contrast/60 font-eyebrow tracking-eyebrow text-xs uppercase">{strip.label}</p>
                <ul className="flex flex-row flex-wrap items-center justify-center gap-x-8 gap-y-2">
                  {strip.items.map((item) => (
                    <li key={item} className="text-text-contrast/65 font-heading text-xl font-bold tracking-tight">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
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
            ))}
        </div>

        {media && (
          <div className={cn("relative mt-12 w-full", deep ? "max-w-5xl md:mt-16" : "mt-10 max-w-4xl")}>
            {deep && <DeepBackdrop />}
            <div data-hero-media className="w-full">
              {media}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * The deep band of a deep hero, drawn from the media's wrapper so it ends
 * where the media is: it reaches up past the section's top and out past both
 * sides (the section clips it) and stops a little below the middle of the
 * media, so the screen sits half on the dark top and half on the page. The
 * wash of the primary and the secondary drifts above the copy (`mkt-aurora`,
 * style/layout/marketing-motion.css), and stands still for reduced motion.
 */
function DeepBackdrop() {
  return (
    <div
      aria-hidden
      className="bg-background-deep pointer-events-none absolute -inset-x-[100vw] -top-[200vh] -z-10"
      // Where the band ends: a little below the middle of the media (a layout fact of this one shape, not a token).
      style={{ bottom: "42%" }}
    >
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 overflow-hidden"
        style={{ height: "min(62rem, 180vh)", width: "min(90rem, 180vw)" }}
      >
        <div
          className="mkt-aurora absolute inset-0"
          style={{
            background:
              "radial-gradient(38% 42% at 28% 62%, hsl(var(--primary) / 0.42), transparent 70%), radial-gradient(32% 38% at 74% 48%, hsl(var(--secondary) / 0.2), transparent 70%), radial-gradient(50% 30% at 50% 100%, hsl(var(--primary) / 0.25), transparent 75%)",
          }}
        />
      </div>
    </div>
  );
}
