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
  // What only this module has, in its area of the firm's app: its partner agencies, the portfolio a firm brings
  // from the system it used before (a spreadsheet of air-passenger lawsuits) and the value each kind of problem asks.
  firmArea: [
    {
      id: "parceiros",
      href: "/settings/parceiros",
      icon: "NiBuilding",
      labelKey: "module-area-partners",
      descriptionKey: "module-area-partners-hint",
    },
    {
      id: "importar",
      href: "/casos/importar",
      icon: "NiUploadCloud",
      labelKey: "module-area-import",
      descriptionKey: "module-area-import-hint",
      importers: true,
    },
    {
      id: "configurar",
      href: "/configurar/direito-do-passageiro",
      icon: "NiSettings",
      labelKey: "module-area-setup",
      descriptionKey: "module-area-setup-hint",
    },
    {
      id: "valor-da-causa",
      href: "/settings/autonomia#valor-da-causa-pedido",
      icon: "NiMoney",
      labelKey: "module-area-claim-value",
      descriptionKey: "module-area-claim-value-hint",
    },
  ],
  testChat: true,
  // The travel agency is this module's partner (0069): its setup is this module's page (0080), the second factor
  // first, then its name, the clause of its contract, its team and how its passengers reach ONE.
  partnerSetup: { kind: "agency", href: "/parceiro/configurar" },
  // What a firm sets up of this module, after the core and before the home (0081): the Valor da Causa Pedido of the
  // air-passenger problems, the words of the clause its agencies register, and the partner agency.
  firmSetup: "/configurar/direito-do-passageiro",
  partnerArea: [
    {
      id: "parceiro-passageiros",
      href: "/parceiro/passageiros",
      icon: "NiLuggage",
      labelKey: "menu-parceiro-passageiros",
      descriptionKey: "menu-parceiro-passageiros-description",
    },
    // The agency's setup, reopened from its home and its menu at any time (0080).
    {
      id: "parceiro-configurar",
      href: "/parceiro/configurar",
      icon: "NiSettings",
      labelKey: "menu-parceiro-configurar",
      descriptionKey: "menu-parceiro-configurar-description",
    },
  ],
};
