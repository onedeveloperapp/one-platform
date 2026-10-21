/**
 * How the admin consoles write numbers and dates.
 *
 * The consoles speak pt-BR to one operator and are rendered on the server and
 * again in the browser. A date formatted with the runtime's own locale and time
 * zone comes out differently on each side (the server runs in UTC), which React
 * reports as a hydration mismatch and the operator sees as a date that flips.
 * Every formatter here therefore names the locale AND the time zone: Brasília,
 * the same clock the weekly metrics are cut by (`admin_segment_weekly`).
 */

const LOCALE = "pt-BR";
export const ADMIN_TIME_ZONE = "America/Sao_Paulo";

const DAY = 86_400_000;

/** `R$ 67` for a round amount, `R$ 67,50` otherwise. Currencies are never added together. */
export function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  const amount = cents ?? 0;
  const whole = amount % 100 === 0;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: currency || "BRL",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount / 100);
}

/** Revenue kept per currency: `R$ 1.250 + US$ 190`, or a dash when there is none. */
export function formatMoneyByCurrency(amounts: Partial<Record<string, number>> | null | undefined): string {
  const parts = Object.entries(amounts ?? {})
    .filter(([, cents]) => (cents ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => formatMoney(cents, currency));
  return parts.length > 0 ? parts.join(" + ") : "—";
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(LOCALE).format(value ?? 0);
}

/** A share as a percentage. `null` (nothing to divide by) is a dash, never 0%. */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/** `part / whole`, or null when the whole is zero: an empty cohort has no rate. */
export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeZone: ADMIN_TIME_ZONE }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ADMIN_TIME_ZONE,
  }).format(new Date(value));
}

/** A calendar date with no time in it (`2026-09-28`), written without shifting it across a time zone. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}

/** Whole days from `value` until `now` (negative when `value` is ahead). */
export function daysSince(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor((now - time) / DAY) : null;
}

/** "hoje", "ontem", "há 12 d" or "nunca": the operator reads distance, not dates. */
export function sinceLabel(value: string | null | undefined, now: number = Date.now()): string {
  const days = daysSince(value, now);
  if (days === null) return "nunca";
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} d`;
}

/** "hoje", "amanhã", "em 12 d" or "há 3 d": the distance to a date that may be ahead. */
export function untilLabel(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  if (time < now) return sinceLabel(value, now);
  const days = Math.floor((time - now) / DAY);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} d`;
}

export function formatBytes(bytes: number | null | undefined): string {
  const size = bytes ?? 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** "1 conta" / "3 contas". */
export const plural = (count: number, one: string, many: string): string =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

/**
 * The value an `<input type="datetime-local">` shows for an instant, on the
 * console's clock, and back. The browser's own zone is not used: a meeting set
 * for 19:00 means 19:00 in Brasília wherever the operator is sitting.
 */
export function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

/** Brasília has had no daylight saving since 2019: a fixed -03:00 offset. */
export function fromLocalInput(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00-03:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * The Monday of the week an instant falls in, on the console's clock, as
 * `YYYY-MM-DD`: the same key `date_trunc('week', … at time zone
 * 'America/Sao_Paulo')` produces in the reporting functions.
 */
export function weekStartOf(instant: string | number | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(instant));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const local = Date.UTC(Number(pick("year")), Number(pick("month")) - 1, Number(pick("day")));
  const monday = new Date(local - (WEEKDAY_INDEX[pick("weekday")] ?? 0) * DAY);
  return monday.toISOString().slice(0, 10);
}

/** The last `count` week starts ending with the week of `from`, oldest first. */
export function lastWeeks(count: number, from: string | number | Date): string[] {
  const end = new Date(`${weekStartOf(from)}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - 1 - index) * 7 * DAY).toISOString().slice(0, 10),
  );
}

/** "28/09" for a week start: enough to name a column. */
export function formatWeek(weekStart: string): string {
  const [, month, day] = weekStart.slice(0, 10).split("-");
  return month && day ? `${day}/${month}` : weekStart;
}
