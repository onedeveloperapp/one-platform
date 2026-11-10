import { loadFinance } from "../load-finance";
import EntriesView from "./entries-view";

/** /financeiro/lancamentos: every entry of the books (migration 0126); `?ver=` opens a view. */
export default async function FinanceEntriesPage() {
  return <EntriesView state={await loadFinance({ entries: true })} />;
}
