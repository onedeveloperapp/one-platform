/**
 * A person's name as the database compares it (migration 0032,
 * `import_names_match`): its letters read as `slugify` (0000) reads them, so
 * that the screen and the database never disagree on whether two ways of
 * writing a name are one person's. Pure.
 */

/** The letters `slugify` writes without their marks, and what it writes for each: the same two strings as 0000. */
export const SLUG_FROM = "áàâãäåāăąçćčĉċďđéèêëēĕėęěğĝġģíìîïĩīĭįıĺľłļñńňņóòôõöøōŏőŕřšśşŝťţúùûüũūŭůűųýÿŷžźż";
export const SLUG_TO = "aaaaaaaaacccccddeeeeeeeeeggggiiiiiiiiillllnnnnooooooooorrssssttuuuuuuuuuuyyyzzz";

const LETTER = new Map([...SLUG_FROM].map((letter, index) => [letter, SLUG_TO[index]]));

/** Words of a name that are no part of who a person is. */
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);

/** An apostrophe joins what it separates: "D'Ávila" is one word. */
const APOSTROPHES = /['’‘`´]/g;

/** The words of a name, as `slugify` cuts them, with no particles. */
export function nameWords(name: string): string[] {
  const slug = [...name.replace(APOSTROPHES, "").toLowerCase()]
    .map((letter) => LETTER.get(letter) ?? letter)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.split("-").filter((word) => word !== "" && !PARTICLES.has(word));
}

/**
 * Whether two ways of writing a name are one person's, as a spreadsheet and the firm's record may write it:
 * the same first name (or its initial), and every word of the shorter one in the longer one (an initial for
 * a word), with no accents, no case and no particles. "Maria Teste" is "MARIA TESTE DA SILVA"; "Pedro
 * Teste" is not "Maria Teste". The same rule as `import_names_match` of migration 0032.
 */
export function namesMatch(first: string, second: string): boolean {
  const a = nameWords(first);
  const b = nameWords(second);
  if (a.length === 0 || b.length === 0) return false;
  const same = (one: string, other: string) =>
    one === other || (one.length === 1 && other.startsWith(one)) || (other.length === 1 && one.startsWith(other));
  if (!same(a[0], b[0])) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.every((word) => longer.some((other) => same(word, other)));
}
