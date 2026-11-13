import "server-only";

import { type ReadyAccount, readyAccount, serviceAccount } from "@/lib/chatwoot/accounts";
import { chatwootProvider } from "@/lib/chatwoot/provider";
import { soon } from "@/lib/jobs/soon";
import type { MemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";
import { type ChatwootAccount, isChatwootNotFound } from "@flyee/chatwoot/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The team's rooms in the firm's panel (migration 0238, the attendance kit's D26): each room an inbox of the team
 * alone (no webhook, no reply window, nobody assigned by rotation) with one conversation whose contact has no phone
 * and no e-mail, so nothing written there leaves the panel and only who is in the inbox sees it. Its people are the
 * inbox's members and the conversation's participants, told of each new message; an archived room has nobody and is
 * resolved, its history kept. A room the database marked is claimed once and brought up to date in order; one the
 * panel lost is forgotten and made again. The firm's own inbox of WhatsApp is never touched here. Counts only.
 */

export type RoomsReport = { claimed: number; done: number; failed: number };

/** What the panel calls a room: its inbox, its contact and the conversation's title. */
export const roomTitle = (name: string): string => `Sala: ${name}`.slice(0, 100);

type RoomWork = {
  id: string;
  org_id: string;
  name: string;
  archived: boolean;
  inbox_id: number | null;
  contact_id: number | null;
  conversation_id: number | null;
  panel_name: string | null;
  panel_members: number[] | null;
  members: number[] | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rooms whose panel is behind, of every firm, of one firm, or one room. */
export async function syncRooms(
  service: SupabaseClient,
  input: { roomId?: string | null; orgId?: string | null; limit?: number; until?: number } = {},
): Promise<RoomsReport> {
  const report: RoomsReport = { claimed: 0, done: 0, failed: 0 };
  const provider = chatwootProvider();
  if (!provider) return report;
  const { data, error } = await service.rpc("chatwoot_claim_rooms", {
    target_limit: input.limit ?? 10,
    target_room: input.roomId ?? null,
    target_org: input.orgId ?? null,
  });
  if (error) throw new Error(`chatwoot_claim_rooms failed: ${error.message}`);
  const claimed = (Array.isArray(data) ? data : []) as { room_id: string; org_id: string; dirty_at: string }[];
  report.claimed = claimed.length;

  const accounts = new Map<string, ReadyAccount | null>();
  for (const item of claimed) {
    let done = false;
    try {
      if (input.until && Date.now() > input.until) throw new Error("out of time");
      if (!accounts.has(item.org_id)) accounts.set(item.org_id, await readyAccount(service, item.org_id));
      const account = accounts.get(item.org_id);
      if (account) {
        const panel = await serviceAccount(provider, account);
        try {
          await syncRoom(service, panel, item.room_id);
        } catch (failure) {
          if (!isChatwootNotFound(failure)) throw failure;
          // The panel no longer has the room: forgotten, and made there again now.
          await kept(service.rpc("chatwoot_keep_room", { target_room: item.room_id, target_forget: true }));
          await syncRoom(service, panel, item.room_id);
        }
      }
      done = true;
    } catch {
      done = false;
    }
    await service.rpc("chatwoot_finish_room", {
      target_room: item.room_id,
      target_dirty_at: item.dirty_at,
      target_done: done,
    });
    if (done) report.done += 1;
    else report.failed += 1;
  }
  return report;
}

async function syncRoom(service: SupabaseClient, panel: ChatwootAccount, roomId: string): Promise<void> {
  const { data, error } = await service.rpc("chatwoot_room_work", { target_room: roomId });
  if (error) throw new Error(`chatwoot_room_work failed: ${error.message}`);
  const room = data as RoomWork | null;
  if (!room) return;
  const title = roomTitle(room.name);
  const keep = (fields: Record<string, unknown>) =>
    kept(service.rpc("chatwoot_keep_room", { target_room: room.id, ...fields }));

  // The room in the panel, made once: its inbox, its contact (found again when a try made it and failed after) and
  // its conversation.
  let inboxId = room.inbox_id;
  let renamed = room.panel_name === room.name;
  if (!inboxId) {
    inboxId = (await panel.createTeamInbox({ name: title })).id;
    await keep({ target_inbox: inboxId, target_name: room.name });
    renamed = true;
  }
  let contactId = room.contact_id;
  if (!contactId) {
    const identifier = `sala:${room.id}`;
    contactId =
      (await panel.findContact(identifier))?.id ?? (await panel.createContact({ inboxId, name: title, identifier })).id;
    await keep({ target_contact: contactId });
  }
  let conversationId = room.conversation_id;
  if (!conversationId) {
    conversationId = (await panel.createConversation({ inboxId, contactId, status: "open" })).id;
    await keep({ target_conversation: conversationId });
  }
  if (!renamed) {
    await panel.renameInbox(inboxId, title);
    await panel.renameContact(contactId, title);
    await keep({ target_name: room.name });
  }

  // Its people: the inbox's members first, since only a member of the inbox takes part in its conversation.
  const wanted = room.archived ? [] : [...new Set((room.members ?? []).map(Number))].filter((id) => id > 0);
  await panel.setInboxMembers(inboxId, wanted);
  if (wanted.length > 0) await panel.setParticipants(conversationId, wanted);
  else if ((room.panel_members ?? []).length > 0)
    await panel.removeParticipants(conversationId, room.panel_members ?? []);
  await keep({ target_members: wanted });

  // Open while it is in use (a person may have resolved it, and a colleague's message does not reopen it), resolved
  // once archived.
  const status = await panel.conversationStatus(conversationId);
  if (room.archived) {
    if (status !== "resolved") await panel.setConversationStatus(conversationId, "resolved");
  } else if (status !== "open") await panel.setConversationStatus(conversationId, "open");
}

/**
 * The panel's number of a room's conversation, for a person of it who opens it from ONE: brought up to date first
 * when it is behind (the person may have just joined it, or the panel), and opened again when somebody resolved
 * it. A room the person is not in, an archived one, or one the panel does not have yet has none.
 */
export async function roomToOpen(
  context: MemberContext,
  service: SupabaseClient,
  account: ReadyAccount,
  personId: string,
  roomId: string | null | undefined,
): Promise<number | null> {
  if (!roomId || !UUID.test(roomId)) return null;
  const { data: mine, error } = await context.supabase
    .from("chatwoot_room_members")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("user_id", personId)
    .maybeSingle();
  if (error || !mine) return null;

  type RoomRow = {
    chatwoot_conversation_id: number | string | null;
    archived_at: string | null;
    chatwoot_dirty_at: string | null;
    chatwoot_synced_at: string | null;
  };
  const read = async (): Promise<RoomRow | null> => {
    const { data } = await service
      .from("chatwoot_rooms")
      .select("chatwoot_conversation_id, archived_at, chatwoot_dirty_at, chatwoot_synced_at")
      .eq("id", roomId)
      .eq("org_id", account.orgId)
      .maybeSingle();
    return (data ?? null) as RoomRow | null;
  };
  let room = await read();
  if (!room || room.archived_at) return null;
  const behind =
    room.chatwoot_dirty_at !== null &&
    (room.chatwoot_synced_at === null || Date.parse(room.chatwoot_dirty_at) > Date.parse(room.chatwoot_synced_at));
  if (behind || !room.chatwoot_conversation_id) {
    await syncRooms(service, { roomId, limit: 1 });
    room = await read();
  }
  const id = Number(room?.chatwoot_conversation_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const provider = chatwootProvider();
  if (provider) {
    try {
      const panel = await serviceAccount(provider, account);
      if ((await panel.conversationStatus(id)) !== "open") await panel.setConversationStatus(id, "open");
    } catch {
      // The room opens as it is; the next round of the clock opens it again.
    }
  }
  return id;
}

/** Brings the panel up to a room right after it changed, on this server; the clock's round takes what this did not. */
export function queueRoomSync(roomId: string): void {
  if (!chatwootProvider()) return;
  soon("chatwoot-rooms", async () => {
    await syncRooms(createServiceClient(), { roomId, limit: 1 });
  });
}

/** What the panel now has is kept in ONE, or the round fails and the room is brought up again later. */
async function kept(call: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await call;
  if (error) throw new Error(`not kept: ${error.message}`);
}
