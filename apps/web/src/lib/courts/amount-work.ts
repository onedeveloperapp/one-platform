import "server-only";

import { amountDue, monthsNeeded, paymentTermEnds } from "@/lib/courts/amount";
import { calendarOf } from "@/lib/deadlines/deadlines";
import { courtCalendar } from "@/lib/deadlines/facts";
import type { Sweep } from "@/lib/jobs/schedule";
import { BcbIndexSource, FakeIndexSource, type IndexSource } from "@flyee/indices";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the amount due of each condemnation (migration 0184): the lawsuits owed a computation, the
 * Banco Central's monthly rates of the months they need (read once per round), and what ONE records of each. A series
 * out of reach leaves the lawsuits for the next round. Counts only.
 */

/** The Banco Central's series, or the fake where `INDICES_FAKE=1` and never in production. */
function indexSource(): IndexSource {
  if (process.env.INDICES_FAKE === "1" && process.env.VERCEL_ENV !== "production") {
    return new FakeIndexSource({
      ipca: Object.fromEntries(monthsSince("2024-08").map((month) => [month, 0.4])),
      selic: Object.fromEntries(monthsSince("2024-08").map((month) => [month, 0.9])),
    });
  }
  return new BcbIndexSource();
}

function monthsSince(first: string): string[] {
  const months: string[] = [];
  const now = new Date().toISOString().slice(0, 7);
  let [year, month] = first.split("-").map(Number);
  for (let guard = 0; guard < 240; guard += 1) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    if (value > now) break;
    months.push(value);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

const todayInBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

type Owed = {
  proceeding_id: string;
  judgment_fact_id: string;
  principal_cents: number;
  judgment_on: string;
  interest_from: string;
  final_on: string;
  deposited_cents: number;
  last_deposit_on: string | null;
  kind: string | null;
  court: string | null;
  system: string | null;
  comarca: string | null;
};

/**
 * The last day of the airline's term to pay in the small-claims court (0214): 15 business days from the final
 * judgment over the court's calendar, read once per court and year in a round. Null in the civil court, and when the
 * calendar could not be read (the rule then waits three weeks).
 */
async function payUntilOf(
  service: SupabaseClient,
  row: Owed,
  finalOn: string,
  calendars: Map<string, Awaited<ReturnType<typeof courtCalendar>> | null>,
): Promise<string | null> {
  if (row.kind !== "juizado" || !row.court) return null;
  const key = `${row.court}:${finalOn.slice(0, 4)}`;
  if (!calendars.has(key)) {
    calendars.set(key, await courtCalendar(service, row.court, Number(finalOn.slice(0, 4))).catch(() => null));
  }
  const rows = calendars.get(key);
  if (!rows) return null;
  return paymentTermEnds(
    finalOn,
    { proceedingKind: row.kind, system: row.system, comarca: row.comarca },
    calendarOf(rows.years, rows.days),
  );
}

export async function computeAmounts(service: SupabaseClient, source: IndexSource = indexSource()) {
  const { data, error } = await service.rpc("lawsuit_amounts_owed", { target_limit: 50 });
  if (error) throw new Error("lawsuit_amounts_owed failed");
  const rows = (data ?? []) as Owed[];
  if (rows.length === 0) return { computed: 0 };
  const today = todayInBrasilia();
  const calendars = new Map<string, Awaited<ReturnType<typeof courtCalendar>> | null>();
  const facts = [];
  for (const row of rows) {
    const finalOn = String(row.final_on).slice(0, 10);
    facts.push({
      row,
      facts: {
        principalCents: Number(row.principal_cents),
        judgmentOn: String(row.judgment_on).slice(0, 10),
        interestFrom: String(row.interest_from).slice(0, 10),
        finalOn,
        depositedCents: Number(row.deposited_cents ?? 0),
        lastDepositOn: row.last_deposit_on ? String(row.last_deposit_on).slice(0, 10) : null,
        kind: row.kind === "comum" ? ("comum" as const) : ("juizado" as const),
        payUntil: await payUntilOf(service, row, finalOn, calendars),
      },
    });
  }
  const from = facts.map(({ facts: item }) => monthsNeeded(item, today).from).sort()[0] ?? today.slice(0, 7);
  const to = today.slice(0, 7);
  const [ipca, selic] = await Promise.all([source.monthly("ipca", from, to), source.monthly("selic", from, to)]);
  if (ipca.kind !== "read" || selic.kind !== "read") return { computed: 0, unavailable: 1 };
  let computed = 0;
  for (const { row, facts: item } of facts) {
    const amount = amountDue(item, { ipca: ipca.rates, selic: selic.rates }, today);
    const { error: recordError } = await service.rpc("record_lawsuit_amount", {
      target_proceeding: row.proceeding_id,
      target_amount: {
        judgment_fact_id: row.judgment_fact_id,
        rule: amount.rule,
        principal_cents: item.principalCents,
        correction_from: item.judgmentOn,
        interest_from: item.interestFrom,
        as_of: today,
        corrected_cents: amount.correctedCents,
        interest_cents: amount.interestCents,
        total_cents: amount.totalCents,
        missing: amount.missing,
        needs_terms: amount.needsTerms,
        deposited_cents: item.depositedCents,
        last_deposit_on: item.lastDepositOn,
        next_step: amount.step,
        short_cents: amount.shortCents,
        fine_cents: amount.fineCents,
        pay_until: amount.payUntil,
      },
    });
    if (!recordError) computed += 1;
  }
  return { computed };
}

export const amountSweeps: Sweep[] = [
  {
    // The amount due of each final condemnation, once a day and when a deposit came (0184): the clock's only, since
    // it reads the Banco Central's series.
    key: "lawsuit-amounts",
    when: { daily: { hour: 10, minute: 20 } },
    run: async (service) => computeAmounts(service),
  },
];
