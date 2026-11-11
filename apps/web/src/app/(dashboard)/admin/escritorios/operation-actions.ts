"use server";

import { requireSuperadmin } from "@/lib/admin/session";

/**
 * One firm's operation, for the operator (migration 0204): its use against its tier, its cases, its WhatsApp, its
 * AI's cost this month, its connections, its DJEN readings and whether it let the support in. Counts and states only.
 */
export type FirmOperation = {
  usage: { metric: string; now: number; ceiling: number | null }[];
  alertsMonth: number;
  cases: { going: number; tests: number; openedMonth: number };
  whatsapp: { numbers: { provider: string; status: string }[]; in30d: number; out30d: number; failed7d: number };
  ai: { runsMonth: number; costUsdMicrosMonth: number };
  connections: { provider: string; label: string; status: string }[];
  calendar: string | null;
  djen: { reading: number; stopped: number };
  supportUntil: string | null;
};

const n = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function loadFirmOperation(
  orgId: string,
): Promise<{ ok: true; operation: FirmOperation } | { ok: false }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false };
  const { data, error } = await session.supabase.rpc("admin_firm_operation", { target_org: orgId });
  if (error || !data) return { ok: false };
  const raw = data as Record<string, unknown>;
  if (raw.ok !== true) return { ok: false };
  const part = (key: string) => (raw[key] && typeof raw[key] === "object" ? (raw[key] as Record<string, unknown>) : {});
  const cases = part("cases");
  const whatsapp = part("whatsapp");
  const ai = part("ai");
  const djen = part("djen");
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
  return {
    ok: true,
    operation: {
      usage: list(raw.usage).map((row) => ({
        metric: String(row.metric ?? ""),
        now: n(row.now),
        ceiling: row.ceiling == null ? null : n(row.ceiling),
      })),
      alertsMonth: n(raw.alerts_month),
      cases: { going: n(cases.going), tests: n(cases.tests), openedMonth: n(cases.opened_month) },
      whatsapp: {
        numbers: list(whatsapp.numbers).map((row) => ({
          provider: String(row.provider ?? ""),
          status: String(row.status ?? ""),
        })),
        in30d: n(whatsapp.in_30d),
        out30d: n(whatsapp.out_30d),
        failed7d: n(whatsapp.failed_7d),
      },
      ai: { runsMonth: n(ai.runs_month), costUsdMicrosMonth: n(ai.cost_usd_micros_month) },
      connections: list(raw.connections).map((row) => ({
        provider: String(row.provider ?? ""),
        label: String(row.label ?? ""),
        status: String(row.status ?? ""),
      })),
      calendar: typeof raw.calendar === "string" ? raw.calendar : null,
      djen: { reading: n(djen.reading), stopped: n(djen.stopped) },
      supportUntil: typeof raw.support_until === "string" ? raw.support_until : null,
    },
  };
}
