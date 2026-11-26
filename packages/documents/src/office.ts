import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * A Word document made a PDF by an office suite (the owner, 2026-11-25: the firm's letterhead in Word copied exactly,
 * never drawn again by ONE). The suite is LibreOffice, behind Gotenberg's API, on ONE's own server
 * (`apps/web/clock/compose.yml`): `gotenbergConverter` asks it over its network; `fakeConverter` stands in where no
 * server is at hand (a test, a machine with no `ONE_OFFICE_URL`), and draws a paper of two pages of its own.
 *
 * Gotenberg's route is `POST /forms/libreoffice/convert`, the file in the multipart field `files` under a name that
 * ends in `.docx` (the suite reads a file by its extension); it answers the PDF, a 4xx for a file it cannot convert
 * and a 5xx (or no answer) when it cannot convert now. Read in Gotenberg's documentation of the 9.x line (2026-11-25).
 */

export type ConvertResult =
  | { ok: true; pdf: Uint8Array }
  /** `refused`: the file cannot be converted; `unavailable`: the suite did not answer, try again later. */
  | { ok: false; code: "refused" | "unavailable" };

export interface OfficeConverter {
  readonly name: string;
  docxToPdf(docx: Uint8Array): Promise<ConvertResult>;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The PDF's own mark: what a converter answers is taken only when it is one. */
const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

export function gotenbergConverter(options: {
  /** Where Gotenberg answers, as `http://conversor-office:3000`. */
  url: string;
  fetch?: typeof fetch;
  /** How long a conversion may take before it is given up as `unavailable`. */
  timeoutMs?: number;
}): OfficeConverter {
  const call = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, "");
  return {
    name: "gotenberg",
    async docxToPdf(docx) {
      const form = new FormData();
      form.append("files", new Blob([docx], { type: DOCX_MIME }), "timbrado.docx");
      let response: Response;
      try {
        response = await call(`${base}/forms/libreoffice/convert`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
        });
      } catch {
        return { ok: false, code: "unavailable" };
      }
      if (response.status >= 400 && response.status < 500) return { ok: false, code: "refused" };
      if (!response.ok) return { ok: false, code: "unavailable" };
      const pdf = new Uint8Array(await response.arrayBuffer());
      return isPdf(pdf) ? { ok: true, pdf } : { ok: false, code: "unavailable" };
    },
  };
}

/**
 * A converter that converts nothing: it answers a paper of two pages of its own (a band at the top of the first, a
 * smaller one at the top of the second, a band at the foot of both), whatever the document, or what `answer` gives.
 */
export function fakeConverter(answer?: (docx: Uint8Array) => Promise<ConvertResult>): OfficeConverter {
  return {
    name: "fake",
    async docxToPdf(docx) {
      if (answer) return answer(docx);
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const top of [90, 50]) {
        const page = pdf.addPage([595.28, 841.89]);
        page.drawRectangle({ x: 0, y: 841.89 - top, width: 595.28, height: top - 20, color: rgb(0.1, 0.1, 0.1) });
        page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 30, color: rgb(0.1, 0.1, 0.1) });
        page.drawText("contato@escritorio-exemplo.invalid", { x: 200, y: 12, size: 9, font, color: rgb(1, 1, 1) });
      }
      pdf.setCreationDate(new Date(0));
      pdf.setModificationDate(new Date(0));
      return { ok: true, pdf: await pdf.save() };
    },
  };
}
