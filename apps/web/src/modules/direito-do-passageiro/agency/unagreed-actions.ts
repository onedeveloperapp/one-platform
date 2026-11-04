"use server";

import { agencyAccess } from "@/modules/direito-do-passageiro/agency/facts";
import { unagreedOf, type UnagreedRead } from "@/modules/direito-do-passageiro/agency/unagreed";

/**
 * Who of the agency's passengers flies in the next days with no agreement (`pax_departing_unagreed`, migration
 * 0094), for its home. The database decides who reads it and who is listed.
 */
export async function readUnagreedDepartures(): Promise<({ ok: true } & UnagreedRead) | { ok: false }> {
  const access = await agencyAccess();
  if (!access.ok) return { ok: false };
  const { data, error } = await access.context.supabase.rpc("pax_departing_unagreed", {
    target_partnership: access.partnership.id,
  });
  const read = error ? null : unagreedOf(data);
  return read ? { ok: true, ...read } : { ok: false };
}
