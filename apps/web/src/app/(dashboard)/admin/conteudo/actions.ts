"use server";

import { revalidatePath } from "next/cache";

import { requireSuperadmin } from "@/lib/admin/session";

/**
 * What the console of the platform's content does (migration 0045): keep the
 * models of pieces and the sources every firm reads. The database checks the
 * role (and refuses a support visit) and records each change; a server action
 * is a public endpoint, so the role is checked here again.
 */

export type ContentResult = { ok: true; id?: string } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Answer = { ok?: boolean; code?: string; template_id?: string; source_id?: string };

function settled(answer: unknown, error: { message: string } | null): ContentResult {
  if (error) return { ok: false, code: error.message.includes("not_authorized") ? "forbidden" : "failed" };
  const data = (answer ?? {}) as Answer;
  if (!data.ok) return { ok: false, code: String(data.code ?? "failed") };
  revalidatePath("/admin/conteudo");
  revalidatePath("/biblioteca");
  return { ok: true, id: data.template_id ?? data.source_id };
}

export async function savePlatformTemplate(input: {
  templateId: string | null;
  name: string;
  /** What it writes: a piece or a power of attorney (0054). Said on every save: a model saved without it is a piece. */
  documentKind: "piece" | "procuracao";
  proceedingKind: "juizado" | "comum" | null;
  body: string;
  isDefault: boolean;
  provisional: boolean;
}): Promise<ContentResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (input.templateId !== null && !UUID.test(input.templateId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_save_platform_template", {
    target_template: input.templateId,
    fields: {
      name: String(input.name ?? "").trim(),
      document_kind: input.documentKind === "procuracao" ? "procuracao" : "piece",
      proceeding_kind:
        input.documentKind !== "procuracao" && (input.proceedingKind === "juizado" || input.proceedingKind === "comum")
          ? input.proceedingKind
          : null,
      body: String(input.body ?? ""),
      is_default: Boolean(input.isDefault),
      provisional: Boolean(input.provisional),
    },
  });
  return settled(data, error);
}

export async function removePlatformTemplate(templateId: string): Promise<ContentResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!UUID.test(templateId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_remove_platform_template", { target_template: templateId });
  return settled(data, error);
}

export async function savePlatformSource(input: {
  sourceId: string | null;
  kind: string;
  issuer: string;
  number: string;
  article: string;
  title: string;
  quote: string;
  sourceUrl: string;
  note: string;
}): Promise<ContentResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (input.sourceId !== null && !UUID.test(input.sourceId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_save_platform_source", {
    target_source: input.sourceId,
    fields: {
      kind: String(input.kind ?? "").trim(),
      issuer: String(input.issuer ?? "").trim(),
      number: String(input.number ?? "").trim(),
      article: String(input.article ?? "").trim(),
      title: String(input.title ?? "").trim(),
      quote: String(input.quote ?? "").trim(),
      source_url: String(input.sourceUrl ?? "").trim(),
      note: String(input.note ?? "").trim(),
    },
  });
  return settled(data, error);
}

export async function retirePlatformSource(sourceId: string, reason: string): Promise<ContentResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!UUID.test(sourceId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_retire_platform_source", {
    target_source: sourceId,
    target_reason: String(reason ?? "").trim(),
  });
  return settled(data, error);
}
