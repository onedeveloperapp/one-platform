import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiCheck from "@/icons/nexture/ni-check";
import { cn } from "@/lib/utils";

export type FeatureRowItem = {
  eyebrow?: string;
  title: string;
  body: string;
  bullets?: string[];
  /** Product evidence for this feature: <ProductFrame>, image, or <DataVizPlaceholder>. */
  media: React.ReactNode;
  /** A short line under the media (whose data it is: "Telas com dados de exemplo"). */
  caption?: string;
  /** Harmonic hue for this feature family (eyebrow + bullet marks). Default: primary. */
  tone?: Tone;
  /**
   * The row's action under its bullets: the page's primary action, repeated
   * verbatim, or its secondary one (the pastel button of the hero).
   */
  cta?: { label: string; href: string; variant?: "primary" | "secondary" };
};

/**
 * Alternating two-column feature rows (text ↔ visual "zig-zag") — the
 * workhorse layout of expensive-product pages: every claim ships next to
 * its product evidence, and the alternation keeps a long page rhythmic.
 * Use INSTEAD of a second card grid when features deserve depth.
 */
export default function FeatureRows({
  id,
  track,
  eyebrow,
  title,
  subtitle,
  items,
  start = "copy",
  decor = "none",
  children,
}: {
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  items: FeatureRowItem[];
  /** Which side the first row puts on the left at md+: its copy (default) or its media. */
  start?: "copy" | "media";
  /** Section depth layer — the committed direction puts decor="grid" on one technical section per page. */
  decor?: "none" | "glow" | "grid" | "gradient-edge";
  /**
   * What closes the same chapter under the rows (the store grid under the
   * featured app), one row gap below them. A second <Section> there would put
   * two section paddings between the halves and read as a new chapter.
   */
  children?: React.ReactNode;
}) {
  return (
    <Section id={id} track={track} decor={decor}>
      {title && <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />}
      <div className="flex flex-col gap-[var(--section-space-sm)]">
        {items.map((item, index) => {
          const tone = TONE[item.tone ?? "primary"];
          // The media goes left on every other row, starting with the first when `start` says so.
          const mediaLeft = (index % 2 === 1) !== (start === "media");
          return (
            // grid-cols-1 (minmax(0,1fr)) keeps intrinsically-wide media from inflating the mobile track past the viewport.
            <Reveal key={item.title} className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14">
              <div className={mediaLeft ? "md:order-2" : undefined}>
                {item.eyebrow && (
                  // The family hue on a bar, the words in a text colour: no palette
                  // hue reaches 4.5:1 as small text on a light ground.
                  <p className="text-text-secondary font-eyebrow tracking-eyebrow mb-3 flex items-center gap-2.5 text-xs uppercase">
                    <span
                      aria-hidden
                      className="h-1 w-6 flex-none rounded-full"
                      style={{ backgroundColor: `hsl(var(${tone.cssVar}))` }}
                    />
                    {item.eyebrow}
                  </p>
                )}
                <h3 className="font-display text-display-md text-text-primary font-extrabold">{item.title}</h3>
                <p className="text-text-secondary mt-3 leading-7">{item.body}</p>
                {item.bullets && item.bullets.length > 0 && (
                  <ul className="mt-5 flex flex-col gap-2.5">
                    {item.bullets.map((bullet) => (
                      <li key={bullet} className="text-text-primary flex items-start gap-2.5 leading-6">
                        <NiCheck size="small" className={cn("mt-0.5 flex-none", tone.text)} />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
                {item.cta && (
                  <Button
                    size="large"
                    variant={item.cta.variant === "secondary" ? "pastel" : "contained"}
                    color="primary"
                    href={item.cta.href}
                    LinkComponent={Link}
                    className="mt-7"
                    data-track="cta_click"
                    data-track-cta-id={`feature_${index + 1}`}
                  >
                    {item.cta.label}
                  </Button>
                )}
              </div>
              <figure className={cn("m-0 flex flex-col gap-3", mediaLeft ? "md:order-1" : undefined)}>
                {item.media}
                {item.caption && (
                  <figcaption className="text-text-secondary text-center text-xs">{item.caption}</figcaption>
                )}
              </figure>
            </Reveal>
          );
        })}
        {children}
      </div>
    </Section>
  );
}
