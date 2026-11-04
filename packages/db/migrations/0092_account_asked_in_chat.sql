-- ============================================================
-- 0092_account_asked_in_chat: ONE asks what the client's account is
-- missing in their WhatsApp conversation too, and takes their reply there
-- as the answer.
--
-- The owner approved, on 2026-11-04, the second stage of the plan of
-- 0090. The link asks what an account is missing (0090); a client who talks
-- to ONE on WhatsApp is asked there too, in the conversation ONE holds,
-- inside the 24 hours, where the firm lets ONE answer its clients and the
-- person never asked the firm to stop; once per round of questions. What the
-- client writes next in that conversation is their answer: it joins the
-- account (`client_added`, as the link's answer does) and ONE orders the
-- account again.
--
--   case_statements.asked_*   the round ONE asked in a conversation, when,
--                             and in which conversation;
--   account_asks_owed         the accounts ONE may ask now, with the
--                             conversation and the questions;
--   one_ask_account           ONE's message with the questions, written to
--                             the conversation for the outbox;
--   conversation_account_open the account a conversation's turn answers;
--   one_complete_statement    the client's reply joins the account, and ONE
--                             orders it again.
-- ============================================================

alter table public.case_statements
  -- The round of questions ONE asked in a conversation (`rounds` as it was then), when and where.
  add column asked_round integer,
  add column asked_at timestamptz,
  add column asked_conversation_id uuid references public.wa_conversations (id) on delete set null;

alter table public.case_statements
  add constraint case_statements_asked_check check (
    (asked_round is null) = (asked_at is null) and (asked_round is null or asked_round >= 0)
  );

/**
 * Who answers for a statement in a conversation: the person of the link it
 * came through, else its party (an adult), else who answers for that party.
 */
create or replace function public.statement_person(target_statement uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.person_id from public.client_links l where l.id = s.link_id),
    (select case
       when cp.guardian_id is null
        and (p.birth_date is null or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)
       then cp.person_id
       else (select g.person_id from public.case_parties g where g.id = cp.guardian_id)
     end
     from public.case_parties cp join public.people p on p.id = cp.person_id
     where cp.id = s.party_id)
  )
  from public.case_statements s
  where s.id = target_statement;
$$;

revoke all on function public.statement_person(uuid) from public, anon, authenticated;

/**
 * The accounts ONE may ask now in the client's conversation: an order of the
 * facts approved or confirmed that says something is missing, with the
 * questions, rounds left and nothing being worked on, not asked yet in this
 * round; of a case not with the court; of a person ONE talks to in a
 * conversation of the firm's active number, inside the 24 hours, who never
 * asked the firm to stop; where the firm lets ONE answer its clients (one
 * statement named, or the oldest). Service role only.
 */
create or replace function public.account_asks_owed(target_limit integer default 20, target_statement uuid default null)
returns table (statement_id uuid, org_id uuid, case_id uuid, conversation_id uuid, first_name text, questions text[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select s.id, s.org_id, s.case_id, talk.id,
         initcap(lower(split_part(btrim(p.full_name), ' ', 1))), s.questions
  from public.case_statements s
  join public.cases c on c.id = s.case_id
  join public.people p on p.id = public.statement_person(s.id)
  cross join lateral (
    select wc.id, wc.agent, wc.last_inbound_at from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where wc.org_id = c.org_id and p.phone is not null and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    order by wc.last_inbound_at desc nulls last, wc.last_message_at desc nulls last, wc.id
    limit 1
  ) talk
  where (target_statement is null or s.id = target_statement)
    and s.chronology_status in ('approved', 'confirmed') and s.work is null
    and cardinality(s.missing_topics) > 0 and cardinality(s.questions) > 0
    and s.rounds < greatest(public.statements_setting('max_rounds', 3), 0)
    and s.asked_round is distinct from s.rounds
    and c.status not in ('filed', 'closed', 'declined')
    and public.firm_autonomy_mode(c.org_id, 'reply_client') <> 'approval'
    and talk.agent = 'one'
    and public.wa_window_open(talk.last_inbound_at)
    and not exists (
      select 1 from public.wa_optouts x
      where x.org_id = c.org_id and x.contact_wa_id = any (public.wa_phone_variants(p.phone))
    )
  order by s.created_at, s.id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.account_asks_owed(integer, uuid) from public, anon, authenticated;

/**
 * ONE asks, in the client's conversation, what their account is missing:
 * its message for the outbox, once per round, only while the account is
 * still owed the question there (the conversation held and read again, its
 * window open). Service role only.
 */
create or replace function public.one_ask_account(target_statement uuid, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owed record;
  conversation public.wa_conversations%rowtype;
  statement public.case_statements%rowtype;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into owed from public.account_asks_owed(1, target_statement) a;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into statement from public.case_statements where id = target_statement for update;
  select * into conversation from public.wa_conversations wc where wc.id = owed.conversation_id for update;
  if statement.asked_round is not distinct from statement.rounds or conversation.agent <> 'one' then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  begin
    message := public.one_message(conversation, target_body, null, null);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  update public.case_statements
  set asked_round = rounds, asked_at = now(), asked_conversation_id = conversation.id
  where id = statement.id;
  perform public.record_case_event(statement.org_id, statement.case_id, 'account_asked', 'system',
    jsonb_build_object('statement', statement.id, 'conversation', conversation.id));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message);
end;
$$;

revoke all on function public.one_ask_account(uuid, text) from public, anon, authenticated;

/**
 * The account whose questions ONE asked in this conversation and that still
 * waits for the client's answer, for the worker that holds the conversation's
 * turn: what the client writes now answers it. Service role only.
 */
create or replace function public.conversation_account_open(target_conversation uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  statement public.case_statements%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select s.* into statement from public.case_statements s
  where s.asked_conversation_id = conversation.id and s.asked_round = s.rounds
    and s.chronology_status in ('approved', 'confirmed') and s.work is null
    and cardinality(s.missing_topics) > 0
    and s.rounds < greatest(public.statements_setting('max_rounds', 3), 0)
  order by s.asked_at desc, s.id
  limit 1;
  if statement.id is null then
    return jsonb_build_object('ok', true, 'code', 'none');
  end if;
  return jsonb_build_object('ok', true, 'code', 'open', 'statement_id', statement.id,
    'first_name', (select initcap(lower(split_part(btrim(p.full_name), ' ', 1)))
                   from public.people p where p.id = public.statement_person(statement.id)));
end;
$$;

revoke all on function public.conversation_account_open(uuid, integer) from public, anon, authenticated;

/**
 * What the client wrote in the conversation after ONE asked what their
 * account was missing joins the account, as an answer on their link does,
 * and ONE orders it again. Only for the account the conversation's turn
 * answers, by the worker that holds the turn. Service role only.
 */
create or replace function public.one_complete_statement(
  target_conversation uuid,
  target_claim integer,
  target_statement uuid,
  target_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  open jsonb := public.conversation_account_open(target_conversation, target_claim);
  statement public.case_statements%rowtype;
  written text := nullif(btrim(regexp_replace(coalesce(target_text, ''), '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]+', ' ', 'g')), '');
begin
  if not coalesce((open ->> 'ok')::boolean, false) then
    return open;
  end if;
  if open ->> 'statement_id' is distinct from target_statement::text then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if written is null or char_length(written) < 2
     or char_length(written) > greatest(public.statements_setting('complement_max_chars', 4000), 2) then
    return jsonb_build_object('ok', false, 'code', 'statement_length');
  end if;
  select * into statement from public.case_statements where id = target_statement for update;
  update public.case_statements set
    client_added = left(coalesce(client_added || E'\n\n', '') || written, 20000),
    client_added_at = now(),
    rounds = rounds + 1,
    chronology_status = 'none', chronology_run_id = null,
    work = 'chronology', work_claimed_at = null, work_after = null, work_attempts = 0, work_error = null
  where id = statement.id;
  perform public.record_case_event(statement.org_id, statement.case_id, 'client_statement_completed', 'client',
    jsonb_build_object('statement', statement.id, 'channel', 'whatsapp'));
  return jsonb_build_object('ok', true, 'code', 'sent', 'statement_id', statement.id);
end;
$$;

revoke all on function public.one_complete_statement(uuid, integer, uuid, text) from public, anon, authenticated;
