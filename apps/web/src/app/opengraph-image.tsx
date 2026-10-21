import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { BRAND } from "@/brand";
import { DEFAULTS } from "@/config";
import { common, hsl, type ThemeName, themes } from "@flyee/design-tokens";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// fs is the only way to reach the art without the renderer calling back into
// its own origin, which a build-time render would deadlock.
export const runtime = "nodejs";

/**
 * Shared Open Graph card for the public site — the image WhatsApp, LinkedIn and
 * Google show next to the link.
 *
 * It carries the official lockup itself, not the name set in a system face:
 * the lettermark IS the brand's display type, and no font file would say it
 * better. The ground is the site's light neutral with the primary wash of the
 * hero, flattened, so the card belongs to the page it links to.
 *
 * Composition is centred rather than left-aligned on purpose. The 1200×630 card
 * is letterboxed into a near-square slot in Google's result and cropped by some
 * feeds; anything pushed to an edge is the first thing lost.
 */

/** `public/` is what ships; `src/` assets are not traced into the serverless bundle. */
const publicAsset = (...segments: string[]) => path.join(process.cwd(), "public", ...segments);

/**
 * Every asset is optional by design. A missing file must degrade to a plainer
 * card — an exception here returns no image at all, which costs every link
 * preview on the site, a far worse outcome than a card without its logo.
 */
async function loadAsset(file: string): Promise<Buffer | null> {
  return readFile(file).catch(() => null);
}

/**
 * The lockup as an image source the renderer can size. The master declares
 * `width="100%" height="100%"`, which means nothing outside a page, so the
 * copy handed over states the size its own viewBox gives. The file on disk is
 * never touched.
 */
function embeddable(svg: string): { src: string; ratio: number } | null {
  const marker = 'viewBox="';
  const start = svg.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const [, , width, height] = svg.slice(from, svg.indexOf('"', from)).trim().split(" ").map(Number);
  if (!width || !height) return null;
  const sized = svg.replace('width="100%" height="100%"', `width="${width}" height="${height}"`);
  return { src: `data:image/svg+xml;base64,${Buffer.from(sized).toString("base64")}`, ratio: width / height };
}

const LOCKUP_WIDTH = 600;

export default async function OpenGraphImage() {
  // The palette the site itself applies (DEFAULTS.themeColor), never a second
  // name to keep in step with it.
  const palette = themes[DEFAULTS.themeColor.slice("theme-".length) as ThemeName].light;
  const primary = hsl(palette["primary"]);
  const secondary = hsl(palette["secondary"]);
  const background = hsl(common.light["background"]);
  const textPrimary = hsl(common.light["text-primary"]);
  const textSecondary = hsl(common.light["text-secondary"]);

  const lockupFile = await loadAsset(publicAsset("brand", "one-lockup-light.svg"));
  const lockup = lockupFile ? embeddable(lockupFile.toString("utf8")) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background,
          fontFamily: "sans-serif",
        }}
      >
        {/* The hero glow of the site, flattened: a primary wash behind the
            lockup, so the card has depth without a colour that fights it. */}
        <div
          style={{
            position: "absolute",
            top: -260,
            width: 900,
            height: 900,
            borderRadius: 450,
            background: `radial-gradient(circle, ${hsl(palette["primary"], 0.16)} 0%, ${hsl(palette["primary"], 0)} 70%)`,
          }}
        />
        {lockup ? (
          <img width={LOCKUP_WIDTH} height={Math.round(LOCKUP_WIDTH / lockup.ratio)} alt="" src={lockup.src} />
        ) : (
          <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -2, color: textPrimary }}>{BRAND.name}</div>
        )}
        <div
          style={{
            width: 170,
            height: 4,
            marginTop: 34,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
          }}
        />
        <div
          style={{
            fontSize: 34,
            fontWeight: 500,
            marginTop: 30,
            maxWidth: 860,
            textAlign: "center",
            lineHeight: 1.35,
            color: textSecondary,
          }}
        >
          {BRAND.description}
        </div>
      </div>
    ),
    size,
  );
}
