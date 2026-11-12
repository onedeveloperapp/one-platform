-- ============================================================
-- The chat's script, one thing at a time (0235). The questions of what an
-- account misses (0092) went in one message, four at once, and a check of
-- data the chat's script started later (0232) took the conversation while
-- they still waited: the client's "1" answered the data, and the account
-- stayed open with nobody asking it again (2026-11-12). Now ONE asks the
-- account's questions one at a time (the backend's), and nothing starts
-- over a question that waits: the account's questions wait for a step of
-- the chat to end (`account_asks_owed`, redefined from 0092), and the check
-- of data and the client's words before court wait for the account's
-- answers (`chat_data_checks_owed`, `chat_questions_owed`, redefined from
-- 0232 and 0233). A question that waits is asked again when the client
-- writes (the backend's).
-- ============================================================

/** Whether a question of an account ONE asked in a conversation still waits for its answer (0092's rule). Internal. */
create or replace function public.conversation_account_waits(conversation public.wa_conversations)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_statements s
    where s.asked_conversation_id = conversation.id and s.asked_round = s.rounds
      and s.chronology_status in ('approved', 'confirmed') and s.work is null
      and cardinality(s.missing_topics) > 0
      and s.rounds < greatest(public.statements_setting('max_rounds', 3), 0)
  );
$$;

revoke all on function public.conversation_account_waits(public.wa_conversations) from public, anon, authenticated;

/** The accounts ONE owes the questions of (replaces 0092's): never over a step of the chat that waits (0235). */
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
    select wc.id, wc.agent, wc.last_inbound_at, wc.chat_step from public.wa_conversations wc
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
    and coalesce(talk.chat_step ->> 'step', '') = ''
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
 * The checks of data ONE owes in the chat (replaces 0232's: never while a question of the account waits, 0235): a conversation ONE carries inside the 24 hours, of a case being
 * gathered whose passenger's identity and proof of address were accepted, whose data was not checked yet and with no
 * step waiting for another answer. With the data to show. Service role.
 */
create or replace function public.chat_data_checks_owed(target_limit integer default 20)
returns table (conversation_id uuid, person jsonb)
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
  select x.id, x.data
  from (
    select wc.id, public.conversation_person_data(wc) as data, wc.last_inbound_at
    from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and coalesce(wc.chat_step ->> 'step', '') = ''
      and not public.conversation_account_waits(wc)
      and not exists (select 1 from public.wa_optouts o where o.org_id = wc.org_id and o.contact_wa_id = wc.contact_wa_id)
  ) x
  where x.data is not null and (x.data ->> 'documents_in')::boolean and not (x.data ->> 'checked')::boolean
    and not (x.data ->> 'minor')::boolean
  order by x.last_inbound_at
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.chat_data_checks_owed(integer) from public, anon, authenticated;
grant execute on function public.chat_data_checks_owed(integer) to service_role;

/**
 * The client's words ONE owes a question for in the chat (replaces 0233's: never while a question of the account waits,
 * 0235): for each conversation ONE carries inside the 24
 * hours with no step waiting, the first word a case of that person still needs of them (their own or a child's they
 * answer for): free justice, then the civil court, with the wording to ask the latter by. Service role.
 */
create or replace function public.chat_questions_owed(target_limit integer default 20)
returns table (
  conversation_id uuid,
  org_id uuid,
  case_id uuid,
  kind text,
  party_id uuid,
  party_name text,
  own boolean,
  appeal boolean,
  wording text
)
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
  with talk as (
    select wc.id as conversation_id, wc.org_id, p.id as person_id, wc.last_inbound_at
    from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.people p on p.org_id = wc.org_id and p.erased_at is null and p.phone is not null
      and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and coalesce(wc.chat_step ->> 'step', '') = ''
      and not public.conversation_account_waits(wc)
      and not exists (select 1 from public.wa_optouts o where o.org_id = wc.org_id and o.contact_wa_id = wc.contact_wa_id)
  ), cases_of as (
    select distinct t.conversation_id, t.org_id, t.person_id, t.last_inbound_at, c.id as case_id
    from talk t
    join public.case_parties cp on cp.person_id = t.person_id
    join public.cases c on c.id = cp.case_id and c.org_id = t.org_id and c.status not in ('closed', 'declined')
  ), owed as (
    select co.conversation_id, co.org_id, co.case_id, 'free_justice'::text as kind, n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id) as own,
           public.lawsuit_appeal_open(n.proceeding_id) as appeal, null::text as wording, 0 as rank,
           co.last_inbound_at
    from cases_of co
    cross join lateral public.free_justice_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.answer_id is null
    union all
    select co.conversation_id, co.org_id, co.case_id, 'civil_court', n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           false, public.civil_court_wording(n.party_id), 1, co.last_inbound_at
    from cases_of co
    cross join lateral public.civil_court_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.planned and n.answer_id is null
      and public.civil_court_wording(n.party_id) is not null
  )
  select distinct on (o.conversation_id)
         o.conversation_id, o.org_id, o.case_id, o.kind, o.party_id, pp.full_name, o.own, o.appeal, o.wording
  from owed o
  join public.case_parties cp on cp.id = o.party_id
  join public.people pp on pp.id = cp.person_id
  order by o.conversation_id, o.rank, o.party_id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.chat_questions_owed(integer) from public, anon, authenticated;
grant execute on function public.chat_questions_owed(integer) to service_role;
