-- ============================================================
-- 0072_agency_retention: how long an agency's passengers are kept, and their rights over what is kept.
--
-- Fifth phase of the plan the owner approved on 2026-10-29.
--
--   Retention. What an agency keeps of a passenger who never became the
--   firm's client is forgotten by itself (`pax_retention_sweep`, daily): the
--   setting's 30 days after their last trip ended with no problem, 180 days
--   after one whose problem did not become a case (told and not answered, or
--   answered no), 30 days after the partnership ended, and the agency's copy
--   of a passenger who went to the firm 30 days after that (the firm keeps
--   the client's own record). A passenger with no trip is forgotten 30 days
--   after the agency last changed them.
--
--   The passenger's rights, on the agency's link: what is kept of them, as a
--   file (`pax_link_export`), and the deletion of it, the children they answer
--   for included (`pax_link_forget`). The agency answers the same on request
--   (`pax_export_traveler`, `pax_forget_traveler`).
--
--   Forgetting a passenger (`pax_forget`) deletes the record, the answers, the
--   links, the trips they hold and the documents the agency still holds; a
--   trip ONE was following is followed no more, and is deleted unless its
--   case opened (then it is the firm's). The bytes of the files go after their
--   records, through the backend's own list (`pax_file_removals`). Nothing of
--   the person stays in the audit trail: the reason and the counts only.
--
--   A partnership that ends stops the trips ONE followed for it and closes
--   the links the agency sent.
--
--   The flights ONE follows are read within a ceiling per firm besides the
--   platform's (the setting's `watch_firm_daily_reads`), so one firm's
--   agency never spends every read of the day; the operator reads each
--   firm's reads of the day, and each partnership in counts, the people of
--   an agency with their partnership and no longer among the accounts that
--   belong to no firm.
-- ============================================================

-- ---------- Settings ----------

update public.platform_settings
set value = value || jsonb_build_object(
  -- Days a passenger who never became the firm's client is kept after their last trip ended: with no problem, and
  -- with a problem that did not become a case.
  'retention_days_quiet', 30,
  'retention_days_problem', 180,
  -- How many passengers one sweep forgets at most.
  'retention_batch', 200
)
where key = 'partners' and not (value ? 'retention_days_quiet');

update public.platform_settings
set value = value || jsonb_build_object(
  -- The most legs the trips of one firm are read at FlightAware in a day of Brasília, within the platform's.
  'watch_firm_daily_reads', 150
)
where key = 'flight_alerts' and not (value ? 'watch_firm_daily_reads');

-- ---------- The bytes to remove ----------

/** The storage paths of files whose records were forgotten: the backend removes their bytes, then the row. */
create table public.pax_file_removals (
  storage_path text primary key,
  created_at timestamptz not null default now(),
  constraint pax_file_removals_path_check check (storage_path ~ '^org/[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}$')
);

alter table public.pax_file_removals enable row level security;

-- ---------- Forgetting a passenger ----------

/**
 * Forgets a passenger of an agency (see the header): answers how many documents' files were forgotten. A document
 * the firm received (handed over) keeps its file, which is the firm's. Internal.
 */
create or replace function public.pax_forget(target_traveler uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  removed integer := 0;
  trips integer := 0;
begin
  select * into traveler from public.pax_travelers where id = target_traveler for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- The files the agency still holds: their records first, their bytes for the backend.
  with gone as (
    delete from public.files f
    using public.pax_documents d
    where d.traveler_id = traveler.id and d.file_id = f.id and d.case_document_id is null and f.partner_id is not null
    returning f.storage_path
  ), listed as (
    insert into public.pax_file_removals (storage_path)
    select storage_path from gone
    on conflict (storage_path) do nothing
    returning 1
  )
  select count(*) into removed from gone;
  -- The trips they hold: followed no more, and deleted unless a case opened from them.
  delete from public.tracked_trips t
  using public.pax_trips p
  where p.holder_id = traveler.id and t.pax_trip_id = p.id and t.status <> 'case_opened';
  delete from public.pax_trips p where p.holder_id = traveler.id;
  get diagnostics trips = row_count;
  -- A trip of somebody else they travelled on is the holder's: ONE follows it as it is now.
  delete from public.pax_trip_travelers tt where tt.traveler_id = traveler.id;
  perform public.pax_sync_tracked_trip(p.id)
  from public.pax_trips p
  where p.partnership_id = traveler.partnership_id
    and exists (select 1 from public.tracked_trips t where t.pax_trip_id = p.id and t.status = 'watching');
  delete from public.pax_travelers where id = traveler.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.traveler.forgotten', 'partner', traveler.partner_id::text,
          jsonb_build_object('reason', target_reason, 'files', removed, 'trips', trips,
                             'handed_over', traveler.handed_over_at is not null));
  return jsonb_build_object('ok', true, 'code', 'forgotten', 'files', removed);
end;
$$;

revoke all on function public.pax_forget(uuid, text) from public, anon, authenticated;

/**
 * What is kept of a passenger, as the passenger or the agency takes it away (their right of access): the record,
 * the trips they are on with their legs and what ONE does of each, their answers with the words they agreed to,
 * and their documents (what each is, never the file). Internal.
 */
create or replace function public.pax_kept_of(target_traveler uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pessoa', jsonb_strip_nulls(jsonb_build_object(
      'nome', t.full_name, 'cpf', t.cpf, 'data_nascimento', t.birth_date, 'whatsapp', t.phone, 'email', t.email,
      'nacionalidade', t.nationality, 'cep', t.postal_code, 'logradouro', t.street, 'numero', t.address_number,
      'complemento', t.complement, 'bairro', t.district, 'cidade', t.city, 'uf', t.uf,
      'responsavel', (select g.full_name from public.pax_travelers g where g.id = t.guardian_id),
      'cadastrado_em', t.created_at, 'repassado_ao_escritorio_em', t.handed_over_at
    )),
    'agencia', (select p.name from public.partners p where p.id = t.partner_id),
    'escritorio', (select o.name from public.organizations o where o.id = t.org_id),
    'viagens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'localizador', trip.locator,
               'titular', (select h.full_name from public.pax_travelers h where h.id = trip.holder_id),
               'acompanhamento', public.pax_trip_state(trip.id),
               'trechos', (select coalesce(jsonb_agg(jsonb_build_object(
                             'voo', l.flight_number, 'origem', l.origin_iata, 'destino', l.destination_iata,
                             'partida', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
                             'chegada', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI')
                           ) order by l.position), '[]'::jsonb)
                           from public.pax_trip_legs l where l.trip_id = trip.id)
             ) order by trip.created_at)
      from public.pax_trips trip
      where trip.id in (select tt.trip_id from public.pax_trip_travelers tt where tt.traveler_id = t.id)), '[]'::jsonb),
    'respostas', coalesce((
      select jsonb_agg(jsonb_build_object('resposta', c.answer, 'em', c.created_at, 'texto', c.wording) order by c.created_at)
      from public.pax_consents c where c.traveler_id = t.id), '[]'::jsonb),
    'documentos', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', d.kind, 'arquivo', f.name, 'enviado_em', d.created_at,
                                          'enviado_por', case d.source when 'passenger' then 'passageiro' else 'agencia' end)
                       order by d.created_at)
      from public.pax_documents d join public.files f on f.id = d.file_id
      where d.traveler_id = t.id and d.reading <> 'uploading'), '[]'::jsonb)
  )
  from public.pax_travelers t
  where t.id = target_traveler;
$$;

revoke all on function public.pax_kept_of(uuid) from public, anon, authenticated;

/** The agency hands a passenger what it keeps of them, on their request. Audited, never a support visit. */
create or replace function public.pax_export_traveler(target_traveler uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into traveler from public.pax_travelers where id = target_traveler;
  if not found or not public.is_partner_member(traveler.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.traveler.exported', 'pax_traveler', traveler.id::text,
          jsonb_build_object('partner', traveler.partner_id));
  return jsonb_build_object('ok', true, 'code', 'exported', 'data', public.pax_kept_of(traveler.id));
end;
$$;

revoke all on function public.pax_export_traveler(uuid) from public, anon;
grant execute on function public.pax_export_traveler(uuid) to authenticated;

/**
 * The agency forgets a passenger, on their request or because it no longer covers them: the record and everything
 * of it (`pax_forget`). Who manages the agency, with the second factor, never a support visit.
 */
create or replace function public.pax_forget_traveler(target_traveler uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into traveler from public.pax_travelers where id = target_traveler;
  if not found or not public.has_partner_role(traveler.partner_id, array['owner', 'admin']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  return public.pax_forget(traveler.id, 'agency');
end;
$$;

revoke all on function public.pax_forget_traveler(uuid) from public, anon;
grant execute on function public.pax_forget_traveler(uuid) to authenticated;

/** What the passenger's link hands them of what is kept: theirs and the children's they answer for. By the token. */
create or replace function public.pax_link_export(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype := public.pax_link_by_token(target_token);
begin
  if link.id is null or link.ended_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  return jsonb_build_object('ok', true, 'code', 'exported', 'data', coalesce((
    select jsonb_agg(public.pax_kept_of(p.id) order by (p.id = link.holder_id) desc)
    from public.pax_link_people(link.holder_id) p), '[]'::jsonb));
end;
$$;

revoke all on function public.pax_link_export(text) from public;
grant execute on function public.pax_link_export(text) to anon, authenticated;

/**
 * The passenger asks, on their link, that what is kept of them and of the children they answer for be deleted:
 * each forgotten (`pax_forget`), with what the server saw of the request on the record (never a personal datum).
 * The backend calls it after reading the token from the request. Service role.
 */
create or replace function public.pax_link_forget(target_token text, target_evidence jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype := public.pax_link_by_token(target_token);
  person uuid;
  forgotten integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if link.id is null or link.ended_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  -- The children first: once their adult is gone, nothing would say they are theirs.
  for person in
    select p.id from public.pax_link_people(link.holder_id) p order by (p.id = link.holder_id)
  loop
    perform public.pax_forget(person, 'passenger_request');
    forgotten := forgotten + 1;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'pax.link.forgotten', 'partner', link.partner_id::text,
          jsonb_build_object('people', forgotten,
                             'evidence', case when jsonb_typeof(target_evidence) = 'object'
                                                   and octet_length(target_evidence::text) <= 600
                                              then target_evidence else '{}'::jsonb end));
  return jsonb_build_object('ok', true, 'code', 'forgotten', 'people', forgotten);
end;
$$;

revoke all on function public.pax_link_forget(text, jsonb) from public, anon, authenticated;

-- ---------- Retention ----------

/**
 * Forgets, a batch at a time, the passengers the setting keeps no longer (see the header). Answers how many.
 * Service role.
 */
create or replace function public.pax_retention_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quiet integer := greatest(public.partner_setting('retention_days_quiet', 30), 1);
  problem integer := greatest(public.partner_setting('retention_days_problem', 180), 1);
  batch integer := least(greatest(public.partner_setting('retention_batch', 200), 1), 1000);
  due record;
  forgotten integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for due in
    select x.id, x.reason from (
      select t.id,
        case
          when l.status = 'ended' and l.ended_at < now() - make_interval(days => quiet) then 'partnership_ended'
          when t.handed_over_at is not null and t.handed_over_at < now() - make_interval(days => quiet) then 'handed_over'
          when t.handed_over_at is null and greatest(
                 t.updated_at,
                 coalesce((select max(leg.scheduled_arrival_local) at time zone 'America/Sao_Paulo'
                           from public.pax_trip_travelers tt join public.pax_trip_legs leg on leg.trip_id = tt.trip_id
                           where tt.traveler_id = t.id), t.updated_at)
               ) < now() - make_interval(days => case when exists (
                   select 1 from public.pax_trip_travelers tt
                   join public.tracked_trips tr on tr.pax_trip_id = tt.trip_id
                   where tt.traveler_id = t.id and tr.status in ('alerted', 'declined')
                 ) then problem else quiet end)
               then 'retention'
        end as reason
      from public.pax_travelers t
      join public.partner_links l on l.id = t.partnership_id
    ) x
    where x.reason is not null
    order by x.id
    limit batch
  loop
    -- A child whose adult was forgotten in this sweep may be gone with them already.
    if exists (select 1 from public.pax_travelers t where t.id = due.id) then
      perform public.pax_forget(due.id, due.reason);
      forgotten := forgotten + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'forgotten', forgotten);
end;
$$;

revoke all on function public.pax_retention_sweep() from public, anon, authenticated;

/** The bytes the backend owes removing, a few at a time. Service role. */
create or replace function public.pax_file_removals_due(target_limit integer default 100)
returns table (storage_path text)
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
  select r.storage_path from public.pax_file_removals r
  order by r.created_at, r.storage_path
  limit least(greatest(coalesce(target_limit, 100), 1), 1000);
end;
$$;

revoke all on function public.pax_file_removals_due(integer) from public, anon, authenticated;

/** The backend removed these bytes: their rows go. Service role. */
create or replace function public.pax_file_removals_done(target_paths text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  done integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.pax_file_removals r where r.storage_path = any (coalesce(target_paths, '{}'));
  get diagnostics done = row_count;
  return done;
end;
$$;

revoke all on function public.pax_file_removals_done(text[]) from public, anon, authenticated;

-- ---------- A partnership that ends ----------

/** The trips ONE followed for an agency are followed no more once its partnership ends, and its links close. */
create or replace function public.partner_links_ended_stop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tracked_trips t set status = 'stopped'
  from public.pax_trips p
  where p.partnership_id = new.id and t.pax_trip_id = p.id and t.status in ('watching', 'alerted');
  update public.pax_confirm_links set ended_at = now() where partnership_id = new.id and ended_at is null;
  return new;
end;
$$;

revoke all on function public.partner_links_ended_stop() from public, anon, authenticated;

create trigger partner_links_ended_stop after update of status on public.partner_links
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function public.partner_links_ended_stop();

-- ---------- Each firm's share of the flight reads ----------

/**
 * 0051, redefined: the trips due a reading at FlightAware, within the platform's ceiling of the day and, besides,
 * each firm's (`watch_firm_daily_reads`): a firm that spent its share waits for the next day, and the others go on.
 * Service role.
 */
create or replace function public.claim_trip_watch(target_limit integer default 10, target_trip uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  every integer := greatest(public.flight_alerts_setting('watch_minutes', 20), 1);
  stale integer := greatest(public.flight_alerts_setting('watch_stale_minutes', 10), 1);
  before_hours integer := greatest(public.flight_alerts_setting('watch_before_hours', 6), 0);
  after_hours integer := greatest(public.flight_alerts_setting('watch_after_hours', 12), 0);
  ceiling integer := greatest(public.flight_alerts_setting('watch_daily_reads', 400), 0);
  firm_ceiling integer := greatest(public.flight_alerts_setting('watch_firm_daily_reads', 150), 0);
  used integer;
  firm_used jsonb;
  candidate public.tracked_trips%rowtype;
  legs integer;
  of_firm integer;
  claim_number integer;
  claimed jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select coalesce(sum(t.watch_reads), 0) into used from public.tracked_trips t where t.watch_day = today;
  select coalesce(jsonb_object_agg(x.org_id, x.reads), '{}'::jsonb) into firm_used
  from (select t.org_id, sum(t.watch_reads) as reads from public.tracked_trips t
        where t.watch_day = today group by t.org_id) x;
  for candidate in
    select t.* from public.tracked_trips t
    where t.watch = 'flightaware' and t.status in ('watching', 'alerted')
      and (target_trip is null or t.id = target_trip)
      and (t.watch_claimed_at is null or t.watch_claimed_at < now() - make_interval(mins => stale))
      and (target_trip is not null or t.watched_at is null or t.watched_at < now() - make_interval(mins => every))
      and exists (select 1 from public.tracked_legs l where l.trip_id = t.id)
      and now() >= (select min(l.scheduled_departure_local) from public.tracked_legs l where l.trip_id = t.id)
                     at time zone 'America/Sao_Paulo' - make_interval(hours => before_hours)
      and now() <= (select max(l.scheduled_arrival_local) from public.tracked_legs l where l.trip_id = t.id)
                     at time zone 'America/Sao_Paulo' + make_interval(hours => after_hours)
    order by t.watched_at nulls first, t.id
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
  loop
    select count(*) into legs from public.tracked_legs l where l.trip_id = candidate.id;
    exit when used + legs > ceiling;
    of_firm := coalesce((firm_used ->> candidate.org_id::text)::integer, 0);
    -- This firm spent its share of the day: the next trip may be another firm's.
    continue when of_firm + legs > firm_ceiling;
    update public.tracked_trips t set
      watch_claimed_at = clock_timestamp(),
      watch_claims = t.watch_claims + 1,
      watch_reads = case when t.watch_day = today then t.watch_reads + legs else legs end,
      watch_day = today
    where t.id = candidate.id
      and (t.watch_claimed_at is null or t.watch_claimed_at < now() - make_interval(mins => stale))
    returning t.watch_claims into claim_number;
    if claim_number is not null then
      used := used + legs;
      firm_used := firm_used || jsonb_build_object(candidate.org_id::text, of_firm + legs);
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'trip_id', candidate.id, 'claim', claim_number, 'org_id', candidate.org_id,
        'legs', public.trip_legs(candidate.id)));
    end if;
    claim_number := null;
  end loop;
  return claimed;
end;
$$;

revoke all on function public.claim_trip_watch(integer, uuid) from public, anon, authenticated;

/** 0051, redefined: the operator's word on the flights ONE follows, with each firm's reads of the day. */
create or replace function public.admin_flight_watch_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  settings jsonb := coalesce((select ps.value from public.platform_settings ps where ps.key = 'flight_alerts'), '{}'::jsonb);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'released', coalesce((settings ->> 'released')::boolean, false),
    'released_at', settings ->> 'released_at',
    'released_by', (select coalesce(p.display_name, '') from public.profiles p where p.id::text = settings ->> 'released_by'),
    'released_note', settings ->> 'released_note',
    'reads_today', (select coalesce(sum(t.watch_reads), 0) from public.tracked_trips t where t.watch_day = today),
    'daily_reads', public.flight_alerts_setting('watch_daily_reads', 400),
    'firm_daily_reads', public.flight_alerts_setting('watch_firm_daily_reads', 150),
    'firms_today', coalesce((
      select jsonb_agg(jsonb_build_object('firm', x.name, 'reads', x.reads) order by x.reads desc, x.name)
      from (
        select o.name, sum(t.watch_reads)::integer as reads
        from public.tracked_trips t join public.organizations o on o.id = t.org_id
        where t.watch_day = today and t.watch_reads > 0
        group by o.name
        order by sum(t.watch_reads) desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'following_real', (select count(*) from public.tracked_trips t
                       where t.watch = 'flightaware' and not t.is_test and t.status in ('watching', 'alerted')),
    'following_test', (select count(*) from public.tracked_trips t
                       where t.watch = 'flightaware' and t.is_test and t.status in ('watching', 'alerted')),
    'held_alerts', (select count(*) from public.flight_alerts a where a.status = 'skipped' and a.reason = 'not_released')
  );
end;
$$;

revoke all on function public.admin_flight_watch_status() from public, anon;
grant execute on function public.admin_flight_watch_status() to authenticated;

-- ---------- What the operator reads of the partnerships ----------

/**
 * Each partnership of an agency with a firm, for the operator: whose, since when, and counts only (passengers,
 * trips followed, passengers who went to the firm, documents the agency holds, passengers the retention forgets at
 * its next sweep). Never a passenger.
 */
create or replace function public.admin_partner_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'link_id', l.id, 'agency', p.name, 'firm', o.name, 'module', l.module_key, 'status', l.status,
             'started_at', l.started_at, 'ended_at', l.ended_at,
             'members', (select count(*) from public.partner_members m where m.partner_id = l.partner_id),
             'travelers', (select count(*) from public.pax_travelers t where t.partnership_id = l.id),
             'handed_over', (select count(*) from public.pax_travelers t
                             where t.partnership_id = l.id and t.handed_over_at is not null),
             'watched', (select count(*) from public.pax_trips trip
                         join public.tracked_trips tr on tr.pax_trip_id = trip.id
                         where trip.partnership_id = l.id and tr.status in ('watching', 'alerted')),
             'documents', (select count(*) from public.pax_documents d
                           join public.pax_travelers t on t.id = d.traveler_id
                           where t.partnership_id = l.id and d.case_document_id is null and d.reading <> 'uploading')
           ) order by (l.status = 'active') desc, l.started_at desc)
    from public.partner_links l
    join public.partners p on p.id = l.partner_id
    join public.organizations o on o.id = l.org_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_partner_overview() from public, anon;
grant execute on function public.admin_partner_overview() to authenticated;

/**
 * 0012, redefined: the accounts that belong to no firm, leaving out the people of an agency (0069), whom the
 * operator reads with their partnership (`admin_partner_overview`): they are not waiting to found a firm.
 */
create or replace function public.admin_people_without_firm()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with person as (
    select
      p.id as user_id,
      p.display_name,
      p.is_superadmin,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until,
      nullif(btrim(coalesce(u.raw_app_meta_data ->> 'provider', '')), '') as auth_provider,
      (
        select count(*) from public.firm_invitations i
        where i.email = lower(u.email)::extensions.citext
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      ) as open_invitations
    from public.profiles p
    join auth.users u on u.id = p.id
    where not exists (select 1 from public.memberships m where m.user_id = p.id)
      and not exists (select 1 from public.partner_members pm where pm.user_id = p.id)
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'people', count(*),
      'neverSignedIn', count(*) filter (where last_sign_in_at is null),
      'invited', count(*) filter (where open_invitations > 0)
    ),
    'people', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'userId', user_id,
          'name', display_name,
          'email', email,
          'createdAt', created_at,
          'lastSignInAt', last_sign_in_at,
          'confirmed', email_confirmed_at is not null,
          'bannedUntil', banned_until,
          'isSuperadmin', coalesce(is_superadmin, false),
          'authProvider', auth_provider,
          'openInvitations', open_invitations
        )
        order by created_at desc
      ),
      '[]'::jsonb
    )
  )
  into result
  from person;

  return result;
end;
$$;

revoke all on function public.admin_people_without_firm() from public, anon;
grant execute on function public.admin_people_without_firm() to authenticated;
