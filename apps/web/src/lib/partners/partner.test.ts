import { describe, expect, it } from "vitest";

import {
  isPartnerManager,
  memberPartnerOf,
  PARTNER_ROLE_KEY,
  PARTNER_ROLES,
  partnerErrorKey,
  partnerModules,
} from "@/lib/partners/partner";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("the partner of the person looking", () => {
  it("reads my_partner, keeping the active partnerships it can name", () => {
    const partner = memberPartnerOf({
      id: "p1",
      name: "Viagens Sol",
      kind: "agency",
      role: "admin",
      links: [
        { id: "l1", org_id: "o1", firm: "Souza Advogados", module: "direito-do-passageiro", started_at: "2026-10-29" },
        { id: "l2", org_id: null, firm: "Sem id", module: "direito-do-passageiro" },
      ],
    });
    expect(partner).toEqual({
      id: "p1",
      name: "Viagens Sol",
      role: "admin",
      links: [
        { id: "l1", orgId: "o1", firm: "Souza Advogados", module: "direito-do-passageiro", startedAt: "2026-10-29" },
      ],
    });
    expect(partnerModules(partner)).toEqual(["direito-do-passageiro"]);
  });

  it("answers null for somebody in no partner, or an answer that is not one", () => {
    expect(memberPartnerOf(null)).toBeNull();
    expect(memberPartnerOf([])).toBeNull();
    expect(memberPartnerOf({ id: "p1", name: "X", role: "chefe" })).toBeNull();
    expect(partnerModules(null)).toEqual([]);
  });

  it("knows who manages the partner", () => {
    expect(isPartnerManager("owner")).toBe(true);
    expect(isPartnerManager("admin")).toBe(true);
    expect(isPartnerManager("member")).toBe(false);
    expect(isPartnerManager(null)).toBe(false);
  });

  it("has words for every role and every refusal", () => {
    for (const role of PARTNER_ROLES) expect(product[PARTNER_ROLE_KEY[role]]).toBeTruthy();
    const codes = [
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
      "reason_required",
      "owner_stays",
      "already_in_a_firm",
      "already_in_a_partner",
      "already_partnered",
      "expired",
      "revoked",
      "already_accepted",
      "email_not_confirmed",
      "not_found",
      "whatever",
    ];
    for (const code of codes) expect(product[partnerErrorKey(code)]).toBeTruthy();
  });
});
