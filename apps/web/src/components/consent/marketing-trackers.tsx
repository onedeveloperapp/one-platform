import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import {
  GA4_ID,
  ga4ScriptUrl,
  ga4Snippet,
  META_PIXEL_ID,
  metaPixelNoscriptUrl,
  metaPixelSnippet,
} from "@/lib/tracker-snippets";

/**
 * Meta Pixel + GA4 base scripts of the PUBLIC SITE, rendered SERVER-SIDE so they
 * are present in the initial HTML (detectable by audits, and firing for every
 * visitor). OPT-OUT model: they load by default and are skipped only when the
 * visitor opted out (the `analyticsOptOut` cookie). Nothing renders when no id
 * is configured.
 *
 * Mounted by the marketing and funnel layouts. The member area loads the same
 * snippets after the page is interactive and never on the admin consoles
 * (components/consent/dashboard-trackers.tsx, docs/TRACKING.md).
 */
export default async function MarketingTrackers() {
  if (!META_PIXEL_ID && !GA4_ID) return null;
  const optedOut = (await cookies()).get(COOKIE_KEYS.analyticsOptOut)?.value === "1";
  if (optedOut) return null;

  return (
    <>
      {META_PIXEL_ID && (
        <>
          <script id="meta-pixel" dangerouslySetInnerHTML={{ __html: metaPixelSnippet(META_PIXEL_ID) }} />
          <noscript>
            <img height="1" width="1" style={{ display: "none" }} alt="" src={metaPixelNoscriptUrl(META_PIXEL_ID)} />
          </noscript>
        </>
      )}
      {GA4_ID && (
        <>
          <script async src={ga4ScriptUrl(GA4_ID)} />
          <script id="ga4-init" dangerouslySetInnerHTML={{ __html: ga4Snippet(GA4_ID) }} />
        </>
      )}
    </>
  );
}
