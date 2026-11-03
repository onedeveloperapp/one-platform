#!/usr/bin/env node
/**
 * Checks what the code says to the database against what the migrations define:
 *
 *   node scripts/check-db-refs.mjs          exits 1 when a reference does not exist
 *   node scripts/check-db-refs.mjs --list   also prints every reference it read
 *
 * The app talks to Postgres through supabase-js, where a table, a column, a
 * function and its argument names are all plain strings: TypeScript accepts a
 * name that no migration defines, and the mistake only shows up at run time, as
 * an empty screen. This script reads the migrations (tables, columns, functions
 * and their parameters) and every `.from("…")` and `.rpc("…", { … })` in the
 * source, and fails on:
 *
 *   * a table or a function that no migration defines;
 *   * an argument of `.rpc()` that is not a parameter of that function;
 *   * a column named in `.select()`, a filter, `.order()`, `.insert()`,
 *     `.update()` or `.upsert()` of a table that does not have it.
 *
 * It is a reader of text, not a SQL or TypeScript parser: it understands the
 * shapes this repository uses (literal names, literal column lists). What it
 * cannot read (a name built at run time, a select kept in a variable) it skips
 * and counts, so "0 problems" is never read as "everything was checked".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "packages", "db", "migrations");
const sourceRoots = [path.join(root, "apps", "web", "src"), path.join(root, "packages")];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "migrations", "tests", ".turbo", "coverage"]);
const list = process.argv.includes("--list");

// ---------- What the migrations define ----------

/** The text between an opening parenthesis and its match. */
function balanced(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return "";
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

const tables = new Map();
const functions = new Map();

for (const file of fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const sql = stripSqlComments(fs.readFileSync(path.join(migrationsDir, file), "utf8"));

  for (const match of sql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)\s*\(/g)) {
    const body = balanced(sql, match.index + match[0].length - 1);
    const columns = tables.get(match[1]) ?? new Set();
    for (const part of splitTopLevel(body)) {
      const line = part.trim();
      if (!line || NOT_A_COLUMN.test(line)) continue;
      const name = /^"?([a-z0-9_]+)"?\s/i.exec(`${line} `);
      if (name) columns.add(name[1]);
    }
    tables.set(match[1], columns);
  }
  // Every column an alter statement adds, however many it adds before its semicolon.
  for (const match of sql.matchAll(/alter table (?:only )?public\.([a-z0-9_]+)\s+([^;]*)/g)) {
    const columns = tables.get(match[1]) ?? new Set();
    for (const added of match[2].matchAll(/(?:^|,)\s*add column (?:if not exists )?"?([a-z0-9_]+)"?/g)) {
      columns.add(added[1]);
    }
    tables.set(match[1], columns);
  }

  for (const match of sql.matchAll(/create (?:or replace )?function public\.([a-z0-9_]+)\s*\(/g)) {
    const signature = balanced(sql, match.index + match[0].length - 1);
    const params = splitTopLevel(signature)
      .map((part) => part.trim().replace(/^(in|inout|out|variadic)\s+/i, ""))
      .map((part) => /^([a-z0-9_]+)\s/i.exec(`${part} `)?.[1])
      .filter(Boolean);
    const overloads = functions.get(match[1]) ?? [];
    overloads.push(new Set(params));
    functions.set(match[1], overloads);
  }
}

// ---------- What the code says ----------

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), found);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/** The keys written at the top level of the object literal that opens at `open`. */
function objectKeys(text, open) {
  let depth = 0;
  let end = -1;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) return null;
  const keys = [];
  let level = 0;
  let segment = "";
  const flush = () => {
    const piece = segment.trim();
    segment = "";
    if (!piece) return true;
    if (piece.startsWith("...")) return false; // A spread: the keys are not all here.
    const key = /^["']?([A-Za-z0-9_]+)["']?\s*(:|$)/.exec(piece);
    if (key) keys.push(key[1]);
    return true;
  };
  let complete = true;
  // Comments go first: a comma inside one would split a key from its line.
  const body = text
    .slice(open + 1, end)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const char of body) {
    if (char === "{" || char === "(" || char === "[") level += 1;
    if (char === "}" || char === ")" || char === "]") level -= 1;
    if (char === "," && level === 0) complete = flush() && complete;
    else segment += char;
  }
  complete = flush() && complete;
  return { keys, complete };
}

/** The plain columns of a select list: no embedded resource, no cast, no json path, no star. */
function selectColumns(selection) {
  const columns = [];
  for (const part of splitTopLevel(selection)) {
    let piece = part.trim();
    if (!piece || piece === "*" || piece.includes("(") || piece.includes("->")) continue;
    piece = piece.split("::")[0].trim(); // column::type: the cast first, so it is never read as an alias
    if (piece.includes(":")) piece = piece.split(":").pop().trim(); // alias:column
    if (/^[a-z0-9_]+$/i.test(piece)) columns.push(piece);
  }
  return columns;
}

const COLUMN_CALLS = /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|order)\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
const WRITE_CALLS = /\.(insert|update|upsert)\(\s*(\[?)\s*\{/g;

const problems = [];
const seen = [];
let skipped = 0;

for (const file of sourceRoots.flatMap((dir) => sourceFiles(dir))) {
  const text = fs.readFileSync(file, "utf8");
  const where = path.relative(root, file).split(path.sep).join("/");

  for (const match of text.matchAll(/\.rpc\(\s*(["'`])([a-z0-9_]+)\1\s*(,\s*\{)?/g)) {
    const name = match[2];
    const overloads = functions.get(name);
    if (!overloads) {
      problems.push(`${where}: function ${name}() is not defined by any migration`);
      continue;
    }
    if (!match[3]) {
      seen.push(`${where}: rpc ${name}()`);
      continue;
    }
    const args = objectKeys(text, match.index + match[0].length - 1);
    if (!args || !args.complete) {
      skipped += 1;
      continue;
    }
    seen.push(`${where}: rpc ${name}(${args.keys.join(", ")})`);
    const fits = overloads.some((params) => args.keys.every((key) => params.has(key)));
    if (!fits) {
      const unknown = args.keys.filter((key) => !overloads.some((params) => params.has(key)));
      problems.push(
        `${where}: ${name}() has no parameter ${unknown.map((key) => `"${key}"`).join(", ") || `set matching (${args.keys.join(", ")})`}`,
      );
    }
  }

  for (const match of text.matchAll(/(\.storage)?\s*\.from\(\s*(["'`])([a-z0-9_]+)\2\s*\)/g)) {
    if (match[1]) continue; // A storage bucket, not a table.
    const table = match[3];
    const columns = tables.get(table);
    if (!columns) {
      problems.push(`${where}: table ${table} is not defined by any migration`);
      continue;
    }
    // The rest of the statement: the chain this `.from()` starts. It ends at
    // the end of the statement, or where another query begins (several are
    // often started side by side inside one Promise.all).
    const rest = text.slice(match.index + match[0].length);
    const stop = rest.search(/;\s*\n|\n\s*\n|\.from\(|\.rpc\(|\bawait\b/);
    const chain = stop < 0 ? rest.slice(0, 1500) : rest.slice(0, stop);
    const named = new Set();

    for (const select of chain.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
      if (select[2].includes("${")) {
        skipped += 1;
        continue;
      }
      for (const column of selectColumns(select[2])) named.add(column);
    }
    if (/\.select\(\s*[A-Za-z_]/.test(chain)) skipped += 1; // A select kept in a variable.
    for (const call of chain.matchAll(COLUMN_CALLS)) {
      if (!call[2].includes(".")) named.add(call[2]);
    }
    for (const call of chain.matchAll(WRITE_CALLS)) {
      const written = objectKeys(chain, call.index + call[0].length - 1);
      if (!written || !written.complete) {
        skipped += 1;
        continue;
      }
      for (const key of written.keys) named.add(key);
    }

    seen.push(`${where}: ${table} (${[...named].sort().join(", ")})`);
    for (const column of named) {
      if (!columns.has(column)) problems.push(`${where}: ${table} has no column "${column}"`);
    }
  }
}

if (list) for (const line of seen.sort()) console.log(line);

const unique = [...new Set(problems)].sort();
if (unique.length > 0) {
  console.error(`${unique.length} reference(s) to the database that no migration defines:`);
  for (const problem of unique) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `database references match the migrations (${tables.size} tables, ${functions.size} functions, ${seen.length} references read, ${skipped} not readable as text)`,
);
