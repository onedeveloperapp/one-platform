-- ============================================================
-- What ONE decides without the firm or the client (0240), from the owner's
-- test of 2026-11-13.
--
--   * The court system of a lawsuit is ONE's to define, no longer the
--     firm's to approve (replacing the owner's decision of 2026-10-27, 0066):
--     a decision of each firm (`court_system`, ONE's by default, 0016), so
--     the system ONE names counts as approved at once, by ONE, and the firm
--     may still refuse it, saying why, as before. A firm that keeps it with a
--     person approves as before. The lawsuits planned now, of firms that
--     leave it to ONE, have their system approved.
--   * The client never says they finished: ONE marks their link finished
--     once their case has what it needs (`one_finish_client_links`, the
--     backend's, at its look of the case), and asks what is missing in the
--     WhatsApp before it (0230). What waited for that word (the
--     declarations, the agency's data seen) goes on from ONE's.
--   * On which leg the problem was is asked of the client in the chat
--     while no leg is marked (`chat_questions_owed` gains `leg`,
--     `one_answer_problem_leg`), never of the firm: ANAC's record still
--     marks it when nobody did (0228), and "Não lembro" leaves it to that.
-- ============================================================

-- ---------- The court system, ONE's ----------

insert into public.autonomy_decisions (key, task, position, modes) values
  ('court_system', null, 65, array['auto', 'approval'])
on conflict (key) do nothing;

-- ONE's work of it, counted as the rest of its work (0121).
insert into public.one_work_kinds (key, family, position, minutes, decision) values
  ('sistema_tribunal', 'acoes', 315, 2, 'court_system')
on conflict (key) do nothing;

/**
 * A planned lawsuit's system is the platform's table's for its court and kind, as ONE's (0066, redefined): approved at
 * once by ONE where the firm leaves that decision to it (`court_system`, 0240), else waiting for a partner, a lawyer
 * or the controladoria as before. Any change of the system, the court or the kind decides it again.
 */
create or replace function public.proceedings_court_system()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  named text;
begin
  if tg_op = 'INSERT' then
    new.created_by_one := public.case_system_writer(new.case_id);
  end if;
  if new.status <> 'planned' then
    return new;
  end if;
  select cs.system into named from public.court_systems cs
  where cs.court = new.court and cs.proceeding_kind = new.kind;
  new.system := named;
  new.system_by_one := named is not null;
  if tg_op = 'INSERT'
     or new.system is distinct from old.system
     or new.court is distinct from old.court
     or new.kind is distinct from old.kind then
    new.system_approved_by := null;
    new.system_approved_at := null;
    new.system_refused_by := null;
    new.system_refused_at := null;
    new.system_refused_reason := null;
    -- ONE defines the system where the firm leaves it to ONE (0240): approved by nobody named, at once.
    if named is not null and public.firm_autonomy_mode(new.org_id, 'court_system') = 'auto' then
      new.system_approved_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.proceedings_court_system() from public, anon, authenticated;

-- The lawsuits planned now whose system waits for the firm, of firms that leave it to ONE: approved by ONE.
update public.proceedings p
set system_approved_at = now()
where p.status = 'planned' and p.system is not null and p.system_approved_at is null and p.system_refused_at is null
  and public.firm_autonomy_mode(p.org_id, 'court_system') = 'auto';

-- ---------- The client's link, finished by ONE ----------

/**
 * ONE marks finished the open links of a case that has what it needs (0240), as the client's "Avisar que terminei"
 * did: the client never has to say it, and what ONE still lacks it asks in the chat. Only a link not finished, of an
 * adult of the case, still open; recorded as ONE's. Called by the backend's look of the case, which read that nothing
 * is missing. Answers how many it marked, or `{ok: false, code: 'not_working'}`. Service role.
 */
create or replace function public.one_finish_client_links(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  finished integer;
  current_case public.cases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = target_case;
  if current_case.status not in ('intake', 'documents', 'signature', 'drafting', 'ready') then
    return jsonb_build_object('ok', true, 'finished', 0);
  end if;
  update public.client_links l set finished_at = now()
  where l.case_id = target_case and l.finished_at is null and l.revoked_at is null and l.expires_at > now();
  get diagnostics finished = row_count;
  if finished > 0 then
    perform public.record_case_event(current_case.org_id, current_case.id, 'client_finished', 'system',
      jsonb_build_object('by', 'one', 'links', finished));
  end if;
  return jsonb_build_object('ok', true, 'finished', finished);
end;
$$;

revoke all on function public.one_finish_client_links(uuid, integer) from public, anon, authenticated;
grant execute on function public.one_finish_client_links(uuid, integer) to service_role;

-- ---------- The leg of the problem, asked of the client ----------

/**
 * The legs of a case as the client's question lists them (0240), one line each in the order of the trip: the flight's
 * number and the two cities ("AD4221, de Petrolina para Campinas"), joined by a line break. Null for a case of fewer
 * than two legs. Internal.
 */
create or replace function public.case_legs_words(target_case uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when count(*) >= 2 then string_agg(
    concat_ws(', ', s.flight_number,
      case when s.origin_iata is not null and s.destination_iata is not null
        then 'de ' || coalesce(o.city, s.origin_iata) || ' para ' || coalesce(d.city, s.destination_iata) end),
    chr(10) order by s.position, s.id) end
  from public.flight_segments s
  left join public.airports o on o.iata = s.origin_iata
  left join public.airports d on d.iata = s.destination_iata
  where s.case_id = target_case;
$$;

revoke all on function public.case_legs_words(uuid) from public, anon, authenticated;

/**
 * The client's words ONE owes a question for in the chat (replaces 0239's): who the holder of a bill is, the client's
 * own account, then on which leg the problem was (`leg`, 0240: a case of two legs or more with none marked, not in
 * court, whose client did not say they do not remember; the legs as `wording`), then free justice and the civil court.
 * ANAC's record, when it comes, marks nothing over the client's word (0228). Service role.
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
    select co.conversation_id, co.org_id, co.case_id, 'residence'::text as kind,
           (select x.id from public.case_parties x where x.case_id = d.case_id and x.person_id = d.person_id
            order by (x.role = 'claimant') desc, x.created_at, x.id limit 1) as party_id,
           true as own, false as appeal, d.holder_name as wording, -2 as rank, co.last_inbound_at
    from cases_of co
    join public.residence_declarations d on d.case_id = co.case_id and d.person_id = co.person_id
      and d.status = 'open' and d.relation is null
    where not exists (
      select 1 from public.case_papers paper
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
    )
    union all
    select co.conversation_id, co.org_id, co.case_id, 'account'::text,
           (select x.id from public.case_parties x where x.case_id = co.case_id and x.person_id = co.person_id
            order by (x.role = 'claimant') desc, x.created_at, x.id limit 1),
           true, false, null::text, -1, co.last_inbound_at
    from cases_of co
    join public.cases c on c.id = co.case_id
    where c.status in ('intake', 'documents', 'signature')
      and public.case_account_state(c.id) = 'missing'
      and not public.case_waits_signature(c.id)
      and not exists (select 1 from public.case_interviews i where i.case_id = c.id)
      and not exists (select 1 from public.proceedings pr where pr.case_id = c.id)
    union all
    select co.conversation_id, co.org_id, co.case_id, 'leg'::text,
           (select x.id from public.case_parties x where x.case_id = co.case_id and x.person_id = co.person_id
            order by (x.role = 'claimant') desc, x.created_at, x.id limit 1),
           true, false, public.case_legs_words(c.id), 0, co.last_inbound_at
    from cases_of co
    join public.cases c on c.id = co.case_id
    where c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
      and c.incident not in ('baggage_lost', 'baggage_damaged', 'baggage_delayed')
      and public.case_legs_words(c.id) is not null
      and not exists (select 1 from public.flight_segments s where s.case_id = c.id and s.affected)
      and not exists (select 1 from public.case_events e where e.case_id = c.id and e.kind = 'leg_unknown_by_client')
    union all
    select co.conversation_id, co.org_id, co.case_id, 'free_justice'::text, n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           public.lawsuit_appeal_open(n.proceeding_id), null::text, 1,
           co.last_inbound_at
    from cases_of co
    cross join lateral public.free_justice_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.answer_id is null
    union all
    select co.conversation_id, co.org_id, co.case_id, 'civil_court', n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           false, public.civil_court_wording(n.party_id), 2, co.last_inbound_at
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
 * The client says in the chat on which leg the problem was (0240): `target_choice` is the leg's place in the list ONE
 * asked by (1 the first leg of the trip), or 0 for "Não lembro" (ANAC's record decides then, 0228). The leg is marked
 * as a person's, the client's, while no leg is marked; the step ends whatever the answer meets. Answers `{ok}`, or
 * `{ok: false, code}`: `not_working`, `not_asked`, `choice`. Service role, for the conversation the backend holds.
 */
create or replace function public.one_answer_problem_leg(target_conversation uuid, target_claim integer, target_choice integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  asked_case uuid;
  current_case public.cases%rowtype;
  leg public.flight_segments%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if coalesce(conversation.chat_step ->> 'step', '') <> 'leg' then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  asked_case := nullif(conversation.chat_step ->> 'case', '')::uuid;
  select * into current_case from public.cases where id = asked_case and org_id = conversation.org_id;
  if target_choice is null or target_choice < 0 then
    return jsonb_build_object('ok', false, 'code', 'choice');
  end if;
  if target_choice > 0 then
    select s.* into leg from public.flight_segments s where s.case_id = asked_case
    order by s.position, s.id offset target_choice - 1 limit 1;
    if leg.id is null then
      return jsonb_build_object('ok', false, 'code', 'choice');
    end if;
  end if;
  update public.wa_conversations set chat_step = chat_step - 'step' - 'party' - 'case' where id = conversation.id;
  if current_case.id is null or exists (select 1 from public.flight_segments s where s.case_id = asked_case and s.affected) then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_choice = 0 then
    perform public.record_case_event(current_case.org_id, current_case.id, 'leg_unknown_by_client', 'client',
      jsonb_build_object('from', 'conversation'));
    return jsonb_build_object('ok', true, 'code', 'unknown');
  end if;
  -- The client's word is a person's mark (0228's trigger writes it so).
  update public.flight_segments set affected = true, updated_at = now() where id = leg.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'leg_told_by_client', 'client',
    jsonb_build_object('segment', leg.id, 'flight', leg.flight_number, 'from', 'conversation'));
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true, 'code', 'marked', 'flight', leg.flight_number);
end;
$$;

revoke all on function public.one_answer_problem_leg(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.one_answer_problem_leg(uuid, integer, integer) to service_role;
