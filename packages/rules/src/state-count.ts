/**
 * The count of a lawyer's causes per state, against the supplementary
 * registration at the bar.
 *
 * A lawyer who practices habitually in another state's section registers
 * there too; habitual is "the judicial intervention that exceeds five causes
 * a year" (Lei 8.906/1994, art. 10, §2; Provimento CFOAB 178/2017 details it:
 * up to five a year is occasional). A mass-litigation firm files for
 * passengers all over Brazil, so it counts, per lawyer and per state, the
 * causes of a calendar year, and says where one more would cross the line
 * without a registration there.
 *
 * What counts as a cause (one the lawyer signs, filed in that state's court)
 * is decided by the caller from the lawsuits; this only counts and compares.
 * Some sections have proposed counting a mere power of attorney in the
 * records too (a consultation pending at the Federal Council in 2026): the
 * caller may hand those in as well.
 */

export const STATE_COUNT_RULE_VERSION = "inscricao-suplementar-v1";

/** More than this many causes in a year, in a state, is habitual practice there. */
export const OCCASIONAL_CAUSES_PER_YEAR = 5;

export type CauseInState = { uf: string; year: number };

export type StateCount = {
  uf: string;
  count: number;
  /** The lawyer has a registration there (the principal or a supplementary one). */
  registered: boolean;
  /** More than five causes this year: habitual practice there. */
  habitual: boolean;
  /** Habitual, and no registration there. */
  needsSupplementary: boolean;
  /** How many more causes stay occasional there; null where the lawyer is registered. */
  remaining: number | null;
};

export function countCausesByState(input: {
  registeredUfs: string[];
  causes: CauseInState[];
  year: number;
}): { year: number; states: StateCount[]; rule: typeof STATE_COUNT_RULE_VERSION } {
  const registered = new Set(input.registeredUfs.map((uf) => uf.trim().toUpperCase()));
  const counts = new Map<string, number>();
  for (const cause of input.causes) {
    if (cause.year !== input.year) continue;
    const uf = cause.uf.trim().toUpperCase();
    counts.set(uf, (counts.get(uf) ?? 0) + 1);
  }
  const states = [...counts.entries()]
    .map(([uf, count]): StateCount => {
      const isRegistered = registered.has(uf);
      const habitual = count > OCCASIONAL_CAUSES_PER_YEAR;
      return {
        uf,
        count,
        registered: isRegistered,
        habitual,
        needsSupplementary: habitual && !isRegistered,
        remaining: isRegistered ? null : Math.max(0, OCCASIONAL_CAUSES_PER_YEAR - count),
      };
    })
    .sort((left, right) => right.count - left.count || left.uf.localeCompare(right.uf));
  return { year: input.year, states, rule: STATE_COUNT_RULE_VERSION };
}

/** Whether one more cause in a state would make the practice there habitual without a registration. */
export function oneMoreNeedsSupplementary(count: StateCount | undefined, uf: string, registeredUfs: string[]): boolean {
  if (registeredUfs.map((value) => value.trim().toUpperCase()).includes(uf.trim().toUpperCase())) return false;
  return (count?.count ?? 0) + 1 > OCCASIONAL_CAUSES_PER_YEAR;
}
