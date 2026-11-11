-- ============================================================
-- The complaint before the lawsuit, only where the unit asks it (0180),
-- item 3.5 of the case journey plan. A unit's profile (0179,
-- `court_units.prior_complaint`, written by the operator until the
-- jurimetry reads it) says whether it asks for a complaint before the
-- lawsuit; where it does, ONE writes no piece of that lawsuit until the case
-- has one and its channel's days ran (`case_prior_complaint`: owed, waiting,
-- done). ONE files nothing at the channel: it guides the client step by step
-- on their link to consumidor.gov.br, and the client registers it and gives
-- the protocol (`client_link_record_complaint`), which enters the case's
-- complaint (0026), due on the channel's days; the client says what the
-- airline answered (`client_link_complaint_answer`), and a complaint nobody
-- answered by its day is closed by ONE as unanswered
-- (`advance_prior_complaint`). What the airline paid when it settled is kept
-- (`admin_complaints.paid_cents`), and the piece is handed it with the rest
-- of the complaint (`case_draft_to_work`): the case goes on for the moral
-- damage, what was paid enters as a fact and leaves the material damage the
-- piece asks (a seventh version of `caso.peca.minuta`); the complaint and its
-- answer go to the initial as proof of the attempt.
-- ============================================================

alter table public.admin_complaints add column paid_cents bigint;
alter table public.admin_complaints add column by_client boolean not null default false;
alter table public.admin_complaints add constraint admin_complaints_paid_check
  check (paid_cents is null or paid_cents between 0 and 100000000);

/** How many days a channel gives the airline to answer, as the setting says (0026); ten when it names none. */
create or replace function public.complaint_answer_days(target_channel text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(coalesce(
    (select (s.value -> 'answer_days' ->> target_channel)::integer from public.platform_settings s where s.key = 'complaints'),
    10), 1);
$$;

revoke all on function public.complaint_answer_days(text) from public, anon, authenticated;

/**
 * Where a case's complaint before the lawsuit stands (0180): not required (no planned lawsuit of the case is
 * addressed to a unit whose profile asks it), owed (none made yet), waiting (made, unanswered, within its days) or
 * done (answered, settled, or past its days, said `overdue` while nobody closed it). With the units that ask it and
 * the complaint that counts: the latest one made, of any channel. Internal.
 */
create or replace function public.case_prior_complaint(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with asking as (
    select distinct u.name from public.proceedings p
    join public.court_units u on u.id = p.unit_id
    where p.case_id = target_case and p.status = 'planned' and u.prior_complaint = 'required'
  ),
  made as (
    select a.*, coalesce(a.answer_due_on, a.filed_on + public.complaint_answer_days(a.channel)) as due_on
    from public.admin_complaints a
    where a.case_id = target_case and (a.protocol is not null or a.filed_on is not null)
    order by coalesce(a.filed_on, a.created_at::date) desc, a.created_at desc
    limit 1
  )
  select jsonb_build_object(
    'state', case
      when not exists (select 1 from asking) then 'not_required'
      when not exists (select 1 from made) then 'owed'
      when (select m.outcome = 'pending' and (m.due_on is null or m.due_on >= (now() at time zone 'America/Sao_Paulo')::date) from made m)
        then 'waiting'
      else 'done'
    end,
    'overdue', exists (select 1 from asking) and coalesce(
      (select m.outcome = 'pending' and m.due_on < (now() at time zone 'America/Sao_Paulo')::date from made m), false),
    'units', coalesce((select jsonb_agg(a.name order by a.name) from asking a), '[]'::jsonb),
    'complaint', (select jsonb_build_object('id', m.id, 'channel', m.channel, 'protocol', m.protocol, 'filed_on', m.filed_on,
                                            'due_on', m.due_on, 'answered_on', m.answered_on, 'outcome', m.outcome,
                                            'paid_cents', m.paid_cents, 'by_client', m.by_client)
                  from made m),
    'days', public.complaint_answer_days('consumidor_gov')
  );
$$;

revoke all on function public.case_prior_complaint(uuid) from public, anon, authenticated;

/** Whether ONE waits for the case's complaint before writing a lawsuit's piece: its unit asks it, and it is owed or waiting. */
create or replace function public.lawsuit_prior_complaint_pending(target_proceeding uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select u.prior_complaint = 'required'
      and public.case_prior_complaint(p.case_id) ->> 'state' in ('owed', 'waiting')
    from public.proceedings p
    join public.court_units u on u.id = p.unit_id
    where p.id = target_proceeding
  ), false);
$$;

revoke all on function public.lawsuit_prior_complaint_pending(uuid) from public, anon, authenticated;

/** A piece is due as before (0039), and not while the complaint its unit asks is owed or waiting (replaces 0039's). */
create or replace function public.advance_piece_due(target_proceeding uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.case_drafts d where d.proceeding_id = target_proceeding)
    and not public.case_hand_petition((select p.case_id from public.proceedings p where p.id = target_proceeding))
    and not public.lawsuit_prior_complaint_pending(target_proceeding);
$$;

revoke all on function public.advance_piece_due(uuid) from public, anon, authenticated;

/** The steps are due as before (0098), and so is a case whose complaint ran past its days unanswered: ONE closes it. */
create or replace function public.case_advance_steps_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.case_advance_package_due(target_case) or exists (
    select 1 from public.proceedings p
    join public.cases k on k.id = p.case_id
    where p.case_id = target_case and p.status = 'planned' and k.status not in ('filed', 'closed', 'declined')
      and public.firm_autonomy_mode(k.org_id, 'start_piece') = 'auto' and public.advance_piece_due(p.id)
  ) or exists (select 1 from public.case_pieces_to_redo(target_case))
    or (public.case_prior_complaint(target_case) ->> 'overdue')::boolean;
$$;

revoke all on function public.case_advance_steps_due(uuid) from public, anon, authenticated;

/**
 * ONE's look at a case's complaint before the lawsuit (service role, with the case's claim): one that ran past its
 * days unanswered is closed as unanswered, told in the timeline as ONE's; and what ONE waits for of it before a piece,
 * the client's complaint to make or the channel's days to run.
 */
create or replace function public.advance_prior_complaint(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  standing jsonb;
  complaint uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  current_case := public.case_for_writer(target_case);
  if not public.case_advance_held(target_case, target_claim) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  standing := public.case_prior_complaint(target_case);
  if (standing ->> 'overdue')::boolean then
    complaint := (standing #>> '{complaint,id}')::uuid;
    update public.admin_complaints set outcome = 'no_answer' where id = complaint and outcome = 'pending';
    perform public.record_case_event(current_case.org_id, target_case, 'complaint_saved', 'system',
      jsonb_build_object('complaint', complaint, 'channel', standing #>> '{complaint,channel}', 'outcome', 'no_answer'));
    standing := public.case_prior_complaint(target_case);
  end if;
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'state', standing ->> 'state',
    'waiting', case
      when current_case.status in ('filed', 'closed', 'declined') then null
      when public.firm_autonomy_mode(current_case.org_id, 'start_piece') <> 'auto' then null
      when not exists (
        select 1 from public.proceedings p
        where p.case_id = target_case and p.status = 'planned' and public.lawsuit_prior_complaint_pending(p.id)
          and not exists (select 1 from public.case_drafts d where d.proceeding_id = p.id)
      ) then null
      when standing ->> 'state' = 'owed' then 'prior_complaint_owed'
      else 'prior_complaint_waiting'
    end);
end;
$$;

revoke all on function public.advance_prior_complaint(uuid, integer) from public, anon, authenticated;
grant execute on function public.advance_prior_complaint(uuid, integer) to service_role;

/** A complaint made, answered or corrected wakes ONE's look at its case. */
create or replace function public.admin_complaints_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wake_case_advance(coalesce(new.case_id, old.case_id));
  return null;
end;
$$;

revoke all on function public.admin_complaints_wake_advance() from public, anon, authenticated;

create trigger admin_complaints_wake_advance after insert or update or delete on public.admin_complaints
  for each row execute function public.admin_complaints_wake_advance();

-- ---------- The client, on their link ----------

/** What the client's link shows of the complaint before the lawsuit, with the airline it is made against. Backend. */
create or replace function public.client_link_prior_complaint(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  airline_name text;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  select coalesce(nullif(btrim(a.name), ''), a.iata) into airline_name
  from public.cases c join public.airlines a on a.iata = c.airline_iata where c.id = link.case_id;
  return jsonb_build_object('ok', true, 'airline', airline_name) || public.case_prior_complaint(link.case_id);
end;
$$;

revoke all on function public.client_link_prior_complaint(text) from public, anon, authenticated;
grant execute on function public.client_link_prior_complaint(text) to anon, authenticated, service_role;

/**
 * The client gives the protocol of the complaint they made at consumidor.gov.br, and the day (0180): it enters the
 * case's complaint, due on the channel's days; while it is owed, or to correct their own while nobody answered it.
 * Backend, by the link.
 */
create or replace function public.client_link_record_complaint(target_token text, target_protocol text, target_filed_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  standing jsonb;
  protocol_value text := nullif(regexp_replace(btrim(coalesce(target_protocol, '')), '\s+', ' ', 'g'), '');
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  complaint uuid;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  if protocol_value is null or char_length(protocol_value) not between 3 and 80 or protocol_value ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'invalid_protocol');
  end if;
  if target_filed_on is null or target_filed_on > today or target_filed_on < today - 365 then
    return jsonb_build_object('ok', false, 'code', 'invalid_date');
  end if;
  standing := public.case_prior_complaint(link.case_id);
  if standing ->> 'state' = 'owed' then
    insert into public.admin_complaints (org_id, case_id, channel, protocol, filed_on, answer_due_on, by_client)
    values (link.org_id, link.case_id, 'consumidor_gov', protocol_value, target_filed_on,
            target_filed_on + public.complaint_answer_days('consumidor_gov'), true)
    returning id into complaint;
  elsif standing ->> 'state' = 'waiting' and (standing #>> '{complaint,by_client}')::boolean then
    complaint := (standing #>> '{complaint,id}')::uuid;
    update public.admin_complaints
    set protocol = protocol_value, filed_on = target_filed_on,
        answer_due_on = target_filed_on + public.complaint_answer_days(channel)
    where id = complaint;
  else
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  perform public.record_case_event(link.org_id, link.case_id, 'complaint_saved', 'client',
    jsonb_build_object('complaint', complaint, 'channel', 'consumidor_gov', 'outcome', 'pending'));
  return jsonb_build_object('ok', true, 'code', 'saved') || public.case_prior_complaint(link.case_id);
end;
$$;

revoke all on function public.client_link_record_complaint(text, text, date) from public, anon, authenticated;
grant execute on function public.client_link_record_complaint(text, text, date) to service_role;

/**
 * The client says what the airline answered to the complaint (0180): it settled (with what it paid, if it paid) or it
 * answered and settled nothing. While nobody else said it. Backend, by the link.
 */
create or replace function public.client_link_complaint_answer(target_token text, target_outcome text, target_paid_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  standing jsonb;
  complaint uuid;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  if target_outcome is null or target_outcome not in ('answered', 'settled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  if target_paid_cents is not null and (target_paid_cents < 0 or target_paid_cents > 100000000 or target_outcome <> 'settled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  standing := public.case_prior_complaint(link.case_id);
  complaint := (standing #>> '{complaint,id}')::uuid;
  if complaint is null or standing #>> '{complaint,outcome}' <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  update public.admin_complaints
  set outcome = target_outcome, answered_on = greatest((now() at time zone 'America/Sao_Paulo')::date, filed_on),
      paid_cents = target_paid_cents
  where id = complaint;
  perform public.record_case_event(link.org_id, link.case_id, 'complaint_saved', 'client',
    jsonb_build_object('complaint', complaint, 'channel', standing #>> '{complaint,channel}', 'outcome', target_outcome));
  return jsonb_build_object('ok', true, 'code', 'saved') || public.case_prior_complaint(link.case_id);
end;
$$;

revoke all on function public.client_link_complaint_answer(text, text, bigint) from public, anon, authenticated;
grant execute on function public.client_link_complaint_answer(text, text, bigint) to service_role;

/** What the case screen reads of the complaint before the lawsuit: where it stands, and the units that ask it. Member. */
create or replace function public.case_prior_complaint_view(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := (select c.org_id from public.cases c where c.id = target_case);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if org is null or not public.is_org_member(org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true) || public.case_prior_complaint(target_case);
end;
$$;

revoke all on function public.case_prior_complaint_view(uuid) from public, anon;
grant execute on function public.case_prior_complaint_view(uuid) to authenticated;

/** Who a wait of ONE is with (replaces 0125's): the client makes the complaint and waits for the airline's answer. */
create or replace function public.wait_owner(target_code text)
returns text
language sql
immutable
as $$
  select case
    when target_code in (
      'case_incomplete', 'civil_court_unanswered', 'power_of_attorney_unsigned', 'client_confirmation',
      'account_missing', 'account_incomplete', 'residence_relation_missing', 'residence_declaration_unsigned',
      'free_justice_unanswered', 'free_justice_unsigned', 'prior_complaint_owed', 'prior_complaint_waiting'
    ) then 'client'
    when target_code in ('account_preparing', 'account_contested', 'unavailable', 'step_failed') then 'one'
    when target_code in ('ceiling_unknown', 'system_unknown', 'system_refused') then 'platform'
    else 'firm'
  end;
$$;

revoke all on function public.wait_owner(text) from public, anon, authenticated;

-- ---------- The firm records it, with what was paid ----------

/** A person of the firm records a complaint of the case, or corrects one, with what the airline paid (replaces 0026's). */
create or replace function public.save_admin_complaint(target_case uuid, target_complaint uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  complaint uuid := target_complaint;
  channel_value text := nullif(btrim(coalesce(fields ->> 'channel', '')), '');
  outcome_value text := coalesce(nullif(btrim(coalesce(fields ->> 'outcome', '')), ''), 'pending');
  filed date;
  due date;
  answered date;
  paid bigint;
begin
  if channel_value is null or channel_value not in ('anac_passageiro', 'consumidor_gov', 'procon', 'airline', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_channel', 'field', 'channel');
  end if;
  if outcome_value not in ('pending', 'answered', 'settled', 'no_answer') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome', 'field', 'outcome');
  end if;
  if complaint is not null and not exists (
    select 1 from public.admin_complaints a where a.id = complaint and a.case_id = current_case.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  begin
    filed := nullif(btrim(coalesce(fields ->> 'filed_on', '')), '')::date;
    due := nullif(btrim(coalesce(fields ->> 'answer_due_on', '')), '')::date;
    answered := nullif(btrim(coalesce(fields ->> 'answered_on', '')), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok', false, 'code', 'invalid_date');
  end;
  begin
    paid := case when fields ? 'paid_cents' then nullif(btrim(coalesce(fields ->> 'paid_cents', '')), '')::bigint end;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'code', 'invalid_value', 'field', 'paid_cents');
  end;
  begin
    if complaint is null then
      insert into public.admin_complaints (org_id, case_id, channel, created_by)
      values (current_case.org_id, current_case.id, channel_value, auth.uid())
      returning id into complaint;
    end if;
    update public.admin_complaints set
      channel = channel_value,
      protocol = nullif(btrim(coalesce(fields ->> 'protocol', '')), ''),
      filed_on = filed,
      answer_due_on = due,
      answered_on = answered,
      outcome = outcome_value,
      notes = nullif(btrim(coalesce(fields ->> 'notes', '')), ''),
      -- What the airline paid when it settled (0180); a correction that says nothing of it keeps what was said.
      paid_cents = case when fields ? 'paid_cents' then paid else paid_cents end
    where id = complaint;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  perform public.record_case_event(current_case.org_id, current_case.id, 'complaint_saved', 'person',
    jsonb_build_object('complaint', complaint, 'channel', channel_value, 'outcome', outcome_value));
  return jsonb_build_object('ok', true, 'code', 'saved', 'complaint_id', complaint);
end;
$$;

revoke all on function public.save_admin_complaint(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_admin_complaint(uuid, uuid, jsonb) to authenticated;

-- ---------- The piece writes it ----------

create or replace function public.case_draft_to_work(target_draft uuid, target_claim integer)
returns table (
  draft_id uuid, org_id uuid, case_id uuid, claim integer, work text, version integer, body text,
  template text, facts jsonb, library jsonb, run_key text, firm text, title text, requested_by uuid, note text,
  same jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  keyed jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts d
  where d.id = target_draft and d.work is not null and d.work_claimed_at is not null and d.work_claims = target_claim;
  if not found then
    return;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into current_case from public.cases where id = draft.case_id;

  draft_id := draft.id;
  org_id := draft.org_id;
  case_id := draft.case_id;
  claim := draft.work_claims;
  work := draft.work;
  version := draft.version;
  -- Who asked (the piece, or its rewriting), while they are still of the firm: a run is asked by a person
  -- of the firm or by nobody.
  requested_by := (
    select m.user_id from public.memberships m
    where m.org_id = draft.org_id
      and m.user_id = case when draft.work = 'revise' then draft.revision_by else draft.requested_by end
  );
  firm := (select o.name from public.organizations o where o.id = draft.org_id);
  title := draft.template_name || ', caso ' || current_case.seq
    || case lawsuit.kind when 'juizado' then ', juizado especial' else ', vara cível' end;
  body := case draft.work
    when 'issue' then draft.approved_body
    when 'check' then (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version)
  end;
  if draft.work = 'revise' then
    -- The list of the marks is written under the claim, with the draft held: a request given up and asked
    -- again meanwhile is another claim, and never reads under this one's list.
    select * into draft from public.case_drafts d
    where d.id = target_draft and d.work = 'revise' and d.work_claimed_at is not null and d.work_claims = target_claim
    for update;
    if not found then
      return;
    end if;
    -- A second look at the same work (its worker was cut) reads under the marks of the first.
    keyed := public.case_text_keyed(current_case.id,
      (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version),
      coalesce(draft.revision_keys, '{}'::jsonb));
    body := keyed ->> 'text';
    keyed := public.case_text_keyed(current_case.id, draft.revision_note, keyed -> 'keys');
    note := keyed ->> 'text';
    same := public.case_marks_same_name(current_case.id, keyed -> 'keys');
    update public.case_drafts d set revision_keys = keyed -> 'keys' where d.id = draft.id;
  end if;
  if draft.work in ('generate', 'revise') then
    if draft.work = 'generate' then
      -- The model of the firm goes as an account does: with what identifies a person taken out of it.
      template := public.case_text_for_ai(current_case.id, draft.template_body);
    end if;
    -- The runs that will never be this draft's text: the ones that failed, and the ones whose answer was no
    -- piece. Each rewriting asked for is a work of its own, with runs of its own.
    run_key := 'draft:' || draft.id::text
      || case when draft.work = 'revise' then ':r' || draft.revisions::text else '' end
      || ':' || (draft.unusable_runs + (
      select count(*) from public.ai_runs r
      where r.org_id = draft.org_id and r.task = 'caso.peca.minuta'
        and r.subject_type = 'case_draft' and r.subject_id = draft.id::text and r.status in ('failed', 'blocked')
    ))::text;
    facts := jsonb_build_object(
      'tipo_de_processo', case lawsuit.kind when 'juizado' then 'juizado especial cível' else 'vara cível, procedimento comum' end,
      'ocorrencia', current_case.incident,
      'companhia', (select a.name from public.airlines a where a.iata = current_case.airline_iata),
      'data_do_voo', current_case.flight_date,
      'causa_informada_pela_companhia', current_case.airline_stated_cause,
      'quantas_partes', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = lawsuit.id),
      -- A minor as the piece itself tells one: not eighteen yet today; with no day of birth on record, one
      -- somebody answers for (`case_draft_filled`).
      'ha_menor_entre_as_partes', exists (
        select 1 from public.proceeding_parties pp
        join public.case_parties cp on cp.id = pp.party_id
        join public.people pe on pe.id = cp.person_id
        where pp.proceeding_id = lawsuit.id
          and case when pe.birth_date is null then cp.guardian_id is not null
                   else pe.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years' end
      ),
      'foro', jsonb_build_object('comarca', lawsuit.comarca, 'base', lawsuit.forum_basis,
        'motivo', public.case_text_for_ai(current_case.id, lawsuit.forum_reason)),
      'trechos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'voo', s.flight_number, 'origem', s.origin_iata, 'destino', s.destination_iata,
          'partida_prevista', s.scheduled_departure_local, 'chegada_prevista', s.scheduled_arrival_local,
          'partida_real', s.actual_departure_local, 'chegada_real', s.actual_arrival_local,
          'trecho_afetado', s.affected,
          'registro_oficial', (
            select jsonb_strip_nulls(jsonb_build_object(
              'situacao', c.record ->> 'state',
              'partida_real_horario_de_brasilia', c.record ->> 'actualDeparture',
              'chegada_real_horario_de_brasilia', case
                when coalesce(c.record ->> 'arrivalElsewhere', 'false') = 'true' then null
                else c.record ->> 'actualArrival' end,
              'motivo_informado_pela_companhia', nullif(btrim(coalesce(c.record ->> 'justification', '')), '')
            ))
            from public.flight_checks c
            where c.segment_id = s.id and c.source = 'vra' and c.status = 'found'
          )
        ) order by s.position)
        from public.flight_segments s where s.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the client told, in the order of the facts the firm approved, and whether the client confirmed it.
      'relatos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'confirmado_pelo_cliente', st.chronology_status = 'confirmed',
          'cronologia', public.case_text_for_ai(current_case.id, st.chronology)
        ) order by st.created_at)
        from public.case_statements st
        where st.case_id = current_case.id and st.chronology is not null and st.chronology_status in ('approved', 'confirmed')
      ), '[]'::jsonb),
      'reclamacoes_antes_da_acao', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canal', ac.channel, 'protocolo', ac.protocol, 'feita_em', ac.filed_on, 'respondida_em', ac.answered_on,
          'resultado', ac.outcome,
          -- What the airline paid when it settled (0180): a fact, and out of the material damage the piece asks.
          'valor_pago_em_centavos', ac.paid_cents
        ) order by ac.created_at)
        from public.admin_complaints ac where ac.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the documents the firm accepted say of the purchase and of each expense (0091).
      'compras', coalesce(public.case_document_readings(current_case.id) -> 'compras', '[]'::jsonb),
      'gastos', coalesce(public.case_document_readings(current_case.id) -> 'gastos', '[]'::jsonb)
    );
    -- Every source with its key: the worker puts the ones the model itself cites first and fits the rest
    -- to what one request carries (`draftLibrary`). Only the start of what may be transcribed goes.
    library := coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', s.key, 'como_citar', s.citation, 'titulo', s.title,
        -- The words in force on the day of the flight (0143): a source whose words changed later hands the earlier ones.
        'trecho', left(case when s.quote_before is not null and current_case.flight_date < s.in_force_from
                            then s.quote_before else s.quote end, 1200),
        'redacao', case
          when s.in_force_from is null then null
          when s.quote_before is not null and current_case.flight_date < s.in_force_from
            then 'redação anterior a ' || to_char(s.in_force_from, 'DD/MM/YYYY') || ', a do dia do voo'
          else 'redação em vigor desde ' || to_char(s.in_force_from, 'DD/MM/YYYY')
        end
      ) order by s.verified_at desc, s.id)
      from (
        -- The firm's sources and the platform's (0045); where both have a key, the firm's.
        select * from (
          select distinct on (ls.key) ls.* from public.legal_sources ls
          where (ls.org_id = draft.org_id or ls.org_id is null) and ls.status = 'verified'
          order by ls.key, (ls.org_id is null), ls.verified_at desc
        ) both_libraries
        order by both_libraries.verified_at desc, both_libraries.id limit 1000
      ) s
    ), '[]'::jsonb);
  end if;
  return next;
end;
$$;

revoke all on function public.case_draft_to_work(uuid, integer) from public, anon, authenticated;

-- A seventh version of `caso.peca.minuta`: a complaint before the lawsuit is the attempt to settle, and what the
-- airline paid in it is a fact and leaves the material damage the piece asks.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.peca.minuta',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.peca.minuta'),
  v.provider, v.model, v.effort,
  v.system_prompt || E'

Reclamação antes da ação: cada reclamação em "reclamacoes_antes_da_acao" é a tentativa de resolver sem o processo. Diga nos fatos o canal, o protocolo, quando foi feita e o que a companhia respondeu ("no_answer" é que ela não respondeu no prazo do canal). Quando a companhia pagou um valor ("valor_pago_em_centavos"), diga esse pagamento como fato e não peça dano material do que já foi pago: peça o dano moral e só o dano material que o pagamento não cobriu.',
  v.output_schema, v.max_tokens, false,
  'A reclamação antes da ação é a tentativa de resolver, e o que a companhia pagou nela sai do dano material.'
from public.prompt_versions v
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'valor_pago_em_centavos') = 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'valor_pago_em_centavos') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, 'valor_pago_em_centavos') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.peca.minuta'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.peca.minuta')
  and strpos(system_prompt, 'valor_pago_em_centavos') > 0;
