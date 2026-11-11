import TeamView from "../team/components/team-view";
import { loadTeam } from "../team/load-team";

/**
 * /settings/escritorio: the firm's own data (the owner's canvas "ONE · Configurações", 2026-11-11): its name, the
 * partner's weekly digest and whether ONE's support may enter, each changed only by who the database lets.
 */
export default async function FirmDataPage() {
  return <TeamView part="firm" state={await loadTeam(null, null)} />;
}
