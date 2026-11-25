import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The cards of the case tell the screen they wrote something with `onChanged()`: the screen then says "Alteração
// salva" in the card, at once (the audit of the case's sync, 2026-11-25). So a card that reads the case again after a
// result that may have failed must say whether it saved, `onChanged(result.ok)` or `onChanged(false)`: a bare call
// there would say "saved" over a refusal.

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bare `onChanged()` calls that follow a test of a failed result with no way out before them. */
function unsaid(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (!/\bonChanged\(\)/.test(line)) return;
    const text = line.trim();
    if (text.startsWith("else ") || /if \((\w+\.)?ok\)/.test(text)) return;
    const before = lines.slice(Math.max(0, index - 3), index);
    // Inside a callback named for a success (`onSaved`, `onDone`...), or under a guard that already left on failure.
    if (before.some((prior) => /\bon(Saved|Done|Asked|Said|Seen|Acknowledged|Decided|Written)\b/.test(prior))) return;
    const failing = before.findIndex((prior) => /if \(!(\w+\.)?ok\)/.test(prior));
    if (failing < 0) return;
    const after = before.slice(failing);
    // The failure left the function (a `return` on its line or in its block): what follows runs on success alone.
    if (after.some((prior) => /\breturn\b/.test(prior))) return;
    found.push(index + 1);
  });
  return found;
}

describe("a card that reads the case again says whether it saved", () => {
  it("finds a bare call after a result that may have failed", () => {
    expect(
      unsaid(["const result = await save();", "if (!result.ok) setProblem(result.code);", "onChanged();"].join("\n")),
    ).toEqual([3]);
    expect(unsaid(["if (!result.ok) setProblem(result.code);", "onChanged(result.ok);"].join("\n"))).toEqual([]);
    expect(unsaid(["if (!result.ok) return fail(result.code);", "onChanged();"].join("\n"))).toEqual([]);
    expect(unsaid(["if (!result.ok) setProblem(result.code);", "else onChanged();"].join("\n"))).toEqual([]);
  });

  it("has none in the cards of the case", () => {
    const offenders = readdirSync(here)
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
      .flatMap((file) => unsaid(readFileSync(path.join(here, file), "utf8")).map((line) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });
});
