import NumbersView, { type NumbersState } from "./numbers-view";

import { getMemberContext } from "@/lib/member/context";
import { readLawsuitRows, readMargins } from "@/lib/numbers/lawsuits";

/**
 * /numeros (phase 11): the firm's numbers, from the one set of its lawsuits (migration 0136), for partners, lawyers and
 * the controladoria; each case's money for who reads the books. `?testes=1` counts the test cases too.
 */
async function loadState(tests: boolean): Promise<NumbersState> {
  const context = await getMemberContext();
  if (!context?.firm) return { kind: "unavailable" };
  try {
    const [numbers, margins] = await Promise.all([
      context.supabase.rpc("firm_lawsuit_numbers", { target_org: context.firm.id, target_tests: tests }),
      context.supabase.rpc("firm_case_margins", { target_org: context.firm.id, target_tests: tests }),
    ]);
    if (numbers.error) return { kind: "error" };
    const answer = (numbers.data ?? {}) as { ok?: boolean };
    if (answer.ok !== true) return { kind: "not-allowed" };
    return {
      kind: "ready",
      rows: readLawsuitRows(numbers.data),
      margins: margins.error ? null : readMargins(margins.data),
      tests,
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function NumbersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return <NumbersView state={await loadState(query.testes === "1")} />;
}
