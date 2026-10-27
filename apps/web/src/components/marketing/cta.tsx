"use client";
import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import NiCheck from "@/icons/nexture/ni-check";

/**
 * Funnel stage: recovery — the last conversion opportunity on the page.
 * Three treatments:
 * - "panel" (default): bordered console panel with a primary glow.
 * - "deep": full-bleed deep band with the orbit ambient, light CTA button,
 *   optional demo link and reassurance points.
 * - "deep-panel": the same deep surface as a rounded panel inside the
 *   container, a primary glow in one corner and rays from the other (the
 *   home's closing panel since its blueprint of 2026-10-26).
 * The button label must repeat the page's final CTA verbatim.
 */
export default function Cta({
  title,
  subtitle,
  cta,
  secondaryCta,
  points,
  kicker,
  decor = "none",
  variant = "panel",
  track,
}: {
  title: string;
  subtitle?: string;
  cta: { label: string; href: string };
  /** Subordinate text link beside the button ("Voltar aos apps", "Fale com a gente"). */
  secondaryCta?: { label: string; href: string };
  /** Deep variants only: short risk-reducing reassurances under the actions. */
  points?: string[];
  /** Optional mono kicker above the title (e.g. "next step"). */
  kicker?: string;
  /** Ambient layer on the surrounding Section (orbit is the classic closer). */
  decor?: "none" | "orbit" | "mesh" | "dots";
  variant?: "panel" | "deep" | "deep-panel";
  /** The section's key in the measurement (`section_view`). */
  track?: string;
}) {
  // The copy of the deep surfaces: a light button on the deep colour, the words in the contrast text.
  const deepContent = (
    <div className="relative flex flex-col items-start gap-4">
      {kicker && <p className="text-secondary-light font-eyebrow tracking-eyebrow text-xs uppercase">{kicker}</p>}
      <h2 className="font-display text-display-lg max-w-3xl font-extrabold">{title}</h2>
      {subtitle && <p className="text-text-contrast/75 max-w-2xl text-lg leading-7">{subtitle}</p>}
      <div className="mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Light button on the deep band: token classes override the
            contained-primary look — white surface, label in the band's
            own colour. */}
        <Button
          size="large"
          variant="contained"
          color="primary"
          href={cta.href}
          LinkComponent={Link}
          className="bg-text-contrast! text-background-deep! shadow-darker-sm hover:bg-text-contrast/90!"
          data-track="cta_click"
          data-track-cta-id="final"
        >
          {cta.label}
        </Button>
        {secondaryCta && (
          <Link
            href={secondaryCta.href}
            className="text-text-contrast/85 border-text-contrast/40 hover:border-text-contrast border-b pb-0.5 text-sm font-semibold transition-colors"
          >
            {secondaryCta.label}
          </Link>
        )}
      </div>
      {points && points.length > 0 && (
        <ul className="border-text-contrast/15 mt-4 flex w-full max-w-3xl flex-wrap gap-x-7 gap-y-2.5 border-t pt-5">
          {points.map((point) => (
            <li key={point} className="text-text-contrast/70 flex items-center gap-1.5 text-sm">
              <NiCheck size="small" className="text-secondary-light flex-none" />
              {point}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (variant === "deep-panel") {
    return (
      <Section decor={decor} track={track}>
        <Reveal>
          <div className="bg-background-deep text-text-contrast relative isolate overflow-hidden rounded-4xl px-6 py-14 md:px-14 md:py-20">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background: "radial-gradient(45% 70% at 92% 0%, hsl(var(--primary) / 0.55), transparent 70%)",
              }}
            />
            <Rays />
            {deepContent}
          </div>
        </Reveal>
      </Section>
    );
  }

  if (variant === "deep") {
    return (
      <Section background="deep" decor={decor} track={track}>
        <Reveal>
          <div className="py-6 md:py-10">{deepContent}</div>
        </Reveal>
      </Section>
    );
  }

  return (
    <Section decor={decor} track={track}>
      <Reveal>
        <div className="border-grey-100 bg-background-paper relative overflow-hidden rounded-4xl border px-6 py-16 text-center md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: "radial-gradient(ellipse 60% 80% at 50% 0%, hsl(var(--primary) / 0.12), transparent 70%)",
            }}
          />
          <div className="relative flex flex-col items-center gap-4">
            {kicker && <p className="text-primary font-eyebrow tracking-eyebrow text-xs uppercase">{kicker}</p>}
            <h2 className="font-display text-display-lg text-text-primary max-w-2xl font-extrabold">{title}</h2>
            {subtitle && <p className="text-text-secondary max-w-xl text-lg leading-6">{subtitle}</p>}
            <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
              <Button
                size="large"
                variant="contained"
                color="primary"
                href={cta.href}
                LinkComponent={Link}
                data-track="cta_click"
                data-track-cta-id="final"
              >
                {cta.label}
              </Button>
              {secondaryCta && (
                <Link
                  href={secondaryCta.href}
                  className="text-text-primary border-text-primary/30 hover:border-text-primary border-b pb-0.5 text-sm font-semibold transition-colors"
                >
                  {secondaryCta.label}
                </Link>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/** How many rays fan out of the panel's corner, and the angles they span. */
const RAYS = 24;
const RAY_FROM = 4;
const RAY_TO = 86;

/**
 * Fine rays fanning out of the bottom corner of the deep panel, fading
 * toward their ends: texture for the dark surface, drawn in the contrast
 * text at a low alpha so it follows the theme.
 */
function Rays() {
  const lines = Array.from({ length: RAYS }, (_, index) => {
    const angle = ((RAY_FROM + ((RAY_TO - RAY_FROM) * index) / (RAYS - 1)) * Math.PI) / 180;
    return { x: (200 * Math.cos(angle)).toFixed(1), y: (200 - 200 * Math.sin(angle)).toFixed(1) };
  });
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      className="pointer-events-none absolute bottom-0 left-0 -z-10 h-72 w-72 md:h-96 md:w-96"
      style={{
        maskImage: "radial-gradient(circle at 0% 100%, black 15%, transparent 72%)",
        WebkitMaskImage: "radial-gradient(circle at 0% 100%, black 15%, transparent 72%)",
      }}
    >
      {lines.map((line, index) => (
        <line
          key={index}
          x1="0"
          y1="200"
          x2={line.x}
          y2={line.y}
          stroke="hsl(var(--text-contrast) / 0.22)"
          strokeWidth="0.6"
        />
      ))}
    </svg>
  );
}
