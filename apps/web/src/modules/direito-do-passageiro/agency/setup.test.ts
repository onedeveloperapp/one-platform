import { describe, expect, it } from "vitest";

import {
  AGENCY_SETUP_STEPS,
  agencySetupHref,
  agencySetupOpening,
  agencySetupSteps,
  CLAUSE_MOST,
  clauseChange,
  isAgencySetupStep,
  PASSENGER_WAY_HREF,
  passengerWays,
} from "@/modules/direito-do-passageiro/agency/setup";

describe("the agency's setup", () => {
  it("asks the second factor first, since every write of the agency asks for it", () => {
    expect(AGENCY_SETUP_STEPS[0]).toBe("seguranca");
    expect(agencySetupSteps(true)).toEqual(["seguranca", "nome", "clausula", "equipe", "passageiros"]);
    // Who does not manage the agency has nothing of it to answer: the factor and the way to the passengers.
    expect(agencySetupSteps(false)).toEqual(["seguranca", "passageiros"]);
  });

  it("opens on the factor while the session has none, and goes on to where it was going", () => {
    const fresh = { factorOk: false, asked: null, manager: true };
    expect(agencySetupOpening(fresh)).toEqual({ open: "seguranca", afterFactor: "nome" });
    expect(agencySetupOpening({ ...fresh, asked: "clausula" })).toEqual({ open: "seguranca", afterFactor: "clausula" });
    expect(agencySetupOpening({ ...fresh, manager: false })).toEqual({ open: "seguranca", afterFactor: "passageiros" });
    const confirmed = { ...fresh, factorOk: true };
    expect(agencySetupOpening(confirmed).open).toBe("nome");
    expect(agencySetupOpening({ ...confirmed, asked: "equipe" }).open).toBe("equipe");
    expect(agencySetupOpening({ ...confirmed, asked: "seguranca" }).open).toBe("seguranca");
    // A step the person does not have opens the first one they do.
    expect(agencySetupOpening({ ...confirmed, manager: false, asked: "clausula" }).open).toBe("passageiros");
  });

  it("knows its steps by their address", () => {
    for (const step of AGENCY_SETUP_STEPS) {
      expect(isAgencySetupStep(step)).toBe(true);
      expect(new URL(agencySetupHref(step), "https://one.invalid").searchParams.get("passo")).toBe(step);
    }
    expect(isAgencySetupStep("canal")).toBe(false);
    expect(isAgencySetupStep(undefined)).toBe(false);
  });

  it("ends where the agency's passengers come in, the system's key only for who manages it", () => {
    expect(passengerWays(true)).toEqual(["um-a-um", "planilha", "api"]);
    expect(passengerWays(false)).toEqual(["um-a-um", "planilha"]);
    for (const href of Object.values(PASSENGER_WAY_HREF)) expect(href.startsWith("/parceiro/passageiros")).toBe(true);
  });

  it("registers a clause only when it says something else than the one in force, within the bounds", () => {
    const clause = "O cliente autoriza que a agência compartilhe os seus dados com o escritório parceiro.";
    expect(clauseChange(clause, null)).toEqual({ kind: "register", text: clause });
    // The same words, spaced otherwise, are the clause in force: nothing to register.
    expect(clauseChange(`  ${clause.replace("O cliente", "O   cliente")}  `, clause)).toEqual({ kind: "same" });
    expect(clauseChange(`${clause} Pode desistir.`, clause).kind).toBe("register");
    expect(clauseChange("Curta demais.", null)).toEqual({ kind: "invalid" });
    expect(clauseChange("x".repeat(CLAUSE_MOST + 1), null)).toEqual({ kind: "invalid" });
  });
});
