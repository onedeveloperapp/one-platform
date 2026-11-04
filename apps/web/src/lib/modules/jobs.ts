import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { passengerSweeps } from "@/modules/direito-do-passageiro/jobs";

/**
 * The sweeps of every module installed, for the one list of the platform's sweeps (`lib/jobs/registry.ts`). With
 * `registry.ts`, the only file of the core that imports a module: the backend's half of what the core asks.
 */
export const moduleSweeps: Sweep[] = [...passengerSweeps];
