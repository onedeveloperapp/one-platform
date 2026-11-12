"use server";

import { randomBytes } from "node:crypto";

import { requireSuperadmin } from "@/lib/admin/session";
import { BRAND } from "@flyee/content";

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

// ---------- A test firm (migration 0220) ----------

/** Whether the firm is a test firm, with its note, when and its link; null when it could not be read. */
export type TestFirmMark = { marked: boolean; note: string | null; since: string | null; url: string | null };

export async function loadTestFirm(orgId: string): Promise<TestFirmMark | null> {
  const session = await requireSuperadmin();
  if (!session) return null;
  const { data, error } = await session.supabase.rpc("admin_test_firms");
  if (error || !Array.isArray(data)) return null;
  const row = (data as Record<string, unknown>[]).find((item) => item.org_id === orgId);
  if (!row) return { marked: false, note: null, since: null, url: null };
  const token = typeof row.token === "string" ? row.token : null;
  return {
    marked: true,
    note: typeof row.note === "string" ? row.note : null,
    since: typeof row.marked_at === "string" ? row.marked_at : null,
    url: token ? `${BRAND.siteUrl}/t/${token}` : null,
  };
}

/**
 * Marks a firm as a test firm, or takes the mark away, with the operator's note (8 to 500 characters). Marked, the
 * firm's cases and the trips ONE follows for it are tests, and its link opens its test tools and the test court.
 */
export async function setTestFirm(
  orgId: string,
  on: boolean,
  note: string,
): Promise<{ ok: true; mark: TestFirmMark | null } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "not_authorized" };
  const { data, error } = await session.supabase.rpc("admin_set_test_firm", {
    target_org: orgId,
    target_on: on,
    target_note: String(note ?? ""),
    target_token: on ? randomBytes(32).toString("base64url") : null,
  });
  if (error) {
    const message = error.message ?? "";
    return {
      ok: false,
      code: message.includes("aal2") || message.includes("second_factor") ? "second_factor" : "failed",
    };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  return { ok: true, mark: await loadTestFirm(orgId) };
}
