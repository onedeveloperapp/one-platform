import CasesView from "./components/cases-view";
import { loadCases } from "./load-cases";

/**
 * /casos: the firm's cases, of every module it contracted or of one (`?modulo=`, migration 0078). The list is for
 * finding a case and seeing where each one stands; every change happens inside the case. A module's own list, with
 * what only that module has, is also its area's (`/modulos/<key>`).
 */
export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  // The controladoria leaves the test cases out of its numbers once the firm has real ones (0114): a number of it
  // opens this list with the same cut (`?testes=fora`), so the list has the size the number says.
  return (
    <CasesView
      state={await loadCases({
        ver: one("ver"),
        conversa: one("conversa"),
        modulo: one("modulo"),
        tests: one("testes") !== "fora",
      })}
    />
  );
}
