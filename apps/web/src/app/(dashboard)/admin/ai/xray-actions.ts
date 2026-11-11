"use server";

import { requireSuperadmin } from "@/lib/admin/session";
import { recordAudit } from "@/lib/audit";
import { djenClient } from "@/lib/courts/djen";
import { type Xray, xrayOf } from "@/lib/publications/xray";
import { DjenInvalidQueryError, DjenRateLimitedError, DjenWindowTooLargeError } from "@flyee/courts/providers/djen";

/**
 * The x-ray by the OAB (M6), for the operator: what the DJEN published of one registration at the bar in the last
 * days, read at that moment from the public API and answered in numbers only; nothing of it is kept. On the record by
 * the registration, which is a public fact of the gazette.
 */
export async function readOabXray(
  uf: string,
  number: string,
  days = 30,
): Promise<{ ok: true; xray: Xray; days: number } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const client = djenClient();
  if (!client) return { ok: false, code: "off" };
  const span = Math.min(Math.max(Math.round(days), 1), 90);
  const since = new Date(Date.now() - span * 86_400_000);
  const sinceDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(since);
  let communications;
  try {
    communications = await client.listByOab({ uf: uf.trim().toUpperCase(), number: number.trim(), since: sinceDay });
  } catch (error) {
    if (error instanceof DjenInvalidQueryError) return { ok: false, code: "invalid" };
    if (error instanceof DjenWindowTooLargeError) return { ok: false, code: "too_many" };
    if (error instanceof DjenRateLimitedError) return { ok: false, code: "rate_limited" };
    return { ok: false, code: "unavailable" };
  }
  const { data: airlines } = await session.supabase
    .from("airlines")
    .select("iata, name, legal_name, court_names, active")
    .eq("active", true);
  const xray = xrayOf(
    communications,
    ((airlines ?? []) as { iata: string; name: string; legal_name: string | null; court_names: string[] | null }[]).map(
      (airline) => ({
        iata: airline.iata,
        name: airline.name,
        names: [...(airline.court_names ?? []), airline.legal_name ?? "", airline.name],
      }),
    ),
  );
  await recordAudit(session.supabase, "admin.oab_xray", {
    entityType: "oab_registration",
    entityId: `${uf.trim().toUpperCase()} ${number.trim()}`,
    metadata: { days: span, lawsuits: xray.lawsuits },
  }).catch(() => undefined);
  return { ok: true, xray, days: span };
}
