import type { ModuleDefinition } from "@/lib/modules/types";
import { PASSENGER_CASE_KINDS, PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";

/**
 * Direito do Passageiro, the first module of ONE: air passengers' claims against airlines. What the core asks of
 * it (`lib/modules/types.ts`); its jobs are in `jobs.ts` beside this file, for the backend alone.
 */
export const passengerModule: ModuleDefinition = {
  key: PASSENGER_MODULE,
  nameKey: "module-passenger",
  caseKinds: PASSENGER_CASE_KINDS,
  partnerArea: [],
};
