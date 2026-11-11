import "server-only";

import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { dayParams, dayTripsOf, dayWordsDue } from "@/modules/direito-do-passageiro/flight-alerts/trip-day";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the day of a trip (migration 0173): the trips whose day may owe a word are read
 * (`trip_day_trips`), the rule says which journey owes what (`trip-day.ts`), and the database writes each once, as
 * the firm's template, or keeps why it could not (`reserve_trip_day_message`); the outbox sends it. Counts only.
 */

export type TripDayReport = { trips: number; queued: number; skipped: number; failed: number; sent: number };

/** Writes what the trips owe now; in the test chat, what the tester just made happen on one trip. Never throws. */
export async function settleTripDay(
  service: SupabaseClient,
  options: { tripId?: string; event?: { kind: "depart" | "land"; position: number } } = {},
): Promise<TripDayReport> {
  const report: TripDayReport = { trips: 0, queued: 0, skipped: 0, failed: 0, sent: 0 };
  try {
    const { data, error } = await service.rpc("trip_day_trips", {
      target_limit: 50,
      target_trip: options.tripId ?? null,
    });
    if (error) return report;
    const trips = dayTripsOf(data);
    report.trips = trips.length;
    const now = new Date();
    for (const trip of trips) {
      // A tester's event speaks for a test trip alone; a real trip goes by the clock.
      const event = options.event && trip.test ? options.event : null;
      for (const word of dayWordsDue(trip, now, event)) {
        try {
          const { data: reserved, error: reserveError } = await service.rpc("reserve_trip_day_message", {
            target_trip: trip.tripId,
            target_journey: word.journey,
            target_kind: word.kind,
            target_params: dayParams(trip, word),
          });
          if (reserveError) throw new Error("reserve failed");
          const answer = (reserved ?? {}) as { code?: string; message_id?: unknown };
          if (answer.code === "skipped") report.skipped += 1;
          if (answer.code !== "queued" || typeof answer.message_id !== "string") continue;
          report.queued += 1;
          try {
            report.sent += (await deliverOutbox(service, { messageId: answer.message_id })).sent;
          } catch {
            // Queued: the outbox's sweep sends it.
          }
        } catch {
          report.failed += 1;
        }
      }
    }
  } catch {
    // The next sweep reads the trips again.
  }
  return report;
}

/** A tester made a leg of a test trip leave or land: its word goes right after the answer. */
export function queueTripDay(tripId: string, event: { kind: "depart" | "land"; position: number }): void {
  soon("trip-day", () => settleTripDay(createServiceClient(), { tripId, event }));
}
