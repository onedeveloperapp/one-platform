"use server";

import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { inboxListQuery } from "@/lib/whatsapp/inbox-list";
import { type InboxList, readInboxList } from "@/lib/whatsapp/inbox-read";

/**
 * The firm's conversations under a search (migration 0109), read under the person's own session: the database says
 * whether they may and which firm's conversations they are. What is searched (a person's name, a number) travels in
 * the request's body and nowhere else: in an address it would end up in logs.
 */
export async function searchInbox(input: unknown): Promise<{ ok: true; list: InboxList } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const query = inboxListQuery(input);
  // A module the firm does not have is no scope: the inbox is the firm's, as the page reads it (0078).
  const module = pageScopeOf(context.catalog, context.modules, query.module ?? undefined).current?.key ?? null;
  const list = await readInboxList(context.supabase, context.firm.id, context.profile.timezone, { ...query, module });
  return list ? { ok: true, list } : { ok: false };
}
