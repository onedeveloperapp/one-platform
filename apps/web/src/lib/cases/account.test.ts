import { describe, expect, it } from "vitest";

import {
  ACCOUNT_MISSING_KEY,
  ACCOUNT_STATES,
  ACCOUNT_TOPIC_KEY,
  ACCOUNT_TOPIC_SHORT_KEY,
  ACCOUNT_TOPICS,
  accountAsksClient,
  accountQuestionsMessage,
  accountStateOf,
  accountThanksMessage,
  isAccountTopic,
} from "@/lib/cases/account";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("the client's account before the lawsuits (0090)", () => {
  it("asks the client to tell it, or to answer what is missing, and nothing while ONE or the firm holds it", () => {
    expect(accountAsksClient("missing")).toBe("tell");
    expect(accountAsksClient("incomplete")).toBe("answer");
    for (const state of ["preparing", "proposed", "contested", "failed", "ready"] as const) {
      expect(accountAsksClient(state)).toBeNull();
    }
    expect(accountAsksClient(null)).toBeNull();
  });

  it("reads only the states and the points the database writes", () => {
    expect(accountStateOf("incomplete")).toBe("incomplete");
    expect(accountStateOf("whatever")).toBeNull();
    expect(accountStateOf(null)).toBeNull();
    expect(isAccountTopic("gastos")).toBe(true);
    expect(isAccountTopic("outro")).toBe(false);
    // The purchase is asked nowhere: the piece speaks of it only where a document says it (0097).
    expect(isAccountTopic("compra")).toBe(false);
  });

  it("never names ONE's own work, nor a ready account, as something the case lacks", () => {
    expect(ACCOUNT_MISSING_KEY.preparing).toBeUndefined();
    expect(ACCOUNT_MISSING_KEY.ready).toBeUndefined();
    expect(Object.keys(ACCOUNT_MISSING_KEY).sort()).toEqual(
      ACCOUNT_STATES.filter((state) => state !== "preparing" && state !== "ready").sort(),
    );
  });

  it("asks in the conversation one question a line, and thanks the client for the answers (0092)", () => {
    expect(accountQuestionsMessage("Ana", ["Quanto você pagou?", " Você teve gastos? "])).toBe(
      [
        "Ana, para preparar a sua ação, o escritório precisa saber mais algumas coisas:",
        "1. Quanto você pagou?",
        "2. Você teve gastos?",
        "Pode responder aqui mesmo, numa mensagem só. Se não lembrar de algo, é só dizer.",
      ].join(String.fromCharCode(10)),
    );
    expect(accountQuestionsMessage("", ["Quanto você pagou?"]).startsWith("Para preparar a sua ação")).toBe(true);
    expect(accountThanksMessage("Ana")).toBe(
      "Obrigado, Ana. Recebi as suas respostas e vou organizar o seu relato com elas.",
    );
    expect(accountThanksMessage(" ")).toMatch(/^Obrigado\. Recebi/);
    // The firm's copy rules: no dash, no exclamation.
    for (const text of [accountQuestionsMessage("Ana", ["Quanto?"]), accountThanksMessage("Ana")]) {
      expect(text).not.toMatch(/[—–!]/);
    }
  });

  it("has words for every point, for the client and for the firm, and for every line of what is missing", () => {
    const keys = [
      ...ACCOUNT_TOPICS.map((topic) => ACCOUNT_TOPIC_KEY[topic]),
      ...ACCOUNT_TOPICS.map((topic) => ACCOUNT_TOPIC_SHORT_KEY[topic]),
      ...Object.values(ACCOUNT_MISSING_KEY),
    ];
    for (const key of keys) expect(product[key as string], key).toBeTruthy();
  });
});
