import ContentConsoleView from "./content-console-view";

import { loadPlatformContent } from "@/lib/admin/platform-content";
import { loadConsole } from "@/lib/admin/session";

export const metadata = { title: "Conteúdo padrão" };

/**
 * /admin/conteudo: what ONE gives every firm (migration 0045): the models of
 * the initial of each kind of lawsuit, provisional until the curator reviews
 * them, and the sources they cite, each checked where it was published. Every
 * firm reads them in its library, and ONE writes from a model of the platform
 * for a firm that has none of that kind. Kept here, on the record.
 */
export default async function ContentConsolePage() {
  const state = await loadConsole(async ({ supabase }) => ({ content: await loadPlatformContent(supabase) }));
  return <ContentConsoleView state={state} />;
}
