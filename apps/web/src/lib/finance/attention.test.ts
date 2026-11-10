import { describe, expect, it } from "vitest";

import { financeAttentionGroups, financeAttentionItems, readFinanceAttention } from "@/lib/finance/attention";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("what waits in the books (0127)", () => {
  it("reads nothing for who does not read the books", () => {
    expect(readFinanceAttention(null)).toBeNull();
    expect(readFinanceAttention([])).toBeNull();
  });

  it("says the lines ONE left, a client's money to set apart and each late statement, each where it is done", () => {
    const attention = readFinanceAttention({
      level: "view",
      lines: { count: 3, accounts: 1, oldest: "2026-10-20" },
      late: [
        { account_id: "a", name: "Itaú PJ", last_on: "2026-10-01" },
        { account_id: "b", name: "Caixa", last_on: null },
        { account_id: "c", name: "C", last_on: null },
        { account_id: "d", name: "D", last_on: null },
        { name: "sem id" },
      ],
      apart: { count: 1, cents: "249000", oldest: "2026-10-03" },
    });
    expect(attention?.late).toHaveLength(4);
    const items = financeAttentionItems(attention!);
    expect(items.map((item) => [item.id, item.href, item.count])).toEqual([
      ["finance:lines", "/financeiro/conciliacao", 3],
      ["finance:apart", "/financeiro/lancamentos?ver=separar", 1],
      ["finance:late:a", "/financeiro/conciliacao", 1],
      ["finance:late:b", "/financeiro/conciliacao", 1],
      ["finance:late:c", "/financeiro/conciliacao", 1],
      ["finance:late:others", "/financeiro/conciliacao", 1],
    ]);
    expect(items[1].label.values?.value).toBe("R$ 2.490,00");
    expect(items[2].detail).toEqual({ key: "pending-finance-late-since", values: { day: "01/10" } });
    for (const item of items) {
      expect(product[item.label.key], item.label.key).toBeTruthy();
      expect(product[item.tag.key], item.tag.key).toBeTruthy();
      if (item.detail) expect(product[item.detail.key], item.detail.key).toBeTruthy();
    }
  });

  it("has nothing to say when nothing waits", () => {
    expect(
      financeAttentionItems({
        lines: { count: 0, accounts: 0, oldest: null },
        late: [],
        apart: { count: 0, cents: 0, oldest: null },
        bills: {
          paySoon: 0,
          paySoonCents: 0,
          payLate: 0,
          payLateCents: 0,
          receiveLate: 0,
          receiveLateCents: 0,
          receiveOld: 0,
        },
      }),
    ).toEqual([]);
  });

  it("puts a bill to pay that is late among the late, one due soon among today's, and a receivable to charge as a person's (0129)", () => {
    const attention = readFinanceAttention({
      lines: { count: 0 },
      late: [],
      apart: { count: 0 },
      bills: {
        pay_soon: 2,
        pay_soon_cents: 50000,
        pay_late: 1,
        pay_late_cents: 18990,
        receive_late: 3,
        receive_late_cents: 300000,
        receive_old: 1,
      },
    });
    const groups = financeAttentionGroups(attention!);
    expect(groups.late.map((item) => [item.id, item.href])).toEqual([
      ["finance:bills:pay-late", "/financeiro/contas?ver=vencidas"],
    ]);
    expect(groups.today.map((item) => item.count)).toEqual([2]);
    expect(groups.one.map((item) => [item.id, item.detail?.key])).toEqual([
      ["finance:bills:charge", "pending-finance-charge-old"],
    ]);
    for (const item of [...groups.late, ...groups.today, ...groups.one]) {
      expect(product[item.label.key], item.label.key).toBeTruthy();
    }
  });
});
