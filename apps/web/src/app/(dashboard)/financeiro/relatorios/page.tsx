import { loadFinance } from "../load-finance";
import ReportsView from "./reports-view";

/**
 * /financeiro/relatorios (phase 12): the month's income statement and cash flow, the 13 weeks ahead, the closing, the
 * budget, the invoices' data and the accountant's package, for who reads the books. The month is read by the view; the
 * page hands it who may set the budget and the chart it is set on (0163).
 */
export default async function ReportsPage() {
  const state = await loadFinance();
  const ready = state.kind === "ready" ? state : null;
  return (
    <ReportsView
      configures={!!ready && ready.level === "configure" && !ready.supportVisit}
      factor={ready?.factor ?? "challenge"}
      categories={(ready?.registrations.categories ?? [])
        .filter((category) => !category.archived && ["income", "expense", "partner_out"].includes(category.kind))
        .map((category) => ({ id: category.id, name: category.name, kind: category.kind }))}
    />
  );
}
