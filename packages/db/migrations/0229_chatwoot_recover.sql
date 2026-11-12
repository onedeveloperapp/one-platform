-- ============================================================
-- 0229_chatwoot_recover: the panel of attendance (0223) heals what it lost.
--
-- Seen on the development project on 2026-11-12: test conversations taken
-- out of ONE queued their contact to be taken out of the panel, while the
-- client's new conversation had already found that same contact there (by
-- the client's number) and was written into it; the queue then took the
-- contact out, its conversations and messages with it, and every round of
-- the new conversation met a conversation the panel no longer had.
--
-- Two changes. A conversation taken out of ONE always takes its own
-- conversation out of the panel, and queues its contact only when no other
-- conversation of the firm is of it; the backend checks again, when it
-- works the queue, that nothing of the firm is of the contact before taking
-- it out. And a conversation the panel no longer has is forgotten
-- (`chatwoot_forget_conversation`): what ONE knew of it in the panel goes,
-- and the next round writes it there again, its messages since the
-- account's start included.
-- ============================================================

create or replace function public.chatwoot_conversation_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account integer;
begin
  if old.chatwoot_conversation_id is null then
    return null;
  end if;
  select a.account_id into account from public.chatwoot_accounts a where a.org_id = old.org_id;
  if account is null then
    return null;
  end if;
  insert into public.chatwoot_deletions (kind, account_id, target_id)
  values ('conversation', account, old.chatwoot_conversation_id)
  on conflict (kind, account_id, target_id) do nothing;
  if old.chatwoot_contact_id is not null and not exists (
    select 1 from public.wa_conversations c
    where c.org_id = old.org_id and c.chatwoot_contact_id = old.chatwoot_contact_id and c.id <> old.id
  ) then
    insert into public.chatwoot_deletions (kind, account_id, target_id)
    values ('contact', account, old.chatwoot_contact_id)
    on conflict (kind, account_id, target_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.chatwoot_conversation_gone() from public, anon, authenticated;

/** Whether a contact of the firm's panel is still a conversation's of the firm: then it stays in the panel. */
create or replace function public.chatwoot_contact_in_use(target_account integer, target_contact integer)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.wa_conversations c
    join public.chatwoot_accounts a on a.org_id = c.org_id
    where a.account_id = target_account and c.chatwoot_contact_id = target_contact
  );
end;
$$;

revoke all on function public.chatwoot_contact_in_use(integer, integer) from public, anon, authenticated;
grant execute on function public.chatwoot_contact_in_use(integer, integer) to service_role;

/**
 * A conversation the panel no longer has (somebody took it out there, or its contact went): what ONE knew of it in
 * the panel is forgotten, and it is marked, so the next round writes it there again with its messages.
 */
create or replace function public.chatwoot_forget_conversation(target_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.wa_messages set chatwoot_message_id = null, chatwoot_status = null
  where conversation_id = target_conversation and chatwoot_message_id is not null;
  update public.wa_conversations set
    chatwoot_conversation_id = null,
    chatwoot_contact_id = null,
    chatwoot_agent = null,
    chatwoot_called_at = null,
    chatwoot_failures = 0,
    chatwoot_retry_at = null,
    chatwoot_dirty_at = clock_timestamp()
  where id = target_conversation;
end;
$$;

revoke all on function public.chatwoot_forget_conversation(uuid) from public, anon, authenticated;
grant execute on function public.chatwoot_forget_conversation(uuid) to service_role;
