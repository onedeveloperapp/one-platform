"use server";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A look ONE owes a case, asked for now by the screen somebody has open on it (the audit of the case's sync,
 * 2026-11-25). The database wakes a case whenever something of it changes (`case_advances.woken_at`), and the top of
 * the case then says "o ONE olha de novo em instantes"; but only some actions schedule that look right after their
 * answer (`queueCaseAdvance`), and the others (a person taken out of the case, a leg removed, a signature confirmed,
 * a package cancelled, what the client did on their link) left it to the clock's next round: up to five minutes of
 * "instants", and then a case that moved with nobody having touched it.
 *
 * Nothing is decided here. The case must be the firm's, read under the person's own session, and the look is the
 * very one the clock would take, claimed in the database: asked twice, it is done once. A support visit asks for
 * nothing: it reads the firm's screens and starts no work in the firm's name, not even ONE's own.
 */
export async function lookAtCaseNow(caseId: string): Promise<{ ok: boolean }> {
  const context = await getMemberContext();
  if (!context?.firm || typeof caseId !== "string" || !UUID.test(caseId)) return { ok: false };
  if (await isSupportVisit()) return { ok: false };
  const { data, error } = await context.supabase
    .from("cases")
    .select("id")
    .eq("id", caseId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (error || !data) return { ok: false };
  await queueCaseAdvance(caseId);
  return { ok: true };
}
