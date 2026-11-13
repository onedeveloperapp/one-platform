import RoomsView, { type RoomsState } from "./rooms-view";
import { cookies } from "next/headers";

import { chatwootProvider } from "@/lib/chatwoot/provider";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

type RoomRow = {
  id: string;
  name: string;
  archived_at: string | null;
  archive_reason: string | null;
  mine: boolean;
  in_panel: boolean;
  behind: boolean;
  members: { user_id: string; in_panel: boolean }[] | null;
};

type TeamRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  firm_function: string | null;
};

const PANEL_CODE = /^[a-z0-9_]{1,40}$/;

/**
 * /atendimento/salas: the team's rooms in the firm's panel of attendance (migration 0238). Read in the person's own
 * session: a member sees the rooms they are in, and who administers the firm or a partner sees every room and
 * manages them. A room is opened in the panel, signed in, through `/atendimento/painel?sala=`.
 */
async function loadRooms(painel: string | undefined): Promise<RoomsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const firm = context.firm;
  const [rooms, team, cookieStore] = await Promise.all([
    context.supabase.rpc("firm_rooms", { target_org: firm.id }),
    context.supabase.rpc("firm_team", { target_org: firm.id }),
    cookies(),
  ]);
  if (rooms.error || team.error) return { kind: "error" };
  const answer = (rooms.data ?? {}) as { manages?: boolean; rooms?: RoomRow[] | null };
  const supportVisit = cookieStore.has(IMPERSONATION_MARKER_COOKIE);
  return {
    kind: "ready",
    me: context.userId,
    manages: answer.manages === true && !supportVisit,
    rooms: (answer.rooms ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      archivedAt: row.archived_at,
      archiveReason: row.archive_reason,
      mine: row.mine === true,
      inPanel: row.in_panel === true,
      behind: row.behind === true,
      members: (row.members ?? []).map((member) => ({ id: member.user_id, inPanel: member.in_panel === true })),
    })),
    team: ((team.data ?? []) as TeamRow[]).map((row) => ({
      id: row.user_id,
      name: row.display_name?.trim() || row.email?.split("@")[0] || "",
      avatarUrl: row.avatar_url,
      firmFunction: row.firm_function,
    })),
    panel: {
      available: chatwootProvider() !== null && !supportVisit,
      error: painel && PANEL_CODE.test(painel) ? painel : null,
    },
  };
}

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ painel?: string | string[] }> }) {
  const { painel } = await searchParams;
  return <RoomsView state={await loadRooms(typeof painel === "string" ? painel : undefined)} />;
}
