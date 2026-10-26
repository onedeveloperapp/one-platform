import ConnectionsView from "./components/connections-view";

import { loadConnections } from "@/lib/whatsapp/connections-read";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const agenda = typeof query.agenda === "string" ? query.agenda.slice(0, 40) : null;
  return <ConnectionsView state={await loadConnections(agenda)} />;
}
