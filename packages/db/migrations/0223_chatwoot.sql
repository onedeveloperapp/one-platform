-- ============================================================
-- 0223_chatwoot: the firms' panel of attendance.
--
-- The owner's decisions of 2026-11-09 and 2026-11-11: the firm's people follow
-- and answer the conversations of the firm's WhatsApp in a Chatwoot of the
-- platform's own (one account per firm), while ONE stays the one that talks to
-- WhatsApp. ONE writes every message of a conversation into the firm's account
-- (an inbox of the API kind), keeps there whether ONE or a person answers it
-- (pending or open), and what a person writes in the panel comes back through
-- the inbox's webhook and goes out through ONE's outbox, under its rules: the
-- 24-hour window, the person's own identity as its author, and the takeover of
-- 0048 (ONE stops answering where a person wrote). A message the bar's rules
-- flag fails with the reason, and the same text written again within ten
-- minutes is sent all the same; a status set in the panel is the firm's
-- choice of who answers (open is a person's, pending or resolved is ONE's).
-- The panel never closes a conversation by itself.
--
-- What ONE keeps here are the numbers of Chatwoot's records, never a token:
-- the platform's token is in the environment and the others are read through
-- the platform's API when a piece of work needs them. What is taken out of
-- ONE (a conversation, a person who left the firm, the firm itself) is taken
-- out of the panel too, through a queue the backend works.
--
-- Every table here is the backend's alone.
-- ============================================================

-- ---------- The firm's account ----------

create table public.chatwoot_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- `provisioning` while the account, its service person, the person of the
  -- firm's phone and the inbox are being made; `ready` once all four exist.
  status text not null default 'provisioning',
  account_id integer unique,
  -- An administrator of this account only, named ONE: what ONE writes goes as it.
  service_user_id integer,
  -- "Celular do WhatsApp": what the firm typed on its phone goes as this person.
  phone_user_id integer,
  inbox_id integer,
  -- What is older than this stays out of the panel.
  mirror_from timestamptz not null default now() - interval '7 days',
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chatwoot_accounts_status_check check (status in ('provisioning', 'ready')),
  constraint chatwoot_accounts_ids_check check (
    coalesce(account_id, 1) > 0 and coalesce(service_user_id, 1) > 0
    and coalesce(phone_user_id, 1) > 0 and coalesce(inbox_id, 1) > 0
  ),
  constraint chatwoot_accounts_ready_check check (
    status <> 'ready'
    or (account_id is not null and service_user_id is not null and phone_user_id is not null and inbox_id is not null)
  ),
  constraint chatwoot_accounts_error_check check (last_error is null or last_error ~ '^[a-z0-9_]{1,63}$')
);

alter table public.chatwoot_accounts enable row level security;
revoke all on table public.chatwoot_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.chatwoot_accounts to service_role;
create trigger guard_impersonation_chatwoot_accounts after insert or update or delete on public.chatwoot_accounts
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The firm's people in the panel ----------

create table public.chatwoot_staff (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  chatwoot_user_id integer not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (org_id, chatwoot_user_id),
  constraint chatwoot_staff_user_check check (chatwoot_user_id > 0)
);

alter table public.chatwoot_staff enable row level security;
revoke all on table public.chatwoot_staff from public, anon, authenticated;
grant select, insert, update, delete on table public.chatwoot_staff to service_role;
create trigger guard_impersonation_chatwoot_staff after insert or update or delete on public.chatwoot_staff
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- What is to be taken out of the panel ----------

-- No firm on these rows: the firm may be gone, and the account with it.
create table public.chatwoot_deletions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  account_id integer not null,
  target_id integer not null,
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, account_id, target_id),
  constraint chatwoot_deletions_kind_check check (kind in ('account', 'contact', 'conversation', 'person')),
  constraint chatwoot_deletions_ids_check check (account_id > 0 and target_id > 0),
  constraint chatwoot_deletions_attempts_check check (attempts >= 0)
);

alter table public.chatwoot_deletions enable row level security;
revoke all on table public.chatwoot_deletions from public, anon, authenticated;
grant select, insert, update, delete on table public.chatwoot_deletions to service_role;

-- ---------- A conversation and a message in the panel ----------

alter table public.wa_conversations
  add column chatwoot_conversation_id integer,
  add column chatwoot_contact_id integer,
  -- Who answers, as the panel last showed it: `one` (pending) or `person` (open).
  add column chatwoot_agent text,
  -- The call for a person (0048) the panel was last told of.
  add column chatwoot_called_at timestamptz,
  -- Something of the conversation changed after the panel was last brought up to it.
  add column chatwoot_dirty_at timestamptz,
  add column chatwoot_synced_at timestamptz,
  add column chatwoot_claimed_at timestamptz,
  add column chatwoot_failures integer not null default 0,
  add column chatwoot_retry_at timestamptz,
  -- A text of the panel the bar's rules flagged: written again within ten minutes, it is sent all the same.
  add column chatwoot_flagged_hash text,
  add column chatwoot_flagged_at timestamptz,
  add constraint wa_conversations_chatwoot_ids_check check (
    coalesce(chatwoot_conversation_id, 1) > 0 and coalesce(chatwoot_contact_id, 1) > 0
  ),
  add constraint wa_conversations_chatwoot_agent_check check (chatwoot_agent is null or chatwoot_agent in ('one', 'person')),
  add constraint wa_conversations_chatwoot_failures_check check (chatwoot_failures >= 0),
  add constraint wa_conversations_chatwoot_flagged_check check (chatwoot_flagged_hash is null or chatwoot_flagged_hash ~ '^[0-9a-f]{64}$');

create unique index wa_conversations_chatwoot_idx
  on public.wa_conversations (org_id, chatwoot_conversation_id) where chatwoot_conversation_id is not null;
create index wa_conversations_chatwoot_dirty_idx
  on public.wa_conversations (chatwoot_dirty_at) where chatwoot_dirty_at is not null;

alter table public.wa_messages
  add column chatwoot_message_id bigint,
  -- The status of a message to the client the panel was last told of.
  add column chatwoot_status text,
  add constraint wa_messages_chatwoot_id_check check (coalesce(chatwoot_message_id, 1) > 0),
  add constraint wa_messages_chatwoot_status_check check (
    chatwoot_status is null or chatwoot_status in ('sent', 'delivered', 'read', 'failed')
  );

create unique index wa_messages_chatwoot_idx on public.wa_messages (chatwoot_message_id) where chatwoot_message_id is not null;

-- ---------- What marks a conversation for the panel ----------

/** Whether the firm's account in the panel is ready: what changes in a firm with none marks nothing. */
create or replace function public.chatwoot_ready(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chatwoot_accounts a where a.org_id = target_org and a.status = 'ready');
$$;

revoke all on function public.chatwoot_ready(uuid) from public, anon, authenticated;
grant execute on function public.chatwoot_ready(uuid) to service_role;

/** A message came, went, or changed: its conversation is the panel's to bring up to date. */
create or replace function public.chatwoot_message_marks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.media_status is not distinct from new.media_status then
    return null;
  end if;
  if public.chatwoot_ready(new.org_id) then
    update public.wa_conversations set chatwoot_dirty_at = clock_timestamp() where id = new.conversation_id;
  end if;
  return null;
end;
$$;

revoke all on function public.chatwoot_message_marks() from public, anon, authenticated;

create trigger wa_messages_chatwoot_marks
  after insert or update of status, media_status on public.wa_messages
  for each row execute function public.chatwoot_message_marks();

/** Who answers changed, or ONE called a person: the panel is told. */
create or replace function public.chatwoot_conversation_marks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.agent is distinct from new.agent or old.called_at is distinct from new.called_at)
     and public.chatwoot_ready(new.org_id) then
    new.chatwoot_dirty_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.chatwoot_conversation_marks() from public, anon, authenticated;

create trigger wa_conversations_chatwoot_marks
  before update of agent, called_at on public.wa_conversations
  for each row execute function public.chatwoot_conversation_marks();

/** The account became ready: the conversations of the last days go to the panel. */
create or replace function public.chatwoot_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    update public.wa_conversations
    set chatwoot_dirty_at = clock_timestamp()
    where org_id = new.org_id and last_message_at >= new.mirror_from;
  end if;
  return null;
end;
$$;

revoke all on function public.chatwoot_account_ready() from public, anon, authenticated;

create trigger chatwoot_accounts_ready
  after update of status on public.chatwoot_accounts
  for each row execute function public.chatwoot_account_ready();

-- ---------- What is taken out of ONE is taken out of the panel ----------

/** The firm's account is gone (the firm with it): the account goes from the panel. */
create or replace function public.chatwoot_account_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.account_id is not null then
    insert into public.chatwoot_deletions (kind, account_id, target_id)
    values ('account', old.account_id, old.account_id)
    on conflict (kind, account_id, target_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.chatwoot_account_gone() from public, anon, authenticated;

create trigger chatwoot_accounts_gone
  after delete on public.chatwoot_accounts
  for each row execute function public.chatwoot_account_gone();

/**
 * A conversation is gone from ONE (its person's data erased, its time kept over): its conversation goes from the
 * panel, and the contact with it when no other conversation of the firm is of that contact.
 */
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
  if old.chatwoot_contact_id is not null and not exists (
    select 1 from public.wa_conversations c
    where c.org_id = old.org_id and c.chatwoot_contact_id = old.chatwoot_contact_id and c.id <> old.id
  ) then
    insert into public.chatwoot_deletions (kind, account_id, target_id)
    values ('contact', account, old.chatwoot_contact_id)
    on conflict (kind, account_id, target_id) do nothing;
  else
    insert into public.chatwoot_deletions (kind, account_id, target_id)
    values ('conversation', account, old.chatwoot_conversation_id)
    on conflict (kind, account_id, target_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.chatwoot_conversation_gone() from public, anon, authenticated;

create trigger wa_conversations_chatwoot_gone
  after delete on public.wa_conversations
  for each row execute function public.chatwoot_conversation_gone();

/** A person left the firm: they leave the firm's panel. */
create or replace function public.chatwoot_member_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chatwoot_staff where org_id = old.org_id and user_id = old.user_id;
  return null;
end;
$$;

revoke all on function public.chatwoot_member_gone() from public, anon, authenticated;

create trigger memberships_chatwoot_gone
  after delete on public.memberships
  for each row execute function public.chatwoot_member_gone();

create or replace function public.chatwoot_staff_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account integer;
begin
  select a.account_id into account from public.chatwoot_accounts a where a.org_id = old.org_id;
  if account is not null then
    insert into public.chatwoot_deletions (kind, account_id, target_id)
    values ('person', account, old.chatwoot_user_id)
    on conflict (kind, account_id, target_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.chatwoot_staff_gone() from public, anon, authenticated;

create trigger chatwoot_staff_gone
  after delete on public.chatwoot_staff
  for each row execute function public.chatwoot_staff_gone();

-- ---------- The backend's work ----------

/**
 * The firm's account to make or to finish, claimed so two servers never make two: the row (created here when there
 * is none) once nobody else holds it, as an object, or null. A ready account is returned as it is, never claimed.
 */
create or replace function public.chatwoot_claim_account(target_org uuid, stale_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.chatwoot_accounts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.chatwoot_accounts (org_id) values (target_org) on conflict (org_id) do nothing;
  select * into account from public.chatwoot_accounts where org_id = target_org for update;
  if account.status = 'ready' then
    return to_jsonb(account);
  end if;
  if account.claimed_at is not null and account.claimed_at > now() - make_interval(secs => stale_seconds) then
    return null;
  end if;
  update public.chatwoot_accounts set claimed_at = clock_timestamp(), updated_at = now()
  where org_id = target_org
  returning * into account;
  return to_jsonb(account);
end;
$$;

revoke all on function public.chatwoot_claim_account(uuid, integer) from public, anon, authenticated;
grant execute on function public.chatwoot_claim_account(uuid, integer) to service_role;

/**
 * Conversations whose panel is behind, claimed under a number so a server takes each once: of firms whose account
 * is ready, past any wait a failure set, oldest change first. One conversation when it is named.
 */
create or replace function public.chatwoot_claim_conversations(
  target_limit integer default 5,
  target_conversation uuid default null,
  stale_seconds integer default 120
)
returns table (conversation_id uuid, org_id uuid, dirty_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  update public.wa_conversations c set chatwoot_claimed_at = clock_timestamp()
  where c.id in (
    select x.id from public.wa_conversations x
    join public.chatwoot_accounts a on a.org_id = x.org_id and a.status = 'ready'
    where x.chatwoot_dirty_at is not null
      and x.chatwoot_dirty_at > coalesce(x.chatwoot_synced_at, '-infinity'::timestamptz)
      and (target_conversation is null or x.id = target_conversation)
      and (x.chatwoot_claimed_at is null or x.chatwoot_claimed_at < now() - make_interval(secs => stale_seconds))
      and (x.chatwoot_retry_at is null or x.chatwoot_retry_at <= now())
    order by x.chatwoot_dirty_at
    limit greatest(least(coalesce(target_limit, 5), 50), 1)
    for update of x skip locked
  )
  returning c.id, c.org_id, c.chatwoot_dirty_at;
end;
$$;

revoke all on function public.chatwoot_claim_conversations(integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.chatwoot_claim_conversations(integer, uuid, integer) to service_role;

/**
 * A claimed conversation's work ended. Done, the panel is up to the change it was claimed at (a change since keeps
 * it behind); failed, it waits a while that grows with each failure, up to an hour.
 */
create or replace function public.chatwoot_finish_conversation(
  target_conversation uuid,
  target_dirty_at timestamptz,
  target_done boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_done then
    update public.wa_conversations set
      chatwoot_synced_at = greatest(coalesce(chatwoot_synced_at, '-infinity'::timestamptz), target_dirty_at),
      chatwoot_claimed_at = null,
      chatwoot_failures = 0,
      chatwoot_retry_at = null
    where id = target_conversation;
  else
    update public.wa_conversations set
      chatwoot_claimed_at = null,
      chatwoot_failures = least(chatwoot_failures + 1, 1000),
      chatwoot_retry_at = now() + make_interval(mins => least(power(2, least(chatwoot_failures, 6))::integer, 60))
    where id = target_conversation;
  end if;
end;
$$;

revoke all on function public.chatwoot_finish_conversation(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.chatwoot_finish_conversation(uuid, timestamptz, boolean) to service_role;

/** What is to be taken out of the panel, claimed so a server takes each once. */
create or replace function public.chatwoot_claim_deletions(target_limit integer default 10, stale_seconds integer default 300)
returns setof public.chatwoot_deletions
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  update public.chatwoot_deletions d set claimed_at = clock_timestamp(), attempts = d.attempts + 1
  where d.id in (
    select x.id from public.chatwoot_deletions x
    where (x.claimed_at is null or x.claimed_at < now() - make_interval(secs => stale_seconds))
      and x.attempts < 20
    order by x.created_at
    limit greatest(least(coalesce(target_limit, 10), 50), 1)
    for update skip locked
  )
  returning d.*;
end;
$$;

revoke all on function public.chatwoot_claim_deletions(integer, integer) from public, anon, authenticated;
grant execute on function public.chatwoot_claim_deletions(integer, integer) to service_role;

-- ---------- What a person of the firm did in the panel ----------

/**
 * A person of the firm wrote to the client in the panel: the message is reserved in ONE's outbox as theirs, under
 * the rules a message written in ONE meets (a member of the firm, an active number, a text within its size and the
 * 24-hour window), and ONE stops answering the conversation (0048). Each message of the panel is taken once.
 */
create or replace function public.chatwoot_person_writes(
  target_org uuid,
  target_conversation integer,
  target_person integer,
  target_message bigint,
  target_body text,
  target_flagged text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  wa_number public.wa_numbers%rowtype;
  person uuid;
  existing uuid;
  text_body text := nullif(btrim(coalesce(target_body, '')), '');
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select id into existing from public.wa_messages where chatwoot_message_id = target_message;
  if existing is not null then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'message_id', existing);
  end if;
  select * into conversation from public.wa_conversations
  where org_id = target_org and chatwoot_conversation_id = target_conversation
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select s.user_id into person from public.chatwoot_staff s
  join public.memberships m on m.org_id = s.org_id and m.user_id = s.user_id
  where s.org_id = target_org and s.chatwoot_user_id = target_person;
  if person is null then
    return jsonb_build_object('ok', false, 'code', 'person_unknown');
  end if;
  select * into wa_number from public.wa_numbers where id = conversation.number_id;
  if wa_number.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'number_disconnected');
  end if;
  if text_body is null then
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  if char_length(text_body) > 4096 then
    return jsonb_build_object('ok', false, 'code', 'too_long');
  end if;
  if not public.wa_window_open(conversation.last_inbound_at) then
    return jsonb_build_object('ok', false, 'code', 'window_closed');
  end if;

  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, status, sent_by, chatwoot_message_id
  ) values (
    conversation.org_id, conversation.id, conversation.number_id, 'out', 'cloud', 'text', text_body, 'queued',
    person, target_message
  )
  returning id into message;

  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('text', text_body),
    last_message_direction = 'out',
    unread_count = 0,
    chatwoot_flagged_hash = null,
    chatwoot_flagged_at = null
  where id = conversation.id;

  -- On the record as the person's, with what the bar's rules weighed when it was sent all the same.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conversation.org_id, person,
          case when coalesce(cardinality(target_flagged), 0) > 0 then 'whatsapp.message_flagged_sent' else 'whatsapp.message_from_panel' end,
          'wa_message', message::text,
          case when coalesce(cardinality(target_flagged), 0) > 0
               then jsonb_build_object('flagged', to_jsonb(target_flagged[1:5]), 'from_panel', true)
               else jsonb_build_object('from_panel', true) end);

  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'person_id', person);
end;
$$;

revoke all on function public.chatwoot_person_writes(uuid, integer, integer, bigint, text, text[]) from public, anon, authenticated;
grant execute on function public.chatwoot_person_writes(uuid, integer, integer, bigint, text, text[]) to service_role;

/**
 * The status of a conversation changed in the panel: open (or put aside for later) is a person's, pending or
 * resolved is ONE's again. What the panel shows is kept first, so ONE never writes it back; then who answers
 * changes as `set_conversation_agent` (0048) changes it, with no person named, since the panel does not say who.
 * A resolved conversation is not kept as the panel shows it: the client's next message would reopen it as open,
 * which reads as a person's, so ONE turns it to pending, the panel's word for "ONE answers".
 */
create or replace function public.chatwoot_panel_status(target_org uuid, target_conversation integer, target_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  wanted text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_status not in ('open', 'snoozed', 'pending', 'resolved') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  wanted := case when target_status in ('open', 'snoozed') then 'person' else 'one' end;
  select * into conversation from public.wa_conversations
  where org_id = target_org and chatwoot_conversation_id = target_conversation
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  update public.wa_conversations set
    chatwoot_agent = case when target_status = 'resolved' then null else wanted end,
    chatwoot_dirty_at = case when target_status = 'resolved' then clock_timestamp() else chatwoot_dirty_at end
  where id = conversation.id;
  if conversation.agent = wanted and (wanted = 'person' or conversation.called_at is null) then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if wanted = 'person' then
    perform public.withdraw_conversation_answers(conversation.id, 'Uma pessoa do escritório assumiu a conversa no painel.');
  end if;

  update public.wa_conversations set
    agent = wanted,
    agent_changed_by = null,
    agent_changed_at = now(),
    called_reason = case when wanted = 'one' then null else called_reason end,
    called_at = case when wanted = 'one' then null else called_at end,
    one_through = case
      when wanted = 'one' and not (last_message_direction = 'in') then greatest(coalesce(one_through, last_inbound_at), last_inbound_at)
      else one_through end,
    one_claimed_at = null,
    -- Told of a call it no longer has: nothing to tell.
    chatwoot_called_at = case when wanted = 'one' then null else chatwoot_called_at end
  where id = conversation.id;

  insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
  values (conversation.org_id, conversation.id, case when wanted = 'one' then 'returned_to_one' else 'taken_over' end,
          'person', jsonb_build_object('from_panel', true));
  insert into public.audit_events (org_id, action, entity_type, entity_id, metadata)
  values (conversation.org_id, 'conversation.agent_changed', 'wa_conversation', conversation.id::text,
          jsonb_build_object('agent', wanted, 'from_panel', true));
  return jsonb_build_object('ok', true, 'code', 'changed', 'agent', wanted);
end;
$$;

revoke all on function public.chatwoot_panel_status(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.chatwoot_panel_status(uuid, integer, text) to service_role;

-- ---------- Entering the panel ----------

/**
 * Who enters the firm's panel, asked in their own session: a member of a firm, never a support visit (the operator
 * inside somebody's session enters nobody's panel as them). The backend then makes the person in the panel and
 * hands them the link that enters it signed in.
 */
create or replace function public.chatwoot_panel_entry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid := auth.uid();
  firm uuid;
  person_name text;
begin
  if person is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_session');
  end if;
  select m.org_id, coalesce(nullif(btrim(p.display_name), ''), '') into firm, person_name
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = person
  order by m.created_at
  limit 1;
  if firm is null then
    return jsonb_build_object('ok', false, 'code', 'no_firm');
  end if;
  return jsonb_build_object('ok', true, 'org_id', firm, 'person_id', person, 'name', person_name);
end;
$$;

revoke all on function public.chatwoot_panel_entry() from public, anon;
grant execute on function public.chatwoot_panel_entry() to authenticated;

-- ---------- What the backend keeps of the panel's work ----------

/** The steps of the firm's account, kept as each ends: what is given is kept, the rest stays as it was. */
create or replace function public.chatwoot_keep_account(
  target_org uuid,
  target_account integer default null,
  target_service_user integer default null,
  target_phone_user integer default null,
  target_inbox integer default null,
  target_ready boolean default false,
  target_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.chatwoot_accounts set
    account_id = coalesce(target_account, account_id),
    service_user_id = coalesce(target_service_user, service_user_id),
    phone_user_id = coalesce(target_phone_user, phone_user_id),
    inbox_id = coalesce(target_inbox, inbox_id),
    status = case when target_ready then 'ready' else status end,
    claimed_at = case when target_ready or target_error is not null then null else claimed_at end,
    last_error = case when target_ready then null else coalesce(target_error, last_error) end,
    updated_at = now()
  where org_id = target_org;
end;
$$;

revoke all on function public.chatwoot_keep_account(uuid, integer, integer, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.chatwoot_keep_account(uuid, integer, integer, integer, integer, boolean, text) to service_role;

/** What the panel has of a conversation, kept as it is written there: what is given is kept. */
create or replace function public.chatwoot_keep_conversation(
  target_conversation uuid,
  target_panel_conversation integer default null,
  target_contact integer default null,
  target_agent text default null,
  target_called_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.wa_conversations set
    chatwoot_conversation_id = coalesce(target_panel_conversation, chatwoot_conversation_id),
    chatwoot_contact_id = coalesce(target_contact, chatwoot_contact_id),
    chatwoot_agent = coalesce(target_agent, chatwoot_agent),
    chatwoot_called_at = coalesce(target_called_at, chatwoot_called_at)
  where id = target_conversation;
end;
$$;

revoke all on function public.chatwoot_keep_conversation(uuid, integer, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.chatwoot_keep_conversation(uuid, integer, integer, text, timestamptz) to service_role;

/** A message written in the panel (once), and the status of it the panel was told. */
create or replace function public.chatwoot_keep_message(
  target_message uuid,
  target_panel_message bigint default null,
  target_status text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.wa_messages set
    chatwoot_message_id = coalesce(chatwoot_message_id, target_panel_message),
    chatwoot_status = coalesce(target_status, chatwoot_status)
  where id = target_message;
end;
$$;

revoke all on function public.chatwoot_keep_message(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.chatwoot_keep_message(uuid, bigint, text) to service_role;

/**
 * A text the bar's rules flag, written in the panel: the same text written again within ten minutes is sent all
 * the same (`again`); otherwise it is kept as the one written now, and held. Compared by its hash, never its words.
 */
create or replace function public.chatwoot_flagged_again(target_org uuid, target_conversation integer, target_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_hash');
  end if;
  select * into conversation from public.wa_conversations
  where org_id = target_org and chatwoot_conversation_id = target_conversation
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if conversation.chatwoot_flagged_hash = target_hash
     and conversation.chatwoot_flagged_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', true, 'again', true);
  end if;
  update public.wa_conversations set chatwoot_flagged_hash = target_hash, chatwoot_flagged_at = now()
  where id = conversation.id;
  return jsonb_build_object('ok', true, 'again', false);
end;
$$;

revoke all on function public.chatwoot_flagged_again(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.chatwoot_flagged_again(uuid, integer, text) to service_role;

/** A person of the firm made in the firm's panel: who they are there. */
create or replace function public.chatwoot_keep_person(target_org uuid, target_person uuid, target_user integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = target_person) then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  insert into public.chatwoot_staff (org_id, user_id, chatwoot_user_id)
  values (target_org, target_person, target_user)
  on conflict (org_id, user_id) do nothing;
  if found then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, target_person, 'atendimento.panel_joined', 'chatwoot_staff', target_user::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.chatwoot_keep_person(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.chatwoot_keep_person(uuid, uuid, integer) to service_role;

/** Something taken out of the panel: it leaves the queue. */
create or replace function public.chatwoot_deletion_done(target_deletion uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.chatwoot_deletions where id = target_deletion;
end;
$$;

revoke all on function public.chatwoot_deletion_done(uuid) from public, anon, authenticated;
grant execute on function public.chatwoot_deletion_done(uuid) to service_role;
