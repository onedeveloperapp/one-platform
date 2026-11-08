import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { TONE, type Tone, toneAt } from "@/components/marketing/tone";
import { cn } from "@/lib/utils";

export type BentoItem = {
  /** One to four words: what the cell is about. */
  title: string;
  /** One sentence at most, at the page's text size. */
  body: string;
  /**
   * What shows the idea at a glance, under the words: a screen of the product (cut to the one control), an
   * object it makes, a number with its origin. Leave it out for a phrase cell, whose words are the figure.
   */
  figure?: React.ReactNode;
  /** The icon of what a phrase cell says, on its family's tint. */
  icon?: React.ReactNode;
  /** The cell that leads: twice as wide from a laptop on, and first on a phone. One per grid. */
  featured?: boolean;
  /**
   * The figure runs past the cell's bottom edge, which cuts its last few pixels: a screen leaving the cell rather
   * than a window boxed inside it. Only for a figure whose foot is padding, never its words or its buttons.
   */
  bleed?: boolean;
  /** Harmonic hue for this cell's icon. Defaults to a rotation. */
  tone?: Tone;
};

/**
 * A grid of the features of one chapter, read as one figure (the demonstration guide of the sales-page skill,
 * "a grade de recursos"): one cell leads, wider; a third to a half of the cells show a screen, the others an
 * object, a number or a phrase; neighbours differ; the words are short and always in the same place, above the
 * figure. Every cell has the same radius and spacing, and nothing in it moves by itself. On a phone the cells
 * stack, the leading one first. Count the cells before choosing it: five fill two rows of three with the leader.
 *
 * It replaces a long zig-zag of rows (image left, then right, then left again) and a row of three equal cards,
 * both habits of a page nobody planned. `cta` repeats the page's primary action under the grid.
 */
export default function BentoGrid({
  id,
  track,
  eyebrow,
  title,
  subtitle,
  items,
  caption,
  cta,
  background,
}: {
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  items: BentoItem[];
  /** One line under the grid, as under any screen of the page: whose data the screens carry. */
  caption?: string;
  cta?: { label: string; href: string };
  background?: React.ComponentProps<typeof Section>["background"];
}) {
  return (
    <Section id={id} track={track} background={background}>
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <Reveal stagger={0.08} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {items.map((item, index) => {
          const tone = TONE[item.tone ?? toneAt(index)];
          return (
            <div
              key={item.title}
              className={cn(
                "border-grey-100 bg-background-paper flex min-w-0 flex-col gap-6 rounded-3xl border p-6 md:p-7",
                item.featured && "md:col-span-2",
                item.bleed && "overflow-hidden",
              )}
            >
              {/* The words are always on top, in the same place in every cell. */}
              <div className="flex flex-col gap-2">
                <h3
                  className={cn(
                    "text-text-primary font-heading font-bold",
                    // A phrase cell is its words: a large phrase fills the cell a figure fills in the others.
                    item.figure ? "text-xl" : "text-display-md",
                  )}
                >
                  {item.title}
                </h3>
                <p className={cn("text-text-secondary", item.figure ? "leading-6" : "text-lg leading-7")}>
                  {item.body}
                </p>
              </div>
              {item.figure ? (
                <div className={cn("mt-auto min-w-0", item.bleed && "-mb-10 md:-mb-11")}>{item.figure}</div>
              ) : item.icon ? (
                // A phrase cell keeps its icon at its foot, so a row of cells of different heights has nothing empty.
                <span
                  aria-hidden
                  className={cn(
                    "mt-auto flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7",
                    tone.softBg,
                    tone.text,
                  )}
                >
                  {item.icon}
                </span>
              ) : null}
            </div>
          );
        })}
      </Reveal>
      {caption ? <p className="text-text-secondary mt-4 text-center text-xs">{caption}</p> : null}
      {cta ? (
        <div className="mt-10 flex justify-center">
          <Button
            size="large"
            variant="contained"
            color="primary"
            href={cta.href}
            LinkComponent={Link}
            data-track="cta_click"
            data-track-cta-id={`${track ?? "bento"}_primary`}
          >
            {cta.label}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
