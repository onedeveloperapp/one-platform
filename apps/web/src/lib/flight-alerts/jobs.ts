import "server-only";

import { watchTrips } from "@/lib/flight-alerts/watch";
import { tellFlightAlerts } from "@/lib/flight-alerts/work";
import { flightStatusProvider } from "@/lib/flights/status";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The alerts of the flights ONE follows (migration 0047): every two minutes,
 * what is due is claimed and told, once each; and at once when an alert was
 * just kept (`one/flight.alerts`). One run at a time: the database fences
 * each alert by its claim besides. The steps carry counts only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const flightAlertsFunction = inngest.createFunction(
  { id: "one-flight-alerts", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/2 * * * *" }, { event: "one/flight.alerts" }],
  async ({ event, step }) => {
    const named = event.name === "one/flight.alerts" ? event.data?.alertId : null;
    const alertId = typeof named === "string" && UUID.test(named) ? named : null;
    return step.run("tell", () => tellFlightAlerts(createServiceClient(), { alertId }));
  },
);

/**
 * The flights ONE follows, read at FlightAware every ten minutes (0051): the
 * database decides which trips are due (their window, their interval, the
 * platform's daily reads). With no key in this environment nothing is read.
 */
export const flightWatchFunction = inngest.createFunction(
  { id: "one-flight-watch", retries: 0, concurrency: { limit: 1 } },
  { cron: "*/10 * * * *" },
  async ({ step }) =>
    step.run("watch", async () => {
      const provider = flightStatusProvider();
      if (!provider) return { claimed: 0, read: 0, told: 0, failed: 0, stopped: false };
      return watchTrips(createServiceClient(), provider, { limit: 20 });
    }),
);

export const flightAlertFunctions = [flightAlertsFunction, flightWatchFunction];
