import "server-only";

import { firstNameOf } from "@/lib/cases/cases";
import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The passenger's welcome (migration 0174): once a passenger the agency or the firm registered agrees, ONE writes to
 * them in the firm's name, once per WhatsApp and firm, as the firm's template of `welcome`: the firm follows their
 * flights, and what a passenger is owed by ANAC's rules. The database decides what is owed (`welcomes_owed`) and what
 * may go (`reserve_passenger_welcome`); the outbox sends it. Counts only.
 */

export type WelcomeReport = { owed: number; queued: number; skipped: number; failed: number; sent: number };

/** The two values of the template: the passenger's first name and the firm. */
export function welcomeParams(passengerName: string, firm: string): string[] {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return [clean(firstNameOf(passengerName) || passengerName), clean(firm)];
}

/** Writes the welcomes owed: one trip named, or the oldest agreements. Never throws. */
export async function settleWelcomes(
  service: SupabaseClient,
  options: { tripId?: string | null } = {},
): Promise<WelcomeReport> {
  const report: WelcomeReport = { owed: 0, queued: 0, skipped: 0, failed: 0, sent: 0 };
  try {
    const { data, error } = await service.rpc("welcomes_owed", {
      target_limit: 20,
      target_trip: options.tripId ?? null,
    });
    if (error) return report;
    const owed = (Array.isArray(data) ? data : []) as { trip_id?: unknown; passenger_name?: unknown; firm?: unknown }[];
    report.owed = owed.length;
    for (const row of owed) {
      if (typeof row.trip_id !== "string") continue;
      try {
        const { data: reserved, error: reserveError } = await service.rpc("reserve_passenger_welcome", {
          target_trip: row.trip_id,
          target_params: welcomeParams(String(row.passenger_name ?? ""), String(row.firm ?? "")),
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
  } catch {
    // The next sweep reads what is owed again.
  }
  return report;
}

/** A passenger just agreed: their welcome goes right after the answer. Never waited for: the sweep writes it anyway. */
export function queueWelcome(tripId: string | null = null): void {
  soon("passenger-welcome", () => settleWelcomes(createServiceClient(), { tripId }));
}
