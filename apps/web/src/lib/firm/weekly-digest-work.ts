import "server-only";

import { readWeeklyFacts, weekLabel, weeklyDue, weeklyLinks } from "@/lib/firm/weekly-digest";
import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import { BRAND } from "@flyee/content";
import { isEmailConfigured, sendWeeklyDigestEmail, weeklyDigestItems } from "@flyee/email";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The partner's weekly digest (migration 0200), the backend's half: on Monday mornings of Brasília, each person who
 * decides for a firm and did not stop it is sent the firm's week before in numbers. Each e-mail is reserved before it
 * goes, so none goes twice; a week of nothing is recorded and sends nothing; a refusal by the provider's quota gives
 * the turn back and stops the round. Without the provider's key nothing is reserved.
 */

/** A refusal by the provider's quota or rate: the turn is given back. */
const isQuota = (error: string | undefined): boolean => /quota|rate.?limit|too many|429/i.test(error ?? "");

type Owed = {
  org_id: string;
  firm_name: string;
  people: { user_id: string; email: string; name: string; stop_token: string | null }[] | null;
  facts: unknown;
};

export async function weeklyDigestRound(
  service: SupabaseClient,
  until: number,
  now: Date = new Date(),
): Promise<SweepReport> {
  const { week, due } = weeklyDue(now);
  if (!due) return { due: false };
  if (!isEmailConfigured) return { due: true, email: false };
  const report = { due: true, sent: 0, empty: 0, failed: 0, quota: 0, rounds: 0 };
  while (Date.now() < until) {
    report.rounds += 1;
    const { data, error } = await service.rpc("weekly_digests_owed", { target_week: week, target_firms: 3 });
    if (error) throw new Error("weekly_digests_owed failed");
    const firms = (Array.isArray(data) ? data : []) as Owed[];
    if (firms.length === 0) break;
    let progressed = false;
    for (const firm of firms) {
      const facts = readWeeklyFacts(firm.facts);
      const items = facts ? weeklyDigestItems(facts) : 0;
      for (const person of firm.people ?? []) {
        if (Date.now() >= until) return report;
        const { data: reserved, error: reserveError } = await service.rpc("reserve_weekly_digest", {
          target_org: firm.org_id,
          target_user: person.user_id,
          target_week: week,
          target_items: items,
        });
        if (reserveError) throw new Error("reserve_weekly_digest failed");
        progressed = true;
        if (!facts || items === 0) {
          report.empty += 1;
          continue;
        }
        if (typeof reserved !== "string") continue;
        const result = await sendWeeklyDigestEmail(person.email, {
          locale: "pt-BR",
          firmName: firm.firm_name,
          weekLabel: weekLabel(week),
          facts,
          links: weeklyLinks(BRAND.siteUrl),
          homeUrl: `${BRAND.siteUrl}/inicio`,
          unsubscribeUrl: `${BRAND.siteUrl}/api/public/resumo/parar?t=${person.stop_token ?? ""}`,
        });
        const outcome = result.sent ? "sent" : isQuota(result.error) ? "quota" : "failed";
        await service.rpc("finish_weekly_digest", {
          target_digest: reserved,
          target_outcome: outcome,
          // The provider's words only: never an address or a person's data.
          target_error:
            outcome === "failed" ? (result.error ?? "").replace(/\S+@\S+/g, "[e-mail]").slice(0, 200) : null,
        });
        if (outcome === "quota") {
          report.quota += 1;
          return report;
        }
        if (outcome === "sent") report.sent += 1;
        else report.failed += 1;
      }
    }
    if (!progressed) break;
  }
  return report;
}

export const weeklyDigestSweeps: Sweep[] = [
  {
    // The clock's alone: the digest is of Monday morning, whoever is using ONE.
    key: "weekly-digests",
    when: { every: 15 },
    run: (service, until) => weeklyDigestRound(service, until),
  },
];
