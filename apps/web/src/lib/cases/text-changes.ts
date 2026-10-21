/**
 * What changed between two texts of a piece, for a lawyer who sent a text
 * back to the AI and reads what came of it: paragraph by paragraph and, in a
 * paragraph that changed, word by word. Pure: no I/O, no clock.
 *
 * It shows; it decides nothing. The text a lawyer approves is the whole
 * text, read in the preview: what is here only says where to look first.
 * Two texts too far apart to be compared in a moment are shown as one text
 * taken out and another put in, never as a comparison cut short.
 */

/** A stretch of a paragraph that changed. */
export type ChangePart = { kind: "same" | "added" | "removed"; text: string };

export type ChangeBlock =
  /** Paragraphs in a row that did not change. */
  | { kind: "same"; count: number }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string }
  /** One paragraph rewritten: what stayed, what went and what came, in the order of the new text. */
  | { kind: "changed"; parts: ChangePart[] };

export type TextChanges = {
  blocks: ChangeBlock[];
  /** How many paragraphs were added, removed or rewritten. */
  changed: number;
  /**
   * No word changed and the two texts are still not the same: only how the
   * lines break or the spaces fall inside a paragraph, which a document
   * prints. Said apart, so that such a text is never told to be untouched.
   */
  layout: boolean;
};

type Step = "same" | "removed" | "added";

/** The largest table a comparison fills: beyond it, the two sides are shown whole. */
const PARAGRAPH_CELLS = 4_000_000;
const WORD_CELLS = 400_000;
/** Below this share of words in common, two paragraphs are two paragraphs, not one rewritten. */
const SAME_PARAGRAPH = 0.3;

/**
 * How one list becomes another by the fewest removals and additions (the
 * longest run in common stays). `null` when the two are too long to compare.
 */
function steps(before: readonly string[], after: readonly string[], cells: number): Step[] | null {
  const n = before.length;
  const m = after.length;
  if (n === 0) return after.map(() => "added");
  if (m === 0) return before.map(() => "removed");
  if (n * m > cells) return null;
  const width = m + 1;
  // table[i * width + j]: the longest run in common of what is left from i and from j.
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const path: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      path.push("same");
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      path.push("removed");
      i += 1;
    } else {
      path.push("added");
      j += 1;
    }
  }
  for (; i < n; i += 1) path.push("removed");
  for (; j < m; j += 1) path.push("added");
  return path;
}

const words = (paragraph: string): string[] => paragraph.split(/\s+/).filter((word) => word !== "");

/** One paragraph against the one that took its place: `null` when they are two different paragraphs. */
function rewritten(before: string, after: string): ChangePart[] | null {
  const left = words(before);
  const right = words(after);
  const path = steps(left, right, WORD_CELLS);
  if (!path) return null;
  const kept = path.filter((step) => step === "same").length;
  if (kept < SAME_PARAGRAPH * Math.max(left.length, right.length)) return null;
  const parts: ChangePart[] = [];
  let i = 0;
  let j = 0;
  for (const step of path) {
    const word = step === "removed" ? left[i] : right[j];
    if (step !== "added") i += 1;
    if (step !== "removed") j += 1;
    const last = parts[parts.length - 1];
    if (last && last.kind === step) last.text += ` ${word}`;
    else parts.push({ kind: step, text: word });
  }
  return parts;
}

/**
 * The paragraphs of a text, as its document prints them (`draftBlocks`):
 * what an empty line separates, each with its lines as they were written
 * and nothing around them. A line of spaces alone is no empty line there,
 * so it is none here: two texts that print differently never compare as the
 * same.
 */
export function paragraphsOf(text: string): string[] {
  // A letter and its accent typed as two characters are the one letter: a text the database gave back has
  // them as one (`case_text_keyed`), and that is no change of a word.
  return String(text ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter((paragraph) => paragraph !== "");
}

/**
 * What changed from `before` to `after`. Spaces and line breaks inside a
 * paragraph change no word, so they are no changed paragraph: `layout` says
 * when they are all that differs.
 */
export function textChanges(before: string, after: string): TextChanges {
  const left = paragraphsOf(before);
  const right = paragraphsOf(after);
  const plain = (paragraph: string) => paragraph.replace(/\s+/g, " ");
  const leftKeys = left.map(plain);
  const rightKeys = right.map(plain);

  // What the two start and end with in common is set aside first: a rewriting changes a few paragraphs.
  let head = 0;
  while (head < left.length && head < right.length && leftKeys[head] === rightKeys[head]) head += 1;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > head && rightEnd > head && leftKeys[leftEnd - 1] === rightKeys[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }

  const blocks: ChangeBlock[] = [];
  const same = (count: number) => {
    if (count <= 0) return;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === "same") last.count += count;
    else blocks.push({ kind: "same", count });
  };
  // A run of paragraphs taken out and the run put in their place: each pair that is one paragraph rewritten
  // is shown word by word, and the rest as taken out or put in.
  const replace = (removed: string[], added: string[]) => {
    const pairs = Math.min(removed.length, added.length);
    for (let index = 0; index < pairs; index += 1) {
      const parts = rewritten(removed[index], added[index]);
      if (parts) blocks.push({ kind: "changed", parts });
      else blocks.push({ kind: "removed", text: removed[index] }, { kind: "added", text: added[index] });
    }
    for (const text of removed.slice(pairs)) blocks.push({ kind: "removed", text });
    for (const text of added.slice(pairs)) blocks.push({ kind: "added", text });
  };

  same(head);
  const path = steps(leftKeys.slice(head, leftEnd), rightKeys.slice(head, rightEnd), PARAGRAPH_CELLS);
  if (!path) {
    // Too far apart to be compared in a moment: one text taken out and the other put in, whole. Never paired
    // by their place, which would call rewritten two paragraphs that only share their common words.
    for (const text of left.slice(head, leftEnd)) blocks.push({ kind: "removed", text });
    for (const text of right.slice(head, rightEnd)) blocks.push({ kind: "added", text });
  } else {
    let i = head;
    let j = head;
    let removed: string[] = [];
    let added: string[] = [];
    const flush = () => {
      if (removed.length > 0 || added.length > 0) replace(removed, added);
      removed = [];
      added = [];
    };
    for (const step of path) {
      if (step === "same") {
        flush();
        same(1);
        i += 1;
        j += 1;
      } else if (step === "removed") {
        removed.push(left[i]);
        i += 1;
      } else {
        added.push(right[j]);
        j += 1;
      }
    }
    flush();
  }
  same(left.length - leftEnd);

  const changed = blocks.filter((block) => block.kind !== "same").length;
  // With no paragraph changed the two have the same paragraphs, one for one: what may differ is inside them.
  const layout = changed === 0 && left.some((paragraph, index) => paragraph !== right[index]);
  return { blocks, changed, layout };
}
