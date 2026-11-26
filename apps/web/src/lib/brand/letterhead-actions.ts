"use server";

import { revalidatePath } from "next/cache";

import { readDocxLetterhead } from "@/lib/brand/letterhead-docx";
import { type LetterheadPaper, paperOf } from "@/lib/brand/letterhead-paper";
import { convertLetterheadPaper, convertsHere, officeConverter } from "@/lib/brand/letterhead-paper-work";
import { firmLetterhead, firmLetterheadDocx } from "@/lib/brand/letterhead-read";
import { officeOfLetterhead } from "@/lib/brand/letterhead-text";
import { supabaseFileStore } from "@/lib/files/store";
import { downloadUrl, finishUpload, startUpload } from "@/lib/files/uploads";
import { isManager } from "@/lib/firm/roles";
import { soon } from "@/lib/jobs/soon";
import { getMemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";
import { DOCX_MIME } from "@flyee/documents/detect";
import { readPdfPaper } from "@flyee/documents/letterhead";
import { compressLetterheadImage } from "@flyee/documents/letterhead-image";
import { normalizeLogo } from "@flyee/documents/logo";
import { measureFile } from "@flyee/documents/measure";
import { renderTextPdf } from "@flyee/documents/text-pdf";

/**
 * The firm's letterhead (migrations 0260 and 0300, the plan "o escritório preparado antes do primeiro atendimento",
 * phase 2): the person sends a Word document the firm writes on, or a PDF of its paper, blank or with a document on
 * it. ONE copies the paper as it is, never drawing it again (the owner, 2026-11-25): a PDF's first two pages, the text
 * of a document taken out of them, kept at once; a Word document made a PDF on ONE's server, its body emptied first
 * (`letterhead-paper-work.ts`), which the step follows until it is ready. From a Word document ONE also takes the
 * firm's data its header and footer say and the logo when the firm has none yet. The person sees a page of example;
 * once they confirm it, ONE writes on it. Who manages the firm, with the second factor (the database).
 */

/** The heaviest paper ONE draws under the pages of a piece: a filing package carries it on each of them. */
const MOST_PAPER_BYTES = 1_572_864;

const LETTERHEAD_MIMES = ["application/pdf", DOCX_MIME] as const;

export type LetterheadResult =
  | { ok: true; kind: "word" | "pdf"; logoUrl: string | null; paper: LetterheadPaper }
  | { ok: false; code: string };

const CODES = [
  "not_allowed_in_support_session",
  "second_factor_required",
  "not_authorized",
  "type_not_allowed",
  "too_large",
  "file_not_found",
  "no_letterhead",
  "paper_not_ready",
] as const;
const codeOf = (message: unknown): string => {
  const text = typeof message === "string" ? message : "";
  return CODES.find((code) => text.includes(code)) ?? "failed";
};

async function manager() {
  const context = await getMemberContext();
  return context?.firm && isManager(context.firm.role) ? context : null;
}

function backend() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/** Starts the upload of the letterhead: where the browser sends its bytes. */
export async function startLetterheadUpload(input: { name: string; mime: string; bytes: number }) {
  const context = await manager();
  if (!context) return { ok: false as const, code: "not_authorized" };
  if (!(LETTERHEAD_MIMES as readonly string[]).includes(input.mime)) {
    return { ok: false as const, code: "type_not_allowed" };
  }
  return startUpload(context, { purpose: "brand", name: input.name, mime: input.mime, bytes: input.bytes });
}

/** Keeps bytes ONE made as a file of the firm's brand, measured: its id, or null. */
async function keep(
  store: ReturnType<typeof supabaseFileStore>,
  orgId: string,
  userId: string,
  name: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string | null> {
  const reserved = await store.reserve({
    orgId,
    purpose: "brand",
    name,
    mime,
    bytes: bytes.byteLength,
    requestedBy: userId,
  });
  if (!reserved.ok) return null;
  await store.put(reserved.storagePath, bytes, mime);
  const confirmed = await store.confirm(reserved.fileId, await measureFile(bytes));
  return confirmed.ok ? reserved.fileId : null;
}

/** The letterhead sent: read, what it draws kept, and the logo taken from its header when the firm has none. */
export async function readFirmLetterhead(fileId: string): Promise<LetterheadResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return { ok: false, code: "file_not_found" };
  const finished = await finishUpload(context, fileId);
  if (!finished.ok) return { ok: false, code: codeOf(finished.code) };
  const { data: file } = await context.supabase
    .from("files")
    .select("id, storage_path, detected_mime, purpose, bytes")
    .eq("id", fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file || file.purpose !== "brand") return { ok: false, code: "file_not_found" };
  const service = backend();
  if (!service) return { ok: false, code: "failed" };
  const store = supabaseFileStore(service);
  const bytes = await store.get(String(file.storage_path));
  if (!bytes) return { ok: false, code: "file_not_found" };
  const orgId = context.firm.id;
  let logoUrl: string | null = null;

  let paper: LetterheadPaper;
  if (file.detected_mime === "application/pdf") {
    // The paper as it is: its first two pages, the text of a document taken out of them.
    const reading = await readPdfPaper(bytes);
    if (!reading.ok) return { ok: false, code: reading.code };
    if (reading.pdf.byteLength > MOST_PAPER_BYTES) return { ok: false, code: "too_heavy" };
    const paperId = await keep(store, orgId, context.userId, "timbrado-papel.pdf", reading.pdf, "application/pdf");
    if (!paperId) return { ok: false, code: "failed" };
    const { data, error } = await context.supabase.rpc("set_firm_letterhead_paper", {
      target_org: orgId,
      target_source_file: fileId,
      target_paper_file: paperId,
      target_paper: {
        pages: reading.pages,
        page: reading.page,
        first: reading.first,
        rest: reading.rest,
        stripped: reading.stripped,
        fonts: reading.fonts.slice(0, 40),
      },
    });
    if (error || (data as { ok?: boolean } | null)?.ok !== true) {
      return { ok: false, code: codeOf(error?.message ?? (data as { code?: string } | null)?.code) };
    }
    paper = { status: "ready", problem: null, missing: [], stripped: reading.stripped };
  } else if (file.detected_mime === DOCX_MIME) {
    // What ONE reads of the document is the firm's data and its logo; its paper is copied on ONE's server.
    const reading = readDocxLetterhead(bytes);
    if (!reading.ok && reading.code !== "no_letterhead") return { ok: false, code: reading.code };
    const lines = reading.ok ? [...reading.header.lines, ...reading.footer.lines] : [];
    const { data, error } = await context.supabase.rpc("set_firm_letterhead", {
      target_org: orgId,
      target_kind: "word",
      target_source_file: fileId,
      target_data: reading.ok
        ? {
            page: { width: reading.page.width, height: reading.page.height },
            margins: reading.page.margins,
            header: { lines: reading.header.lines, images: [] },
            footer: { lines: reading.footer.lines, images: [] },
            font: reading.font,
          }
        : { margins: { top: 72, bottom: 72, left: 72, right: 72 } },
    });
    if (error || (data as { ok?: boolean } | null)?.ok !== true) {
      return { ok: false, code: codeOf(error?.message ?? (data as { code?: string } | null)?.code) };
    }
    paper = { status: "converting", problem: null, missing: [], stripped: false };
    // Where this server converts it itself (a developer's machine, a preview), right after the answer; on ONE's
    // own server the converter takes it within seconds.
    const converter = convertsHere() ? officeConverter() : null;
    if (converter) soon("letterhead-paper", () => convertLetterheadPaper(service, converter));

    // What the letterhead says of the firm fills what the firm has not given yet (0271): its CNPJ, phone, e-mail and
    // address, each checked by its rule; nothing a person gave is written over.
    const office = officeOfLetterhead(lines.map((line) => line.text));
    if (Object.keys(office).length > 0) {
      await service
        .rpc("fill_firm_office_from_paper", {
          target_org: orgId,
          target_source: "timbrado",
          target_ref: fileId,
          target_data: office,
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }

    // The firm with no logo yet: the largest picture of the header is its logo.
    const { data: brand } = await context.supabase
      .from("firm_brands")
      .select("logo_file_id")
      .eq("org_id", orgId)
      .maybeSingle();
    const largest = reading.ok
      ? [...reading.header.images]
          .filter((image) => reading.media[image.part])
          .sort((a, b) => b.widthPt * b.heightPt - a.widthPt * a.heightPt)[0]
      : undefined;
    if (!brand?.logo_file_id && reading.ok && largest) {
      try {
        // The picture as the letterhead has it, kept compressed as the logo's source, and ONE's PNG of it.
        const source = await compressLetterheadImage(reading.media[largest.part]!);
        const sourceId = await keep(
          store,
          orgId,
          context.userId,
          `timbrado-logo.${source.mime === "image/png" ? "png" : "jpg"}`,
          source.bytes,
          source.mime,
        );
        const logo = await normalizeLogo(reading.media[largest.part]!);
        const logoId = sourceId
          ? await keep(store, orgId, context.userId, "logomarca.png", logo.png, "image/png")
          : null;
        if (sourceId && logoId) {
          const set = await context.supabase.rpc("set_firm_logo", {
            target_org: orgId,
            target_source_file: sourceId,
            target_logo_file: logoId,
            target_width: logo.width,
            target_height: logo.height,
            target_color: logo.color,
          });
          if (!set.error) {
            const link = await downloadUrl(context, logoId).catch(() => null);
            logoUrl = link?.ok ? link.url : null;
          }
        }
      } catch {
        // The logo is the person's to send, then.
      }
    }
  } else {
    return { ok: false, code: "type_not_allowed" };
  }
  revalidatePath("/configurar");
  return { ok: true, kind: file.detected_mime === "application/pdf" ? "pdf" : "word", logoUrl, paper };
}

/** Where the firm's paper stands, for the step that follows a Word document while ONE's server copies it. */
export async function letterheadPaperState(): Promise<
  { ok: true; paper: LetterheadPaper } | { ok: false; code: string }
> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase
    .from("firm_brands")
    .select("letterhead_kind, letterhead_paper_status, letterhead_paper_problem, letterhead_paper")
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (error) return { ok: false, code: "failed" };
  return { ok: true, paper: paperOf(data) };
}

/** The text of the pages of example, invented: long enough for the first page and a following one, each with its paper. */
const SAMPLE = [
  { kind: "title" as const, text: "Exemplo de página no timbrado do escritório" },
  { kind: "heading" as const, text: "DOS FATOS" },
  ...Array.from({ length: 15 }, (_, index) => ({
    kind: "paragraph" as const,
    indent: true,
    text:
      index % 2 === 0
        ? "Este é um exemplo de como as peças e os papéis que o cliente assina saem no timbrado do escritório. Confira se o cabeçalho, o rodapé e as margens estão no lugar e se o texto não cobre nada do papel."
        : "Cada página leva o timbrado do escritório como ele foi enviado. O texto começa abaixo do cabeçalho e termina acima do rodapé, e uma peça longa continua na página seguinte do mesmo jeito.",
  })),
];

/** The page of example of the letterhead ONE read, confirmed or not: the PDF, as base64, to be shown in place. */
export async function letterheadSample(): Promise<{ ok: true; pdf: string } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const service = backend();
  if (!service) return { ok: false, code: "failed" };
  const letterhead = await firmLetterhead(service, context.firm.id, { unconfirmed: true });
  if (!letterhead) return { ok: false, code: "no_letterhead" };
  const pdf = await renderTextPdf({
    blocks: SAMPLE,
    letterhead,
    stamped: false,
    producer: context.firm.name,
    title: "Exemplo de página no timbrado",
  });
  return { ok: true, pdf: Buffer.from(pdf).toString("base64") };
}

/** The person saw the page of example: ONE writes on the letterhead from now on. */
export async function confirmFirmLetterhead(): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("confirm_firm_letterhead", { target_org: context.firm.id });
  if (error) return { ok: false, code: codeOf(error.message) };
  if ((data as { ok?: boolean } | null)?.ok !== true)
    return { ok: false, code: codeOf((data as { code?: string }).code) };
  revalidatePath("/configurar");
  return { ok: true };
}

/** The firm writes on plain paper again. */
export async function removeFirmLetterhead(): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { error } = await context.supabase.rpc("remove_firm_letterhead", { target_org: context.firm.id });
  if (error) return { ok: false, code: codeOf(error.message) };
  revalidatePath("/configurar");
  return { ok: true };
}

/**
 * The firm's own Word document on its letterhead, confirmed (0260), as base64: a text of the library downloaded in
 * Word is written into it, in the browser. Anybody of the firm; null where the firm has none.
 */
export async function letterheadDocxForDownload(): Promise<string | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const service = backend();
  if (!service) return null;
  const bytes = await firmLetterheadDocx(service, context.firm.id);
  return bytes ? Buffer.from(bytes).toString("base64") : null;
}
