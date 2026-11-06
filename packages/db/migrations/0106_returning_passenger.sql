-- ============================================================
-- 0106_returning_passenger: a passenger whose trip became a case stays the
-- agency's for their next trips (the owner's decision of 2026-11-05).
--
-- Once a passenger said yes and the firm opened their case, the agency's
-- record was closed ("Com o escritório", `handed_over_at`): the agency could
-- still register a next trip, but not ask the passenger's agreement to it,
-- send its documents nor update the record, the passenger could not agree
-- on the link, and the screens said nothing of it, so ONE never followed the
-- next flight; the record went 30 days after the handover, and only then
-- could the passenger be registered again. The handover now closes the trip
-- that became the case (its documents went to the firm, its trip stays as it
-- is, and nothing more of it is sent here, where it would never reach the
-- case), never the passenger. A next trip that becomes a case goes to the
-- same client of the firm (`pax_client_of`, by the CPF), with the documents
-- sent since:
--
--   - `pax_save_traveler`: the agency keeps a passenger's record up to date for their next trips.
--   - `pax_reserve_document`: the agency sends the documents of a passenger's next trip, never of the trip that became a case.
--   - `pax_issue_confirm_link`: the agency asks the passenger's agreement to a next trip.
--   - `pax_api_issue_link`: the agency's system asks the passenger's agreement to a next trip.
--   - `pax_link_answer`: the passenger agrees to a next trip.
--   - `pax_link_reserve_upload`: the passenger sends a document of a next trip, never of the trip that became a case.
--   - `pax_attach_trip_documents`: a ticket waiting for its trip never joins the trip that became a case.
--   - `pax_apply_reading`: ONE's reading of a document of a next trip fills the agency's record.
--   - `pax_link_open`: the link shows a next trip as any other, waiting for the agreement or followed, and says the data went to the firm only when no trip of theirs is ahead.
--   - `pax_reagree`: a next trip nobody agreed to is said as an agreement owed again.
--   - `pax_overview`: a passenger whose next trip waits for the agreement is counted among the ones waiting, and the trip that became a case among no trips flying soon.
--   - `pax_travelers_page`: a passenger whose next trip waits for the agreement is listed among the ones waiting, and their next departure is never of the trip that became a case.
--   - `pax_travelers_sync_trips`: a WhatsApp put back follows a next trip again.
--   - `pax_unagreed_departures`: a next trip flying soon with no agreement is said to the agency.
--   - `pax_retention_sweep`: a passenger is kept while a later trip of theirs is ahead or recent.
--   - `pax_traveler_detail`: each document says whether it went to the firm.
-- ============================================================

/** The agency keeps a passenger's record up to date for their next trips (0106; replaces the one of 0070). */
create or replace function public.pax_save_traveler(
  target_partnership uuid,
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
  link public.partner_links%rowtype;
  cleaned jsonb;
  traveler public.pax_travelers%rowtype;
  guardian public.pax_travelers%rowtype;
  applied jsonb;
  new_id uuid;
begin
  link := public.pax_partnership_for_writer(target_partnership);
  cleaned := public.pax_clean_fields(target_fields);
  if not (cleaned ->> 'ok')::boolean then
    return cleaned;
  end if;
  if target_guardian is not null then
    select * into guardian from public.pax_travelers where id = target_guardian and partnership_id = link.id;
    if not found or public.pax_is_minor(guardian.birth_date) then
      return jsonb_build_object('ok', false, 'code', 'invalid_guardian', 'field', 'guardian');
    end if;
  end if;

  if target_traveler is null then
    if not (cleaned -> 'values') ? 'full_name' then
      return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
    end if;
    if (cleaned -> 'values' ->> 'cpf') is not null and exists (
      select 1 from public.pax_travelers t where t.partnership_id = link.id and t.cpf = cleaned -> 'values' ->> 'cpf'
    ) then
      return jsonb_build_object('ok', false, 'code', 'cpf_in_use', 'field', 'cpf');
    end if;
    insert into public.pax_travelers (partner_id, partnership_id, org_id, full_name, guardian_id, created_by)
    values (link.partner_id, link.id, link.org_id, cleaned -> 'values' ->> 'full_name', target_guardian, auth.uid())
    returning id into new_id;
    perform public.pax_apply_fields(new_id, cleaned -> 'values', 'partner');
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (null, auth.uid(), 'pax.traveler.added', 'pax_traveler', new_id::text, jsonb_build_object('partner', link.partner_id));
    return jsonb_build_object('ok', true, 'code', 'added', 'traveler_id', new_id);
  end if;

  select * into traveler from public.pax_travelers where id = target_traveler and partnership_id = link.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'traveler_not_found');
  end if;
  if target_guardian is distinct from traveler.guardian_id then
    update public.pax_travelers set guardian_id = target_guardian, updated_via = 'partner' where id = traveler.id;
  end if;
  applied := public.pax_apply_fields(traveler.id, cleaned -> 'values', 'partner');
  if not (applied ->> 'ok')::boolean then
    return applied;
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved', 'traveler_id', traveler.id, 'changed', applied -> 'changed');
end;
$$;

revoke all on function public.pax_save_traveler(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.pax_save_traveler(uuid, uuid, jsonb, uuid) to authenticated;

/** The agency sends the documents of a passenger's next trip, never of the trip that became a case (0106; replaces the one of 0083). */
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
  if target_kind is null or target_kind not in ('identity', 'address_proof', 'ticket', 'boarding_pass') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if (target_trip is not null and not public.pax_kind_of_trip(target_kind))
     or (target_trip is not null and not exists (
       select 1 from public.pax_trip_travelers tt join public.pax_trips t on t.id = tt.trip_id
       where tt.trip_id = target_trip and tt.traveler_id = traveler.id and t.partnership_id = link.id)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_trip');
  end if;
  -- The trip that became a case is the firm's: what the case needs of it goes through the case.
  if target_trip is not null and public.pax_trip_state(target_trip) = 'case_opened' then
    return jsonb_build_object('ok', false, 'code', 'trip_with_firm');
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

/** The agency asks the passenger's agreement to a next trip (0106; replaces the one of 0083). */
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

/** The agency's system asks the passenger's agreement to a next trip (0106; replaces the one of 0073). */
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

/** The passenger agrees to a next trip (0106; replaces the one of 0086). */
create or replace function public.pax_link_answer(
  target_token text,
  target_answer text,
  target_wording text,
  target_evidence jsonb default '{}'::jsonb,
  target_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype;
  holder public.pax_travelers%rowtype;
  partnership public.partner_links%rowtype;
  wording text;
  term uuid;
  person uuid;
  cleaned jsonb;
  followed integer;
  agreed_at text;
begin
  if target_answer is null or target_answer not in ('agreed', 'declined', 'withdrawn') then
    return jsonb_build_object('ok', false, 'code', 'invalid_answer');
  end if;
  link := public.pax_link_by_token(target_token);
  if link.id is null or link.ended_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  select * into partnership from public.partner_links where id = link.partnership_id;
  if partnership.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'partnership_ended');
  end if;
  select * into holder from public.pax_travelers where id = link.holder_id for update;
  wording := public.pax_consent_wording(holder.id);
  if wording is null or regexp_replace(btrim(wording), '\s+', ' ', 'g')
                        <> regexp_replace(btrim(coalesce(target_wording, '')), '\s+', ' ', 'g') then
    return jsonb_build_object('ok', false, 'code', 'wording_changed');
  end if;
  if (select count(*) from public.pax_consents c
      where c.traveler_id = holder.id and c.created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  if target_answer = 'agreed' then
    if nullif(btrim(coalesce(target_phone, '')), '') is not null then
      cleaned := public.pax_clean_fields(jsonb_build_object('phone', target_phone));
      if not (cleaned ->> 'ok')::boolean or (cleaned -> 'values' ->> 'phone') is null then
        return jsonb_build_object('ok', false, 'code', 'invalid_phone');
      end if;
      perform public.pax_apply_fields(holder.id, cleaned -> 'values', 'passenger');
    elsif holder.phone is null then
      return jsonb_build_object('ok', false, 'code', 'no_phone');
    end if;
    -- The WhatsApp the yes is given at: the one on record now, the one just written included.
    select t.phone into agreed_at from public.pax_travelers t where t.id = holder.id;
  end if;
  select t.id into term from public.pax_consent_terms t where t.partner_id = link.partner_id order by t.version desc limit 1;
  for person in select p.id from public.pax_link_people(holder.id) p loop
    insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, term_id, wording, answer, confirm_link_id,
                                     evidence, phone)
    values (link.partner_id, link.org_id, person, holder.id, term, wording, target_answer, link.id,
            case when jsonb_typeof(target_evidence) = 'object' and octet_length(target_evidence::text) <= 2000
                 then target_evidence else '{}'::jsonb end,
            agreed_at);
  end loop;
  followed := public.pax_follow_holder(holder.id, target_answer = 'agreed', wording);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'pax.consent.' || target_answer, 'pax_traveler', holder.id::text,
          jsonb_build_object('partner', link.partner_id, 'followed', followed));
  return jsonb_build_object('ok', true, 'code', target_answer, 'followed', followed);
end;
$$;

revoke all on function public.pax_link_answer(text, text, text, jsonb, text) from public;
grant execute on function public.pax_link_answer(text, text, text, jsonb, text) to anon, authenticated;

/** The passenger sends a document of a next trip, never of the trip that became a case (0106; replaces the one of 0070). */
create or replace function public.pax_link_reserve_upload(
  target_token text,
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
  link public.pax_confirm_links%rowtype;
  problem text;
  reserved jsonb;
  document_id uuid;
begin
  link := public.pax_link_by_token(target_token);
  if link.id is null or link.ended_at is not null or link.expires_at <= now()
     or (select l.status from public.partner_links l where l.id = link.partnership_id) <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  select * into link from public.pax_confirm_links where id = link.id for update;
  if target_traveler is null or not exists (select 1 from public.pax_link_people(link.holder_id) p where p.id = target_traveler) then
    return jsonb_build_object('ok', false, 'code', 'traveler_not_found');
  end if;
  if target_kind is null or target_kind not in ('identity', 'address_proof', 'ticket', 'boarding_pass') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if public.pax_kind_of_trip(target_kind) <> (target_trip is not null)
     or (target_trip is not null and not exists (
       select 1 from public.pax_trips t join public.pax_trip_travelers tt on tt.trip_id = t.id
       where t.id = target_trip and t.holder_id = link.holder_id and tt.traveler_id = target_traveler)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_trip');
  end if;
  -- The trip that became a case is the firm's: what the case needs of it goes through the case.
  if target_trip is not null and public.pax_trip_state(target_trip) = 'case_opened' then
    return jsonb_build_object('ok', false, 'code', 'trip_with_firm');
  end if;
  if link.uploads >= public.partner_setting('confirm_link_uploads', 20) then
    return jsonb_build_object('ok', false, 'code', 'upload_limit');
  end if;
  problem := public.file_reservation_problem(public.file_purpose_rule('pax_document'), target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;
  reserved := public.pax_insert_file_reservation(link.org_id, link.partner_id, target_name, target_mime, target_bytes, null);
  insert into public.pax_documents (partner_id, org_id, traveler_id, trip_id, kind, file_id, source)
  values (link.partner_id, link.org_id, target_traveler, target_trip, target_kind, (reserved ->> 'file_id')::uuid, 'passenger')
  returning id into document_id;
  update public.pax_confirm_links set uploads = uploads + 1 where id = link.id;
  return reserved || jsonb_build_object('ok', true, 'code', 'reserved', 'document_id', document_id);
end;
$$;

revoke all on function public.pax_link_reserve_upload(text, uuid, text, uuid, text, text, bigint) from public;
grant execute on function public.pax_link_reserve_upload(text, uuid, text, uuid, text, text, bigint) to anon, authenticated;

/** A ticket waiting for its trip never joins the trip that became a case (0106; replaces the one of 0083). */
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
  -- The trip that became a case is the firm's: a ticket waiting for its trip never joins it.
  if public.pax_trip_state(trip.id) = 'case_opened' then
    return jsonb_build_object('ok', false, 'code', 'trip_with_firm');
  end if;
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

/** ONE's reading of a document of a next trip fills the agency's record (0106; replaces the one of 0083). */
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
  if not found then
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

/** The link shows a next trip as any other, waiting for the agreement or followed, and says the data went to the firm only when no trip of theirs is ahead (0106; replaces the one of 0086). */
create or replace function public.pax_link_open(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype;
  holder public.pax_travelers%rowtype;
  partnership public.partner_links%rowtype;
begin
  link := public.pax_link_by_token(target_token);
  if link.id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into holder from public.pax_travelers where id = link.holder_id;
  select * into partnership from public.partner_links where id = link.partnership_id;
  if link.ended_at is not null or link.expires_at <= now() or partnership.status <> 'active' then
    return jsonb_build_object('found', true, 'state', case
      when partnership.status <> 'active' then 'partnership_ended'
      when link.ended_at is not null then 'ended'
      else 'expired' end,
      'agency', (select p.name from public.partners p where p.id = link.partner_id),
      'rights', (public.pax_link_for_rights(target_token)).id is not null);
  end if;
  return jsonb_build_object(
    'found', true,
    -- With the firm only while no trip of theirs but the one that became a case is ahead: a next trip, waiting
    -- for the agreement or followed by ONE, is shown as any other.
    'state', case when holder.handed_over_at is not null and not exists (
                     select 1 from public.pax_trips p
                     where p.holder_id = holder.id and public.pax_trip_state(p.id) <> 'case_opened'
                       and exists (
                         select 1 from public.pax_trip_legs l
                         where l.trip_id = p.id
                           and l.scheduled_arrival_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day'))
                   then 'handed_over' else 'open' end,
    'agency', (select p.name from public.partners p where p.id = link.partner_id),
    'firm', (select o.name from public.organizations o where o.id = link.org_id),
    'expires_at', link.expires_at,
    'uploads_left', greatest(public.partner_setting('confirm_link_uploads', 20) - link.uploads, 0),
    'wording', public.pax_consent_wording(holder.id),
    'consent', public.pax_consent_state(holder.id),
    'reagree', public.pax_reagree(holder.id),
    'people', (
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'full_name', t.full_name, 'is_holder', t.id = holder.id,
               'minor', public.pax_is_minor(t.birth_date),
               'has_phone', t.phone is not null,
               'phone_end', case when t.id = holder.id then right(t.phone, 4) end,
               'documents', public.pax_documents_of(t.id)
             ) order by (t.id = holder.id) desc, t.created_at)
      from public.pax_travelers t where t.id in (select p.id from public.pax_link_people(holder.id) p)
    ),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', trip.id, 'locator', trip.locator, 'state', public.pax_trip_state(trip.id),
               'legs', (select coalesce(jsonb_agg(jsonb_build_object(
                          'position', l.position, 'flight_number', l.flight_number, 'origin_iata', l.origin_iata,
                          'destination_iata', l.destination_iata,
                          'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
                          'arrival', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI')
                        ) order by l.position), '[]'::jsonb) from public.pax_trip_legs l where l.trip_id = trip.id)
             ) order by trip.created_at)
      from public.pax_trips trip where trip.holder_id = holder.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pax_link_open(text) from public;
grant execute on function public.pax_link_open(text) to anon, authenticated;

/** A next trip nobody agreed to is said as an agreement owed again (0106; replaces the one of 0086). */
create or replace function public.pax_reagree(target_holder uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when latest.answer is distinct from 'agreed' or holder.draft then null
    when latest.phone is not null and latest.phone is distinct from holder.phone then 'phone_changed'
    when exists (
      select 1 from public.pax_trips p
      where p.holder_id = holder.id
        and exists (
          select 1 from public.pax_trip_legs l
          where l.trip_id = p.id
            and l.scheduled_arrival_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day')
        and not exists (select 1 from public.tracked_trips t where t.pax_trip_id = p.id)
    ) then 'trip_waiting'
  end
  from public.pax_travelers holder
  cross join lateral (
    select c.answer, c.phone from public.pax_consents c
    where c.traveler_id = holder.id and c.given_by is not distinct from holder.id
    order by c.created_at desc, c.id desc
    limit 1
  ) latest
  where holder.id = target_holder;
$$;

revoke all on function public.pax_reagree(uuid) from public, anon, authenticated;

/** A passenger whose next trip waits for the agreement is counted among the ones waiting, and the trip that became a case among no trips flying soon (0106; replaces the one of 0089). */
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
                  where t.partnership_id = link.id and not t.draft),
    'adults_waiting', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and not t.draft
        and (t.handed_over_at is null or public.pax_reagree(t.id) is not null)
        and not public.pax_is_minor(t.birth_date)
        and exists (select 1 from public.pax_trips trip where trip.holder_id = t.id)
        and (coalesce(public.pax_consent_state(t.id), 'none') <> 'agreed' or public.pax_reagree(t.id) is not null)
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
        -- The trip that became a case is the firm's, as the list's next departure leaves it out.
        and public.pax_trip_state(trip.id) <> 'case_opened'
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

/** A passenger whose next trip waits for the agreement is listed among the ones waiting, and their next departure is never of the trip that became a case (0106; replaces the one of 0086). */
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
      public.pax_reagree(coalesce(t.guardian_id, t.id)) as reagree,
      (select min(l.scheduled_departure_local) from public.pax_trip_legs l
       join public.pax_trip_travelers tt on tt.trip_id = l.trip_id
       where tt.traveler_id = t.id and l.scheduled_departure_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day'
         -- The trip that became a case is the firm's: the agency's next trip is another.
         and public.pax_trip_state(l.trip_id) <> 'case_opened') as next_departure
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
      when 'waiting_consent' then (m.handed_over_at is null or m.reagree is not null)
        and (coalesce(m.consent, 'none') <> 'agreed' or m.reagree is not null)
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
          'reagree', o.reagree,
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

/** A WhatsApp put back follows a next trip again (0106; replaces the one of 0086). */
create or replace function public.pax_travelers_sync_trips()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  each_trip uuid;
  latest public.pax_consents%rowtype;
begin
  for each_trip in
    select distinct tt.trip_id
    from public.pax_trip_travelers tt
    join public.tracked_trips t on t.pax_trip_id = tt.trip_id and t.status = 'watching'
    where tt.traveler_id = new.id
  loop
    perform public.pax_sync_tracked_trip(each_trip);
  end loop;
  if old.phone is distinct from new.phone and new.phone is not null then
    select * into latest from public.pax_consents c
    where c.traveler_id = new.id and c.given_by is not distinct from new.id
    order by c.created_at desc, c.id desc
    limit 1;
    if found and latest.answer = 'agreed' and latest.phone = new.phone then
      for each_trip in
        select p.id from public.pax_trips p
        where p.holder_id = new.id
          and exists (select 1 from public.pax_trip_legs l where l.trip_id = p.id)
          and not exists (select 1 from public.tracked_trips t where t.pax_trip_id = p.id)
      loop
        perform public.pax_follow_trip(each_trip, latest.wording);
      end loop;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.pax_travelers_sync_trips() from public, anon, authenticated;

/** A next trip flying soon with no agreement is said to the agency (0106; replaces the one of 0094). */
create or replace function public.pax_unagreed_departures(target_partnership uuid)
returns table (traveler_id uuid, trip_id uuid, full_name text, departure timestamp, reagree text, created_by uuid)
language sql
stable
security definer
set search_path = public
as $$
  with window_ as (
    select (now() at time zone 'America/Sao_Paulo') as from_at,
           (now() at time zone 'America/Sao_Paulo')
             + make_interval(days => greatest(public.partner_setting('unagreed_days', 7), 1)) as until_at
  )
  select h.id, first_trip.trip_id, h.full_name, first_trip.departure, public.pax_reagree(h.id), h.created_by
  from public.partner_links link
  join public.pax_travelers h on h.partnership_id = link.id
  cross join window_
  cross join lateral (
    select t.id as trip_id, min(l.scheduled_departure_local) as departure
    from public.pax_trips t
    join public.pax_trip_legs l on l.trip_id = t.id
    where t.holder_id = h.id
      and l.scheduled_departure_local >= window_.from_at
      and l.scheduled_departure_local < window_.until_at
      -- A trip ONE does not follow now: none was made of it, or the one made was stopped.
      and not exists (
        select 1 from public.tracked_trips tt where tt.pax_trip_id = t.id and tt.status <> 'stopped'
      )
    group by t.id
    order by min(l.scheduled_departure_local), t.id
    limit 1
  ) first_trip
  where link.id = target_partnership and link.status = 'active'
    and not h.draft
    and not public.pax_is_minor(h.birth_date)
    and (public.pax_consent_state(h.id) is null or public.pax_reagree(h.id) is not null);
$$;

revoke all on function public.pax_unagreed_departures(uuid) from public, anon, authenticated;

/** A passenger is kept while a later trip of theirs is ahead or recent (0106; replaces the one of 0072). */
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
          -- With the firm since a trip that became a case, kept while a later trip of theirs is ahead or recent.
          when t.handed_over_at is not null and greatest(
                 t.handed_over_at,
                 t.updated_at,
                 coalesce((select max(leg.scheduled_arrival_local) at time zone 'America/Sao_Paulo'
                           from public.pax_trip_travelers tt join public.pax_trip_legs leg on leg.trip_id = tt.trip_id
                           where tt.traveler_id = t.id), t.handed_over_at)
               ) < now() - make_interval(days => quiet) then 'handed_over'
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

/** Each document says whether it went to the firm (0106; replaces the one of 0086). */
create or replace function public.pax_traveler_detail(target_traveler uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  holder uuid;
begin
  select * into traveler from public.pax_travelers where id = target_traveler;
  if not found or not public.is_partner_member(traveler.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  holder := coalesce(traveler.guardian_id, traveler.id);
  return jsonb_build_object(
    'traveler', to_jsonb(traveler) - 'read_fields' || jsonb_build_object(
      'minor', public.pax_is_minor(traveler.birth_date), 'read_fields', traveler.read_fields),
    'guardian', (select jsonb_build_object('id', g.id, 'full_name', g.full_name) from public.pax_travelers g where g.id = traveler.guardian_id),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name) order by c.full_name)
                          from public.pax_children_of(traveler.id) c), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'kind', d.kind, 'trip_id', d.trip_id, 'source', d.source, 'reading', d.reading,
               -- Went to the firm with a case: the file is the firm's now, and the agency no longer opens it.
               'handed', d.case_document_id is not null,
               'reading_error', d.reading_error, 'file_id', d.file_id, 'name', f.name, 'created_at', d.created_at,
               'read', case when d.reading = 'done' then jsonb_build_object(
                 'matches', d.read_output ->> 'confere_tipo', 'legible', d.read_output -> 'legivel',
                 'identified', d.read_output ->> 'tipo_identificado', 'note', d.read_output ->> 'observacoes') end
             ) order by d.created_at)
      from public.pax_documents d join public.files f on f.id = d.file_id
      where d.traveler_id = traveler.id and d.reading <> 'uploading'), '[]'::jsonb),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', trip.id, 'locator', trip.locator, 'holder_id', trip.holder_id, 'state', public.pax_trip_state(trip.id),
               'travelers', (select jsonb_agg(jsonb_build_object('id', t.id, 'full_name', t.full_name) order by t.full_name)
                             from public.pax_trip_travelers tt join public.pax_travelers t on t.id = tt.traveler_id
                             where tt.trip_id = trip.id),
               'legs', (select coalesce(jsonb_agg(jsonb_build_object(
                          'position', l.position, 'flight_number', l.flight_number, 'origin_iata', l.origin_iata,
                          'destination_iata', l.destination_iata,
                          'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
                          'arrival', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI')
                        ) order by l.position), '[]'::jsonb) from public.pax_trip_legs l where l.trip_id = trip.id)
             ) order by trip.created_at)
      from public.pax_trips trip
      where trip.id in (select tt.trip_id from public.pax_trip_travelers tt where tt.traveler_id = traveler.id)), '[]'::jsonb),
    'consent', public.pax_consent_state(holder),
    'reagree', public.pax_reagree(holder),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('answer', c.answer, 'created_at', c.created_at) order by c.created_at desc)
      from (select * from public.pax_consents c where c.traveler_id = traveler.id order by c.created_at desc limit 10) c), '[]'::jsonb),
    'confirm_link', (
      select jsonb_build_object('created_at', l.created_at, 'expires_at', l.expires_at,
                                'open', l.ended_at is null and l.expires_at > now())
      from public.pax_confirm_links l where l.holder_id = holder order by l.created_at desc limit 1)
  );
end;
$$;

revoke all on function public.pax_traveler_detail(uuid) from public, anon;
grant execute on function public.pax_traveler_detail(uuid) to authenticated;
