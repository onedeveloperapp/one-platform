import { loadOneWork } from "./load-one-work";
import OneWorkView from "./one-work-view";

/**
 * /trabalho-do-one: what ONE did for the firm each month, by kind of task, and how many hours a person would have
 * taken by the firm's own estimates (phase 2 of the plan of the controladoria, the outcome of the cases and the
 * firm's finance). `?mes=` chooses the month and `?modulo=` keeps the page to one module, as every page of the work.
 */
export default async function OneWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  return <OneWorkView state={await loadOneWork({ mes: one("mes"), modulo: one("modulo") })} />;
}
