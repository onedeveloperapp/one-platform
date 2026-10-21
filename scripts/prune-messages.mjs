#!/usr/bin/env node
/**
 * Keeps the message catalogs honest: no key that no code renders, no key the
 * code renders that the catalog lacks.
 *
 *   node scripts/prune-messages.mjs --check   exit 1 on unused or missing keys (CI)
 *   node scripts/prune-messages.mjs --write   delete unused keys from every catalog
 *   node scripts/prune-messages.mjs --list    print the unused keys, change nothing
 *
 * pt-BR is the structural source of truth (packages/content/messages); every
 * other catalog mirrors its key set, which lib/i18n/messages.test.ts enforces.
 *
 * A key counts as USED, in any namespace, when the sources under apps/web/src
 * and packages/<pkg>/src contain:
 *   1. the key as a complete string literal ("home-title", 'home-title', `home-title`);
 *   2. a template literal that can produce it (`faq-${index}-question`,
 *      `${slug}-name`), where each interpolated part is a number or itself a
 *      string literal somewhere in the sources (`menu-${option.value}` keeps
 *      `menu-dark` only when "dark" is spelled in code) — pass --lenient to
 *      let interpolations match anything and compare the two lists;
 *   3. a string literal ending in "-" that prefixes it ("pricing-period-" + period),
 *      or starting with "-" that suffixes it;
 *   4. "namespace.key" as a literal.
 * The scan is deliberately namespace-agnostic and conservative: a word like
 * "title" used anywhere keeps "title" everywhere. A key no heuristic can see
 * (built from data, never spelled in code) goes in KEEP with the reason.
 *
 * MISSING keys come from `t(...)` calls: every key-shaped literal before the
 * first top-level comma must exist in a namespace the file binds (or in any
 * namespace when the file binds none, e.g. a helper that receives `t`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES_DIR = path.join(root, "packages/content/messages");
const REFERENCE_LOCALE = "pt-BR";
const SOURCE_ROOTS = [path.join(root, "apps/web/src"), path.join(root, "packages")];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", "messages"]);
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;

/** Keys rendered from data, so no source file spells them. Reason required. */
const KEEP = {
  // (none yet)
};

const KEY_SHAPE = /^[a-z0-9][a-z0-9-]*$/;
const KEY_CHARS = "[A-Za-z0-9_.-]+";

const lenient = process.argv.includes("--lenient");
const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--list") ? "list" : "check";

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a template literal body into its static parts. */
function templateParts(body) {
  const parts = [];
  let current = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "\\") {
      current += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (body[i] === "$" && body[i + 1] === "{") {
      parts.push(current);
      current = "";
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        if (body[i] === "{") depth += 1;
        else if (body[i] === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    current += body[i];
    i += 1;
  }
  parts.push(current);
  return parts;
}

const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

const literals = new Set();
const patterns = [];
const prefixes = new Set();
const suffixes = new Set();
const calls = []; // { file, key, namespaces }
const boundNamespaces = new Set();

const files = SOURCE_ROOTS.flatMap((dir) => walk(dir, []));
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");

  for (const match of source.matchAll(STRING_LITERAL)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) {
      literals.add(value);
      if (value.length >= 3 && value.endsWith("-") && KEY_SHAPE.test(value.slice(0, -1))) prefixes.add(value);
      if (value.length >= 3 && value.startsWith("-") && KEY_SHAPE.test(value.slice(1))) suffixes.add(value);
      continue;
    }
    const body = match[3];
    if (!body.includes("${")) {
      literals.add(body);
      continue;
    }
    const parts = templateParts(body);
    const staticText = parts.join("");
    // A template with no meaningful static text (`${a}${b}`) would match every
    // key; it says nothing about which keys are used.
    if (staticText.replace(/[^a-z]/g, "").length < 2) continue;
    if (!/^[A-Za-z0-9_.-]*$/.test(staticText)) continue;
    const escaped = parts.map(escapeRegExp);
    patterns.push({
      greedy: new RegExp(`^${escaped.join(`(${KEY_CHARS})`)}$`),
      lazy: new RegExp(`^${escaped.join(`(${KEY_CHARS}?)`)}$`),
    });
  }

  const bound = [...source.matchAll(/(?:useTranslations|getTranslations)\(\s*["']([A-Za-z]+)["']/g)].map((m) => m[1]);
  for (const namespace of bound) boundNamespaces.add(namespace);
  for (const call of source.matchAll(/(?<![\w.])t\(\s*/g)) {
    // The first argument: everything up to the first top-level comma or the
    // closing parenthesis, so `t(cond ? "a" : "b", { n })` yields a and b.
    let i = call.index + call[0].length;
    let depth = 0;
    let quote = null;
    let arg = "";
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        arg += ch;
        if (ch === "\\") {
          arg += source[i + 1] ?? "";
          i += 1;
        } else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        arg += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth -= 1;
      }
      if (ch === "," && depth === 0) break;
      arg += ch;
    }
    for (const lit of arg.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
      const key = lit[1] ?? lit[2];
      if (KEY_SHAPE.test(key)) calls.push({ file, key, namespaces: bound });
    }
  }
}

function loadCatalogs() {
  const catalogs = {};
  for (const name of fs.readdirSync(MESSAGES_DIR)) {
    if (!name.endsWith(".json")) continue;
    catalogs[name.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, name), "utf8"));
  }
  return catalogs;
}

const catalogs = loadCatalogs();
const reference = catalogs[REFERENCE_LOCALE];
if (!reference) {
  console.error(`missing reference catalog ${REFERENCE_LOCALE}.json`);
  process.exit(1);
}

function isUsed(namespace, key) {
  // A namespace no file binds is dead as a whole (the removed mobile app's).
  if (!boundNamespaces.has(namespace)) return false;
  if (KEEP[`${namespace}.${key}`] || KEEP[key]) return true;
  if (literals.has(key) || literals.has(`${namespace}.${key}`)) return true;
  for (const prefix of prefixes) if (key.startsWith(prefix) && key.length > prefix.length) return true;
  for (const suffix of suffixes) if (key.endsWith(suffix) && key.length > suffix.length) return true;
  return patterns.some(({ greedy, lazy }) =>
    [greedy, lazy].some((pattern) => {
      const match = pattern.exec(key);
      if (!match) return false;
      if (lenient) return true;
      return match.slice(1).every((part) => /^[0-9]+$/.test(part) || literals.has(part));
    }),
  );
}

const unused = [];
for (const [namespace, entries] of Object.entries(reference)) {
  for (const key of Object.keys(entries)) {
    if (!isUsed(namespace, key)) unused.push(`${namespace}.${key}`);
  }
}

const missing = [];
for (const { file, key, namespaces } of calls) {
  const scope = namespaces.length > 0 ? namespaces : Object.keys(reference);
  if (!scope.some((namespace) => reference[namespace] && key in reference[namespace])) {
    missing.push(`${path.relative(root, file).split(path.sep).join("/")}: ${scope.join("|")}.${key}`);
  }
}
const uniqueMissing = [...new Set(missing)].sort();

const perNamespace = {};
for (const entry of unused) {
  const namespace = entry.split(".")[0];
  perNamespace[namespace] = (perNamespace[namespace] ?? 0) + 1;
}
const summary = Object.entries(reference)
  .map(([namespace, entries]) => {
    const total = Object.keys(entries).length;
    return `${namespace} ${total - (perNamespace[namespace] ?? 0)}/${total}`;
  })
  .join(", ");

if (mode === "list") {
  for (const entry of unused) console.log(entry);
  console.error(`\n${unused.length} unused (${summary} kept)`);
  if (uniqueMissing.length) console.error(`${uniqueMissing.length} missing:\n  ${uniqueMissing.join("\n  ")}`);
  process.exit(0);
}

if (mode === "write") {
  const drop = new Set(unused);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const namespace of Object.keys(catalog)) {
      if (!(namespace in reference)) {
        delete catalog[namespace];
        continue;
      }
      for (const key of Object.keys(catalog[namespace])) {
        if (drop.has(`${namespace}.${key}`) || !(key in reference[namespace])) delete catalog[namespace][key];
      }
      if (Object.keys(catalog[namespace]).length === 0) delete catalog[namespace];
    }
    fs.writeFileSync(path.join(MESSAGES_DIR, `${locale}.json`), `${JSON.stringify(catalog, null, 2)}\n`);
  }
  console.log(`removed ${unused.length} unused keys (${summary} kept)`);
  if (uniqueMissing.length) {
    console.error(`${uniqueMissing.length} missing keys:\n  ${uniqueMissing.join("\n  ")}`);
    process.exit(1);
  }
  process.exit(0);
}

if (unused.length || uniqueMissing.length) {
  if (unused.length) {
    console.error(`${unused.length} unused message keys (run: node scripts/prune-messages.mjs --write):`);
    for (const entry of unused.slice(0, 40)) console.error(`  ${entry}`);
    if (unused.length > 40) console.error(`  ... and ${unused.length - 40} more (--list shows all)`);
  }
  if (uniqueMissing.length) console.error(`${uniqueMissing.length} missing message keys:\n  ${uniqueMissing.join("\n  ")}`);
  process.exit(1);
}
console.log(`message catalogs clean (${summary})`);
