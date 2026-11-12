"use server";

import { revalidatePath } from "next/cache";

import { queueAppealPapers, queueCaseAdvance } from "@/lib/cases/advance-work";
import { getMemberContext } from "@/lib/member/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Result = { ok: true } | { ok: false; code: string };

/**
 * A person of the firm records a claimant's answer on free justice (migration 0125), given some other way than the
 * link, saying how, about the answer the screen showed (`seen`: another one given since is never overwritten unseen).
 * The database checks who may (never a support visit) and ends the declaration a changed answer no longer fits; ONE
 * is woken to issue the one owed now.
 */
export async function recordFreeJusticeAnswer(
  caseId: string,
  partyId: string,
  asks: boolean,
  note: string,
  seenAnswerId: string | null,
): Promise<Result> {
  if (!UUID.test(caseId) || !UUID.test(partyId) || typeof asks !== "boolean") return { ok: false, code: "failed" };
  if (seenAnswerId !== null && !UUID.test(seenAnswerId)) return { ok: false, code: "failed" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("record_free_justice_answer", {
    target_case: caseId,
    target_party: partyId,
    target_asks: asks,
    target_note: String(note ?? "").slice(0, 500),
    target_seen: seenAnswerId,
  });
  if (error) return { ok: false, code: error.code === "P0002" ? "party_not_found" : "failed" };
  const answer = (data ?? {}) as { ok?: unknown; code?: unknown };
  if (answer.ok !== true) return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
  revalidatePath(`/casos/${caseId}`);
  await queueCaseAdvance(caseId);
  // A case already with the court issues the declaration of its appeal through a line of its own (0218).
  await queueAppealPapers(caseId);
  return { ok: true };
}
