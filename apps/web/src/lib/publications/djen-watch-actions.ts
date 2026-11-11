"use server";

import { type CourtSystemSignal, readCourtSystemSignal } from "@/lib/publications/djen-watch";
import { createClient } from "@flyee/auth/server";

/**
 * The signal of a court and kind of lawsuit (migration 0201), for who approves the system ONE named for a lawsuit
 * there: the DJEN's recent links of that court point mostly to another system than the table says. Public facts of
 * the gazette, read by anybody signed in; null when the links agree, or the read failed.
 */
export async function readSystemSignal(court: string, kind: string): Promise<CourtSystemSignal | null> {
  if (!/^TJ[A-Z]{2,3}$/.test(court) || (kind !== "juizado" && kind !== "comum")) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("court_system_signal", { target_court: court, target_kind: kind });
  if (error) return null;
  return readCourtSystemSignal(data, court, kind);
}
