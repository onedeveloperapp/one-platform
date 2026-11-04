import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { agencySweeps } from "@/modules/direito-do-passageiro/agency/jobs";
import { flightAlertSweeps } from "@/modules/direito-do-passageiro/flight-alerts/jobs";
import { flightSweeps } from "@/modules/direito-do-passageiro/flights/jobs";

/** Every sweep of the passenger module, for the core's list of sweeps (`lib/modules/jobs.ts`). */
export const passengerSweeps: Sweep[] = [...flightSweeps, ...flightAlertSweeps, ...agencySweeps];
