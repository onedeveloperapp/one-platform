import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { generateVerifyCode } from "./code-generator.ts";
import { formatVerifyCode, normalizeVerifyCode, verifyUrlFor } from "./codes.ts";
import { detectMime } from "./detect.ts";
import { FakeDocumentStore, FakeFileStore } from "./fake.ts";
import { takeBackFile } from "./files.ts";
import { issueDocument, type IssueInput } from "./issue.ts";
import { measureFile } from "./measure.ts";
import { stampVerification } from "./stamp.ts";
import type { DocumentStore } from "./types.ts";

const bytesOf = (...values: (number | string)[]): Uint8Array =>
  Uint8Array.from(values.flatMap((value) => (typeof value === "string" ? [...value].map((char) => char.charCodeAt(0)) : [value])));

async function smallPdf(pages = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([595.28, 841.89]).drawText(`Pagina ${index + 1}`, { x: 60, y: 760 });
  return pdf.save();
}

test("a file is what its first bytes say, whatever it is called", () => {
  assert.equal(detectMime(bytesOf("%PDF-1.7\n")), "application/pdf");
  assert.equal(detectMime(bytesOf(0xef, 0xbb, 0xbf, "\n%PDF-1.4")), "application/pdf");
  assert.equal(detectMime(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "image/jpeg");
  assert.equal(detectMime(bytesOf(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  assert.equal(detectMime(bytesOf("RIFF", 0, 0, 0, 0, "WEBPVP8 ")), "image/webp");
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftypheic", 0, 0)), "image/heic");
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftypmif1", 0, 0)), "image/heif");
  // A page saved as `.pdf`, a program, nothing at all: none of them is kept.
  assert.equal(detectMime(bytesOf("<!doctype html><html>")), null);
  assert.equal(detectMime(bytesOf("MZ", 0x90, 0, 3, 0, 0, 0)), null);
  // Nor a page that carries the header of a PDF further down, to pass for one.
  assert.equal(detectMime(bytesOf("<html><script>alert(1)</script>", 0x0a, "%PDF-1.7", 0x0a)), null);
  // Blank space before the header is still a PDF.
  assert.equal(detectMime(bytesOf(0x0d, 0x0a, " ", "%PDF-1.7")), "application/pdf");
  assert.equal(detectMime(new Uint8Array()), null);
});

test("a Word document is told by the parts its package holds, never by its name", () => {
  const part = (name: string) => [0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0, name, 0, 0, "<xml/>"];
  // As a word processor writes it: the list of the package's types, then the text itself.
  assert.equal(
    detectMime(bytesOf(...part("[Content_Types].xml"), ...part("_rels/.rels"), ...part("word/document.xml"))),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  // A spreadsheet or a presentation is the same kind of package with other parts.
  assert.equal(detectMime(bytesOf(...part("[Content_Types].xml"), ...part("xl/workbook.xml"))), null);
  assert.equal(detectMime(bytesOf(...part("[Content_Types].xml"), ...part("ppt/presentation.xml"))), null);
  // A ZIP that only names the text, with no list of types, is no Word document; nor is the text's name alone.
  assert.equal(detectMime(bytesOf(...part("word/document.xml"))), null);
  assert.equal(detectMime(bytesOf("[Content_Types].xml word/document.xml")), null);
  // An old .doc, or a Word document protected by a password: a compound file, no ZIP.
  assert.equal(detectMime(bytesOf(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, "word/document.xml")), null);
});

test("what a messaging app carries is named too: a voice message, a recording, a video", () => {
  // Naming a type keeps nothing by itself: each purpose lists what it accepts
  // (`platform_settings.files`), and an upload of a person lists no sound and no video.
  assert.equal(detectMime(bytesOf("OggS", 0, 2, 0, 0)), "audio/ogg");
  assert.equal(detectMime(bytesOf("#!AMR", 0x0a)), "audio/amr");
  assert.equal(detectMime(bytesOf("ID3", 4, 0, 0)), "audio/mpeg");
  assert.equal(detectMime(bytesOf(0xff, 0xfb, 0x90, 0x64)), "audio/mpeg");
  assert.equal(detectMime(bytesOf(0xff, 0xf1, 0x50, 0x80)), "audio/aac");
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftypM4A ", 0, 0)), "audio/mp4");
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftypisom", 0, 0)), "video/mp4");
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftypmp42", 0, 0)), "video/mp4");
  // A recorder that writes sound alone under a general brand: its one track says it is an audio.
  const handler = (type: string) => bytesOf(0, 0, 0, 0x21, "hdlr", 0, 0, 0, 0, 0, 0, 0, 0, type, 0, 0);
  const general = bytesOf(0, 0, 0, 0x18, "ftypmp42", 0, 0, 0, 0, "isommp42");
  const joined = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
  assert.equal(detectMime(joined(general, handler("soun"))), "audio/mp4");
  assert.equal(detectMime(joined(general, handler("soun"), handler("vide"))), "video/mp4");
  assert.equal(detectMime(joined(general, handler("vide"))), "video/mp4");
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftyp3gp4", 0, 0)), "video/3gpp");
  // A container of a brand nobody listed is still nothing, and a photo is never taken for sound.
  assert.equal(detectMime(bytesOf(0, 0, 0, 0x18, "ftypqt  ", 0, 0)), null);
  assert.equal(detectMime(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "image/jpeg");
  assert.equal(detectMime(bytesOf(0xff, 0x00, 0x00)), null);
});

test("a verification code reads the same on paper as on screen, and one typed wrong finds nothing", () => {
  const codes = new Set(Array.from({ length: 300 }, () => generateVerifyCode()));
  assert.equal(codes.size, 300);
  for (const code of codes) assert.match(code, /^[A-HJ-KMNP-Z2-9]{12}$/);

  assert.equal(normalizeVerifyCode(" abcd-efgh jkmn "), "ABCDEFGHJKMN");
  assert.equal(formatVerifyCode("ABCDEFGHJKMN"), "ABCD-EFGH-JKMN");
  // 0, O, 1, I and L are not in the alphabet: a code with one is not a code.
  for (const wrong of ["ABCDEFGHJKM0", "ABCDEFGHJKMO", "ABCDEFGHJKM1", "ABCDEFGHJKMI", "ABCDEFGHJKML", "ABC", "", null]) {
    assert.equal(normalizeVerifyCode(wrong), null, String(wrong));
  }
  assert.equal(verifyUrlFor("https://one.example/", "ABCDEFGHJKMN"), "https://one.example/verificar/ABCDEFGHJKMN");
});

test("the measure of a file: its hash, its size, what it is, and the pages of a PDF", async () => {
  const pdf = await smallPdf(2);
  const measured = await measureFile(pdf);
  assert.match(measured.sha256, /^[0-9a-f]{64}$/);
  assert.equal(measured.bytes, pdf.byteLength);
  assert.equal(measured.detectedMime, "application/pdf");
  assert.equal(measured.pages, 2);
  assert.equal((await measureFile(pdf)).sha256, measured.sha256);

  const photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#888" } }).jpeg().toBuffer();
  assert.deepEqual({ ...(await measureFile(photo)), sha256: "", bytes: 0 }, { sha256: "", bytes: 0, detectedMime: "image/jpeg", pages: null });

  // It says it is a PDF and cannot be read: kept as a PDF, with no pages.
  const damaged = await measureFile(bytesOf("%PDF-1.7\nnada que se leia"));
  assert.equal(damaged.detectedMime, "application/pdf");
  assert.equal(damaged.pages, null);

  // A protected PDF says so in its trailer (`/Encrypt`). Its structure may still be read, and its
  // pages even counted, but what is in them is not: it is kept as a PDF with no pages, so that
  // nothing cuts it or sends it on as if it could be read.
  const plain = await (await PDFDocument.load(pdf)).save({ useObjectStreams: false });
  const text = Buffer.from(plain).toString("latin1");
  const at = text.lastIndexOf("trailer");
  assert.ok(at > 0, "the PDF was saved with a plain trailer");
  const marked = Buffer.from(text.slice(0, at) + text.slice(at).replace("<<", "<< /Encrypt 1 0 R"), "latin1");
  assert.equal((await measureFile(new Uint8Array(marked))).detectedMime, "application/pdf");
  assert.equal((await measureFile(new Uint8Array(marked))).pages, null);
  assert.equal((await measureFile(plain)).pages, 2);
});

const INPUT: IssueInput = {
  orgId: "firm-a",
  kind: "procuracao",
  title: "Procuração de Maria Teste",
  idempotencyKey: "pedido-0001",
  requestedBy: "carla",
  verifyBaseUrl: "https://one.example",
};

function setup() {
  const files = new FakeFileStore();
  const documents = new FakeDocumentStore(files);
  let tokens = 0;
  let codes = 0;
  const alphabet = ["ABCDEFGHJKMN", "BCDEFGHJKMNP", "CDEFGHJKMNPQ", "DEFGHJKMNPQR"];
  const deps = {
    documents,
    files,
    newClaimToken: () => `claim-${(tokens += 1)}`,
    newVerifyCode: () => alphabet[(codes += 1) - 1] ?? generateVerifyCode(),
  };
  return { files, documents, deps };
}

test("a document is issued as a version with a code, its file kept with the hash of its bytes", async () => {
  const { files, documents, deps } = setup();
  let rendered = 0;
  const result = await issueDocument(deps, INPUT, async (context) => {
    rendered += 1;
    assert.equal(context.verifyUrl, "https://one.example/verificar/ABCDEFGHJKMN");
    return stampVerification(await smallPdf(), { firm: "Souza Advogados", ...context });
  });

  assert.deepEqual(result, {
    kind: "issued",
    documentId: "document-1",
    version: 1,
    verifyCode: "ABCDEFGHJKMN",
    verifyUrl: "https://one.example/verificar/ABCDEFGHJKMN",
    replayed: false,
  });
  const document = documents.documents.get("document-1");
  assert.equal(document?.status, "issued");
  const file = files.files.get(document?.fileId ?? "");
  assert.equal(file?.status, "stored");
  assert.equal(file?.storagePath, "org/firm-a/issued/file-1");
  assert.equal(file?.name, "procuracao-v1.pdf");
  const kept = files.objects.get("org/firm-a/issued/file-1");
  assert.ok(kept);
  assert.equal((await measureFile(kept)).sha256, file?.measure?.sha256);

  // The same request again is the same version: nothing is rendered or stored twice.
  const again = await issueDocument(deps, INPUT, async () => {
    rendered += 1;
    return smallPdf();
  });
  assert.equal(again.kind === "issued" && again.replayed, true);
  assert.equal(again.kind === "issued" && again.verifyCode, "ABCDEFGHJKMN");
  assert.equal(rendered, 1);
  assert.equal(files.files.size, 1);
});

test("a render that fails leaves nothing behind, and a retry resumes the same version", async () => {
  const { files, documents, deps } = setup();
  const broke = await issueDocument(deps, INPUT, async () => {
    throw new Error("o modelo do documento falhou com dados de Maria Teste");
  });
  // A code, never the exception's text: it may carry what the document says.
  assert.deepEqual(broke, { kind: "failed", documentId: "document-1", code: "render_failed" });

  const notPdf = await issueDocument(deps, INPUT, async () => bytesOf("<html>isto não é um PDF</html>"));
  assert.deepEqual(notPdf, { kind: "failed", documentId: "document-1", code: "not_a_pdf" });
  assert.equal(files.objects.size, 0);
  assert.equal(files.files.size, 0);
  assert.equal(documents.documents.get("document-1")?.status, "draft");

  const retry = await issueDocument(deps, INPUT, async () => smallPdf());
  assert.equal(retry.kind === "issued" && retry.version, 1);
  assert.equal(retry.kind === "issued" && retry.documentId, "document-1");
  assert.equal(documents.documents.size, 1);
});

test("a publish whose answer got lost on the way leaves the issued version its file", async () => {
  const { files, documents, deps } = setup();
  // The store publishes the version, and its answer never arrives.
  const lossy: DocumentStore = {
    reserve: (input) => documents.reserve(input),
    claim: (documentId, claimToken) => documents.claim(documentId, claimToken),
    publish: async (documentId, claimToken, fileId) => {
      await documents.publish(documentId, claimToken, fileId);
      throw new Error("the answer got lost on the way");
    },
    release: (documentId, claimToken) => documents.release(documentId, claimToken),
  };
  const lost = await issueDocument({ ...deps, documents: lossy }, INPUT, async () => smallPdf());
  // The worker cannot tell: it says the issue failed, and takes back what it believes is nobody's.
  assert.equal(lost.kind, "failed");
  // The store knew better: the version is issued, its file is on record and its bytes are where they were.
  const document = documents.documents.get("document-1");
  assert.equal(document?.status, "issued");
  const file = files.files.get(document?.fileId ?? "");
  assert.equal(file?.status, "stored");
  assert.ok(files.objects.get(file?.storagePath ?? ""));

  // The same request again finds the version it issued, and writes nothing more.
  const again = await issueDocument(deps, INPUT, async () => smallPdf());
  assert.equal(again.kind === "issued" && again.replayed, true);
  assert.equal(files.files.size, 1);
  assert.equal(files.objects.size, 1);
});

test("a file is taken back record first: bytes are never removed from under a record that stays", async () => {
  const files = new FakeFileStore();
  const reserve = () => files.reserve({ orgId: "firm-a", purpose: "issued", name: "x.pdf", mime: "application/pdf", bytes: 4 });
  const nobodys = await reserve();
  const somebodys = await reserve();
  assert.ok(nobodys.ok && somebodys.ok);
  await files.put(nobodys.storagePath, bytesOf("%PDF"));
  await files.put(somebodys.storagePath, bytesOf("%PDF"));
  files.named.add(somebodys.fileId);

  assert.equal(await takeBackFile(files, nobodys.fileId, nobodys.storagePath), true);
  assert.equal(files.files.has(nobodys.fileId), false);
  assert.equal(files.objects.has(nobodys.storagePath), false);

  assert.equal(await takeBackFile(files, somebodys.fileId, somebodys.storagePath), false);
  assert.equal(files.files.has(somebodys.fileId), true);
  assert.equal(files.objects.has(somebodys.storagePath), true);

  // A store that does not answer is not a store that forgot: the bytes stay too.
  const silent = Object.assign(Object.create(files) as FakeFileStore, {
    discard: async () => {
      throw new Error("the store did not answer");
    },
  });
  const third = await reserve();
  assert.ok(third.ok);
  await files.put(third.storagePath, bytesOf("%PDF"));
  assert.equal(await takeBackFile(silent, third.fileId, third.storagePath), false);
  assert.equal(files.objects.has(third.storagePath), true);
});

test("one renderer at a time: a second request finds the draft busy", async () => {
  const { documents, deps } = setup();
  let inner: unknown;
  const outer = await issueDocument(deps, INPUT, async () => {
    inner = await issueDocument(deps, INPUT, async () => smallPdf());
    return smallPdf();
  });
  assert.deepEqual(inner, { kind: "failed", documentId: "document-1", code: "busy" });
  assert.equal(outer.kind, "issued");
  assert.equal(documents.documents.size, 1);
});

test("a reissue is the next version of one issued version, and only one follows it", async () => {
  const { deps } = setup();
  const first = await issueDocument(deps, INPUT, async () => smallPdf());
  assert.equal(first.kind, "issued");
  if (first.kind !== "issued") return;

  const second = await issueDocument(
    deps,
    { ...INPUT, idempotencyKey: "pedido-0002", previousId: first.documentId },
    async () => smallPdf(),
  );
  assert.equal(second.kind === "issued" && second.version, 2);
  assert.equal(second.kind === "issued" && second.verifyCode, "BCDEFGHJKMNP");

  const third = await issueDocument(
    deps,
    { ...INPUT, idempotencyKey: "pedido-0003", previousId: first.documentId },
    async () => smallPdf(),
  );
  assert.deepEqual(third, { kind: "refused", code: "previous_already_followed" });

  const otherKind = await issueDocument(
    deps,
    { ...INPUT, kind: "contrato", idempotencyKey: "pedido-0004", previousId: first.documentId },
    async () => smallPdf(),
  );
  assert.deepEqual(otherKind, { kind: "refused", code: "previous_not_found" });
});

test("a version the firm revoked is not handed back as issued", async () => {
  const { documents, deps } = setup();
  const first = await issueDocument(deps, INPUT, async () => smallPdf());
  assert.equal(first.kind, "issued");
  documents.revoke("document-1");
  assert.deepEqual(await issueDocument(deps, INPUT, async () => smallPdf()), { kind: "refused", code: "revoked" });
});

test("the verification mark goes on every page and survives a name the PDF fonts cannot write", async () => {
  const plain = await smallPdf(3);
  const stamped = await stampVerification(plain, {
    firm: "Souza & Associados 🚀 Advocacia",
    verifyCode: "ABCDEFGHJKMN",
    verifyUrl: "https://one.example/verificar/ABCDEFGHJKMN",
  });
  assert.equal(detectMime(stamped), "application/pdf");
  assert.ok(stamped.byteLength > plain.byteLength);
  const reopened = await PDFDocument.load(stamped);
  assert.equal(reopened.getPageCount(), 3);
  // The QR is embedded once and drawn on each page.
  const images = reopened.context.enumerateIndirectObjects().filter(([, object]) => String(object).includes("/Subtype /Image"));
  assert.equal(images.length, 1);
});
