import { describe, expect, it } from "vitest";

import { businessProfileOf, profileHash } from "@/lib/whatsapp/profile";

describe("the firm's WhatsApp profile", () => {
  it("says when the firm attends, what it attends and where it is, from its data", () => {
    expect(
      businessProfileOf({
        name: "Souza Advogados",
        street: "Rua das Flores",
        number: "100",
        complement: "Sala 2",
        district: "Setor Oeste",
        city: "Goiânia",
        uf: "GO",
        postal_code: "74115060",
        email: "contato@souza.invalid",
        areas: ["Direito do Passageiro", "Família e sucessões", "Trabalhista"],
        hours_from: "08:00",
        hours_to: "17:30",
        saturdays: false,
      }),
    ).toEqual({
      about: "Atendimento de segunda a sexta, das 8h às 17h30.",
      description: "Souza Advogados atende Direito do Passageiro, Família e sucessões e Trabalhista.",
      address: "Rua das Flores, 100, Sala 2, Setor Oeste, Goiânia, GO, CEP 74115-060",
      email: "contato@souza.invalid",
    });
  });

  it("writes nothing of a firm that said none of it, and only what it said", () => {
    expect(businessProfileOf({ name: "Souza Advogados" })).toBeNull();
    expect(businessProfileOf({ name: "Souza", hours_from: "09:00", hours_to: "18:00", saturdays: true })).toEqual({
      about: "Atendimento de segunda a sábado, das 9h às 18h.",
    });
    // An address with no number or city is no address.
    expect(businessProfileOf({ street: "Rua das Flores", city: "Goiânia", uf: "GO" })).toBeNull();
  });

  it("marks a profile by what it says, so the same one is never written twice", () => {
    const one = businessProfileOf({ name: "Souza", areas: ["Trabalhista"] })!;
    expect(profileHash(one)).toBe(profileHash({ ...one }));
    expect(profileHash(one)).not.toBe(profileHash({ ...one, email: "outro@souza.invalid" }));
  });

  it("writes no dash and no exclamation mark", () => {
    const words = Object.values(
      businessProfileOf({ name: "Souza", areas: ["A", "B"], hours_from: "08:00", hours_to: "18:00", city: "X" })!,
    ).join(" ");
    expect(words).not.toMatch(/[—–!]/);
  });
});
