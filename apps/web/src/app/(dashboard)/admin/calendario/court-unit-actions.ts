"use server";

import { revalidatePath } from "next/cache";

import { type CourtUnit, searchCourtUnits } from "@/lib/admin/court-units";
import { requireSuperadmin } from "@/lib/admin/session";
import { queueCaseAdvance } from "@/lib/cases/advance-work";

/**
 * The operator's writes on the units of each comarca (migrations 0179 and 0180): a unit's profile, whether it asks a
 * complaint before the lawsuit, with what it was read in, and whether the unit was checked against the court's acts.
 * Both go through `admin_save_court_unit`, which checks the role and keeps the record. A server action is a public
 * endpoint: the role is checked here again.
 */

export type CourtUnitResult = { ok: true } | { ok: false; code: string };

const COURT = /^TJ[A-Z]{2,3}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function findCourtUnits(court: string, comarca: string): Promise<CourtUnit[] | null> {
  const session = await requireSuperadmin();
  if (!session || !COURT.test(court ?? "")) return null;
  const words = String(comarca ?? "").trim();
  if (words.length < 2) return [];
  try {
    return await searchCourtUnits(session.supabase, court, words.slice(0, 80));
  } catch {
    return null;
  }
}

export async function saveCourtUnitProfile(input: {
  unitId: string;
  priorComplaint: "required" | "not_required" | null;
  note: string;
  confirmed: boolean;
}): Promise<CourtUnitResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!ID.test(input?.unitId ?? "")) return { ok: false, code: "invalid_value" };
  const prior =
    input.priorComplaint === "required" || input.priorComplaint === "not_required" ? input.priorComplaint : null;
  const note = String(input.note ?? "").trim();
  if (prior !== null && note.length < 8) return { ok: false, code: "note_required" };
  const { data, error } = await session.supabase.rpc("admin_save_court_unit", {
    target_unit: input.unitId,
    target_fields: {
      prior_complaint: prior ?? "",
      profile_note: note.slice(0, 2000),
      confirmed: input.confirmed === true,
    },
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  // A unit that now asks the complaint, or no longer does, changes what the planned lawsuits wait for.
  await queueCaseAdvance(null);
  revalidatePath("/admin/calendario");
  return { ok: true };
}
