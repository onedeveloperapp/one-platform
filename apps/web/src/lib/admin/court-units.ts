import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The units of each comarca (migration 0179, `court_units`), as the operator keeps them: the platform's table every
 * planned lawsuit is addressed from, and each unit's profile, whether it asks a complaint before the lawsuit (0180),
 * which the operator writes until the jurimetry reads it. Reference data: nothing of a firm.
 */
export type CourtUnit = {
  id: string;
  court: string;
  comarca: string;
  kind: "juizado" | "comum";
  name: string;
  confirmed: boolean;
  priorComplaint: "required" | "not_required" | null;
  profileNote: string | null;
  profileAt: string | null;
};

type Row = {
  id: string;
  court: string;
  comarca: string;
  kind: string;
  name: string;
  confirmed: boolean;
  prior_complaint: string | null;
  profile_note: string | null;
  profile_at: string | null;
};

const COLUMNS = "id, court, comarca, kind, name, confirmed, prior_complaint, profile_note, profile_at";

export function courtUnitOf(row: Row): CourtUnit {
  return {
    id: row.id,
    court: row.court,
    comarca: row.comarca,
    kind: row.kind === "comum" ? "comum" : "juizado",
    name: row.name,
    confirmed: row.confirmed === true,
    priorComplaint:
      row.prior_complaint === "required" || row.prior_complaint === "not_required" ? row.prior_complaint : null,
    profileNote: row.profile_note,
    profileAt: row.profile_at,
  };
}

/** The units whose profile the operator wrote, newest first: what the firms' lawsuits read today. */
export async function loadProfiledCourtUnits(supabase: SupabaseClient): Promise<CourtUnit[]> {
  const { data, error } = await supabase
    .from("court_units")
    .select(COLUMNS)
    .not("prior_complaint", "is", null)
    .order("profile_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("court units could not be read");
  return ((data ?? []) as Row[]).map(courtUnitOf);
}

/** The units of a court whose comarca starts with the words searched, a few at a time. */
export async function searchCourtUnits(supabase: SupabaseClient, court: string, comarca: string): Promise<CourtUnit[]> {
  const { data, error } = await supabase
    .from("court_units")
    .select(COLUMNS)
    .eq("court", court)
    .ilike("comarca", `${comarca.replace(/[%_]/g, "")}%`)
    .order("comarca")
    .order("kind")
    .limit(30);
  if (error) throw new Error("court units could not be read");
  return ((data ?? []) as Row[]).map(courtUnitOf);
}
