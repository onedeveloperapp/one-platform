import Reveal from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

/**
 * An indexed, hairline-ruled grid of categories (e.g. the seven catalog
 * trails), with periodic deep accent cells to give the wall rhythm. The
 * secondary-tone index digits are the editorial motif shared with NumberStrip.
 */
export default function IndexGrid({
  items,
  accentEvery = 5,
}: {
  items: string[];
  /** Every Nth cell (0-based) takes the deep accent treatment. */
  accentEvery?: number;
}) {
  return (
    <Reveal className="border-grey-100 grid grid-cols-1 border-t border-l sm:grid-cols-2">
      {items.map((item, index) => {
        const accent = index % accentEvery === 0;
        return (
          <div
            key={item}
            className={cn(
              "flex min-h-14 items-center gap-4 border-r border-b px-4.5 py-3 text-sm font-semibold",
              accent
                ? "border-grey-100 bg-background-deep text-text-contrast"
                : "border-grey-100 bg-background-paper/40 text-text-secondary",
            )}
          >
            <span
              aria-hidden
              className={cn("font-display text-sm font-normal", accent ? "text-secondary-light" : "text-secondary")}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            {item}
          </div>
        );
      })}
    </Reveal>
  );
}
