import "server-only";

import { docxFonts, docxPageMargins, letterheadPagesDocx, missingFonts } from "@/lib/brand/letterhead-paper";
import { supabaseFileStore } from "@/lib/files/store";
import { readPdfPaper } from "@flyee/documents/letterhead";
import { measureFile } from "@flyee/documents/measure";
import { fakeConverter, gotenbergConverter, type OfficeConverter } from "@flyee/documents/office";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's Word letterhead copied on ONE's server (migration 0300; the owner, 2026-11-25: "não é pra inventar, mas
 * sim copiar"): the next document waiting is claimed, its body emptied (`letterheadPagesDocx`), made a PDF by the
 * office suite beside it (LibreOffice behind Gotenberg, `apps/web/clock/compose.yml`), read as the firm's paper
 * (`readPdfPaper`: its first page and its following one, each measured, never closer to the edges than the document's
 * own margins), kept as a file of the brand, and recorded. A suite that did not answer is tried again by the database's
 * count; a document it cannot convert is told to the person, with the way to send the PDF Word saves.
 *
 * Run by `clock/conversor.ts` on ONE's server, as soon as a document waits. On a machine with no server (a developer's,
 * a preview) the conversion runs right after the person's answer, with the stand-in converter or a suite of its own
 * (`ONE_OFFICE_URL`). Its answer holds a code and ids only: nothing of the firm's paper reaches a log.
 */

/** The suite's address on ONE's server, or the stand-in outside production; null where neither may be used. */
export function officeConverter(env: NodeJS.ProcessEnv = process.env): OfficeConverter | null {
  const url = env.ONE_OFFICE_URL?.trim();
  if (url) return gotenbergConverter({ url });
  if (env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview") return null;
  return fakeConverter();
}

/** Whether this server converts a letterhead itself: never production's app, whose server is ONE's own (the VPS). */
export function convertsHere(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ONE_OFFICE_URL?.trim()) return true;
  return env.NODE_ENV !== "production" || env.VERCEL_ENV === "preview";
}

export type PaperOutcome =
  | { code: "idle" }
  | { code: "ready" | "retry" | "failed" | "stale"; orgId: string; problem?: string };

type Claim = {
  ok: boolean;
  code: string;
  org_id: string;
  claim: string;
  storage_path: string;
  margins: { top?: number; bottom?: number; left?: number; right?: number } | null;
};

/** One letterhead waiting, converted and recorded; `idle` when none waits. */
export async function convertLetterheadPaper(
  service: SupabaseClient,
  converter: OfficeConverter,
): Promise<PaperOutcome> {
  const { data, error } = await service.rpc("claim_letterhead_paper");
  if (error) throw new Error(`claim_letterhead_paper failed: ${error.message}`);
  const claim = data as Claim | null;
  if (!claim) return { code: "idle" };
  if (!claim.ok) return { code: "failed", orgId: claim.org_id, problem: claim.code };
  const orgId = claim.org_id;
  const store = supabaseFileStore(service);

  const record = async (
    outcome: "ready" | "retry" | "failed",
    extra: { file?: string; paper?: Record<string, unknown>; problem?: string } = {},
  ): Promise<PaperOutcome> => {
    const { data: answer, error: failed } = await service.rpc("record_letterhead_paper", {
      target_org: orgId,
      target_claim: claim.claim,
      target_outcome: outcome,
      target_paper_file: extra.file ?? null,
      target_paper: extra.paper ?? null,
      target_problem: extra.problem ?? null,
    });
    if (failed) throw new Error(`record_letterhead_paper failed: ${failed.message}`);
    const code = (answer as { code?: string } | null)?.code;
    return {
      code: code === "ready" || code === "retry" || code === "failed" ? code : "stale",
      orgId,
      problem: extra.problem,
    };
  };

  const docx = await store.get(claim.storage_path);
  if (!docx) return record("failed", { problem: "source_missing" });
  const pages = letterheadPagesDocx(docx);
  if (!pages) return record("failed", { problem: "refused" });
  const converted = await converter.docxToPdf(pages);
  if (!converted.ok) return record(converted.code === "refused" ? "failed" : "retry", { problem: converted.code });

  const own = docxPageMargins(docx);
  const base = own ?? {
    top: claim.margins?.top ?? 72,
    bottom: claim.margins?.bottom ?? 72,
    left: claim.margins?.left ?? 62,
    right: claim.margins?.right ?? 62,
  };
  const reading = await readPdfPaper(converted.pdf, { base });
  if (!reading.ok) return record("failed", { problem: reading.code });

  const reserved = await store.reserve({
    orgId,
    purpose: "brand",
    name: "timbrado-papel.pdf",
    mime: "application/pdf",
    bytes: reading.pdf.byteLength,
  });
  if (!reserved.ok) return record("retry", { problem: "unavailable" });
  await store.put(reserved.storagePath, reading.pdf, "application/pdf");
  const confirmed = await store.confirm(reserved.fileId, await measureFile(reading.pdf));
  if (!confirmed.ok) return record("retry", { problem: "unavailable" });

  const requested = docxFonts(docx);
  const outcome = await record("ready", {
    file: reserved.fileId,
    paper: {
      pages: reading.pages,
      page: reading.page,
      first: reading.first,
      rest: reading.rest,
      stripped: reading.stripped,
      fonts: reading.fonts.slice(0, 40),
      requested: requested.slice(0, 40),
      missing: missingFonts(requested, reading.fonts).slice(0, 40),
      converter: converter.name,
    },
  });
  // A paper nobody keeps any more (the letterhead was sent anew meanwhile) is forgotten.
  if (outcome.code !== "ready") {
    await store.discard(reserved.fileId).catch(() => undefined);
    await store.remove([reserved.storagePath]).catch(() => undefined);
  }
  return outcome;
}
