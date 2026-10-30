"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";

import { getMemberContext } from "@/lib/member/context";
import { dateLabel, memberUrl } from "@/lib/messages/format";
import { tellPartnerJoined, tellPartnershipEnded } from "@/lib/partners/notices";
import { isPartnerManager } from "@/lib/partners/partner";
import { sendPartnerInvitationEmail } from "@flyee/email";

/**
 * Everything a firm does with its partners, and a partner with its own team (migration 0069), as server actions.
 *
 * No rule is decided here: each action calls the function of the database that checks who asks, the second
 * factor and the support visit, and records the audit event. What this file adds is what the database cannot do:
 * mint the token of an invitation link (only its hash is kept), send the e-mail, ring the bell of the other side
 * of a partnership that began or ended (`notices.ts`), and fold an answer into a code the screens have words for. A server action is a public endpoint: the firm and the partner always come from the
 * caller's own session.
 */

export type PartnerActionResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string };

export type PartnerInviteResult = PartnerActionResult<{
  /** Whether the e-mail left. When it did not, `link` is what the inviter sends by hand. */
  emailed: boolean;
  link: string | null;
}>;

const KNOWN_CODES = [
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_authorized",
  "not_allowed",
  "invalid_email",
  "invalid_partner_name",
  "already_member",
  "invite_rate_limited",
  "module_not_enabled",
  "no_partnership",
  "only_owner_invites_admin",
  "invalid_role",
  "reason_required",
  "owner_stays",
  "already_in_a_firm",
  "already_in_a_partner",
  "already_partnered",
  "already_accepted",
  "already_revoked",
  "revoked",
  "expired",
  "email_not_confirmed",
  "not_found",
  "not_a_member",
] as const;

const codeOf = (message: string | null | undefined): string =>
  KNOWN_CODES.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string } & Record<string, unknown>;

function fold(data: unknown, error: { message?: string } | null): PartnerActionResult<{ data: RpcAnswer }> {
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (answer.ok === false) return { ok: false, code: codeOf(answer.code) };
  return { ok: true, code: typeof answer.code === "string" ? answer.code : "done", data: answer };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A random token for a link, and the SHA-256 the database keeps of it. */
function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token, "utf8").digest("hex") };
}

/** A change of a partnership reaches the shell too (the menu and the gate read the partner). */
function refresh(): void {
  revalidatePath("/settings/parceiros");
  revalidatePath("/parceiro", "layout");
  revalidatePath("/", "layout");
}

// ---------- The firm's side ----------

/**
 * Who manages the firm invites a travel agency to be its partner in a module, by the agency's name and the e-mail
 * of its first person. Without an e-mail provider the link comes back to the inviter, who sends it by hand.
 */
export async function inviteAgency(input: {
  module: string;
  partnerName: string;
  email: string;
  /** The link comes back to be sent by hand, with no e-mail (the inviter's choice). */
  deliver?: "email" | "link";
}): Promise<PartnerInviteResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const email = input.email.trim().toLowerCase();
  const { token, hash } = mintToken();
  const { data, error } = await context.supabase.rpc("firm_invite_partner", {
    target_org: context.firm.id,
    target_module: input.module,
    target_partner_name: input.partnerName,
    target_email: email,
    target_token_hash: hash,
  });
  const result = fold(data, error);
  if (!result.ok) return result;

  const link = memberUrl(`/parceria/${token}`);
  if (input.deliver === "link") {
    refresh();
    return { ok: true, code: result.code, emailed: false, link };
  }
  const expiresAt = typeof result.data.expires_at === "string" ? result.data.expires_at : null;
  const sent = await sendPartnerInvitationEmail(
    email,
    {
      locale: context.locale,
      partnerName: input.partnerName.trim().replace(/\s+/g, " "),
      firmName: context.firm.name,
      inviterName: context.profile.displayName || null,
      acceptUrl: link,
      expiresLabel: expiresAt ? dateLabel(expiresAt, context.locale) : "",
    },
    context.email || null,
  );
  refresh();
  return { ok: true, code: result.code, emailed: sent.sent, link: sent.sent ? null : link };
}

/** Takes back an invitation the caller's firm, or the caller's partner, sent and nobody accepted. */
export async function revokePartnerInvitation(invitationId: string): Promise<PartnerActionResult> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  if (!UUID.test(invitationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("revoke_partner_invitation", {
    target_invitation: invitationId,
  });
  const result = fold(data, error);
  if (result.ok) refresh();
  return result.ok ? { ok: true, code: result.code } : result;
}

/** Ends a partnership, with the reason the firm keeps: who manages the firm, or who manages the partner. */
export async function endPartnership(linkId: string, reason: string): Promise<PartnerActionResult> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  if (!UUID.test(linkId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("end_partner_link", {
    target_link: linkId,
    target_reason: reason,
  });
  const result = fold(data, error);
  if (result.ok) {
    // The other side of the partnership is told: the agency when the firm ended it, the firm when the agency did.
    if (result.code === "ended") await tellPartnershipEnded(linkId, context.partner ? "partner" : "firm");
    refresh();
  }
  return result.ok ? { ok: true, code: result.code } : result;
}

// ---------- Joining a partner ----------

/** Accepts an invitation to a partner addressed to the caller's own confirmed e-mail. */
export async function acceptPartnerInvitation(invitationId: string): Promise<PartnerActionResult> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  if (!UUID.test(invitationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("accept_partner_invitation", {
    target_invitation: invitationId,
  });
  const result = fold(data, error);
  if (result.ok) {
    // An agency that accepted a firm's invitation is its partner now: who manages the firm hears it.
    const linkId = typeof result.data.link_id === "string" ? result.data.link_id : null;
    if (result.code === "partnered" && linkId) await tellPartnerJoined(linkId);
    refresh();
  }
  return result.ok ? { ok: true, code: result.code } : result;
}

// ---------- The partner's own team ----------

/** Who manages the partner brings a colleague in, as an admin or a member. */
export async function invitePartnerColleague(input: {
  email: string;
  role: "admin" | "member";
  /** The link comes back to be sent by hand, with no e-mail (the inviter's choice). */
  deliver?: "email" | "link";
}): Promise<PartnerInviteResult> {
  const context = await getMemberContext();
  if (!context?.partner || !isPartnerManager(context.partner.role)) return { ok: false, code: "not_authorized" };
  if (input.role !== "admin" && input.role !== "member") return { ok: false, code: "invalid_role" };
  const email = input.email.trim().toLowerCase();
  const { token, hash } = mintToken();
  const { data, error } = await context.supabase.rpc("invite_to_partner", {
    target_partner: context.partner.id,
    target_email: email,
    target_role: input.role,
    target_token_hash: hash,
  });
  const result = fold(data, error);
  if (!result.ok) return result;

  const link = memberUrl(`/parceria/${token}`);
  if (input.deliver === "link") {
    refresh();
    return { ok: true, code: result.code, emailed: false, link };
  }
  const expiresAt = typeof result.data.expires_at === "string" ? result.data.expires_at : null;
  const sent = await sendPartnerInvitationEmail(
    email,
    {
      locale: context.locale,
      partnerName: context.partner.name,
      firmName: null,
      inviterName: context.profile.displayName || null,
      acceptUrl: link,
      expiresLabel: expiresAt ? dateLabel(expiresAt, context.locale) : "",
    },
    context.email || null,
  );
  refresh();
  return { ok: true, code: result.code, emailed: sent.sent, link: sent.sent ? null : link };
}

/** Takes a person out of the caller's partner, or the caller out of it (`leave`). */
export async function removePartnerMember(userId: string): Promise<PartnerActionResult> {
  const context = await getMemberContext();
  if (!context?.partner) return { ok: false, code: "not_authorized" };
  if (!UUID.test(userId)) return { ok: false, code: "not_a_member" };
  const { data, error } = await context.supabase.rpc("remove_partner_member", {
    target_partner: context.partner.id,
    target_user: userId,
  });
  const result = fold(data, error);
  if (result.ok) refresh();
  return result.ok ? { ok: true, code: result.code } : result;
}

/** Renames the caller's partner. */
export async function renamePartner(name: string): Promise<PartnerActionResult> {
  const context = await getMemberContext();
  if (!context?.partner) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("rename_partner", {
    target_partner: context.partner.id,
    target_name: name,
  });
  const result = fold(data, error);
  if (result.ok) refresh();
  return result.ok ? { ok: true, code: result.code } : result;
}
