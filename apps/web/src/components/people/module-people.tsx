"use client";

import dynamic from "next/dynamic";

import { MODULES } from "@/lib/modules/registry";

/**
 * What the modules add to the firm's people (migration 0170), loaded when shown: each module's step for a person the
 * firm just registered (`personStep`: "Acompanhar uma viagem", offered after "Nova pessoa", which is the core's) and
 * each module's section of a person's page (`personSection`). The core names neither: it asks the registry, for the
 * modules the firm works in.
 */
const PERSON_STEPS = MODULES.modules.flatMap((definition) =>
  definition.personStep
    ? [
        {
          key: definition.key,
          label: definition.personStep.label,
          description: definition.personStep.description,
          Panel: dynamic(definition.personStep.panel, { ssr: false }),
        },
      ]
    : [],
);

const PERSON_SECTIONS = MODULES.modules.flatMap((definition) =>
  definition.personSection ? [{ key: definition.key, Section: dynamic(definition.personSection, { ssr: false }) }] : [],
);

/** The steps of the modules of the firm for a person it just registered. */
export const personStepsOf = (modules: readonly string[] | null | undefined) =>
  PERSON_STEPS.filter((step) => (modules ?? []).includes(step.key));

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
