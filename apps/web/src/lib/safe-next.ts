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
