import "server-only";

import { flightAlertFunctions } from "@/modules/direito-do-passageiro/flight-alerts/jobs";
import { flightFunctions } from "@/modules/direito-do-passageiro/flights/jobs";

/** Every job of the passenger module, for the core's list of jobs (`lib/modules/jobs.ts`). */
export const passengerJobs = [...flightFunctions, ...flightAlertFunctions];
