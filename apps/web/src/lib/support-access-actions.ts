"use server";

import { requireSuperadmin } from "@/lib/admin/session";
import { getMemberContext } from "@/lib/member/context";
import { notifyUsers } from "@/lib/notifications";

/**
 * The support's access to a firm (migration 0203): the firm lets ONE's support in for some hours, or ends it; the
 * operator reads, before a visit, whether the firm of the person let it in, and asks it when not.
 */

export type FirmSupportAccess = {
  manages: boolean;
  maxHours: number;
  live: { grantedAt: string; endsAt: string; note: string | null; grantedBy: string } | null;
  visits: { startedAt: string; endedAt: string | null; reason: string }[];
};

/** What anybody of the firm reads of the support's access. */
export async function readFirmSupportAccess(): Promise<{ ok: true; access: FirmSupportAccess } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const { data, error } = await context.supabase.rpc("firm_support_access", { target_org: context.firm.id });
  if (error || !data) return { ok: false };
  const raw = data as Record<string, unknown>;
  const live = raw.live && typeof raw.live === "object" ? (raw.live as Record<string, unknown>) : null;
  return {
    ok: true,
    access: {
      manages: raw.manages === true,
      maxHours: Number(raw.max_hours) || 168,
      live:
        live && typeof live.ends_at === "string"
          ? {
              grantedAt: String(live.granted_at ?? ""),
              endsAt: live.ends_at,
              note: typeof live.note === "string" ? live.note : null,
              grantedBy: typeof live.granted_by === "string" ? live.granted_by : "",
            }
          : null,
      visits: (Array.isArray(raw.visits) ? raw.visits : []).flatMap((visit) => {
        const row = visit as Record<string, unknown>;
        return typeof row.started_at === "string"
          ? [
              {
                startedAt: row.started_at,
                endedAt: typeof row.ended_at === "string" ? row.ended_at : null,
                reason: typeof row.reason === "string" ? row.reason : "",
              },
            ]
          : [];
      }),
    },
  };
}

export type SupportAccessWrite = { ok: true } | { ok: false; code: string; factor?: "missing" | "challenge" };

/** Who manages the firm's account, or decides for it, lets the support in for some hours, with the second factor. */
export async function grantSupportAccess(hours: number, note: string): Promise<SupportAccessWrite> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("grant_support_access", {
    target_org: context.firm.id,
    target_hours: Math.round(hours),
    target_note: note.trim() || null,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok) return { ok: true };
  if (answer.code === "second_factor") {
    const { data: assurance } = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return { ok: false, code: "second_factor", factor: assurance?.nextLevel === "aal2" ? "challenge" : "missing" };
  }
  return { ok: false, code: answer.code ?? "failed" };
}

/** The same people end the authorization in force, at once. */
export async function endSupportAccess(): Promise<SupportAccessWrite> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("end_support_access", { target_org: context.firm.id });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return answer.ok ? { ok: true } : { ok: false, code: answer.code ?? "failed" };
}

export type SupportAccessFor = {
  firm: string | null;
  firmName: string | null;
  authorized: boolean;
  endsAt: string | null;
};

/** The operator's read before a visit: the firm of the person and whether it let the support in, until when. */
export async function readSupportAccessFor(userId: string): Promise<SupportAccessFor | null> {
  const session = await requireSuperadmin();
  if (!session) return null;
  const { data, error } = await session.supabase.rpc("admin_support_access_for", { target_user: userId });
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  return {
    firm: typeof raw.firm === "string" ? raw.firm : null,
    firmName: typeof raw.firm_name === "string" ? raw.firm_name : null,
    authorized: raw.authorized === true,
    endsAt: typeof raw.ends_at === "string" ? raw.ends_at : null,
  };
}

/** The operator asks a firm to let the support in, saying why: who manages it is told on the bell. */
export async function requestSupportAccess(orgId: string, reason: string): Promise<{ ok: boolean; code?: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_request_support_access", {
    target_org: orgId,
    target_reason: reason.trim(),
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; people?: string[] };
  if (!answer.ok) return { ok: false, code: answer.code ?? "failed" };
  await notifyUsers(Array.isArray(answer.people) ? answer.people : [], {
    type: "system",
    title: "O suporte do ONE pede acesso ao escritório",
    body: `Motivo: ${reason.trim()}. Autorize por algumas horas em Configurações, se quiser. Sem a autorização, o suporte não entra.`,
    href: "/settings#acesso-suporte",
  });
  return { ok: true };
}
