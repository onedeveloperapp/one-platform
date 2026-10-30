"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";

import { isCertificateKind, isCourtSystemName } from "@/lib/cases/statements";
import { type FirmFunction, type InvitableRole, isFirmFunction, isInvitableRole, OAB_STATES } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { dateLabel, memberUrl } from "@/lib/messages/format";
import { trackServerEvent } from "@/lib/product-events-server";
import { persistSignupAttribution } from "@/lib/signup-attribution";
import { firmFunctionLabel, sendFirmInvitationEmail } from "@flyee/email";

/**
 * Everything a person does to the team of a firm, as server actions.
 *
 * No rule is decided here. Each action calls the function of migration 0003
 * that takes the firm, checks who is asking, asks for the second factor when
 * the change gives or takes access, and records the audit event. What this
 * file adds is what the database cannot do: mint the token of an invitation
 * link (only its hash is stored), send the e-mail, and turn an error into a
 * code the screen has words for.
 *
 * A server action is a public endpoint, so nothing here trusts an id it is
 * handed: the firm always comes from the caller's own session.
 */

export type FirmActionResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string };

/** What the database raises or answers, by the name the screens have a message for. */
const KNOWN_CODES = [
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_authorized",
  "already_in_a_firm",
  "invalid_firm_name",
  "invalid_firm_function",
  "invalid_email",
  "invalid_role",
  "only_owner_invites_admin",
  "already_member",
  "seat_limit",
  "invite_rate_limited",
  "not_found",
  "email_not_confirmed",
  "already_accepted",
  "already_revoked",
  "revoked",
  "expired",
  "not_a_member",
  "only_owner_changes_managers",
  "owner_role_is_transferred",
  "owner_cannot_be_removed",
  "owner_must_transfer_first",
  "use_leave_firm",
  "invalid_registration",
  "state_already_registered",
  "principal_already_registered",
  "registration_in_use",
] as const;

function codeOf(message: string | null | undefined): string {
  const text = message ?? "";
  return KNOWN_CODES.find((code) => text.includes(code)) ?? "failed";
}

type RpcAnswer = { ok?: boolean; code?: string } & Record<string, unknown>;

/** Folds the two ways a function answers (a raised error, or `{ ok, code }`) into one result. */
function fold(data: unknown, error: { message?: string } | null): FirmActionResult<{ data: RpcAnswer }> {
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (answer.ok === false) return { ok: false, code: codeOf(answer.code) };
  return { ok: true, code: typeof answer.code === "string" ? answer.code : "done", data: answer };
}

const TEAM = "/settings/team";

/** A change to the team reaches the shell too (the menu and the gate read the membership). */
function refreshTeam(): void {
  revalidatePath(TEAM);
  revalidatePath("/", "layout");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Founding and joining ----------

/** Founds a firm with the caller as its owner. An account founds one only while it belongs to none. */
export async function foundFirm(input: {
  name: string;
  firmFunction: FirmFunction;
}): Promise<FirmActionResult<{ orgId: string }>> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  if (!isFirmFunction(input.firmFunction)) return { ok: false, code: "invalid_firm_function" };

  const { data, error } = await context.supabase.rpc("create_firm", {
    firm_name: input.name,
    founder_function: input.firmFunction,
  });
  if (error || typeof data !== "string") return { ok: false, code: codeOf(error?.message) };

  // The firm exists only now, so this is where the campaign that brought the
  // founder is attached to it. Neither call can fail the founding.
  await persistSignupAttribution(data);
  await trackServerEvent({
    actorId: context.userId,
    orgId: data,
    event: "firm.created",
    properties: { role: "owner", firm_function: input.firmFunction },
  });
  refreshTeam();
  return { ok: true, code: "created", orgId: data };
}

/**
 * The first questions of a firm's setup (migration 0044): whether it works
 * alone, which takes the team out of its list, and that they were answered,
 * so the screen that asks them stops asking. Who manages the firm, never in a
 * support visit; the database keeps each answer on the record.
 */
export async function answerFirmSetup(input: {
  worksAlone?: boolean | null;
  finished?: boolean;
}): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("answer_firm_setup", {
    target_org: context.firm.id,
    target_works_alone: typeof input.worksAlone === "boolean" ? input.worksAlone : null,
    target_finished: input.finished === true,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  revalidatePath("/inicio");
  revalidatePath("/configurar");
  return { ok: true, code: result.code };
}

/** Accepts an invitation addressed to the caller's own confirmed e-mail. */
export async function acceptInvitation(invitationId: string): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  if (!UUID.test(invitationId)) return { ok: false, code: "not_found" };

  const { data, error } = await context.supabase.rpc("accept_firm_invitation", { target_invitation: invitationId });
  const result = fold(data, error);
  if (!result.ok) return result;

  const orgId = typeof result.data.org_id === "string" ? result.data.org_id : null;
  await trackServerEvent({ actorId: context.userId, orgId, event: "invite.accepted" });
  refreshTeam();
  return { ok: true, code: result.code };
}

/** Renames the caller's firm. Owner or admin (the database decides), audited with the name before and after. */
export async function renameFirm(name: string): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };

  const { data, error } = await context.supabase.rpc("rename_firm", { target_org: context.firm.id, new_name: name });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

// ---------- Invitations ----------

export type InviteResult = FirmActionResult<{
  /** Whether the e-mail left. When it did not, `link` is what the manager sends by hand. */
  emailed: boolean;
  link: string | null;
}>;

/**
 * Invites an address to the caller's firm. The token of the link is minted
 * here and only its SHA-256 goes to the database; the link goes to the
 * invited address by e-mail, or, when the manager chose to send it themself
 * (`deliver: "link"`) or the e-mail could not leave (no provider where ONE
 * runs), comes back to the manager, who sends it by hand.
 */
export async function inviteToFirm(input: {
  email: string;
  role: InvitableRole;
  firmFunction: FirmFunction;
  deliver?: "email" | "link";
}): Promise<InviteResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isInvitableRole(input.role)) return { ok: false, code: "invalid_role" };
  if (!isFirmFunction(input.firmFunction)) return { ok: false, code: "invalid_firm_function" };

  const email = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const { data, error } = await context.supabase.rpc("invite_to_firm", {
    target_org: context.firm.id,
    target_email: email,
    target_role: input.role,
    target_function: input.firmFunction,
    target_token_hash: tokenHash,
  });
  const result = fold(data, error);
  if (!result.ok) return result;

  const link = memberUrl(`/convite/${token}`);
  if (input.deliver === "link") {
    refreshTeam();
    return { ok: true, code: result.code, emailed: false, link };
  }
  const expiresAt = typeof result.data.expires_at === "string" ? result.data.expires_at : null;
  const sent = await sendFirmInvitationEmail(
    email,
    {
      locale: context.locale,
      firmName: context.firm.name,
      inviterName: context.profile.displayName || null,
      functionLabel: firmFunctionLabel(context.locale, input.firmFunction),
      acceptUrl: link,
      expiresLabel: expiresAt ? dateLabel(expiresAt, context.locale) : "",
    },
    context.email || null,
  );
  refreshTeam();
  return { ok: true, code: result.code, emailed: sent.sent, link: sent.sent ? null : link };
}

export async function revokeInvitation(invitationId: string): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!UUID.test(invitationId)) return { ok: false, code: "not_found" };

  const { data, error } = await context.supabase.rpc("revoke_firm_invitation", { target_invitation: invitationId });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

// ---------- People of the firm ----------

async function changeMember(
  rpc: "set_member_function" | "set_member_role" | "remove_firm_member" | "transfer_firm_ownership",
  targetUser: string,
  extra: Record<string, string> = {},
): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!UUID.test(targetUser)) return { ok: false, code: "not_a_member" };

  const subject = rpc === "transfer_firm_ownership" ? { new_owner: targetUser } : { target_user: targetUser };
  const { data, error } = await context.supabase.rpc(rpc, { target_org: context.firm.id, ...subject, ...extra });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

export async function setMemberFunction(targetUser: string, firmFunction: FirmFunction): Promise<FirmActionResult> {
  if (!isFirmFunction(firmFunction)) return { ok: false, code: "invalid_firm_function" };
  return changeMember("set_member_function", targetUser, { new_function: firmFunction });
}

/** Makes a person an admin, or an admin a plain member again. Owner only (the database decides). */
export async function setMemberRole(targetUser: string, role: InvitableRole): Promise<FirmActionResult> {
  if (!isInvitableRole(role)) return { ok: false, code: "invalid_role" };
  return changeMember("set_member_role", targetUser, { new_role: role });
}

export async function removeMember(targetUser: string): Promise<FirmActionResult> {
  return changeMember("remove_firm_member", targetUser);
}

export async function transferOwnership(targetUser: string): Promise<FirmActionResult> {
  return changeMember("transfer_firm_ownership", targetUser);
}

/** The caller leaves their firm. The owner cannot: the firm is handed over first. */
export async function leaveFirm(): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_a_member" };

  const { data, error } = await context.supabase.rpc("leave_firm", { target_org: context.firm.id });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

// ---------- Registrations at the bar ----------

export async function addOabRegistration(input: {
  uf: string;
  number: string;
  kind: "principal" | "suplementar";
}): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  const uf = input.uf.trim().toUpperCase();
  if (!(OAB_STATES as readonly string[]).includes(uf)) return { ok: false, code: "invalid_registration" };
  if (input.kind !== "principal" && input.kind !== "suplementar") return { ok: false, code: "invalid_registration" };

  const { data, error } = await context.supabase.rpc("add_oab_registration", {
    target_uf: uf,
    target_number: input.number,
    target_kind: input.kind,
  });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

export async function removeOabRegistration(registrationId: string): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "not_authorized" };
  if (!UUID.test(registrationId)) return { ok: false, code: "not_found" };

  const { data, error } = await context.supabase.rpc("remove_oab_registration", {
    target_registration: registrationId,
  });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

// ---------- What a lawyer signs with (migration 0026) ----------

/**
 * A lawyer declares the kind of certificate they sign with in a court system
 * of their firm, or confirms today that their computer signs there. Nothing
 * of the certificate itself is asked: the kind, who issued it and a date.
 */
export async function saveCertificateEntry(input: {
  system: string;
  kind: string;
  issuer: string | null;
  validUntil: string | null;
  stationChecked: boolean;
}): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isCourtSystemName(input?.system)) return { ok: false, code: "invalid_system" };
  if (!isCertificateKind(input?.kind)) return { ok: false, code: "invalid_kind" };
  const validUntil = typeof input.validUntil === "string" && DAY.test(input.validUntil) ? input.validUntil : null;

  const { data, error } = await context.supabase.rpc("save_certificate_entry", {
    target_org: context.firm.id,
    target_system: input.system,
    target_kind: input.kind,
    target_issuer: typeof input.issuer === "string" ? input.issuer.slice(0, 80) : null,
    target_valid_until: validUntil,
    target_station_checked: input.stationChecked === true,
  });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}

export async function removeCertificateEntry(system: string): Promise<FirmActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!isCourtSystemName(system)) return { ok: false, code: "not_found" };

  const { data, error } = await context.supabase.rpc("remove_certificate_entry", {
    target_org: context.firm.id,
    target_system: system,
  });
  const result = fold(data, error);
  if (result.ok) refreshTeam();
  return result.ok ? { ok: true, code: result.code } : result;
}
