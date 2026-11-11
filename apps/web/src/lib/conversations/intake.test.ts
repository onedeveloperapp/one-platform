import { describe, expect, it } from "vitest";

import {
  INTAKE_OPENING,
  intakeMissing,
  intakeQualificationInput,
  intakeQuestion,
  intakeReadingOf,
} from "@/lib/conversations/intake";
import { qualify } from "@flyee/rules/qualification";

// Every person and flight here is invented.

const TODAY = "2099-10-23";

describe("who writes to the firm with no alert", () => {
  it("reads what the task found, leaving out what is no fact and a masked identifier", () => {
    expect(
      intakeReadingOf({
        assunto: "problema_voo",
        problema: "delay",
        companhia: "LA",
        voo: "LA 3456",
        data: "2099-10-22",
        origem: "",
        destino: "",
        atraso_horas: "6",
        aviso: "",
        nome: "[nome 1]",
      }),
    ).toEqual({
      flight: true,
      facts: { problema: "delay", companhia: "LA", voo: "LA 3456", data: "2099-10-22", atraso_horas: "6" },
    });
    expect(intakeReadingOf({ assunto: "outro" })).toEqual({ flight: false, facts: {} });
    expect(intakeReadingOf({ assunto: "talvez" })).toBeNull();
    expect(intakeReadingOf(null)).toBeNull();
  });

  it("asks what is missing in order: the problem, the flight, the day, how late or when told, the name", () => {
    expect(intakeMissing({})).toEqual(["problema", "voo", "data", "nome"]);
    expect(intakeMissing({ problema: "delay", voo: "LA3456", data: "2099-10-22" })).toEqual(["atraso", "nome"]);
    expect(intakeMissing({ problema: "cancellation", origem: "GRU", destino: "REC", data: "2099-10-22" })).toEqual([
      "aviso",
      "nome",
    ]);
    expect(intakeMissing({ problema: "overbooking", voo: "G31450", data: "2099-10-22", nome: "Lucas Teste" })).toEqual(
      [],
    );
  });

  it("opens with a word of care before its first question", () => {
    expect(intakeQuestion("problema", true).startsWith(INTAKE_OPENING)).toBe(true);
    expect(intakeQuestion("nome", false)).toBe("Qual é o seu nome completo?");
  });

  it("hands the rule of qualification what it reads", () => {
    const late = intakeQualificationInput(
      { problema: "delay", voo: "LA3456", data: "2099-10-22", atraso_horas: "6", nome: "Lucas Teste" },
      TODAY,
    );
    expect(late).toMatchObject({ problem: "delay", flightDay: "2099-10-22", arrivalDelayMinutes: 360 });
    expect(qualify(late).outcome).toBe("qualifies");
    const short = intakeQualificationInput({ problema: "delay", data: "2099-10-22", atraso_horas: "2" }, TODAY);
    expect(qualify(short).outcome).toBe("not_qualified");
    const told = intakeQualificationInput({ problema: "cancellation", data: "2099-10-22", aviso: "early" }, TODAY);
    expect(told.notice).toBe("early");
  });
});
