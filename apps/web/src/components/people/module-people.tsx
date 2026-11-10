"use client";

import dynamic from "next/dynamic";

import { MODULES } from "@/lib/modules/registry";

/**
 * What the modules add to the firm's people (migration 0170), loaded when shown: the panel of a passenger the firm
 * registers itself (`firmPassenger`, offered in Pessoas and in "Adicionar") and each module's section of a person's
 * page (`personSection`). The core names neither: it asks the registry, for the modules the firm works in.
 */
const PASSENGER_PANELS = MODULES.modules.flatMap((definition) =>
  definition.firmPassenger
    ? [
        {
          key: definition.key,
          label: definition.firmPassenger.label,
          Panel: dynamic(definition.firmPassenger.panel, { ssr: false }),
        },
      ]
    : [],
);

const PERSON_SECTIONS = MODULES.modules.flatMap((definition) =>
  definition.personSection ? [{ key: definition.key, Section: dynamic(definition.personSection, { ssr: false }) }] : [],
);

/** The modules of the firm whose passenger the firm registers itself. */
export const passengerPanelsOf = (modules: readonly string[] | null | undefined) =>
  PASSENGER_PANELS.filter((panel) => (modules ?? []).includes(panel.key));

/** Each module's section of a person's page, for the modules the firm works in. */
export function PersonModuleSections({
  modules,
  personId,
  personName,
}: {
  modules: readonly string[] | null | undefined;
  personId: string;
  personName: string;
}) {
  return (
    <>
      {PERSON_SECTIONS.filter((section) => (modules ?? []).includes(section.key)).map(({ key, Section }) => (
        <Section key={key} personId={personId} personName={personName} />
      ))}
    </>
  );
}
