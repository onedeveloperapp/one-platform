import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { TONE, type Tone, toneAt } from "@/components/marketing/tone";
import { cn } from "@/lib/utils";

export type Feature = {
  /**
   * MEANINGFUL icon — it should let the reader grasp the feature at a glance,
   * so pick the concept, not a generic decoration. Sized large on purpose.
   */
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Harmonic hue for this feature family. Defaults to a rotation across the palette. */
  tone?: Tone;
};

/**
 * Funnel stage: desire. Titles must be benefit-led (the outcome for the
 * customer), never the internal feature name. Each card leads with a
 * meaningful icon in its family's hue — show before tell.
 *
 * `variant="tinted"`: each card is a soft wash of its family hue with no
 * border, the title beside the icon in a paper circle (the pastel feature
 * cards of the home's blueprint); "card" keeps the bordered paper cards.
 */
export default function FeatureGrid({
  id,
  track,
  eyebrow,
  title,
  subtitle,
  features,
  variant = "card",
}: {
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  features: Feature[];
  variant?: "card" | "tinted";
}) {
  // Three cards (or six) stand three abreast from md and stack below it: two columns would leave the last alone on its row.
  const columns = features.length % 3 === 0 ? "md:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <Section id={id} track={track}>
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <Reveal stagger={0.08} className={cn("grid grid-cols-1 gap-6", columns)}>
        {features.map((feature, index) => {
          const tone = TONE[feature.tone ?? toneAt(index)];
          if (variant === "tinted") {
            return (
              <div key={feature.title} className={cn("flex flex-col gap-4 rounded-3xl p-7", tone.softBg)}>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-text-primary font-heading text-xl font-bold">{feature.title}</h3>
                  <span
                    className={cn(
                      "bg-background-paper flex h-12 w-12 flex-none items-center justify-center rounded-full [&_svg]:h-6 [&_svg]:w-6",
                      tone.text,
                    )}
                  >
                    {feature.icon}
                  </span>
                </div>
                {/* A step darker than the paper's secondary text: over the wash it read 4.3:1. */}
                <p className="text-text-muted-dark text-base leading-6">{feature.description}</p>
              </div>
            );
          }
          return (
            <div
              key={feature.title}
              className="border-grey-100 bg-background-paper flex flex-col gap-4 rounded-3xl border p-6"
            >
              <span
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7",
                  tone.softBg,
                  tone.text,
                )}
              >
                {feature.icon}
              </span>
              <h3 className="text-text-primary font-heading text-xl font-bold">{feature.title}</h3>
              <p className="text-text-secondary text-base leading-6">{feature.description}</p>
            </div>
          );
        })}
      </Reveal>
    </Section>
  );
}
