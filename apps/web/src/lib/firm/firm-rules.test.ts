import { describe, expect, it } from "vitest";

import {
  decideGate,
  FIRM_SETUP_PATH,
  isSecondFactorSetupPath,
  owesSecondFactor,
  PARTNER_HOME,
  SECOND_FACTOR_REQUIRED_URL,
  shellHold,
} from "@/lib/firm/gate-rules";
import {
  FIRM_FUNCTIONS,
  formatOab,
  FUNCTION_HINT_KEY,
  FUNCTION_LABEL_KEY,
  isFirmFunction,
  isInvitableRole,
  isManager,
  isOrgRole,
  OAB_STATES,
  ROLE_LABEL_KEY,
} from "@/lib/firm/roles";
import messages from "@flyee/content/messages/pt-BR.json";

const inFirm = {
  path: "/inicio",
  hasFirm: true,
  isSuperadmin: false,
  impersonating: false,
  secondFactorRequired: false,
  hasSecondFactor: false,
};

describe("the gate of the logged area", () => {
  it("lets a person of a firm through", () => {
    expect(decideGate(inFirm)).toBeNull();
  });

  it("keeps somebody of a partner in its area and their own account", () => {
    const agency = { ...inFirm, hasFirm: false, isPartner: true, hasSecondFactor: true };
    for (const path of [
      "/parceiro",
      "/parceiro/equipe",
      "/parceiro/passageiros/abc",
      "/settings",
      "/settings/security",
    ]) {
      expect(decideGate({ ...agency, path })).toBeNull();
    }
    for (const path of ["/inicio", "/casos", "/settings/team", "/settings/parceiros", "/admin", "/parceirosx"]) {
      expect(decideGate({ ...agency, path })).toEqual({ redirectTo: PARTNER_HOME });
    }
    // The second factor first, as for anybody the rule asks it of.
    expect(decideGate({ ...agency, path: "/parceiro", secondFactorRequired: true, hasSecondFactor: false })).toEqual({
      redirectTo: SECOND_FACTOR_REQUIRED_URL,
    });
    // Never sent to found a firm, and the shell holds the same answer.
    expect(shellHold({ hasFirm: false, partner: true, isSuperadmin: false, owesSecondFactor: false }, "/casos")).toBe(
      PARTNER_HOME,
    );
    expect(
      shellHold({ hasFirm: false, partner: true, isSuperadmin: false, owesSecondFactor: false }, "/parceiro"),
    ).toBeNull();
  });

  it("sends an account with no firm to found one or accept an invitation, whatever it asked for", () => {
    for (const path of ["/inicio", "/settings", "/settings/team", "/admin", ""]) {
      expect(decideGate({ ...inFirm, path, hasFirm: false })).toEqual({ redirectTo: FIRM_SETUP_PATH });
    }
  });

  it("keeps the platform operator, who works in no firm, on the consoles and the own account", () => {
    const operator = { ...inFirm, hasFirm: false, isSuperadmin: true, hasSecondFactor: true };
    expect(decideGate({ ...operator, path: "/admin/escritorios" })).toBeNull();
    expect(decideGate({ ...operator, path: "/settings/security" })).toBeNull();
    expect(decideGate({ ...operator, path: "/inicio" })).toEqual({ redirectTo: "/admin" });
  });

  it("sends who must have a second factor, and has none, to set it up before anything else", () => {
    const manager = { ...inFirm, secondFactorRequired: true };
    expect(decideGate(manager)).toEqual({ redirectTo: SECOND_FACTOR_REQUIRED_URL });
    expect(decideGate({ ...manager, path: "/settings/team" })).toEqual({ redirectTo: SECOND_FACTOR_REQUIRED_URL });
    // The page where it is set up is the one place still open, or the redirect would loop.
    expect(decideGate({ ...manager, path: "/settings/security" })).toBeNull();
    expect(decideGate({ ...manager, hasSecondFactor: true })).toBeNull();
  });

  it("asks the operator for a second factor too, on the consoles as anywhere", () => {
    const operator = { ...inFirm, hasFirm: false, isSuperadmin: true, secondFactorRequired: true, path: "/admin" };
    expect(decideGate(operator)).toEqual({ redirectTo: SECOND_FACTOR_REQUIRED_URL });
  });

  it("never redirects for the second factor when the path is unknown, so a missing header cannot loop", () => {
    expect(decideGate({ ...inFirm, path: "", secondFactorRequired: true })).toBeNull();
  });

  it("asks nothing of a support visit: the operator cannot set up somebody else's factor", () => {
    expect(decideGate({ ...inFirm, impersonating: true, secondFactorRequired: true })).toBeNull();
    // A visit still cannot enter the app of an account that has no firm.
    expect(decideGate({ ...inFirm, impersonating: true, hasFirm: false })).toEqual({ redirectTo: FIRM_SETUP_PATH });
  });

  it("says who owes a second factor, for the shell to keep them on the security screen on every later page", () => {
    expect(owesSecondFactor({ ...inFirm, secondFactorRequired: true })).toBe(true);
    // The security screen itself lets them through, and still they owe it.
    expect(decideGate({ ...inFirm, path: "/settings/security", secondFactorRequired: true })).toBeNull();
    expect(owesSecondFactor({ ...inFirm, secondFactorRequired: true, hasSecondFactor: true })).toBe(false);
    expect(owesSecondFactor(inFirm)).toBe(false);
    expect(owesSecondFactor({ ...inFirm, impersonating: true, secondFactorRequired: true })).toBe(false);
  });

  it("keeps a person where the gate would send them, on the pages opened after the first one", () => {
    const owes = { hasFirm: true, isSuperadmin: false, owesSecondFactor: true };
    for (const path of ["/inicio", "/casos", "/casos/abc", "/settings", "/settings/team", "/admin"]) {
      expect(shellHold(owes, path)).toBe(SECOND_FACTOR_REQUIRED_URL);
    }
    expect(shellHold(owes, "/settings/security")).toBeNull();
    // Nobody who owes nothing is held.
    expect(shellHold({ ...owes, owesSecondFactor: false }, "/casos")).toBeNull();
    // The platform operator, who works in no firm, is kept on the consoles and the own settings.
    const operator = { hasFirm: false, isSuperadmin: true, owesSecondFactor: false };
    expect(shellHold(operator, "/inicio")).toBe("/admin");
    expect(shellHold(operator, "/admin/escritorios")).toBeNull();
    expect(shellHold(operator, "/settings/security")).toBeNull();
    expect(shellHold({ ...operator, owesSecondFactor: true }, "/admin")).toBe(SECOND_FACTOR_REQUIRED_URL);
    // An account with no firm is sent out of the logged area by the layout, never held by the shell.
    expect(shellHold({ hasFirm: false, isSuperadmin: false, owesSecondFactor: false }, "/inicio")).toBeNull();
  });

  it("holds exactly where the gate redirects, inside the logged area", () => {
    const paths = ["/inicio", "/casos", "/settings", "/settings/security", "/admin", "/admin/ai", "/agenda"];
    for (const hasFirm of [true, false]) {
      for (const isSuperadmin of [true, false]) {
        for (const owes of [true, false]) {
          for (const path of paths) {
            const gate = decideGate({
              path,
              hasFirm,
              isSuperadmin,
              impersonating: false,
              secondFactorRequired: owes,
              hasSecondFactor: !owes,
            });
            const inside = gate && gate.redirectTo !== FIRM_SETUP_PATH ? gate.redirectTo : null;
            expect(shellHold({ hasFirm, isSuperadmin, owesSecondFactor: owes }, path)).toBe(inside);
          }
        }
      }
    }
  });

  it("opens to who owes a second factor the security screen alone", () => {
    expect(isSecondFactorSetupPath("/settings/security")).toBe(true);
    expect(isSecondFactorSetupPath("/settings/security/")).toBe(true);
    expect(isSecondFactorSetupPath("/settings/securityx")).toBe(false);
    expect(isSecondFactorSetupPath("/settings")).toBe(false);
    expect(isSecondFactorSetupPath("/inicio")).toBe(false);
  });
});

describe("roles and functions of a firm", () => {
  it("knows the values the database knows, and nothing else", () => {
    expect(FIRM_FUNCTIONS).toEqual(["socio", "advogado", "controladoria", "atendimento"]);
    expect(isFirmFunction("advogado")).toBe(true);
    expect(isFirmFunction("estagiario")).toBe(false);
    expect(isOrgRole("owner")).toBe(true);
    expect(isOrgRole("superadmin")).toBe(false);
  });

  it("never lets an invitation carry the ownership: a firm is handed over, not assigned", () => {
    expect(isInvitableRole("member")).toBe(true);
    expect(isInvitableRole("admin")).toBe(true);
    expect(isInvitableRole("owner")).toBe(false);
  });

  it("calls the owner and the admins the managers of the firm account", () => {
    expect(isManager("owner")).toBe(true);
    expect(isManager("admin")).toBe(true);
    expect(isManager("member")).toBe(false);
    expect(isManager(null)).toBe(false);
  });

  it("has words in the catalog for every role and every function", () => {
    const product = messages.product as Record<string, string>;
    for (const key of [
      ...Object.values(ROLE_LABEL_KEY),
      ...Object.values(FUNCTION_LABEL_KEY),
      ...Object.values(FUNCTION_HINT_KEY),
    ]) {
      expect(product[key], key).toBeTruthy();
    }
  });
});

describe("registrations at the bar", () => {
  it("writes a registration as the bar does", () => {
    expect(formatOab({ uf: "GO", number: "12345" })).toBe("OAB/GO 12.345");
    expect(formatOab({ uf: "SP", number: "1234567" })).toBe("OAB/SP 1.234.567");
    expect(formatOab({ uf: "RJ", number: "77" })).toBe("OAB/RJ 77");
    // Some sections append a letter to the number.
    expect(formatOab({ uf: "SP", number: "77A" })).toBe("OAB/SP 77-A");
  });

  it("lists the 27 sections of the bar", () => {
    expect(OAB_STATES).toHaveLength(27);
    expect(new Set(OAB_STATES).size).toBe(27);
    expect(OAB_STATES).toContain("DF");
  });
});
