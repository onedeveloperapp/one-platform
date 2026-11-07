import { TONE, type Tone, toneAt } from "@/components/marketing/tone";
import { cn } from "@/lib/utils";

/**
 * Ready-made floating chips for <ProductComposition> satellites. All content
 * is REAL and localized (pass i18n strings) — a satellite that lies is worse
 * than no satellite. Token-driven, theme-aware, no photos. The composition
 * gives each satellite its shadow, on the layer that floats with it; chips
 * own the surface.
 */
const CHIP_BASE = "border-grey-100 bg-background-paper rounded-2xl border px-4 py-3";

/** Headline metric: label, oversized value, optional delta pill in the family hue. */
export function KpiChip({
  label,
  value,
  delta,
  tone = "primary",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: Tone;
}) {
  const hue = TONE[tone];
  return (
    <div className={CHIP_BASE}>
      <p className="text-text-secondary text-xs">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-text-primary text-2xl font-bold tabular-nums">{value}</span>
        {/* The hue on the pill, the word in a text colour: as small text a hue reads 1.8 to 4.2:1 over its own tint. */}
        {delta && (
          <span className={cn("text-text-primary rounded-full px-1.5 py-0.5 text-xs font-semibold", hue.softBg)}>
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tiny sparkline in the family hue over a label — trend at a glance. */
export function TrendChip({
  label,
  data = [4, 7, 5, 9, 8, 12],
  tone = "accent-1",
}: {
  label: string;
  data?: number[];
  tone?: Tone;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => `${(index / (data.length - 1)) * 88},${26 - ((value - min) / range) * 24 + 1}`)
    .join(" ");
  return (
    <div className={CHIP_BASE}>
      <svg viewBox="0 0 88 28" className="h-7 w-22" aria-hidden>
        <polyline
          points={points}
          fill="none"
          stroke={`hsl(var(${TONE[tone].cssVar}))`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-text-secondary mt-1 text-xs">{label}</p>
    </div>
  );
}

/** Overlapping initials row + label — social proof without stock photos. */
export function AvatarRowChip({ names, label }: { names: string[]; label: string }) {
  return (
    <div className={cn(CHIP_BASE, "flex items-center gap-3")}>
      <div className="flex">
        {names.slice(0, 4).map((name, index) => {
          const hue = TONE[toneAt(index)];
          return (
            <span
              key={name}
              className={cn(
                "border-background-paper flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold",
                index > 0 && "-ml-2",
                hue.softBg,
                hue.text,
              )}
            >
              {name.charAt(0)}
            </span>
          );
        })}
      </div>
      <p className="text-text-secondary text-xs">{label}</p>
    </div>
  );
}

/**
 * A ring split in up to three parts with the total in its middle and a legend
 * beside it: how one population divides, at a glance. Each part in its family
 * hue; the words stay text colours.
 */
export function RingChip({
  label,
  total,
  parts,
}: {
  label: string;
  total: string;
  parts: { label: string; value: number; tone: Tone }[];
}) {
  const sum = parts.reduce((acc, part) => acc + part.value, 0) || 1;
  // A circle of radius 15.9155 has a circumference of 100, so each part's
  // share is its dash length; each starts where the one before ended.
  let start = 0;
  const arcs = parts.slice(0, 3).map((part) => {
    const share = (part.value / sum) * 100;
    const arc = { ...part, share, start };
    start += share;
    return arc;
  });
  return (
    <div className={cn(CHIP_BASE, "flex items-center gap-4")}>
      <div className="relative h-20 w-20 flex-none">
        <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="hsl(var(--grey-100))" strokeWidth="3.6" />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke={`hsl(var(${TONE[arc.tone].cssVar}))`}
              strokeWidth="3.6"
              strokeDasharray={`${Math.max(arc.share - 1.5, 0)} ${100 - Math.max(arc.share - 1.5, 0)}`}
              strokeDashoffset={-arc.start}
              strokeLinecap="round"
            />
          ))}
        </svg>
        <span className="font-display text-text-primary absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums">
          {total}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-text-secondary text-xs">{label}</p>
        <ul className="flex flex-col gap-1">
          {arcs.map((arc) => (
            <li key={arc.label} className="text-text-primary flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="h-2 w-2 flex-none rounded-full"
                style={{ backgroundColor: `hsl(var(${TONE[arc.tone].cssVar}))` }}
              />
              {arc.label}
              <span className="text-text-secondary tabular-nums">{arc.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * A message the product sent, as a card: who sent it with the family's icon,
 * the words, and when. The floating assistant card of a layered hero; the hue
 * rides on the icon's disc and the words keep text colours.
 */
export function MessageChip({
  author,
  text,
  meta,
  icon,
  tone = "accent-2",
}: {
  author: string;
  text: string;
  meta?: string;
  icon: React.ReactNode;
  tone?: Tone;
}) {
  const hue = TONE[tone];
  return (
    <div className={cn(CHIP_BASE, "flex max-w-72 items-start gap-3")}>
      <span
        aria-hidden
        className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-full", hue.softBg, hue.text)}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-text-primary text-xs font-bold">{author}</p>
        <p className="text-text-primary text-sm leading-5">{text}</p>
        {meta && <p className="text-text-secondary text-xs">{meta}</p>}
      </div>
    </div>
  );
}

/** Mono status line with a live dot — the instrument/terminal mood. */
export function ReadoutChip({ text, tone = "accent-4" }: { text: string; tone?: Tone }) {
  const hue = TONE[tone];
  return (
    <div className={cn(CHIP_BASE, "flex items-center gap-2")}>
      <span
        className={cn("h-1.5 w-1.5 flex-none rounded-full", hue.text)}
        style={{ backgroundColor: "currentcolor" }}
      />
      <p className="text-text-secondary font-mono text-xs">{text}</p>
    </div>
  );
}
