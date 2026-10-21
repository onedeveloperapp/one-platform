// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { countsNow, holdList, triagedInList, withSaid, withSeen } from "@/lib/publications/list-state";

const SCREEN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../app/(dashboard)/publicacoes/publications-view.tsx",
);

const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
const counts = { untriaged: 80, review: 2, triaged: 12, cancelled: 3 };

describe("the list of publications a person works through", () => {
  it("starts as it was read, with nothing said yet", () => {
    const held = holdList(rows, counts);
    expect(held.rows).toEqual(rows);
    expect(countsNow(held)).toEqual(counts);
    expect(triagedInList(held)).toBe(0);
    // What the server read is copied: what it reads next changes nothing the screen holds.
    expect(held.rows).not.toBe(rows);
    expect(held.counts).not.toBe(counts);
  });

  it("keeps a triaged publication where it was, with the word it got, and counts it once", () => {
    let held = holdList(rows, counts);
    held = withSaid(held, "b", null, { category: "prazo", note: null });
    // The publication is still a row of the list: the person sees what they said, and may put it right.
    expect(held.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(held.said.b).toEqual({ category: "prazo", note: null });
    expect(countsNow(held)).toEqual({ untriaged: 79, review: 2, triaged: 13, cancelled: 3 });
    expect(triagedInList(held)).toBe(1);

    // A wrong click put right, and a note added, are the same publication: nothing is counted again.
    held = withSaid(held, "b", null, { category: "audiencia", note: "Dia 20." });
    expect(held.said.b).toEqual({ category: "audiencia", note: "Dia 20." });
    expect(countsNow(held)).toEqual({ untriaged: 79, review: 2, triaged: 13, cancelled: 3 });
    expect(triagedInList(held)).toBe(1);
  });

  it("moves nothing when a publication that already had a word gets another", () => {
    const held = withSaid(holdList(rows, counts), "a", "ciencia", { category: "prazo", note: null });
    expect(countsNow(held)).toEqual(counts);
    expect(triagedInList(held)).toBe(0);
    expect(held.said.a.category).toBe("prazo");
  });

  it("counts one found by a search for the firm, and not as one of the list on the screen", () => {
    let held = holdList(rows, counts);
    held = withSaid(held, "z", null, { category: "decisao", note: null });
    // It was one more of the firm's to triage: the counts are the firm's.
    expect(countsNow(held)).toEqual({ untriaged: 79, review: 2, triaged: 13, cancelled: 3 });
    // And it is no row of this list: nothing "stays here" because of it.
    expect(triagedInList(held)).toBe(0);
    held = withSaid(held, "a", null, { category: "prazo", note: null });
    expect(triagedInList(held)).toBe(1);
    expect(countsNow(held)).toEqual({ untriaged: 78, review: 2, triaged: 14, cancelled: 3 });
  });

  it("never counts below nothing, and remembers a cancelling the person said they saw", () => {
    let held = holdList(rows, { untriaged: 0, review: 0, triaged: 0, cancelled: 1 });
    held = withSaid(held, "a", null, { category: "outro", note: null });
    expect(countsNow(held).untriaged).toBe(0);
    held = withSeen(withSeen(held, "c"), "c");
    expect(held.seen).toEqual(["c"]);
  });

  // No browser runs this screen yet (it needs a signed-in firm): this reads its source, and says so.
  it("is what the source of the screen is wired to: the list it holds, started over only when asked", () => {
    const screen = fs.readFileSync(SCREEN, "utf8");
    // The rows and the counts come from what is held.
    expect(screen).toContain("const rows = found ? found.rows : list.rows;");
    expect(screen).toContain("const counts = data ? countsNow(list) : null;");
    // From the person's first answer on the list is the one held; before it, the one the server read last.
    expect(screen).toContain("const list = held ?? fresh;");
    expect(screen).toContain("setHeld((current) => apply(current ?? fresh));");
    expect(screen).not.toMatch(/data\?\.rows \?\? \[\]\);\s*\n\s*const rows/);
    // The screen starts over only for a reading the person asked for.
    expect(screen).toMatch(/if \(asked\.current\) \{\s*asked\.current = false;\s*setEpoch/);
    expect(screen).toContain("<PublicationsScreen key={listKey}");
    // What a card shows of a publication is the one word the screen holds for it.
    expect(screen).toContain("said={list.said[row.id] ?? null}");
  });

  it("takes the AI's triage a person checked off the list of what to check, once", () => {
    let held = holdList(rows, counts);
    held = withSaid(held, "a", "ciencia", { category: "ciencia", note: null }, true);
    expect(countsNow(held).review).toBe(1);
    held = withSaid(held, "a", "ciencia", { category: "prazo", note: null }, true);
    expect(countsNow(held)).toEqual({ untriaged: 80, review: 1, triaged: 12, cancelled: 3 });
  });
});
