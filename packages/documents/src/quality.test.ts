import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  IMAGE_LIMIT_NAMES,
  IMAGE_PROBLEMS,
  IMAGE_QUALITY_RULE,
  type ImageLimits,
  type ImageMeasure,
  imageLimitsOf,
  imageProblems,
  judgeImage,
  measureImage,
} from "./quality.ts";
import {
  barcode,
  block,
  grainy,
  jpeg,
  lit,
  numbers,
  onTable,
  page,
  plain,
  rules,
  screen,
  shaken,
  shakenAslant,
  tableTop,
  unfocused,
  wovenCloth,
} from "./quality.fixtures.ts";

/** The limits the tests read a measure against: the ones the setting starts with (migration 0024). */
const LIMITS: ImageLimits = {
  minLongSide: 1000,
  minSharpness: 30,
  crispSharpness: 150,
  minHighlight: 90,
  maxShadow: 200,
  minRange: 40,
};
const SETTING = {
  min_long_side: 1000,
  min_sharpness: 30,
  crisp_sharpness: 150,
  min_highlight: 90,
  max_shadow: 200,
  min_range: 40,
};

const W = 1500;
const H = 2000;
const FADED = { ink: "#828282", paper: "#d2d2d2" };
const FEW = { width: 1170, height: 2532, filled: 0.12, line: 44 };
const DARK_THEME = { ink: "#f2f2f2", paper: "#101010" };
const DARK_TABLE = "#2a2520";
const LIGHT_TABLE = "#d9d4cc";

async function measureOf(bytes: Uint8Array): Promise<ImageMeasure> {
  const measure = await measureImage(bytes);
  assert.ok(measure, "the photo was measured");
  return measure;
}

const sharpnessOf = async (bytes: Uint8Array): Promise<number> => (await measureOf(bytes)).sharpness;

const problemsOf = async (bytes: Uint8Array): Promise<string[]> => imageProblems(await measureOf(bytes), LIMITS);

/** A measure as good as a photo's can be, with what a case changes of it. */
const measured = (changes: Partial<ImageMeasure>): ImageMeasure => ({
  width: 1500,
  height: 2000,
  sharpness: 230,
  shadow: 20,
  highlight: 250,
  ...changes,
});

test("a photo of a page that can be read has nothing against it, upright or lying down, from any camera", async () => {
  const photo = await page({ width: W, height: H });
  const measure = await measureOf(photo);
  assert.deepEqual([measure.width, measure.height], [W, H]);
  assert.ok(measure.sharpness > 150, `sharpness ${measure.sharpness}`);
  assert.ok(measure.shadow < 60 && measure.highlight > 240, `light ${measure.shadow} to ${measure.highlight}`);
  assert.deepEqual(imageProblems(measure, LIMITS), []);

  // A phone held on its side stores the photo lying down and says how it was held: measured upright.
  const turned = await measureOf(await jpeg(sharp(photo).withMetadata({ orientation: 6 })));
  assert.deepEqual([turned.width, turned.height], [H, W]);
  assert.deepEqual(imageProblems(turned, LIMITS), []);

  // The same page from a camera with four times the points measures about the same: a measure is of the
  // page, not of the camera.
  const larger = await sharpnessOf(await page({ width: 3000, height: 4000 }));
  assert.ok(Math.abs(larger - measure.sharpness) < measure.sharpness * 0.15, `12 MP: ${larger}`);
});

test("how sharp a photo is does not depend on how much is written, on how dark the ink is, nor on the light", async () => {
  const full = await sharpnessOf(await page({ width: W, height: H }));
  const sparse = await page({ width: W, height: H, filled: 0.2 });
  const same: [string, Uint8Array][] = [
    ["a fifth of its lines", sparse],
    ["two lines", await page({ width: W, height: H, filled: 0.04, seed: 3 })],
    ["a faded receipt with few lines", await page({ width: W, height: H, filled: 0.2, ...FADED })],
    ["a full faded receipt", await page({ width: W, height: H, ...FADED })],
    ["in dim light", await lit(sparse, 0.5, 0)],
    ["in the dark", await lit(sparse, 0.25, 0)],
    ["burnt by a flash", await lit(sparse, 0.15, 215)],
    ["a screen with little text", await screen(FEW)],
    ["a screen with little text in grey", await screen({ ...FEW, ink: "#707070" })],
    ["a screen in a dark theme", await screen({ ...FEW, ...DARK_THEME })],
    ["stored with little quality", await sharp(sparse).jpeg({ quality: 20 }).toBuffer()],
  ];
  for (const [name, photo] of same) {
    const sharpness = await sharpnessOf(photo);
    assert.ok(Math.abs(sharpness - full) < full * 0.15, `${name}: ${sharpness} beside ${full}`);
  }
  // So what has little on it, or is faint, is read as what it is: nothing is said of it.
  assert.deepEqual(await problemsOf(sparse), []);
  assert.deepEqual(await problemsOf(await page({ width: W, height: H, filled: 0.04, seed: 3 })), []);
  // A slip of one line: a handful of edges, and still edges.
  assert.deepEqual(await problemsOf(await page({ width: W, height: H, filled: 0.02, seed: 5 })), []);
  assert.deepEqual(await problemsOf(await page({ width: W, height: H, filled: 0.2, ...FADED })), []);
  assert.deepEqual(await problemsOf(await screen(FEW)), []);
  assert.deepEqual(await problemsOf(await screen({ ...FEW, filled: 0.5 })), []);
  assert.deepEqual(await problemsOf(await screen({ ...FEW, ink: "#707070" })), []);
  // Light letters on a dark ground: something in it is light, so it is read. With two lines on it too.
  assert.deepEqual(await problemsOf(await screen({ ...FEW, ...DARK_THEME })), []);
  assert.deepEqual(await problemsOf(await screen({ ...FEW, ...DARK_THEME, filled: 0.5 })), []);
  assert.deepEqual(await problemsOf(await screen({ ...FEW, ...DARK_THEME, filled: 0.04, seed: 3 })), []);
});

test("a photo out of focus is blurry, whatever is on the page, and one only a little soft is not", async () => {
  const full = await page({ width: W, height: H });
  assert.deepEqual(await problemsOf(await unfocused(full, 1.2)), []);
  assert.deepEqual(await problemsOf(await unfocused(full, 2.5)), []);
  assert.deepEqual(await problemsOf(await unfocused(full, 5)), ["blurry"]);
  assert.deepEqual(await problemsOf(await unfocused(full, 6)), ["blurry"]);
  assert.deepEqual(await problemsOf(await unfocused(full, 9)), ["blurry"]);
  // The sharper, the higher the measure: the limit is a point on one scale.
  const scale = [0, 1.2, 2.5, 4, 6];
  const sharpness: number[] = [];
  for (const sigma of scale) sharpness.push(await sharpnessOf(sigma === 0 ? full : await unfocused(full, sigma)));
  for (let index = 1; index < scale.length; index += 1) {
    assert.ok(sharpness[index] < sharpness[index - 1] * 0.75, `sigma ${scale[index]}: ${sharpness.join(", ")}`);
  }
  // The scale is the page's: twice the blur on a photo with twice the points a side is the same blur.
  const large = await page({ width: 3000, height: 4000 });
  assert.deepEqual(await problemsOf(await unfocused(large, 5)), []);
  assert.deepEqual(await problemsOf(await unfocused(large, 12)), ["blurry"]);
  // And the same blur is told the same of a page with little on it, of fine print and of a faded receipt.
  const others: [string, Uint8Array][] = [
    ["a fifth of its lines", await page({ width: W, height: H, filled: 0.2 })],
    ["fine print", await page({ width: W, height: H, line: 16 })],
    ["a faded receipt", await page({ width: W, height: H, filled: 0.2, ...FADED })],
  ];
  for (const [name, photo] of others) {
    assert.deepEqual(await problemsOf(await unfocused(photo, 2.5)), [], name);
    const soft = await problemsOf(await unfocused(photo, 5));
    assert.ok(soft.includes("blurry"), `${name}: ${soft.join(", ") || "nothing"}`);
  }
});

test("where grain, a weave or a blur is all over the picture, the whole of it is read", async () => {
  // A cloth so coarse that a faded receipt on it has no edge steeper than the weave's: the weave is in focus,
  // as steep as edges are, and nothing is said.
  const cloth = await tableTop(W, H, "#8a8a8a", { spread: 40 });
  const hidden = await measureOf(await onTable(await page({ width: W, height: H, filled: 0.2, ...FADED }), cloth, 0.5));
  assert.ok(hidden.sharpness > 150, `sharpness ${hidden.sharpness}`);
  assert.deepEqual(imageProblems(hidden, LIMITS), []);
  // A picture that is edges all over (a barcode from side to side), and one that is grain alone (nothing in
  // it but its light, which is flat).
  const bars = await measureOf(await page({ width: W, height: H, filled: 0, marks: barcode(0, 0, W, H) }));
  assert.ok(bars.sharpness > 150, `sharpness ${bars.sharpness}`);
  assert.deepEqual(imageProblems(bars, LIMITS), []);
  const noise = await measureOf(await grainy(await plain(W, H, "#909090"), 12));
  assert.ok(noise.sharpness > 150, `sharpness ${noise.sharpness}`);
  assert.deepEqual(imageProblems(noise, LIMITS), ["flat"]);
  // A page of print far out of focus is a blur all over: smooth, and blurry however far out it is. Dense
  // print, fine or not, from the blur that still leaves edges standing to the one that leaves a grey sheet.
  for (const line of [12, 16, 33]) {
    const print = await page({ width: W, height: H, line });
    for (const sigma of [5, 7, 9, 12, 16, 24]) {
      const said = await problemsOf(await unfocused(print, sigma));
      assert.ok(said.includes("blurry"), `a line of ${line}, sigma ${sigma}: ${said.join(", ") || "nothing"}`);
    }
  }
});

test("what a paper lies on does not answer for the paper: a table, wood, a woven cloth", async () => {
  const receipt = await page({ width: W, height: H, filled: 0.2, ...FADED });
  const print = await page({ width: W, height: H, line: 16 });
  const grounds: [string, string | Uint8Array][] = [
    ["a dark table", DARK_TABLE],
    ["a light table", LIGHT_TABLE],
    ["wood", await tableTop(W, H, "#7a6a55", { spread: 22, smooth: 1.2 })],
    ["a cloth of a fine weave", await wovenCloth(W, H, 150, { period: 8, depth: 25 })],
    ["a cloth of a wide weave", await wovenCloth(W, H, 150, { period: 20, depth: 30 })],
  ];
  for (const [name, ground] of grounds) {
    // In focus, a faded receipt and a page of fine print are as sharp on it as anywhere.
    for (const [paper, photo] of [
      ["a faded receipt", await onTable(receipt, ground, 0.5)],
      ["fine print", await onTable(print, ground, 0.4)],
    ] as const) {
      const measure = await measureOf(photo);
      assert.ok(measure.sharpness > 150, `${paper} on ${name}: ${measure.sharpness}`);
      assert.deepEqual(imageProblems(measure, LIMITS), [], `${paper} on ${name}`);
    }
    // Out of focus, the whole frame is: the paper and what it lies on.
    const soft = await problemsOf(await unfocused(await onTable(receipt, ground, 0.5), 5));
    assert.ok(soft.includes("blurry"), `out of focus on ${name}: ${soft.join(", ") || "nothing"}`);
  }
});

test("a paper in focus on a cloth with a smooth, strong pattern is read by what bends in it", async () => {
  // The soft waves of such a cloth slope more than the thin strokes of a small receipt and bend far less: by
  // its slopes nothing stands out of the picture, and by its bends the receipt does. A phone of 12 MP held
  // over a receipt a third of the frame wide, in faded ink and in dark.
  const cloths: [string, Uint8Array][] = [
    ["waves 56 apart on a light cloth", await wovenCloth(3000, 4000, 200, { period: 56, depth: 50 })],
    ["waves 72 apart", await wovenCloth(3000, 4000, 190, { period: 72, depth: 60 })],
    ["waves 48 apart on a mid cloth", await wovenCloth(3000, 4000, 150, { period: 48, depth: 60 })],
  ];
  for (const [name, cloth] of cloths) {
    // The cloth by itself has nothing in focus to be told by: its waves are soft, and it reads so.
    assert.ok((await sharpnessOf(cloth)) < LIMITS.minSharpness, `${name} alone`);
    for (const ink of [FADED, {}]) {
      const receipt = await onTable(await page({ width: 3000, height: 4000, filled: 0.2, ...ink }), cloth, 0.3);
      const measure = await measureOf(receipt);
      const which = `${"ink" in ink ? "faded" : "dark"} ink on ${name}`;
      assert.ok(measure.sharpness > 150, `${which}: ${measure.sharpness}`);
      assert.deepEqual(imageProblems(measure, LIMITS), [], which);
      // Out of focus, nothing in it bends: the whole frame is smooth, and blurry.
      const soft = await problemsOf(await unfocused(receipt, 12));
      assert.ok(soft.includes("blurry"), `${which}, out of focus: ${soft.join(", ") || "nothing"}`);
    }
  }
});

test("the grain of a photo taken in poor light is not read as edges", async () => {
  const full = await page({ width: W, height: H });
  // A sharp page stays sharp under grain, and measures about what it did.
  const clean = await sharpnessOf(full);
  for (const spread of [3, 12]) {
    const measure = await measureOf(await grainy(full, spread));
    assert.deepEqual(imageProblems(measure, LIMITS), []);
    assert.ok(Math.abs(measure.sharpness - clean) < clean * 0.1, `grain ${spread}: ${measure.sharpness}`);
  }
  assert.deepEqual(await problemsOf(await grainy(await page({ width: W, height: H, filled: 0.2, ...FADED }), 12)), []);
  // A page out of focus stays blurry under grain: grain is everywhere, edges are not.
  const soft = await unfocused(full, 6);
  for (const spread of [3, 6]) {
    assert.deepEqual(await problemsOf(await grainy(soft, spread)), ["blurry"], `grain ${spread}`);
  }
});

test("the pictures are drawn from numbers that do not come round", () => {
  // Fifty thousand draws, all but a few of them different: a source that came round would draw stripes of grain.
  const drawn = Array.from({ length: 50_000 }, numbers(11));
  assert.ok(new Set(drawn).size > drawn.length * 0.999, `${new Set(drawn).size} different numbers in ${drawn.length}`);
  assert.ok(drawn.every((value) => value >= 0 && value < 1));
});

test("the light of a photo is its ink's and its paper's, however little of the frame they take", async () => {
  // A till receipt photographed from above with a phone of 12 MP: a third of the frame's width, its strokes
  // thinner than a point of the copy the rule measures on. Dark ink or faded, on a light table, a dark one, wood.
  const wood = await tableTop(3000, 4000, "#9a7b5a", { spread: 22, smooth: 1.2 });
  for (const ink of [{}, FADED]) {
    const receipt = await page({ width: 3000, height: 4000, filled: 0.2, ...ink });
    for (const table of [LIGHT_TABLE, DARK_TABLE, wood]) {
      const measure = await measureOf(await onTable(receipt, table, 0.3));
      const name = `${"ink" in ink ? "faded" : "dark"} ink on ${typeof table === "string" ? table : "wood"}`;
      assert.deepEqual(imageProblems(measure, LIMITS), [], name);
      // Its ink is read as ink: the dark side of its edges is far from the light one.
      assert.ok(measure.highlight - measure.shadow > LIMITS.minRange * 1.5, `${name}: ${measure.shadow} to ${measure.highlight}`);
    }
  }
  // The same receipt a little soft has greyed its thin strokes: it is not called burnt or flat for that. And
  // out of focus it is told what is wrong with it, which is its focus and not its light.
  for (const ink of [{}, FADED]) {
    const receipt = await onTable(await page({ width: 3000, height: 4000, filled: 0.2, ...ink }), LIGHT_TABLE, 0.3);
    const soft = await measureOf(await unfocused(receipt, 4));
    assert.ok(soft.sharpness >= LIMITS.minSharpness && soft.sharpness < LIMITS.crispSharpness, `sharpness ${soft.sharpness}`);
    assert.deepEqual(imageProblems(soft, LIMITS), []);
  }
  const dark = await onTable(await page({ width: 3000, height: 4000, filled: 0.2 }), LIGHT_TABLE, 0.3);
  assert.deepEqual(await problemsOf(await unfocused(dark, 12)), ["blurry"]);
});

test("a page photographed in the dark is too dark, and one in dim light is not", async () => {
  const photo = await page({ width: W, height: H });
  assert.deepEqual(await problemsOf(await lit(photo, 0.25, 0)), ["too_dark"]);
  assert.deepEqual(await problemsOf(await lit(photo, 0.5, 0)), []);
});

test("a photo burnt by a flash is too bright, a blank page too, and a fogged one is flat", async () => {
  const photo = await page({ width: W, height: H });
  assert.deepEqual(await problemsOf(await lit(photo, 0.15, 215)), ["too_bright"]);
  // A blank page has no edge at all: nothing in it is dark, and nothing in it is sharp.
  const blank = await measureOf(await plain(1200, 1600, "#fbfbfb"));
  assert.equal(blank.sharpness, 0);
  assert.deepEqual(imageProblems(blank, LIMITS), ["blurry", "too_bright"]);
  assert.deepEqual(await problemsOf(await lit(photo, 0.1, 125)), ["flat"]);
  // A frame with nothing in it but a little grain is as blank.
  assert.deepEqual(await problemsOf(await grainy(await plain(W, H, "#909090"), 3)), ["blurry", "flat"]);
});

test("a paper whose ink faded is read while its letters stand out of it, and is flat once they all but do not", async () => {
  // A receipt as it is, faded and faded further: nothing to say of it, and it is as sharp as any.
  for (const ink of [FADED, { ink: "#a0a0a0", paper: "#cdcdcd" }]) {
    const measure = await measureOf(await page({ width: W, height: H, filled: 0.2, ...ink }));
    assert.deepEqual(imageProblems(measure, LIMITS), [], ink.ink);
    assert.ok(measure.sharpness > 150, `${ink.ink}: ${measure.sharpness}`);
  }
  // All but gone, the rule cannot tell it from a fogged photo: it says so, and the person is the one who knows.
  const gone = await measureOf(await page({ width: W, height: H, filled: 0.2, ink: "#b9b9b9", paper: "#cdcdcd" }));
  assert.deepEqual(imageProblems(gone, LIMITS), ["flat"]);
  assert.ok(gone.sharpness > 150, `sharpness ${gone.sharpness}`);
});

test("a photo with too few pixels for a page is too small, whatever else is right, and a strip is not", async () => {
  const photo = await page({ width: W, height: H });
  assert.deepEqual(await problemsOf(await jpeg(sharp(photo).resize(420, 560))), ["too_small"]);
  assert.deepEqual(await problemsOf(await jpeg(sharp(photo).resize(480, 854, { fit: "fill" }))), ["too_small"]);
  assert.deepEqual(await problemsOf(await jpeg(sharp(photo).resize(900, 1200))), []);
  // However the photo is held.
  assert.deepEqual(await problemsOf(await jpeg(sharp(photo).resize(420, 560).rotate(90))), ["too_small"]);
  // What counts is its longer side: a screen cut to its top, or a long receipt, is narrow and has the pixels
  // its text needs.
  assert.deepEqual(await problemsOf(await screen({ width: 1170, height: 340, filled: 0.5, line: 44 })), []);
  assert.deepEqual(await problemsOf(await page({ width: 620, height: 2400, line: 30 })), []);
  assert.deepEqual(imageProblems(measured({ width: 300, height: 1000 }), LIMITS), []);
  assert.deepEqual(imageProblems(measured({ width: 999, height: 999 }), LIMITS), ["too_small"]);
});

test("a page with edges that run one way is read as any other", async () => {
  // A barcode has upright edges alone, the rules of a form lying ones, and a screen may have bars of colour.
  const lopsided: [string, Uint8Array][] = [
    ["a page with a barcode", await page({ width: W, height: H, filled: 0.2, marks: barcode(150, 1500, 1200, 260) })],
    ["a barcode alone", await page({ width: W, height: H, filled: 0, marks: barcode(100, 300, 1300, 1400) })],
    [
      "a ruled form with very faint writing",
      await page({ width: W, height: H, filled: 0.2, ink: "#c4c4c4", marks: rules(100, 200, 1300, 40, 42) }),
    ],
    [
      "a screen with dark bars and little text in grey",
      await screen({
        ...FEW,
        ink: "#9a9a9a",
        marks: block(0, 0, 1170, 260, "#12305c") + block(0, 2300, 1170, 232, "#12305c"),
      }),
    ],
  ];
  for (const [name, photo] of lopsided) {
    const measure = await measureOf(photo);
    assert.ok(measure.sharpness > 150, `${name}: ${measure.sharpness}`);
    assert.deepEqual(imageProblems(measure, LIMITS), [], name);
  }
});

test("what the rule does not see is known", async () => {
  const photo = await page({ width: W, height: H });
  // A hand that moved at an even pace smears thin strokes into fainter, wider ones with ends as clean as
  // before: across, down a little, or aslant, the rule says nothing. It sees a shake where the shake
  // softened the edges: far along the length of the strokes.
  assert.deepEqual(await problemsOf(await shaken(photo, 25, "across")), []);
  assert.deepEqual(await problemsOf(await shaken(photo, 9, "down")), []);
  assert.deepEqual(await problemsOf(await shakenAslant(photo, 21)), []);
  assert.deepEqual(await problemsOf(await shaken(photo, 35, "down")), ["blurry"]);
  // The edges read are the picture's steepest. Around a page burnt by a flash on a dark table, the edge of
  // the table is all that stands out, and answers for the page.
  assert.deepEqual(await problemsOf(await onTable(await lit(photo, 0.15, 215), DARK_TABLE, 0.8)), []);
  // A page out of focus laid on a cloth in focus is answered for by the weave.
  const cloth = await tableTop(W, H, "#8a8a8a", { spread: 40 });
  assert.deepEqual(await problemsOf(await onTable(await unfocused(photo, 6), cloth, 0.6)), []);
  // A page small in the middle of a picture has edges as clean as any, though nobody reads it at that size.
  assert.deepEqual(await problemsOf(await onTable(photo, DARK_TABLE)), []);
  assert.deepEqual(await problemsOf(await onTable(photo, LIGHT_TABLE)), []);
  // Grain hides a blur that is all over the picture: nothing stands out of the blur, and the grain makes it
  // read rough. Heavy grain does on any page; on a dense page of 3 MP an ordinary grain is enough, and the
  // same page from a camera of 12 MP, whose grain is finer than a point of the copy, is still told.
  assert.deepEqual(await problemsOf(await grainy(await unfocused(photo, 12), 12)), []);
  const dense = await unfocused(await page({ width: W, height: H, line: 16 }), 7);
  assert.deepEqual(await problemsOf(dense), ["blurry"]);
  assert.deepEqual(await problemsOf(await grainy(dense, 4)), []);
  const denser = await unfocused(await page({ width: 3000, height: 4000, line: 32 }), 14);
  assert.deepEqual(await problemsOf(await grainy(denser, 3)), ["blurry"]);
  // A photo burnt by a flash that is also a little soft is not called burnt: its ink is not asked.
  assert.deepEqual(await problemsOf(await unfocused(await lit(photo, 0.15, 215), 2)), []);
});

test("what is no image this build reads is not measured, and so never judged", async () => {
  assert.equal(await measureImage(new TextEncoder().encode("isto não é uma imagem")), null);
  assert.equal(await measureImage(new Uint8Array(0)), null);
  // The start of a PDF is no photo either.
  assert.equal(await measureImage(new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")), null);
  // A picture of a few points has no edge to measure, and is measured all the same: its sharpness is none.
  for (const [width, height] of [
    [2, 2],
    [1, 3000],
    [3000, 1],
  ]) {
    const few = await measureOf(
      await sharp({ create: { width, height, channels: 3, background: "#808080" } })
        .png()
        .toBuffer(),
    );
    assert.deepEqual([few.width, few.height, few.sharpness], [width, height, 0]);
  }
});

test("the limits are the setting's, whole or not at all", () => {
  assert.deepEqual(imageLimitsOf(SETTING), LIMITS);
  assert.deepEqual(Object.values(IMAGE_LIMIT_NAMES).sort(), Object.keys(SETTING).sort());
  // Whatever else a setting holds (the kinds it measures) is not a limit.
  assert.deepEqual(imageLimitsOf({ ...SETTING, kinds: ["identity"] }), LIMITS);
  // A setting with a limit missing, or one that is no number, judges nothing: never a limit somebody guessed.
  for (const name of Object.keys(SETTING)) {
    assert.equal(imageLimitsOf({ ...SETTING, [name]: undefined }), null, name);
    assert.equal(imageLimitsOf({ ...SETTING, [name]: "60" }), null, name);
    assert.equal(imageLimitsOf({ ...SETTING, [name]: -1 }), null, name);
    assert.equal(imageLimitsOf({ ...SETTING, [name]: Number.NaN }), null, name);
  }
  assert.equal(imageLimitsOf(null), null);
  assert.equal(imageLimitsOf(Object.values(SETTING)), null);
});

test("each problem is told once, in the order a person fixes them, and only the ones the rule knows", () => {
  const problems = imageProblems(measured({ width: 300, height: 400, sharpness: 2, shadow: 3, highlight: 40 }), LIMITS);
  assert.deepEqual(problems, ["too_small", "blurry", "too_dark"]);
  assert.ok(problems.every((problem) => IMAGE_PROBLEMS.includes(problem)));
  // Too dark or too bright is said as that, and not as flat too.
  assert.deepEqual(imageProblems(measured({ shadow: 230, highlight: 250 }), LIMITS), ["too_bright"]);
  assert.deepEqual(imageProblems(measured({ shadow: 30, highlight: 60 }), LIMITS), ["too_dark"]);
  // A measure exactly at a limit has nothing against it.
  assert.deepEqual(
    imageProblems(measured({ width: 1000, height: 400, sharpness: 30, shadow: 200, highlight: 240 }), LIMITS),
    [],
  );
  assert.deepEqual(imageProblems(measured({ width: 400, height: 1000, shadow: 50, highlight: 90 }), LIMITS), []);
  // Its light past one limit is said once, by the first that names it: the dark side too light is "too
  // bright", and only a photo neither too dark nor too bright is called flat.
  assert.deepEqual(imageProblems(measured({ shadow: 201, highlight: 255 }), LIMITS), ["too_bright"]);
  assert.deepEqual(imageProblems(measured({ shadow: 170, highlight: 200 }), LIMITS), ["flat"]);
  // How dark its ink is, is asked of a crisp photo, and of one with no edge at all (its whole frame is read);
  // not of one a little soft, whose thin strokes are greyed, nor of one out of focus, which is told that.
  for (const light of [
    { shadow: 230, highlight: 250 },
    { shadow: 170, highlight: 200 },
  ]) {
    assert.equal(imageProblems(measured({ sharpness: 150, ...light }), LIMITS).length, 1);
    assert.deepEqual(imageProblems(measured({ sharpness: 149, ...light }), LIMITS), []);
    assert.deepEqual(imageProblems(measured({ sharpness: 30, ...light }), LIMITS), []);
    assert.deepEqual(imageProblems(measured({ sharpness: 12, ...light }), LIMITS), ["blurry"]);
    assert.equal(imageProblems(measured({ sharpness: 0, ...light }), LIMITS).length, 2);
  }
  // Too dark is said of any of them: the paper of a photo taken in the dark is dark however soft it is.
  assert.deepEqual(imageProblems(measured({ sharpness: 60, shadow: 5, highlight: 60 }), LIMITS), ["too_dark"]);
  assert.deepEqual(imageProblems(measured({ sharpness: 12, shadow: 5, highlight: 60 }), LIMITS), ["blurry", "too_dark"]);
});

test("what is kept of a measure says what it was read against, and nothing is kept of one nobody could judge", () => {
  const good = measured({ sharpness: 212.4, shadow: 18, highlight: 246 });
  assert.deepEqual(judgeImage(good, SETTING), { rule: IMAGE_QUALITY_RULE, ...good, problems: [], limits: SETTING });
  // Whatever else the setting holds is not a limit, and is not kept as one.
  assert.deepEqual(judgeImage({ ...good, sharpness: 12 }, { ...SETTING, kinds: ["identity"], note: "x" }), {
    rule: IMAGE_QUALITY_RULE,
    ...good,
    sharpness: 12,
    problems: ["blurry"],
    limits: SETTING,
  });
  // A setting with a limit missing judges nothing: a photo is never said to have nothing against it by a rule
  // that could not read it, and it is measured once the setting is whole.
  assert.equal(judgeImage(good, { ...SETTING, min_sharpness: "60" }), null);
  assert.equal(judgeImage(good, { min_long_side: 1000 }), null);
  assert.equal(judgeImage(good, null), null);
});
