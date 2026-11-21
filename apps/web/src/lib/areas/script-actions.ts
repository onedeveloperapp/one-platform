"use server";

import { revalidatePath } from "next/cache";

import { type AreaScript, scriptOf } from "@/lib/areas/script";
import { queueAreaScriptWriting } from "@/lib/areas/script-work";
import { finishUpload, startUpload } from "@/lib/files/uploads";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";

/**
 * The script of each area of the firm (migration 0273, phase 4 of the plan "o escritório preparado antes do primeiro
 * atendimento"): who manages the firm asks ONE to write it (the interview, with the documents the firm sends), reads
 * the draft while ONE writes, corrects it in place, publishes it, or withdraws a published one with why. The second
 * factor and the record are the database's.
 */

const SCRIPT_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export type ScriptVersion = { id: string; version: number; script: AreaScript; at: string };

export type AreaScriptCard = {
  areaId: string;
  name: string;
  /** What the area covers, where ONE knows it. */
  covers: string | null;
  /** ONE's writing owed: waiting or under way, failed with why, or none. */
  writing: { status: "waiting" | "working" | "failed"; failure: string | null } | null;
  draft: ScriptVersion | null;
  /** The version new contacts and cases of the area read. */
  inForce: ScriptVersion | null;
};

export type AreaScriptsState = {
  /** The firm's areas that no module serves: each with a script of its own. */
  areas: AreaScriptCard[];
  /** The firm's areas a module of the platform serves: set up in the module's own setup. */
  moduleAreas: string[];
};

export type ScriptResult = { ok: true } | { ok: false; code: string };

const CODES = [
  "not_allowed_in_support_session",
  "second_factor_required",
  "not_authorized",
  "invalid_change",
  "too_many_files",
  "file_not_found",
  "area_not_found",
  "not_found",
  "not_draft",
  "not_published",
  "invalid_reason",
  "copy_rules",
  "promise",
  "shape",
  "type_not_allowed",
  "too_large",
] as const;
const codeOf = (message: unknown): string => {
  const text = typeof message === "string" ? message : "";
  return CODES.find((code) => text.includes(code)) ?? "failed";
};

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

async function manager() {
  const context = await getMemberContext();
  return context?.firm && isManager(context.firm.role) ? context : null;
}

function refresh(): void {
  revalidatePath("/configurar");
  revalidatePath("/settings/areas");
  revalidatePath("/inicio");
}

/** Starts the upload of a document for the interview: where the browser sends its bytes. */
export async function startAreaDocumentUpload(input: { name: string; mime: string; bytes: number }) {
  const context = await manager();
  if (!context) return { ok: false as const, code: "not_authorized" };
  if (!(SCRIPT_MIMES as readonly string[]).includes(input.mime))
    return { ok: false as const, code: "type_not_allowed" };
  return startUpload(context, { purpose: "area_script", name: input.name, mime: input.mime, bytes: input.bytes });
}

/** The document sent, measured and kept: ready for ONE to read in the interview. */
export async function finishAreaDocumentUpload(fileId: string): Promise<ScriptResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isId(fileId)) return { ok: false, code: "file_not_found" };
  const finished = await finishUpload(context, fileId);
  return finished.ok ? { ok: true } : { ok: false, code: codeOf(finished.code) };
}

/** ONE writes the area's script: the first time, or again with the person's words, with the documents sent. */
export async function requestAreaScript(input: {
  areaId: string;
  change?: string | null;
  fileIds?: string[];
}): Promise<ScriptResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isId(input.areaId)) return { ok: false, code: "area_not_found" };
  const fileIds = (input.fileIds ?? []).filter(isId).slice(0, 4);
  const { data, error } = await context.supabase.rpc("request_area_script", {
    target_org: context.firm.id,
    target_area: input.areaId,
    target_change: typeof input.change === "string" ? input.change.slice(0, 1000) : null,
    target_files: fileIds,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  queueAreaScriptWriting();
  refresh();
  return { ok: true };
}

/** The person's correction of the draft, kept as they wrote it, within the rules for everybody. */
export async function saveAreaScriptDraft(input: { scriptId: string; script: unknown }): Promise<ScriptResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isId(input.scriptId)) return { ok: false, code: "not_found" };
  const script = scriptOf(input.script);
  if (!script) return { ok: false, code: "shape" };
  const { data, error } = await context.supabase.rpc("save_area_script_draft", {
    target_org: context.firm.id,
    target_script: input.scriptId,
    target_content: script,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  refresh();
  return { ok: true };
}

/** The draft the person read, with its conversations of example, becomes the area's script in force. */
export async function publishAreaScript(scriptId: string): Promise<ScriptResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isId(scriptId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("publish_area_script", {
    target_org: context.firm.id,
    target_script: scriptId,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  refresh();
  return { ok: true };
}

/** A draft made of the script in force, for the person to correct by hand; answers the draft's id. */
export async function copyAreaScript(
  scriptId: string,
): Promise<{ ok: true; scriptId: string } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isId(scriptId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("copy_area_script", {
    target_org: context.firm.id,
    target_script: scriptId,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; script_id?: string };
  if (answer.ok !== true || !answer.script_id) return { ok: false, code: codeOf(answer.code) };
  refresh();
  return { ok: true, scriptId: answer.script_id };
}

/** A published script with a defect, withdrawn with why. */
export async function withdrawAreaScript(input: { scriptId: string; reason: string }): Promise<ScriptResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isId(input.scriptId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("withdraw_area_script", {
    target_org: context.firm.id,
    target_script: input.scriptId,
    target_reason: String(input.reason ?? "").slice(0, 1000),
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  refresh();
  return { ok: true };
}

const versionOf = (row: Record<string, unknown> | undefined): ScriptVersion | null => {
  if (!row || typeof row.id !== "string") return null;
  const script = scriptOf(row.script);
  const at = String(row.published_at ?? row.edited_at ?? row.created_at ?? "");
  return script ? { id: row.id, version: Number(row.version), script, at } : null;
};

/** Where the script of each area of the firm stands, under the person's own session. Null when it could not be read. */
export async function readAreaScripts(): Promise<AreaScriptsState | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const [areas, lawAreas, scripts, requests] = await Promise.all([
    context.supabase
      .from("firm_areas")
      .select("id, name, law_area, created_at")
      .eq("org_id", context.firm.id)
      .is("removed_at", null)
      .order("created_at"),
    context.supabase.from("law_areas").select("key, covers, module, position"),
    context.supabase
      .from("firm_area_scripts")
      .select("id, area_id, version, status, script, created_at, edited_at, published_at")
      .eq("org_id", context.firm.id)
      .in("status", ["draft", "published"])
      .order("version", { ascending: false }),
    context.supabase
      .from("firm_area_script_requests")
      .select("area_id, status, failure, created_at")
      .eq("org_id", context.firm.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (areas.error || lawAreas.error || scripts.error || requests.error) return null;
  const known = new Map(
    ((lawAreas.data ?? []) as { key: string; covers: string; module: string | null; position: number }[]).map(
      (area) => [area.key, area],
    ),
  );
  const scriptRows = (scripts.data ?? []) as Record<string, unknown>[];
  const requestRows = (requests.data ?? []) as {
    area_id: string;
    status: string;
    failure: string | null;
    created_at: string;
  }[];
  const rows = ((areas.data ?? []) as { id: string; name: string; law_area: string | null }[]).sort(
    (a, b) =>
      (known.get(a.law_area ?? "")?.position ?? 1000) - (known.get(b.law_area ?? "")?.position ?? 1000) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
  const state: AreaScriptsState = { areas: [], moduleAreas: [] };
  for (const area of rows) {
    const law = area.law_area ? known.get(area.law_area) : undefined;
    if (law?.module) {
      state.moduleAreas.push(area.name);
      continue;
    }
    const mine = scriptRows.filter((row) => row.area_id === area.id);
    const last = requestRows.find((row) => row.area_id === area.id);
    state.areas.push({
      areaId: area.id,
      name: area.name,
      covers: law?.covers ?? null,
      writing:
        last && (last.status === "waiting" || last.status === "working" || last.status === "failed")
          ? { status: last.status, failure: last.failure }
          : null,
      draft: versionOf(mine.find((row) => row.status === "draft")),
      inForce: versionOf(mine.find((row) => row.status === "published")),
    });
  }
  return state;
}
