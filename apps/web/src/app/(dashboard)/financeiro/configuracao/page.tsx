import { loadFinance } from "../load-finance";
import FinanceSettingsView from "./settings-view";

/** /financeiro/configuracao: the accounts, the chart, the cost centres and who reads the books (migration 0126). */
export default async function FinanceSettingsPage() {
  return <FinanceSettingsView state={await loadFinance({ people: true, terms: true })} />;
}
