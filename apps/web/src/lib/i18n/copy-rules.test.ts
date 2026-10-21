// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import ptBR from "@flyee/content/messages/pt-BR.json";

/**
 * The copy rules (CLAUDE.md, "Engineering rules"): no dash (— or –), no
 * exclamation mark and no emoji in a text a person reads, and none of the
 * banned words. They hold for everything the platform writes to visitors and
 * to the people of a firm. The operator console is out (hardcoded Portuguese,
 * one reader), and so are code comments. The texts the migrations seed (the
 * legal texts in force among them) are checked by pgTAP 0033_copy_rules.
 *
 * Two depths:
 *  - the copy sources (the message catalog, the e-mails, the bell) hold only
 *    text for people, so every rule applies to every string in them;
 *  - the rest of the shipped code holds a sentence only by exception (a
 *    separator, a fallback, an alt text), beside class names that end in "!"
 *    and message keys such as "module-unlock", so there the dash and the emoji
 *    apply to every string, and the exclamation mark and the words to JSX text.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const fromRoot = (...segments: string[]) => path.join(ROOT, ...segments);

type Rule = { name: string; test: (text: string) => boolean };

const DASH: Rule = { name: "dash", test: (text) => /[–—]/u.test(text) };
// The brief keeps © and → on purpose; neither reads as an emoji.
const EMOJI: Rule = { name: "emoji", test: (text) => /(?![©→])\p{Extended_Pictographic}/u.test(text) };
const EXCLAMATION: Rule = { name: "exclamation mark", test: (text) => text.includes("!") };
const WORDS: Rule = {
  name: "banned word",
  test: (text) =>
    /(?<![\p{L}\p{N}])(?:desbloque|potencializ|sem esforço|soluç(?:ão|ões) inovadora|unlock|elevat|empower|seamless|robust|supercharg|game-changing|it['’]s not just)/iu.test(
      text,
    ),
};
const ALL_RULES = [DASH, EXCLAMATION, EMOJI, WORDS];

const breaksOf = (text: string, rules: Rule[]) => rules.filter((rule) => rule.test(text)).map((rule) => rule.name);

/** Every string value of a catalog, with its key path. */
function* catalogStrings(node: unknown, trail: string[] = []): Generator<[string, string]> {
  if (typeof node === "string") {
    yield [trail.join("."), node];
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) yield* catalogStrings(value, [...trail, key]);
  }
}

type Literal = { line: number; text: string; jsx: boolean };

/** The text a file can show: string literals, template parts and JSX text, never comments. */
function literalsOf(file: string): Literal[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Literal[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({ line: lineOf(node), text: node.text, jsx: false });
    } else if (ts.isJsxText(node) && node.text.trim()) {
      found.push({ line: lineOf(node), text: node.text, jsx: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const COPY_SOURCES = [
  "packages/email/src/copy/pt-BR.ts",
  "apps/web/src/lib/messages/bell-copy.ts",
  "apps/web/src/lib/messages/whatsapp-copy.ts",
].map((file) => fromRoot(file));

const SHIPPED_CODE = ["apps/web/src", "packages/email/src", "packages/billing/src", "packages/content/src"];
const NOT_SHIPPED_TO_PEOPLE = [
  /\.test\.tsx?$/,
  /\.d\.ts$/,
  /[\\/]app[\\/]\(dashboard\)[\\/]admin[\\/]/,
  /[\\/]app[\\/]api[\\/]admin[\\/]/,
  /[\\/]lib[\\/]admin[\\/]/,
  /[\\/]icons[\\/]/,
];

function* codeFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) yield* codeFiles(full);
    } else if (/\.tsx?$/.test(entry.name) && !NOT_SHIPPED_TO_PEOPLE.some((pattern) => pattern.test(full))) {
      yield full;
    }
  }
}

const where = (file: string, line: number) => `${path.relative(ROOT, file).replaceAll("\\", "/")}:${line}`;

describe("copy rules: no dash, exclamation mark, emoji or banned word in what people read", () => {
  it("knows each mark it promises to catch, and lets © and → through", () => {
    expect(breaksOf("Pronto — feito", ALL_RULES)).toEqual(["dash"]);
    expect(breaksOf("10–12 de outubro", ALL_RULES)).toEqual(["dash"]);
    expect(breaksOf("E-mail enviado!", ALL_RULES)).toEqual(["exclamation mark"]);
    expect(breaksOf("Lançamos 🚀", ALL_RULES)).toEqual(["emoji"]);
    expect(breaksOf("Feito ✅", ALL_RULES)).toEqual(["emoji"]);
    expect(breaksOf("Desbloqueie seu acesso", ALL_RULES)).toEqual(["banned word"]);
    expect(breaksOf("Potencialize seu negócio sem esforço", ALL_RULES)).toEqual(["banned word"]);
    expect(breaksOf("ONE unlocks every case", ALL_RULES)).toEqual(["banned word"]);
    expect(breaksOf("It’s not just a tool", ALL_RULES)).toEqual(["banned word"]);
    expect(breaksOf("© 2026 ONE · Falar com a gente →", ALL_RULES)).toEqual([]);
    expect(breaksOf("O advogado revisa e protocola com o próprio login.", ALL_RULES)).toEqual([]);
  });

  it("the message catalog holds none", () => {
    const found: string[] = [];
    for (const [locale, catalog] of Object.entries({ "pt-BR": ptBR })) {
      for (const [key, text] of catalogStrings(catalog)) {
        for (const rule of breaksOf(text, ALL_RULES)) found.push(`${locale} ${key} (${rule}): ${text}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("neither do the e-mails or the bell", () => {
    const found: string[] = [];
    for (const file of COPY_SOURCES) {
      for (const literal of literalsOf(file)) {
        for (const rule of breaksOf(literal.text, ALL_RULES)) {
          found.push(`${where(file, literal.line)} (${rule}): ${literal.text.trim()}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("and the rest of the shipped code adds none, the operator console and comments aside", { timeout: 60_000 }, () => {
    const found: string[] = [];
    let files = 0;
    for (const dir of SHIPPED_CODE) {
      for (const file of codeFiles(fromRoot(dir))) {
        files += 1;
        for (const literal of literalsOf(file)) {
          const rules = literal.jsx ? ALL_RULES : [DASH, EMOJI];
          for (const rule of breaksOf(literal.text, rules)) {
            found.push(`${where(file, literal.line)} (${rule}): ${literal.text.trim()}`);
          }
        }
      }
    }
    // A walk that found nothing to read would pass for the wrong reason.
    expect(files).toBeGreaterThan(150);
    expect(found).toEqual([]);
  });
});
