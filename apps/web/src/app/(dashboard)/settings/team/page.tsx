import TeamView from "./components/team-view";
import { loadTeam, teamQuery } from "./load-team";

/** /settings/team: who is in the firm and what each one does, the invitations, and the team's cloud signatures. */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { outcome, backToCase } = teamQuery(await searchParams);
  return <TeamView part="team" state={await loadTeam(outcome, backToCase)} />;
}
