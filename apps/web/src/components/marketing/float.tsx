import { cn } from "@/lib/utils";

/**
 * Gentle oscillation for composition satellites (chips/cards around the hero
 * frame): y plus an optional rotation, tiny amplitude, so it stays on for
 * touch devices too. A CSS animation (`animate-mkt-float`, keyframes in
 * style/global.css), not a script, and it settles after five cycles (see the
 * note there): the page a visitor is reading ends up doing no work at all,
 * where a scripted tween restyled every chip on every frame, forever.
 * `prefers-reduced-motion` renders it static (`motion-safe`). Float animates
 * ITS OWN div: the hero entrance animates the outer positioning wrapper, so
 * the transforms never collide.
 */
export default function Float({
  amplitude,
  duration,
  delay = 0,
  rotate = 0,
  className,
  children,
}: {
  /** Pixels of vertical travel. Default: --motion-float-distance token. */
  amplitude?: number;
  /** Seconds for a full up-down cycle. Default: --motion-float-duration token. */
  duration?: number;
  /** Seconds; stagger multiple floats so they de-sync. */
  delay?: number;
  /** Degrees of slow rotation drift (subtle: -2..2). */
  rotate?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const style = {
    ...(amplitude !== undefined && { "--float-travel": `${amplitude}px` }),
    ...(duration !== undefined && { "--float-cycle": `${duration}s` }),
    ...(delay !== 0 && { "--float-delay": `${delay}s` }),
    ...(rotate !== 0 && { "--float-rotate": `${rotate}deg` }),
  } as React.CSSProperties;

  return (
    <div className={cn("motion-safe:animate-mkt-float", className)} style={style}>
      {children}
    </div>
  );
}
