import type { CaseKind } from "@/lib/modules/types";

/**
 * The kinds of problem of a passenger case (`cases.incident`, migration 0022), the module's own. The core reads
 * them through the registry (`lib/modules/registry.ts`), never from here.
 */

export const PASSENGER_MODULE = "direito-do-passageiro";

export const INCIDENTS = [
  "delay",
  "cancellation",
  "overbooking",
  "missed_connection",
  "downgrade",
  "baggage_lost",
  "baggage_damaged",
  "baggage_delayed",
  "other",
] as const;
export type Incident = (typeof INCIDENTS)[number];

export const isIncident = (value: unknown): value is Incident => (INCIDENTS as readonly unknown[]).includes(value);

// The `product` message key of each kind, spelled out so the catalog check sees each one.
export const INCIDENT_KEY: Record<Incident, string> = {
  delay: "case-incident-delay",
  cancellation: "case-incident-cancellation",
  overbooking: "case-incident-overbooking",
  missed_connection: "case-incident-missed-connection",
  downgrade: "case-incident-downgrade",
  baggage_lost: "case-incident-baggage-lost",
  baggage_damaged: "case-incident-baggage-damaged",
  baggage_delayed: "case-incident-baggage-delayed",
  other: "case-incident-other",
};

/** The words a model reads for each kind (the check of a document, the order of the facts). */
export const INCIDENT_FOR_MODEL: Record<Incident, string> = {
  delay: "atraso de voo",
  cancellation: "cancelamento de voo",
  overbooking: "preterição de embarque",
  missed_connection: "perda de conexão",
  downgrade: "rebaixamento de classe",
  baggage_lost: "extravio de bagagem",
  baggage_damaged: "bagagem danificada",
  baggage_delayed: "atraso na entrega da bagagem",
  other: "outro problema com a viagem",
};

export const PASSENGER_CASE_KINDS: readonly CaseKind[] = INCIDENTS.map((key) => ({
  key,
  labelKey: INCIDENT_KEY[key],
  forModel: INCIDENT_FOR_MODEL[key],
}));
