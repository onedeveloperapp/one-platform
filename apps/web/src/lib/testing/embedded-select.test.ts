// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSelect } from "@/lib/testing/embedded-select";

const SRC = path.resolve(__dirname, "../..");
const FOLDERS = ["app", "components", "lib", "modules"];

/** Every file of the app that may read the database, tests of the stand-in itself left out. */
function sources(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The select lists the app writes as plain strings, a list broken over lines included. */
function selectsOf(text: string): string[] {
  return [...text.matchAll(/\.select\(\s*(["'`])([^"'`]*?)\1/g)]
    .map((match) => match[2])
    .filter((list) => !list.includes("$"));
}

describe("the stand-in's reading of a select", () => {
  it("reads a column as PostgREST does: by its alias, its JSON path and its cast", () => {
    expect(parseSelect("id, created_at::text, who:person_id, proposal:output->>cronologia, data->name")).toEqual([
      { kind: "column", name: "id", key: "id", arrow: null, field: null, cast: null },
      { kind: "column", name: "created_at", key: "created_at", arrow: null, field: null, cast: "text" },
      { kind: "column", name: "person_id", key: "who", arrow: null, field: null, cast: null },
      { kind: "column", name: "output", key: "proposal", arrow: "->>", field: "cronologia", cast: null },
      { kind: "column", name: "data", key: "name", arrow: "->", field: "name", cast: null },
    ]);
  });

  it("reads an embedded resource with its columns cast", () => {
    expect(parseSelect("id, people!inner(full_name, birth_date::text)")).toEqual([
      { kind: "column", name: "id", key: "id", arrow: null, field: null, cast: null },
      {
        kind: "embed",
        relation: "people",
        key: "people",
        hint: null,
        inner: true,
        children: [
          { kind: "column", name: "full_name", key: "full_name", arrow: null, field: null, cast: null },
          { kind: "column", name: "birth_date", key: "birth_date", arrow: null, field: null, cast: "text" },
        ],
      },
    ]);
  });

  it("refuses what it does not read, instead of reading something else", () => {
    for (const list of ["id; drop table x", "a::b::c", "a->", "A"]) expect(() => parseSelect(list), list).toThrow();
  });

  // A worker takes a read that failed as a failed look and goes on, so a list the stand-in cannot read shows up far
  // from here, as a round trip with nothing done. Every list the app writes is tried here, with no database.
  it("reads every select the app writes", () => {
    const refused: string[] = [];
    let read = 0;
    for (const file of FOLDERS.flatMap((folder) => sources(path.join(SRC, folder)))) {
      for (const list of selectsOf(fs.readFileSync(file, "utf8"))) {
        read += 1;
        try {
          parseSelect(list);
        } catch (error) {
          refused.push(`${path.relative(SRC, file)}: ${(error as Error).message}`);
        }
      }
    }
    expect(refused).toEqual([]);
    // The walk really read the app (a pattern that stopped matching would pass with nothing read).
    expect(read).toBeGreaterThan(200);
  });
});
