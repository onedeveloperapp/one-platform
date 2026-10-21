import sharp from "sharp";

/**
 * The pictures the rule of a photo's quality is tried on (`quality.ts`):
 * drawn, so that they are the same on every machine and nobody's document is
 * in a fixture. Pages of "text" (short strokes, upright and lying, in lines,
 * as the strokes of letters are), screens with little on them, what a page
 * may carry besides text (a barcode, rules, blocks of colour), what it may
 * lie on (a table, a cloth), and what happens to a photo on its way: out of
 * focus, shaken, taken in poor light, in the dark, burnt by a flash, fogged.
 *
 * They are not photos. What they say of the rule is which way each thing
 * moves its measure and by how much; where the limits sit for what people
 * really send is learned from that (the measure is kept beside each
 * document).
 */

/**
 * A repeatable source of numbers from 0 to 1 (mulberry32: whole numbers of 32 bits all the way, so that it
 * neither loses its low bits nor comes round in a few thousand draws).
 */
export function numbers(seed = 7): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PageOptions {
  width: number;
  height: number;
  ink?: string;
  paper?: string;
  /** How many of its lines are written: 1 for a full page, less for a page or a screen with little on it. */
  filled?: number;
  /** The height of a line of text, in pixels. */
  line?: number;
  seed?: number;
  /** What the page carries besides its text, as SVG (`barcode`, `rules`, `block`). */
  marks?: string;
}

/**
 * A page of "text" as an SVG: lines of marks, each a few thin strokes upright
 * and lying (the stems and the bars of letters), so that it has edges both
 * ways as writing has.
 */
export function pageSvg(options: PageOptions): string {
  const { width, height } = options;
  const ink = options.ink ?? "#151515";
  const paper = options.paper ?? "#ffffff";
  const line = options.line ?? Math.round(height / 60);
  const next = numbers(options.seed ?? 7);
  const filled = options.filled ?? 1;
  const stroke = Math.max(2, Math.round(line * 0.14));
  const tall = Math.round(line * 0.62);
  const strokes: string[] = [];
  for (let y = line * 3; y < height - line * 3; y += Math.round(line * 1.9)) {
    if (next() > filled) continue;
    let x = Math.round(width * 0.08);
    const end = width * (0.55 + next() * 0.37);
    while (x < end) {
      // A letter: a stem, and a bar at its top, its middle or its foot.
      const wide = Math.round(line * (0.34 + next() * 0.3));
      strokes.push(`<rect x="${x}" y="${y}" width="${stroke}" height="${tall}" fill="${ink}"/>`);
      const bar = y + Math.round(tall * [0, 0.45, 0.86][Math.floor(next() * 3)]);
      strokes.push(`<rect x="${x}" y="${bar}" width="${wide}" height="${stroke}" fill="${ink}"/>`);
      if (next() > 0.5) {
        strokes.push(`<rect x="${x + wide - stroke}" y="${y}" width="${stroke}" height="${tall}" fill="${ink}"/>`);
      }
      // A space between words now and then.
      x += wide + Math.round(line * (next() > 0.82 ? 0.7 : 0.22));
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${paper}"/>${strokes.join("")}${options.marks ?? ""}</svg>`;
}

/** The bars of a barcode: upright, of a few widths, black. Edges one way only. */
export function barcode(x: number, y: number, wide: number, tall: number, seed = 5): string {
  const next = numbers(seed);
  const bars: string[] = [];
  let at = x;
  while (at < x + wide) {
    const bar = 3 + Math.floor(next() * 3) * 3;
    bars.push(`<rect x="${at}" y="${y}" width="${bar}" height="${tall}" fill="#101010"/>`);
    at += bar + 3 + Math.floor(next() * 3) * 3;
  }
  return bars.join("");
}

/** The rules of a form: lines from side to side, one under the other. Edges the other way only. */
export function rules(x: number, y: number, wide: number, count: number, apart: number, ink = "#202020"): string {
  return Array.from(
    { length: count },
    (_, index) => `<rect x="${x}" y="${y + index * apart}" width="${wide}" height="3" fill="${ink}"/>`,
  ).join("");
}

/** A block of one colour: the header of a screen, a box of a form. */
export const block = (x: number, y: number, wide: number, tall: number, colour: string): string =>
  `<rect x="${x}" y="${y}" width="${wide}" height="${tall}" fill="${colour}"/>`;

export const jpeg = (image: sharp.Sharp): Promise<Buffer> => image.jpeg({ quality: 88 }).toBuffer();

/** A page as the camera of a phone would store it. */
export const page = (options: PageOptions): Promise<Buffer> => jpeg(sharp(Buffer.from(pageSvg(options))));

/** A screen as a phone captures it: no camera, no loss. */
export const screen = (options: PageOptions): Promise<Buffer> =>
  sharp(Buffer.from(pageSvg(options)))
    .png()
    .toBuffer();

/** A frame of one colour: a blank page, an empty table. */
export const plain = (width: number, height: number, colour: string): Promise<Buffer> =>
  jpeg(sharp({ create: { width, height, channels: 3, background: colour } }));

/** Out of focus: every edge soft, every way. */
export const unfocused = (photo: Uint8Array, sigma: number): Promise<Buffer> => jpeg(sharp(photo).blur(sigma));

/** Shaken: smeared along one direction, by so many pixels of the photo, at an even pace. */
export function shaken(photo: Uint8Array, pixels: number, direction: "across" | "down" = "across"): Promise<Buffer> {
  // A line of ones in a field of zeros: three lines at least, as the library asks of a kernel.
  const ones = Array.from({ length: pixels }, () => 1);
  const zeros = Array.from({ length: pixels }, () => 0);
  const kernel =
    direction === "across"
      ? { width: pixels, height: 3, kernel: [...zeros, ...ones, ...zeros] }
      : { width: 3, height: pixels, kernel: ones.flatMap(() => [0, 1, 0]) };
  return jpeg(sharp(photo).convolve(kernel));
}

/** Shaken along a diagonal: as far across as down. */
export function shakenAslant(photo: Uint8Array, pixels: number): Promise<Buffer> {
  const kernel: number[] = [];
  for (let y = 0; y < pixels; y += 1) for (let x = 0; x < pixels; x += 1) kernel.push(x === y ? 1 : 0);
  return jpeg(sharp(photo).convolve({ width: pixels, height: pixels, kernel }));
}

/** Taken in poor light: grain of a given spread on every point, as a sensor leaves it, stored as a phone stores a photo. */
export async function grainy(photo: Uint8Array, spread: number, seed = 11): Promise<Buffer> {
  const { data, info } = await sharp(photo).greyscale().raw().toBuffer({ resolveWithObject: true });
  const next = numbers(seed);
  const out = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) {
    // Two numbers of the source make one of a bell curve.
    const bell = Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
    out[index] = Math.max(0, Math.min(255, Math.round(data[index] + bell * spread)));
  }
  return jpeg(sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } }));
}

/** The same photo with all its light moved: `gain` times what it was, plus `lift`. */
export const lit = (photo: Uint8Array, gain: number, lift: number): Promise<Buffer> =>
  jpeg(sharp(photo).linear(gain, lift));

/**
 * What a paper lies on: a top of one colour, with a weave when asked (grain
 * of a spread, smoothed or not: a cloth, the grain of wood).
 */
export async function tableTop(
  width: number,
  height: number,
  colour: string,
  weave?: { spread: number; smooth?: number },
): Promise<Buffer> {
  const top = await plain(width, height, colour);
  if (!weave) return top;
  const woven = await grainy(top, weave.spread, 23);
  return jpeg(weave.smooth ? sharp(woven).blur(weave.smooth) : sharp(woven));
}

/**
 * A cloth with a weave: threads over and under each other, so many pixels from one to the next, each so much
 * lighter or darker than the cloth. Regular, as a tablecloth or a bedspread is, and unlike the grain of a sensor.
 */
export async function wovenCloth(
  width: number,
  height: number,
  shade: number,
  weave: { period: number; depth: number },
): Promise<Buffer> {
  const out = Buffer.alloc(width * height);
  const turn = (2 * Math.PI) / weave.period;
  for (let y = 0; y < height; y += 1) {
    const down = Math.sin(y * turn);
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(shade + weave.depth * Math.sin(x * turn) * down)));
    }
  }
  return jpeg(sharp(out, { raw: { width, height, channels: 1 } }));
}

/**
 * A page photographed from farther: small in the middle of what it lies on
 * (a colour, or a table top). What happens to the photo afterwards (a shake,
 * a blur) happens to the table too, as it does to a real one.
 */
export async function onTable(photo: Uint8Array, table: string | Uint8Array, share = 0.3): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(photo).metadata();
  const small = await sharp(photo)
    .resize(Math.round(width * share))
    .toBuffer();
  const top =
    typeof table === "string" ? sharp({ create: { width, height, channels: 3, background: table } }) : sharp(table);
  return jpeg(top.composite([{ input: small, gravity: "centre" }]));
}
