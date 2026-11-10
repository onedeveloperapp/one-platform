import { loadFinance } from "../load-finance";
import BillsView from "./bills-view";

/** /financeiro/contas: the bills to pay and to receive (migration 0129); `?ver=` opens a view. */
export default async function FinanceBillsPage() {
  return <BillsView state={await loadFinance({ bills: true })} />;
}
