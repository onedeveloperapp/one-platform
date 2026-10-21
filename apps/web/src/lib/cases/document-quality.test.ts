// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CLIENT_PHOTO_PROBLEM_KEY,
  isPhotoProblem,
  PHOTO_PROBLEM_KEY,
  PHOTO_PROBLEMS,
  readQuality,
} from "@/lib/cases/document-quality";
import messages from "@flyee/content/messages/pt-BR.json";
import {
  IMAGE_LIMIT_NAMES,
  IMAGE_PROBLEMS,
  IMAGE_QUALITY_RULE,
  imageLimitsOf,
  judgeImage,
} from "@flyee/documents/quality";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0024_document_checks.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The text of a function of the migration, from its name to its end. */
function sqlFunction(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
}

/** The setting the migration seeds, as the rule would be handed it. */
function seededSetting(): Record<string, unknown> {
  const start = MIGRATION.indexOf("('document_quality', jsonb_build_object(");
  expect(start).toBeGreaterThan(-1);
  const seeded = MIGRATION.slice(start, MIGRATION.indexOf("), false)", start));
  const setting: Record<string, unknown> = {};
  for (const [, key, value] of seeded.matchAll(/'([a-z_]+)', (\d+)/g)) setting[key] = Number(value);
  const kinds = /'kinds', jsonb_build_array\(([^)]+)\)/.exec(seeded)?.[1] ?? "";
  setting.kinds = [...kinds.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  return setting;
}

/** The limits by the names a setting holds them under: the rule's own list. */
const LIMIT_NAMES: string[] = Object.values(IMAGE_LIMIT_NAMES);

describe("what keeps a photo from being read, as the screens name it", () => {
  it("is the rule's own list, the same the database keeps", () => {
    expect([...PHOTO_PROBLEMS]).toEqual([...IMAGE_PROBLEMS]);
    // The words the database keeps of a problem: the list its record is checked against.
    const kept = /said\.value #>> '\{\}'\) not in \(([^)]+)\)/.exec(sqlFunction("record_document_quality"))?.[1] ?? "";
    expect([...kept.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])).toEqual([...PHOTO_PROBLEMS]);
    expect(isPhotoProblem("blurry")).toBe(true);
    expect(isPhotoProblem("ugly")).toBe(false);
    expect(isPhotoProblem(null)).toBe(false);
  });

  it("has words for the client, who takes the next photo, and for the firm, who decides", () => {
    for (const problem of PHOTO_PROBLEMS) {
      expect(product[CLIENT_PHOTO_PROBLEM_KEY[problem]], problem).toBeTruthy();
      expect(product[PHOTO_PROBLEM_KEY[problem]], problem).toBeTruthy();
      // The client is told what to do next, in a sentence; the firm what it is, in a word or two.
      expect(product[CLIENT_PHOTO_PROBLEM_KEY[problem]].length).toBeGreaterThan(
        product[PHOTO_PROBLEM_KEY[problem]].length,
      );
    }
    for (const key of [
      "client-photo-poor-title",
      "client-photo-poor-choice",
      "client-photo-retake",
      "client-photo-insist",
      "case-document-photo-poor",
      "case-document-photo-insisted",
    ]) {
      expect(product[key], key).toBeTruthy();
    }
    // What a client reads names the firm's software nowhere.
    for (const [key, words] of Object.entries(product)) {
      if (key.startsWith("client-photo-")) expect(words, key).not.toMatch(/\bONE\b/);
    }
  });

  it("tells the client of a small image what a small image is: its points, not how far the paper was", () => {
    // The rule counts the points of the file. Coming closer does not give more of them to a picture an
    // application reduced on its way: the words ask for the photo as the camera made it.
    const words = product[CLIENT_PHOTO_PROBLEM_KEY.too_small];
    expect(words).toMatch(/original/);
    expect(words).not.toMatch(/mais perto/);
    // And a paper that is what it is (its ink faded) is one the client is told they may send.
    expect(product[CLIENT_PHOTO_PROBLEM_KEY.flat]).toMatch(/desbotado/);
  });
});

describe("what a screen reads of a measure", () => {
  const limits = Object.fromEntries(LIMIT_NAMES.map((name) => [name, 1]));

  it("is what keeps the photo from being read, and whether the client sent it all the same", () => {
    expect(readQuality({ rule: IMAGE_QUALITY_RULE, problems: ["blurry", "too_dark"], insisted: true, limits })).toEqual(
      { problems: ["blurry", "too_dark"], insisted: true },
    );
    expect(readQuality({ problems: [], insisted: false, limits })).toEqual({ problems: [], insisted: false });
    // A word the rule does not know is no problem, and a photo with nothing against it was never sent "all the same".
    expect(readQuality({ problems: ["ugly", "flat", 7], insisted: true, limits })).toEqual({
      problems: ["flat"],
      insisted: true,
    });
    expect(readQuality({ problems: ["ugly"], insisted: true, limits })).toEqual({ problems: [], insisted: false });
    // Only the database's own word makes a photo one the client insisted on.
    expect(readQuality({ problems: ["flat"], insisted: "true", limits })).toEqual({
      problems: ["flat"],
      insisted: false,
    });
  });

  it("is nothing when the database kept no measure, or one that names nothing it was read against", () => {
    for (const none of [
      null,
      undefined,
      "blurry",
      ["blurry"],
      {},
      { problems: "blurry", limits },
      // What nobody judged is never shown as a photo with nothing against it.
      { problems: [] },
      { problems: ["blurry"], limits: null },
      { problems: ["blurry"], limits: [640] },
    ]) {
      expect(readQuality(none), JSON.stringify(none)).toBeNull();
    }
  });

  it("reads what the rule itself hands over, by the setting the database seeds", () => {
    const setting = seededSetting();
    const sides = { width: 1500, height: 2000, sharpness: 210 };
    const dark = judgeImage({ ...sides, shadow: 4, highlight: 60 }, setting);
    expect(readQuality(dark)).toEqual({ problems: ["too_dark"], insisted: false });
    const fine = judgeImage({ ...sides, shadow: 20, highlight: 240 }, setting);
    expect(readQuality(fine)).toEqual({ problems: [], insisted: false });
    // And what the database then keeps of it, with its own word on whether the client insisted.
    expect(readQuality({ ...dark, insisted: true, measured_at: "2099-01-01T00:00:00Z" })).toEqual({
      problems: ["too_dark"],
      insisted: true,
    });
  });
});

describe("the setting the database seeds", () => {
  it("holds every limit of the rule, so a photo of a kind it names is judged", () => {
    const setting = seededSetting();
    expect(imageLimitsOf(setting)).toEqual({
      minLongSide: 1000,
      minSharpness: 30,
      crispSharpness: 150,
      minHighlight: 90,
      maxShadow: 200,
      minRange: 40,
    });
    // The names the database rebuilds a record by, and the ones it hands the rule, are the rule's own.
    for (const name of ["document_quality_rule", "record_document_quality"]) {
      // The one list of names in the function, from the first limit to the bracket that closes it.
      const text = sqlFunction(name);
      const start = text.indexOf(`array['${LIMIT_NAMES[0]}'`);
      const listed = start < 0 ? "" : text.slice(start, text.indexOf("]", start));
      expect(
        [...listed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
        name,
      ).toEqual(LIMIT_NAMES);
    }
  });

  it("names the kinds whose photo is measured, and nothing that would refuse a photo by itself", () => {
    const setting = seededSetting();
    // Papers to be read: never a photo of what happened, which nobody takes again.
    expect(setting.kinds).toEqual(["identity", "address_proof", "ticket", "boarding_pass", "receipt"]);
    // The rule measures and a person decides: whether ONE ever refuses a photo by itself is not this setting's.
    expect(Object.keys(setting).sort()).toEqual([...LIMIT_NAMES, "kinds"].sort());
  });
});
