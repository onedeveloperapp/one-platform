import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  categoryFits,
  configuresBooks,
  dayLabel,
  financeErrorKey,
  financeFieldKey,
  financeHomeOf,
  money,
  operatesBooks,
  readsBooks,
} from "@/lib/finance/books";
import messages from "@flyee/content/messages/pt-BR.json";
import { CLIENT_MONEY_WORDS, isClientMoney } from "@flyee/rules/finance";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BOOKS = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0126_finance_books.sql"), "utf8");
const MORE = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0127_finance_more.sql"), "utf8");
const BILLS = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0129_finance_bills.sql"), "utf8");
const product = messages.product as Record<string, string>;

describe("the firm's books", () => {
  it("reads a client's money by the same words in the code and in the database (0126)", () => {
    const seeded = /'client_money_words', jsonb_build_array\(([\s\S]*?)\)/.exec(BOOKS)?.[1] ?? "";
    const words = [...seeded.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(words).toEqual([...CLIENT_MONEY_WORDS]);
    expect(isClientMoney({ cents: 250000, memo: "TED ALVARA JUDICIAL" })).toBe(true);
  });

  it("says what each level reads and does", () => {
    expect([readsBooks("costs"), readsBooks("view"), operatesBooks("view"), operatesBooks("operate")]).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(configuresBooks("configure") && !configuresBooks("operate")).toBe(true);
  });

  it("fits a category to an entry as the database checks it", () => {
    expect(categoryFits("income", "income")).toBe(true);
    expect(categoryFits("income", "client_money")).toBe(false);
    expect(categoryFits("partner", "partner_out")).toBe(true);
    expect(categoryFits("expense", "partner_out")).toBe(false);
  });

  it("reads the home the database answers, and nothing for who does not read the books", () => {
    expect(financeHomeOf(null)).toBeNull();
    const home = financeHomeOf({
      level: "view",
      opened_on: "2026-09-01",
      accounts: [
        { id: "a", kind: "bank", name: "Itaú", balance_cents: 331010, pending: 3, balance_gap_cents: -550000 },
        { id: "b", kind: "nope", name: "?" },
      ],
      numbers: {
        balance: { now: 331010, before: 100000 },
        income: { now: 0, before: 0 },
        client_money: { now: "250000" },
      },
      pending_lines: 3,
      latest: [{ id: "e", kind: "expense", cents: -18990, occurred_on: "2026-11-01", account: "Itaú" }, { kind: "x" }],
    });
    expect(home?.accounts.map((account) => [account.name, account.balanceCents, account.balanceGapCents])).toEqual([
      ["Itaú", 331010, -550000],
    ]);
    expect(home?.numbers.clientMoney).toEqual({ now: 250000, before: 0 });
    expect(home?.latest.map((entry) => entry.cents)).toEqual([-18990]);
  });

  it("writes money and days as a person reads them", () => {
    expect(money(123456)).toBe("R$ 1.234,56");
    expect(money(-1000)).toBe("-R$ 10,00");
    expect(dayLabel("2026-11-03")).toMatch(/3 de nov/);
  });

  it("has words for every refusal and field the database answers", () => {
    for (const code of [
      "support_visit",
      "not_allowed",
      "second_factor",
      "books_closed",
      "in_use",
      "already_imported",
      "daily_limit",
      "bill_settled",
      "x",
    ]) {
      expect(product[financeErrorKey(code)], code).toBeTruthy();
    }
    const fields = [...(BOOKS + MORE + BILLS).matchAll(/'field', '([a-z_]+)'/g)].map((match) => match[1]);
    for (const field of new Set(fields)) {
      if (field === "fields" || field === "table" || field === "text" || field === "lines" || field === "posted_on")
        continue;
      const key = financeFieldKey(field);
      expect(key, field).toBeTruthy();
      expect(product[key as string], field).toBeTruthy();
    }
  });
});
