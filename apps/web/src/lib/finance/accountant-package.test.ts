import { accountantPackage } from "./accountant-package";
import { readReport } from "./reports";
import { describe, expect, it } from "vitest";

const say = (key: string) => key;

describe("the accountant's package", () => {
  const report = readReport({
    month: "2026-10-01",
    current: { dre: [{ line: "receita", category: "Honorários contratuais", cents: 150_000 }], dfc: [] },
    previous: {},
    last_year: {},
  })!;

  it("writes its four sheets in order, each case by its number and no name", () => {
    const sheets = accountantPackage({
      report,
      invoices: [
        {
          entryId: "e1",
          taker: "Maria Teste",
          cents: 150_000,
          description: "Honorários",
          competence: "2026-10-05",
          caseSeq: 7,
          invoice: null,
        },
      ],
      movement: [
        {
          day: "2026-10-05",
          account: "Itaú PJ",
          kind: "income",
          category: "Honorários contratuais",
          center: null,
          cents: 150_000,
          caseSeq: 7,
          byOne: true,
        },
      ],
      say,
    });
    expect(sheets.map((sheet) => sheet.sheet)).toEqual([
      "reports-dre-title",
      "reports-dfc-title",
      "reports-movement-title",
      "reports-invoices-title",
    ]);
    expect(sheets[0].rows[0]).toEqual(["reports-line-revenue", 1500]);
    expect(sheets[2].rows[0]).toEqual([
      "2026-10-05",
      "Itaú PJ",
      "finance-kind-income",
      "Honorários contratuais",
      "reports-no-center",
      1500,
      "#7",
      "reports-yes",
    ]);
    // The taker of an invoice is the client: the package says the case's number in its place.
    expect(JSON.stringify(sheets)).not.toContain("Maria Teste");
  });
});
