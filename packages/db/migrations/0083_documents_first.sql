-- ============================================================
-- 0083_documents_first: an agency registers a passenger and a trip from
-- their documents, typing only as the fallback.
--
-- The owner, 2026-11-03: ONE makes registration easy. The agency sends the
-- passenger's documents (an identity, a proof of address) and ONE reads them
-- into the record, which the agency confirms, adding only what no document
-- carries (the WhatsApp); a trip comes from its ticket, its boarding pass, a
-- screenshot of the booking (the airline's app, its site, the e-mail) or a
-- photo of the printed itinerary, whose legs ONE reads for the agency to
-- confirm. Typing everything stays, as the contingency.
--
--   pax_travelers.draft         a passenger the agency started from
--                               documents and never confirmed: left out of
--                               every list, count and link, under a name of
--                               no person until the identity gives one;
--                               forgotten after the setting's hours
--                               (`pax_forget_drafts`, the daily sweep).
--   pax_travelers.duplicate_of  the passenger of the partnership whose CPF
--                               the draft's identity carries.
--   pax_travelers.draft_cpf     the CPF a draft was given, kept apart from
--                               `cpf` until it is confirmed: a passenger
--                               nobody confirmed never holds a CPF against
--                               a save, the import, the API or the unique
--                               index of the partnership's CPFs.
--   pax_start_traveler          a draft, for somebody of the agency who
--                               writes (their own earlier drafts go).
--   pax_confirm_traveler        the agency confirms a draft with the fields
--                               it checked: saved as any passenger, a field
--                               left as ONE read it keeping its mark.
--   pax_reserve_document        a ticket or a boarding pass may wait for its
--                               trip: what ONE reads of it is kept on it.
--   pax_document_legs           the legs and the locator a trip's document
--                               gave, as the trip's form takes them.
--   pax_attach_trip_documents   the documents that waited are the trip's.
--   pax_apply_reading           a draft takes the identity's name whole, and
--                               learns whose the CPF read already is.
--   the reading's instructions  version 2: a screenshot of the booking or a
--                               photo of a printed document stands for the
--                               ticket, and the locator is read.
-- ============================================================

-- ---------- Settings ----------

update public.platform_settings
set value = value || jsonb_build_object(
  -- How long a draft waits for the agency to confirm it before it is forgotten, with its documents.
  'draft_hours', 24,
  -- The name a draft carries until its identity is read: no person's, and never shown in a list.
  'draft_name', 'Passageiro em cadastro'
)
where key = 'partners' and not value ? 'draft_hours';

-- ---------- The draft ----------

alter table public.pax_travelers add column draft boolean not null default false;
alter table public.pax_travelers add column duplicate_of uuid references public.pax_travelers (id) on delete set null;

create index pax_travelers_draft_idx on public.pax_travelers (created_at) where draft;

alter table public.pax_travelers add column draft_cpf text;
alter table public.pax_travelers add constraint pax_travelers_draft_cpf_check
  check (draft_cpf is null or (draft and draft_cpf ~ '^[0-9]{11}$'));

/**
 * A draft's CPF, whoever writes it (ONE's reading of the identity, a save), is kept in `draft_cpf` and never in
 * `cpf`; a passenger out of the draft keeps none there (`pax_confirm_traveler` writes the CPF it confirms).
 */
create or replace function public.pax_travelers_draft_cpf()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.draft then
    if new.cpf is not null then
      new.draft_cpf := new.cpf;
      new.cpf := null;
    end if;
  else
    new.draft_cpf := null;
  end if;
  return new;
end;
$$;

revoke all on function public.pax_travelers_draft_cpf() from public, anon, authenticated;

-- Named to fire before `pax_travelers_forget_read_fields` (a table's triggers of one event fire by name), which then
-- never sees a draft's CPF as changed.
create trigger pax_travelers_draft_cpf before insert or update on public.pax_travelers
  for each row execute function public.pax_travelers_draft_cpf();

/**
 * Somebody of the agency starts a passenger from documents: a draft, under a name of no person, that ONE's reading
 * of the identity names. The writer's earlier drafts of the partnership, never confirmed, go with their documents.
 */
create or replace function public.pax_start_traveler(target_partnership uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  stale uuid;
  new_id uuid;
begin
  link := public.pax_partnership_for_writer(target_partnership);
  for stale in
    select t.id from public.pax_travelers t
    where t.partnership_id = link.id and t.draft and t.created_by = auth.uid()
  loop
    perform public.pax_forget(stale, 'draft_replaced');
  end loop;
  insert into public.pax_travelers (partner_id, partnership_id, org_id, full_name, draft, created_by)
  values (
    link.partner_id, link.id, link.org_id,
    coalesce((select s.value ->> 'draft_name' from public.platform_settings s where s.key = 'partners'),
             'Passageiro em cadastro'),
    true, auth.uid()
  )
  returning id into new_id;
  return jsonb_build_object('ok', true, 'code', 'started', 'traveler_id', new_id);
end;
$$;

revoke all on function public.pax_start_traveler(uuid) from public, anon;
grant execute on function public.pax_start_traveler(uuid) to authenticated;

/**
 * The agency confirms a draft with the fields it checked: saved as any passenger is (`pax_save_traveler`), and from
 * then on in the lists. A field the agency left as ONE read it keeps its mark. The CPF is the one the agency sent,
 * or else the one the identity gave (`draft_cpf`); one a confirmed passenger holds is refused, naming them.
 */
create or replace function public.pax_confirm_traveler(
  target_traveler uuid,
  target_fields jsonb,
  target_guardian uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  link public.partner_links%rowtype;
  cleaned jsonb;
  confirmed_cpf text;
  holder uuid;
  saved jsonb;
begin
  select * into traveler from public.pax_travelers where id = target_traveler for update;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  link := public.pax_partnership_for_writer(traveler.partnership_id);
  if not traveler.draft then
    return jsonb_build_object('ok', false, 'code', 'not_draft');
  end if;
  cleaned := public.pax_clean_fields(target_fields);
  if not (cleaned ->> 'ok')::boolean then
    return cleaned;
  end if;
  if not (cleaned -> 'values') ? 'full_name'
     or (cleaned -> 'values' ->> 'full_name') = (select s.value ->> 'draft_name' from public.platform_settings s where s.key = 'partners') then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
  end if;
  confirmed_cpf := case when (cleaned -> 'values') ? 'cpf' then cleaned -> 'values' ->> 'cpf' else traveler.draft_cpf end;
  if confirmed_cpf is not null then
    select t.id into holder from public.pax_travelers t
    where t.partnership_id = link.id and t.cpf = confirmed_cpf and t.id <> traveler.id;
    if holder is not null then
      return jsonb_build_object('ok', false, 'code', 'cpf_in_use', 'field', 'cpf', 'traveler_id', holder);
    end if;
  end if;
  saved := public.pax_save_traveler(link.id, traveler.id, target_fields, target_guardian);
  if not (saved ->> 'ok')::boolean then
    return saved;
  end if;
  update public.pax_travelers set draft = false, cpf = confirmed_cpf, duplicate_of = null, updated_via = 'partner'
  where id = traveler.id;
  -- The CPF keeps its mark only as the very one the identity gave.
  if confirmed_cpf is not null and confirmed_cpf = traveler.draft_cpf and traveler.read_fields ? 'cpf' then
    update public.pax_travelers set read_fields = read_fields || jsonb_build_object('cpf', traveler.read_fields -> 'cpf')
    where id = traveler.id;
  else
    update public.pax_travelers set read_fields = read_fields - 'cpf' where id = traveler.id and read_fields ? 'cpf';
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.traveler.added', 'pax_traveler', traveler.id::text,
          jsonb_build_object('partner', link.partner_id, 'from_documents', true));
  return jsonb_build_object('ok', true, 'code', 'confirmed', 'traveler_id', traveler.id);
end;
$$;

revoke all on function public.pax_confirm_traveler(uuid, jsonb, uuid) from public, anon;
grant execute on function public.pax_confirm_traveler(uuid, jsonb, uuid) to authenticated;

/** Drafts nobody confirmed within the setting's hours go, with their documents. Service role: the daily sweep. */
create or replace function public.pax_forget_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stale uuid;
  forgotten integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for stale in
    select t.id from public.pax_travelers t
    where t.draft and t.created_at < now() - make_interval(hours => greatest(public.partner_setting('draft_hours', 24), 1))
  loop
    perform public.pax_forget(stale, 'draft_expired');
    forgotten := forgotten + 1;
  end loop;
  return forgotten;
end;
$$;

revoke all on function public.pax_forget_drafts() from public, anon, authenticated;
grant execute on function public.pax_forget_drafts() to service_role;

-- ---------- A trip's document that waits for its trip ----------

/**
 * 0070, redefined: the agency reserves the upload of a document of a passenger: an identity or a proof of address
 * of the person, a ticket or a boarding pass of a trip they are on, or one with no trip yet, whose legs ONE reads
 * for the trip the agency then confirms. The backend mints the signed upload URL for the path, then measures what
 * arrived (`pax_document_uploaded`).
 */
create or replace function public.pax_reserve_document(
  target_traveler uuid,
  target_kind text,
  target_trip uuid,
  target_name text,
  target_mime text,
  target_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  link public.partner_links%rowtype;
  problem text;
  reserved jsonb;
  document_id uuid;
begin
  select * into traveler from public.pax_travelers where id = target_traveler;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  link := public.pax_partnership_for_writer(traveler.partnership_id);
  if traveler.handed_over_at is not null then
    return jsonb_build_object('ok', false, 'code', 'handed_over');
  end if;
  if target_kind is null or target_kind not in ('identity', 'address_proof', 'ticket', 'boarding_pass') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if (target_trip is not null and not public.pax_kind_of_trip(target_kind))
     or (target_trip is not null and not exists (
       select 1 from public.pax_trip_travelers tt join public.pax_trips t on t.id = tt.trip_id
       where tt.trip_id = target_trip and tt.traveler_id = traveler.id and t.partnership_id = link.id)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_trip');
  end if;
  problem := public.file_reservation_problem(public.file_purpose_rule('pax_document'), target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;
  reserved := public.pax_insert_file_reservation(link.org_id, link.partner_id, target_name, target_mime, target_bytes, auth.uid());
  insert into public.pax_documents (partner_id, org_id, traveler_id, trip_id, kind, file_id, source, created_by)
  values (link.partner_id, link.org_id, traveler.id, target_trip, target_kind, (reserved ->> 'file_id')::uuid, 'partner', auth.uid())
  returning id into document_id;
  return reserved || jsonb_build_object('ok', true, 'code', 'reserved', 'document_id', document_id);
end;
$$;

revoke all on function public.pax_reserve_document(uuid, text, uuid, text, text, bigint) from public, anon;
grant execute on function public.pax_reserve_document(uuid, text, uuid, text, text, bigint) to authenticated;

/**
 * The legs and the locator a trip's document gave, once ONE read it as what it was said to be and it was legible,
 * as the trip's form takes them; `ok` false with the code of the first leg the checks of a leg refuse (the agency
 * then corrects it in the form). For somebody of the agency.
 */
create or replace function public.pax_document_legs(target_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  document public.pax_documents%rowtype;
  leg jsonb;
  legs jsonb := '[]'::jsonb;
  locator text;
begin
  select * into document from public.pax_documents where id = target_document;
  if not found or not public.is_partner_member(document.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.pax_kind_of_trip(document.kind) then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if document.reading <> 'done' then
    return jsonb_build_object('ok', false, 'code', case when document.reading = 'failed' then 'read_failed' else 'reading' end);
  end if;
  if coalesce(document.read_output ->> 'confere_tipo', '') <> 'sim'
     or coalesce((document.read_output ->> 'legivel')::boolean, false) is not true
     or jsonb_typeof(document.read_output -> 'trechos') is distinct from 'array'
     or jsonb_array_length(document.read_output -> 'trechos') = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_legs', 'note', document.read_output ->> 'observacoes');
  end if;
  for leg in select value from jsonb_array_elements(document.read_output -> 'trechos') limit 6 loop
    legs := legs || jsonb_build_object(
      'flight_number', leg ->> 'voo', 'origin_iata', leg ->> 'origem', 'destination_iata', leg ->> 'destino',
      'departure', leg ->> 'saida_prevista', 'arrival', leg ->> 'chegada_prevista');
    locator := coalesce(locator, nullif(upper(btrim(coalesce(leg ->> 'reserva', ''))), ''));
  end loop;
  return public.pax_clean_legs(legs) || jsonb_build_object('read', legs, 'locator', locator);
end;
$$;

revoke all on function public.pax_document_legs(uuid) from public, anon;
grant execute on function public.pax_document_legs(uuid) to authenticated;

/**
 * The trip's documents that waited for it (a ticket or a boarding pass of one of its travelers, with no trip yet)
 * are the trip's now, once the agency confirmed it. For somebody of the agency who writes.
 */
create or replace function public.pax_attach_trip_documents(target_trip uuid, target_documents uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.pax_trips%rowtype;
  attached integer;
begin
  select * into trip from public.pax_trips where id = target_trip;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.pax_partnership_for_writer(trip.partnership_id);
  update public.pax_documents d set trip_id = trip.id
  where d.id = any (coalesce(target_documents, '{}')) and d.trip_id is null and public.pax_kind_of_trip(d.kind)
    and d.partner_id = trip.partner_id
    and d.traveler_id in (select tt.traveler_id from public.pax_trip_travelers tt where tt.trip_id = trip.id);
  get diagnostics attached = row_count;
  return jsonb_build_object('ok', true, 'code', 'attached', 'attached', attached);
end;
$$;

revoke all on function public.pax_attach_trip_documents(uuid, uuid[]) from public, anon;
grant execute on function public.pax_attach_trip_documents(uuid, uuid[]) to authenticated;

-- ---------- What a reading writes ----------

/** 0070, redefined: a draft's documents are read with no name of a person beside them. Service role. */
create or replace function public.pax_document_to_read(target_document uuid, target_claim integer)
returns table (
  document_id uuid, org_id uuid, kind text, storage_path text, detected_mime text, sha256 text,
  traveler_name text, attempt integer
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
  select d.id, d.org_id, d.kind, f.storage_path, f.detected_mime, f.sha256,
         case when t.draft then null else t.full_name end, d.reading_attempts
  from public.pax_documents d
  join public.files f on f.id = d.file_id
  join public.pax_travelers t on t.id = d.traveler_id
  where d.id = target_document and d.reading = 'working' and d.reading_claims = target_claim;
end;
$$;

revoke all on function public.pax_document_to_read(uuid, integer) from public, anon, authenticated;

/**
 * 0074, redefined: a draft takes the identity's name whole (it has none of its own to complete), and learns whose
 * the CPF read already is when a confirmed passenger of the partnership has it; everything else as before.
 */
create or replace function public.pax_apply_reading(target_document uuid, target_output jsonb)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.pax_documents%rowtype;
  traveler public.pax_travelers%rowtype;
  data jsonb := target_output -> 'dados_lidos';
  read_value text;
  fields jsonb := '{}'::jsonb;
  cleaned jsonb;
  applied jsonb;
  written text[] := '{}';
  address jsonb;
  leg jsonb;
  legs jsonb := '[]'::jsonb;
  holder uuid;
begin
  select * into document from public.pax_documents where id = target_document;
  if not found or coalesce(target_output ->> 'confere_tipo', '') <> 'sim'
     or coalesce((target_output ->> 'legivel')::boolean, false) is not true then
    return written;
  end if;
  select * into traveler from public.pax_travelers where id = document.traveler_id for update;
  if not found or traveler.handed_over_at is not null then
    return written;
  end if;
  if document.kind = 'identity' and jsonb_typeof(data) = 'object' then
    read_value := regexp_replace(btrim(coalesce(data ->> 'nome_completo', '')), '\s+', ' ', 'g');
    if read_value <> '' and not traveler.read_fields ? 'full_name' then
      -- A draft has no name of a person to complete: the identity gives it whole.
      if not traveler.draft then
        read_value := public.completed_name(traveler.full_name, read_value);
      end if;
      if read_value is not null then
        fields := fields || jsonb_build_object('full_name', read_value);
      end if;
    end if;
    read_value := regexp_replace(coalesce(data ->> 'cpf', ''), '\D', '', 'g');
    -- A draft's CPF is in `draft_cpf` (its `cpf` is always empty), and only a confirmed passenger holds one in `cpf`.
    if coalesce(traveler.cpf, traveler.draft_cpf) is null and read_value ~ '^[0-9]{11}$' and public.cpf_is_valid(read_value) then
      select t.id into holder from public.pax_travelers t
      where t.partnership_id = traveler.partnership_id and t.cpf = read_value and t.id <> traveler.id
      limit 1;
      if holder is null then
        fields := fields || jsonb_build_object('cpf', read_value);
      elsif traveler.draft then
        update public.pax_travelers set duplicate_of = holder where id = traveler.id;
      end if;
    end if;
    read_value := btrim(coalesce(data ->> 'data_nascimento', ''));
    if traveler.birth_date is null and read_value <> ''
       and coalesce((public.pax_clean_fields(jsonb_build_object('birth_date', read_value)) ->> 'ok')::boolean, false) then
      fields := fields || jsonb_build_object('birth_date', read_value);
    end if;
    read_value := lower(regexp_replace(btrim(coalesce(data ->> 'nacionalidade', '')), '\s+', ' ', 'g'));
    if traveler.nationality is null and read_value <> ''
       and not public.pax_is_minor(coalesce(traveler.birth_date, nullif(fields ->> 'birth_date', '')::date)) then
      fields := fields || jsonb_build_object('nationality', read_value);
    end if;
  elsif document.kind = 'address_proof' and jsonb_typeof(data) = 'object'
        and traveler.postal_code is null and traveler.street is null and traveler.city is null then
    address := jsonb_strip_nulls(jsonb_build_object(
      'postal_code', nullif(regexp_replace(coalesce(data ->> 'cep', ''), '\D', '', 'g'), ''),
      'street', nullif(regexp_replace(btrim(coalesce(data ->> 'logradouro', '')), '\s+', ' ', 'g'), ''),
      'address_number', nullif(regexp_replace(btrim(coalesce(data ->> 'numero', '')), '\s+', ' ', 'g'), ''),
      'complement', nullif(regexp_replace(btrim(coalesce(data ->> 'complemento', '')), '\s+', ' ', 'g'), ''),
      'district', nullif(regexp_replace(btrim(coalesce(data ->> 'bairro', '')), '\s+', ' ', 'g'), ''),
      'city', nullif(regexp_replace(btrim(coalesce(data ->> 'cidade', '')), '\s+', ' ', 'g'), ''),
      'uf', nullif(upper(btrim(coalesce(data ->> 'uf', ''))), '')
    ));
    if address ? 'postal_code' and address ? 'street' and address ? 'city' and address ? 'uf' then
      fields := fields || address;
    end if;
  elsif public.pax_kind_of_trip(document.kind) and document.trip_id is not null
        and not exists (select 1 from public.pax_trip_legs l where l.trip_id = document.trip_id)
        and jsonb_typeof(target_output -> 'trechos') = 'array' then
    for leg in select value from jsonb_array_elements(target_output -> 'trechos') limit 6 loop
      legs := legs || jsonb_build_object(
        'flight_number', leg ->> 'voo', 'origin_iata', leg ->> 'origem', 'destination_iata', leg ->> 'destino',
        'departure', leg ->> 'saida_prevista', 'arrival', leg ->> 'chegada_prevista');
    end loop;
    legs := public.pax_clean_legs(legs);
    if (legs ->> 'ok')::boolean then
      for leg in select value from jsonb_array_elements(legs -> 'legs') loop
        insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                          scheduled_departure_local, scheduled_arrival_local)
        values (document.trip_id, (leg ->> 'position')::integer, leg ->> 'flight_number', leg ->> 'origin_iata',
                leg ->> 'destination_iata', (leg ->> 'departure')::timestamp, (leg ->> 'arrival')::timestamp);
      end loop;
      perform public.pax_sync_tracked_trip(document.trip_id);
      written := written || 'legs'::text;
    end if;
  end if;
  if fields <> '{}'::jsonb then
    cleaned := public.pax_clean_fields(fields);
    if (cleaned ->> 'ok')::boolean then
      applied := public.pax_apply_fields(traveler.id, cleaned -> 'values', 'document');
      if (applied ->> 'ok')::boolean then
        written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
      end if;
    end if;
  end if;
  if cardinality(array_remove(written, 'legs')) > 0 then
    update public.pax_travelers
    set read_fields = read_fields || (
      select jsonb_object_agg(field, jsonb_build_object('document', document.id, 'kind', document.kind))
      from unnest(array_remove(written, 'legs')) as field
    )
    where id = traveler.id;
  end if;
  return written;
end;
$$;

revoke all on function public.pax_apply_reading(uuid, jsonb) from public, anon, authenticated;

-- ---------- Drafts out of the lists, the counts and the links ----------

/** 0070, redefined: a draft is in no page of the list. */
create or replace function public.pax_travelers_page(
  target_partnership uuid,
  target_search text default null,
  target_filter text default 'all',
  target_limit integer default 25,
  target_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  term text := nullif(lower(public.plain_name(btrim(coalesce(target_search, '')))), '');
  digits text := nullif(regexp_replace(coalesce(target_search, ''), '\D', '', 'g'), '');
  page_size integer := greatest(least(coalesce(target_limit, 25), 100), 1);
  rows jsonb;
  total integer;
begin
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  with matched as (
    select t.*,
      public.pax_consent_state(coalesce(t.guardian_id, t.id)) as consent,
      (select min(l.scheduled_departure_local) from public.pax_trip_legs l
       join public.pax_trip_travelers tt on tt.trip_id = l.trip_id
       where tt.traveler_id = t.id and l.scheduled_departure_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day') as next_departure
    from public.pax_travelers t
    where t.partnership_id = link.id and not t.draft
      -- A name by its words in any order; a CPF by how it starts.
      and (term is null
           or not exists (
             select 1 from unnest(string_to_array(term, ' ')) as word
             where word <> '' and strpos(lower(public.plain_name(t.full_name)), word) = 0)
           or (digits is not null and char_length(digits) >= 3 and t.cpf like digits || '%'))
  ), filtered as (
    select * from matched m
    where case coalesce(target_filter, 'all')
      when 'waiting_consent' then m.handed_over_at is null and coalesce(m.consent, 'none') <> 'agreed'
      when 'missing_identity' then m.handed_over_at is null and not exists (
        select 1 from public.pax_documents d where d.traveler_id = m.id and d.kind = 'identity' and d.reading <> 'uploading')
      when 'upcoming' then m.next_departure is not null
        and m.next_departure <= (now() at time zone 'America/Sao_Paulo') + interval '48 hours'
      else true end
  ), ordered as (
    select f.*, row_number() over (order by f.next_departure nulls last, f.created_at desc) as ord
    from filtered f
  )
  -- The total counts the whole list, also for a page past its end; only the page's rows are read whole.
  select (select count(*) from ordered)::integer,
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'full_name', o.full_name, 'cpf', o.cpf, 'birth_date', o.birth_date, 'phone', o.phone,
          'guardian_id', o.guardian_id, 'minor', public.pax_is_minor(o.birth_date), 'consent', o.consent,
          'next_departure', o.next_departure, 'handed_over_at', o.handed_over_at,
          'kinds', (select coalesce(jsonb_agg(distinct d.kind), '[]'::jsonb) from public.pax_documents d
                    where d.traveler_id = o.id and d.reading <> 'uploading'),
          'reading', coalesce((select bool_or(d.reading in ('pending', 'working')) from public.pax_documents d
                               where d.traveler_id = o.id), false))
        order by o.ord)
      from ordered o
      where o.ord > greatest(coalesce(target_offset, 0), 0) and o.ord <= greatest(coalesce(target_offset, 0), 0) + page_size
    ), '[]'::jsonb)
  into total, rows;
  return jsonb_build_object('rows', rows, 'total', total);
end;
$$;

revoke all on function public.pax_travelers_page(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.pax_travelers_page(uuid, text, text, integer, integer) to authenticated;

/** 0070, redefined: what the agency's home counts of a partnership leaves the drafts out. */
create or replace function public.pax_overview(target_partnership uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
begin
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'travelers', (select count(*) from public.pax_travelers t
                  where t.partnership_id = link.id and t.handed_over_at is null and not t.draft),
    'adults_waiting', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and t.handed_over_at is null and not t.draft
        and not public.pax_is_minor(t.birth_date)
        and coalesce(public.pax_consent_state(t.id), 'none') <> 'agreed'
        and exists (select 1 from public.pax_trips trip where trip.holder_id = t.id)
    ),
    'missing_identity', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and t.handed_over_at is null and not t.draft
        and not exists (select 1 from public.pax_documents d where d.traveler_id = t.id and d.kind = 'identity'
                        and d.reading <> 'uploading')
    ),
    'upcoming', (
      select count(distinct trip.id) from public.pax_trips trip join public.pax_trip_legs l on l.trip_id = trip.id
      where trip.partnership_id = link.id and l.position = 1
        and l.scheduled_departure_local between (now() at time zone 'America/Sao_Paulo') - interval '6 hours'
                                            and (now() at time zone 'America/Sao_Paulo') + interval '48 hours'
    ),
    'watched', (
      select count(*) from public.pax_trips trip
      where trip.partnership_id = link.id and public.pax_trip_state(trip.id) in ('watching', 'alerted')
    ),
    'consent_term', (select max(t.version) from public.pax_consent_terms t where t.partner_id = link.partner_id)
  );
end;
$$;

revoke all on function public.pax_overview(uuid) from public, anon;
grant execute on function public.pax_overview(uuid) to authenticated;

/** 0070, redefined: a draft has no link, since nothing of it was confirmed. */
create or replace function public.pax_issue_confirm_link(target_traveler uuid, target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  link public.partner_links%rowtype;
  until timestamptz;
begin
  select * into traveler from public.pax_travelers where id = target_traveler;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  link := public.pax_partnership_for_writer(traveler.partnership_id);
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token_hash' using errcode = '22023';
  end if;
  if traveler.draft then
    return jsonb_build_object('ok', false, 'code', 'draft');
  end if;
  if public.pax_is_minor(traveler.birth_date) then
    return jsonb_build_object('ok', false, 'code', 'holder_is_minor');
  end if;
  if traveler.handed_over_at is not null then
    return jsonb_build_object('ok', false, 'code', 'handed_over');
  end if;
  if not exists (select 1 from public.pax_consent_terms t where t.partner_id = link.partner_id) then
    return jsonb_build_object('ok', false, 'code', 'no_consent_term');
  end if;
  until := now() + make_interval(days => greatest(public.partner_setting('confirm_link_days', 30), 1));
  update public.pax_confirm_links set ended_at = now() where holder_id = traveler.id and ended_at is null;
  insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, created_by, expires_at)
  values (link.partner_id, link.id, link.org_id, traveler.id, target_token_hash, auth.uid(), until);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.confirm_link.issued', 'pax_traveler', traveler.id::text, jsonb_build_object('partner', link.partner_id));
  return jsonb_build_object('ok', true, 'code', 'issued', 'expires_at', until);
end;
$$;

revoke all on function public.pax_issue_confirm_link(uuid, text) from public, anon;
grant execute on function public.pax_issue_confirm_link(uuid, text) to authenticated;

-- ---------- The reading's instructions, version 2 ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'parceiro.documento.leitura', 2, v.provider, v.model, v.effort,
  replace(
    replace(
      v.system_prompt,
      '- trechos: só para bilhete ou cartão de embarque, cada trecho de voo que aparece:',
      '- trechos: só para bilhete ou cartão de embarque, cada trecho de voo que aparece. Um print de tela da reserva (do aplicativo ou do site da companhia, do e-mail de confirmação ou da agência) e a foto de um bilhete, de um cartão de embarque ou de um itinerário impresso valem como bilhete: o que importa é o que está escrito neles. Para cada trecho:'
    ),
    'Você recebe o arquivo (uma foto ou um PDF)',
    'Você recebe o arquivo (uma foto, um print de tela ou um PDF)'
  ),
  v.output_schema, v.max_tokens, false,
  'A segunda versão: um print de tela da reserva ou a foto do documento impresso valem como bilhete, e o cadastro da agência começa pelos documentos.'
from public.prompt_versions v
where v.task = 'parceiro.documento.leitura' and v.version = 1
  and not exists (select 1 from public.prompt_versions w where w.task = 'parceiro.documento.leitura' and w.version = 2);

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'parceiro.documento.leitura' and v.is_active
  and exists (select 1 from public.prompt_versions w where w.task = v.task and w.version = 2);
update public.prompt_versions set is_active = true
where task = 'parceiro.documento.leitura' and version = 2
  and not exists (select 1 from public.prompt_versions w where w.task = 'parceiro.documento.leitura' and w.is_active);
