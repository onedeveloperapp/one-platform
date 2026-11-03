import { invitationOfNext, nameMeetsRules, passwordMeetsRules } from "./sign-up-rules";
import { describe, expect, it } from "vitest";

const TOKEN = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5"; // 44 characters of base64url, as ONE mints them

describe("invitationOfNext", () => {
  it("reads a team's and a partner's invitation", () => {
    expect(invitationOfNext(`/convite/${TOKEN}`)).toEqual({ kind: "firm", token: TOKEN });
    expect(invitationOfNext(`/parceria/${TOKEN}`)).toEqual({ kind: "partner", token: TOKEN });
  });

  it("takes a trailing slash, a query or an encoded token", () => {
    expect(invitationOfNext(`/parceria/${TOKEN}/`)?.token).toBe(TOKEN);
    expect(invitationOfNext(`/parceria/${TOKEN}?x=1`)?.token).toBe(TOKEN);
    expect(invitationOfNext(`/parceria/${encodeURIComponent(TOKEN)}`)?.token).toBe(TOKEN);
  });

  it("is nothing for any other address", () => {
    expect(invitationOfNext(null)).toBeNull();
    expect(invitationOfNext("/inicio")).toBeNull();
    expect(invitationOfNext(`/convite/${TOKEN}/aceitar`)).toBeNull();
    expect(invitationOfNext(`/x/convite/${TOKEN}`)).toBeNull();
    expect(invitationOfNext("/convite/curto")).toBeNull();
    expect(invitationOfNext("/convite/%E0%A4%A")).toBeNull();
    expect(invitationOfNext(`/convite/${"a".repeat(201)}`)).toBeNull();
    expect(invitationOfNext(`https://outro.example/convite/${TOKEN}`)).toBeNull();
  });
});

describe("the sign-up's fields", () => {
  it("asks a name of three characters", () => {
    expect(nameMeetsRules("Ana")).toBe(true);
    expect(nameMeetsRules("  Al ")).toBe(false);
  });

  it("asks a password of eight characters, both cases and a symbol", () => {
    expect(passwordMeetsRules("Senha#123")).toBe(true);
    expect(passwordMeetsRules("senha#123")).toBe(false);
    expect(passwordMeetsRules("SENHA#123")).toBe(false);
    expect(passwordMeetsRules("Senha1234")).toBe(false);
    expect(passwordMeetsRules("Sh#1")).toBe(false);
  });
});
