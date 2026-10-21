import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import { cn } from "@/lib/utils";

export type RuledGridItem = {
  /** Meaningful concept icon (@/icons/nexture/ni-*), tinted by `tone`. */
  icon?: React.ReactNode;
  title: string;
  body: string;
  tone?: Tone;
  /** Optional trailing text link (e.g. "Ver como é explicado" → #rastreabilidade). */
  link?: { label: string; href: string };
  /** The site event the link's click reports (`trackAttributes`, lib/site-events.ts). */
  track?: Record<string, string>;
  /** Cards variant: a short label beside the icon, in the item's hue (e.g. "Amostra grátis"). */
  badge?: string;
  /** Cards variant: one mono line under the body for identifiers (a version, the AIs it runs on). */
  meta?: string;
  /** Cards variant: small badges under the body ("Novo" in the item's hue, "Usa sua conta X" neutral). */
  flags?: { label: string; tone?: "item" | "neutral" }[];
};

/**
 * One card of the `cards` variant, exported for grids that arrange cards
 * themselves (the filtered store grid, components/marketing/store-grid.tsx).
 */
export function RuledCard({ item }: { item: RuledGridItem }) {
  const tone = TONE[item.tone ?? "primary"];
  return (
    <article className="border-grey-100 bg-background-paper flex h-full w-full flex-col rounded-3xl border p-7">
      {(item.icon || item.badge) && (
        <div className="mb-5 flex flex-row items-center justify-between gap-3">
          {item.icon ? (
            <span className={cn("inline-grid h-12 w-12 place-items-center rounded-2xl", tone.softBg, tone.text)}>
              {item.icon}
            </span>
          ) : (
            <span />
          )}
          {item.badge && (
            <span className={cn("rounded-full px-3 py-1 text-xs font-bold", tone.softBg, "text-text-primary")}>
              {item.badge}
            </span>
          )}
        </div>
      )}
      <h3 className="font-display text-text-primary text-xl leading-6 font-normal">{item.title}</h3>
      <p className="text-text-secondary mt-2.5 text-base leading-6">{item.body}</p>
      {item.flags && item.flags.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-row flex-wrap gap-2 p-0">
          {item.flags.map((flag) => (
            <li
              key={flag.label}
              className={cn(
                "text-text-primary rounded-full px-3 py-1 text-xs font-bold",
                flag.tone === "neutral" ? "bg-grey-50" : tone.softBg,
              )}
            >
              {flag.label}
            </li>
          ))}
        </ul>
      )}
      {item.meta && <p className="text-text-secondary mt-3 font-mono text-xs leading-5">{item.meta}</p>}
      {item.link && (
        // The label keeps the text colour and only the arrow takes the
        // hue: no palette hue reaches 4.5:1 as small text on a light ground.
        <Link
          href={item.link.href}
          className="text-text-primary mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-bold hover:underline"
          {...item.track}
        >
          {item.link.label}
          <NiArrowRight size="small" className={tone.text} />
        </Link>
      )}
    </article>
  );
}

/**
 * Blueprint's ruled grid: cells separated by hairlines instead of card gaps —
 * the editorial "one surface, many rooms" look used by the benefits (§14,
 * light 3-col), the security pillars (§22, deep 2-col) and the reasoning trio
 * (§17, cards). Icons are meaningful concept glyphs in the family hue.
 */
export default function RuledGrid({
  items,
  columns = 3,
  variant = "light",
}: {
  items: RuledGridItem[];
  /** 4 is for short cards (the app store grid): two per row from `sm`, four from `lg`. */
  columns?: 2 | 3 | 4;
  /** light = hairline grid on the page ground; deep = hairline grid on the deep band; cards = separated rounded cards. */
  variant?: "light" | "deep" | "cards";
}) {
  const cols =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  if (variant === "cards") {
    return (
      <Reveal stagger={0.08} className={cn("grid grid-cols-1 gap-5", cols)}>
        {items.map((item) => (
          <RuledCard key={item.title} item={item} />
        ))}
      </Reveal>
    );
  }

  const deep = variant === "deep";
  return (
    <Reveal
      stagger={0.06}
      className={cn("grid grid-cols-1 border-t border-l", cols, deep ? "border-text-contrast/15" : "border-grey-100")}
    >
      {items.map((item) => {
        const tone = TONE[item.tone ?? "primary"];
        return (
          <article
            key={item.title}
            className={cn(
              "border-r border-b p-7 transition-colors md:p-8",
              deep ? "border-text-contrast/15 hover:bg-text-contrast/5" : "border-grey-100 hover:bg-background-paper",
            )}
          >
            {item.icon && (
              <span
                className={cn(
                  "mb-5 inline-grid h-11 w-11 place-items-center rounded-xl",
                  deep ? "bg-text-contrast/10 text-secondary-light" : cn(tone.softBg, tone.text),
                )}
              >
                {item.icon}
              </span>
            )}
            <h3
              className={cn(
                "font-display text-lg leading-6 font-normal",
                deep ? "text-text-contrast" : "text-text-primary",
              )}
            >
              {item.title}
            </h3>
            <p className={cn("mt-2.5 text-base leading-6", deep ? "text-text-contrast/70" : "text-text-secondary")}>
              {item.body}
            </p>
          </article>
        );
      })}
    </Reveal>
  );
}
