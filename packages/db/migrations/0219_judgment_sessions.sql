-- ============================================================
-- 0219 · A sessão de julgamento do recurso e a inscrição para sustentação oral.
--
-- From the review of 2026-11-11 against the CPC and the TJGO's rules. A
-- panel judges an appeal in a session its pauta sets: virtual, voted in the
-- system over some days, or presencial (in person, by videoconference or
-- both). A lawyer who wants to argue registers first: in the TJGO's Turmas
-- Recursais, in the system, until 10h of the business day before a virtual
-- session starts (Resolução nº 225/2023, art. 78, § 1º; oral argument is
-- open in the recurso inominado, art. 107, never in embargos, art. 110); in
-- the TJGO's chambers, the same for a virtual session, and until the session
-- opens for a presencial one (Regimento Interno do TJGO, art. 150; CPC, art.
-- 937, § 2º). ONE knew a pauta was no hearing of the client's (0040) and
-- kept nothing of it: no day on the firm's agenda, no limit to register.
--
-- Each court's rule is data (`oral_argument_rules`: the court, its body, the
-- kind of session, the limit and the act that says it), seeded for the TJGO.
-- A session is a record of its own (`judgment_sessions`), never a hearing,
-- and the client is told nothing of it. ONE records it from the pauta it
-- reads, where the firm lets ONE put on its agenda what a publication sets
-- (`publication_hearing`, 0040): the first day the text names after the
-- publication's is the session's, its one hour the hour, virtual when the
-- text says so; a text that also moves or withdraws something is a person's
-- to read. A person records one ONE did not read, withdraws one with why,
-- and says whether the firm registered to argue or will not. A new pauta of
-- the lawsuit replaces the session to come it had. The backend counts the
-- limit with `@flyee/rules/sessions` over the court's calendar
-- (`sessions_to_count`, `record_session_limit`, by the session's revision),
-- and the agenda, the morning's e-mail and the calendar link hand out the
-- session and its limit (`agenda_items`, redefined from 0132); the case
-- reads itself again when one changes (`case_pulse`, redefined from 0182).
-- ============================================================

-- ---------- Each court's rule of registration, as data ----------

create table public.oral_argument_rules (
  court text not null,
  -- turma_recursal  the panel of the small-claims courts, which judges the recurso inominado;
  -- tribunal        the court's chambers, which judge the apelação.
  body text not null,
  session_kind text not null,
  -- previous_business_day  until an hour of the court's business day before the session starts;
  -- session_start          until the session is declared open.
  until_kind text not null,
  until_hour time,
  basis text not null,
  updated_at timestamptz not null default now(),
  primary key (court, body, session_kind),
  constraint oral_argument_rules_court_check check (court ~ '^[A-Z0-9-]{2,12}$'),
  constraint oral_argument_rules_body_check check (body in ('turma_recursal', 'tribunal')),
  constraint oral_argument_rules_kind_check check (session_kind in ('virtual', 'presencial')),
  constraint oral_argument_rules_until_check check (
    (until_kind = 'previous_business_day' and until_hour is not null)
    or (until_kind = 'session_start' and until_hour is null)
  ),
  constraint oral_argument_rules_basis_check check (char_length(btrim(basis)) between 5 and 300)
);

alter table public.oral_argument_rules enable row level security;
create policy "oral_argument_rules_select_all" on public.oral_argument_rules for select to authenticated using (true);
grant select on table public.oral_argument_rules to authenticated;

insert into public.oral_argument_rules (court, body, session_kind, until_kind, until_hour, basis) values
  ('TJGO', 'turma_recursal', 'virtual', 'previous_business_day', '10:00',
   'Regimento Interno das Turmas Recursais do TJGO (Resolução nº 225/2023), art. 78, § 1º'),
  ('TJGO', 'turma_recursal', 'presencial', 'session_start', null,
   'CPC, art. 937, § 2º; por videoconferência, pedido até o dia anterior (Resolução nº 225/2023, art. 66, § 1º)'),
  ('TJGO', 'tribunal', 'virtual', 'previous_business_day', '10:00', 'Regimento Interno do TJGO, art. 150'),
  ('TJGO', 'tribunal', 'presencial', 'session_start', null, 'Regimento Interno do TJGO, art. 150; CPC, art. 937, § 2º')
on conflict (court, body, session_kind) do nothing;

-- ---------- The sessions ----------

create table public.judgment_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  -- The pauta ONE read it from; none when a person recorded it.
  publication_id uuid unique,
  kind text not null,
  starts_on date not null,
  starts_at time,
  -- scheduled  on the agenda;
  -- withdrawn  taken off, with why: by a person, or replaced by a new pauta of the lawsuit.
  status text not null default 'scheduled',
  withdraw_reason text,
  source text not null,
  created_by uuid references public.profiles (id) on delete set null,
  -- Each change of what the limit reads (the day, the hour, the kind) is a revision: the backend counts it again.
  revision integer not null default 1,
  limit_revision integer,
  limit_on date,
  limit_hour time,
  limit_basis text,
  limit_passed jsonb,
  limit_rule text,
  limit_error text,
  limit_at timestamptz,
  -- The firm's word on arguing: it registered in the court's system, or it will not argue.
  oral_choice text,
  oral_by uuid references public.profiles (id) on delete set null,
  oral_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (publication_id, org_id) references public.publications (id, org_id) on delete set null (publication_id),
  constraint judgment_sessions_kind_check check (kind in ('virtual', 'presencial')),
  constraint judgment_sessions_day_check check (starts_on between date '2019-01-01' and date '2100-12-31'),
  constraint judgment_sessions_status_check check (
    status in ('scheduled', 'withdrawn')
    and (status = 'withdrawn') = (withdraw_reason is not null)
    and (withdraw_reason is null or char_length(withdraw_reason) between 3 and 500)
  ),
  constraint judgment_sessions_source_check check (
    source in ('publication', 'person') and (source = 'publication' or publication_id is null)
  ),
  constraint judgment_sessions_revision_check check (
    revision >= 1 and (limit_revision is null or limit_revision between 1 and revision)
  ),
  constraint judgment_sessions_limit_check check (
    (limit_basis is null or char_length(limit_basis) <= 300)
    and (limit_passed is null or (jsonb_typeof(limit_passed) = 'array' and octet_length(limit_passed::text) <= 4000))
    and (limit_rule is null or limit_rule ~ '^sustentacao-v[0-9]{1,3}$')
    and (limit_error is null or limit_error ~ '^[a-z][a-z0-9_]{1,59}$')
  ),
  constraint judgment_sessions_oral_check check (
    (oral_choice is null or oral_choice in ('registered', 'declined')) and (oral_choice is null) = (oral_at is null)
  )
);

create index judgment_sessions_lawsuit_idx on public.judgment_sessions (proceeding_id, starts_on desc);
create index judgment_sessions_agenda_idx on public.judgment_sessions (org_id, starts_on) where status = 'scheduled';
create index judgment_sessions_count_idx on public.judgment_sessions (starts_on)
  where status = 'scheduled' and limit_revision is null;

alter table public.judgment_sessions enable row level security;
create policy "judgment_sessions_select_member" on public.judgment_sessions
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.judgment_sessions to authenticated;
create trigger guard_impersonation_judgment_sessions after insert or update or delete on public.judgment_sessions
  for each statement execute function public.guard_impersonation_readonly();

/** A change of what the limit reads is a new revision, counted again; the row's time follows every change. */
create or replace function public.judgment_sessions_revise()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.starts_on is distinct from old.starts_on or new.starts_at is distinct from old.starts_at
     or new.kind is distinct from old.kind then
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.judgment_sessions_revise() from public, anon, authenticated;

create trigger judgment_sessions_revise before update on public.judgment_sessions
  for each row execute function public.judgment_sessions_revise();

-- ---------- ONE reads it from the pauta ----------

/** Whether a court's text sets a virtual session ("sessão virtual", "julgamento virtual", "plenário virtual"). */
create or replace function public.reading_session_virtual(body text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (' ' || public.reading_plain(public.reading_unmarked(body)) || ' ')
    ~ ' (sessao( de julgamento)? virtual|julgamento virtual|plenario virtual|ambiente virtual)';
$$;

revoke all on function public.reading_session_virtual(text) from public, anon, authenticated;

/**
 * ONE records the session a pauta of a lawsuit with the court sets (0219), where the firm lets ONE put on its agenda
 * what a publication sets (`publication_hearing`), or nothing: a text that also moves or withdraws something, or
 * names no day after its own, is a person's to read. The first day the text names after the publication's is the
 * session's; its hour, when the text names one only; virtual when the text says so. A session the lawsuit already has
 * on that day is the same one; a session to come on another day is replaced, with why. Internal: the session's id.
 */
create or replace function public.one_record_judgment_session(target_publication uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  lawsuit public.proceedings%rowtype;
  unmarked text;
  day date;
  hours time[];
  made uuid;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into publication from public.publications where id = target_publication;
  if not found or not publication.active or publication.proceeding_id is null or publication.category is null
     or not public.reading_judgment_session(publication.body)
     or public.reading_changes_hearing(publication.body) or public.reading_struck(publication.body) then
    return null;
  end if;
  if exists (select 1 from public.judgment_sessions s where s.publication_id = publication.id) then
    return null;
  end if;
  if public.firm_autonomy_mode(publication.org_id, 'publication_hearing') is distinct from 'auto' then
    return null;
  end if;
  select * into lawsuit from public.proceedings p where p.id = publication.proceeding_id and p.org_id = publication.org_id;
  if not found or lawsuit.status <> 'filed' or lawsuit.kind not in ('juizado', 'comum') then
    return null;
  end if;
  unmarked := public.reading_unmarked(publication.body);
  select min(d) into day from unnest(public.reading_dates(unmarked)) as d
  where d > publication.available_on and d >= today;
  if day is null then
    return null;
  end if;
  hours := public.reading_times(unmarked);
  -- The same session, read again from another publication of it.
  if exists (select 1 from public.judgment_sessions s
             where s.proceeding_id = lawsuit.id and s.status = 'scheduled' and s.starts_on = day) then
    return null;
  end if;
  update public.judgment_sessions s
  set status = 'withdrawn', withdraw_reason = 'Uma nova pauta do processo marcou outra sessão.'
  where s.proceeding_id = lawsuit.id and s.status = 'scheduled' and s.starts_on >= today;
  insert into public.judgment_sessions (org_id, case_id, proceeding_id, publication_id, kind, starts_on, starts_at, source)
  values (lawsuit.org_id, lawsuit.case_id, lawsuit.id, publication.id,
          case when public.reading_session_virtual(publication.body) then 'virtual' else 'presencial' end,
          day, case when cardinality(hours) = 1 then hours[1] end, 'publication')
  returning id into made;
  perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'judgment_session_recorded', 'system',
    jsonb_build_object('session', made, 'proceeding', lawsuit.id, 'publication', publication.id));
  return made;
end;
$$;

revoke all on function public.one_record_judgment_session(uuid) from public, anon, authenticated;

create or replace function public.publications_judgment_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.one_record_judgment_session(new.id);
  return null;
end;
$$;

revoke all on function public.publications_judgment_session() from public, anon, authenticated;

create trigger publications_judgment_session_insert after insert on public.publications
  for each row
  when (new.category is not null and new.active and new.proceeding_id is not null)
  execute function public.publications_judgment_session();

create trigger publications_judgment_session_update after update of category, proceeding_id on public.publications
  for each row
  when (new.category is not null and new.active and new.proceeding_id is not null
        and (old.category is null or old.proceeding_id is distinct from new.proceeding_id))
  execute function public.publications_judgment_session();

-- ---------- What a person does of it ----------

/**
 * A person of the firm records a session ONE did not read (0219): of a lawsuit with the court, its kind, its day and,
 * when known, its hour. Never a support visit; on the record and in the case's timeline.
 */
create or replace function public.record_judgment_session(
  target_proceeding uuid,
  target_kind text,
  target_starts_on date,
  target_starts_at time
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  made uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  if lawsuit.status <> 'filed' then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  if target_kind is null or target_kind not in ('virtual', 'presencial') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if target_starts_on is null or target_starts_on < (now() at time zone 'America/Sao_Paulo')::date - 1
     or target_starts_on > date '2100-12-31' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'starts_on');
  end if;
  if exists (select 1 from public.judgment_sessions s
             where s.proceeding_id = lawsuit.id and s.status = 'scheduled' and s.starts_on = target_starts_on) then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;
  insert into public.judgment_sessions (org_id, case_id, proceeding_id, kind, starts_on, starts_at, source, created_by)
  values (lawsuit.org_id, lawsuit.case_id, lawsuit.id, target_kind, target_starts_on, target_starts_at, 'person', auth.uid())
  returning id into made;
  perform public.record_case_event(current_case.org_id, current_case.id, 'judgment_session_recorded', 'person',
    jsonb_build_object('session', made, 'proceeding', lawsuit.id));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'judgment_session.recorded', 'judgment_session', made::text,
          jsonb_build_object('kind', target_kind, 'starts_on', target_starts_on));
  return jsonb_build_object('ok', true, 'code', 'recorded', 'id', made);
end;
$$;

revoke all on function public.record_judgment_session(uuid, text, date, time) from public, anon;
grant execute on function public.record_judgment_session(uuid, text, date, time) to authenticated;

/** A person takes a session off the agenda, saying why (it was withdrawn from the pauta, ONE read it wrong). */
create or replace function public.withdraw_judgment_session(target_session uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.judgment_sessions%rowtype;
  current_case public.cases%rowtype;
  reason text := nullif(btrim(regexp_replace(coalesce(target_reason, ''), '\s+', ' ', 'g')), '');
begin
  select * into session from public.judgment_sessions where id = target_session;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(session.case_id);
  if reason is null or char_length(reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  update public.judgment_sessions set status = 'withdrawn', withdraw_reason = reason
  where id = session.id and status = 'scheduled';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'judgment_session_withdrawn', 'person',
    jsonb_build_object('session', session.id));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'judgment_session.withdrawn', 'judgment_session', session.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'withdrawn');
end;
$$;

revoke all on function public.withdraw_judgment_session(uuid, text) from public, anon;
grant execute on function public.withdraw_judgment_session(uuid, text) to authenticated;

/**
 * A partner or a lawyer says whether the firm registered to argue at a session (in the court's system, with their
 * own login) or will not argue; null takes the word back. Never a support visit; on the record.
 */
create or replace function public.decide_oral_argument(target_session uuid, target_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.judgment_sessions%rowtype;
  current_case public.cases%rowtype;
begin
  select * into session from public.judgment_sessions where id = target_session;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(session.case_id);
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_choice is not null and target_choice not in ('registered', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'choice');
  end if;
  if session.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  update public.judgment_sessions
  set oral_choice = target_choice, oral_by = case when target_choice is null then null else auth.uid() end,
      oral_at = case when target_choice is null then null else now() end
  where id = session.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'oral_argument_decided', 'person',
    jsonb_build_object('session', session.id, 'choice', target_choice));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'judgment_session.oral_decided', 'judgment_session', session.id::text,
          jsonb_build_object('choice', target_choice));
  return jsonb_build_object('ok', true, 'code', 'decided');
end;
$$;

revoke all on function public.decide_oral_argument(uuid, text) from public, anon;
grant execute on function public.decide_oral_argument(uuid, text) to authenticated;

/** The sessions of a case's lawsuits, the latest first, with their limit and the firm's word, for the case screen. */
create or replace function public.case_judgment_sessions(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  return jsonb_build_object('ok', true, 'sessions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'proceeding_id', s.proceeding_id, 'kind', s.kind, 'starts_on', s.starts_on, 'starts_at', s.starts_at,
      'status', s.status, 'withdraw_reason', s.withdraw_reason, 'source', s.source, 'publication_id', s.publication_id,
      'counted', s.limit_revision = s.revision, 'limit_on', s.limit_on, 'limit_hour', s.limit_hour,
      'limit_basis', s.limit_basis, 'limit_passed', s.limit_passed, 'limit_error', s.limit_error,
      'oral_choice', s.oral_choice, 'oral_by', pr.display_name, 'oral_at', s.oral_at
    ) order by s.starts_on desc, s.created_at desc)
    from public.judgment_sessions s
    left join public.profiles pr on pr.id = s.oral_by
    where s.case_id = current_case.id
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.case_judgment_sessions(uuid) from public, anon;
grant execute on function public.case_judgment_sessions(uuid) to authenticated;

-- ---------- The backend counts the limit ----------

/**
 * The sessions whose limit to register is to be counted (service role): scheduled, of a revision not counted yet,
 * not past, each with its lawsuit's place and its court's rule (none when the court has none: said so).
 */
create or replace function public.sessions_to_count(target_limit integer default 20)
returns table (
  session_id uuid,
  revision integer,
  kind text,
  starts_on date,
  starts_at time,
  court text,
  proceeding_kind text,
  system text,
  comarca text,
  until_kind text,
  until_hour time,
  basis text
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
  select s.id, s.revision, s.kind, s.starts_on, s.starts_at, p.court, p.kind, p.system, p.comarca,
         r.until_kind, r.until_hour, r.basis
  from public.judgment_sessions s
  join public.proceedings p on p.id = s.proceeding_id
  left join public.oral_argument_rules r
    on r.court = p.court and r.session_kind = s.kind
   and r.body = case p.kind when 'juizado' then 'turma_recursal' else 'tribunal' end
  where s.status = 'scheduled' and s.limit_revision is distinct from s.revision
    and s.starts_on >= (now() at time zone 'America/Sao_Paulo')::date - 1
  order by s.starts_on, s.id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.sessions_to_count(integer) from public, anon, authenticated;
grant execute on function public.sessions_to_count(integer) to service_role;

/**
 * What the count of a session's limit came to (service role), for the revision it read: the day, the hour, the act
 * that says it and the days it passed, or why it could not be counted (`no_rule`, `no_calendar`, a code of the rule).
 * A revision changed meanwhile is left to its own count.
 */
create or replace function public.record_session_limit(target_session uuid, target_revision integer, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  error_code text := nullif(payload ->> 'error', '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if error_code is null and (
    coalesce(payload ->> 'on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (payload ->> 'hour' is not null and payload ->> 'hour' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    or coalesce(payload ->> 'rule', '') !~ '^sustentacao-v[0-9]{1,3}$'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if error_code is not null and error_code !~ '^[a-z][a-z0-9_]{1,59}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  update public.judgment_sessions
  set limit_revision = target_revision,
      limit_on = case when error_code is null then (payload ->> 'on')::date end,
      limit_hour = case when error_code is null then (payload ->> 'hour')::time end,
      limit_basis = case when error_code is null then left(payload ->> 'basis', 300) end,
      limit_passed = case when error_code is null and jsonb_typeof(payload -> 'passed') = 'array'
                          then payload -> 'passed' end,
      limit_rule = case when error_code is null then payload ->> 'rule' end,
      limit_error = error_code,
      limit_at = now()
  where id = target_session and revision = target_revision and status = 'scheduled';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'changed');
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_session_limit(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_session_limit(uuid, integer, jsonb) to service_role;

-- ---------- The agenda hands them out ----------

/** Who a session is of on the agenda: the lawsuit's lawyers of the firm, else the case's responsible. Internal. */
create or replace function public.agenda_session_people(target_session uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with s as (select * from public.judgment_sessions where id = target_session),
  members as (select m.user_id from public.memberships m join s on s.org_id = m.org_id),
  lawyers as (
    select array_agg(distinct l.user_id order by l.user_id) as ids
    from public.proceeding_lawyers l join s on s.proceeding_id = l.proceeding_id
    where l.user_id in (select user_id from members)
  ),
  responsible as (
    select array_agg(c.responsible_id) as ids from s join public.cases c on c.id = s.case_id
    where c.responsible_id in (select user_id from members)
  )
  select coalesce((select ids from lawyers), (select ids from responsible), '{}'::uuid[]);
$$;

revoke all on function public.agenda_session_people(uuid) from public, anon, authenticated;

/** What the agenda of a span holds (0132, redefined): the sessions of judgment and their limits to register too. */
create or replace function public.agenda_items(target_org uuid, from_day date, to_day date, target_module text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'deadlines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'act', d.act, 'act_name', a.name, 'title', d.title, 'status', d.status, 'due_on', d.due_on,
        'starts_on', d.starts_on, 'explanation', d.explanation, 'case_id', d.case_id, 'case_seq', c.seq,
        'is_test', coalesce(c.is_test, false), 'cnj', d.cnj, 'court', d.court,
        'changed_at', greatest(d.created_at, d.computed_at, d.confirmed_at),
        'people', public.agenda_deadline_people(d.id)
      ) order by d.due_on, d.id)
      from public.deadlines d
      left join public.deadline_acts a on a.slug = d.act
      left join public.cases c on c.id = d.case_id
      where d.org_id = target_org and d.status in ('proposed', 'confirmed') and d.due_on is not null
        and d.due_on between from_day and to_day + 31
        and (target_module is null or c.module = target_module)
    ), '[]'::jsonb),
    'hearings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'kind', h.kind, 'mode', h.mode, 'status', h.status, 'starts_at', h.starts_at,
        'time_zone', h.time_zone, 'case_id', h.case_id, 'case_seq', c.seq, 'is_test', coalesce(c.is_test, false),
        'cnj', p.cnj, 'court', p.court, 'attendee_user_id', h.attendee_user_id,
        'changed_at', h.updated_at, 'people', public.agenda_hearing_people(h.id)
      ) order by h.starts_at, h.id)
      from public.hearings h
      join public.cases c on c.id = h.case_id
      join public.proceedings p on p.id = h.proceeding_id
      where h.org_id = target_org
        and h.starts_at >= (from_day::timestamp at time zone 'America/Sao_Paulo') - interval '1 day'
        and h.starts_at < ((to_day + 1)::timestamp at time zone 'America/Sao_Paulo') + interval '1 day'
        and (target_module is null or c.module = target_module)
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'starts_on', s.starts_on, 'starts_at', s.starts_at,
        'limit_on', case when s.limit_revision = s.revision then s.limit_on end,
        'limit_hour', case when s.limit_revision = s.revision then s.limit_hour end,
        'oral_choice', s.oral_choice, 'case_id', s.case_id, 'case_seq', c.seq,
        'is_test', coalesce(c.is_test, false), 'cnj', p.cnj, 'court', p.court, 'changed_at', s.updated_at,
        'people', public.agenda_session_people(s.id)
      ) order by s.starts_on, s.id)
      from public.judgment_sessions s
      join public.cases c on c.id = s.case_id
      join public.proceedings p on p.id = s.proceeding_id
      where s.org_id = target_org and s.status = 'scheduled'
        and (s.starts_on between from_day and to_day
             or (s.limit_revision = s.revision and s.limit_on between from_day and to_day))
        and (target_module is null or c.module = target_module)
    ), '[]'::jsonb),
    'duration_minutes', greatest(public.hearings_setting('duration_minutes', 60), 1)
  );
$$;

revoke all on function public.agenda_items(uuid, date, date, text) from public, anon, authenticated;

-- ---------- The case follows them by itself ----------

/** What the case screen follows to read itself again (0182, redefined): the sessions of judgment too (0219). */
create or replace function public.case_pulse(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  stamp text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  select * into advance from public.case_advances where case_id = target_case;

  select md5(concat_ws('|',
    current_case::text,
    (select concat(count(*), '/', max(e.at)) from public.case_events e where e.case_id = target_case),
    (select concat(a.waiting, '/', a.checked_at, '/', a.waiting_since, '/', a.claimed_at, '/', a.woken_at, '/', a.after)
       from public.case_advances a where a.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_parties t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.people t
       where t.id in (select cp.person_id from public.case_parties cp where cp.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_segments t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_documents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_statements t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interviews t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interview_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_links t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_consents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.signature_envelopes t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_papers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.civil_court_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.residence_declarations t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.free_justice_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.piece_fact_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_document_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceedings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_parties t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_lawyers t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceeding_tracking t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_drafts t where t.case_id = target_case),
    (select concat(count(*), '/', max(v.created_at)) from public.case_draft_versions v
       where v.draft_id in (select d.id from public.case_drafts d where d.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.filing_packages t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.dossiers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.deadlines t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.hearings t where t.case_id = target_case),
    -- The sessions of judgment and the limit the backend counts of each (0219).
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.judgment_sessions t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_notices t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.admin_complaints t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.lawsuit_facts t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_costs t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ','), '')) from public.case_fees t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.money_shares t where t.case_id = target_case),
    -- Of a publication, only what a member reads of it: never the AI's word in the shadow.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.category, t.triaged_at, t.active, t.cancel_seen_at,
        t.review_due, t.judgment, t.judgment_source, t.ack_owed, t.acked_at), ';' order by t.id), ''))
       from public.publications t where t.case_id = target_case),
    (select md5(coalesce(string_agg(concat_ws(',', r.publication_id, r.kind, r.status, r.reason, r.updated_at), ';'
        order by r.publication_id, r.kind), ''))
       from public.publication_readings r
       where r.publication_id in (select p.id from public.publications p where p.case_id = target_case))
  )) into stamp;

  return jsonb_build_object(
    'stamp', stamp,
    'advance', jsonb_build_object(
      'running', coalesce(advance.claimed_at is not null and advance.claimed_at > now() - make_interval(mins => stale), false),
      'due', coalesce(advance.woken_at is not null
        and (advance.checked_at is null or advance.woken_at > advance.checked_at)
        and (advance.after is null or advance.after <= now()), false),
      'waiting_since', advance.waiting_since,
      'checked_at', advance.checked_at
    )
  );
end;
$$;

revoke all on function public.case_pulse(uuid) from public, anon;
grant execute on function public.case_pulse(uuid) to authenticated;
