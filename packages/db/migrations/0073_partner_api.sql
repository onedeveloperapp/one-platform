-- ============================================================
-- 0073_partner_api: an agency sends its passengers from its own system.
--
-- Sixth phase of the plan the owner approved on 2026-10-29, after the first
-- five: besides the screens and the spreadsheet (0070), who manages a travel
-- agency creates keys for its own booking system to send ONE the passengers
-- and trips of the partnership (the same lines as a spreadsheet, written the
-- same way: `pax_import_rows_core`), to issue a passenger's link, and to read
-- where a passenger stands. A key is the agency's, of one partnership, shown
-- once and kept as its SHA-256 alone; each call is the backend's, which reads
-- the key from the request (`pax_api_key_use`): a key revoked, of a
-- partnership that ended or of a module the firm no longer uses answers
-- nothing, and a key calls at most the setting's times a minute. What a key
-- did is on the record as the API's, never as a person's.
-- ============================================================

update public.platform_settings
set value = value || jsonb_build_object(
  -- How many calls a key makes in a minute, and how many keys a partnership has at once.
  'api_calls_per_minute', 60,
  'api_keys_per_partnership', 5
)
where key = 'partners' and not (value ? 'api_calls_per_minute');

-- ---------- The keys ----------

create table public.partner_api_keys (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  partnership_id uuid not null references public.partner_links (id) on delete cascade,
  label text not null,
  -- The start of the key, to tell keys apart on the screen; the key itself is never kept.
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  -- The calls of the current minute.
  window_start timestamptz,
  window_calls integer not null default 0,
  constraint partner_api_keys_label_check check (char_length(btrim(label)) between 2 and 60 and label !~ '[[:cntrl:]]'),
  constraint partner_api_keys_prefix_check check (key_prefix ~ '^[A-Za-z0-9_-]{6,12}$'),
  constraint partner_api_keys_hash_check check (key_hash ~ '^[0-9a-f]{64}$')
);

create index partner_api_keys_partnership_idx on public.partner_api_keys (partnership_id) where revoked_at is null;

alter table public.partner_api_keys enable row level security;
create policy "partner_api_keys_select_partner" on public.partner_api_keys
  for select to authenticated using (public.is_partner_member(partner_id));
-- The hash of a key and its count of calls are nobody's to read.
grant select (id, partner_id, partnership_id, label, key_prefix, created_by, created_at, last_used_at, revoked_at)
  on table public.partner_api_keys to authenticated;
create trigger guard_impersonation_partner_api_keys after insert or update or delete on public.partner_api_keys
  for each statement execute function public.guard_impersonation_readonly();

/** Who manages an agency creates a key of a partnership: shown once by the app, kept here as its hash alone. */
create or replace function public.pax_create_api_key(
  target_partnership uuid,
  target_label text,
  target_key_hash text,
  target_key_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  label text := regexp_replace(btrim(coalesce(target_label, '')), '\s+', ' ', 'g');
  new_id uuid;
begin
  link := public.pax_partnership_for_writer(target_partnership);
  if not public.has_partner_role(link.partner_id, array['owner', 'admin']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(label) not between 2 and 60 or label ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'invalid_label');
  end if;
  if coalesce(target_key_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(target_key_prefix, '') !~ '^[A-Za-z0-9_-]{6,12}$' then
    raise exception 'invalid_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pax-api-keys:' || link.id::text, 0));
  if (select count(*) from public.partner_api_keys k where k.partnership_id = link.id and k.revoked_at is null)
     >= greatest(public.partner_setting('api_keys_per_partnership', 5), 1) then
    return jsonb_build_object('ok', false, 'code', 'too_many_keys');
  end if;
  insert into public.partner_api_keys (partner_id, partnership_id, label, key_prefix, key_hash, created_by)
  values (link.partner_id, link.id, label, target_key_prefix, target_key_hash, auth.uid())
  returning id into new_id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.api_key.created', 'partner', link.partner_id::text,
          jsonb_build_object('key', new_id, 'partnership', link.id));
  return jsonb_build_object('ok', true, 'code', 'created', 'key_id', new_id);
end;
$$;

revoke all on function public.pax_create_api_key(uuid, text, text, text) from public, anon;
grant execute on function public.pax_create_api_key(uuid, text, text, text) to authenticated;

/** Who manages the agency revokes a key: it answers nothing from then on. */
create or replace function public.pax_revoke_api_key(target_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  key public.partner_api_keys%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into key from public.partner_api_keys where id = target_key for update;
  if not found or not public.has_partner_role(key.partner_id, array['owner', 'admin']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if key.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;
  update public.partner_api_keys set revoked_at = now(), revoked_by = auth.uid() where id = key.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.api_key.revoked', 'partner', key.partner_id::text, jsonb_build_object('key', key.id));
  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

revoke all on function public.pax_revoke_api_key(uuid) from public, anon;
grant execute on function public.pax_revoke_api_key(uuid) to authenticated;

/**
 * A call of a key: the partnership it is of, while the key and the partnership hold and within the setting's calls a
 * minute, or why not (`invalid_key`, `partnership_ended`, `rate_limited`). Counts the call. Internal.
 */
create or replace function public.pax_api_key_use(target_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  key public.partner_api_keys%rowtype;
  link public.partner_links%rowtype;
  per_minute integer := greatest(public.partner_setting('api_calls_per_minute', 60), 1);
begin
  select * into key from public.partner_api_keys
  where key_hash = coalesce(target_key_hash, '') and revoked_at is null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_key');
  end if;
  select * into link from public.partner_links where id = key.partnership_id;
  if link.status <> 'active' or not public.firm_uses_module(link.org_id, link.module_key) then
    return jsonb_build_object('ok', false, 'code', 'partnership_ended');
  end if;
  if key.window_start is not null and key.window_start > now() - interval '1 minute' then
    if key.window_calls >= per_minute then
      return jsonb_build_object('ok', false, 'code', 'rate_limited');
    end if;
    update public.partner_api_keys set window_calls = window_calls + 1, last_used_at = now() where id = key.id;
  else
    update public.partner_api_keys set window_start = now(), window_calls = 1, last_used_at = now() where id = key.id;
  end if;
  return jsonb_build_object('ok', true, 'partnership_id', link.id, 'partner_id', link.partner_id, 'org_id', link.org_id);
end;
$$;

revoke all on function public.pax_api_key_use(text) from public, anon, authenticated;

-- ---------- What a key does ----------

/** The lines of a spreadsheet, written for a partnership by the screen or by a key. Internal. */
create or replace function public.pax_import_rows_core(target_partnership uuid, target_rows jsonb, target_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  row_data jsonb;
  line integer;
  cleaned jsonb;
  row_values jsonb;
  found_traveler uuid;
  trip public.pax_trips%rowtype;
  row_locator text;
  legs jsonb;
  leg jsonb;
  added integer := 0;
  matched integer := 0;
  trips_added integer := 0;
  legs_added integer := 0;
  problems jsonb := '[]'::jsonb;
  next_position integer;
  -- The counts before a line: a line undone by an error counts nothing.
  counted integer[];
begin
  select * into link from public.partner_links where id = target_partnership;
  if jsonb_typeof(target_rows) is distinct from 'array'
     or jsonb_array_length(target_rows) > greatest(public.partner_setting('import_rows_per_call', 200), 1) then
    return jsonb_build_object('ok', false, 'code', 'invalid_rows');
  end if;
  for row_data in select value from jsonb_array_elements(target_rows) loop
    line := case when coalesce(row_data ->> 'line', '') ~ '^[0-9]{1,7}$' then (row_data ->> 'line')::integer end;
    counted := array[added, matched, trips_added, legs_added];
    begin
      cleaned := public.pax_clean_fields(jsonb_strip_nulls(jsonb_build_object(
        'full_name', row_data ->> 'nome', 'cpf', row_data ->> 'cpf', 'birth_date', row_data ->> 'nascimento',
        'phone', row_data ->> 'whatsapp', 'email', row_data ->> 'email')));
      if not (cleaned ->> 'ok')::boolean then
        problems := problems || jsonb_build_object('line', line, 'code', cleaned ->> 'code', 'field', cleaned ->> 'field');
        continue;
      end if;
      row_values := cleaned -> 'values';
      if not row_values ? 'full_name' then
        problems := problems || jsonb_build_object('line', line, 'code', 'invalid_name', 'field', 'full_name');
        continue;
      end if;
      found_traveler := null;
      if row_values ->> 'cpf' is not null then
        select t.id into found_traveler from public.pax_travelers t where t.partnership_id = link.id and t.cpf = row_values ->> 'cpf';
      end if;
      if found_traveler is null and row_values ->> 'birth_date' is not null then
        select t.id into found_traveler from public.pax_travelers t
        where t.partnership_id = link.id and public.plain_name(t.full_name) = public.plain_name(row_values ->> 'full_name')
          and t.birth_date = (row_values ->> 'birth_date')::date
        limit 1;
      end if;
      if found_traveler is null then
        insert into public.pax_travelers (partner_id, partnership_id, org_id, full_name, created_by)
        values (link.partner_id, link.id, link.org_id, row_values ->> 'full_name', auth.uid())
        returning id into found_traveler;
        perform public.pax_apply_fields(found_traveler, row_values - 'full_name', 'partner');
        added := added + 1;
      else
        -- What the spreadsheet says fills what the record lacks; what is on record stays.
        perform public.pax_apply_fields(found_traveler, (
          select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
          from jsonb_each(row_values - 'full_name') as item
          where to_jsonb(t) -> item.key = 'null'::jsonb
        ), 'partner')
        from public.pax_travelers t where t.id = found_traveler;
        matched := matched + 1;
      end if;

      row_locator := nullif(upper(regexp_replace(coalesce(row_data ->> 'localizador', ''), '\s+', '', 'g')), '');
      if row_locator is not null then
        if row_locator !~ '^[A-Z0-9]{5,8}$' then
          problems := problems || jsonb_build_object('line', line, 'code', 'invalid_locator', 'field', 'locator');
          continue;
        end if;
        select * into trip from public.pax_trips t where t.partnership_id = link.id and t.locator = row_locator
        order by t.created_at limit 1 for update;
        if trip.id is null then
          if public.pax_is_minor((row_values ->> 'birth_date')::date) then
            problems := problems || jsonb_build_object('line', line, 'code', 'holder_is_minor', 'field', 'nascimento');
            continue;
          end if;
          insert into public.pax_trips (partner_id, partnership_id, org_id, holder_id, locator, created_by)
          values (link.partner_id, link.id, link.org_id, found_traveler, row_locator, auth.uid())
          returning * into trip;
          trips_added := trips_added + 1;
        end if;
        insert into public.pax_trip_travelers (trip_id, traveler_id) values (trip.id, found_traveler) on conflict do nothing;
        if coalesce(row_data ->> 'voo', '') <> '' then
          legs := public.pax_clean_legs(jsonb_build_array(jsonb_build_object(
            'flight_number', row_data ->> 'voo', 'origin_iata', row_data ->> 'origem',
            'destination_iata', row_data ->> 'destino', 'departure', row_data ->> 'partida',
            'arrival', row_data ->> 'chegada')));
          if not (legs ->> 'ok')::boolean then
            problems := problems || jsonb_build_object('line', line, 'code', legs ->> 'code', 'field', 'leg');
            trip := null;
            continue;
          end if;
          leg := legs -> 'legs' -> 0;
          if not exists (
            select 1 from public.pax_trip_legs l where l.trip_id = trip.id and l.flight_number = leg ->> 'flight_number'
              and l.scheduled_departure_local = (leg ->> 'departure')::timestamp
          ) then
            select coalesce(max(l.position), 0) + 1 into next_position from public.pax_trip_legs l where l.trip_id = trip.id;
            if next_position > 6 then
              problems := problems || jsonb_build_object('line', line, 'code', 'too_many_legs', 'field', 'leg');
            else
              insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                                scheduled_departure_local, scheduled_arrival_local)
              values (trip.id, next_position, leg ->> 'flight_number', leg ->> 'origin_iata', leg ->> 'destination_iata',
                      (leg ->> 'departure')::timestamp, (leg ->> 'arrival')::timestamp);
              legs_added := legs_added + 1;
            end if;
          end if;
        end if;
        perform public.pax_sync_tracked_trip(trip.id);
        trip := null;
      end if;
    exception when others then
      added := counted[1];
      matched := counted[2];
      trips_added := counted[3];
      legs_added := counted[4];
      problems := problems || jsonb_build_object('line', line, 'code', 'not_written');
      trip := null;
    end;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.import', 'partner', link.partner_id::text,
          jsonb_build_object('added', added, 'matched', matched, 'trips', trips_added, 'legs', legs_added,
                             'refused', jsonb_array_length(problems), 'via', target_via));
  return jsonb_build_object('ok', true, 'code', 'imported', 'added', added, 'matched', matched,
                            'trips_added', trips_added, 'legs_added', legs_added, 'problems', problems);
end;
$$;

revoke all on function public.pax_import_rows_core(uuid, jsonb, text) from public, anon, authenticated;

/** 0070, redefined: the lines of a spreadsheet the agency's screen sends, written by the same core as the API's. */
create or replace function public.pax_import_rows(target_partnership uuid, target_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
begin
  link := public.pax_partnership_for_writer(target_partnership);
  return public.pax_import_rows_core(link.id, target_rows, 'screen');
end;
$$;

revoke all on function public.pax_import_rows(uuid, jsonb) from public, anon;
grant execute on function public.pax_import_rows(uuid, jsonb) to authenticated;

/** The lines a key sends: passengers and their trips, as a spreadsheet's (`pax_import_rows_core`). Service role. */
create or replace function public.pax_api_import(target_key_hash text, target_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  used jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  used := public.pax_api_key_use(target_key_hash);
  if not (used ->> 'ok')::boolean then
    return used;
  end if;
  return public.pax_import_rows_core((used ->> 'partnership_id')::uuid, target_rows, 'api');
end;
$$;

revoke all on function public.pax_api_import(text, jsonb) from public, anon, authenticated;

/** The passenger of a partnership a key names by CPF, or null. Internal. */
create or replace function public.pax_api_traveler(target_partnership uuid, target_cpf text)
returns public.pax_travelers
language sql
stable
security definer
set search_path = public
as $$
  select t.* from public.pax_travelers t
  where t.partnership_id = target_partnership
    and t.cpf = nullif(regexp_replace(coalesce(target_cpf, ''), '\D', '', 'g'), '');
$$;

revoke all on function public.pax_api_traveler(uuid, text) from public, anon, authenticated;

/**
 * A key issues the link of a passenger it names by CPF, as the agency's screen does (`pax_issue_confirm_link`): for
 * an adult not handed over, once the agency registered its clause; the link the passenger had ends. Service role.
 */
create or replace function public.pax_api_issue_link(target_key_hash text, target_cpf text, target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  used jsonb;
  traveler public.pax_travelers%rowtype;
  until timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  used := public.pax_api_key_use(target_key_hash);
  if not (used ->> 'ok')::boolean then
    return used;
  end if;
  traveler := public.pax_api_traveler((used ->> 'partnership_id')::uuid, target_cpf);
  if traveler.id is null then
    return jsonb_build_object('ok', false, 'code', 'traveler_not_found');
  end if;
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token_hash' using errcode = '22023';
  end if;
  if public.pax_is_minor(traveler.birth_date) then
    return jsonb_build_object('ok', false, 'code', 'holder_is_minor');
  end if;
  if traveler.handed_over_at is not null then
    return jsonb_build_object('ok', false, 'code', 'handed_over');
  end if;
  if not exists (select 1 from public.pax_consent_terms t where t.partner_id = traveler.partner_id) then
    return jsonb_build_object('ok', false, 'code', 'no_consent_term');
  end if;
  until := now() + make_interval(days => greatest(public.partner_setting('confirm_link_days', 30), 1));
  update public.pax_confirm_links set ended_at = now() where holder_id = traveler.id and ended_at is null;
  insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, created_by, expires_at)
  values (traveler.partner_id, traveler.partnership_id, traveler.org_id, traveler.id, target_token_hash, null, until);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'pax.confirm_link.issued', 'pax_traveler', traveler.id::text,
          jsonb_build_object('partner', traveler.partner_id, 'via', 'api'));
  return jsonb_build_object('ok', true, 'code', 'issued', 'expires_at', until);
end;
$$;

revoke all on function public.pax_api_issue_link(text, text, text) from public, anon, authenticated;

/**
 * Where a passenger a key names by CPF stands: whether they agreed (theirs, or for a child the adult's who answers
 * for them), whether they went to the firm, whether their link is open, and each trip they are on with what ONE
 * does of it. Service role.
 */
create or replace function public.pax_api_status(target_key_hash text, target_cpf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  used jsonb;
  traveler public.pax_travelers%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  used := public.pax_api_key_use(target_key_hash);
  if not (used ->> 'ok')::boolean then
    return used;
  end if;
  traveler := public.pax_api_traveler((used ->> 'partnership_id')::uuid, target_cpf);
  if traveler.id is null then
    return jsonb_build_object('ok', false, 'code', 'traveler_not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'acordo', coalesce(public.pax_consent_state(coalesce(traveler.guardian_id, traveler.id)), 'sem_resposta'),
    'com_o_escritorio', traveler.handed_over_at is not null,
    'link_aberto', exists (select 1 from public.pax_confirm_links l
                           where l.holder_id = coalesce(traveler.guardian_id, traveler.id)
                             and l.ended_at is null and l.expires_at > now()),
    'viagens', coalesce((
      select jsonb_agg(jsonb_build_object('localizador', trip.locator, 'acompanhamento', public.pax_trip_state(trip.id))
                       order by trip.created_at)
      from public.pax_trips trip
      where trip.id in (select tt.trip_id from public.pax_trip_travelers tt where tt.traveler_id = traveler.id)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pax_api_status(text, text) from public, anon, authenticated;
