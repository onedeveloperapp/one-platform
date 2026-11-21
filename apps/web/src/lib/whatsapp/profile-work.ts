import "server-only";

import { readWhatsAppSettings } from "@/lib/whatsapp/config";
import { businessProfileOf, type ProfileFirm, profileHash } from "@/lib/whatsapp/profile";
import { providerFor } from "@/lib/whatsapp/provider";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE keeps each active number's business profile in step with its firm's data (migration 0262): a profile that
 * changed since the last one written goes through the number's provider, and what came of it is recorded, so the same
 * profile is never written twice. A provider that cannot set one is recorded once and asked again only after the
 * firm's data change; one that did not answer now is asked again on the next round. Counts only.
 */
export async function syncWhatsAppProfiles(service: SupabaseClient, limit = 20): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("wa_numbers_profile_due", { target_limit: limit });
  if (error) throw new Error("wa_numbers_profile_due failed");
  const due = (data ?? []) as {
    number_id: string;
    org_id: string;
    provider: string;
    connection_id: string;
    phone_number_id: string;
    waba_id: string;
    profile_hash: string | null;
    firm: ProfileFirm;
  }[];
  const report = { read: due.length, written: 0, unchanged: 0, unsupported: 0, failed: 0 };
  if (due.length === 0) return report;
  const settings = await readWhatsAppSettings(service);

  for (const number of due) {
    const profile = businessProfileOf(number.firm ?? {});
    if (!profile) {
      report.unchanged += 1;
      continue;
    }
    const hash = profileHash(profile);
    if (hash === number.profile_hash) {
      report.unchanged += 1;
      continue;
    }
    const access = await providerFor(
      {
        provider: number.provider,
        orgId: number.org_id,
        connectionId: number.connection_id,
        phoneNumberId: number.phone_number_id,
        wabaId: number.waba_id,
      },
      settings,
      "whatsapp.profile",
    ).catch(() => null);
    if (!access?.ok) {
      report.failed += 1;
      continue;
    }
    const result = await access.provider.updateProfile(profile).catch(() => ({ ok: false as const, code: "failed" }));
    // Not answered now: asked again on the next round, the hash left as it was.
    if (!result.ok && (result.code === "unconfirmed" || result.code === "failed")) {
      report.failed += 1;
      continue;
    }
    const code = result.ok ? "ok" : result.code.replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    await service.rpc("record_number_profile", {
      target_number: number.number_id,
      target_hash: hash,
      target_code: code,
    });
    if (result.ok) report.written += 1;
    else report.unsupported += 1;
  }
  return report;
}
