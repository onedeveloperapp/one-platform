import { describe, expect, it } from "vitest";

import { fillMessage, messageProblem, speaksOfPrice, suggestMessage } from "@/lib/firm/messages";

const link = { required: ["link"], optional: ["nome", "caso"] };

describe("the firm's own words in ONE's messages", () => {
  it("passes a text that carries what it must and nothing it does not know", () => {
    expect(messageProblem(link, "Oi, {nome}. Seu caso {caso} foi aberto. Siga pelo link: {link}")).toBeNull();
  });

  it("refuses a text with no link, an unknown value, a dash, an exclamation or a promise", () => {
    expect(messageProblem(link, "Oi, {nome}. Seu caso foi aberto.")).toEqual({ code: "missing_value", value: "link" });
    expect(messageProblem(link, "Oi {cpf}, siga: {link}")).toEqual({ code: "unknown_value", value: "cpf" });
    expect(messageProblem(link, "Oi, siga o link! {link}")).toEqual({ code: "copy_rules" });
    expect(messageProblem(link, "Sua indenização está garantida. {link}")).toEqual({ code: "promise" });
    expect(messageProblem(link, "{link}")).toEqual({ code: "size" });
  });

  it("suggests a text that passes: plain marks, no promise, the link put back", () => {
    const suggested = suggestMessage(
      link,
      "Oi, {nome}! Você vai ganhar com certeza. Seu caso foi aberto — fale conosco.",
    );
    expect(messageProblem(link, suggested)).toBeNull();
    expect(suggested).toContain("{link}");
    expect(suggested).not.toMatch(/ganhar/);
  });

  it("fills the values given and leaves the case's number for the database", () => {
    expect(fillMessage("Oi, {nome}. Caso {caso}: {link}", { nome: "Maria", link: "https://x.invalid/c/a" })).toBe(
      "Oi, Maria. Caso {caso}: https://x.invalid/c/a",
    );
    // A name not known yet (0239: none before the "Quero seguir") takes its comma or space along.
    expect(fillMessage("Obrigado por responder, {nome}. Pelo que vimos", { nome: "" })).toBe(
      "Obrigado por responder. Pelo que vimos",
    );
    expect(fillMessage("Tudo bem {nome}, até logo.", { nome: " " })).toBe("Tudo bem, até logo.");
  });

  it("says when a text speaks of a price, for the firm to weigh", () => {
    expect(speaksOfPrice("Não cobramos nada para começar.")).toBe(true);
    expect(speaksOfPrice("Siga pelo link.")).toBe(false);
  });
});
