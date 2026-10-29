import type { ModuleDefinition } from "@/lib/modules/types";
import { PASSENGER_CASE_KINDS, PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";

/**
 * Direito do Passageiro, the first module of ONE: air passengers' claims against airlines. What the core asks of
 * it (`lib/modules/types.ts`); its jobs are in `jobs.ts` beside this file, for the backend alone.
 *
 * Its partner is a travel agency (migration 0070): in its area it adds the passengers the partnership covers,
 * their trips and documents, and sends each one the link where they agree that ONE follows their flights.
 */
export const passengerModule: ModuleDefinition = {
  key: PASSENGER_MODULE,
  nameKey: "module-passenger",
  caseKinds: PASSENGER_CASE_KINDS,
  partnerArea: [
    {
      id: "parceiro-passageiros",
      href: "/parceiro/passageiros",
      icon: "NiLuggage",
      labelKey: "menu-parceiro-passageiros",
      descriptionKey: "menu-parceiro-passageiros-description",
    },
  ],
};
