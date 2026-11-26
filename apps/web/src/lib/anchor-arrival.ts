/**
 * How a screen hears a person arrive at one of its anchors: a link to `#case-people` from the top of the screen, the
 * bell, the home or another card, or an address that names it. Every follower of an arrival listens here (the tab a
 * card is in, the card that opens, the line of a list that asks), so one link reaches them all at once.
 *
 * Three moments say an arrival, and a follower that heard only one missed links (2026-11-26): the address the screen
 * mounts with, a `hashchange`, and the click on a link to an anchor of this very page. A link the router draws
 * (`next/link`) changes the address with no `hashchange`. The browser's own link says none when the address already
 * names that anchor, which is so as soon as the case's tabs write it there during the click. A card that listened to
 * `hashchange` alone stayed closed while its tab opened.
 */

/** The id an address's `#...` names, or null: an address somebody typed wrong (`#%E0%A4%A`) never breaks the screen. */
export function anchorOf(hash: string): string | null {
  try {
    return decodeURIComponent(hash.replace(/^#/, "")) || null;
  } catch {
    return null;
  }
}

/**
 * Where a click goes when it goes to an anchor of this very page, or null. Only a plain click counts: one that opens
 * another tab or window of the browser (a modifier key, the middle button, `target="_blank"`) leaves the page as it
 * is, and so does a link to another page, to another site, or to no anchor.
 */
function clickedTo(event: MouseEvent): { anchor: string; at: URL } | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  const href = link?.getAttribute("href");
  if (!link || !href || !href.includes("#") || link.getAttribute("target") === "_blank") return null;
  let at: URL;
  try {
    at = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (at.origin !== window.location.origin || at.pathname !== window.location.pathname) return null;
  const anchor = anchorOf(at.hash);
  return anchor ? { anchor, at } : null;
}

/**
 * Calls `arrive` with each anchor the person comes to on this page, and the address that brought them (`at`: the
 * page's own, or the link's, which may carry what the screen reads of its query, as `?acesso=`): the address's anchor
 * at once, then on each `hashchange`, and on each plain click on a link to an anchor of the page, whatever draws the
 * link. A link of the browser may say both its click and its `hashchange`, so `arrive` must leave the screen as it
 * was after the first call. Returns what stops listening, for an effect to give back.
 */
export function followArrivals(arrive: (anchor: string, at: URL) => void): () => void {
  const fromAddress = () => {
    const anchor = anchorOf(window.location.hash);
    if (anchor) arrive(anchor, new URL(window.location.href));
  };
  const clicked = (event: MouseEvent) => {
    const to = clickedTo(event);
    if (to) arrive(to.anchor, to.at);
  };
  fromAddress();
  window.addEventListener("hashchange", fromAddress);
  document.addEventListener("click", clicked);
  return () => {
    window.removeEventListener("hashchange", fromAddress);
    document.removeEventListener("click", clicked);
  };
}
