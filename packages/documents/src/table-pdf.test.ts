import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFRawStream } from "pdf-lib";

import { closestText } from "./pdf-text.ts";
import { type TableCell, writeTablePdf } from "./table-pdf.ts";

/** The words drawn on each page, as a PDF's standard fonts write them: Latin-1, in hexadecimal. */
async function wordsOfPages(bytes: Uint8Array): Promise<string[][]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const stream = contents && "get" in contents ? contents.get(0) : contents;
    const resolved = stream instanceof PDFRawStream ? stream : pdf.context.lookup(stream as never);
    const raw = (resolved as PDFRawStream).getContents();
    const text = inflateSync(raw).toString("latin1");
    return [...text.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1"));
  });
}

const columns = [
  { title: "Caso", share: 1 },
  { title: "Cliente", share: 4 },
  { title: "Com quem está", share: 4 },
];

describe("a table as a PDF", () => {
  it("lies on an A4 page, with its title, what the list is and the titles of the columns", async () => {
    const bytes = await writeTablePdf({
      title: "Casos · Em andamento",
      facts: ["Lima Advocacia", "2 casos"],
      columns,
      rows: [
        [
          "1",
          "Ana Teste",
          [
            { text: "Com o cliente", strong: true },
            { text: "Falta a identidade", soft: true },
          ],
        ],
        ["2", "Bia Teste", null],
      ],
      author: "Lima Advocacia",
    });
    const pdf = await PDFDocument.load(bytes);
    const { width, height } = pdf.getPage(0).getSize();
    assert.ok(width > height, "the page lies down");
    assert.equal(Math.round(width), 842);
    assert.equal(pdf.getTitle(), "Casos · Em andamento");
    assert.equal(pdf.getAuthor(), "Lima Advocacia");
    const [words] = await wordsOfPages(bytes);
    for (const word of ["Casos · Em andamento", "Lima Advocacia", "2 casos", "Caso", "Cliente", "Com quem está"]) {
      assert.ok(words.includes(word), word);
    }
    for (const word of ["Ana Teste", "Com o cliente", "Falta a identidade", "Bia Teste", "1 / 1"]) {
      assert.ok(words.includes(word), word);
    }
  });

  it("repeats the titles of the columns on every page, says whose list it is and numbers the pages", async () => {
    const rows: TableCell[][] = Array.from({ length: 200 }, (_, index) => [
      String(index + 1),
      `Pessoa ${index + 1}`,
      null,
    ]);
    const pages = await wordsOfPages(await writeTablePdf({ title: "Casos", columns, rows }));
    assert.ok(pages.length > 1);
    pages.forEach((words, index) => {
      assert.ok(words.includes("Cliente"), `titles on page ${index + 1}`);
      assert.ok(words.includes(`${index + 1} / ${pages.length}`), `number on page ${index + 1}`);
      if (index > 0) assert.ok(words.includes("Casos"), `title on page ${index + 1}`);
    });
  });

  it("loses no row, each once and in order, however many pages they take", async () => {
    const rows: TableCell[][] = Array.from({ length: 2000 }, (_, index) => [
      String(index + 1),
      `Pessoa número ${index + 1}`,
      [
        { text: "Com o escritório", strong: true },
        { text: "Uma assinatura para conferir", soft: true },
      ],
    ]);
    const started = Date.now();
    const bytes = await writeTablePdf({ title: "Casos", columns, rows });
    const took = Date.now() - started;
    const people = (await wordsOfPages(bytes)).flat().filter((word) => word.startsWith("Pessoa número "));
    assert.deepEqual(
      people,
      rows.map((row) => row[1]),
    );
    // What a browser has to write for the longest list the setting allows: seconds, and a file that can be sent.
    assert.ok(took < 20_000, `took ${took} ms`);
    assert.ok(bytes.length < 3_000_000, `${bytes.length} bytes`);
  });

  it("wraps a long cell whole, and a row taller than a page goes on over the next", async () => {
    const long = Array.from({ length: 400 }, (_, index) => `palavra${index}`).join(" ");
    const pages = await wordsOfPages(await writeTablePdf({ title: "Casos", columns, rows: [["1", long, null]] }));
    assert.ok(pages.length > 1, "more than a page");
    const written = pages
      .flat()
      .filter((word) => word.includes("palavra"))
      .join(" ");
    assert.equal(written, long);
  });

  it("gives the same bytes for the same input", async () => {
    const input = { title: "Casos", columns, rows: [["1", "Ana", null]] as TableCell[][] };
    assert.deepEqual(await writeTablePdf(input), await writeTablePdf(input));
  });

  it("writes a name outside Latin-1 by its base letters, never shorter than it is", async () => {
    assert.equal(closestText("João Şahin Nguyễn"), "João Sahin Nguyen");
    assert.equal(closestText("Łukasz"), "?ukasz");
    assert.equal(closestText(`Ana${String.fromCodePoint(0x1f600)}`), "Ana?");
    assert.equal(closestText(`Ana${String.fromCodePoint(0x200b)}${String.fromCodePoint(1)}`), "Ana");
    const [words] = await wordsOfPages(await writeTablePdf({ title: "Casos", columns, rows: [["1", "Nguyễn", null]] }));
    assert.ok(words.includes("Nguyen"));
  });
});
