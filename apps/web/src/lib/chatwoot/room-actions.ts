"use server";

import { revalidatePath } from "next/cache";

import { queueRoomSync } from "@/lib/chatwoot/rooms";
import { getMemberContext } from "@/lib/member/context";

/**
 * The writes of the team's rooms (migration 0238), each through its database function, which checks who may (who
 * administers the firm, or a partner) and keeps it on the record; the panel is brought up to the room right after.
 */

export type RoomResult = { ok: true } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(name: string, args: Record<string, unknown>): Promise<RoomResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, { target_org: context.firm.id, ...args });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown; id?: unknown };
  if (answer.ok !== true) {
    return {
      ok: false,
      code: typeof answer.code === "string" && /^[a-z_]{1,40}$/.test(answer.code) ? answer.code : "failed",
    };
  }
  revalidatePath("/atendimento/salas");
  if (typeof answer.id === "string" && UUID.test(answer.id)) queueRoomSync(answer.id);
  return { ok: true };
}

/** Makes a room, or changes its name and its people. */
export async function saveRoom(roomId: string | null, name: string, members: string[]): Promise<RoomResult> {
  if (roomId !== null && !UUID.test(roomId)) return { ok: false, code: "not_found" };
  const people = (Array.isArray(members) ? members : []).filter((id) => typeof id === "string" && UUID.test(id));
  return rpc("save_team_room", {
    target_room: roomId,
    target_name: String(name ?? "").slice(0, 120),
    target_members: people.slice(0, 200),
  });
}

/** Archives a room with its reason, or brings it back (no reason). */
export async function archiveRoom(roomId: string, reason: string | null): Promise<RoomResult> {
  if (!UUID.test(roomId)) return { ok: false, code: "not_found" };
  return rpc("archive_team_room", {
    target_room: roomId,
    target_reason: reason === null ? null : String(reason).slice(0, 400),
  });
}
