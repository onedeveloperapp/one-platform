"use server";

import { revalidatePath } from "next/cache";

import type { FinanceResult } from "@/lib/finance/actions";
import { IMPORT_LINES_PER_CALL, type LegacyLine } from "@/lib/finance/legacy-file";
import { getMemberContext } from "@/lib/member/context";

/**
 * The open bills a firm brings from the system it used before (migration 0153), sent a few hundred lines a call: the
 * database writes each as a bill of the books, says the ones already in ONE and refuses the rest with why. An import is
 * undone whole while nothing of it was paid. Each call is who operates the books', with the second factor.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export type ImportNote = { line: number; code: string };

export async function importFinanceBills(
  importId: string | null,
  fileName: string,
  lines: LegacyLine[],
): Promise<FinanceResult<{ importId: string; opened: number; existed: number; notes: ImportNote[] }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (importId !== null && !isId(importId)) return { ok: false, code: "not_found" };
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > IMPORT_LINES_PER_CALL) {
    return { ok: false, code: "invalid_data", field: "lines" };
  }
  const { data, error } = await context.supabase.rpc("import_finance_bills", {
    target_org: context.firm.id,
    target_import: importId,
    target_file_name: String(fileName ?? "").slice(0, 200),
    target_lines: lines,
  });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true || !isId(answer.import_id)) {
    return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
  }
  const notes = Array.isArray(answer.notes)
    ? (answer.notes as Record<string, unknown>[]).map((note) => ({
        line: Number(note.line ?? 0),
        code: String(note.code ?? "invalid"),
      }))
    : [];
  return {
    ok: true,
    importId: answer.import_id,
    opened: Number(answer.opened ?? 0),
    existed: Number(answer.existed ?? 0),
    notes,
  };
}

/** Signals the screens once an import is whole, so the lists read it. */
export async function finishFinanceImport(): Promise<void> {
  revalidatePath("/financeiro", "layout");
}

export async function undoFinanceImport(importId: string): Promise<FinanceResult<{ cancelled: number; kept: number }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(importId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("undo_finance_import", {
    target_org: context.firm.id,
    target_import: importId,
  });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true) return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
  revalidatePath("/financeiro", "layout");
  return { ok: true, cancelled: Number(answer.cancelled ?? 0), kept: Number(answer.kept ?? 0) };
}

export type FinanceImport = {
  id: string;
  fileName: string | null;
  createdAt: string;
  lines: number;
  opened: number;
  existed: number;
  refused: number;
  undoneAt: string | null;
  paid: number;
};

/** The firm's latest imports, for who reads the books; null for anybody else. */
export async function readFinanceImports(): Promise<FinanceImport[] | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data, error } = await context.supabase.rpc("firm_finance_imports", { target_org: context.firm.id });
  if (error || !Array.isArray(data)) return null;
  return (data as Record<string, unknown>[]).flatMap((row) =>
    isId(row.id)
      ? [
          {
            id: row.id,
            fileName: typeof row.file_name === "string" ? row.file_name : null,
            createdAt: String(row.created_at ?? ""),
            lines: Number(row.lines ?? 0),
            opened: Number(row.opened ?? 0),
            existed: Number(row.existed ?? 0),
            refused: Number(row.refused ?? 0),
            undoneAt: typeof row.undone_at === "string" ? row.undone_at : null,
            paid: Number(row.paid ?? 0),
          },
        ]
      : [],
  );
}
