/**
 * What the rule of a photo's quality measures of the pictures it is tried on,
 * and what it would say of each by the limits named below: the table behind
 * the limits the setting starts with (`document_quality`, migration 0024) and
 * behind the section of the README that explains them.
 *
 *   npm run quality -w @flyee/documents
 *
 * The pictures are drawn (`src/quality.fixtures.ts`), not photographed: the
 * table says which way each thing moves the measure and by how much.
 */
import { imageProblems, measureImage } from "../src/quality.ts";
import {
  barcode,
  block,
  grainy,
  jpeg,
  lit,
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
} from "../src/quality.fixtures.ts";
import sharp from "sharp";

/** The limits the setting starts with. */
const LIMITS = { minLongSide: 1000, minSharpness: 30, crispSharpness: 150, minHighlight: 90, maxShadow: 200, minRange: 40 };

const rows: [string, Uint8Array][] = [];
const add = (name: string, bytes: Uint8Array) => rows.push([name, bytes]);

const W = 1500;
const H = 2000;
const full = await page({ width: W, height: H });
const camera = await page({ width: 3000, height: 4000 });
const fine = await page({ width: W, height: H, line: 16 });
const sparse = await page({ width: W, height: H, filled: 0.2 });
const faded = await page({ width: W, height: H, filled: 0.2, ink: "#828282", paper: "#d2d2d2" });
const few = { width: 1170, height: 2532, filled: 0.12, line: 44 };
const dark = { ink: "#f2f2f2", paper: "#101010" };

// Pages and screens that can be read.
add("a full page, 3 MP", full);
add("a full page, 12 MP", camera);
add("a full page in fine print", fine);
add("a page with a fifth of its lines", sparse);
add("a page of two lines", await page({ width: W, height: H, filled: 0.04, seed: 3 }));
add("a faded receipt, a fifth of its lines (ink 130 on paper 210)", faded);
add("a full faded receipt (ink 140 on paper 210)", await page({ width: W, height: H, ink: "#8c8c8c", paper: "#d2d2d2" }));
add("a receipt faded further (ink 160 on paper 205)", await page({ width: W, height: H, filled: 0.2, ink: "#a0a0a0", paper: "#cdcdcd" }));
add("a receipt all but gone (ink 180 on paper 205)", await page({ width: W, height: H, filled: 0.2, ink: "#b4b4b4", paper: "#cdcdcd" }));
add("a slip of one line on a table of its own colour", await page({ width: W, height: H, filled: 0.02, seed: 5 }));
add("a screen, light, text on half its lines", await screen({ ...few, filled: 0.5 }));
add("a screen, light, little text", await screen(few));
add("a screen, light, little text in grey", await screen({ ...few, ink: "#707070" }));
add("a screen, dark theme, text on half its lines", await screen({ ...few, ...dark, filled: 0.5 }));
add("a screen, dark theme, little text", await screen({ ...few, ...dark }));
add("a screen, dark theme, two lines", await screen({ ...few, ...dark, filled: 0.04, seed: 3 }));
add("a screen with dark bars and little text in grey", await screen({ ...few, ink: "#9a9a9a", marks: block(0, 0, 1170, 260, "#12305c") + block(0, 2300, 1170, 232, "#12305c") }));
// What a page carries besides text: edges one way only.
add("a page with a barcode", await page({ width: W, height: H, filled: 0.2, marks: barcode(150, 1500, 1200, 260) }));
add("a barcode alone, close", await page({ width: W, height: H, filled: 0, marks: barcode(100, 300, 1300, 1400) }));
add("a barcode over the whole frame", await page({ width: W, height: H, filled: 0, marks: barcode(0, 0, W, H) }));
add("a ruled form with faint writing", await page({ width: W, height: H, filled: 0.2, ink: "#a8a8a8", marks: rules(100, 200, 1300, 40, 42) }));
add("a ruled form with very faint writing", await page({ width: W, height: H, filled: 0.2, ink: "#c4c4c4", marks: rules(100, 200, 1300, 40, 42) }));
add("a ruled form with faint writing, a little soft (sigma 2)", await unfocused(await page({ width: W, height: H, filled: 0.2, ink: "#a8a8a8", marks: rules(100, 200, 1300, 40, 42) }), 2));
add("a page with blocks of colour", await page({ width: W, height: H, filled: 0.2, marks: block(0, 0, W, 220, "#1b3a6b") + block(100, 700, 1300, 300, "#e6e6e6") }));
// What a page lies on.
const wood = await tableTop(W, H, "#7a6a55", { spread: 22, smooth: 1.2 });
const cloth = await tableTop(W, H, "#8a8a8a", { spread: 40 });
add("a page small on a dark table", await onTable(full, "#2a2520"));
add("a page small on a light table", await onTable(full, "#d8d2c8"));
add("a faded receipt on a dark table", await onTable(faded, "#2a2520", 0.5));
add("a faded receipt on wood", await onTable(faded, wood, 0.5));
add("a faded receipt on a coarse cloth", await onTable(faded, cloth, 0.5));
add("a page with a fifth of its lines on a coarse cloth", await onTable(sparse, cloth, 0.5));
// A small paper in a large frame, as a till receipt photographed from above (12 MP): its strokes are thinner
// than a point of the copy the rule measures on.
const light = "#d9d4cc";
const largeWood = await tableTop(3000, 4000, "#9a7b5a", { spread: 22, smooth: 1.2 });
const receipt = { width: 3000, height: 4000, filled: 0.2 };
for (const [name, ink] of [
  ["dark ink", {}],
  ["faded ink", { ink: "#828282", paper: "#d2d2d2" }],
] as const) {
  const paper = await page({ ...receipt, ...ink });
  add(`a small receipt in ${name} on a light table (12 MP, a third of the width)`, await onTable(paper, light, 0.3));
  add(`a small receipt in ${name} on a dark table (12 MP, a third of the width)`, await onTable(paper, "#2a2520", 0.3));
  add(`a small receipt in ${name} on wood (12 MP, a third of the width)`, await onTable(paper, largeWood, 0.3));
}
add("a small receipt in dark ink on a light table, a little soft (sigma 4)", await unfocused(await onTable(await page(receipt), light, 0.3), 4));
add("a small receipt in faded ink on a light table, a little soft (sigma 4)", await unfocused(await onTable(await page({ ...receipt, ink: "#828282", paper: "#d2d2d2" }), light, 0.3), 4));
add("a small receipt in dark ink on a light table, out of focus (sigma 12)", await unfocused(await onTable(await page(receipt), light, 0.3), 12));
add("a page out of focus (sigma 6) laid on a cloth in focus", await onTable(await unfocused(full, 6), cloth, 0.6));
add("wood alone", wood);
add("a coarse cloth alone", cloth);
// A cloth with a weave: regular, under part of the picture only.
const tablecloth = await wovenCloth(W, H, 150, { period: 8, depth: 25 });
const wideWeave = await wovenCloth(W, H, 150, { period: 20, depth: 30 });
add("a page with a fifth of its lines on a woven cloth", await onTable(sparse, tablecloth, 0.5));
add("a faded receipt on a woven cloth", await onTable(faded, tablecloth, 0.5));
add("a faded receipt on a cloth of a wide weave", await onTable(faded, wideWeave, 0.5));
add("a small page in fine print on a woven cloth", await onTable(fine, tablecloth, 0.4));
add("a faded receipt on a woven cloth, all out of focus, sigma 5", await unfocused(await onTable(faded, tablecloth, 0.5), 5));
add("a woven cloth alone", tablecloth);
// A cloth with a smooth, strong pattern: its soft waves slope more than the thin strokes of a small receipt.
const waves = await wovenCloth(3000, 4000, 200, { period: 56, depth: 50 });
const smallFaded = await onTable(await page({ ...receipt, ink: "#828282", paper: "#d2d2d2" }), waves, 0.3);
add("a small receipt in faded ink on a cloth of smooth waves (12 MP)", smallFaded);
add("a small receipt in faded ink on a cloth of smooth waves, out of focus (sigma 12)", await unfocused(smallFaded, 12));
add("a cloth of smooth waves alone (12 MP)", waves);
// Out of focus.
for (const sigma of [1.2, 2, 2.5, 3, 4, 6, 9]) add(`out of focus, sigma ${sigma} (3 MP)`, await unfocused(full, sigma));
for (const sigma of [3, 6, 12]) add(`out of focus, sigma ${sigma} (12 MP)`, await unfocused(camera, sigma));
for (const sigma of [2.5, 4]) add(`fine print out of focus, sigma ${sigma}`, await unfocused(fine, sigma));
for (const sigma of [2.5, 4]) add(`a fifth of its lines, out of focus, sigma ${sigma}`, await unfocused(sparse, sigma));
for (const sigma of [2.5, 4]) add(`a faded receipt out of focus, sigma ${sigma}`, await unfocused(faded, sigma));
add("a faded receipt on a coarse cloth, all out of focus, sigma 4", await unfocused(await onTable(faded, cloth, 0.5), 4));
// Shaken.
for (const pixels of [5, 9, 15, 25]) add(`shaken across, ${pixels} px (3 MP)`, await shaken(full, pixels));
for (const pixels of [5, 9, 15, 25]) add(`shaken down, ${pixels} px (3 MP)`, await shaken(full, pixels, "down"));
for (const pixels of [15, 31, 61]) add(`shaken across, ${pixels} px (12 MP)`, await shaken(camera, pixels));
for (const pixels of [15, 25]) add(`fine print shaken across, ${pixels} px`, await shaken(fine, pixels));
for (const pixels of [15, 25]) add(`fine print on a dark table, all shaken across, ${pixels} px`, await shaken(await onTable(fine, "#2a2520", 0.7), pixels));
for (const pixels of [15, 25]) add(`a fifth of its lines, shaken across, ${pixels} px`, await shaken(sparse, pixels));
for (const pixels of [15, 25]) add(`a faded receipt on a dark table, all shaken across, ${pixels} px`, await shaken(await onTable(faded, "#2a2520", 0.5), pixels));
for (const pixels of [9, 21]) add(`shaken aslant, ${pixels} px`, await shakenAslant(full, pixels));
// Grain.
for (const spread of [3, 6, 12]) add(`sharp, with grain of ${spread}`, await grainy(full, spread));
for (const spread of [6, 12]) add(`a faded receipt with grain of ${spread}`, await grainy(faded, spread));
for (const spread of [3, 6, 12]) add(`out of focus (sigma 5), with grain of ${spread}`, await grainy(await unfocused(full, 5), spread));
for (const spread of [6, 12]) add(`shaken across 25 px, with grain of ${spread}`, await grainy(await shaken(full, 25), spread));
for (const spread of [3, 6, 12]) add(`a plain grey frame with grain of ${spread}`, await grainy(await plain(W, H, "#909090"), spread));
// Light.
add("in the dark (a quarter of its light)", await lit(full, 0.25, 0));
add("in dim light (half of its light)", await lit(full, 0.5, 0));
add("burnt by a flash", await lit(full, 0.15, 215));
add("fogged", await lit(full, 0.1, 125));
add("burnt by a flash, and a little soft (sigma 2)", await unfocused(await lit(full, 0.15, 215), 2));
add("a blank page", await plain(1200, 1600, "#fbfbfb"));
add("a page burnt by a flash, on a dark table", await onTable(await lit(full, 0.15, 215), "#2a2520", 0.8));
// Size and the file.
add("small: 420 x 560", await jpeg(sharp(full).resize(420, 560)));
add("small: 480 x 854", await jpeg(sharp(full).resize(480, 854, { fit: "fill" })));
add("a strip: a screen cut to 1170 x 340", await screen({ width: 1170, height: 340, filled: 0.5, line: 44 }));
add("a long capture of 1080 x 9000", await screen({ width: 1080, height: 9000, filled: 0.5, line: 44 }));
add("a long capture of 1080 x 9000, out of focus (sigma 6)", await unfocused(await screen({ width: 1080, height: 9000, filled: 0.5, line: 44 }), 6));
add("a strip: a screen cut to 1170 x 600", await screen({ width: 1170, height: 600, filled: 0.5, line: 44 }));
add("a strip: a receipt of 620 x 2400", await page({ width: 620, height: 2400, line: 30 }));
add("small: 700 x 933", await jpeg(sharp(full).resize(700, 933)));
add("stored with little quality (20)", await sharp(full).jpeg({ quality: 20 }).toBuffer());
add("out of focus (sigma 5), stored with little quality (20)", await sharp(await unfocused(full, 5)).jpeg({ quality: 20 }).toBuffer());

const pad = (text: string | number, size: number) => String(text).padEnd(size);
console.log(`${pad("picture", 62)}${pad("sides", 11)}${pad("sharp", 7)}${pad("dark", 6)}${pad("light", 7)}says`);
for (const [name, bytes] of rows) {
  const measure = await measureImage(bytes);
  if (!measure) {
    console.log(`${pad(name, 62)}not measured`);
    continue;
  }
  console.log(
    `${pad(name, 62)}${pad(`${measure.width}x${measure.height}`, 11)}${pad(measure.sharpness, 7)}${pad(measure.shadow, 6)}${pad(measure.highlight, 7)}${imageProblems(measure, LIMITS).join(", ") || "nothing"}`,
  );
}
