import { loadFinance } from "../load-finance";
import ReconcileView from "./reconcile-view";

/** /financeiro/conciliacao: the statements sent and their lines, decided by ONE's rules or by a person (migration 0126). */
export default async function FinanceReconcilePage() {
  return <ReconcileView state={await loadFinance({ lines: true })} />;
}
