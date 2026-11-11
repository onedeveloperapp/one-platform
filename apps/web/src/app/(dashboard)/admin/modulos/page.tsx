import ModulesConsoleView from "./modules-console-view";

import { readModuleVersions } from "@/lib/admin/module-versions";
import { loadConsole } from "@/lib/admin/session";

export const metadata = { title: "Versões dos módulos" };

/**
 * /admin/modulos: the versions of each module (migration 0212). What a module's cases read (the documents by
 * problem, the version of each of its AI instructions, the platform's piece models) is a version only the operator
 * publishes; each case keeps the one it was opened under. The operator reads what changed since the latest
 * published, prepares the next version with what is in force, publishes it, and withdraws one with a defect.
 */
export default async function ModulesConsolePage() {
  const state = await loadConsole(async ({ supabase }) => {
    const { data, error } = await supabase.rpc("admin_module_versions");
    if (error) throw new Error("module versions unreadable");
    const modules = readModuleVersions(data);
    if (!modules) throw new Error("module versions unreadable");
    return { modules };
  });
  return <ModulesConsoleView state={state} />;
}
