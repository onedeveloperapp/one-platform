import TeamView from "../team/components/team-view";
import { loadTeam, teamQuery } from "../team/load-team";

/**
 * /settings/atuacao: the person's own practice (the owner's canvas "ONE · Configurações", 2026-11-11): their
 * registrations at the bar, the certificate they sign with in each court system and their own signature in the
 * cloud, with the PSC's answer and the case a lawyer came from to authorize it.
 */
export default async function ProfessionalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { outcome, backToCase } = teamQuery(await searchParams);
  return <TeamView part="professional" state={await loadTeam(outcome, backToCase)} />;
}
