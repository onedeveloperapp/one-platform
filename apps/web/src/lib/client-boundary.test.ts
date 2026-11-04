import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(WEB, "src");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(WEB, file).split(path.sep).join("/");
const directive = (text: string, name: string) =>
  new RegExp(`^(?:\\s|//[^\\n]*\\n|/\\*[\\s\\S]*?\\*/)*["']${name}["']`).test(text);

/** A file that surely runs on the server: a route's own file with no "use client", "server-only", or "use server". */
function onServer(file: string, text: string): boolean {
  if (directive(text, "use client")) return false;
  if (directive(text, "use server") || /import\s+["']server-only["']/.test(text)) return true;
  return (
    file.includes(`${path.sep}app${path.sep}`) &&
    /^(page|layout|template|default|not-found|route)\.tsx?$/.test(path.basename(file))
  );
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("what the server takes from a client module", () => {
  it("takes only its components and its types", () => {
    // On the server, any other value a "use client" module exports (a guard, a list, a constant) is a client
    // reference: it builds, and throws when the page is asked for (2026-11-04, the passenger module's setup).
    const found: string[] = [];
    for (const file of sources(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      if (!onServer(file, text)) continue;
      for (const match of text.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
        if (match[1]) continue;
        const braces = match[2].match(/\{([\s\S]*)\}/);
        if (!braces) continue;
        const values = braces[1]
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name && !name.startsWith("type "))
          .map((name) => name.split(/\s+as\s+/)[0].trim())
          // A component is PascalCase; a function, a guard or a constant is anything else.
          .filter((name) => !/^[A-Z][a-z0-9]\w*$/.test(name));
        if (values.length === 0) continue;
        const target = resolve(file, match[3]);
        if (target && directive(fs.readFileSync(target, "utf8"), "use client")) {
          found.push(`${relative(file)} imports ${values.join(", ")} from ${relative(target)}`);
        }
      }
    }
    expect(found).toEqual([]);
    // Every source file of the app is read: more than the default five seconds on a slow disk.
  }, 60_000);
});
