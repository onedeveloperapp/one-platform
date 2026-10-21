import lockupDark from "../../../public/brand/one-lockup-dark.svg";
import lockupLight from "../../../public/brand/one-lockup-light.svg";
import symbolLight from "../../../public/brand/one-mark.svg";
import symbolDark from "../../../public/brand/one-mark-dark.svg";

import { BRAND } from "@/brand";
import { cn } from "@/lib/utils";

/**
 * The single logo component: the dashboard header AND the public header and
 * footer render this; never create a second logo implementation.
 *
 * The art is the PROVISIONAL ONE set (2026-10-08), used until the official
 * logo is delivered; replacing it means swapping the four files below and
 * running `npm run brand:assets -w @flyee/web`. It lives in
 * apps/web/public/brand/ and is referenced here, never redrawn:
 * - the lockup (mark + "ONE" lettermark): one-lockup-light.svg for light
 *   surfaces, one-lockup-dark.svg for dark surfaces;
 * - the mark alone: one-mark.svg (blue tile, for light surfaces) and
 *   one-mark-dark.svg (cyan tile, for dark surfaces).
 *
 * The brand colours belong to the art, so nothing here is tinted by a token.
 * What follows the theme is WHICH file shows: the light-surface file in light
 * mode and the dark-surface file under `.dark`. `tone="contrast"` is for the
 * deep band (the footer, `--background-deep`), which is dark in both modes:
 * the dark-surface file, always.
 *
 * Each variant is an <svg> sized by its own attributes, like the drawing it
 * replaced, so a caller's sizing and display classes keep working. The files
 * are imported, not addressed by path, so they ship under a hashed URL that
 * the browser caches for good and a missing file fails the build.
 * Variants: full (the lockup) and compact (the mark), toggled via className.
 */

/** What Next resolves an imported image file to. */
type Art = { src: string; width: number; height: number };

const LOCKUP: { light: Art; dark: Art } = { light: lockupLight, dark: lockupDark };
const SYMBOL: { light: Art; dark: Art } = { light: symbolLight, dark: symbolDark };

/** Rendered height when the caller passes no size: the 27px of the header rows. */
const DEFAULT_HEIGHT = 27;

/**
 * One variant. With `onDeep` the surface is dark whatever the mode, so only the
 * dark-surface file is drawn; otherwise both are, and the mode picks one.
 */
function Variant({ className, art, onDeep }: { className?: string; art: { light: Art; dark: Art }; onDeep: boolean }) {
  const { light, dark } = art;
  return (
    <svg
      className={className}
      width={Math.round((DEFAULT_HEIGHT * light.width) / light.height)}
      height={DEFAULT_HEIGHT}
      viewBox={`0 0 ${light.width} ${light.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={BRAND.name}
    >
      {onDeep ? null : <image href={light.src} width={light.width} height={light.height} className="dark:hidden" />}
      <image
        href={dark.src}
        width={dark.width}
        height={dark.height}
        className={onDeep ? undefined : "hidden dark:inline"}
      />
    </svg>
  );
}

export default function Logo({
  classNameFull,
  classNameMobile,
  tone = "default",
}: {
  classNameFull?: string;
  classNameMobile?: string;
  /** "contrast": on the deep band (the footer), dark in both modes. */
  tone?: "default" | "contrast";
}) {
  const onDeep = tone === "contrast";
  return (
    <>
      <Variant className={cn(classNameFull)} art={LOCKUP} onDeep={onDeep} />
      <Variant className={cn(classNameMobile)} art={SYMBOL} onDeep={onDeep} />
    </>
  );
}
