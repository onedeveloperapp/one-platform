"use server";

import { revalidatePath } from "next/cache";

import { examplesOf, type FirmProfile, type ProfileExample, profileOf } from "@/lib/firm/personality";
import { queuePersonalityWriting } from "@/lib/firm/personality-work";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's profile in the setup (migration 0272): who manages the firm asks ONE to write it (the first time, or
 * again with their words on what to change, and the site's address once), reads it while ONE writes, and approves
 * it. The second factor and the record are the database's.
 */

export type PersonalityVersion = { id: string; version: number; profile: FirmProfile; examples: ProfileExample[] };

export type PersonalityState = {
  /** ONE's writing owed: waiting or under way, failed with why, or none. */
  writing: { status: "waiting" | "working" | "failed"; failure: string | null } | null;
  draft: PersonalityVersion | null;
  approved: PersonalityVersion | null;
  /** The site's address the firm gave, and whether ONE read it already. */
  site: { url: string; read: boolean } | null;
};

const CODES = [
  "not_allowed_in_support_session",
  "second_factor_required",
  "not_authorized",
  "invalid_change",
  "invalid_site",
  "not_found",
] as const;
const codeOf = (message: unknown): string => {
  const text = typeof message === "string" ? message : "";
  return CODES.find((code) => text.includes(code)) ?? "failed";
};

async function manager() {
  const context = await getMemberContext();
  return context?.firm && isManager(context.firm.role) ? context : null;
}

/** ONE writes the profile again with the person's words, or for the first time; the site's address read once. */
export async function requestFirmPersonality(input: {
  change?: string | null;
  site?: string | null;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const change = typeof input.change === "string" ? input.change.slice(0, 1000) : null;
  const site = typeof input.site === "string" ? input.site.slice(0, 300) : null;
  const { data, error } = await context.supabase.rpc("request_firm_personality", {
    target_org: context.firm.id,
    target_change: change,
    target_site: site,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  queuePersonalityWriting();
  return { ok: true };
}

/** The draft the person read becomes the firm's profile. */
export async function approveFirmPersonality(
  personalityId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await manager();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!/^[0-9a-f-]{36}$/i.test(personalityId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("approve_firm_personality", {
    target_org: context.firm.id,
    target_personality: personalityId,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: codeOf(answer.code) };
  revalidatePath("/configurar");
  revalidatePath("/inicio");
  return { ok: true };
}

const versionOf = (row: Record<string, unknown> | undefined): PersonalityVersion | null => {
  if (!row || typeof row.id !== "string") return null;
  const profile = profileOf(row.profile);
  return profile ? { id: row.id, version: Number(row.version), profile, examples: examplesOf(row.examples) } : null;
};

/** Where the firm's profile stands, under the person's own session: what the setup's step shows and follows. */
export async function readFirmPersonality(): Promise<PersonalityState | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const [versions, writing, org] = await Promise.all([
    context.supabase
      .from("firm_personalities")
      .select("id, version, profile, examples, status")
      .eq("org_id", context.firm.id)
      .in("status", ["draft", "approved"]),
    context.supabase
      .from("firm_personality_requests")
      .select("status, failure")
      .eq("org_id", context.firm.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("organizations")
      .select("personality_site_url, personality_site_read_at")
      .eq("id", context.firm.id)
      .maybeSingle(),
  ]);
  if (versions.error) return null;
  const rows = (versions.data ?? []) as Record<string, unknown>[];
  const last = writing.data as { status?: string; failure?: string | null } | null;
  const siteRow = org.data as { personality_site_url: string | null; personality_site_read_at: string | null } | null;
  return {
    writing:
      last && (last.status === "waiting" || last.status === "working" || last.status === "failed")
        ? { status: last.status, failure: last.failure ?? null }
        : null,
    draft: versionOf(rows.find((row) => row.status === "draft")),
    approved: versionOf(rows.find((row) => row.status === "approved")),
    site: siteRow?.personality_site_url
      ? { url: siteRow.personality_site_url, read: Boolean(siteRow.personality_site_read_at) }
      : null,
  };
}
