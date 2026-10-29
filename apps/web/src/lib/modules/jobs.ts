import "server-only";

import { passengerJobs } from "@/modules/direito-do-passageiro/jobs";

/**
 * The jobs of every module installed, for the one list of the platform's jobs (`app/api/inngest/route.ts`). With
 * `registry.ts`, the only file of the core that imports a module: the backend's half of what the core asks.
 */
export const moduleJobs = [...passengerJobs];
