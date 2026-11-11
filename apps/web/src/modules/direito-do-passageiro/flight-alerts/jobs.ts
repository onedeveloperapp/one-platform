import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { settleTripDay } from "@/modules/direito-do-passageiro/flight-alerts/trip-day-work";
import { watchTrips } from "@/modules/direito-do-passageiro/flight-alerts/watch";
import { tellFlightAlerts } from "@/modules/direito-do-passageiro/flight-alerts/work";
import { flightStatusProvider } from "@/modules/direito-do-passageiro/flights/status";

export const flightAlertSweeps: Sweep[] = [
  /**
   * The alerts of the flights ONE follows (migration 0047): what is due is
   * claimed and told, once each; an alert just kept is told right after
   * (`queueFlightAlert`). The database fences each alert by its claim, so two
   * rounds at once tell nothing twice. Counts only.
   */
  {
    key: "flight-alerts",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => ({ ...(await tellFlightAlerts(service, { alertId: null })) }),
  },
  /**
   * The flights ONE follows, read at FlightAware (0051): the database decides
   * which trips are due (their window, their interval, the platform's and each
   * firm's daily reads), so a round more reads nothing it should not. With no
   * key in this environment nothing is read.
   */
  /**
   * The day of the trips ONE follows (0173): about two hours before a journey leaves, a good trip, and half an hour
   * after it lands, whether all went well, each once, as the firm's template. The database keeps each, so a round
   * more writes nothing twice. Counts only.
   */
  {
    key: "trip-day",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => ({ ...(await settleTripDay(service)) }),
  },
  {
    key: "flight-watch",
    when: { every: 10 },
    whileUsed: true,
    run: async (service) => {
      const provider = flightStatusProvider();
      if (!provider) return { off: true };
      return { ...(await watchTrips(service, provider, { limit: 20 })) };
    },
  },
];
