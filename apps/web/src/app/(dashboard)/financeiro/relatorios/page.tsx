import { loadFinance } from "../load-finance";
import ReportsView from "./reports-view";

import { emailReady } from "@/lib/email-ready";

/**
 * /financeiro/relatorios (phase 12): the month's income statement and cash flow, the 13 weeks ahead, the closing, the
 * budget, the invoices' data and the accountant's package, for who reads the books. The month is read by the view; the
 * page hands it who may set the budget and the chart it is set on (0163).
 */
export default async function ReportsPage() {
  const [state, emailOn] = await Promise.all([loadFinance({ accountant: true }), emailReady()]);
  const ready = state.kind === "ready" ? state : null;
  return (
    <ReportsView
      configures={!!ready && ready.level === "configure" && !ready.supportVisit}
      factor={ready?.factor ?? "challenge"}
      operates={!!ready && (ready.level === "operate" || ready.level === "configure") && !ready.supportVisit}
      accountant={ready?.accountant ? { name: ready.accountant.name, email: ready.accountant.email } : null}
      emailOn={emailOn}
      categories={(ready?.registrations.categories ?? [])
        .filter((category) => !category.archived && ["income", "expense", "partner_out"].includes(category.kind))
        .map((category) => ({ id: category.id, name: category.name, kind: category.kind }))}
    />
  );
}
