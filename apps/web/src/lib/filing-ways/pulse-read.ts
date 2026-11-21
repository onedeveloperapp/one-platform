import { OPEN_BATCH_STATUSES } from "@/lib/filing-ways/batches";
import { createClient } from "@flyee/auth/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The pulse of the firm's batches in course (migration 0264), for /protocolo to follow ONE's browser and the
 * lawyer's extension while it is open: each batch by its state and its last change, asked by the browser straight to
 * the database under the person's own session. Null when it could not be read: the screen keeps what it has.
 */
export async function readBatchesPulse(firmId: string): Promise<string | null> {
  if (typeof firmId !== "string" || !UUID.test(firmId)) return null;
  const { data, error } = await createClient()
    .from("filing_batches")
    .select("id, status, updated_at")
    .eq("org_id", firmId)
    .in("status", [...OPEN_BATCH_STATUSES])
    .order("id");
  if (error) return null;
  return ((data ?? []) as { id: string; status: string; updated_at: string }[])
    .map((row) => `${row.id}:${row.status}:${row.updated_at}`)
    .join("|");
}
