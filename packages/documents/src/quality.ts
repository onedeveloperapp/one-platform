import sharp from "sharp";

/**
 * How well a photo of a document can be read, measured from its pixels: its
 * size, how steep its edges are, and how far the light of their two sides is
 * apart. A rule, not a judgement: it tells a photo nobody will read (taken
 * too small, out of focus, in the dark, burnt by a flash) from one worth a
 * person's or a model's look, and says which of those it is, so that whoever
 * took it can take another while they still have the paper in hand.
 *
 * It measures; the limits it is read against are data (the setting the app
 * reads), never a constant of this file. It says nothing of what the photo
 * shows: whether it is the right document, of the right person, is a person's
 * or a model's to read.
 *
 * It errs towards saying nothing. Everything it measures but the size is read
 * at the edges of the picture, so that a photo in focus measures the same
 * whether much or little is written on the page, in dark ink or faded, and
 * whether the paper fills the frame or lies small on a table: a till receipt
 * with three faded lines is as sharp, and its ink as dark, as a full page. A
 * photo it has nothing against may still be unreadable (see "What the rule
 * does not see" in the README), and that is what a person and the check of
 * the document are for. A photo it speaks against is one a person would take
 * again too.
 */

/** The version of this rule: what a measure kept beside a document was read under. */
export const IMAGE_QUALITY_RULE = "qualidade-da-imagem-v1";

/** What is measured of a photo. */
export interface ImageMeasure {
  /** Its sides in pixels, upright (as its metadata says it was held). */
  width: number;
  height: number;
  /**
   * How steep its edges are, on a grey copy of a fixed size: 200 and more for
   * the edges of print in focus, about 100 for a photo a little soft, under
   * 25 for one out of focus. Read on the edges that stand out of the picture
   * (its steepest, above its own grain), so it is the same for a full page
   * and for three faded lines; and along the softer of the two ways, across
   * and down. 0 when nothing in the picture has an edge, and only then (a
   * blank page; a frame of one shade). Where grain, a weave or a blur is all over the
   * picture and nothing stands out of it, the whole of it is read: a weave or
   * grain in focus is as steep as edges are, a page far out of focus is
   * smooth.
   */
  sharpness: number;
  /**
   * How dark the dark side of its edges is, 0 (black) to 255 (white): the ink
   * of a page, however little there is of it. The darker quarter of the edges
   * is the one read (the strokes that came out whole). Of a picture with no
   * edge to read, how dark its darkest part is: the light one point in two
   * hundred of the whole frame stays under.
   */
  shadow: number;
  /** How light the light side of its edges is (the paper), read the same way; or the lightest part of a frame with no edge. */
  highlight: number;
}

/**
 * What keeps a photo from being read:
 * - `too_small`: too few pixels along its longer side for the text of a page
 *   (a strip is not small for being narrow);
 * - `blurry`: its edges are soft (out of focus, or smeared by a hand that
 *   moved);
 * - `too_dark`: even the light side of its edges is dark (a page photographed
 *   in the dark; a screen in a dark theme is not: its letters are light);
 * - `too_bright`: even the dark side of its edges is light (burnt by a flash),
 *   or it is a blank page;
 * - `flat`: the two sides of its edges are too close to tell letters from
 *   paper.
 */
export type ImageProblem = "too_small" | "blurry" | "too_dark" | "too_bright" | "flat";

export const IMAGE_PROBLEMS: readonly ImageProblem[] = ["too_small", "blurry", "too_dark", "too_bright", "flat"];

/** The limits a measure is read against. Data: the app hands them over from its settings. */
export interface ImageLimits {
  /** The fewest pixels of the longer side. */
  minLongSide: number;
  /** The least sharpness: under it, a photo is out of focus. */
  minSharpness: number;
  /**
   * The sharpness from which the ink of a photo is read as ink. A softer photo greys its thin strokes: it is
   * not called burnt or flat for that.
   */
  crispSharpness: number;
  /** The least light the light side of its edges must have. */
  minHighlight: number;
  /** The most light the dark side of its edges may have. */
  maxShadow: number;
  /** The least distance between the two sides. */
  minRange: number;
}

/** The names of the limits, as a setting holds them: the one list the rule, the app and the database agree on. */
export const IMAGE_LIMIT_NAMES = {
  minLongSide: "min_long_side",
  minSharpness: "min_sharpness",
  crispSharpness: "crisp_sharpness",
  minHighlight: "min_highlight",
  maxShadow: "max_shadow",
  minRange: "min_range",
} as const satisfies Record<keyof ImageLimits, string>;

// What follows is part of what the rule measures, so part of its version.

/**
 * How many points the grey copy a photo is measured on has: those of a page
 * of 768 by 1,024. Enough to tell sharp from soft, few enough to be quick;
 * and the same for a photo and for a strip, so that a long receipt is not
 * measured on a sliver.
 */
const MEASURED_POINTS = 768 * 1024;

/**
 * How many points the finer copy has, on which the light of an edge's two
 * sides is read: four times as many. A stroke of small print is thinner than
 * a point of the measured copy, which greys it: its ink is read where it is
 * still ink.
 */
const FINE_POINTS = 4 * MEASURED_POINTS;

/** The most pixels an input image may have: a guard against a file crafted to exhaust memory. */
const INPUT_PIXEL_LIMIT = 120_000_000;

/**
 * The share of a frame's points its darkest and its lightest part are read
 * at, when the picture has no edge to read the light of: one in two hundred.
 */
const LIGHT_SHARE = 0.005;

/**
 * The least slope taken for an edge: the light of the point after differs by
 * this much from the light of the point before. Under it are the shading of a
 * sheet of paper, a shadow, and the rounding of a file.
 */
const EDGE_SLOPE = 16;

/**
 * The share of a photo's points its steepest slope (and its sharpest bend) is
 * read at: the picture's steepest, without the odd point. Small enough for a
 * slip of one line to have edges.
 */
const STEEPEST_SHARE = 0.00025;

/** Only the picture's own steep edges are read: the ones at least this part of its steepest. A soft background does not count against a sharp page. */
const OWN_STEEPEST = 0.25;

/** An edge stands out of the picture's grain when its slope is this many times the typical slope (the one half of the points stay under). */
const STANDS_OUT = 7;

/** When the grain reaches this part of the steepest slope, nothing stands out of it: the picture is grain or texture all over. */
const ALL_GRAIN = 0.9;

/** What the rounding of a file's light to whole numbers puts into the typical bend of a smooth picture. */
const ROUNDING = 0.5;

/**
 * How far from an edge its two sides are looked for, in points along the way:
 * far enough to be past the edge of print a little soft, near enough to stay
 * on the same letter.
 */
const EDGE_REACH = 4;

/**
 * The share of a photo's edges the light of their sides is read at: a quarter.
 * The darker quarter of the dark sides and the lighter quarter of the light
 * ones: the strokes that came out whole.
 */
const SIDE_SHARE = 0.25;

/**
 * A grain is the same all over the picture (a sensor's, and not a weave under part of it) when its flattest
 * tenth is at least this part of what a bell curve with its typical slope would have there.
 */
const EVEN_GRAIN = 0.6;

/** The darkest and the lightest of the finer copy's points under each point of the measured copy. */
type Extremes = { darkest: Uint8Array; lightest: Uint8Array };

/** The light on the two sides of a photo's edges: how many edges have a dark side, and a light side, of each light. */
type Sides = { dark: Uint32Array; light: Uint32Array; counted: number; extremes: Extremes };

/** For each point of a copy of `width` by `height`, the darkest and the lightest of the points of a finer copy it stands for. */
function extremesOf(
  fine: Uint8Array,
  fineWidth: number,
  fineHeight: number,
  fineStep: number,
  width: number,
  height: number,
): Extremes {
  const darkest = new Uint8Array(width * height).fill(255);
  const lightest = new Uint8Array(width * height);
  for (let fineY = 0; fineY < fineHeight; fineY += 1) {
    const row = Math.min(height - 1, Math.floor((fineY * height) / fineHeight)) * width;
    for (let fineX = 0; fineX < fineWidth; fineX += 1) {
      const at = row + Math.min(width - 1, Math.floor((fineX * width) / fineWidth));
      const value = fine[(fineY * fineWidth + fineX) * fineStep];
      if (value < darkest[at]) darkest[at] = value;
      if (value > lightest[at]) lightest[at] = value;
    }
  }
  return { darkest, lightest };
}

/** The size a share of what was counted stays under, read inside its step of the scale (so that it does not jump from one whole number to the next). */
function sizeAt(counts: Uint32Array, counted: number, share: number): number {
  const wanted = counted * share;
  let seen = 0;
  for (let size = 0; size < counts.length; size += 1) {
    if (seen + counts[size] >= wanted && counts[size] > 0) {
      const from = size === 0 ? 0 : size - 0.5;
      const wide = size === 0 ? 0.5 : 1;
      return from + ((wanted - seen) / counts[size]) * wide;
    }
    seen += counts[size];
  }
  return 0;
}

/** The size the few largest of what was counted reach: a few in ten thousand, without the odd one. */
function topOf(counts: Uint32Array, counted: number): number {
  let over = 0;
  for (let size = counts.length - 1; size > 0; size -= 1) {
    over += counts[size];
    if (over >= counted * STEEPEST_SHARE) return size;
  }
  return 0;
}

/** What was read of a photo's edges along one way: none there, or how steep they are. */
type Way = { edges: false } | { edges: true; sharpness: number };

/**
 * The edges of a grey picture along one way (`stride` is the distance, in the
 * buffer, between a point and the next one that way).
 *
 * The slope at a point is the light of the next point less the light of the
 * one before; the bend is how much the point's own light differs from the
 * mean of those two. At a clean edge the bend is as large as the slope; the
 * softer the edge, the smaller its bend for the same slope. So the sum of the
 * squared bends over the sum of the squared slopes, over the edges, says how
 * steep they are, whatever their number and their contrast.
 */
function readWay(data: Uint8Array, width: number, height: number, step: number, stride: number, sides: Sides): Way {
  const across = stride === step;
  // A point is read with the two before it and the two after it, along the way.
  const fromX = across ? 2 : 0;
  const toX = across ? width - 2 : width;
  const fromY = across ? 0 : 2;
  const toY = across ? height : height - 2;
  const apart = across ? 1 : width;
  const most = across ? width - 1 : height - 1;
  const slopes = new Uint32Array(256);
  let points = 0;
  for (let y = fromY; y < toY; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      const at = (y * width + x) * step;
      slopes[Math.abs(data[at + stride] - data[at - stride])] += 1;
      points += 1;
    }
  }
  if (points === 0) return { edges: false };

  const steepest = topOf(slopes, points);
  if (steepest < EDGE_SLOPE) return { edges: false };

  // The two sides of an edge at a point: the darkest and the lightest point within reach of it, along the way.
  const sidesOf = (x: number, y: number) => {
    const along = across ? x : y;
    const here = y * width + x;
    let dark = 255;
    let light = 0;
    for (let reach = -Math.min(EDGE_REACH, along); reach <= Math.min(EDGE_REACH, most - along); reach += 1) {
      const point = here + reach * apart;
      if (sides.extremes.darkest[point] < dark) dark = sides.extremes.darkest[point];
      if (sides.extremes.lightest[point] > light) light = sides.extremes.lightest[point];
    }
    sides.dark[dark] += 1;
    sides.light[light] += 1;
    sides.counted += 1;
  };

  // The typical slope: half of the points stay under it. It is the grain's (the noise of a photo taken in
  // poor light, the weave of a cloth under the paper), since the edges of a page are a few points in a
  // hundred.
  const typical = sizeAt(slopes, points, 0.5);
  let slopeSquares = 0;
  let bendSquares = 0;
  if (STANDS_OUT * typical > ALL_GRAIN * steepest) {
    // Nothing stands out by its slope: grain, a weave, a pattern or a blur is all over the picture.
    const bends = new Uint32Array(511);
    for (let y = fromY; y < toY; y += 1) {
      for (let x = fromX; x < toX; x += 1) {
        const at = (y * width + x) * step;
        bends[Math.abs(data[at - stride] + data[at + stride] - 2 * data[at])] += 1;
      }
    }
    const typicalBend = sizeAt(bends, points, 0.5);
    const sharpest = topOf(bends, points);
    if (sharpest >= EDGE_SLOPE && sharpest >= STANDS_OUT * typicalBend) {
      // Something bends far more than the rest does: a paper in focus lying on a smooth pattern, whose soft
      // waves slope more than its thin strokes and bend far less. It is what is read. A blur all over has
      // nothing that bends so, and neither has grain, whose sharpest bend is a few times its typical one.
      const cut = Math.max(EDGE_SLOPE, STANDS_OUT * typicalBend, OWN_STEEPEST * sharpest);
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          const at = (y * width + x) * step;
          const bend = data[at - stride] + data[at + stride] - 2 * data[at];
          if (Math.abs(bend) < cut) continue;
          const slope = data[at + stride] - data[at - stride];
          slopeSquares += slope * slope;
          bendSquares += bend * bend;
          sidesOf(x, y);
        }
      }
      // The middle of a thin stroke bends and does not slope: one level of slope is all such a point is asked.
      return { edges: true, sharpness: (400 * bendSquares) / Math.max(1, slopeSquares) };
    }
    // The whole of it is read, by its typical bend for its typical slope. A weave or grain in focus bends
    // as much as it slopes, as edges do; a page far out of focus is smooth all over. The rounding of a file
    // is taken off the bend, or the smoothest blur would read as a little rough.
    const bend = Math.max(0, typicalBend - ROUNDING);
    return { edges: true, sharpness: 400 * (bend / typical) ** 2 };
  }

  // The grain that is the same all over the picture (a sensor's) is in every point, the ones of an edge
  // too, and is taken off them: its spread is its typical size over 0.6745 (a bell curve). A weave that is
  // under part of the picture only is not taken off: a paper lying on a cloth is smooth, and its edges have
  // none of the cloth's grain. Which of the two it is, the flattest tenth of the points says: under a bell
  // curve it is 0.1257 of the spread, and where part of the picture is smooth it is flat.
  const spread = typical / 0.6745;
  const even = sizeAt(slopes, points, 0.1) / 0.1257 > spread * EVEN_GRAIN;
  const grain = even ? spread ** 2 : 0;

  const cut = Math.max(EDGE_SLOPE, STANDS_OUT * typical, OWN_STEEPEST * steepest);
  let counted = 0;
  for (let y = fromY; y < toY; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      const at = (y * width + x) * step;
      const slope = data[at + stride] - data[at - stride];
      // An edge is read whole: a point whose neighbour along the way is steep enough belongs to that edge,
      // and holds its bend (the middle of an edge is its steepest point and bends the least).
      const steep =
        Math.abs(slope) >= cut ||
        Math.abs(data[at] - data[at - 2 * stride]) >= cut ||
        Math.abs(data[at + 2 * stride] - data[at]) >= cut;
      if (!steep) continue;
      const bend = data[at - stride] + data[at + stride] - 2 * data[at];
      slopeSquares += slope * slope;
      bendSquares += bend * bend;
      counted += 1;
      if (Math.abs(slope) >= cut) sidesOf(x, y);
    }
  }
  // What grain alone puts into each point read: a bend holds three times the grain a slope does.
  const edges = slopeSquares - counted * grain;
  if (edges <= 0) return { edges: false };
  return { edges: true, sharpness: (400 * Math.max(0, bendSquares - counted * 3 * grain)) / edges };
}

/**
 * Measures a photo. `null` when the bytes are no image this build reads (a
 * format with no decoder here, a damaged file): what cannot be measured is
 * never said to be good or bad.
 */
export async function measureImage(bytes: Uint8Array): Promise<ImageMeasure | null> {
  try {
    const stored = await sharp(bytes, { limitInputPixels: INPUT_PIXEL_LIMIT }).metadata();
    if (!stored.width || !stored.height) return null;
    // A photo held on its side is stored lying down, with a note of how it was held (5 to 8: turned a quarter).
    const turned = (stored.orientation ?? 1) >= 5;
    const info = turned
      ? { width: stored.height, height: stored.width }
      : { width: stored.width, height: stored.height };
    // A grey copy with so many points, of the photo's own shape and never larger than the photo.
    const copy = (most: number) => {
      const scale = Math.min(1, Math.sqrt(most / (info.width * info.height)));
      return sharp(bytes, { limitInputPixels: INPUT_PIXEL_LIMIT })
        .rotate()
        .flatten({ background: "#ffffff" })
        .greyscale()
        .resize({
          width: Math.max(1, Math.round(info.width * scale)),
          height: Math.max(1, Math.round(info.height * scale)),
          fit: "fill",
        })
        .raw()
        .toBuffer({ resolveWithObject: true });
    };
    const [{ data, info: grey }, fine] = await Promise.all([copy(MEASURED_POINTS), copy(FINE_POINTS)]);
    const width = grey.width;
    const height = grey.height;
    const step = grey.channels;
    const points = width * height;
    if (points === 0) return null;

    const sides: Sides = {
      dark: new Uint32Array(256),
      light: new Uint32Array(256),
      counted: 0,
      extremes: extremesOf(fine.data, fine.info.width, fine.info.height, fine.info.channels, width, height),
    };
    const across = readWay(data, width, height, step, step, sides);
    const down = readWay(data, width, height, step, width * step, sides);
    // The softer way is the one kept: a photo out of focus is soft both ways, one smeared by a hand that moved
    // is soft along the movement. With no edge either way the photo has none, and that alone is 0: the
    // softest of edges is 0.1. The scale ends at 999: past a clean edge (400) there is nothing to tell apart.
    let softer: number | null = null;
    for (const way of [across, down]) {
      if (way.edges && (softer === null || way.sharpness < softer)) softer = way.sharpness;
    }
    const sharpness = softer === null ? 0 : Math.max(0.1, Math.min(999, Math.round(softer * 10) / 10));

    // The light is that of the two sides of the edges: of the ink and of the paper, however little ink there
    // is. A picture with no edge to read has the light of its whole frame.
    const light = new Uint32Array(256);
    if (sides.counted === 0) for (let index = 0; index < points; index += 1) light[data[index * step]] += 1;
    const at = (counts: Uint32Array, counted: number, share: number): number => {
      const wanted = counted * share;
      let seen = 0;
      for (let value = 0; value < 256; value += 1) {
        seen += counts[value];
        if (seen >= wanted) return value;
      }
      return 255;
    };

    return {
      width: info.width,
      height: info.height,
      sharpness,
      shadow: sides.counted > 0 ? at(sides.dark, sides.counted, SIDE_SHARE) : at(light, points, LIGHT_SHARE),
      highlight:
        sides.counted > 0 ? at(sides.light, sides.counted, 1 - SIDE_SHARE) : at(light, points, 1 - LIGHT_SHARE),
    };
  } catch {
    return null;
  }
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The limits as a setting holds them, or `null` when it does not hold all of
 * them as numbers: a photo is never judged by a limit somebody guessed.
 */
export function imageLimitsOf(setting: unknown): ImageLimits | null {
  if (typeof setting !== "object" || setting === null || Array.isArray(setting)) return null;
  const given = setting as Record<string, unknown>;
  const limits: Partial<Record<keyof ImageLimits, number>> = {};
  for (const [limit, name] of Object.entries(IMAGE_LIMIT_NAMES) as [keyof ImageLimits, string][]) {
    const value = given[name];
    if (!positive(value)) return null;
    limits[limit] = value;
  }
  return limits as ImageLimits;
}

/**
 * What keeps a photo from being read, by the limits given: none when it can
 * be. The order is the one a person fixes them in: first what makes another
 * photo necessary whatever else is right. A photo too dark or too bright is
 * said as that, and not as flat too: one reason, the one the person can act on.
 *
 * How dark its ink is, is asked only of a photo that is crisp, or of one with
 * no edge at all (a blank page, read by its whole frame). A photo a little
 * soft has greyed its thin strokes, and one out of focus has lost them: the
 * first is not called burnt or flat for that, and the second is told what is
 * wrong with it, which is its focus.
 */
export function imageProblems(measure: ImageMeasure, limits: ImageLimits): ImageProblem[] {
  const problems: ImageProblem[] = [];
  if (Math.max(measure.width, measure.height) < limits.minLongSide) problems.push("too_small");
  if (measure.sharpness < limits.minSharpness) problems.push("blurry");
  if (measure.highlight < limits.minHighlight) problems.push("too_dark");
  else if (measure.sharpness >= limits.crispSharpness || measure.sharpness === 0) {
    if (measure.shadow > limits.maxShadow) problems.push("too_bright");
    else if (measure.highlight - measure.shadow < limits.minRange) problems.push("flat");
  }
  return problems;
}

/** What is kept of a photo's measure beside its document. */
export interface ImageRecord extends ImageMeasure {
  rule: string;
  /** What keeps the photo from being read, by the limits below: none when it can be. */
  problems: ImageProblem[];
  /** The limits the measure was read against, as the setting names them. */
  limits: Record<string, number>;
}

/**
 * A measure read against the setting of its kind of document: what is kept
 * of it. `null` for a setting that does not hold every limit as a number:
 * nothing is said of a photo then and nothing is kept, so that it is measured
 * once the setting is whole. The rule measures and a person decides: it never
 * says a photo is refused, only what would make another one better.
 */
export function judgeImage(measure: ImageMeasure, setting: unknown): ImageRecord | null {
  const limits = imageLimitsOf(setting);
  if (!limits) return null;
  return {
    rule: IMAGE_QUALITY_RULE,
    width: measure.width,
    height: measure.height,
    sharpness: measure.sharpness,
    shadow: measure.shadow,
    highlight: measure.highlight,
    problems: imageProblems(measure, limits),
    limits: Object.fromEntries(
      (Object.entries(IMAGE_LIMIT_NAMES) as [keyof ImageLimits, string][]).map(([limit, name]) => [name, limits[limit]]),
    ),
  };
}
