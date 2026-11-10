import { describe, expect, it } from "vitest";

import { attorneyPowers } from "@/lib/library/powers";

describe("the special powers a power of attorney writes (CPC, art. 105)", () => {
  it("finds discharge and hardship where their words are", () => {
    expect(
      attorneyPowers(
        "Confere ainda os poderes especiais para receber citação, transigir, desistir, receber valores e dar quitação, levantar alvarás e assinar declaração de hipossuficiência econômica (Código de Processo Civil, art. 105).",
      ),
    ).toEqual({ discharge: true, hardship: true });
    expect(attorneyPowers("com poderes para RECEBER E DAR PLENA QUITAÇÃO e firmar declaração de pobreza")).toEqual({
      discharge: true,
      hardship: true,
    });
  });

  it("grants nothing its words do not say", () => {
    expect(attorneyPowers("com os poderes da cláusula ad judicia para o foro em geral")).toEqual({
      discharge: false,
      hardship: false,
    });
    // Receiving is not discharging, and hardship of proof is no declaration of it.
    expect(attorneyPowers("receber valores; a parte é hipossuficiente na prova")).toEqual({
      discharge: false,
      hardship: false,
    });
  });
});
