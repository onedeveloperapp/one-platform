import { checkFlights } from "@/modules/direito-do-passageiro/flights/checks-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The check of the legs of the cases against ANAC's official record
 * (migration 0030): every 30 minutes, and at once when a leg is written
 * (`one/case.flights.changed`). One run claims the legs owed and downloads the
 * few months of the record they need, in one step: a claim is worked on in
 * the step that took it. The step carries counts only; a leg, a case or a
 * month of the record is read inside it.
 */
export const flightChecksFunction = inngest.createFunction(
  { id: "one-flight-checks", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/30 * * * *" }, { event: "one/case.flights.changed" }],
  async ({ step }) => step.run("check-flights", () => checkFlights(createServiceClient(), { limit: 30 })),
);

export const flightFunctions = [flightChecksFunction];
