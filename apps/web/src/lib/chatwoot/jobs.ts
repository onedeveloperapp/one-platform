import "server-only";

import { accountByChatwootId, ensureAccount, readyAccount, serviceAccount } from "@/lib/chatwoot/accounts";
import { mirrorConversations } from "@/lib/chatwoot/mirror";
import { chatwootProvider } from "@/lib/chatwoot/provider";
import type { Sweep } from "@/lib/jobs/schedule";
import { isChatwootNotFound } from "@flyee/chatwoot/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firms' panel of attendance (migration 0223), kept by the clock: the conversations whose panel is behind (what
 * a work right after a message did not finish), the account of each firm with a real number made before anybody
 * enters it, and what was taken out of ONE taken out of the panel. Counts only.
 */

/** A firm with a real number (Meta's or WhatsApp Web's) has its account made, so its conversations wait there. */
export async function makeAccounts(service: SupabaseClient, until: number): Promise<{ made: number; failed: number }> {
  const report = { made: 0, failed: 0 };
  const provider = chatwootProvider();
  if (!provider) return report;
  const { data } = await service
    .from("wa_numbers")
    .select("org_id")
    .eq("status", "active")
    .in("provider", ["meta", "openwa"])
    .limit(200);
  const firms = [...new Set(((data ?? []) as { org_id: string }[]).map((row) => row.org_id))];
  for (const orgId of firms) {
    if (Date.now() > until) break;
    if (await readyAccount(service, orgId)) continue;
    const made = await ensureAccount(service, provider, orgId);
    if (made.ok) report.made += 1;
    else if (made.code !== "busy") report.failed += 1;
  }
  return report;
}

type Deletion = {
  id: string;
  kind: "account" | "contact" | "conversation" | "person";
  account_id: number;
  target_id: number;
};

/** What was taken out of ONE, taken out of the panel; what the panel no longer has counts as done. */
export async function workDeletions(service: SupabaseClient, until: number): Promise<{ done: number; failed: number }> {
  const report = { done: 0, failed: 0 };
  const provider = chatwootProvider();
  if (!provider) return report;
  const { data, error } = await service.rpc("chatwoot_claim_deletions", { target_limit: 10 });
  if (error) throw new Error(`chatwoot_claim_deletions failed: ${error.message}`);
  for (const item of (Array.isArray(data) ? data : []) as Deletion[]) {
    if (Date.now() > until) break;
    try {
      if (item.kind === "account") await provider.platform.deleteAccount(item.account_id);
      else if (item.kind === "person") await provider.platform.removeAccountUser(item.account_id, item.target_id);
      else {
        const account = await accountByChatwootId(service, item.account_id);
        // The firm's account went too: taking it out takes everything in it.
        if (account) {
          const panel = await serviceAccount(provider, account);
          if (item.kind === "contact") await panel.deleteContact(item.target_id);
          else await panel.deleteConversation(item.target_id);
        }
      }
    } catch (failure) {
      if (!isChatwootNotFound(failure)) {
        report.failed += 1;
        continue;
      }
    }
    await service.rpc("chatwoot_deletion_done", { target_deletion: item.id });
    report.done += 1;
  }
  return report;
}

export const chatwootSweeps: Sweep[] = [
  {
    key: "chatwoot-mirror",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => ({ ...(await mirrorConversations(service, { limit: 20, until })) }),
  },
  {
    key: "chatwoot-upkeep",
    when: { every: 15 },
    run: async (service, until) => {
      const accounts = await makeAccounts(service, until);
      const deletions = await workDeletions(service, until);
      return {
        accountsMade: accounts.made,
        accountsFailed: accounts.failed,
        deleted: deletions.done,
        notDeleted: deletions.failed,
      };
    },
  },
];
