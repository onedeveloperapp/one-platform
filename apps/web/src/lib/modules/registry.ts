import { buildRegistry } from "@/lib/modules/build";
import { passengerModule } from "@/modules/direito-do-passageiro/definition";

/**
 * The modules installed in ONE, and what the core asks of them. One of the two files of the core that import a
 * module (the other is `lib/modules/jobs.ts`, for the backend's jobs); everything else asks here. Safe for the
 * browser: a module's definition carries no server code.
 */
export const MODULES = buildRegistry([passengerModule]);

export const { moduleOf, caseKindsOf, caseKindsOfFirm, isCaseKindOf, caseKindLabelKey, caseKindForModel } = MODULES;

/**
 * The kinds of problem a firm's screens offer: those of the modules it uses (the viewer's, or the member
 * context's), or, with no firm to read (a clone without Supabase), every module's.
 */
export const firmCaseKinds = (modules: readonly string[] | null | undefined) =>
  caseKindsOfFirm(modules ?? MODULES.modules.map((definition) => definition.key));
