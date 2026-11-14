import { describe, expect, it } from "vitest";

import {
  isPersonSetupStep,
  personFlowKey,
  personSetupOpening,
  personSetupOwed,
  personSetupShown,
  personSetupSteps,
  signsAtTheBar,
} from "@/lib/firm/person-setup";

describe("a person's own setup in a firm", () => {
  it("asks the factor of everybody, first, then their WhatsApp, and the registration of who signs at the bar", () => {
    expect(personSetupSteps("advogado")).toEqual(["seguranca", "whatsapp", "oab"]);
    expect(personSetupSteps("socio")).toEqual(["seguranca", "whatsapp", "oab"]);
    expect(personSetupSteps("atendimento")).toEqual(["seguranca", "whatsapp"]);
    expect(personSetupSteps("controladoria")).toEqual(["seguranca", "whatsapp"]);
    expect(signsAtTheBar(null)).toBe(false);
  });

  it("is owed while the account has no factor, the person no WhatsApp, or a lawyer no registration", () => {
    const base = { hasFactor: true, hasWhatsapp: true, registered: false };
    expect(personSetupOwed({ ...base, hasFactor: false, firmFunction: "atendimento" })).toBe(true);
    expect(personSetupOwed({ ...base, firmFunction: "atendimento" })).toBe(false);
    // The owner, 2026-11-14: everybody gives their WhatsApp, by which they are linked to a hearing.
    expect(personSetupOwed({ ...base, hasWhatsapp: false, firmFunction: "atendimento" })).toBe(true);
    // The DJEN is read by the registrations of the firm's people: a lawyer with none has their publications unread.
    expect(personSetupOwed({ ...base, firmFunction: "advogado" })).toBe(true);
    expect(personSetupOwed({ ...base, firmFunction: "advogado", registered: true })).toBe(false);
  });

  it("opens on the home while owed and never answered, and while the WhatsApp is missing whatever was answered", () => {
    expect(personSetupShown({ owed: true, answered: false, hasWhatsapp: true })).toBe(true);
    expect(personSetupShown({ owed: true, answered: true, hasWhatsapp: true })).toBe(false);
    expect(personSetupShown({ owed: true, answered: true, hasWhatsapp: false })).toBe(true);
    expect(personSetupShown({ owed: false, answered: true, hasWhatsapp: true })).toBe(false);
  });

  it("opens on the factor while the session has none, then where it was going", () => {
    expect(personSetupOpening({ factorOk: false, asked: null, firmFunction: "advogado" })).toEqual({
      open: "seguranca",
      afterFactor: "whatsapp",
    });
    expect(personSetupOpening({ factorOk: false, asked: "oab", firmFunction: "advogado" }).open).toBe("seguranca");
    expect(personSetupOpening({ factorOk: true, asked: null, firmFunction: "advogado" }).open).toBe("whatsapp");
    expect(personSetupOpening({ factorOk: true, asked: "oab", firmFunction: "advogado" }).open).toBe("oab");
    expect(personSetupOpening({ factorOk: true, asked: "seguranca", firmFunction: "advogado" }).open).toBe("seguranca");
    // Who does not sign at the bar has the factor and their WhatsApp.
    expect(personSetupOpening({ factorOk: true, asked: "oab", firmFunction: "atendimento" })).toEqual({
      open: "whatsapp",
      afterFactor: "whatsapp",
    });
  });

  it("knows its steps by their address and keeps one row per person and firm", () => {
    expect(isPersonSetupStep("oab")).toBe(true);
    expect(isPersonSetupStep("whatsapp")).toBe(true);
    expect(isPersonSetupStep("canal")).toBe(false);
    expect(personFlowKey("u1", "o1")).toEqual({ userId: "u1", orgId: "o1", flow: "person-setup" });
  });
});
