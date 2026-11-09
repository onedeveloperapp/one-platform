import ControladoriaView from "./controladoria-view";
import { loadControladoria } from "./load-controladoria";

/**
 * /controladoria: the firm's stock of cases, what the court moved and what is quiet, on one page (phase 1 of the plan
 * of the controladoria, the outcome of the cases and the firm's finance). Each number opens the list it counts in
 * `/casos`, the one list of the firm's cases; `?modulo=` keeps the page to one module, as every page of the work.
 */
export default async function ControladoriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  return <ControladoriaView state={await loadControladoria({ modulo: one("modulo"), testes: one("testes") })} />;
}
