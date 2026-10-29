import "server-only";

import {
  followedLegsOf,
  type LegReading,
  legReadingOf,
  localDay,
} from "@/modules/direito-do-passageiro/flight-alerts/source";
import { evaluateTrip, tellFlightAlerts } from "@/modules/direito-do-passageiro/flight-alerts/work";
import { FlightAwareAuthError, FlightAwareQueryError } from "@flyee/flights/providers/flightaware";
import type { FlightStatusProvider } from "@flyee/flights/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The flights ONE follows, read at their source (migrations 0051 and 0074):
 * the database claims the trips with a leg inside its own window, within the
 * platform's daily reads and each firm's share, under a number each; each leg
 * it hands over is asked of FlightAware by its flight, day and airports (a
 * round trip's way back is not read on the days in between), what it says is
 * kept on the leg (`record_trip_watch`),
 * and the rule of 0047 reads the trip, an alert of a problem it finds told at
 * once as any other. A refused key stops the run with every claim given
 * back, and FlightAware out of reach gives the trip back for the next sweep:
 * neither spends anything of a trip. Nothing of a passenger is kept in a
 * job's state: the steps carry counts.
 */

export type WatchReport = { claimed: number; read: number; told: number; failed: number; stopped: boolean };

type Claimed = { trip_id: string; claim: number; org_id: string; legs: unknown };

export async function watchTrips(
  service: SupabaseClient,
  provider: FlightStatusProvider,
  options: { limit?: number; tripId?: string | null } = {},
): Promise<WatchReport> {
  const report: WatchReport = { claimed: 0, read: 0, told: 0, failed: 0, stopped: false };
  const { data, error } = await service.rpc("claim_trip_watch", {
    target_limit: options.limit ?? 10,
    target_trip: options.tripId ?? null,
  });
  if (error) throw new Error("trips could not be claimed");
  const claimed = (Array.isArray(data) ? data : []) as Claimed[];
  report.claimed = claimed.length;

  for (const row of claimed) {
    const giveBack = () =>
      service.rpc("release_trip_watch", { target_trip: row.trip_id, target_claim: row.claim }).then(
        () => undefined,
        () => undefined,
      );
    if (report.stopped) {
      await giveBack();
      continue;
    }
    const readings: LegReading[] = [];
    let problem: string | null = null;
    try {
      for (const leg of followedLegsOf(row.legs)) {
        const status = await provider.getFlightStatus({
          flight: leg.flightNumber,
          date: localDay(leg.departure),
          origin: leg.origin,
          destination: leg.destination,
        });
        const reading = legReadingOf(leg, status);
        if (reading) readings.push(reading);
        else problem = "flight_not_found";
      }
    } catch (failure) {
      if (failure instanceof FlightAwareAuthError) {
        // The platform's key was refused: nothing more is read in this run, and nothing of a trip is spent.
        report.stopped = true;
        await giveBack();
        continue;
      }
      if (!(failure instanceof FlightAwareQueryError)) {
        // FlightAware out of reach: the trip is read again at the next sweep.
        report.failed += 1;
        await giveBack();
        continue;
      }
      problem = "query_refused";
    }

    const { data: recorded, error: recordError } = await service.rpc("record_trip_watch", {
      target_trip: row.trip_id,
      target_claim: row.claim,
      target_legs: readings,
      target_error: problem,
    });
    const kept = (recorded ?? {}) as { ok?: boolean; legs?: unknown; delay_minutes?: unknown };
    if (recordError || !kept.ok) {
      report.failed += 1;
      continue;
    }
    report.read += 1;
    try {
      const { alertId } = await evaluateTrip(service, {
        tripId: row.trip_id,
        legs: kept.legs,
        delayMinutes: typeof kept.delay_minutes === "number" ? kept.delay_minutes : 240,
      });
      if (alertId) {
        const told = await tellFlightAlerts(service, { alertId });
        report.told += told.queued;
      }
    } catch {
      // The alert is kept or still due: the alerts' sweep tells it.
    }
  }
  return report;
}
