import "server-only";

import {
  type CourtLogin,
  courtLoginState,
  type ExtensionLink,
  type FilingTerm,
  type FilingWaysData,
  isWay,
  type ScreenSystem,
  type Way,
} from "@/lib/filing-ways/ways";
import type { MemberContext } from "@/lib/member/context";

/**
 * What a person's screens read of the ways to file (migrations 0263 and 0264), with the person's own session: the
 * systems ONE works on, the firm's way, the person's way at each system, their court logins (by their hint and where
 * they stand, never more), their extension's link, the texts of the acknowledgments in force, and the systems of the
 * lawsuits they sign still to be filed. Null when a read failed: a screen says it could not read, never that nothing
 * is set.
 */
export async function loadFilingWays(context: MemberContext): Promise<FilingWaysData | null> {
  const firm = context.firm;
  if (!firm) return null;
  const lawyer = firm.firmFunction === "socio" || firm.firmFunction === "advogado";

  const [systems, courts, firmWay, myWays, logins, links, registrations, decides, firmTerm, lawyerTerm] =
    await Promise.all([
      context.supabase.from("court_screen_systems").select("key, court, system, name, ways, rule_note").order("court"),
      context.supabase.from("courts").select("acronym, uf"),
      context.supabase.from("firm_filing_ways").select("way").eq("org_id", firm.id).maybeSingle(),
      context.supabase
        .from("lawyer_filing_ways")
        .select("system_key, way")
        .eq("org_id", firm.id)
        .eq("user_id", context.userId),
      context.supabase
        .from("connections")
        .select("id, provider, status, metadata, last_error")
        .eq("org_id", firm.id)
        .eq("person_id", context.userId)
        .like("provider", "court.%")
        .neq("status", "disconnected"),
      context.supabase
        .from("extension_links")
        .select("id, label, linked_at, last_seen_at")
        .eq("org_id", firm.id)
        .eq("user_id", context.userId)
        .is("ended_at", null)
        .not("linked_at", "is", null)
        .order("linked_at", { ascending: false })
        .limit(1),
      context.supabase.from("oab_registrations").select("uf").eq("user_id", context.userId),
      context.supabase.rpc("decides_for_firm", { target_org: firm.id }),
      context.supabase.rpc("filing_term_in_force", { target_slug: "protocolo-escritorio" }),
      context.supabase.rpc("filing_term_in_force", { target_slug: "protocolo-advogado" }),
    ]);
  if (
    systems.error ||
    courts.error ||
    firmWay.error ||
    myWays.error ||
    logins.error ||
    links.error ||
    registrations.error
  ) {
    return null;
  }

  const ufOf = new Map(((courts.data ?? []) as { acronym: string; uf: string }[]).map((row) => [row.acronym, row.uf]));
  const termIds = [firmTerm.data, lawyerTerm.data].filter((id): id is string => typeof id === "string");
  const texts = termIds.length
    ? await context.supabase.from("consent_terms").select("id, title, body_md").in("id", termIds)
    : { data: [], error: null };
  const termOf = (id: unknown): FilingTerm | null => {
    const row = ((texts.data ?? []) as { id: string; title: string; body_md: string }[]).find((term) => term.id === id);
    return row ? { id: row.id, title: row.title, bodyMd: row.body_md } : null;
  };

  const screenSystems: ScreenSystem[] = (
    (systems.data ?? []) as {
      key: string;
      court: string;
      system: string;
      name: string;
      ways: string[];
      rule_note: string | null;
    }[]
  ).map((row) => ({
    key: row.key,
    name: row.name,
    court: row.court,
    system: row.system,
    uf: ufOf.get(row.court) ?? null,
    ways: (row.ways ?? []).filter((way): way is "browser" | "extension" => way === "browser" || way === "extension"),
    ruleNote: row.rule_note,
  }));

  const mine: Record<string, Way> = {};
  for (const row of (myWays.data ?? []) as { system_key: string; way: string }[]) {
    if (isWay(row.way)) mine[row.system_key] = row.way;
  }

  // The systems ONE works on where the person signs a lawsuit still to be filed: one look per system, so a lawyer of
  // thousands of lawsuits costs as little as one of a few. A look that fails names nothing.
  const lawsuitSystems = lawyer
    ? (
        await Promise.all(
          screenSystems
            .filter((system) => system.ways.length > 0)
            .map((system) =>
              context.supabase
                .from("proceeding_lawyers")
                .select("proceeding_id, proceedings!inner(status, court, system)")
                .eq("org_id", firm.id)
                .eq("user_id", context.userId)
                .eq("proceedings.status", "planned")
                .eq("proceedings.court", system.court)
                .eq("proceedings.system", system.system)
                .limit(1)
                .then(
                  ({ data, error }) => (!error && (data ?? []).length > 0 ? [system.key] : []),
                  () => [],
                ),
            ),
        )
      ).flat()
    : [];

  const courtLogins: CourtLogin[] = (
    (logins.data ?? []) as {
      id: string;
      provider: string;
      status: string;
      metadata: unknown;
      last_error: string | null;
    }[]
  ).map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      connectionId: row.id,
      system: row.provider.replace(/^court\./, ""),
      hint: typeof metadata.login_hint === "string" ? metadata.login_hint : null,
      state: courtLoginState(row),
      verifiedAt: typeof metadata.verified_at === "string" ? metadata.verified_at : null,
    };
  });

  const linkRow = (
    (links.data ?? []) as { id: string; label: string | null; linked_at: string; last_seen_at: string | null }[]
  )[0];
  const link: ExtensionLink | null = linkRow
    ? { id: linkRow.id, label: linkRow.label, linkedAt: linkRow.linked_at, lastSeenAt: linkRow.last_seen_at }
    : null;

  return {
    systems: screenSystems,
    firmWay: isWay(firmWay.data?.way) ? firmWay.data.way : null,
    myWays: mine,
    logins: courtLogins,
    link,
    terms: { firm: termOf(firmTerm.data), lawyer: termOf(lawyerTerm.data) },
    decidesForFirm: decides.data === true,
    lawyer,
    myStates: Array.from(new Set(((registrations.data ?? []) as { uf: string }[]).map((row) => row.uf))),
    lawsuitSystems,
  };
}
