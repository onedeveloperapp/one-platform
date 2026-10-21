/**
 * What the domain asks of a person's dates. Dates are calendar days
 * (`YYYY-MM-DD`), with no clock and no time zone: a birthday is a day, and
 * whether somebody is of age on a day does not depend on where they are.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day, or null when the text is not a day that exists (`2026-02-30` is not). */
export function readDay(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = DAY.exec(String(value ?? ""));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * Full years of age on a day. Somebody born on 29 February has a year more on
 * 1 March of a year without that day. Null when either day is not a day, or
 * when the person was not born yet.
 */
export function ageOn(birthDate: string | null | undefined, onDate: string | null | undefined): number | null {
  const birth = readDay(birthDate);
  const on = readDay(onDate);
  if (!birth || !on) return null;
  let age = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) age -= 1;
  return age >= 0 ? age : null;
}

/** Under 18 on the day: the person cannot be a party in the small-claims court on their own. Null when it cannot be said. */
export function isMinorOn(birthDate: string | null | undefined, onDate: string | null | undefined): boolean | null {
  const age = ageOn(birthDate, onDate);
  return age === null ? null : age < 18;
}

/** A day as people in Brazil write it: `06/10/2026`. Null when it is not a day. */
export function formatDayBr(value: string | null | undefined): string | null {
  const day = readDay(value);
  if (!day) return null;
  return `${String(day.day).padStart(2, "0")}/${String(day.month).padStart(2, "0")}/${day.year}`;
}

/** A day typed as people in Brazil write it (`06/10/2026`), in the stored form (`2026-10-06`). */
export function parseDayBr(input: string | null | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(input ?? "").trim());
  if (!match) return null;
  const value = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return readDay(value) ? value : null;
}
