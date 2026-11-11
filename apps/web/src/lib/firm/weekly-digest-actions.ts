"use server";

import { readWeeklyFacts, weekLabel, weeklyLinks } from "@/lib/firm/weekly-digest";
import { getMemberContext } from "@/lib/member/context";
import { isEmailConfigured, weeklyDigestItems, type WeeklyDigestSection, weeklyDigestSections } from "@flyee/email";

/**
 * The partner's weekly digest in the person's settings (migration 0200): whether they receive it, and the week before
 * this one in the very words the next e-mail would use. Only who decides for the firm reads it.
 */
export type WeeklyDigestRead =
  | {
      ok: true;
      decides: true;
      on: boolean;
      /** Whether an e-mail can leave ONE in this environment. */
      emailReady: boolean;
      weekLabel: string;
      testsCounted: boolean;
      empty: boolean;
      sections: WeeklyDigestSection[];
    }
  | { ok: true; decides: false }
  | { ok: false };

export async function readWeeklyDigest(): Promise<WeeklyDigestRead> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const { data, error } = await context.supabase.rpc("firm_weekly_digest", { target_org: context.firm.id });
  if (error) return { ok: false };
  const answer = (data ?? {}) as Record<string, unknown>;
  if (answer.ok !== true) return { ok: false };
  if (answer.decides !== true) return { ok: true, decides: false };
  const facts = readWeeklyFacts(answer.facts);
  if (!facts) return { ok: false };
  return {
    ok: true,
    decides: true,
    on: answer.on !== false,
    emailReady: isEmailConfigured,
    weekLabel: weekLabel(facts.week),
    testsCounted: facts.testsCounted,
    empty: weeklyDigestItems(facts) === 0,
    sections: weeklyDigestSections("pt-BR", facts, weeklyLinks("")),
  };
}

/** The person stops or starts their weekly digest; the database checks who may and keeps it on the record. */
export async function setWeeklyDigest(on: boolean): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("set_weekly_digest", {
    target_org: context.firm.id,
    target_on: on,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown };
  return answer.ok ? { ok: true } : { ok: false, code: String(answer.code ?? "failed") };
}
