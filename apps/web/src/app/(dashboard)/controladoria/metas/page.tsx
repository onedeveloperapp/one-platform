import GoalsView from "./goals-view";
import { loadGoals } from "./load-goals";

/**
 * /controladoria/metas: the firm's closing goals (phase 1 of the plan of the controladoria, the outcome of the cases
 * and the firm's finance), the first registration in the pattern of phase 0: the list with its bar and "Nova meta",
 * a goal created and changed in the side panel, archived with its reason and brought back. `?modulo=` keeps the page
 * to one module; `?nova=1` opens a new goal as the page opens.
 */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  return <GoalsView state={await loadGoals({ modulo: one("modulo"), nova: one("nova") })} />;
}
