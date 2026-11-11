import type { XlsxSheet } from "@/lib/export/xlsx-write";
import { ENTRY_KIND_KEY } from "@/lib/finance/books";
import { DRE_ORDER, type DreLine, type InvoiceData, lineTotal, type Report, result } from "@/lib/finance/reports";

/**
 * The accountant's package of a month (phase 12): the income statement, the cash flow, the month's movement and the
 * invoices, as the sheets of one workbook. Pure, so the person's download (in the browser) and the e-mail to the
 * accountant (on the server, migration 0166) write the very same file. Each case goes by its number and no client by
 * name: the package leaves the firm.
 */

export type Say = (key: string, values?: Record<string, string | number>) => string;

/** A movement of the month for the package: never a name nor its words, only the case's number. */
export type MonthMovement = {
  day: string;
  account: string;
  kind: string;
  category: string | null;
  center: string | null;
  cents: number;
  caseSeq: number | null;
  byOne: boolean;
};

export const LINE_KEY: Record<DreLine, string> = {
  receita: "reports-line-revenue",
  deducao: "reports-line-deductions",
  custo: "reports-line-costs",
  despesa: "reports-line-expenses",
  financeiro: "reports-line-financial",
};

export const FLOW_KEY: Record<string, string> = {
  operacional: "reports-flow-operating",
  investimento: "reports-flow-investing",
  financiamento: "reports-flow-financing",
  clientes: "reports-flow-clients",
};

export function accountantPackage(input: {
  report: Report;
  invoices: InvoiceData[];
  movement: MonthMovement[];
  say: Say;
}): XlsxSheet[] {
  const { report, invoices, movement, say } = input;
  const dreRows = DRE_ORDER.map((line) => [say(LINE_KEY[line]), lineTotal(report.current, line) / 100]);
  return [
    {
      sheet: say("reports-dre-title"),
      columns: [{ title: say("reports-col-line") }, { title: say("reports-col-month"), kind: "number" }],
      rows: [
        ...dreRows,
        [say("reports-line-losses"), -report.current.losses / 100],
        [say("reports-line-result"), result(report.current) / 100],
        [say("reports-line-distribution"), -report.current.distribution / 100],
      ],
    },
    {
      sheet: say("reports-dfc-title"),
      columns: [{ title: say("reports-col-line") }, { title: say("reports-col-month"), kind: "number" }],
      rows: report.current.dfc.map((row) => [say(FLOW_KEY[row.line] ?? "reports-flow-operating"), row.cents / 100]),
    },
    {
      sheet: say("reports-movement-title"),
      columns: [
        { title: say("reports-col-day"), kind: "date" },
        { title: say("reports-col-account") },
        { title: say("reports-col-kind") },
        { title: say("reports-col-category") },
        { title: say("reports-col-center") },
        { title: say("reports-col-value"), kind: "number" },
        { title: say("reports-col-case") },
        { title: say("reports-col-by-one") },
      ],
      rows: movement.map((row) => [
        row.day,
        row.account,
        say(ENTRY_KIND_KEY[row.kind as keyof typeof ENTRY_KIND_KEY] ?? "finance-kind-expense"),
        row.category ?? "",
        row.center ?? say("reports-no-center"),
        row.cents / 100,
        row.caseSeq !== null ? `#${row.caseSeq}` : "",
        row.byOne ? say("reports-yes") : "",
      ]),
    },
    {
      sheet: say("reports-invoices-title"),
      columns: [
        { title: say("reports-col-taker") },
        { title: say("reports-col-value"), kind: "number" },
        { title: say("reports-col-competence"), kind: "date" },
        { title: say("reports-col-invoice") },
      ],
      rows: invoices.map((item) => [
        item.caseSeq !== null ? `#${item.caseSeq}` : say("reports-no-case"),
        item.cents / 100,
        item.competence,
        item.invoice?.number ?? "",
      ]),
    },
  ];
}
