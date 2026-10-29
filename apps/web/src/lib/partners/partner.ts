/**
 * A partner of a firm (migration 0069): an account that is no firm's, the travel agency a firm partners with in a
 * module. Pure: the reader of the database's answers and the words of the screens (`product` namespace). The
 * module's own work of a partner (its passengers) is the module's; this is the core's half.
 */

export const PARTNER_ROLES = ["owner", "admin", "member"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const isPartnerRole = (value: unknown): value is PartnerRole =>
  (PARTNER_ROLES as readonly unknown[]).includes(value);

/** Who manages the partner's account: brings colleagues in, renames it, ends a partnership. */
export const isPartnerManager = (role: PartnerRole | null | undefined): boolean => role === "owner" || role === "admin";

/** Where somebody of a partner works in ONE. */
export const PARTNER_AREA = "/parceiro";

/** One active partnership of the partner: a firm, in a module. */
export type PartnerLink = { id: string; orgId: string; firm: string; module: string; startedAt: string };

/** The partner of the person looking, as `my_partner` answers it. */
export type MemberPartner = {
  id: string;
  name: string;
  role: PartnerRole;
  links: PartnerLink[];
};

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** The answer of `my_partner`, read; null for somebody in no partner, or an answer that is not one. */
export function memberPartnerOf(raw: unknown): MemberPartner | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name || !isPartnerRole(row.role)) return null;
  const links = (Array.isArray(row.links) ? row.links : []).flatMap((item): PartnerLink[] => {
    const link = (item ?? {}) as Record<string, unknown>;
    const linkId = text(link.id);
    const orgId = text(link.org_id);
    const module = text(link.module);
    if (!linkId || !orgId || !module) return [];
    return [{ id: linkId, orgId, firm: text(link.firm) ?? "", module, startedAt: text(link.started_at) ?? "" }];
  });
  return { id, name, role: row.role, links };
}

/** The modules a partner works in now: those of its active partnerships. */
export const partnerModules = (partner: MemberPartner | null): string[] =>
  partner ? [...new Set(partner.links.map((link) => link.module))] : [];

// The `product` message key of each role, spelled out so the catalog check sees each one.
export const PARTNER_ROLE_KEY: Record<PartnerRole, string> = {
  owner: "partner-role-owner",
  admin: "partner-role-admin",
  member: "partner-role-member",
};

/** The words of a refusal of a partner's function. */
export function partnerErrorKey(code: string): string {
  switch (code) {
    case "second_factor_required":
      return "partner-error-second-factor";
    case "not_allowed_in_support_session":
      return "partner-error-support";
    case "not_authorized":
    case "not_allowed":
      return "partner-error-not-allowed";
    case "invalid_email":
      return "partner-error-email";
    case "invalid_partner_name":
      return "partner-error-name";
    case "already_member":
      return "partner-error-already-member";
    case "invite_rate_limited":
      return "partner-error-rate";
    case "module_not_enabled":
      return "partner-error-module";
    case "no_partnership":
      return "partner-error-no-partnership";
    case "only_owner_invites_admin":
      return "partner-error-only-owner";
    case "reason_required":
      return "partner-error-reason";
    case "owner_stays":
      return "partner-error-owner-stays";
    case "already_in_a_firm":
      return "partner-error-in-firm";
    case "already_in_a_partner":
      return "partner-error-in-partner";
    case "already_partnered":
      return "partner-error-partnered";
    case "expired":
      return "partner-error-expired";
    case "revoked":
      return "partner-error-revoked";
    case "already_accepted":
      return "partner-error-accepted";
    case "email_not_confirmed":
      return "partner-error-email-not-confirmed";
    case "not_found":
      return "partner-error-not-found";
    default:
      return "partner-error-failed";
  }
}
