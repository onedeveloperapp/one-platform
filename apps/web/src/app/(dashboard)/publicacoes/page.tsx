import PublicationsView, { type PublicationsState } from "./publications-view";
import { redirect } from "next/navigation";

import { isDjenCaptureOn } from "@/lib/courts/djen";
import { deadlineActs } from "@/lib/deadlines/facts";
import { colleagues, courtZones } from "@/lib/hearings/facts";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { loadPublications } from "@/lib/publications/facts";
import { isPublicationView, lastPageOf, publicationsAddress, VIEW_COUNT } from "@/lib/publications/publications";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * /publicacoes: what the courts published to the firm's lawyers in the DJEN,
 * read under the person's own session (row-level security shows the
 * publications and the readings of their firm only). The backend reads the
 * gazette; a person of the firm says what each publication is. `?ver=` picks
 * one of the three lists and `?pagina=` a page of it, and `?modulo=` keeps
 * them to the publications of the cases of one module (migration 0078); a
 * search by case number never goes in the address.
 */
async function loadState(
  ver: string | undefined,
  pagina: string | undefined,
  modulo: string | undefined,
): Promise<PublicationsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const view = isPublicationView(ver) ? ver : "por-triar";
  const asked = Number.parseInt(pagina ?? "1", 10);
  const page = Number.isInteger(asked) && asked >= 1 && asked <= 10_000 ? asked - 1 : 0;
  const scope = pageScopeOf(context.catalog, context.modules, modulo);
  try {
    const [data, acts, team, zones, supportVisit, decides] = await Promise.all([
      loadPublications(
        context.supabase,
        context.firm.id,
        view,
        page,
        context.profile.timezone,
        scope.current?.key ?? null,
      ),
      deadlineActs(context.supabase),
      colleagues(context.supabase, context.firm.id),
      courtZones(context.supabase),
      isSupportVisit(),
      // Who decides for the firm what a partner decides (0078): a partner, or, with none, who manages it.
      context.supabase.rpc("decides_for_firm", { target_org: context.firm.id }),
    ]);
    const role = context.firm.firmFunction;
    return {
      kind: "ready",
      view,
      data,
      // Who says what a publication is: who signs, or who runs the firm's deadlines. Never a support visit.
      mayTriage: !supportVisit && (role === "socio" || role === "advogado" || role === "controladoria"),
      captureOn: isDjenCaptureOn(),
      // Whether the AI's word may be the firm's triage is a partner's to say (with no partner, who manages the
      // firm). Never a support visit.
      mayDecideAi: !supportVisit && !decides.error && decides.data === true,
      acts,
      colleagues: team,
      courtZones: zones,
      scope,
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : (query[key] as string | undefined));
  const state = await loadState(one("ver"), one("pagina"), one("modulo"));
  // A page past the end of its list (the list got shorter while the person worked through it, or the
  // address is an old one) is never shown as a list with nothing in it: it is the last page there is.
  if (state.kind === "ready" && state.data.rows.length === 0 && state.data.page > 0) {
    const last = lastPageOf(state.data.counts[VIEW_COUNT[state.view]]);
    redirect(publicationsAddress(state.view, Math.min(last, state.data.page - 1), state.scope.current?.key ?? null));
  }
  return <PublicationsView state={state} />;
}
