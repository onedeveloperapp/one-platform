"use server";

import { revalidatePath } from "next/cache";

import { supabaseFileStore } from "@/lib/files/store";
import { downloadUrl, finishUpload, startUpload } from "@/lib/files/uploads";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";
import { LOGO_MIMES } from "@flyee/documents/brand";
import { normalizeLogo } from "@flyee/documents/logo";
import { measureFile } from "@flyee/documents/measure";

/**
 * The firm's logo and colour (migration 0258, the plan "o escritório preparado antes do primeiro atendimento", phase
 * 2): the person sends the logo the firm already uses, ONE keeps it as a PNG and reads its main colour by a rule, and
 * the person confirms the colour or chooses another. Who manages the firm, with the second factor (the database).
 */

export type BrandResult = { ok: true; color: string | null; logoUrl: string | null } | { ok: false; code: string };

const CODES = [
  "not_allowed_in_support_session",
  "second_factor_required",
  "not_authorized",
  "type_not_allowed",
  "too_large",
  "invalid_color",
  "file_not_found",
] as const;
const codeOf = (message: unknown): string => {
  const text = typeof message === "string" ? message : "";
  return CODES.find((code) => text.includes(code)) ?? "failed";
};

async function manager() {
  const context = await getMemberContext();
  return context?.firm && isManager(context.firm.role) ? context : null;
}

/** Starts the upload of the logo: where the browser sends its bytes. */
export async function startLogoUpload(input: { name: string; mime: string; bytes: number }) {
  const context = await manager();
  if (!context) return { ok: false as const, code: "not_authorized" };
  if (!(LOGO_MIMES as readonly string[]).includes(input.mime)) return { ok: false as const, code: "type_not_allowed" };
  return startUpload(context, { purpose: "brand", name: input.name, mime: input.mime, bytes: input.bytes });
}

/**
 * The logo sent: measured, read, kept as ONE's PNG beside it, and its colour read. A file that is no image ONE reads
 * (a PDF, a Word file: the letterhead's) is refused with why.
 */
export async function readFirmLogo(fileId: string): Promise<BrandResult> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return { ok: false, code: "file_not_found" };
  const finished = await finishUpload(context, fileId);
  if (!finished.ok) return { ok: false, code: codeOf(finished.code) };

  const { data: file } = await context.supabase
    .from("files")
    .select("id, storage_path, detected_mime, purpose")
    .eq("id", fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file || file.purpose !== "brand") return { ok: false, code: "file_not_found" };
  if (!(LOGO_MIMES as readonly string[]).includes(String(file.detected_mime))) {
    return { ok: false, code: "type_not_allowed" };
  }

  let backend;
  try {
    backend = createServiceClient();
  } catch {
    return { ok: false, code: "failed" };
  }
  const store = supabaseFileStore(backend);
  const bytes = await store.get(String(file.storage_path));
  if (!bytes) return { ok: false, code: "file_not_found" };
  let logo;
  try {
    logo = await normalizeLogo(bytes);
  } catch {
    return { ok: false, code: "unreadable" };
  }

  // ONE's PNG, kept by the backend beside what the firm sent.
  const reserved = await store.reserve({
    orgId: context.firm.id,
    purpose: "brand",
    name: "logomarca.png",
    mime: "image/png",
    bytes: logo.png.byteLength,
    requestedBy: context.userId,
  });
  if (!reserved.ok) return { ok: false, code: codeOf(reserved.code) };
  await store.put(reserved.storagePath, logo.png, "image/png");
  const confirmed = await store.confirm(reserved.fileId, await measureFile(logo.png));
  if (!confirmed.ok) return { ok: false, code: "failed" };

  const { data, error } = await context.supabase.rpc("set_firm_logo", {
    target_org: context.firm.id,
    target_source_file: fileId,
    target_logo_file: reserved.fileId,
    target_width: logo.width,
    target_height: logo.height,
    target_color: logo.color,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };

  const { data: brand } = await context.supabase
    .from("firm_brands")
    .select("color")
    .eq("org_id", context.firm.id)
    .maybeSingle();
  const link = await downloadUrl(context, reserved.fileId).catch(() => null);
  revalidatePath("/configurar");
  revalidatePath("/inicio");
  return {
    ok: true,
    color: typeof brand?.color === "string" ? brand.color : null,
    logoUrl: link?.ok ? link.url : null,
  };
}

/** The firm's colour, chosen by the person; null gives it back to the logo's. */
export async function setFirmColor(color: string | null): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, code: "invalid_color" };
  const { data, error } = await context.supabase.rpc("set_firm_color", {
    target_org: context.firm.id,
    target_color: color,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  revalidatePath("/configurar");
  return { ok: true };
}
