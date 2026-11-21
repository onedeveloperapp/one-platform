import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import {
  brandColorOf,
  contrast,
  drawsOnLight,
  INK,
  LOGO_BOX,
  PAPER,
  readHex,
  wordsOn,
} from "@flyee/documents/brand";
import { normalizeLogo } from "@flyee/documents/logo";

/** An image of `width` x `height` pixels, each given by `paint`. */
const pixels = (width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  }
  return data;
};

describe("the main colour of a logo", () => {
  it("is the most frequent colour that is no ground", () => {
    // A navy mark beside a little red, on white with a black word.
    const data = pixels(100, 50, (x, y) =>
      y < 10 ? [0, 0, 0, 255] : x < 60 ? [20, 40, 120, 255] : x < 70 ? [200, 30, 30, 255] : [255, 255, 255, 255],
    );
    const color = brandColorOf(data, 100, 50);
    assert.ok(color);
    const rgb = readHex(color)!;
    assert.ok(Math.abs(rgb.r - 20) <= 1 && Math.abs(rgb.g - 40) <= 1 && Math.abs(rgb.b - 120) <= 1, color);
  });

  it("leaves out what is see-through, and says none for a logo in black, white and grey", () => {
    const hidden = pixels(20, 20, () => [200, 30, 30, 10]);
    assert.equal(brandColorOf(hidden, 20, 20), null);
    const plain = pixels(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : x < 15 ? [128, 128, 128, 255] : [255, 255, 255, 255]));
    assert.equal(brandColorOf(plain, 20, 20), null);
  });
});

describe("the contrast", () => {
  it("measures it as WCAG does, and puts on a fill the words that read", () => {
    assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
    assert.equal(contrast("#777777", "#777777"), 1);
    assert.equal(wordsOn("#14287a"), PAPER);
    assert.equal(wordsOn("#f5d90a"), INK);
    assert.equal(drawsOnLight("#14287a"), true);
    assert.equal(drawsOnLight("#f5d90a"), false);
  });

  it("reads a colour only as #rrggbb", () => {
    assert.deepEqual(readHex("#0A1b2C"), { r: 10, g: 27, b: 44 });
    assert.equal(readHex("0a1b2c"), null);
    assert.equal(readHex("#abc"), null);
  });
});

describe("the logo ONE keeps", () => {
  it("fits the box, keeps the see-through ground, and gives its colour", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="600"><rect x="0" y="0" width="1200" height="600" fill="#1f6f3a"/></svg>`;
    const logo = await normalizeLogo(new Uint8Array(Buffer.from(svg)));
    assert.ok(logo.width <= LOGO_BOX.width && logo.height <= LOGO_BOX.height);
    assert.equal(logo.width, 800);
    const meta = await sharp(logo.png).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.hasAlpha, true);
    const rgb = readHex(logo.color)!;
    assert.ok(Math.abs(rgb.r - 0x1f) <= 2 && Math.abs(rgb.g - 0x6f) <= 2 && Math.abs(rgb.b - 0x3a) <= 2, logo.color ?? "");
  });
});
