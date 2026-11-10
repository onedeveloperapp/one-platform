import PeopleView, { type PeopleState } from "./people-view";

import { getMemberContext } from "@/lib/member/context";
import { isPeopleView } from "@/lib/people/people";
import { loadMarketingTerm, loadPeopleNumbers, loadPeoplePage, loadSegments } from "@/lib/people/read";

/**
 * /pessoas (phase 9 of the plan of the controladoria and the finance): who the firm serves, read under the person's
 * own session (row-level security shows their firm's only). `?ver=` picks a view; a search travels in the request's
 * body, from the screen.
 */
async function loadState(ver: string | undefined): Promise<PeopleState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const view = isPeopleView(ver) ? ver : "todos";
  try {
    const [page, numbers, segments, term, assurance] = await Promise.all([
      loadPeoplePage(context.supabase, context.firm.id, view, null, 0),
      loadPeopleNumbers(context.supabase, context.firm.id),
      loadSegments(context.supabase, context.firm.id).catch(() => null),
      loadMarketingTerm(context.supabase, context.firm.id),
      context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    return {
      kind: "ready",
      view,
      page,
      numbers,
      segments,
      term,
      factor:
        assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing",
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const ver = Array.isArray(query.ver) ? query.ver[0] : query.ver;
  return <PeopleView state={await loadState(ver)} />;
}
