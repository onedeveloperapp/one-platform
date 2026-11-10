import RepassesView from "./repasses-view";

import { getMemberContext } from "@/lib/member/context";

/**
 * /financeiro/repasses (phase 10): the clients' parts of what the courts released, for who reads the books. The list
 * itself is read by the view, again after each act.
 */
export default async function RepassesPage() {
  const context = await getMemberContext();
  if (!context?.firm) return <RepassesView reads={false} />;
  const { data, error } = await context.supabase.rpc("finance_reads", { target_org: context.firm.id });
  return <RepassesView reads={!error && data === true} />;
}
