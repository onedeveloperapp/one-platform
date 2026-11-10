// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import ptBR from "@flyee/content/messages/pt-BR.json";

/**
 * What a page, a card or a section is goes behind the "i" beside its title, never in a paragraph read on every visit
 * (the owner, 2026-11-09): `description` of `PageHeader`, `CardTitle`, `CollapsibleCard`, `SectionTitle` and
 * `CasesProgressCard`, and the `label` of an `InfoHint`. A tooltip is read in a glance, so each of those texts holds
 * 200 characters at most; a text that needs more is cut down, or is no definition at all and goes in sight (`detail`).
 *
 * The texts are found where the code writes them: a message read by a translator bound in the same file (also a key
 * picked from an object of keys of that file, as `t(VIEW_BODY[view])`), or a literal.
 */

const HINT_MAX = 200;
const HINTED: Record<string, string> = {
  PageHeader: "description",
  CardTitle: "description",
  CollapsibleCard: "description",
  SectionTitle: "description",
  CasesProgressCard: "description",
  InfoHint: "label",
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SRC = path.join(ROOT, "apps/web/src");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) yield* sourceFiles(full);
    } else if (entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name)) {
      yield full;
    }
  }
}

const messageOf = (namespace: string, key: string): string | null => {
  let node: unknown = ptBR;
  for (const part of [...namespace.split("."), key]) {
    if (node && typeof node === "object" && part in node) node = (node as Record<string, unknown>)[part];
    else return null;
  }
  return typeof node === "string" ? node : null;
};

type Hint = { where: string; text: string };

function hintsOf(file: string): Hint[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const where = (node: ts.Node) =>
    `${path.relative(ROOT, file).replaceAll("\\", "/")}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

  // The translators of the file (`const t = useTranslations("product")`) and its objects of keys.
  const translators = new Map<string, string>();
  const keyObjects = new Map<string, string[]>();
  const stringsIn = (node: ts.Node): string[] => {
    const found: string[] = [];
    const walk = (inner: ts.Node) => {
      if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) found.push(inner.text);
      ts.forEachChild(inner, walk);
    };
    walk(node);
    return found;
  };
  const scan = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init: ts.Expression = node.initializer;
      while (ts.isAwaitExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init))
        init = init.expression;
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        ["useTranslations", "getTranslations"].includes(init.expression.text) &&
        init.arguments[0] &&
        ts.isStringLiteral(init.arguments[0])
      ) {
        translators.set(node.name.text, init.arguments[0].text);
      } else if (ts.isObjectLiteralExpression(init)) {
        keyObjects.set(node.name.text, stringsIn(init));
      }
    }
    ts.forEachChild(node, scan);
  };
  scan(source);

  const hints: Hint[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // A literal handed to a translator is a key, read below; any other is the text itself.
      const call = node.parent;
      if (!(ts.isCallExpression(call) && call.arguments[0] === node))
        hints.push({ where: where(node), text: node.text });
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && translators.has(node.expression.text)) {
      const namespace = translators.get(node.expression.text) as string;
      const first = node.arguments[0];
      const keys =
        first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
          ? [first.text]
          : first && ts.isElementAccessExpression(first) && ts.isIdentifier(first.expression)
            ? (keyObjects.get(first.expression.text) ?? [])
            : [];
      for (const key of keys) {
        const text = messageOf(namespace, key);
        if (text !== null) hints.push({ where: `${where(node)} ${key}`, text });
      }
      return;
    }
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source);
      const attribute = HINTED[name];
      if (attribute) {
        for (const property of node.attributes.properties) {
          if (ts.isJsxAttribute(property) && property.name.getText(source) === attribute && property.initializer) {
            collect(property.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hints;
}

describe('what goes behind an "i" is read in a glance', () => {
  const hints = [...sourceFiles(SRC)].flatMap(hintsOf);

  it("finds the texts it keeps (the code it reads did not move away from it)", () => {
    expect(hints.length).toBeGreaterThan(60);
  });

  it(`holds each in ${HINT_MAX} characters at most`, () => {
    const long = hints
      .filter((hint) => hint.text.length > HINT_MAX)
      .map((hint) => `${hint.where} (${hint.text.length}): ${hint.text}`);
    expect(long).toEqual([]);
  });
});
