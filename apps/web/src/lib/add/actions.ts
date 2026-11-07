"use server";

import { type DeadlineAct, deadlineActs } from "@/lib/deadlines/facts";
import { type Colleague, colleagues, courtZones } from "@/lib/hearings/facts";
import type { CourtZones } from "@/lib/hearings/hearings";
import { getMemberContext } from "@/lib/member/context";

/** A lawsuit of a case a deadline or a hearing may be of: one the court has, by its number. */
export type AddLawsuit = { id: string; kind: "juizado" | "comum"; cnj: string; court: string | null };

/** What the forms of the "Adicionar" of the top need besides the lawsuit: the acts of a deadline, the team, the zones. */
export type AddContext = {
  acts: DeadlineAct[];
  colleagues: Colleague[];
  zones: Record<string, CourtZones>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The lists the forms of a new deadline and a new hearing read, under the person's own session (the database says
 * whose firm they are). Read once when the panel opens.
 */
export async function readAddContext(): Promise<{ ok: true; context: AddContext } | { ok: false }> {
  const member = await getMemberContext();
  if (!member?.firm) return { ok: false };
  try {
    const [acts, team, zones] = await Promise.all([
      deadlineActs(member.supabase),
      colleagues(member.supabase, member.firm.id),
      courtZones(member.supabase),
    ]);
    return { ok: true, context: { acts, colleagues: team, zones } };
  } catch {
    return { ok: false };
  }
}

/**
 * The lawsuits of a case the court has (filed, with their number): a deadline and a hearing are of one of them. A
 * lawsuit still planned has none yet; a closed one takes neither from here (its case says why).
 */
export async function readCaseLawsuits(caseId: string): Promise<{ ok: true; lawsuits: AddLawsuit[] } | { ok: false }> {
  if (typeof caseId !== "string" || !UUID.test(caseId)) return { ok: false };
  const member = await getMemberContext();
  if (!member?.firm) return { ok: false };
  const { data, error } = await member.supabase
    .from("proceedings")
    .select("id, kind, cnj, court, status")
    .eq("org_id", member.firm.id)
    .eq("case_id", caseId)
    .eq("status", "filed")
    .not("cnj", "is", null)
    .order("created_at", { ascending: true });
  if (error) return { ok: false };
  const lawsuits = (data ?? []).flatMap((row): AddLawsuit[] =>
    (row.kind === "juizado" || row.kind === "comum") && typeof row.cnj === "string"
      ? [{ id: row.id as string, kind: row.kind, cnj: row.cnj, court: (row.court as string | null) ?? null }]
      : [],
  );
  return { ok: true, lawsuits };
}
