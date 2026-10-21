import { describe, expect, it } from "vitest";

import { decideGate, FIRM_SETUP_PATH, SECOND_FACTOR_REQUIRED_URL } from "@/lib/firm/gate-rules";
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
