import "server-only";

import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { type AlertLeg, alertParams } from "@/modules/direito-do-passageiro/flight-alerts/words";
import { createServiceClient } from "@flyee/auth/service";
import { FLIGHT_PROBLEM_RULE, type FlightProblem, flightProblems, type WatchedLeg } from "@flyee/rules/flight-problem";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the flights ONE follows (migration 0047): what a
 * source says of a trip's legs is read by the rule (`flight-problem-v4`), and
 * a problem it finds is one alert per journey and fact, kept by the database
 * (0172: the way back of a trip that became a case is still told);
 * each alert is claimed under a number, its values are written here from the
 * rule (`flight-alerts/words.ts` of the module), and the database sends it as the
 * firm's template, once, through the outbox of 0019, or says why it could
 * not. Nothing of a passenger is kept in a job's state: the steps carry ids
 * and counts.
 */

type LegRow = {
  position: number;
  origin: string | null;
  destination: string | null;
  departure: string;
  arrival: string;
  status: WatchedLeg["status"];
  estimated_arrival: string | null;
};

const STATUSES: readonly WatchedLeg["status"][] = ["scheduled", "delayed", "cancelled", "changed", "landed"];

/** The legs as the database answered them, read for the rule; what is not a leg is left out. */
export function watchedLegs(raw: unknown): WatchedLeg[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<LegRow>[]).flatMap((row): WatchedLeg[] =>
    typeof row.position === "number" &&
    typeof row.departure === "string" &&
    typeof row.arrival === "string" &&
    STATUSES.includes(row.status as WatchedLeg["status"])
      ? [
          {
            position: row.position,
            scheduledDeparture: row.departure,
            scheduledArrival: row.arrival,
            status: row.status as WatchedLeg["status"],
            estimatedArrival: typeof row.estimated_arrival === "string" ? row.estimated_arrival : null,
            origin: typeof row.origin === "string" ? row.origin : null,
            destination: typeof row.destination === "string" ? row.destination : null,
          },
        ]
      : [],
  );
}

/**
 * Reads a trip's legs with the rule and keeps the alert of what it found on each journey (0172). Answers the
 * problem (the first journey's that is new, else the first found; null when there is none) and the id of the alert
 * kept new; a journey already known, or one a case took, keeps nothing new.
 */
export async function evaluateTrip(
  service: SupabaseClient,
  input: { tripId: string; legs: unknown; delayMinutes: number },
): Promise<{ problem: FlightProblem | null; alertId: string | null }> {
  const problems = flightProblems(watchedLegs(input.legs), { delayMinutes: input.delayMinutes });
  if (problems.length === 0) return { problem: null, alertId: null };
  let kept: { problem: FlightProblem; alertId: string } | null = null;
  for (const problem of problems) {
    const { data, error } = await service.rpc("record_flight_alert", {
      target_trip: input.tripId,
      target_kind: problem.kind,
      target_leg: problem.leg,
      target_delay: problem.delayMinutes,
      target_rule: FLIGHT_PROBLEM_RULE,
      target_journey: problem.journey,
      target_legs: problem.legs,
    });
    if (error) throw new Error("the alert could not be kept");
    const answer = (data ?? {}) as { ok?: boolean; code?: string; alert_id?: unknown };
    if (!kept && answer.code === "recorded" && typeof answer.alert_id === "string") {
      kept = { problem, alertId: answer.alert_id };
    }
  }
  const first = problems[0];
  return kept ?? { problem: { kind: first.kind, leg: first.leg, delayMinutes: first.delayMinutes }, alertId: null };
}

type Claimed = {
  alert_id: string;
  claim: number;
  kind: FlightProblem["kind"];
  delay_minutes: number | null;
  passenger_name: string;
  firm: string;
  legs: {
    position: number;
    flight_number: string;
    origin: string;
    origin_city: string | null;
    destination: string;
    destination_city: string | null;
    departure: string;
  }[];
};

export type AlertReport = { claimed: number; queued: number; skipped: number; failed: number; sent: number };

/** One claimed alert: its values written, reserved by the database, and its message sent. Never throws. */
async function tellOne(service: SupabaseClient, row: Claimed, report: AlertReport): Promise<void> {
  try {
    const legs: AlertLeg[] = (row.legs ?? []).map((leg) => ({
      position: leg.position,
      flightNumber: leg.flight_number,
      origin: leg.origin,
      originCity: leg.origin_city,
      destination: leg.destination,
      destinationCity: leg.destination_city,
      departure: leg.departure,
    }));
    const params = alertParams({
      kind: row.kind,
      delayMinutes: row.delay_minutes,
      passengerName: row.passenger_name,
      firm: row.firm,
      legs,
    });
    const { data, error } = await service.rpc("reserve_flight_alert", {
      target_alert: row.alert_id,
      target_claim: row.claim,
      target_params: params,
    });
    if (error) throw new Error("reserve failed");
    const answer = (data ?? {}) as { code?: string; message_id?: unknown };
    if (answer.code === "skipped") {
      report.skipped += 1;
      return;
    }
    if (answer.code !== "queued" || typeof answer.message_id !== "string") {
      report.failed += 1;
      return;
    }
    report.queued += 1;
    try {
      const delivered = await deliverOutbox(service, { messageId: answer.message_id });
      report.sent += delivered.sent;
    } catch {
      // Queued: the outbox's sweep sends it.
    }
  } catch {
    report.failed += 1;
    // Given back: the next sweep takes it again.
    await service.rpc("release_flight_alert", { target_alert: row.alert_id, target_claim: row.claim }).then(
      () => undefined,
      () => undefined,
    );
  }
}

/** Tells what is due: one alert named, or the oldest. Throws only when nothing could be claimed at all. */
export async function tellFlightAlerts(
  service: SupabaseClient,
  options: { alertId?: string | null; limit?: number } = {},
): Promise<AlertReport> {
  const report: AlertReport = { claimed: 0, queued: 0, skipped: 0, failed: 0, sent: 0 };
  const { data, error } = await service.rpc("claim_flight_alerts", {
    target_limit: options.limit ?? 10,
    target_alert: options.alertId ?? null,
  });
  if (error) throw new Error("flight alerts could not be claimed");
  const claimed = (Array.isArray(data) ? data : []) as Claimed[];
  report.claimed = claimed.length;
  for (const row of claimed) await tellOne(service, row, report);
  return report;
}

/**
 * An alert was just kept: it is told right after the response. Never waited
 * for: the sweep tells it anyway.
 */
export async function queueFlightAlert(alertId: string | null): Promise<void> {
  soon("flight-alert", () => tellFlightAlerts(createServiceClient(), { alertId }));
}
