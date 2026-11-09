"use server";

import {
  isPortfolioSheet,
  type PortfolioBegun,
  portfolioBegunOf,
  type PortfolioRow,
  portfolioRowsOf,
} from "@/lib/controladoria/portfolio";
import { getMemberContext } from "@/lib/member/context";
import { notifyLocalized } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";

/**
 * Tells the others who decide for the firm or manage it that somebody took the whole portfolio: it holds every
 * client's personal data, and whoever is not expecting it should know. Best effort: a notice that could not be written
 * takes nothing back of what is on the record.
 */
async function tellPortfolioTaken(firm: string, who: string, name: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const { data, error } = await createServiceClient()
      .from("memberships")
      .select("user_id, role, firm_function")
      .eq("org_id", firm);
    if (error) return;
    const others = ((data ?? []) as { user_id: string; role: string; firm_function: string }[])
      .filter((member) => member.user_id !== who)
      .filter((member) => member.firm_function === "socio" || member.role === "owner" || member.role === "admin")
      .map((member) => member.user_id);
    await notifyLocalized(others, (copy) => copy.portfolioTaken(name), { type: "team", href: "/controladoria" });
  } catch {
    // Best effort, as above.
  }
}

/**
 * Begins taking the firm's whole portfolio (migration 0117), under the person's own session: the database says who may
 * and keeps it on the record, with how many rows of each sheet and nothing of anybody.
 */
export async function beginPortfolioExport(tests: unknown): Promise<PortfolioBegun> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("begin_portfolio_export", {
    target_org: context.firm.id,
    target_tests: tests !== false,
  });
  if (error) return { ok: false, code: "failed" };
  const begun = portfolioBegunOf(data);
  if (begun.ok) await tellPortfolioTaken(context.firm.id, context.userId, context.profile.displayName);
  return begun;
}

/** A page of one sheet of a portfolio this person began, from the row asked for. */
export async function readPortfolioPage(
  sheet: unknown,
  offset: unknown,
  tests: unknown,
): Promise<{ ok: true; rows: PortfolioRow[] } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm || !isPortfolioSheet(sheet)) return { ok: false };
  const { data, error } = await context.supabase.rpc("firm_portfolio_page", {
    target_org: context.firm.id,
    target_sheet: sheet,
    target_offset: typeof offset === "number" && Number.isInteger(offset) && offset >= 0 ? offset : 0,
    target_tests: tests !== false,
  });
  if (error) return { ok: false };
  const rows = portfolioRowsOf(data);
  return rows ? { ok: true, rows } : { ok: false };
}
