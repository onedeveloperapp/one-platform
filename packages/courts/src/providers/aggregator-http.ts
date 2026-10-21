/**
 * What the aggregators' clients share: one GET of JSON with the vendor's key,
 * and the errors the tracking tells apart. A refused key and a balance that
 * ran out are the platform's to fix, not the lawsuit's: the tracking stops
 * asking until they are. Anything else that is not an answer is the vendor
 * out of the air, asked again later. A lawsuit the vendor does not have is
 * no error: the client answers "not found".
 */

/** The vendor refused the key (401, 403). */
export class AggregatorAuthError extends Error {
  constructor(vendor: string) {
    super(`${vendor}_key_refused`);
    this.name = "AggregatorAuthError";
  }
}

/** The vendor's prepaid balance ran out (402). */
export class AggregatorNoCreditError extends Error {
  constructor(vendor: string) {
    super(`${vendor}_no_credit`);
    this.name = "AggregatorNoCreditError";
  }
}

/** The vendor did not answer, or answered what cannot be read whole. */
export class AggregatorUnavailableError extends Error {
  readonly status: number | null;
  constructor(vendor: string, status: number | null, reason = "no_answer") {
    super(status === null ? `${vendor}_${reason}` : `${vendor}_http_${status}`);
    this.name = "AggregatorUnavailableError";
    this.status = status;
  }
}

export type JsonAnswer = { status: number; body: unknown };

/** One GET of JSON. A 404 is answered (the caller says what it means); every other failure throws. */
export async function getJson(
  vendor: string,
  url: string,
  headers: Record<string, string>,
  options: { fetch?: typeof fetch; timeoutMs?: number },
): Promise<JsonAnswer> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch {
    throw new AggregatorUnavailableError(vendor, null);
  }
  if (response.status === 401 || response.status === 403) throw new AggregatorAuthError(vendor);
  if (response.status === 402) throw new AggregatorNoCreditError(vendor);
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new AggregatorUnavailableError(vendor, response.status);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    throw new AggregatorUnavailableError(vendor, null, "unreadable");
  }
}

/** A record of an answer, or an empty one: the shapes below are read field by field, never trusted whole. */
export const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : null;
