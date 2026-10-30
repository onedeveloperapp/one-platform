import { describe, expect, it } from "vitest";

import { AGENCY_TEST_PHONE, isTestChatPhone, messagePartsOf } from "@/lib/test-chat/test-chat";
import { isValidPhoneBr } from "@flyee/fields";

// The addresses here are invented.

describe("the firm's words in the test chat", () => {
  it("makes the client's link of ONE's message a link, and keeps the words around it as they are", () => {
    const body =
      "Pronto, Mariana. Os próximos passos:\n1. Abra o seu link: https://one.example/c/AbC-123_x\n2. Preencha.";
    expect(messagePartsOf(body)).toEqual([
      { text: "Pronto, Mariana. Os próximos passos:\n1. Abra o seu link: " },
      { text: "https://one.example/c/AbC-123_x", href: "https://one.example/c/AbC-123_x" },
      { text: "\n2. Preencha." },
    ]);
  });

  it("leaves out of the link the mark that ends a sentence", () => {
    expect(messagePartsOf("Abra https://one.example/c/abc. Depois, envie os documentos.")).toEqual([
      { text: "Abra " },
      { text: "https://one.example/c/abc", href: "https://one.example/c/abc" },
      { text: ". Depois, envie os documentos." },
    ]);
  });

  it("answers the words whole when they have no address, or only the start of one", () => {
    expect(messagePartsOf("Recebi tudo o que o seu caso precisa.")).toEqual([
      { text: "Recebi tudo o que o seu caso precisa." },
    ]);
    expect(messagePartsOf("Veja https://.")).toEqual([{ text: "Veja https://." }]);
  });
});

describe("the test chat's numbers", () => {
  it("are phones to the forms however they are written, and no real number is one", () => {
    expect(isTestChatPhone(AGENCY_TEST_PHONE)).toBe(true);
    expect(isTestChatPhone("(00) 98888-0006")).toBe(true);
    expect(isTestChatPhone("00988880001")).toBe(true);
    // A real Brazilian mobile is never one, and a test number is never a real one.
    expect(isTestChatPhone("(62) 99999-0001")).toBe(false);
    expect(isTestChatPhone("00988880016")).toBe(false);
    expect(isValidPhoneBr("(00) 98888-0006")).toBe(false);
  });
});
