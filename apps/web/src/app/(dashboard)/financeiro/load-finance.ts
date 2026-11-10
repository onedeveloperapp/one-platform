import "server-only";

import { cookies } from "next/headers";

import { momentLabel } from "@/lib/ai/approvals";
import { type FinanceAttention, readFinanceAttention } from "@/lib/finance/attention";
import type { FinanceBill } from "@/lib/finance/bills";
import type { FinanceHome, FinanceLevel } from "@/lib/finance/books";
import {
  type FinanceAccountRow,
  type FinanceCategory,
  type FinanceCostCenter,
  type FinanceEntryRow,
  type FinanceLine,
  type FinancePerson,
  readFinanceAccess,
  readFinanceBills,
  readFinanceEntries,
  readFinanceHome,
  readFinanceLines,
  readFinancePeople,
  readFinanceRegistrations,
} from "@/lib/finance/read";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export type FinanceRegistrations = {
  accounts: FinanceAccountRow[];
  categories: FinanceCategory[];
  costCenters: FinanceCostCenter[];
};

/** The session's second factor: confirmed, to confirm with a code, or none on the account. */
export type FactorState = "ok" | "challenge" | "missing";

export type FinanceState =
  | {
      kind: "ready";
      level: FinanceLevel;
      factor: FactorState;
      decides: boolean;
      /** A support visit reads nothing of the books and writes nothing. */
      supportVisit: boolean;
      firmName: string;
      home: FinanceHome;
      registrations: FinanceRegistrations;
      entries: FinanceEntryRow[] | null;
      lines: FinanceLine[] | null;
      people: FinancePerson[] | null;
      /** What waits in the books (0127): a statement late, a client's money to set apart; null when unread. */
      attention: FinanceAttention | null;
      /** The bills to pay and to receive (0129), when the page lists them. */
      bills: FinanceBill[] | null;
      readLabel: string;
    }
  /** The books are not open yet: who decides for the firm opens them; anybody else is told so. */
  | { kind: "closed"; decides: boolean; supportVisit: boolean; firmName: string; factor: FactorState }
  /** Who reads only the costs of the cases, or nothing: the books are not theirs to read. */
  | { kind: "not-reader"; level: FinanceLevel }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * What a page of `/financeiro` reads, under the person's own session (the database decides what each level reads):
 * the home of the books and their registrations always, and what the page lists (`with`).
 */
export async function loadFinance(
  withData: { entries?: boolean; lines?: boolean; people?: boolean; bills?: boolean } = {},
): Promise<FinanceState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const [access, cookieStore, assurance] = await Promise.all([
    readFinanceAccess(context.supabase, context.firm.id),
    cookies(),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!access) return { kind: "error" };
  const supportVisit = cookieStore.has(IMPERSONATION_MARKER_COOKIE);
  // `nextLevel` is aal2 exactly when the account has a verified factor; `currentLevel` when this session confirmed it.
  const factor: FactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  if (!access.opened) {
    return {
      kind: "closed",
      decides: access.decides && !supportVisit,
      supportVisit,
      firmName: context.firm.name,
      factor,
    };
  }
  if (access.level !== "view" && access.level !== "operate" && access.level !== "configure") {
    return { kind: "not-reader", level: access.level };
  }
  const [home, registrations, entries, lines, people, attention, bills] = await Promise.all([
    readFinanceHome(context.supabase, context.firm.id),
    readFinanceRegistrations(context.supabase, context.firm.id),
    withData.entries ? readFinanceEntries(context.supabase, context.firm.id) : Promise.resolve(null),
    withData.lines ? readFinanceLines(context.supabase, context.firm.id) : Promise.resolve(null),
    withData.people && access.decides ? readFinancePeople(context.supabase, context.firm.id) : Promise.resolve(null),
    context.supabase
      .rpc("firm_finance_attention", { target_org: context.firm.id })
      .then(({ data, error }) => (error ? null : readFinanceAttention(data))),
    withData.bills ? readFinanceBills(context.supabase, context.firm.id) : Promise.resolve(null),
  ]);
  if (home === "error" || home === null || !registrations) return { kind: "error" };
  if ((withData.entries && !entries) || (withData.lines && !lines) || (withData.bills && !bills)) {
    return { kind: "error" };
  }
  return {
    kind: "ready",
    level: access.level,
    factor,
    decides: access.decides,
    supportVisit,
    firmName: context.firm.name,
    home,
    registrations,
    entries,
    lines,
    people,
    attention,
    bills,
    readLabel: momentLabel(new Date().toISOString(), context.profile.timezone),
  };
}
