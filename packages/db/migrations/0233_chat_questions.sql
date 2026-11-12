-- ============================================================
-- The chat's script, its fifth part (0233): what the client is asked
-- before the action goes to court, asked in the chat. Their word on free
-- justice (0125, 0218) and on the civil court (0025) was asked on their
-- link only; the facts of the action were asked in the chat and answered on
-- the link (0182). Now ONE asks each word in the conversation it carries
-- with who gives it, inside the 24 hours, one at a time, with the wording
-- the link shows (the civil court's own text, kept with the answer), and
-- the answer is kept as on the link, by the client, with the channel it
-- came by (`evidence.channel` "whatsapp", the message's id). The facts of
-- an action are answered in the chat too (`answer_piece_facts` by "chat").
-- The question that waits is the conversation's step (`chat_step`, 0232),
-- so a word is never asked twice nor two at once.
-- ============================================================

/**
 * The client's words ONE owes a question for in the chat (0233): for each conversation ONE carries inside the 24
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

/**
 * ONE asks a word of the client in the chat (0233): only while it is still owed (checked again under the
 * conversation's lock), the question kept as the conversation's step in the same transaction as the message.
 * Service role.
 */
create or replace function public.one_ask_chat_question(
  target_conversation uuid,
  target_kind text,
  target_party uuid,
  target_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  owed record;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into owed from public.chat_questions_owed(100) o
  where o.conversation_id = target_conversation and o.kind = target_kind and o.party_id = target_party;
  if owed.conversation_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation for update;
  update public.wa_conversations
  set chat_step = chat_step || jsonb_build_object('step', target_kind, 'party', target_party, 'case', owed.case_id)
  where id = conversation.id;
  message := public.one_message(conversation, target_body, null, null);
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_ask_chat_question(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.one_ask_chat_question(uuid, text, uuid, text) to service_role;

/**
 * The client's word given in the chat (0233), kept as on their link: free justice (`target_value` asks) or the civil
 * court (`target_value` accepts, with the wording ONE showed, refused when it changed since), by the person of this
 * conversation who answers for that claimant, a few times a day as the link allows, the conversation's step ended.
 * Service role, for the conversation the backend holds.
 */
create or replace function public.one_answer_chat_question(
  target_conversation uuid,
  target_claim integer,
  target_value boolean,
  target_message uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  kind text;
  party uuid;
  current_case public.cases%rowtype;
  person uuid;
  need record;
  link uuid;
  wording text;
  version integer;
  evidence jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  kind := conversation.chat_step ->> 'step';
  party := nullif(conversation.chat_step ->> 'party', '')::uuid;
  if kind not in ('free_justice', 'civil_court') or party is null or target_value is null then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  select c.* into current_case from public.cases c join public.case_parties cp on cp.case_id = c.id
  where cp.id = party and c.org_id = conversation.org_id;
  select p.id into person from public.people p
  where p.org_id = conversation.org_id and p.erased_at is null
    and conversation.contact_wa_id = any (public.wa_phone_variants(p.phone))
    and p.id = public.civil_court_answerer(party);
  -- The step ends whatever the answer meets: a word that cannot be kept is the firm's to take up.
  update public.wa_conversations set chat_step = chat_step - 'step' - 'party' - 'case' where id = conversation.id;
  if current_case.id is null or person is null then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  perform 1 from public.cases c where c.id = current_case.id for no key update;
  select l.id into link from public.client_links l
  where l.case_id = current_case.id and l.person_id = person and l.revoked_at is null
  order by l.created_at desc limit 1;
  evidence := jsonb_strip_nulls(jsonb_build_object('channel', 'whatsapp', 'message', target_message));

  if kind = 'free_justice' then
    select * into need from public.free_justice_needs(current_case.id) n where n.party_id = party and n.answerer_id = person;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_asked');
    end if;
    if need.asks is not distinct from target_value then
      return jsonb_build_object('ok', true, 'code', 'unchanged', 'kind', kind);
    end if;
    if (select count(*) from public.free_justice_answers a
        where a.party_id = party and a.source = 'client' and a.recorded_at > now() - interval '24 hours')
       >= greatest(coalesce((select case when s.value ->> 'answers_per_day' ~ '^[0-9]{1,4}$' then (s.value ->> 'answers_per_day')::integer end
                             from public.platform_settings s where s.key = 'free_justice'), 10), 1) then
      return jsonb_build_object('ok', false, 'code', 'too_many');
    end if;
    update public.free_justice_answers set replaced_at = now() where party_id = party and replaced_at is null;
    insert into public.free_justice_answers (org_id, case_id, party_id, person_id, asks, source, link_id, evidence)
    values (current_case.org_id, current_case.id, party, person, target_value, 'client', link, evidence);
    if need.answer_id is not null then
      perform public.end_free_justice_paper(current_case.id, person, 'client');
    end if;
    perform public.record_case_event(current_case.org_id, current_case.id, 'free_justice_answered', 'client',
      jsonb_build_object('party', party, 'asks', target_value, 'from', 'conversation'));
    perform public.wake_case_advance(current_case.id);
    return jsonb_build_object('ok', true, 'code', 'recorded', 'kind', kind);
  end if;

  select * into need from public.civil_court_needs(current_case.id) n
  where n.party_id = party and n.planned and n.answerer_id = person;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  wording := public.civil_court_wording(party);
  version := public.civil_court_version();
  if wording is null or version is null then
    return jsonb_build_object('ok', false, 'code', 'wording_changed');
  end if;
  if need.accepted is not distinct from target_value then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'kind', kind);
  end if;
  if target_value and (
    select count(*) from public.civil_court_answers a
    where a.party_id = party and a.source = 'client' and a.accepted and a.recorded_at > now() - interval '24 hours'
  ) >= greatest(coalesce((
    select case when s.value ->> 'answers_per_day' ~ '^[0-9]{1,4}$' then (s.value ->> 'answers_per_day')::integer end
    from public.platform_settings s where s.key = 'civil_court_consent'), 10), 1) then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  update public.civil_court_answers set replaced_at = now() where party_id = party and replaced_at is null;
  insert into public.civil_court_answers (org_id, case_id, party_id, person_id, accepted, wording, version, source, link_id, evidence)
  values (current_case.org_id, current_case.id, party, person, target_value, wording, version, 'client', link, evidence);
  if not target_value then
    perform public.civil_court_declined(party, 'client');
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'civil_court_answered', 'client',
    jsonb_build_object('party', party, 'accepted', target_value, 'from', 'conversation'));
  return jsonb_build_object('ok', true, 'code', case when target_value then 'accepted' else 'declined' end, 'kind', kind);
end;
$$;

revoke all on function public.one_answer_chat_question(uuid, integer, boolean, uuid) from public, anon, authenticated;

/**
 * The client's word on the facts of their action given in the chat (0233): the check ONE told them of in a
 * conversation of their number, still asked, the latest; answered by "chat" as on the link. Service role, for the
 * conversation the backend holds.
 */
create or replace function public.one_answer_piece_facts(
  target_conversation uuid,
  target_claim integer,
  target_confirmed boolean,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  fact public.piece_fact_checks%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select f.* into fact from public.piece_fact_checks f
  where f.org_id = conversation.org_id and f.status = 'asked' and f.told_at is not null
    and exists (
      select 1 from public.case_parties cp join public.people p on p.id = cp.person_id
      where cp.case_id = f.case_id and conversation.contact_wa_id = any (public.wa_phone_variants(p.phone))
    )
  order by f.told_at desc
  limit 1
  for update;
  if fact.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  return public.answer_piece_facts(fact, target_confirmed, target_note, 'chat', null);
end;
$$;

revoke all on function public.one_answer_piece_facts(uuid, integer, boolean, text) from public, anon, authenticated;
