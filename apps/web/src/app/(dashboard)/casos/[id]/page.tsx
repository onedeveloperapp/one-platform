import CaseView from "./components/case-view";
import { loadCase } from "./load-case";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by the case: what the view keeps of the last read (so that a refresh that fails does not take the
  // screen away) is never another case's.
  return <CaseView key={id} state={await loadCase(id)} />;
}
