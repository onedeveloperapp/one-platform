# @flyee/documents

The firm's files and the documents ONE issues.

What lives here, each over a store interface where it keeps anything, so that the package never holds a database or a storage client:

- **What a file is and what it weighs** (`detect.ts`, `measure.ts`): the type its first bytes say, never the name or the type a browser declared; its SHA-256, its size, the pages of a PDF. The backend measures every upload before keeping it (`confirm_file`, migration `0018_files_documents`).
- **Issuing a document** (`issue.ts`, `codes.ts`, `stamp.ts`): a version with a public code, issued once per request, by one renderer at a time, with the hash of its bytes. Anyone holding the document checks the code at `/verificar/<code>`.
- **Normalizing for the court systems** (`normalize.ts`): a photo becomes a PDF page, a PDF too large for one upload is split at page boundaries, the images of a scan are compressed again.
- **Measuring how well a photo can be read** (`quality.ts`): a rule, not a judgement, so that whoever took a photo nobody will read is told while they still have the paper in hand.
- **A document signed for a court** (`cms.ts`): the attached `.p7s` the Projudi of TJGO takes, built around a signature made elsewhere (a lawyer's certificate in the cloud, `@flyee/psc`).
- **When a photo says it was taken** (`taken.ts`, `@flyee/documents/taken`): the `DateTimeOriginal` (else the `DateTimeDigitized`) its camera wrote in the EXIF, with the `OffsetTimeOriginal` when it wrote one, read by a small parser of the TIFF block (`takenAtOfExif`) over what sharp gives (`photoTakenAt`). The device's own clock, as the device was set: the evidence kit (migration `0209_evidence_moments`) shows it beside the moment ONE received the file, never in its place, and a photo with no EXIF (one sent through WhatsApp, a screenshot) says nothing.

## Files of a firm

Every file lives in the private bucket `firm-files`, under `org/<org_id>/<purpose>/<file id>`. No session reads or writes the bucket:

1. A person reserves an upload (`reserve_file_upload`, which checks the type and the size the setting allows for the purpose).
2. The backend mints a signed upload URL for the reserved path, and the browser sends the bytes straight to storage (a request to a function carries at most 4.5 MB).
3. The backend measures what arrived and keeps it or rejects it (`confirm_file`): a page renamed to `.pdf` is rejected as what it is.
4. A download is a signed URL of a minute, minted after the person's session read the file's row: row-level security is what proves they belong to the firm.

What may be uploaded, and how large, is `platform_settings`, key `files`. The upkeep removes a reservation nobody used and the objects nothing keeps.

## Issuing a document

```ts
import { issueDocument } from "@flyee/documents/issue";
import { stampVerification } from "@flyee/documents/stamp";

const result = await issueDocument(
  { documents, files },
  { orgId, kind: "procuracao", title, idempotencyKey, requestedBy, verifyBaseUrl },
  async (context) => stampVerification(await renderBody(), { firm: firmName, ...context }),
);
```

The renderer is the caller's; this package decides nothing about the content. It gives the renderer what must be printed on the document (the code and the address) and `stampVerification` prints it at the foot of every page, with a QR code. A template leaves the last `STAMP_BAND` points of each page free.

- The same idempotency key is the same version: a retry renders and stores nothing a second time.
- A render that fails leaves nothing behind (no file, no object) and the draft stays, so a retry resumes the same version.
- A reissue names the version it replaces (`previousId`); one version follows another, and the verification of the old one says a newer one exists.
- A document is revoked by the firm (`revoke_document`), never deleted. The verification says so.
- The public verification shows the firm, the kind, the version, the dates and the hash. Never the title or the content.

## Taking a file back

A work that writes a file (an issued version, the PDF of a piece, the copy made of a photo, the signed PDF of an envelope, a part cut for a filing package) takes it back when the work does not come to be. `takeBackFile(files, fileId, storagePath)` (`files.ts`) is the one way: **the record first, the bytes only after the record was forgotten**.

A worker takes a file back when it believes nothing names it, and it may be wrong: the store's answer to the step that made the file somebody's document can get lost on the way. So the store is the one that knows. `FileStore.discard` rejects when the file was not forgotten (the store did not answer, or something names the file after all; `discard_file` answers `in_use` for a file any table names, migration `0029_drafts`), and the bytes of a file that is still on record are never removed. Bytes left with no record are the upkeep's to remove; a record left with no bytes would be a document nobody can open.

## A table

`writeTablePdf(document)` (`table-pdf.ts`) writes a list as a PDF to read or to print: A4 lying down, the title and what the list is on the first page, the titles of the columns repeated and each page numbered. Nothing of a row is cut: a cell wraps as far as it needs, a row stays whole on its page, and only a row taller than a page goes on over the next. It needs nothing of a server, so it runs in the person's browser; what the standard fonts write is in `pdf-text.ts`, apart from `text-pdf.ts`, which carries `sharp` and the verification mark. A letter outside Latin-1 keeps its base letter and what has no plain form reads "?" (`closestText`): a list is read, not signed, and a name is never shown shorter as if it were whole. 2,000 lines of the list of cases take about 2.5 seconds and 1 MB.

## A document of text

`renderTextPdf(document)` (`text-pdf.ts`) lays plain blocks (a title, headings, paragraphs, lists, pairs of a label and its value) on A4 pages with the standard fonts: what the dossier of a case and the approved piece of a lawsuit are made of. It decides nothing of the content, gives the same bytes for the same input, and leaves the foot of each page free for the verification mark.

- What people paste (curly quotes, the two dashes, the bullet, spaces that do not break) is written in its plain form; a character no standard font writes is left out, never an error.
- `producer` is what the file says made it: ONE for what ONE issues; the firm for a piece of its own that goes to a court, where nothing in the file names the platform (the approved piece carries no verification mark either: it is the firm's petition, not a document ONE issues).

## A document signed for a court

`prepareAttachedCms` and `attachedCms` (`cms.ts`) write a CMS (PKCS#7, RFC 5652) with the document inside it, signed by a signature made elsewhere: the key never reaches ONE. `prepareAttachedCms` answers the SHA-256 of what is signed (the DER of the signed attributes, tagged as a SET) and `assemble` writes the `.p7s` around the RAW signature (PKCS#1 v1.5) a PSC made over it, so several documents go to the PSC in one call. The signed attributes are contentType, messageDigest and signingCertificateV2 (the certificate the signature was made with, by its SHA-256, its issuer and serial: what ICP-Brasil's profiles ask for), in the order DER gives a SET OF, and signingTime only when a court's system asks for one, in whole seconds. A signature a PSC hands without its leading zeros gets them back, and one with a zero too many in front loses it. `readAttachedCms` reads back the document inside and whether the signature holds over it with the certificate the CMS carries (never its chain: the court's system checks that); the backend reads every `.p7s` back before using it.

- Projudi's manual asks for "um documento com extensão .p7s, já assinado com certificado digital" (read on 2026-10-14), one per document. The court's own signer writes the same shape with SHA-512 and contentType, signingTime and messageDigest; this one writes SHA-256 with signingCertificateV2. Whether Projudi takes it is confirmed at the test of the filing station.
- It is not a PAdES: no court asks for one to file, and a PAdES with ICP-Brasil's policy is another document (the policy's identifier, no signingTime).

## How well a photo can be read

`quality.ts` is the rule `qualidade-da-imagem-v1`. It says nothing of what a photo shows (whether it is the right document, of the right person, is a person's or a model's to read): it measures, and what the measure is read against is data. It errs towards saying nothing: a photo it speaks against is one a person would take again too, and one it has nothing against may still be unreadable, which is what a person and the check of the document are for.

Everything it measures, but the photo's size, is read **at the edges that stand out of the picture**. So a photo in focus measures the same whether much or little is written on the page, in dark ink or faded, and whether the paper fills the frame or lies small on a table, on wood or on a woven cloth: a till receipt with three faded lines measures as a full page does.

- `measureImage(bytes)` reads the photo upright, on a grey copy with a fixed number of points (those of a page of 768 by 1,024, of the photo's own shape, so that a long receipt is not measured on a sliver), and answers its sides, its **sharpness** and the light of its edges. `null` for what this build reads no image of (a format with no decoder, a damaged file): what cannot be measured is never said good or bad.
  - **Sharpness** is how steep the edges are. At each point the *slope* is the light of the next point less the light of the one before, and the *bend* is how much the point's own light differs from the mean of those two: at a clean edge the bend is as large as the slope, and the softer the edge, the smaller its bend for the same slope. So the squared bends over the squared slopes, summed over the edges, say how steep they are, whatever their number and their contrast: 200 and more for print in focus, about 100 for a photo a little soft, under 30 for one out of focus. It is read along each way, across and down, and the softer way is the one kept.
  - Which points are an edge's is the picture's own to say: the ones at least a quarter as steep as its steepest (so a soft background does not count against a sharp page) and at least seven times its typical slope (so grain is not read as edges), each with its two neighbours along the way (an edge is read whole: its middle is its steepest point and bends the least). The grain of a sensor, which is the same all over the picture, is in the points of an edge too and is taken off them; the weave of a cloth that is under part of the picture is not, since the paper lying on it is smooth.
  - Where grain, a weave, a pattern or a blur is all over the picture, nothing stands out of it by its slope. What bends far more than the rest is then what is read: a paper in focus on a cloth with a smooth pattern, whose soft waves slope more than the thin strokes of a small receipt and bend far less. When nothing bends so, the whole of the picture is read, by its typical bend for its typical slope: a weave or grain in focus is as steep as edges are, and nothing is said; a page far out of focus is smooth all over, and blurry. A picture with no edge at all (a blank page) has a sharpness of 0, and only such a picture has.
  - **Shadow** and **highlight** are the light of the two sides of the edges: the ink and the paper. For each edge, the darkest and the lightest point within reach of it are looked for on a finer copy (four times the points), where a stroke thinner than a point of the measured copy is still ink; the darker quarter of the dark sides and the lighter quarter of the light ones are the ones read. A picture with no edge to read has the light of its whole frame (what one point in two hundred stays under, and goes over).
- `imageProblems(measure, limits)` says what keeps the photo from being read, each once, in the order a person fixes them: `too_small`, when its longer side has too few pixels (a strip, a long receipt or a screen cut to its top, is not small for being narrow); `blurry`, when the sharpness is under its limit; then `too_dark` (even the light side of its edges is dark: a page photographed in the dark; a screen in a dark theme is not, its letters are light), or, only of a photo that is crisp or has no edge at all, `too_bright` (even the dark side of its edges is light: burnt by a flash; or a blank page) or `flat` (the two sides are too close to tell letters from paper). A photo a little soft has greyed its thin strokes: it is not called burnt or flat for that.
- `judgeImage(measure, setting)` answers what is kept beside the document (the rule's version, the measure, the problems, the limits it was read against), or `null` for a setting that does not hold every limit as a number: nothing is said of a photo then, and nothing is kept, so that it is measured once the setting is whole.

The limits live in the setting `document_quality` (migration `0024_document_checks`), with the kinds of document whose photo is measured, under the names of `IMAGE_LIMIT_NAMES`. Where they start: a longer side of 1,000 pixels, a sharpness of 30, a sharpness of 150 from which a photo is crisp, a light side of 90 at least, a dark side of 200 at most, 40 between the two.

### The table behind the limits

The rule is tried on pictures that are drawn (`quality.fixtures.ts`), so that they are the same on every machine and nobody's document is in a fixture: pages of "text" (short strokes, upright and lying, in lines), screens with little on them, what a page carries besides text and what it lies on, and what happens to a photo on its way. `npm run quality -w @flyee/documents` prints what the rule measures of each and what it would say by the limits above. Some of its lines (a page of 1,500 by 2,000 pixels unless said):

| Picture | Sharpness | Dark side | Light side | The rule says |
| --- | --- | --- | --- | --- |
| A full page | 233 | 13 | 255 | nothing |
| The same page from a camera of 12 MP | 241 | 1 | 255 | nothing |
| A full page in fine print | 456 | 13 | 255 | nothing |
| A page with a fifth of its lines | 232 | 14 | 255 | nothing |
| A page of two lines | 238 | 13 | 255 | nothing |
| A slip of one line | 241 | 13 | 255 | nothing |
| A faded receipt with a fifth of its lines (ink 130 on paper 210) | 245 | 125 | 216 | nothing |
| A receipt faded further (ink 160 on paper 205) | 244 | 156 | 209 | nothing |
| A receipt all but gone (ink 180 on paper 205) | 241 | 177 | 208 | flat |
| A screen with little text in grey | 229 | 112 | 255 | nothing |
| A screen in a dark theme, two lines | 210 | 16 | 242 | nothing |
| A page with a barcode | 241 | 14 | 255 | nothing |
| A ruled form with very faint writing | 240 | 31 | 255 | nothing |
| A small receipt in faded ink on a light table (12 MP, a third of the width) | 386 | 123 | 221 | nothing |
| The same receipt in dark ink, a little soft (sigma 4) | 81 | 157 | 255 | nothing |
| A faded receipt on a woven cloth | 432 | 114 | 223 | nothing |
| A faded receipt on a coarse cloth (nothing stands out of the weave) | 581 | 43 | 231 | nothing |
| A small receipt in faded ink on a cloth of smooth waves (12 MP) | 576 | 123 | 221 | nothing |
| The same, out of focus (sigma 12) | 0 | 186 | 211 | blurry, flat |
| Out of focus, a little (sigma 1.2) | 135 | 19 | 255 | nothing |
| Out of focus (sigma 2.5) | 54 | 68 | 255 | nothing |
| Out of focus (sigma 4) | 20 | 114 | 255 | blurry |
| A fifth of its lines, out of focus (sigma 4) | 21 | 115 | 255 | blurry |
| 12 MP, out of focus (sigma 6) | 42 | 92 | 255 | nothing |
| 12 MP, out of focus (sigma 12) | 7 | 153 | 253 | blurry |
| Out of focus (sigma 5), with grain | 14 | 125 | 255 | blurry |
| Sharp, with heavy grain | 235 | 0 | 255 | nothing |
| Shaken across, 25 pixels | 79 | 85 | 255 | nothing |
| Shaken down, 25 pixels | 23 | 66 | 255 | blurry |
| In the dark (a quarter of its light) | 241 | 0 | 68 | too dark |
| In dim light (half of its light) | 240 | 2 | 134 | nothing |
| Burnt by a flash | 236 | 214 | 255 | too bright |
| Fogged | 236 | 123 | 153 | flat |
| A blank page | 0 | 251 | 251 | blurry, too bright |
| A page burnt by a flash, on a dark table | 214 | 37 | 253 | nothing |
| A page out of focus (sigma 6) laid on a cloth in focus | 315 | 43 | 255 | nothing |
| 420 by 560 pixels | 363 | 10 | 255 | too small |
| A strip: a screen cut to 1,170 by 340 pixels | 400 | 21 | 255 | nothing |

The pictures are not photos: they are crisper than a camera's. What the table says of the rule is which way each thing moves its measure and by how much; where the limits sit for what people really send is learned from the measure kept beside each document a client sent, which is why a measure is kept also for a photo with nothing against it.

### What the rule does not see

- A shaken photo is seen only where the shake softened its edges. A hand that moved at an even pace leaves thin strokes fainter and wider with ends as clean as before: across 25 pixels of a 3-megapixel photo, or aslant, the rule says nothing. The check of the document, which reads the page, is what sees it.
- The same blur is told the same of large print and of small, which stops being read sooner.
- The edges read are the picture's steepest. Around a page burnt by a flash on a dark table, the edge of the table is all that stands out, and answers for the page; a page out of focus laid on a cloth in focus is answered for by the weave; a small faint paper out of focus, by the edge of the paper.
- A small paper in faded hairline print that is a little soft may be called flat or burnt: the edge of the paper is crisp, and its print is greyed.
- A cloth with a smooth pattern and nothing on it reads soft: its waves are, and there is nothing in focus to tell it by.
- Grain hides a blur that is all over the picture: on a dense page out of focus nothing stands out of the blur, and the grain makes it read rough. Heavy grain does on any page; a grain of 4 levels is enough on a dense page of 3 megapixels, and one of 5 at 12 megapixels. A file stored with very little quality does the same.
- A few dozen small sharp things in the frame (specks, the grain of a table) answer for a page out of focus, as a cloth in focus does.
- How dark the ink is, is asked only of a crisp photo: one burnt by a flash or fogged that is also a little soft is not called so.
- A page small in the middle of a picture has edges as clean as any, though nobody reads it at that size.
- A receipt whose ink is all but gone is flat, as a fogged photo is: the rule cannot tell the two, and the person who has the paper can.

So the rule never refuses a photo: whoever sent it is told what was measured and takes another or sends it all the same, and the firm reads the photo beside its measure.

## Normalization: the technical test of M1

The question was whether normalization can run inside a function (`pdf-lib` and `sharp`) or needs a worker in a container with Ghostscript or qpdf. `npm run bench -w @flyee/documents` builds inputs of real size and measures each operation.

Measured on 2026-10-08 (Node 24, sharp 0.34.5, libvips 8.17.3, one development machine):

| Operation | Input | Time | Peak memory | Result |
| --- | --- | --- | --- | --- |
| Photos to one PDF (A4 at 200 dpi, quality 72) | 10 photos of 12 MP, 20 MB | 3.8 s | 165 MB | 2.6 MB |
| Split at 6 MB | a scan of 40 pages at 300 dpi, 49 MB | 0.4 s | 310 MB | 10 parts, the largest 4.9 MB |
| Split at 11 MB | the same | 0.3 s | 330 MB | 5 parts |
| Compress the images again (200 dpi, quality 60) | the same | 10.3 s | 303 MB | 6.6 MB, 87% smaller |
| Compress the images again (150 dpi, quality 50) | the same | 6.0 s | 290 MB | 2.0 MB |
| Compress one page scanned at 600 dpi | 9.8 MB | 0.5 s | 315 MB | under 1 MB |

A Vercel function has 2 GB of memory and 300 seconds on the Hobby plan (4 GB and 800 seconds on Pro; the limits page of its documentation, read on 2026-10-08). The heaviest case used a sixth of the memory and a thirtieth of the time, and a slower processor does not change the order of magnitude.

**Decision: normalization runs in the function.** No container worker is built for M2.

What the test does not cover, and what tells when the decision must be revisited:

- **Only JPEG images are compressed again.** A scan stored without loss (Flate), in JBIG2 or in JPEG 2000 comes back as it is, counted in `untouched`. The black-and-white kinds are already small; a lossless colour scan is the one case that can stay large.
- **A page that alone exceeds a limit after compression** is named in `oversized` by the split. Nothing here can rasterize a page: the answer today is asking for the file again. If the pilot's real files show such pages often, that is the case for the container worker (Ghostscript rasterizes anything), triggered by an event, outside Vercel.
- **A PDF protected by a password** (encrypted, whether or not it opens without one) is not opened: its pages are not counted (`countPdfPages` answers null, and so `files.pages` stays empty), since a page copied out of it would come out garbled. A filing package names it as a document that cannot go (`@flyee/courts/filing`, `unreadable`).
- A step of the Inngest route runs with `maxDuration = 60`. Since M2 S5 the app normalizes each photo a client or the firm sends to a case in a step of its own (`one-case-documents`, one document per step, `apps/web/src/lib/cases/documents-work.ts`): one photo into a one-page PDF is well inside it. A HEIC photo depends on the build of `sharp` the function runs: when it has no decoder, the document is recorded as not normalized (`image_unreadable`) and waits for a person as before.

The limits per court system (6 MB at the Projudi of the TJGO for files of 30 pages or more, 11 MB at the eproc of the TJSP) come from the table of court systems, never from this package.

## Tests

`npm test -w @flyee/documents`: detection, codes, measure, the issue flow against the fakes, the verification mark, the three normalizations on small inputs, and the rule of a photo's quality on pictures the tests draw (`quality.fixtures.ts`: sharp with much or little on it, faded, a small receipt on a table, out of focus, shaken, grainy, dark, burnt, fogged, small, a strip, lying on its side, with a barcode or rules, on wood, on a coarse or a woven cloth, on a cloth of smooth waves), with what the rule is known not to see. No database, no storage, no network. The database side is `packages/db/tests/0022_files_documents.test.sql`.
