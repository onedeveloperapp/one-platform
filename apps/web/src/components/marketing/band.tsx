import Container from "@/components/marketing/container";
import { SECTION_DECOR } from "@/components/marketing/section";
import { cn } from "@/lib/utils";

const SPACING = {
  default: "py-[var(--section-space)]",
  compact: "py-[var(--section-space-sm)]",
  // A strip of one line (the names a page works with): half the compact space, so it reads as a band, not a chapter.
  tight: "py-[calc(var(--section-space-sm)*0.5)]",
} as const;

const BACKGROUND = {
  contrast: "bg-background-paper border-grey-100 border-y",
  "primary-soft": "bg-primary/5",
  paper: "bg-background-paper",
} as const;

const ANGLE: Record<string, string> = {
  "-2": "-skew-y-2",
  "-1": "-skew-y-1",
  0: "",
  1: "skew-y-1",
  2: "skew-y-2",
};

/**
 * Full-bleed ANGLED contrast strip — the sanctioned "diagonal band" breakout.
 * Only the background layer is skewed; the content stays level (readability
 * never pays for the effect). A Section-level unit: use it INSTEAD of
 * <Section> for that block, in the page's normal flow.
 */
export default function Band({
  angle = -1,
  background = "contrast",
  spacing = "default",
  decor = "none",
  id,
  track,
  className,
  children,
}: {
  /** Degrees of background tilt. 0 = straight full-bleed band. */
  angle?: -2 | -1 | 0 | 1 | 2;
  background?: keyof typeof BACKGROUND;
  spacing?: keyof typeof SPACING;
  decor?: "none" | "grid" | "dots";
  id?: string;
  /** The section's key in the measurement (`section_view`), as on <Section>. */
  track?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-section={track}
      className={cn("relative isolate w-full overflow-x-clip", SPACING[spacing], className)}
    >
      {/* Skewed background layer; the extra vertical inset keeps tilted corners covered. */}
      <div
        aria-hidden
        className={cn("absolute inset-x-0 -inset-y-6 -z-10", ANGLE[String(angle)], BACKGROUND[background])}
      >
        {decor !== "none" && <div className="absolute inset-0 overflow-hidden">{SECTION_DECOR[decor]}</div>}
      </div>
      <Container className="relative">{children}</Container>
    </section>
  );
}
