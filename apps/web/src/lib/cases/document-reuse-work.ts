import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The documents of a client who comes back (migration 0157): the identity and a recent proof of address a firm
 * accepted of a person in an earlier case are copied into the new case being gathered, so the client does not send
 * them again. The database says what is owed and records each copy as an accepted document of the new case; here the
 * file is copied in storage first (a document's file is one case's), and a copy the database no longer wants is
 * removed. A copy whose record never came is an object nobody names, which the storage sweep of 0018 removes. Only ids
 * leave this file.
 */

type Due = {
  org_id: string;
  target_case: string;
  target_party: string;
  source_document: string;
  kind: string;
  source_path: string;
  purpose: string;
  new_id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path of the copy: where the database files a firm's file of that purpose. */
export const reusePath = (due: Pick<Due, "org_id" | "purpose" | "new_id">): string =>
  `org/${due.org_id}/${due.purpose}/${due.new_id}`;

/** A round: copies what each new case is owed of its people's earlier documents, until the time runs out. */
export async function reuseRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tally = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const { data, error } = await service.rpc("document_reuses_due", { target_limit: 20 });
  if (error) throw new Error(`document_reuses_due failed: ${error.code ?? "unknown"}`);
  const storage = service.storage.from(FIRM_FILES_BUCKET);
  for (const due of (Array.isArray(data) ? data : []) as Due[]) {
    if (Date.now() >= until) break;
    if (
      ![due.org_id, due.target_case, due.target_party, due.source_document, due.new_id].every((id) => UUID.test(id))
    ) {
      tally("unreadable");
      continue;
    }
    const path = reusePath(due);
    const copied = await storage.copy(due.source_path, path);
    if (copied.error) {
      tally("copy_failed");
      continue;
    }
    const { data: recorded, error: recordError } = await service.rpc("record_document_reuse", {
      target_source: due.source_document,
      target_case: due.target_case,
      target_party: due.target_party,
      target_file: due.new_id,
      target_path: path,
    });
    if (recordError || (recorded as { ok?: boolean } | null)?.ok !== true) {
      // The case no longer owes it (the client sent one meanwhile): the copy is nobody's.
      await storage.remove([path]).catch(() => undefined);
      tally(recordError ? "record_failed" : "not_due");
      continue;
    }
    tally("reused");
  }
  return counts;
}
