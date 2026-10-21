/**
 * How alike two pieces are.
 *
 * A firm that files many lawsuits of the same kind writes from the same
 * models, and a court that reads two petitions that are the same text with
 * the names changed asks what the firm knows of each case. So each piece
 * gets a signature, and two signatures say how much of their text the two
 * pieces share: what a judge would see, said to the firm before the judge
 * sees it. It measures and decides nothing.
 *
 * The measure is the share of sequences of a few words the two texts have
 * in common (Jaccard over word shingles), estimated from a signature of
 * fixed size (MinHash), so two pieces are compared without reading either
 * text again. Pure and deterministic: the same text gives the same
 * signature on any machine.
 */

/** How many words make a sequence. Five reads as a phrase: shorter, and any two texts in Portuguese look alike. */
export const SHINGLE_WORDS = 5;

/** How many numbers a signature has. With 128, an estimate is within a few points of the true share. */
export const SIGNATURE_SLOTS = 128;

/** The words of a text as they are compared: no case, no accent, no punctuation, no figure. */
export function comparableWords(text: string): string[] {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // A name, a date, a flight or an amount changed is still the same text: figures are all one word.
    .replace(/\d[\d.,/:-]*/g, " 0 ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The sequences of words of a text. A text shorter than one sequence has none. */
export function shingles(text: string, size: number = SHINGLE_WORDS): Set<string> {
  const words = comparableWords(text);
  const found = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) found.add(words.slice(index, index + size).join(" "));
  return found;
}

/** The share of sequences two texts have in common, of all the sequences either has. From 0 to 1. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** FNV-1a over the characters of a sequence: the same on every machine. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

/** One of the many orders the sequences are ranked in: a mix of the hash with the number of the slot. */
function mix(value: number, slot: number): number {
  let result = value ^ Math.imul(slot + 1, 0x9e3779b1);
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b);
  result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
  return (result ^ (result >>> 16)) >>> 0;
}

/**
 * The signature of a text: for each slot, the smallest value any of its
 * sequences takes in that slot's order. Kept as signed 32-bit integers, the
 * size a database column of integers holds. A text with no sequence has an
 * empty signature and is like nothing.
 */
export function signature(text: string, slots: number = SIGNATURE_SLOTS): number[] {
  const hashes = [...shingles(text)].map(hash);
  if (hashes.length === 0) return [];
  const result: number[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    let smallest = 0xffffffff;
    for (const value of hashes) {
      const ranked = mix(value, slot);
      if (ranked < smallest) smallest = ranked;
    }
    result.push(smallest | 0);
  }
  return result;
}

/**
 * How alike two texts are, from their signatures: the share of slots where
 * both hold the same value, which estimates the share of sequences they have
 * in common. From 0 to 1; 0 when either has none, or when they are not of
 * the same size.
 */
export function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let same = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] === b[index]) same += 1;
  return same / a.length;
}
