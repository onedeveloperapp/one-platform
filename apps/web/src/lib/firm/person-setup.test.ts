import { describe, expect, it } from "vitest";

import {
  isPersonSetupStep,
  personFlowKey,
  personSetupOpening,
  personSetupOwed,
  personSetupSteps,
  signsAtTheBar,
} from "@/lib/firm/person-setup";

describe("a person's own setup in a firm", () => {
  it("asks the factor of everybody, first, and the registration of who signs at the bar", () => {
    expect(personSetupSteps("advogado")).toEqual(["seguranca", "oab"]);
    expect(personSetupSteps("socio")).toEqual(["seguranca", "oab"]);
    expect(personSetupSteps("atendimento")).toEqual(["seguranca"]);
    expect(personSetupSteps("controladoria")).toEqual(["seguranca"]);
    expect(signsAtTheBar(null)).toBe(false);
  });

  it("is owed while the account has no factor, or a lawyer has no registration", () => {
    expect(personSetupOwed({ hasFactor: false, firmFunction: "atendimento", registered: false })).toBe(true);
    expect(personSetupOwed({ hasFactor: true, firmFunction: "atendimento", registered: false })).toBe(false);
    // The DJEN is read by the registrations of the firm's people: a lawyer with none has their publications unread.
    expect(personSetupOwed({ hasFactor: true, firmFunction: "advogado", registered: false })).toBe(true);
    expect(personSetupOwed({ hasFactor: true, firmFunction: "advogado", registered: true })).toBe(false);
  });

  it("opens on the factor while the session has none, then where it was going", () => {
    expect(personSetupOpening({ factorOk: false, asked: null, firmFunction: "advogado" })).toEqual({
      open: "seguranca",
      afterFactor: "oab",
    });
    expect(personSetupOpening({ factorOk: false, asked: "oab", firmFunction: "advogado" }).open).toBe("seguranca");
    expect(personSetupOpening({ factorOk: true, asked: null, firmFunction: "advogado" }).open).toBe("oab");
    expect(personSetupOpening({ factorOk: true, asked: "seguranca", firmFunction: "advogado" }).open).toBe("seguranca");
    // Who does not sign at the bar has one step: the factor, said done once it is.
    expect(personSetupOpening({ factorOk: true, asked: "oab", firmFunction: "atendimento" })).toEqual({
      open: "seguranca",
      afterFactor: null,
    });
  });

  it("knows its steps by their address and keeps one row per person and firm", () => {
    expect(isPersonSetupStep("oab")).toBe(true);
    expect(isPersonSetupStep("canal")).toBe(false);
    expect(personFlowKey("u1", "o1")).toEqual({ userId: "u1", orgId: "o1", flow: "person-setup" });
  });
});
