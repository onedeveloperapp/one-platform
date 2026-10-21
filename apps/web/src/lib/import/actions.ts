"use server";

import { revalidatePath } from "next/cache";

import { NOTED_SHOWN, NUMBERS_PER_CALL } from "@/lib/import/limits";
import type { PortfolioRow } from "@/lib/import/portfolio";
import { getMemberContext } from "@/lib/member/context";

/**
 * What a person of a firm does to bring its portfolio (migration 0032): start
 * a batch, send its lines a few a call, commit it and undo it a few lines a
 * call (the screen asks again until none is left), give it up, ask which of a
 * list of lawsuits the firm already has, and read what of a batch did not go
 * as it was. The database says whether a person may and checks every line
 * again; a server action is a public endpoint, so nothing here trusts what it
 * is handed.
 */

export type ImportCounts = {
  rows: number;
  pending: number;
  created: number;
  exists: number;
  refused: number;
  reverted: number;
  kept: number;
};

/** What the person's screen counted of the whole file: kept with the batch, for its record. */
export type FileCounts = { lines: number; exists: number; duplicate: number; error: number; over: number };

export type ImportFailure = { ok: false; code: string; row?: number; field?: string };
export type ImportProgress = { ok: true; done: boolean; counts: ImportCounts } | ImportFailure;

/** A line of a batch that did not go as it was: refused (with its code), or brought without the CPF. */
export type NotedLine = { line: number; cnj: string; outcome: "refused" | "created"; code: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = [
  "not_allowed_in_support_session",
  "second_factor_required",
  "not_authorized",
  "batch_not_found",
] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

const countsOf = (raw: unknown): ImportCounts => {
  const value = (raw ?? {}) as Record<string, unknown>;
  const number = (key: string) => (typeof value[key] === "number" ? (value[key] as number) : 0);
  return {
    rows: number("rows"),
    pending: number("pending"),
    created: number("created"),
    exists: number("exists"),
    refused: number("refused"),
    reverted: number("reverted"),
    kept: number("kept"),
  };
};

/** The file's counts as they may be sent: whole numbers, nothing else. */
const fileCountsOf = (raw: unknown): Partial<FileCounts> | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const counts: Partial<FileCounts> = {};
  for (const key of ["lines", "exists", "duplicate", "error", "over"] as const) {
    const number = value[key];
    if (typeof number === "number" && Number.isInteger(number) && number >= 0 && number < 10_000_000) {
      counts[key] = number;
    }
  }
  return counts;
};

/** A person starts bringing a spreadsheet, with what the screen counted of the whole file. */
export async function startPortfolioImport(input: {
  fileName: string | null;
  source: string | null;
  fileCounts?: FileCounts;
}): Promise<{ ok: true; batchId: string } | ImportFailure> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("create_import_batch", {
    target_org: context.firm.id,
    target_file_name: typeof input?.fileName === "string" ? input.fileName.slice(0, 200) : null,
    target_source: typeof input?.source === "string" ? input.source.slice(0, 80) : null,
    target_file_counts: fileCountsOf(input?.fileCounts),
  });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; batch_id?: string };
  if (!answer.ok || !isId(answer.batch_id)) return { ok: false, code: String(answer.code ?? "failed") };
  return { ok: true, batchId: answer.batch_id };
}

/** A few lines join the batch. A line the database refuses is named, with what of it it refused. */
export async function addPortfolioRows(
  batchId: string,
  rows: PortfolioRow[],
): Promise<{ ok: true; rows: number } | ImportFailure> {
  const context = await getMemberContext();
  // How many lines a call takes is the database's to say; this only keeps a call from carrying a whole file.
  if (!context?.firm || !isId(batchId) || !Array.isArray(rows) || rows.length === 0 || rows.length > 2000) {
    return { ok: false, code: "invalid_rows" };
  }
  const { data, error } = await context.supabase.rpc("add_import_rows", { target_batch: batchId, target_rows: rows });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; rows?: number; row?: number; field?: string };
  if (!answer.ok)
    return {
      ok: false,
      code: String(answer.code ?? "failed"),
      row: typeof answer.row === "number" ? answer.row : undefined,
      field: typeof answer.field === "string" ? answer.field : undefined,
    };
  return { ok: true, rows: Number(answer.rows ?? 0) };
}

/** Decides the next lines of the batch; the screen asks again until `done`. */
export async function commitPortfolioImport(batchId: string): Promise<ImportProgress> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(batchId)) return { ok: false, code: "batch_not_found" };
  const { data, error } = await context.supabase.rpc("commit_import_batch", { target_batch: batchId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; counts?: unknown };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  const done = answer.code !== "in_progress";
  if (done) {
    revalidatePath("/casos");
    revalidatePath("/casos/importar");
    revalidatePath("/inicio");
  }
  return { ok: true, done, counts: countsOf(answer.counts) };
}

/** Undoes the next lines of the batch; the screen asks again until `done`. */
export async function revertPortfolioImport(batchId: string): Promise<ImportProgress> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(batchId)) return { ok: false, code: "batch_not_found" };
  const { data, error } = await context.supabase.rpc("revert_import_batch", { target_batch: batchId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; counts?: unknown };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  const done = answer.code !== "in_progress";
  if (done) {
    revalidatePath("/casos");
    revalidatePath("/casos/importar");
    revalidatePath("/inicio");
  }
  return { ok: true, done, counts: countsOf(answer.counts) };
}

/** A person gives up a batch none of whose lines was decided. */
export async function discardPortfolioImport(batchId: string): Promise<{ ok: true } | ImportFailure> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(batchId)) return { ok: false, code: "batch_not_found" };
  const { data, error } = await context.supabase.rpc("discard_import_batch", { target_batch: batchId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/casos/importar");
  return { ok: true };
}

/**
 * Which of these lawsuits (20 digits each) the firm already has, asked of the database in the request's body
 * (`known_lawsuits`): a thousand numbers would not fit in an address.
 */
export async function knownLawsuits(cnjs: string[]): Promise<{ ok: true; known: string[] } | ImportFailure> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const asked = [
    ...new Set((Array.isArray(cnjs) ? cnjs : []).filter((cnj) => typeof cnj === "string" && /^\d{20}$/.test(cnj))),
  ];
  if (asked.length > NUMBERS_PER_CALL) return { ok: false, code: "invalid_rows" };
  if (asked.length === 0) return { ok: true, known: [] };
  const { data, error } = await context.supabase.rpc("known_lawsuits", {
    target_org: context.firm.id,
    target_cnjs: asked,
  });
  if (error || !Array.isArray(data)) return { ok: false, code: "failed" };
  return { ok: true, known: (data as unknown[]).filter((cnj): cnj is string => typeof cnj === "string") };
}

/**
 * The lines of a batch that did not go as they were, for the screen to say which and why: the ones refused,
 * and the ones whose client was written without the CPF, which the firm has for somebody of another name,
 * each list to its own limit, with how many came without the CPF in all.
 */
export async function notedLines(
  batchId: string,
): Promise<{ ok: true; refused: NotedLine[]; withoutCpf: NotedLine[]; withoutCpfCount: number } | ImportFailure> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(batchId)) return { ok: false, code: "batch_not_found" };
  const firm = context.firm.id;
  const [refused, withoutCpf, counted] = await Promise.all([
    context.supabase
      .from("import_rows")
      .select("row_number, cnj, outcome, code")
      .eq("org_id", firm)
      .eq("batch_id", batchId)
      .eq("outcome", "refused")
      .order("row_number")
      .limit(NOTED_SHOWN),
    context.supabase
      .from("import_rows")
      .select("row_number, cnj, outcome, code")
      .eq("org_id", firm)
      .eq("batch_id", batchId)
      .eq("code", "cpf_other_name")
      .order("row_number")
      .limit(NOTED_SHOWN),
    context.supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("org_id", firm)
      .eq("batch_id", batchId)
      .eq("code", "cpf_other_name"),
  ]);
  if (refused.error || withoutCpf.error || counted.error) return { ok: false, code: "failed" };
  type LineRow = { row_number: number; cnj: string; outcome: string; code: string | null };
  const lines = (rows: LineRow[]): NotedLine[] =>
    rows.map((row) => ({
      line: row.row_number,
      cnj: row.cnj,
      outcome: row.outcome === "refused" ? "refused" : "created",
      code: row.code,
    }));
  return {
    ok: true,
    refused: lines((refused.data ?? []) as LineRow[]),
    withoutCpf: lines((withoutCpf.data ?? []) as LineRow[]),
    withoutCpfCount: counted.count ?? 0,
  };
}
