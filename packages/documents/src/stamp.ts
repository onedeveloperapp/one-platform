import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

import { formatVerifyCode } from "@flyee/documents/codes";

/**
 * The mark every issued document carries at the foot of each page: who
 * issued it, the code, where to check it, and a QR code that opens that
 * address. It is what lets somebody who receives the document confirm that
 * the firm issued it, and what a forged one cannot have.
 *
 * A template leaves the last `STAMP_BAND` points of each page free for it.
 */

/** The height, in points, a template leaves free at the foot of each page. */
export const STAMP_BAND = 56;

const QR_SIZE = 40;
const MARGIN = 28;
const TEXT_SIZE = 7.5;

/**
 * The standard fonts of a PDF write Latin text only. A character outside it
 * (an emoji in a firm's name) would stop the whole issue, so it is left out
 * of the mark instead.
 */
const latinOnly = (text: string): string =>
  [...text.normalize("NFC")]
    .filter((char) => char >= " " && char <= "ÿ" && !(char >= "\u007f" && char <= "\u009f"))
    .join("");

export interface VerificationMark {
  /** The firm that issues, as it is known to its clients. */
  firm: string;
  verifyCode: string;
  verifyUrl: string;
}

/** Stamps the verification mark on every page of a PDF and returns the new bytes. */
export async function stampVerification(pdfBytes: Uint8Array, mark: VerificationMark): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const qr = await pdf.embedPng(
    await QRCode.toBuffer(mark.verifyUrl, { type: "png", margin: 0, width: 240, errorCorrectionLevel: "M" }),
  );

  const lines = [
    latinOnly(`Documento emitido por ${mark.firm} pelo ONE.`),
    latinOnly(`Confira em ${mark.verifyUrl}`),
    latinOnly(`Código de verificação: ${formatVerifyCode(mark.verifyCode)}`),
  ];
  const ink = rgb(0.25, 0.27, 0.32);

  for (const page of pdf.getPages()) {
    const y = (STAMP_BAND - QR_SIZE) / 2;
    page.drawImage(qr, { x: MARGIN, y, width: QR_SIZE, height: QR_SIZE });
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN + QR_SIZE + 10,
        y: y + QR_SIZE - TEXT_SIZE - 3 - index * (TEXT_SIZE + 4.5),
        size: TEXT_SIZE,
        font,
        color: ink,
      });
    });
  }
  return pdf.save();
}
