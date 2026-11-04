import type { Sweep } from "@/lib/jobs/schedule";
import { checkFlights } from "@/modules/direito-do-passageiro/flights/checks-work";

/**
 * The check of the legs of the cases against ANAC's official record
 * (migration 0030): every 30 minutes, and right after a leg is written
 * (`queueFlightCheck`). A round claims the legs owed and downloads the few
 * months of the record they need, and only by the clock: two servers would
 * download the same month. Counts only; a leg, a case or a month of the record
 * is read inside it.
 */
export const flightSweeps: Sweep[] = [
  {
    key: "flight-checks",
    when: { every: 30 },
    run: async (service) => ({ ...(await checkFlights(service, { limit: 30 })) }),
  },
];
