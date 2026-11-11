/**
 * The version of its module a case was opened under (migration 0212), and the one it reads: its own while published,
 * the module's latest published once its own was withdrawn. Pure: the database answers (`case_module_version`).
 */
export type CaseModuleVersion = {
  module: string;
  moduleName: string | null;
  version: number | null;
  withdrawn: boolean;
  reads: number | null;
};

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

export function readCaseModuleVersion(raw: unknown): CaseModuleVersion | null {
  const answer = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!answer || answer.ok !== true || typeof answer.module !== "string") return null;
  return {
    module: answer.module,
    moduleName: typeof answer.module_name === "string" && answer.module_name.trim() ? answer.module_name : null,
    version: whole(answer.version),
    withdrawn: answer.withdrawn === true,
    reads: whole(answer.reads),
  };
}

/** The version in words, as the dossier writes it; null for a case of no version. */
export function moduleVersionWords(raw: unknown): string | null {
  const version = readCaseModuleVersion(raw);
  if (!version || version.version === null) return null;
  const name = version.moduleName ?? version.module;
  if (version.withdrawn) {
    return version.reads !== null
      ? `${name}, versão ${version.version}, retirada: o caso segue a versão ${version.reads}`
      : `${name}, versão ${version.version}, retirada`;
  }
  return `${name}, versão ${version.version}`;
}
