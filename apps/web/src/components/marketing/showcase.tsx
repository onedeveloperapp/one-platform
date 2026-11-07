import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiCheck from "@/icons/nexture/ni-check";
import { cn } from "@/lib/utils";

export type ShowcasePoint = {
  /** MEANINGFUL icon: the concept of the card, in its family hue. */
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: Tone;
};

export type ShowcaseAction = { label: string; href: string };

/**
 * Funnel stage: desire. One chapter of a sales page as a pair: the copy on one
 * side (its heading, then what backs it: cards of two by two, a row of chips
 * or a list with checks, and its actions) and the product working on the
 * other (a drawn screen, a phone, an animated example), with the caption that
 * says whose data it is. Closest entries: <FeatureRows> is one row per
 * feature with a short copy beside each; this is a whole chapter with its own
 * heading and its evidence, and it can sit on the deep band.
 *
 * `background="deep"`: the chapter on the deep band (the page's dark moment
 * after the hero): the words in the contrast text, the cards a faint veil of
 * it, the secondary action an outline. A drawn screen in `media` keeps its own
 * paper card, so it reads as the product on a dark table.
 */
export default function Showcase({
  id,
  track,
  eyebrow,
  eyebrowTone = "primary",
  title,
  subtitle,
  points,
  chips,
  bullets,
  bulletTone = "primary",
  actions,
  children,
  media,
  caption,
  mediaSide = "end",
  background = "default",
  decor = "none",
}: {
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  eyebrow?: string;
  /** The family hue on the eyebrow's bar. */
  eyebrowTone?: Tone;
  title: string;
  subtitle?: string;
  /** Two to four cards, two abreast from sm. */
  points?: ShowcasePoint[];
  /** A row of short labels, each with its icon (the sources a feature reads). */
  chips?: { icon: React.ReactNode; label: string; tone: Tone }[];
  bullets?: string[];
  bulletTone?: Tone;
  /** The page's primary action repeated verbatim, and at most its secondary one. */
  actions?: { primary?: ShowcaseAction; secondary?: ShowcaseAction };
  /** What joins the copy column under the subtitle (an animated line). */
  children?: React.ReactNode;
  media: React.ReactNode;
  /** Under the media: "Telas com dados de exemplo". */
  caption?: string;
  /** The media's side at md+; on a phone it always follows the copy. */
  mediaSide?: "start" | "end";
  background?: "default" | "paper" | "deep";
  decor?: "none" | "grid" | "dots" | "gradient-edge" | "mesh";
}) {
  const deep = background === "deep";
  return (
    <Section id={id} track={track} background={background} decor={deep ? "none" : decor}>
      <Reveal className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-14">
        <div className={cn("flex flex-col items-start", mediaSide === "start" && "md:order-2")}>
          {eyebrow && (
            <p
              className={cn(
                "font-eyebrow tracking-eyebrow mb-3 flex items-center gap-2.5 text-xs uppercase",
                deep ? "text-text-contrast/70" : "text-text-secondary",
              )}
            >
              <span
                aria-hidden
                className="h-1 w-6 flex-none rounded-full"
                style={{ backgroundColor: `hsl(var(${TONE[eyebrowTone].cssVar}))` }}
              />
              {eyebrow}
            </p>
          )}
          <h2
            className={cn(
              "font-display text-display-lg font-extrabold text-balance",
              deep ? "text-text-contrast" : "text-text-primary",
            )}
          >
            {title}
          </h2>
          {subtitle && (
            <p className={cn("mt-4 text-lg leading-7", deep ? "text-text-contrast/75" : "text-text-secondary")}>
              {subtitle}
            </p>
          )}

          {children && <div className="mt-6 w-full">{children}</div>}

          {points && points.length > 0 && (
            <ul className="mt-8 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              {points.map((point) => {
                const tone = TONE[point.tone];
                return (
                  <li
                    key={point.title}
                    className={cn(
                      "flex flex-col gap-3 rounded-2xl border p-5",
                      deep ? "border-text-contrast/10 bg-text-contrast/5" : "border-grey-100 bg-background-paper",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5",
                        tone.softBg,
                        tone.text,
                      )}
                    >
                      {point.icon}
                    </span>
                    <h3
                      className={cn(
                        "font-heading text-base font-bold",
                        deep ? "text-text-contrast" : "text-text-primary",
                      )}
                    >
                      {point.title}
                    </h3>
                    <p className={cn("text-sm leading-6", deep ? "text-text-contrast/70" : "text-text-secondary")}>
                      {point.body}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {chips && chips.length > 0 && (
            <ul className="mt-7 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li
                  key={chip.label}
                  className={cn(
                    "flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-sm font-semibold",
                    deep
                      ? "border-text-contrast/15 bg-text-contrast/5 text-text-contrast"
                      : "border-grey-100 bg-background-paper text-text-primary",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full",
                      TONE[chip.tone].softBg,
                      TONE[chip.tone].text,
                    )}
                  >
                    {chip.icon}
                  </span>
                  {chip.label}
                </li>
              ))}
            </ul>
          )}

          {bullets && bullets.length > 0 && (
            <ul className="mt-7 flex flex-col gap-2.5">
              {bullets.map((bullet) => (
                <li
                  key={bullet}
                  className={cn(
                    "flex items-start gap-2.5 leading-6",
                    deep ? "text-text-contrast/85" : "text-text-primary",
                  )}
                >
                  <NiCheck
                    size="small"
                    className={cn("mt-0.5 flex-none", deep ? "text-secondary-light" : TONE[bulletTone].text)}
                  />
                  {bullet}
                </li>
              ))}
            </ul>
          )}

          {actions && (actions.primary || actions.secondary) && (
            <div className="mt-8 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap">
              {actions.primary && (
                <Button
                  size="large"
                  variant="contained"
                  color="primary"
                  href={actions.primary.href}
                  LinkComponent={Link}
                  data-track="cta_click"
                  data-track-cta-id={`${track ?? "showcase"}_primary`}
                >
                  {actions.primary.label}
                </Button>
              )}
              {actions.secondary &&
                (deep ? (
                  <Button
                    size="large"
                    variant="outlined"
                    href={actions.secondary.href}
                    LinkComponent={Link}
                    endIcon={<NiArrowRight size="small" />}
                    className="border-text-contrast/35! text-text-contrast! hover:border-text-contrast! hover:bg-text-contrast/10!"
                    data-track="cta_click"
                    data-track-cta-id={`${track ?? "showcase"}_secondary`}
                  >
                    {actions.secondary.label}
                  </Button>
                ) : (
                  <Button
                    size="large"
                    variant="pastel"
                    color="primary"
                    href={actions.secondary.href}
                    LinkComponent={Link}
                    data-track="cta_click"
                    data-track-cta-id={`${track ?? "showcase"}_secondary`}
                  >
                    {actions.secondary.label}
                  </Button>
                ))}
            </div>
          )}
        </div>

        <figure className={cn("m-0 flex min-w-0 flex-col gap-3", mediaSide === "start" && "md:order-1")}>
          {media}
          {caption && (
            <figcaption className={cn("text-center text-xs", deep ? "text-text-contrast/65" : "text-text-secondary")}>
              {caption}
            </figcaption>
          )}
        </figure>
      </Reveal>
    </Section>
  );
}
