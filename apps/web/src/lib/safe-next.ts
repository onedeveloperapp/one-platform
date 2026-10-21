/**
 * Safe `?next=` handling for every auth entry point and the middleware.
 *
 * Moved out of the inherited clinical package (2026-10-01): the redirect rules
 * are platform plumbing, not domain logic.
 */

const SAFE_DEFAULT_NEXT = "/inicio";

function sanitizeCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this check rejects.
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return null;

  try {
    const decoded = decodeURIComponent(candidate);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) return null;

    const base = "https://one.internal";
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * Prevent open redirects while preserving a user's in-product journey.
 * The fallback is sanitized by the same rules and ultimately becomes /inicio.
 */
export function sanitizeInternalNext(value: string | null | undefined, fallback = SAFE_DEFAULT_NEXT): string {
  return sanitizeCandidate(value) ?? sanitizeCandidate(fallback) ?? SAFE_DEFAULT_NEXT;
}

/**
 * Goes to `path` after a screen changed the session (signed in, passed the
 * second factor, founded or joined a firm, set a new password, signed out), or
 * from the auth screens into the logged area: a document load, never the
 * client router. The router keeps what it drew under the old session (its
 * cache, and the layouts it does not draw again), and the gate's redirect in
 * the middle of a client navigation, with the refresh such a screen then asked
 * for, kept the router fetching the page the gate sent to without ever drawing
 * it (2026-10-21: a founder with no second factor yet was left on a blank
 * screen). A document load runs the middleware and the gate again under the
 * new cookies. It replaces the page in the history, so going back never lands
 * on a screen that sends the person forward again. Browser only.
 *
 * The promise never settles: the page is leaving, and a form that awaits it
 * stays busy until it is gone, so a second click does not do it again.
 */
export function enterAfterSessionChange(path: string): Promise<never> {
  window.location.replace(sanitizeInternalNext(path));
  return new Promise<never>(() => {});
}
