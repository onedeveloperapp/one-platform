import { photoTakenAt, takenAtOfExif } from "./taken.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

const photo = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#7a8a9a" } });

/** A big-endian TIFF block written by hand: IFD0 with the pointer to the EXIF IFD, which holds the given tags. */
function tiffBlock(tags: { tag: number; text: string }[]): Uint8Array {
  const out: number[] = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8];
  const u16 = (value: number) => out.push((value >> 8) & 0xff, value & 0xff);
  const u32 = (value: number) => out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  // IFD0 at 8: one entry, the EXIF pointer, then no next IFD.
  u16(1);
  u16(0x8769);
  u16(4);
  u32(1);
  const exifAt = 8 + 2 + 12 + 4;
  u32(exifAt);
  u32(0);
  // The EXIF IFD: its entries, then the texts after it.
  const textsAt = exifAt + 2 + tags.length * 12 + 4;
  let cursor = textsAt;
  u16(tags.length);
  const texts: number[] = [];
  for (const { tag, text } of tags) {
    const bytes = [...Buffer.from(text, "ascii"), 0];
    u16(tag);
    u16(2);
    u32(bytes.length);
    if (bytes.length <= 4) {
      out.push(...bytes, ...new Array(4 - bytes.length).fill(0));
    } else {
      u32(cursor);
      texts.push(...bytes);
      cursor += bytes.length;
    }
  }
  u32(0);
  out.push(...texts);
  return new Uint8Array(out);
}

test("reads when the photo was taken, with the device's offset, from a block written by hand", () => {
  const block = tiffBlock([
    { tag: 0x9003, text: "2099:10:22 14:35:10" },
    { tag: 0x9011, text: "-03:00" },
  ]);
  assert.deepEqual(takenAtOfExif(block), { local: "2099-10-22T14:35:10", offset: "-03:00" });
  // With the mark sharp gives the block.
  const marked = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...block]);
  assert.deepEqual(takenAtOfExif(marked), { local: "2099-10-22T14:35:10", offset: "-03:00" });
});

test("falls back to the moment it was digitized, and says nothing of a zeroed or impossible clock", () => {
  assert.deepEqual(takenAtOfExif(tiffBlock([{ tag: 0x9004, text: "2099:01:05 08:00:00" }])), {
    local: "2099-01-05T08:00:00",
    offset: null,
  });
  assert.equal(takenAtOfExif(tiffBlock([{ tag: 0x9003, text: "0000:00:00 00:00:00" }])), null);
  assert.equal(takenAtOfExif(tiffBlock([{ tag: 0x9003, text: "2099:02:30 10:00:00" }])), null);
  assert.equal(takenAtOfExif(tiffBlock([])), null);
  assert.equal(takenAtOfExif(new Uint8Array([1, 2, 3])), null);
  assert.equal(takenAtOfExif(null), null);
});

test("reads it from a real JPEG's EXIF, and nothing from a photo with none", async () => {
  const withMoment = await photo()
    .jpeg()
    .withExif({ IFD2: { DateTimeOriginal: "2099:10:22 14:35:10", OffsetTimeOriginal: "-03:00" } })
    .toBuffer();
  assert.deepEqual(await photoTakenAt(withMoment), { local: "2099-10-22T14:35:10", offset: "-03:00" });
  assert.equal(await photoTakenAt(await photo().jpeg().toBuffer()), null);
  assert.equal(await photoTakenAt(new Uint8Array([0x25, 0x50, 0x44, 0x46])), null);
});
