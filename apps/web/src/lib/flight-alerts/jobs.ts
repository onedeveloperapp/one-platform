import "server-only";

import { tellFlightAlerts } from "@/lib/flight-alerts/work";
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

export const flightAlertFunctions = [flightAlertsFunction];
