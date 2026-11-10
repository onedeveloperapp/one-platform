import FinanceHomeView from "./finance-home-view";
import { loadFinance } from "./load-finance";

/**
 * /financeiro: the firm's books (phase 4 of the plan of the controladoria and the finance, migration 0126), for who
 * reads them; the books' own setup for who decides for the firm while they are not open.
 */
export default async function FinancePage() {
  return <FinanceHomeView state={await loadFinance()} />;
}
