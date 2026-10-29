import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LEGACY_MODULE_IMPORTS, MODULE_DOORS } from "@/lib/modules/boundary";
import { MODULES } from "@/lib/modules/registry";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(WEB, file).split(path.sep).join("/");

/** The route groups named after a module: its routes, which may import it. */
const ROUTE_GROUPS = MODULES.modules.map((definition) => `/(${definition.key})/`);

/** Whether a file of the core may import a module: the module's own folder, its route group, a test, a door. */
const free = (file: string) =>
  file.startsWith("src/modules/") ||
  ROUTE_GROUPS.some((group) => file.includes(group)) ||
  file.endsWith(".test.ts") ||
  MODULE_DOORS.includes(file);

describe("the boundary of the modules", () => {
  it("lets no new file of the core import a module, and keeps the list of the old ones exact", () => {
    const importing = sources(path.join(WEB, "src"))
      .map(relative)
      .filter((file) => !free(file))
      .filter((file) => /from "@\/modules\//.test(fs.readFileSync(path.join(WEB, file), "utf8")))
      .sort();
    expect(importing).toEqual([...LEGACY_MODULE_IMPORTS].sort());
    // Every source file of the app is read: more than the default five seconds on a slow disk.
  }, 60_000);

  it("has every door of the core in place", () => {
    for (const door of MODULE_DOORS) expect(fs.existsSync(path.join(WEB, door))).toBe(true);
  });
});
