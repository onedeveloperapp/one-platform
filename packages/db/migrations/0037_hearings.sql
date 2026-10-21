-- ============================================================
-- 0037_hearings: the hearings of the firm's lawsuits, and the firm's
-- calendar of them in a Google account somebody of the firm connected.
--
--   courts.time_zone   the zone a court's hours are said in: a hearing at 10h
--                      in Manaus is at 10h of Manaus, not of Brasília; and
--   courts.other_zones the zones some of its comarcas keep besides;
--   hearings           a hearing of a lawsuit the court has: its kind, when
--                      (the moment, read back in its zone), how (in person,
--                      by videoconference, or both, with the place or the
--                      link), who attends (somebody of the firm, or a name
--                      from outside it), where it came from (a person, or
--                      the publication that set it), and what came of it
--                      (held, cancelled with why);
--   firm_calendars     the firm's calendar of hearings in the Google account
--                      a person connected (`@flyee/calendar`): its id there,
--                      and whether it still takes the hearings;
--   hearing_event_removals  the events of hearings that went with their
--                      lawsuit or case, which the backend still owes Google.
--
-- Who signs or runs the firm's deadlines writes a hearing. The backend
-- writes each to the firm's calendar, one revision at a time, claimed by a
-- number (as the deadlines' counts are), and takes out the event of a
-- cancelled one and of one that went; a calendar that stopped taking them by
-- itself (the grant ended, the calendar was deleted in Google, the connection
-- expired) is said to the firm, and nothing of it is retried until somebody
-- brings it back. Nothing of a hearing reaches Google for a firm that
-- connected no calendar.
-- ============================================================

insert into public.platform_settings (key, value, is_public) values
  ('hearings', jsonb_build_object(
    -- A hearing within this many days is said to be soon: the firm's home counts it.
    'soon_days', 7,
    -- How long an event of a hearing is in the calendar, and after how long a hearing with no word on it is
    -- said to wait for one.
    'duration_minutes', 60,
    -- The writing of an event to the calendar: a claim not finished for this long goes back to the line.
    'working_minutes', 10,
    -- How many times in a row it is tried before it waits for a person.
    'max_attempts', 5,
    -- After a passing failure, the wait before the next attempt, times the attempt.
    'retry_minutes', 10,
    -- Hearings this far in the past are history: a calendar connected now does not get them.
    'calendar_past_days', 60
  ), true)
on conflict (key) do nothing;

/** A setting of the hearings, or its default: also when what is written there is not a number. */
create or replace function public.hearings_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> setting ~ '^[0-9]{1,9}$' then (s.value ->> setting)::integer end
     from public.platform_settings s where s.key = 'hearings'),
    fallback
  );
$$;

revoke all on function public.hearings_setting(text, integer) from public, anon, authenticated;

-- ---------- The court's zone ----------

-- The legal time of Brazil (Decreto nº 2.784/1913 as Lei nº 12.876/2013 wrote it, with no summer time since
-- Decreto nº 9.772/2019): Acre and the west of Amazonas five hours behind Greenwich; the rest of Amazonas,
-- Roraima, Rondônia, Mato Grosso and Mato Grosso do Sul four; the other states three. A comarca of the west
-- of Amazonas is an hour behind its court's seat: its hearing is written in its own zone.
alter table public.courts add column time_zone text not null default 'America/Sao_Paulo';
alter table public.courts add constraint courts_time_zone_check check (time_zone ~ '^America/[A-Za-z_]{3,40}$');
update public.courts set time_zone = case uf
  when 'AC' then 'America/Rio_Branco'
  when 'AM' then 'America/Manaus'
  when 'RR' then 'America/Boa_Vista'
  when 'RO' then 'America/Porto_Velho'
  when 'MT' then 'America/Cuiaba'
  when 'MS' then 'America/Campo_Grande'
  else 'America/Sao_Paulo'
end;

-- A court whose territory keeps more than one legal time: the zones some of its comarcas are in besides its
-- seat's. The law draws the Acre time in Amazonas by a line from Tabatinga to Porto Acre and names no
-- municipality, and the lists of municipalities found disagree; Fernando de Noronha is two hours ahead of
-- Brasília in summer and winter alike. So no comarca is said to be in one zone or another: a hearing of such a
-- court is written in the zone a person says, never in one guessed.
alter table public.courts add column other_zones text[] not null default '{}';
alter table public.courts add constraint courts_other_zones_check check (
  cardinality(other_zones) <= 3
  and array_to_string(other_zones, ',') ~ '^(America/[A-Za-z_]{3,40}(,America/[A-Za-z_]{3,40})*)?$'
);
update public.courts set other_zones = case uf
  when 'AM' then array['America/Eirunepe']
  when 'PE' then array['America/Noronha']
end
where uf in ('AM', 'PE');

/** True for a zone a hearing in Brazil may be said in. */
create or replace function public.hearing_zone_ok(zone text)
returns boolean
language sql
stable
as $$
  select zone in ('America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Boa_Vista',
                  'America/Porto_Velho', 'America/Cuiaba', 'America/Campo_Grande', 'America/Eirunepe',
                  'America/Noronha')
    and exists (select 1 from pg_timezone_names t where t.name = zone);
$$;

revoke all on function public.hearing_zone_ok(text) from public, anon, authenticated;

-- ---------- The firm's calendar ----------

create table public.firm_calendars (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  connection_id uuid not null,
  -- The calendar's id in the account, and its name there.
  calendar_id text not null,
  name text not null,
  -- active  it takes the hearings;
  -- lost    it stopped by itself: `problem` says why (the grant ended, the calendar was deleted in Google, the
  --         connection expired), and the firm is told until somebody brings it back;
  -- off     a person cut the connection: nothing to tell. Kept so that connecting the same account again may
  --         take the same calendar.
  status text not null default 'active',
  problem text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, org_id) references public.connections (id, org_id) on delete cascade,
  constraint firm_calendars_id_check check (char_length(calendar_id) between 3 and 300),
  constraint firm_calendars_name_check check (char_length(btrim(name)) between 2 and 120),
  constraint firm_calendars_status_check check (status in ('active', 'lost', 'off')),
  constraint firm_calendars_problem_check check (
    (status = 'lost') = (problem is not null) and (problem is null or problem ~ '^[a-z][a-z0-9_]{1,59}$')
  )
);

alter table public.firm_calendars enable row level security;
create policy "firm_calendars_select_member" on public.firm_calendars
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_calendars to authenticated;

create trigger firm_calendars_updated_at before update on public.firm_calendars
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_firm_calendars after insert or update or delete on public.firm_calendars
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A connection cut by a person turns the calendar of hearings it held off, with nothing to tell; one that
 * expired by itself stops it, and the firm is told. Nothing is written with either.
 */
create or replace function public.connections_end_calendars()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('disconnected', 'expired') and old.status is distinct from new.status then
    update public.firm_calendars set
      status = case when new.status = 'disconnected' then 'off' else 'lost' end,
      problem = case when new.status = 'disconnected' then null else 'expired' end
    where connection_id = new.id and status <> 'off';
  end if;
  return null;
end;
$$;

revoke all on function public.connections_end_calendars() from public, anon, authenticated;

create trigger connections_end_calendars after update of status on public.connections
  for each row execute function public.connections_end_calendars();

-- ---------- The hearings ----------

create table public.hearings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  -- conciliacao  the attempt to settle;
  -- instrucao    instruction and judgment (the parties and their witnesses heard);
  -- una          both at once, as the small-claims courts often hold them;
  -- outra        another the court set.
  kind text not null,
  -- The moment it starts, and the zone it is said in: the court's, or one of a comarca of its own.
  starts_at timestamptz not null,
  time_zone text not null,
  -- presencial, videoconferencia, or hibrida; with the place, the link, or both.
  mode text not null,
  place text,
  link text,
  -- Who attends: somebody of the firm, or somebody from outside it (a correspondent).
  attendee_user_id uuid references public.profiles (id) on delete set null,
  attendee_name text,
  notes text,
  -- Where it came from: a person of the firm, or a publication of the DJEN the person read it in.
  source text not null default 'person',
  publication_id uuid,
  -- scheduled, held (with what came of it), cancelled (with why).
  status text not null default 'scheduled',
  outcome text,
  outcome_note text,
  -- Each change of what the calendar shows is a revision: the backend writes the event until it is of the one in force.
  revision integer not null default 1,
  synced_revision integer,
  synced_calendar text,
  synced_at timestamptz,
  sync_claimed_at timestamptz,
  sync_claims integer not null default 0,
  sync_attempts integer not null default 0,
  sync_retry_after timestamptz,
  sync_error text,
  created_by uuid references public.profiles (id) on delete set null,
  -- Registered by ONE from the publication it read, where the firm lets it (0040, `publication_hearing`).
  created_auto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (publication_id, org_id) references public.publications (id, org_id) on delete set null (publication_id),
  constraint hearings_kind_check check (kind in ('conciliacao', 'instrucao', 'una', 'outra')),
  constraint hearings_zone_check check (time_zone ~ '^America/[A-Za-z_]{3,40}$'),
  constraint hearings_mode_check check (mode in ('presencial', 'videoconferencia', 'hibrida')),
  constraint hearings_place_check check (place is null or (place = btrim(place) and char_length(place) between 2 and 300)),
  constraint hearings_link_check check (link is null or (link ~* '^https://[^[:space:]]+$' and char_length(link) <= 500)),
  constraint hearings_attendee_check check (
    attendee_name is null or (attendee_name = btrim(attendee_name) and char_length(attendee_name) between 2 and 120)
  ),
  constraint hearings_notes_check check (notes is null or char_length(notes) <= 1000),
  constraint hearings_source_check check (source in ('person', 'publication')),
  constraint hearings_status_check check (status in ('scheduled', 'held', 'cancelled')),
  constraint hearings_outcome_check check (
    (outcome is null or (status = 'held' and outcome in ('acordo', 'sem_acordo', 'outro')))
    and (status <> 'cancelled' or char_length(coalesce(outcome_note, '')) between 8 and 1000)
    and coalesce(char_length(outcome_note), 0) <= 1000
  ),
  constraint hearings_revision_check check (revision >= 1 and (synced_revision is null or synced_revision between 1 and revision)),
  constraint hearings_sync_error_check check (sync_error is null or sync_error ~ '^[a-z][a-z0-9_]{1,59}$')
);

-- One hearing of a lawsuit at a moment: the same one written twice (from its case and from the publication) is one.
create unique index hearings_moment_idx on public.hearings (proceeding_id, starts_at) where status = 'scheduled';
create index hearings_firm_idx on public.hearings (org_id, starts_at);
create index hearings_case_idx on public.hearings (case_id, starts_at);
create index hearings_publication_idx on public.hearings (publication_id) where publication_id is not null;
create index hearings_sync_idx on public.hearings (updated_at)
  where synced_revision is distinct from revision and sync_claimed_at is null;
create index hearings_claimed_idx on public.hearings (sync_claimed_at) where sync_claimed_at is not null;

alter table public.hearings enable row level security;
create policy "hearings_select_member" on public.hearings
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.hearings to authenticated;

create trigger hearings_updated_at before update on public.hearings
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_hearings after insert or update or delete on public.hearings
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The events of hearings that went ----------

-- A hearing goes with its lawsuit or its case (a lawsuit put back to planned and removed, a case an import
-- undoes): the event it may have in the firm's calendar is still there, with what it says of the case. What the
-- backend owes Google, by the hearing's id (which names the event) and the calendar it is in. Nobody of a firm
-- reads it: the backend's own list.
create table public.hearing_event_removals (
  hearing_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  calendar_id text not null,
  claims integer not null default 0,
  claimed_at timestamptz,
  attempts integer not null default 0,
  retry_after timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint hearing_event_removals_calendar_check check (char_length(calendar_id) between 3 and 300),
  constraint hearing_event_removals_error_check check (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$')
);

alter table public.hearing_event_removals enable row level security;
revoke all on table public.hearing_event_removals from anon, authenticated;
create trigger guard_impersonation_hearing_event_removals after insert or update or delete on public.hearing_event_removals
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A hearing that goes owes the removal of the event it may have in the
 * firm's calendar: the one written there; or, while a worker is writing it,
 * the one that may land in the firm's calendar in use in a moment, taken out
 * only once that write had its time to land. A cancelled hearing already
 * taken out owes nothing, and neither does a firm that goes (its grant goes
 * with it).
 */
create or replace function public.hearings_owe_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  calendar text := old.synced_calendar;
  in_flight boolean := old.sync_claimed_at is not null;
  current_calendar text;
begin
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return old;
  end if;
  if old.status = 'cancelled' and old.synced_revision = old.revision and not in_flight then
    return old;
  end if;
  if in_flight then
    select f.calendar_id into current_calendar from public.firm_calendars f
    where f.org_id = old.org_id and f.status = 'active';
    calendar := coalesce(current_calendar, calendar);
  end if;
  if calendar is not null then
    insert into public.hearing_event_removals (hearing_id, org_id, calendar_id, retry_after)
    values (old.id, old.org_id, calendar,
            case when in_flight
                 then now() + make_interval(mins => greatest(public.hearings_setting('working_minutes', 10), 1)) end)
    on conflict (hearing_id) do nothing;
  end if;
  return old;
end;
$$;

revoke all on function public.hearings_owe_removal() from public, anon, authenticated;

create trigger hearings_owe_removal before delete on public.hearings
  for each row execute function public.hearings_owe_removal();

/** The words a person typed, as a hearing keeps them: trimmed (after the cut too), or null when nothing is left. */
create or replace function public.hearing_text(value text, most integer)
returns text
language sql
immutable
as $$
  select nullif(btrim(left(btrim(regexp_replace(coalesce(value, ''), '[[:cntrl:]]+', ' ', 'g')), most)), '');
$$;

/** True while the firm's calendar of hearings takes them: what a write tells the person's screen. */
create or replace function public.firm_calendar_active(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.firm_calendars f where f.org_id = target_org and f.status = 'active');
$$;

revoke all on function public.firm_calendar_active(uuid) from public, anon, authenticated;

revoke all on function public.hearing_text(text, integer) from public, anon, authenticated;

/**
 * A person writes a hearing of a lawsuit the court has (filed), or changes
 * one still to happen: its kind, the day and the time in the zone it is said
 * in, how it happens, where or by which link, who attends, and, when it came
 * from a publication of the lawsuit, which. With no zone given, a change
 * keeps the hearing's and a new one takes the court's, unless the court's
 * territory keeps more than one legal time: then the person says which
 * (`zone_required`). The same lawsuit at the same moment is one hearing. Who
 * signs, or who runs the firm's deadlines; never a support visit. The answer
 * says whether the firm's calendar takes it.
 */
create or replace function public.save_hearing(target_hearing uuid, target_proceeding uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  current_hearing public.hearings%rowtype;
  lawsuit public.proceedings%rowtype;
  publication public.publications%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  kind_value text := fields ->> 'kind';
  mode_value text := fields ->> 'mode';
  day_text text := fields ->> 'day';
  time_text text := fields ->> 'time';
  zone text;
  moment timestamptz;
  place_value text := public.hearing_text(fields ->> 'place', 300);
  link_value text := public.hearing_text(fields ->> 'link', 500);
  attendee uuid;
  attendee_label text := public.hearing_text(fields ->> 'attendee_name', 120);
  notes_value text := public.hearing_text(fields ->> 'notes', 1000);
  seat_zone text;
  more_zones text[];
  publication_ref uuid;
  new_id uuid;
begin
  -- ONE writes only a new hearing, of the case its own function named (0040, checked below): never changes one.
  if caller is null and (auth.role() is distinct from 'service_role' or target_hearing is not null) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if jsonb_typeof(fields) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;

  if target_hearing is not null then
    select * into current_hearing from public.hearings where id = target_hearing for update;
    if not found or not public.is_org_member(current_hearing.org_id) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if current_hearing.status <> 'scheduled' then
      return jsonb_build_object('ok', false, 'code', 'closed');
    end if;
    select * into lawsuit from public.proceedings where id = current_hearing.proceeding_id;
  else
    select * into lawsuit from public.proceedings where id = target_proceeding for no key update;
    -- A person of the firm; ONE is held to the case its own function named, below.
    if not found or (caller is not null and not public.is_org_member(lawsuit.org_id)) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if lawsuit.status <> 'filed' then
      return jsonb_build_object('ok', false, 'code', 'not_filed');
    end if;
  end if;
  if caller is null and not public.case_system_writer(lawsuit.case_id) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if caller is not null
     and not public.has_firm_function(lawsuit.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;

  if kind_value is null or kind_value not in ('conciliacao', 'instrucao', 'una', 'outra') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if mode_value is null or mode_value not in ('presencial', 'videoconferencia', 'hibrida') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'mode');
  end if;
  select c.time_zone, c.other_zones into seat_zone, more_zones from public.courts c where c.acronym = lawsuit.court;
  zone := coalesce(nullif(fields ->> 'time_zone', ''), current_hearing.time_zone);
  if zone is null then
    if cardinality(coalesce(more_zones, '{}')) > 0 then
      return jsonb_build_object('ok', false, 'code', 'zone_required', 'field', 'time_zone');
    end if;
    zone := coalesce(seat_zone, 'America/Sao_Paulo');
  end if;
  if not public.hearing_zone_ok(zone) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'time_zone');
  end if;
  if day_text is null or day_text !~ '^\d{4}-\d{2}-\d{2}$' or time_text is null or time_text !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', case when day_text ~ '^\d{4}-\d{2}-\d{2}$' then 'time' else 'day' end);
  end if;
  begin
    moment := (day_text::date + time_text::time) at time zone zone;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'day');
  end;
  -- A hearing of the last year (written late) or of the next two.
  if day_text::date not between today - 400 and today + 800 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'day');
  end if;
  if fields ->> 'link' is not null and link_value is not null and link_value !~* '^https://[^[:space:]]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'link');
  end if;
  if place_value is not null and char_length(place_value) < 2 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'place');
  end if;
  if attendee_label is not null and char_length(attendee_label) < 2 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'attendee_name');
  end if;
  if nullif(fields ->> 'attendee_user_id', '') is not null then
    begin
      attendee := (fields ->> 'attendee_user_id')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'attendee_user_id');
    end;
    if not exists (select 1 from public.memberships m where m.org_id = lawsuit.org_id and m.user_id = attendee) then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'attendee_user_id');
    end if;
  end if;

  if target_hearing is null then
    if nullif(fields ->> 'publication_id', '') is not null then
      begin
        publication_ref := (fields ->> 'publication_id')::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'publication_id');
      end;
      select * into publication from public.publications p where p.id = publication_ref and p.org_id = lawsuit.org_id;
      if not found or publication.cnj is distinct from lawsuit.cnj then
        return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'publication_id');
      end if;
    end if;
    begin
      insert into public.hearings (
        org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, place, link, attendee_user_id, attendee_name,
        notes, source, publication_id, created_by, updated_by, created_auto
      ) values (
        lawsuit.org_id, lawsuit.case_id, lawsuit.id, kind_value, moment, zone, mode_value, place_value, link_value,
        attendee, attendee_label, notes_value,
        case when publication_ref is not null then 'publication' else 'person' end,
        publication_ref, caller, caller, caller is null
      )
      returning id into new_id;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'duplicate');
    end;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (lawsuit.org_id, caller, 'hearing.scheduled', 'hearing', new_id::text,
      jsonb_strip_nulls(jsonb_build_object('proceeding', lawsuit.id, 'kind', kind_value, 'mode', mode_value,
        'publication', publication_ref, 'auto', case when caller is null then true end)));
    perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'hearing_scheduled',
      public.case_actor(lawsuit.case_id), jsonb_build_object('hearing', new_id, 'kind', kind_value));
    return jsonb_build_object('ok', true, 'code', 'scheduled', 'id', new_id,
      'calendar', public.firm_calendar_active(lawsuit.org_id));
  end if;

  if current_hearing.kind = kind_value and current_hearing.starts_at = moment and current_hearing.time_zone = zone
     and current_hearing.mode = mode_value and current_hearing.place is not distinct from place_value
     and current_hearing.link is not distinct from link_value
     and current_hearing.attendee_user_id is not distinct from attendee
     and current_hearing.attendee_name is not distinct from attendee_label
     and current_hearing.notes is not distinct from notes_value then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'id', current_hearing.id);
  end if;
  begin
    update public.hearings set
      kind = kind_value, starts_at = moment, time_zone = zone, mode = mode_value, place = place_value, link = link_value,
      attendee_user_id = attendee, attendee_name = attendee_label, notes = notes_value,
      revision = revision + 1, sync_attempts = 0, sync_error = null, sync_retry_after = null, updated_by = caller
    where id = current_hearing.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_hearing.org_id, caller, 'hearing.updated', 'hearing', current_hearing.id::text,
    jsonb_build_object('moved', current_hearing.starts_at <> moment, 'mode', mode_value));
  perform public.record_case_event(current_hearing.org_id, current_hearing.case_id, 'hearing_updated', 'person',
    jsonb_build_object('hearing', current_hearing.id, 'moved', current_hearing.starts_at <> moment));
  return jsonb_build_object('ok', true, 'code', 'updated', 'id', current_hearing.id,
    'calendar', public.firm_calendar_active(current_hearing.org_id));
end;
$$;

revoke all on function public.save_hearing(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_hearing(uuid, uuid, jsonb) to authenticated;

/**
 * A person says what came of a hearing: held (with what came of it: a
 * settlement, none, something else), or cancelled (with why: moved to
 * another day is a cancelled one and a new one); or puts a hearing said by
 * mistake back to be held. Who signs, or who runs the firm's deadlines.
 */
create or replace function public.set_hearing_status(
  target_hearing uuid,
  target_status text,
  target_outcome text,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  current_hearing public.hearings%rowtype;
  note_value text := public.hearing_text(target_note, 1000);
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into current_hearing from public.hearings where id = target_hearing for update;
  if not found or not public.is_org_member(current_hearing.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_hearing.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_status is null or target_status not in ('scheduled', 'held', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'status');
  end if;
  if target_status = current_hearing.status then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_status = 'held' and (current_hearing.starts_at > now() + interval '1 hour'
     or (target_outcome is not null and target_outcome not in ('acordo', 'sem_acordo', 'outro'))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'outcome');
  end if;
  if target_status = 'cancelled' and (note_value is null or char_length(note_value) < 8) then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'note');
  end if;
  begin
    update public.hearings set
      status = target_status,
      outcome = case when target_status = 'held' then target_outcome end,
      outcome_note = case when target_status = 'scheduled' then null else note_value end,
      revision = revision + 1, sync_attempts = 0, sync_error = null, sync_retry_after = null, updated_by = caller
    where id = current_hearing.id;
  exception when unique_violation then
    -- Put back while another hearing of the lawsuit was written for the same moment.
    return jsonb_build_object('ok', false, 'code', 'duplicate');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_hearing.org_id, caller, 'hearing.' || target_status, 'hearing', current_hearing.id::text,
    jsonb_strip_nulls(jsonb_build_object('was', current_hearing.status, 'outcome', target_outcome)));
  perform public.record_case_event(current_hearing.org_id, current_hearing.case_id,
    case target_status when 'held' then 'hearing_held' when 'cancelled' then 'hearing_cancelled' else 'hearing_reopened' end,
    'person', jsonb_strip_nulls(jsonb_build_object('hearing', current_hearing.id, 'outcome', target_outcome)));
  return jsonb_build_object('ok', true, 'code', target_status,
    'calendar', public.firm_calendar_active(current_hearing.org_id));
end;
$$;

revoke all on function public.set_hearing_status(uuid, text, text, text) from public, anon;
grant execute on function public.set_hearing_status(uuid, text, text, text) to authenticated;

/**
 * Whether the court took back the publication a hearing came from and
 * nobody said they saw it: what is told of the hearing waits (0038), and its
 * card says so. Redefined in 0040, where a publication ONE read and found the
 * hearing in the agenda for answers for it too. Internal.
 */
create or replace function public.hearing_publication_cancelled(target_hearing uuid, target_publication uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.publications pu where pu.id = target_publication and pu.cancel_pending);
$$;

revoke all on function public.hearing_publication_cancelled(uuid, uuid) from public, anon, authenticated;

/**
 * A page of the firm's hearings, with the count of each list:
 *
 *   proximas       to be held, the nearest first;
 *   sem_resultado  past their time with nobody having said what came of them, the oldest first;
 *   realizadas     held, the latest first;
 *   canceladas     cancelled, the latest first.
 *
 * Of one case, when it is named. Each row with what the agenda shows of it:
 * the case, the lawsuit, the client's name, who attends, and how its event
 * in the firm's calendar stands (none when nothing of it is or will be
 * there: cancelled before any calendar had it or already taken out, or of
 * the past and never written). With how long a hearing is taken to last, and
 * the firm's calendar unless a person turned it off.
 */
create or replace function public.firm_hearings(
  target_org uuid,
  target_view text,
  target_limit integer default 25,
  target_offset integer default 0,
  target_case uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := greatest(coalesce(target_offset, 0), 0);
  duration integer := greatest(public.hearings_setting('duration_minutes', 60), 1);
  ends interval := make_interval(mins => duration);
  soon integer := greatest(public.hearings_setting('soon_days', 7), 0);
  tries integer := greatest(public.hearings_setting('max_attempts', 5), 1);
  past integer := greatest(public.hearings_setting('calendar_past_days', 60), 0);
  calendar public.firm_calendars%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_view is null or target_view not in ('proximas', 'sem_resultado', 'realizadas', 'canceladas') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  select * into calendar from public.firm_calendars where org_id = target_org and status <> 'off';
  return (
    with firm as (
      select h.id, h.status, h.starts_at, h.updated_at
      from public.hearings h
      where h.org_id = target_org and (target_case is null or h.case_id = target_case)
    ),
    listed as (
      select f.* from firm f
      where case target_view
        when 'proximas' then f.status = 'scheduled' and f.starts_at + ends >= now()
        when 'sem_resultado' then f.status = 'scheduled' and f.starts_at + ends < now()
        when 'realizadas' then f.status = 'held'
        else f.status = 'cancelled'
      end
    ),
    page as (
      select l.id, row_number() over (order by
        case when target_view in ('proximas', 'sem_resultado') then l.starts_at end asc,
        case when target_view in ('realizadas', 'canceladas') then l.starts_at end desc,
        l.id) as position
      from listed l
      order by
        case when target_view in ('proximas', 'sem_resultado') then l.starts_at end asc,
        case when target_view in ('realizadas', 'canceladas') then l.starts_at end desc,
        l.id
      limit size offset skip
    )
    select jsonb_build_object(
      'soon_days', soon,
      'duration_minutes', duration,
      'counts', jsonb_build_object(
        'proximas', (select count(*) from firm f where f.status = 'scheduled' and f.starts_at + ends >= now()),
        'em_breve', (select count(*) from firm f where f.status = 'scheduled' and f.starts_at + ends >= now()
                       and f.starts_at < now() + make_interval(days => soon)),
        'sem_resultado', (select count(*) from firm f where f.status = 'scheduled' and f.starts_at + ends < now()),
        'realizadas', (select count(*) from firm f where f.status = 'held'),
        'canceladas', (select count(*) from firm f where f.status = 'cancelled')
      ),
      'total', (select count(*) from listed),
      'calendar', case when calendar.org_id is null then null else jsonb_build_object(
        'name', calendar.name, 'status', calendar.status, 'problem', calendar.problem) end,
      -- The hearings of the firm (or the case) the calendar in use refused for good, in any list and page.
      'calendar_failed', case when calendar.org_id is null or calendar.status <> 'active' then 0 else (
        select count(*) from public.hearings h
        where h.org_id = target_org and (target_case is null or h.case_id = target_case)
          and h.sync_error is not null and h.sync_attempts >= tries and h.sync_claimed_at is null
          and not (h.status = 'cancelled' and h.synced_calendar is null)
          and (h.synced_calendar = calendar.calendar_id or h.starts_at >= now() - make_interval(days => past))
      ) end,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', h.id,
          'kind', h.kind,
          'starts_at', h.starts_at,
          'time_zone', h.time_zone,
          'mode', h.mode,
          'place', h.place,
          'link', h.link,
          'attendee_user_id', h.attendee_user_id,
          'attendee_name', h.attendee_name,
          'notes', h.notes,
          'source', h.source,
          'publication_id', h.publication_id,
          'status', h.status,
          'outcome', h.outcome,
          'outcome_note', h.outcome_note,
          'revision', h.revision,
          'case_id', h.case_id,
          'case_seq', (select c.seq from public.cases c where c.id = h.case_id),
          'client_name', (
            select p.full_name from public.case_parties cp join public.people p on p.id = cp.person_id
            where cp.case_id = h.case_id and cp.role = 'claimant' order by cp.created_at limit 1
          ),
          'proceeding_id', h.proceeding_id,
          'cnj', pr.cnj,
          'court', pr.court,
          'comarca', pr.comarca,
          'proceeding_kind', pr.kind,
          -- How its event stands in the firm's calendar: written, being written, or given up.
          'calendar_state', case
            when calendar.org_id is null or calendar.status <> 'active' then null
            -- Nothing of it is or will be there: cancelled before any calendar had it, or taken out already.
            when h.status = 'cancelled' and (h.synced_calendar is null
                 or (h.synced_revision = h.revision and h.synced_calendar = calendar.calendar_id)) then null
            when h.synced_revision = h.revision and h.synced_calendar = calendar.calendar_id then 'synced'
            -- Of the past and never in this calendar: history, which the calendar does not take.
            when h.synced_calendar is distinct from calendar.calendar_id
                 and h.starts_at < now() - make_interval(days => past) then null
            when h.sync_error is not null and h.sync_attempts >= tries and h.sync_claimed_at is null then 'failed'
            else 'pending'
          end,
          'created_by', h.created_by,
          'created_at', h.created_at,
          'created_auto', h.created_auto,
          -- The court took back a publication that answers for the hearing and nobody said they saw it: it may no longer be.
          'publication_cancel_pending', public.hearing_publication_cancelled(h.id, h.publication_id)
        ) order by pg.position)
        from page pg
        join public.hearings h on h.id = pg.id
        join public.proceedings pr on pr.id = h.proceeding_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_hearings(uuid, text, integer, integer, uuid) from public, anon;
grant execute on function public.firm_hearings(uuid, text, integer, integer, uuid) to authenticated;

-- ---------- The publications that set a hearing nobody wrote ----------

-- A person's word that the hearing a publication set needs nothing more in the agenda (it is there already, written
-- some other way, or the publication moved or cancelled one that is): `settle_publication_hearing`.
alter table public.publications
  add column hearing_settled_at timestamptz,
  add column hearing_settled_by uuid references public.profiles (id) on delete set null;
-- That it was settled is the firm's to read (a card says nothing more is asked); who settled it is on record.
grant select (hearing_settled_at) on table public.publications to authenticated;

create index publications_hearing_watch_idx on public.publications (org_id, triaged_at)
  where category = 'audiencia' and active;
create index publications_hearing_settled_by_idx on public.publications (hearing_settled_by)
  where hearing_settled_by is not null;

/**
 * Whether a publication triaged as a hearing still owes the firm its
 * hearing: none was written from it and nobody said it needs nothing more.
 * What ONE reads of it is reckoned where ONE reads (0040). Internal.
 */
create or replace function public.publication_owes_hearing(target_publication uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.hearing_settled_at is null
      and not exists (select 1 from public.hearings h where h.publication_id = p.id)
    from public.publications p where p.id = target_publication
  ), false);
$$;

revoke all on function public.publication_owes_hearing(uuid) from public, anon, authenticated;

/**
 * The publications of the firm triaged as a hearing, in the days a triaged
 * publication is watched (the deadlines' `watch_days`, from the triage),
 * that still owe their hearing (`publication_owes_hearing`), the oldest
 * first: each with what tells it apart (its lawsuit and whether the court
 * has it, its day, the start of its text, never the whole of it, never the
 * AI's word). A publication of a lawsuit ONE does not have, or does not have
 * as filed, is listed too: its hearing is written once the lawsuit is.
 * Anybody of the firm reads it.
 */
create or replace function public.firm_publications_without_hearing(target_org uuid, target_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  watch integer := greatest(public.deadlines_setting('watch_days', 30), 1);
  size integer := least(greatest(coalesce(target_limit, 20), 1), 100);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with waiting as (
      select p.id, p.cnj, p.court, p.available_on, p.kind, p.head, p.case_id, p.proceeding_id, p.triaged_by,
        p.triaged_at
      from public.publications p
      where p.org_id = target_org and p.active and p.category = 'audiencia'
        and public.publication_watched_since(p.available_on, p.triaged_at, p.captured_at) >= today - watch
        and public.publication_owes_hearing(p.id)
    )
    select jsonb_build_object(
      'watch_days', watch,
      'total', (select count(*) from waiting),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', w.id,
          'cnj', w.cnj,
          'court', w.court,
          'available_on', w.available_on,
          'kind', w.kind,
          'head', left(w.head, 400),
          'case_id', w.case_id,
          'case_seq', (select c.seq from public.cases c where c.id = w.case_id),
          'proceeding_id', w.proceeding_id,
          'proceeding_status', (select pr.status from public.proceedings pr where pr.id = w.proceeding_id),
          'triaged_by', w.triaged_by,
          'triaged_at', w.triaged_at
        ) order by w.available_on, w.id)
        from (select * from waiting order by available_on, id limit size) w
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_publications_without_hearing(uuid, integer) from public, anon;
grant execute on function public.firm_publications_without_hearing(uuid, integer) to authenticated;

/**
 * Who writes hearings says the hearing a publication set needs nothing more
 * in the agenda: it is there already (written from the case, or from another
 * publication of the same hearing), or the publication moved or cancelled
 * one that is, and the person changed it there. The publication leaves the
 * watch, and the word stays on record (audited). Never a support visit.
 */
create or replace function public.settle_publication_hearing(target_publication uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into publication from public.publications where id = target_publication for update;
  if not found or not public.is_org_member(publication.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(publication.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not publication.active then
    return jsonb_build_object('ok', false, 'code', 'cancelled');
  end if;
  if publication.category is distinct from 'audiencia' then
    return jsonb_build_object('ok', false, 'code', 'invalid_category');
  end if;
  if publication.hearing_settled_at is null then
    update public.publications set hearing_settled_at = now(), hearing_settled_by = caller where id = publication.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (publication.org_id, caller, 'publication.hearing_settled', 'publication', publication.id::text,
      jsonb_strip_nulls(jsonb_build_object('proceeding', publication.proceeding_id)));
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.settle_publication_hearing(uuid) from public, anon;
grant execute on function public.settle_publication_hearing(uuid) to authenticated;

-- ---------- The calendar, by the backend ----------

/**
 * The firm's calendar of hearings, as the backend made it in the account a
 * person connected: in use from now on, and every hearing of the firm owes
 * it its event. Made again after a calendar was lost, it takes the
 * hearings again. Service role only.
 */
create or replace function public.record_firm_calendar(
  target_org uuid,
  target_connection uuid,
  target_calendar text,
  target_name text,
  target_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.connections c
                 where c.id = target_connection and c.org_id = target_org and c.provider = 'google_calendar'
                   and c.status in ('connected', 'error')) then
    return jsonb_build_object('ok', false, 'code', 'not_connected');
  end if;
  insert into public.firm_calendars (org_id, connection_id, calendar_id, name, status, problem, created_by)
  values (target_org, target_connection, target_calendar, left(btrim(target_name), 120), 'active', null, target_by)
  on conflict (org_id) do update set
    connection_id = excluded.connection_id,
    calendar_id = excluded.calendar_id,
    name = excluded.name,
    status = 'active',
    problem = null,
    created_by = excluded.created_by;
  -- What was given up on a calendar that stopped, or waited while it was stopped, is taken now.
  update public.hearings set sync_attempts = 0, sync_error = null, sync_retry_after = null
  where org_id = target_org and sync_claimed_at is null and (sync_error is not null or sync_retry_after is not null);
  update public.hearing_event_removals set attempts = 0, error = null, retry_after = null
  where org_id = target_org and claimed_at is null;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_by, 'calendar.connected', 'firm_calendar', target_org::text,
    jsonb_build_object('connection', target_connection));
  return jsonb_build_object('ok', true, 'code', 'recorded');
exception when check_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.record_firm_calendar(uuid, uuid, text, text, uuid) from public, anon, authenticated;

/**
 * The firm's calendar stopped taking the hearings: the grant ended (`auth`),
 * the calendar was deleted in Google (`gone`). Said to the firm; nothing is
 * written to it until somebody brings it back. A grant opened before the
 * connection was sealed again (`target_since`: a person connected the
 * account again while a worker held the old grant) speaks for nothing that
 * is in use now: then nothing changes. Service role only.
 */
create or replace function public.firm_calendar_lost(
  target_org uuid,
  target_calendar text,
  target_problem text,
  target_since timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  problem_value text := coalesce(substring(lower(coalesce(target_problem, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.firm_calendars f set status = 'lost', problem = problem_value
  where f.org_id = target_org and f.calendar_id = target_calendar and f.status = 'active'
    and (target_since is null or not exists (
      select 1 from public.connections c
      where c.id = f.connection_id and c.connected_at is not null and c.connected_at > target_since
    ));
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, null, 'calendar.lost', 'firm_calendar', target_org::text, jsonb_build_object('problem', problem_value));
  return jsonb_build_object('ok', true, 'code', 'lost');
end;
$$;

revoke all on function public.firm_calendar_lost(uuid, text, text, timestamptz) from public, anon, authenticated;

/**
 * Claims the hearings whose event is not of their revision in force in the
 * firm's calendar (or the one named), each with the number of its claim,
 * for the firms whose calendar is in use; a hearing far in the past is
 * history and is not written to a calendar that never had it. A claim not
 * finished in time goes back to the line. Service role only.
 */
create or replace function public.claim_hearing_syncs(target_limit integer default 20, target_hearing uuid default null)
returns table (hearing_id uuid, claim integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.hearings_setting('working_minutes', 10), 1);
  tries integer := greatest(public.hearings_setting('max_attempts', 5), 1);
  past integer := greatest(public.hearings_setting('calendar_past_days', 60), 0);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.hearings h
  set sync_claimed_at = null,
      sync_error = case when h.sync_attempts >= tries then 'abandoned' else h.sync_error end
  where h.sync_claimed_at is not null and h.sync_claimed_at < now() - make_interval(mins => minutes);

  return query
  with picked as (
    select h.id from public.hearings h
    join public.firm_calendars fc on fc.org_id = h.org_id and fc.status = 'active'
    where (h.synced_revision is distinct from h.revision or h.synced_calendar is distinct from fc.calendar_id)
      and h.sync_claimed_at is null and h.sync_attempts < tries
      and (h.sync_retry_after is null or h.sync_retry_after <= now())
      and (h.synced_calendar = fc.calendar_id or h.starts_at >= now() - make_interval(days => past))
      -- A hearing cancelled before any calendar had it has no event to take out.
      and not (h.status = 'cancelled' and h.synced_calendar is null)
      and (target_hearing is null or h.id = target_hearing)
    order by h.updated_at
    limit greatest(least(coalesce(target_limit, 20), 100), 1)
    for update of h skip locked
  )
  update public.hearings h
  set sync_claimed_at = now(), sync_retry_after = null, sync_attempts = h.sync_attempts + 1,
      sync_claims = h.sync_claims + 1
  from picked where h.id = picked.id
  returning h.id, h.sync_claims;
end;
$$;

revoke all on function public.claim_hearing_syncs(integer, uuid) from public, anon, authenticated;

/**
 * What the event of a hearing is written from, for the worker that holds
 * the claim: the hearing, its case and lawsuit, who attends, and the firm's
 * calendar with the connection whose grant writes to it. Nobody of the case
 * is named: a calendar is shared and shows on phones, and a name written
 * there would outlive a correction or an erasure. Service role only.
 */
create or replace function public.hearing_to_sync(target_hearing uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h public.hearings%rowtype;
  calendar public.firm_calendars%rowtype;
  lawsuit public.proceedings%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into h from public.hearings
  where id = target_hearing and sync_claimed_at is not null and sync_claims = target_claim;
  if not found then
    return null;
  end if;
  select * into calendar from public.firm_calendars where org_id = h.org_id and status = 'active';
  if not found then
    return null;
  end if;
  select * into lawsuit from public.proceedings where id = h.proceeding_id;
  return jsonb_build_object(
    'id', h.id,
    'org_id', h.org_id,
    'claim', h.sync_claims,
    'revision', h.revision,
    'status', h.status,
    'kind', h.kind,
    'starts_at', h.starts_at,
    'time_zone', h.time_zone,
    'duration_minutes', greatest(public.hearings_setting('duration_minutes', 60), 1),
    'mode', h.mode,
    'place', h.place,
    'link', h.link,
    'attendee', coalesce(h.attendee_name, (
      select coalesce(nullif(btrim(pr.display_name), ''), split_part(u.email, '@', 1))
      from public.profiles pr left join auth.users u on u.id = pr.id where pr.id = h.attendee_user_id)),
    'outcome', h.outcome,
    'case_id', h.case_id,
    'case_seq', (select c.seq from public.cases c where c.id = h.case_id),
    'cnj', lawsuit.cnj,
    'court', lawsuit.court,
    'comarca', lawsuit.comarca,
    'unit', lawsuit.unit,
    'calendar_id', calendar.calendar_id,
    'connection_id', calendar.connection_id,
    -- The event a calendar had of it before (another calendar, or none): written anew in this one.
    'synced_calendar', h.synced_calendar
  );
end;
$$;

revoke all on function public.hearing_to_sync(uuid, integer) from public, anon, authenticated;

/**
 * What the writing of a hearing's event came to, for the revision and the
 * calendar the worker read:
 *
 *   synced   the event is of that revision in that calendar (or taken out,
 *            for a cancelled hearing);
 *   retry    a failure that may pass: tried again after a growing wait,
 *            until the attempts are spent;
 *   failed   the provider refused what was sent: a person looks;
 *   release  nothing was learned of the hearing (the calendar stopped, the
 *            platform failed): the try is given back.
 *
 * Whatever came of a revision no longer in force (written, tried, refused)
 * is no answer for this one: the try does not count and the hearing is
 * written again; and since the calendar may hold an event of it now, a
 * hearing cancelled meanwhile is still taken out of it. Service role only.
 */
create or replace function public.record_hearing_sync(
  target_hearing uuid,
  target_claim integer,
  target_revision integer,
  target_calendar text,
  target_outcome text,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hearings%rowtype;
  tries integer := greatest(public.hearings_setting('max_attempts', 5), 1);
  pause integer := greatest(public.hearings_setting('retry_minutes', 10), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  answer text := target_outcome;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('synced', 'retry', 'failed', 'release') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into h from public.hearings where id = target_hearing for update;
  if not found or h.sync_claimed_at is null or h.sync_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if answer = 'release' then
    update public.hearings set sync_claimed_at = null, sync_attempts = greatest(sync_attempts - 1, 0),
      sync_retry_after = now() + make_interval(mins => pause)
    where id = h.id;
    return jsonb_build_object('ok', true, 'code', 'released');
  end if;
  if target_revision is distinct from h.revision then
    -- The calendar the worker wrote to may hold an event of it now: that one is what a later removal takes out.
    update public.hearings set
      sync_claimed_at = null, sync_attempts = greatest(sync_attempts - 1, 0),
      synced_calendar = coalesce(nullif(btrim(coalesce(target_calendar, '')), ''), synced_calendar)
    where id = h.id;
    return jsonb_build_object('ok', true, 'code', 'changed');
  end if;
  if answer = 'synced' then
    update public.hearings set
      synced_revision = revision, synced_calendar = nullif(btrim(coalesce(target_calendar, '')), ''),
      synced_at = now(), sync_claimed_at = null, sync_attempts = 0, sync_error = null, sync_retry_after = null
    where id = h.id;
    return jsonb_build_object('ok', true, 'code', 'synced');
  end if;
  if answer = 'retry' and h.sync_attempts >= tries then
    answer := 'failed';
  end if;
  update public.hearings set
    sync_claimed_at = null,
    sync_retry_after = case when answer = 'retry' then now() + make_interval(mins => pause * greatest(sync_attempts, 1)) end,
    sync_attempts = case when answer = 'failed' then tries else sync_attempts end,
    sync_error = code
  where id = h.id;
  return jsonb_build_object('ok', true, 'code', answer);
end;
$$;

revoke all on function public.record_hearing_sync(uuid, integer, integer, text, text, text) from public, anon, authenticated;

/**
 * Claims the events of hearings that went, for the firms whose calendar is
 * in use, each with the number of its claim and the connection whose grant
 * takes it out. One that can no longer be reached is let go first: the
 * firm's calendar is another one now, or it was deleted in Google (and its
 * events with it). One whose calendar stopped waits for it. Service role
 * only.
 */
create or replace function public.claim_hearing_removals(target_limit integer default 20)
returns table (hearing_id uuid, claim integer, org_id uuid, calendar_id text, connection_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.hearings_setting('working_minutes', 10), 1);
  tries integer := greatest(public.hearings_setting('max_attempts', 5), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.hearing_event_removals r
  where r.claimed_at is null
    and not exists (
      select 1 from public.firm_calendars f
      where f.org_id = r.org_id and f.calendar_id = r.calendar_id and not (f.status = 'lost' and f.problem = 'gone')
    );
  update public.hearing_event_removals r set claimed_at = null
  where r.claimed_at is not null and r.claimed_at < now() - make_interval(mins => minutes);
  -- One whose tries were spent by workers that never came back is left in the calendar, on record.
  with abandoned as (
    delete from public.hearing_event_removals r
    where r.claimed_at is null and r.attempts >= tries
    returning r.hearing_id, r.org_id
  )
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  select a.org_id, null, 'calendar.event_left', 'hearing', a.hearing_id::text, jsonb_build_object('code', 'abandoned')
  from abandoned a;

  return query
  with picked as (
    select r.hearing_id from public.hearing_event_removals r
    join public.firm_calendars f on f.org_id = r.org_id and f.calendar_id = r.calendar_id and f.status = 'active'
    where r.claimed_at is null and r.attempts < tries and (r.retry_after is null or r.retry_after <= now())
    order by r.created_at
    limit greatest(least(coalesce(target_limit, 20), 100), 1)
    for update of r skip locked
  ),
  taken as (
    update public.hearing_event_removals r
    set claimed_at = now(), claims = r.claims + 1, attempts = r.attempts + 1, retry_after = null
    from picked where r.hearing_id = picked.hearing_id
    returning r.hearing_id, r.claims, r.org_id, r.calendar_id
  )
  select t.hearing_id, t.claims, t.org_id, t.calendar_id, f.connection_id
  from taken t join public.firm_calendars f on f.org_id = t.org_id;
end;
$$;

revoke all on function public.claim_hearing_removals(integer) from public, anon, authenticated;

/**
 * What came of taking out the event of a hearing that went:
 *
 *   done     taken out, or it was not there: nothing more is owed;
 *   retry    a failure that may pass: tried again after a growing wait; once
 *            the attempts are spent the event is left in the calendar, and
 *            that is on record;
 *   failed   the provider refused it: left in the calendar, on record;
 *   release  nothing was learned (the calendar stopped, the platform
 *            failed): the try is given back.
 *
 * Service role only.
 */
create or replace function public.record_hearing_removal(
  target_hearing uuid,
  target_claim integer,
  target_outcome text,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  removal public.hearing_event_removals%rowtype;
  tries integer := greatest(public.hearings_setting('max_attempts', 5), 1);
  pause integer := greatest(public.hearings_setting('retry_minutes', 10), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('done', 'retry', 'failed', 'release') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into removal from public.hearing_event_removals where hearing_id = target_hearing for update;
  if not found or removal.claimed_at is null or removal.claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_outcome = 'done' then
    delete from public.hearing_event_removals where hearing_id = removal.hearing_id;
    return jsonb_build_object('ok', true, 'code', 'done');
  end if;
  if target_outcome = 'release' then
    update public.hearing_event_removals set claimed_at = null, attempts = greatest(attempts - 1, 0),
      retry_after = now() + make_interval(mins => pause)
    where hearing_id = removal.hearing_id;
    return jsonb_build_object('ok', true, 'code', 'released');
  end if;
  if target_outcome = 'retry' and removal.attempts < tries then
    update public.hearing_event_removals set claimed_at = null, error = code,
      retry_after = now() + make_interval(mins => pause * greatest(removal.attempts, 1))
    where hearing_id = removal.hearing_id;
    return jsonb_build_object('ok', true, 'code', 'retry');
  end if;
  delete from public.hearing_event_removals where hearing_id = removal.hearing_id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (removal.org_id, null, 'calendar.event_left', 'hearing', removal.hearing_id::text,
    jsonb_build_object('code', code));
  return jsonb_build_object('ok', true, 'code', 'left');
end;
$$;

revoke all on function public.record_hearing_removal(uuid, integer, text, text) from public, anon, authenticated;

/** A person asks for the events the calendar could not take to be written again. Who signs, or runs the deadlines. */
create or replace function public.retry_hearing_syncs(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  touched integer;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(target_org, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  update public.hearings set sync_attempts = 0, sync_error = null, sync_retry_after = null
  where org_id = target_org and sync_error is not null and sync_claimed_at is null;
  get diagnostics touched = row_count;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'calendar.retried', 'firm_calendar', target_org::text, jsonb_build_object('hearings', touched));
  return jsonb_build_object('ok', true, 'code', 'retried', 'hearings', touched);
end;
$$;

revoke all on function public.retry_hearing_syncs(uuid) from public, anon;
grant execute on function public.retry_hearing_syncs(uuid) to authenticated;

-- ---------- What needs somebody today ----------

/**
 * What needs somebody of the firm today (replaces the one of 0035), with the
 * hearings: the ones in the next days, the ones past their time with no word
 * on what came of them, and a calendar of hearings that stopped.
 */
create or replace function public.firm_today(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  my_function public.firm_function;
  late_hours integer := greatest(public.publications_setting('late_hours', 24), 1);
  left_days integer := greatest(public.publications_setting('left_out_days', 7), 1);
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
  soon integer := greatest(public.deadlines_setting('soon_days', 3), 0);
  watch integer := greatest(public.deadlines_setting('watch_days', 30), 1);
  hearing_soon integer := greatest(public.hearings_setting('soon_days', 7), 0);
  hearing_ends interval := make_interval(mins => greatest(public.hearings_setting('duration_minutes', 60), 1));
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.firm_function into my_function
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'approvals_mine', (
      select count(*) from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and my_function = any (a.approver_functions)
    ),
    'approvals_waiting', (
      select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'
    ),
    'conversations_waiting', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
    ),
    'conversations_closing', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
        and public.wa_window_open(c.last_inbound_at)
        and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)
    ),
    'sends_failed', (
      select count(*) from public.wa_messages m
      where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours'
    ),
    'documents_to_review', (
      select count(*) from public.case_documents d where d.org_id = target_org and d.status = 'received'
    ),
    'clients_finished', (
      select count(distinct l.case_id) from public.client_links l
      join public.cases c on c.id = l.case_id
      where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
        and c.status in ('intake', 'documents', 'signature')
    ),
    'chronologies_contested', (
      select count(distinct s.case_id) from public.case_statements s
      join public.cases c on c.id = s.case_id
      where s.org_id = target_org and s.chronology_status = 'contested'
        and c.status not in ('closed', 'declined')
    ),
    'complaints_overdue', (
      select count(distinct a.case_id) from public.admin_complaints a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.outcome = 'pending'
        and a.answer_due_on < today
        and c.status not in ('closed', 'declined')
    ),
    'filings_ready', (
      select count(*) from public.filing_packages p
      join public.cases c on c.id = p.case_id
      where p.org_id = target_org and p.status = 'ready' and c.status not in ('closed', 'declined')
    ),
    'drafts_waiting', (
      select count(*) from public.case_drafts d
      join public.cases c on c.id = d.case_id
      join public.proceedings p on p.id = d.proceeding_id
      where d.org_id = target_org and c.status not in ('closed', 'declined') and p.status = 'planned'
        and (
          (d.status = 'proposed' and d.work is distinct from 'revise' and not exists (
            select 1 from public.approvals a where a.run_id = d.run_id and a.status = 'pending'
          ))
          or d.status = 'failed'
          or (d.status = 'approved' and d.work is null)
        )
    ),
    'publications_new', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.category is null and p.active
    ),
    'publications_cancelled', (
      select count(*) from public.publications p where p.org_id = target_org and p.cancel_pending
    ),
    'publications_to_review', (
      select count(*) from public.publications p where p.org_id = target_org and p.review_due and p.active
    ),
    'djen_late', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active
        and coalesce(c.captured_at, c.created_at) < now() - make_interval(hours => late_hours)
    ) + (
      -- A registration no sweep has seen for that long: the reading itself is not running.
      select count(*) from public.oab_registrations r
      join public.memberships m on m.user_id = r.user_id
      where m.org_id = target_org
        and greatest(r.created_at, m.created_at) < now() - make_interval(hours => late_hours)
        and not exists (
          select 1 from public.djen_captures c where c.org_id = m.org_id and c.uf = r.uf and c.number = r.number
        )
    ),
    'djen_incomplete', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active and c.last_skipped > 0
        and c.skipped_at > now() - make_interval(days => left_days)
    ),
    'djen_stopped', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and not c.active and c.user_id is not null
        and exists (
          select 1 from public.proceeding_lawyers pl
          join public.proceedings p on p.id = pl.proceeding_id
          where pl.org_id = c.org_id and pl.user_id = c.user_id and p.status = 'filed'
        )
    ),
    'movements_new', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status <> 'off' and t.unseen_count > 0 and c.status not in ('closed', 'declined')
    ),
    'tracking_failed', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status = 'failed' and t.unseen_count = 0 and c.status not in ('closed', 'declined')
    ),
    'deadlines_to_confirm', (
      select count(*) from public.deadlines d where d.org_id = target_org and d.status = 'proposed'
    ),
    'deadlines_soon', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) between today and today + soon
    ),
    'deadlines_overdue', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) < today
    ),
    'deadlines_review', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and cardinality(public.deadline_review_reasons_of(d.status, d.publication_id, d.confirmed_at,
          d.confirmed_revision, d.revision, d.computed_revision, d.computed_due_on, d.confirmed_against, d.due_on,
          d.count_error, d.count_claimed_at, d.count_attempts)) > 0
    ),
    'publications_without_deadline', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.active and p.category = 'prazo'
        and public.publication_watched_since(p.available_on, p.triaged_at, p.captured_at) >= today - watch
        and not exists (select 1 from public.deadlines d where d.publication_id = p.id)
    ),
    'hearings_soon', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled'
        and h.starts_at + hearing_ends >= now() and h.starts_at < now() + make_interval(days => hearing_soon)
    ),
    'hearings_unresolved', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled' and h.starts_at + hearing_ends < now()
    ),
    'calendar_lost', (
      select count(*) from public.firm_calendars f where f.org_id = target_org and f.status = 'lost'
    ),
    'whatsapp', case
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active') then 'active'
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org) then 'disconnected'
      else 'none'
    end
  );
end;
$$;

revoke all on function public.firm_today(uuid) from public, anon;
grant execute on function public.firm_today(uuid) to authenticated;
