import "server-only";

import { supabaseFileStore } from "@/lib/files/store";
import type { Band, BandImage, BandLine, PdfLetterhead } from "@flyee/documents/letterhead";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's letterhead as the documents it issues draw it (migrations 0260 and 0300): the firm's paper ONE copied (a
 * PDF of its first page and its following one, each with where the text goes), drawn under every page. A PDF
 * letterhead read before 0300 is its own file, as it was; a Word letterhead read before 0300 is drawn from what ONE
 * read of it only while ONE's server copies its paper, and a Word letterhead whose paper is not ready is none. Only a
 * letterhead the firm confirmed on its page of example, unless the example itself asks. A letterhead that cannot be
 * read whole is none: the document goes on plain paper rather than not at all. The backend's (the service client).
 */

type StoredImage = {
  file_id: string;
  mime: BandImage["mime"];
  widthPt: number;
  heightPt: number;
  align: BandImage["align"];
};
type StoredBand = { lines: BandLine[]; images: StoredImage[] };
type StoredMargins = { top: number; bottom: number; left: number; right: number; header?: number; footer?: number };
export type StoredLetterhead = {
  page?: { width: number; height: number };
  margins: StoredMargins;
  header?: StoredBand;
  footer?: StoredBand;
  font?: string | null;
};

/** What ONE keeps of the firm's paper (0300): its pages, each measured. */
type StoredPaper = {
  pages?: number;
  first?: { margins?: Partial<StoredMargins> };
  rest?: { margins?: Partial<StoredMargins> };
};

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const marginsOf = (margins: Partial<StoredMargins> | undefined) => ({
  top: finite(margins?.top, 72),
  bottom: finite(margins?.bottom, 72),
  left: finite(margins?.left, 62),
  right: finite(margins?.right, 62),
});

async function pathsOf(service: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await service
    .from("files")
    .select("id, storage_path")
    .eq("org_id", orgId)
    .eq("status", "stored")
    .in("id", ids);
  return new Map(((data ?? []) as { id: string; storage_path: string }[]).map((row) => [row.id, row.storage_path]));
}

export async function firmLetterhead(
  service: SupabaseClient,
  orgId: string,
  options: { unconfirmed?: boolean } = {},
): Promise<PdfLetterhead | null> {
  try {
    const { data: row } = await service
      .from("firm_brands")
      .select(
        "letterhead_kind, letterhead_source_file_id, letterhead, letterhead_confirmed_at, letterhead_paper_status, letterhead_paper_file_id, letterhead_paper",
      )
      .eq("org_id", orgId)
      .maybeSingle();
    if (!row?.letterhead_kind || !row.letterhead) return null;
    if (!row.letterhead_confirmed_at && !options.unconfirmed) return null;
    const stored = row.letterhead as StoredLetterhead;
    const margins = stored.margins ?? { top: 72, bottom: 72, left: 62, right: 62 };
    const store = supabaseFileStore(service);

    // The firm's paper, copied (0300).
    if (row.letterhead_paper_status === "ready" && row.letterhead_paper_file_id && row.letterhead_paper) {
      const paper = row.letterhead_paper as StoredPaper;
      const paths = await pathsOf(service, orgId, [String(row.letterhead_paper_file_id)]);
      const path = paths.get(String(row.letterhead_paper_file_id));
      const pdf = path ? await store.get(path) : null;
      if (!pdf) return null;
      const pages = Math.max(1, Math.min(2, Math.round(finite(paper.pages, 1))));
      return {
        kind: "page",
        pdf,
        page: pages - 1,
        margins: marginsOf(paper.rest?.margins),
        first: pages > 1 ? { page: 0, margins: marginsOf(paper.first?.margins) } : undefined,
      };
    }
    // A Word letterhead is drawn again from what ONE read of it only while its paper is being copied, and only one
    // the firm confirmed before 0300 (a new one is confirmed on its paper).
    if (
      row.letterhead_kind === "word" &&
      (row.letterhead_paper_status !== "converting" || !row.letterhead_confirmed_at)
    ) {
      return null;
    }

    if (row.letterhead_kind === "pdf") {
      const paths = await pathsOf(service, orgId, [String(row.letterhead_source_file_id)]);
      const path = paths.get(String(row.letterhead_source_file_id));
      const pdf = path ? await store.get(path) : null;
      if (!pdf) return null;
      return {
        kind: "page",
        pdf,
        margins: {
          top: finite(margins.top, 72),
          bottom: finite(margins.bottom, 72),
          left: finite(margins.left, 62),
          right: finite(margins.right, 62),
        },
      };
    }

    const bands = [stored.header, stored.footer];
    const ids = bands.flatMap((band) => (band?.images ?? []).map((image) => image.file_id));
    const paths = await pathsOf(service, orgId, ids);
    const bytes = new Map<string, Uint8Array>();
    for (const id of ids) {
      const path = paths.get(id);
      const read = path ? await store.get(path) : null;
      if (!read) return null;
      bytes.set(id, read);
    }
    const band = (stored?: StoredBand): Band => ({
      lines: (stored?.lines ?? []).map((line) => ({
        text: String(line.text ?? ""),
        align: line.align,
        sizePt: finite(line.sizePt, 10),
        bold: line.bold === true,
      })),
      images: (stored?.images ?? []).map((image) => ({
        bytes: bytes.get(image.file_id)!,
        mime: image.mime,
        widthPt: finite(image.widthPt, 100),
        heightPt: finite(image.heightPt, 40),
        align: image.align,
      })),
    });
    return {
      kind: "bands",
      header: band(stored.header),
      footer: band(stored.footer),
      margins: {
        top: finite(margins.top, 72),
        bottom: finite(margins.bottom, 72),
        left: finite(margins.left, 62),
        right: finite(margins.right, 62),
        header: finite(margins.header, 28),
        footer: finite(margins.footer, 28),
      },
    };
  } catch {
    return null;
  }
}

/** The firm's own Word document on its letterhead, confirmed: a piece downloaded in Word is written into it. */
export async function firmLetterheadDocx(service: SupabaseClient, orgId: string): Promise<Uint8Array | null> {
  try {
    const { data: row } = await service
      .from("firm_brands")
      .select("letterhead_kind, letterhead_source_file_id, letterhead_confirmed_at")
      .eq("org_id", orgId)
      .maybeSingle();
    if (row?.letterhead_kind !== "word" || !row.letterhead_confirmed_at || !row.letterhead_source_file_id) return null;
    const paths = await pathsOf(service, orgId, [String(row.letterhead_source_file_id)]);
    const path = paths.get(String(row.letterhead_source_file_id));
    return path ? await supabaseFileStore(service).get(path) : null;
  } catch {
    return null;
  }
}
