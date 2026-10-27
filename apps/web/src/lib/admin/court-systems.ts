import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the firms did not approve of the court systems ONE names from the platform's table (migration 0066,
 * `admin_court_system_refusals`), with the row as the table keeps it: for the operator to check each court's acts
 * and confirm the system or change it. Nothing of a firm: counts and the reasons the firms wrote.
 */
export type CourtSystemRefusal = {
  court: string;
  kind: "juizado" | "comum";
  system: string;
  confirmed: boolean;
  /** Planned lawsuits that did not approve the system, and planned lawsuits that still wait for a firm's word. */
  refused: number;
  waiting: number;
  lastRefusedAt: string | null;
  /** The last reasons given, newest first. */
  reasons: string[];
  /** What the row holds besides, kept as it is when the operator confirms or changes the system. */
  since: string | null;
  maxFileBytes: number | null;
  source: string;
  notes: string | null;
};

type RefusalRow = {
  court: string;
  proceeding_kind: string;
  system: string;
  confirmed: boolean;
  refused: number;
  waiting: number;
  last_refused_at: string | null;
  reasons: string[] | null;
};

type SystemRow = {
  court: string;
  proceeding_kind: string;
  since: string | null;
  max_file_bytes: number | null;
  source: string;
  notes: string | null;
};

/** Throws when the refusals could not be read: an empty list is never said for one that was not read. */
export async function loadCourtSystemRefusals(supabase: SupabaseClient): Promise<CourtSystemRefusal[]> {
  const { data, error } = await supabase.rpc("admin_court_system_refusals");
  if (error || !Array.isArray(data)) throw new Error("the refused court systems could not be read");
  const refusals = data as RefusalRow[];
  if (refusals.length === 0) return [];
  const { data: rows, error: rowsError } = await supabase
    .from("court_systems")
    .select("court, proceeding_kind, since, max_file_bytes, source, notes")
    .in(
      "court",
      refusals.map((refusal) => refusal.court),
    );
  if (rowsError || !Array.isArray(rows)) throw new Error("the court systems could not be read");
  const rowOf = (court: string, kind: string) =>
    (rows as SystemRow[]).find((row) => row.court === court && row.proceeding_kind === kind) ?? null;
  return refusals.flatMap((refusal): CourtSystemRefusal[] => {
    const row = rowOf(refusal.court, refusal.proceeding_kind);
    if (!row || (refusal.proceeding_kind !== "juizado" && refusal.proceeding_kind !== "comum")) return [];
    return [
      {
        court: refusal.court,
        kind: refusal.proceeding_kind,
        system: refusal.system,
        confirmed: refusal.confirmed === true,
        refused: Number(refusal.refused) || 0,
        waiting: Number(refusal.waiting) || 0,
        lastRefusedAt: refusal.last_refused_at,
        reasons: Array.isArray(refusal.reasons) ? refusal.reasons.filter((reason) => typeof reason === "string") : [],
        since: row.since,
        maxFileBytes: row.max_file_bytes === null ? null : Number(row.max_file_bytes),
        source: row.source,
        notes: row.notes,
      },
    ];
  });
}
