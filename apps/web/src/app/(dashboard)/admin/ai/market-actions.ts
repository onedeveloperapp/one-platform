"use server";

import { requireSuperadmin } from "@/lib/admin/session";
import { djenCertificateUrl } from "@flyee/courts/providers/djen";

/**
 * What the operator does with the market's reading (migration 0190): how it goes per court and airline, a sample of
 * decisions to say the thesis of at the source, and the release of the theses' reading to the profiles and the
 * pieces once the sample met the goal. The database checks the role, the goal and the second factor, and records it.
 */

export type MarketHealth = {
  captures: {
    id: string;
    court: string;
    party: string;
    airline: string | null;
    nextDay: string;
    status: string;
    lastReadAt: string | null;
    lastError: string | null;
    readDays: number;
    decisions: number;
    incompleteDays: number;
  }[];
  decisions: number;
  theses: { released: boolean; checked: number; agreed: number; minChecked: number; minAgreement: number };
  sample: {
    id: string;
    url: string;
    court: string;
    unit: string | null;
    day: string;
    result: string;
    thesis: string | null;
  }[];
  catalog: { slug: string; name: string }[];
};

export async function readMarketHealth(): Promise<{ ok: true; health: MarketHealth } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const [health, sample, catalog] = await Promise.all([
    session.supabase.rpc("admin_market_health"),
    session.supabase.rpc("admin_market_thesis_sample", { target_limit: 10 }),
    session.supabase.from("jurimetry_theses").select("slug, name").order("position"),
  ]);
  if (health.error || sample.error || catalog.error) return { ok: false, code: "failed" };
  const raw = (health.data ?? {}) as {
    captures?: Record<string, unknown>[];
    decisions?: number;
    theses?: Record<string, unknown>;
  };
  const num = (value: unknown) => Number(value) || 0;
  return {
    ok: true,
    health: {
      captures: (raw.captures ?? []).map((row) => ({
        id: String(row.id),
        court: String(row.court),
        party: String(row.party),
        airline: typeof row.airline === "string" ? row.airline : null,
        nextDay: String(row.next_day),
        status: String(row.status),
        lastReadAt: typeof row.last_read_at === "string" ? row.last_read_at : null,
        lastError: typeof row.last_error === "string" ? row.last_error : null,
        readDays: num(row.read_days),
        decisions: num(row.decisions),
        incompleteDays: num(row.incomplete_days),
      })),
      decisions: num(raw.decisions),
      theses: {
        released: raw.theses?.released === true,
        checked: num(raw.theses?.checked),
        agreed: num(raw.theses?.agreed),
        minChecked: num(raw.theses?.min_checked),
        minAgreement: num(raw.theses?.min_agreement),
      },
      sample: ((sample.data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        url: djenCertificateUrl(String(row.key)),
        court: String(row.court),
        unit: typeof row.unit === "string" ? row.unit : null,
        day: String(row.day),
        result: String(row.result),
        thesis: typeof row.thesis === "string" ? row.thesis : null,
      })),
      catalog: (catalog.data ?? []) as { slug: string; name: string }[],
    },
  };
}

export async function checkMarketThesis(decisionId: string, thesis: string): Promise<{ ok: boolean; code?: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_check_market_thesis", {
    target_decision: decisionId,
    target_thesis: thesis,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return { ok: Boolean(answer.ok), code: answer.code };
}

export type MarketReading = {
  rule: string;
  readByRule: number;
  decisions: number;
  checked: number;
  right: number;
  sample: {
    id: string;
    url: string;
    court: string;
    unit: string | null;
    day: string;
    result: string;
    moralCents: number | null;
    perClaimant: boolean;
    problem: string;
    extinctionReason: string | null;
    judge: string | null;
  }[];
};

/** How the reading of the decisions goes by the rule in force (0250), with a sample to check at the source. */
export async function readMarketReading(): Promise<{ ok: true; reading: MarketReading } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_market_reading");
  if (error || !data) return { ok: false, code: "failed" };
  const raw = data as Record<string, unknown>;
  const num = (value: unknown) => Number(value) || 0;
  return {
    ok: true,
    reading: {
      rule: String(raw.rule ?? ""),
      readByRule: num(raw.read_by_rule),
      decisions: num(raw.decisions),
      checked: num(raw.checked),
      right: num(raw.right),
      sample: ((raw.sample ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        url: djenCertificateUrl(String(row.key)),
        court: String(row.court),
        unit: typeof row.unit === "string" ? row.unit : null,
        day: String(row.day),
        result: String(row.result),
        moralCents: row.moral_cents === null || row.moral_cents === undefined ? null : Number(row.moral_cents),
        perClaimant: row.per_claimant === true,
        problem: String(row.problem),
        extinctionReason: typeof row.extinction_reason === "string" ? row.extinction_reason : null,
        judge: typeof row.judge === "string" ? row.judge : null,
      })),
    },
  };
}

/** The operator's word on a sampled decision's reading: right or wrong against the source. */
export async function checkMarketReading(decisionId: string, right: boolean): Promise<{ ok: boolean; code?: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_check_market_reading", {
    target_decision: decisionId,
    target_ok: right === true,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return { ok: Boolean(answer.ok), code: answer.code };
}

export async function releaseMarketTheses(released: boolean): Promise<{ ok: boolean; code?: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_release_market_theses", { target_released: released });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return { ok: Boolean(answer.ok), code: answer.code };
}
