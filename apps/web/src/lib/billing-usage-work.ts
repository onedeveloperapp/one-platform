import "server-only";

import { USAGE_METRICS, usageAlertBell, type UsageMetric } from "@/lib/billing-usage";
import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import { notifyUsers } from "@/lib/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a firm uses of its tier (migration 0202), the backend's half: once a day each firm is measured (its open real
 * cases, its people, its numbers at the vendor) and, the first time this month it reaches a share of a ceiling, who
 * manages its account and who decides for it are told on the bell, once.
 */
export async function usageRound(service: SupabaseClient, until: number): Promise<SweepReport> {
  const report = { measured: 0, alerts: 0, rounds: 0 };
  while (Date.now() < until) {
    report.rounds += 1;
    const { data, error } = await service.rpc("record_usage_day", { target_firms: 50 });
    if (error) throw new Error("record_usage_day failed");
    const answer = (data ?? {}) as { measured?: number; alerts?: unknown[] };
    const measured = Number(answer.measured) || 0;
    report.measured += measured;
    for (const raw of Array.isArray(answer.alerts) ? answer.alerts : []) {
      const alert = raw as {
        org_id?: string;
        metric?: string;
        percent?: number;
        value?: number;
        ceiling?: number;
        month?: string;
        people?: string[];
      };
      if (!alert.org_id || !(USAGE_METRICS as readonly string[]).includes(alert.metric ?? "")) continue;
      const words = usageAlertBell({
        metric: alert.metric as UsageMetric,
        percent: Number(alert.percent) || 0,
        value: Number(alert.value) || 0,
        ceiling: Number(alert.ceiling) || 0,
      });
      await notifyUsers(Array.isArray(alert.people) ? alert.people : [], {
        type: "billing",
        title: words.title,
        body: words.body,
        href: "/settings/billing#consumo",
        sourceKey: `usage:${alert.org_id}:${alert.month}:${alert.metric}:${alert.percent}`,
      });
      report.alerts += 1;
    }
    if (measured === 0) break;
  }
  return report;
}

export const usageSweeps: Sweep[] = [
  {
    // The clock's alone, at minute 25 of every hour: each firm is measured once a day, the ones not measured today yet.
    key: "usage-meter",
    when: { hourly: 25 },
    run: (service, until) => usageRound(service, until),
  },
];
