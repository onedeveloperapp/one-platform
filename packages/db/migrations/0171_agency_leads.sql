-- ============================================================
-- An agency's passenger who agrees is the firm's lead (0171), item 2.3 of
-- the case journey plan, by the owner's decisions of 2026-11-07: the firm
-- sees a passenger's whole record as soon as the passenger agrees, the
-- agreement saying so in its words (LGPD, art. 7, § 5: a specific consent to
-- share data with another controller), and the firm, not ONE, answers for it
-- (the soliciting risk of EAOAB art. 34, IV passed to the firm by its
-- contract with ONE).
--
-- The words before the agency's clause say the data go to the firm
-- (`partners` `consent` `base`, `shares_data`), and an answer given in such
-- words says so (`pax_consents.shares_data`): an agreement given before, in
-- the words that passed the data only at the passenger's yes to a problem,
-- passes nothing now. Each person a yes that shares the data covers (the
-- holder and the children they answer for, `pax_link_people`) becomes a
-- person of the firm (`pax_lead_to_firm`): the firm's own person of that CPF
-- under a name that is theirs, or a new one, keeping what the firm's record
-- says and taking from the agency's what it lacks, on the firm's record
-- (`pax.lead`); the passenger knows which person of the firm they are
-- (`pax_travelers.firm_person_id`), so the case their yes to a problem opens
-- is that person's (`pax_client_of`), and what the agency changes later
-- never reaches the firm. Taking the agreement back takes the lead with it,
-- where nothing of the firm holds the person (no case, no trip of the
-- firm's own). A passenger whose yes shares the data and who has no case is
-- a lead (`people_funnel`), and the firm reads, beside its own trips of a
-- person, the agency's trips ONE follows of them (`firm_person_agency`).
--
-- The firm reads each partnership by its own numbers
-- (`firm_partnership_facts`): the passengers the agency registered, how many
-- never agreed or no longer do, its leads and how many became cases.
--
-- Every person, firm and agency in the tests is invented.
-- ============================================================

alter table public.pax_consents add column shares_data boolean not null default false;

alter table public.pax_travelers add column firm_person_id uuid;
alter table public.pax_travelers add column lead_at timestamptz;
-- Whether the agreement made the firm's person (and so may take it back), or found one the firm had.
alter table public.pax_travelers add column lead_new boolean not null default false;
alter table public.pax_travelers add constraint pax_travelers_firm_person_fkey
  foreign key (firm_person_id, org_id) references public.people (id, org_id) on delete set null (firm_person_id);
create index pax_travelers_firm_person_idx on public.pax_travelers (firm_person_id) where firm_person_id is not null;

-- The words before the agency's clause, from now on: the data go to the firm when the passenger agrees.
update public.platform_settings
set value = jsonb_set(
  jsonb_set(
    value,
    '{consent,base}',
    to_jsonb('Concordo que {agencia} compartilhe com o escritório {escritorio} os meus dados, o meu WhatsApp e os voos desta viagem. A partir deste acordo, o escritório cuida desses dados: o ONE, o sistema do escritório, acompanha os voos, e o escritório me avisa pelo WhatsApp se algum deles for cancelado, mudar ou atrasar, e pode me oferecer avaliar o meu caso. Se eu quiser falar com o escritório sobre um problema, concordo também que {agencia} passe ao escritório os documentos que enviei. Posso desistir a qualquer momento por este link ou respondendo SAIR no WhatsApp.'::text)
  ),
  '{consent,shares_data}',
  'true'::jsonb
)
where key = 'partners';

/** Whether the words of the agreement in force pass the passenger's data to the firm. Internal. */
create or replace function public.pax_consent_shares_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (s.value -> 'consent' ->> 'shares_data')::boolean from public.platform_settings s where s.key = 'partners'
  ), false);
$$;

revoke all on function public.pax_consent_shares_data() from public, anon, authenticated;

/** Whether a passenger's answer in force is a yes that passes their data to the firm. Internal. */
create or replace function public.pax_lead_in_force(target_traveler uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.answer = 'agreed' and c.shares_data
    from public.pax_consents c
    where c.traveler_id = target_traveler
    order by c.created_at desc, c.id desc
    limit 1
  ), false);
$$;

revoke all on function public.pax_lead_in_force(uuid) from public, anon, authenticated;

/**
 * Makes an agency's passenger whose yes passes their data a person of the firm (0171): the person the passenger
 * already is, else the firm's person of that CPF under a name that is theirs, else a new person; the firm's record
 * keeps what it says and takes from the agency's what it lacks, field by field. Answers the person, or null for a
 * passenger whose answer in force does not pass the data. Internal.
 */
create or replace function public.pax_lead_to_firm(target_traveler uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  person_row public.people%rowtype;
  person uuid;
  fields jsonb;
  field text;
  written text[] := '{}';
  created boolean := false;
begin
  select * into traveler from public.pax_travelers where id = target_traveler for update;
  if not found or traveler.draft or not public.pax_lead_in_force(traveler.id) then
    return null;
  end if;
  person := (select p.id from public.people p
             where p.id = traveler.firm_person_id and p.org_id = traveler.org_id and p.erased_at is null);
  if person is null then
    person := (select p.id from public.people p
               where p.org_id = traveler.org_id and p.cpf = traveler.cpf and p.erased_at is null
                 and traveler.cpf is not null and public.import_names_match(p.full_name, traveler.full_name)
               order by p.created_at, p.id
               limit 1);
  end if;
  if person is null then
    insert into public.people (org_id, full_name, updated_via)
    values (traveler.org_id, traveler.full_name, 'partner')
    returning id into person;
    created := true;
  end if;
  select * into person_row from public.people where id = person;

  fields := jsonb_strip_nulls(jsonb_build_object(
    'cpf', traveler.cpf, 'birth_date', to_char(traveler.birth_date, 'YYYY-MM-DD'),
    'email', traveler.email, 'phone', traveler.phone, 'nationality', traveler.nationality,
    'postal_code', traveler.postal_code, 'street', traveler.street, 'address_number', traveler.address_number,
    'complement', traveler.complement, 'district', traveler.district, 'city', traveler.city, 'uf', traveler.uf
  ));
  for field in select jsonb_object_keys(fields) loop
    -- The firm's record keeps what it says.
    if (to_jsonb(person_row) -> field) is not null and (to_jsonb(person_row) -> field) <> 'null'::jsonb then
      continue;
    end if;
    if field = 'cpf' and exists (
      select 1 from public.people p where p.org_id = traveler.org_id and p.cpf = traveler.cpf and p.id <> person
    ) then
      continue;
    end if;
    -- Field by field: one value the firm's rules refuse never keeps the others out.
    if coalesce((public.apply_person_fields(person, jsonb_build_object(field, fields ->> field), 'partner')
                 ->> 'ok')::boolean, false) then
      written := written || field;
    end if;
  end loop;

  update public.pax_travelers
  set firm_person_id = person, lead_at = coalesce(lead_at, now()),
      lead_new = case when created then true when person = traveler.firm_person_id then lead_new else false end
  where id = traveler.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (traveler.org_id, null, 'pax.lead', 'person', person::text,
          jsonb_build_object('partnership', traveler.partnership_id, 'new', created, 'fields', to_jsonb(written)));
  return person;
end;
$$;

revoke all on function public.pax_lead_to_firm(uuid) from public, anon, authenticated;

/**
 * Takes a lead back when the passenger takes their agreement back (0171): a person the agreement made goes where
 * nothing of the firm holds them (no case of theirs, no trip the firm itself follows of them, no other passenger
 * pointing at them); a person the firm had, or one it holds, stays with what it has. The passenger no longer points
 * at the firm's person either way. Internal.
 */
create or replace function public.pax_lead_withdrawn(target_traveler uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  person uuid;
begin
  select * into traveler from public.pax_travelers where id = target_traveler for update;
  if not found or traveler.firm_person_id is null then
    return;
  end if;
  person := traveler.firm_person_id;
  update public.pax_travelers set firm_person_id = null, lead_new = false where id = traveler.id;
  if not traveler.lead_new
     or exists (select 1 from public.case_parties cp where cp.person_id = person)
     or exists (select 1 from public.tracked_trips t where t.person_id = person)
     or exists (select 1 from public.pax_travelers t where t.firm_person_id = person) then
    return;
  end if;
  begin
    delete from public.people where id = person and org_id = traveler.org_id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (traveler.org_id, null, 'pax.lead_withdrawn', 'person', person::text,
            jsonb_build_object('partnership', traveler.partnership_id));
  exception when foreign_key_violation then
    -- Something of the firm names the person after all: it stays.
    null;
  end;
end;
$$;

revoke all on function public.pax_lead_withdrawn(uuid) from public, anon, authenticated;

/** The firm's person an agency's passenger is: the one a yes that shared the data made, else by CPF and name. */
create or replace function public.pax_client_of(target_org uuid, target_traveler uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.id from public.pax_travelers t
     join public.people p on p.id = t.firm_person_id and p.org_id = target_org and p.erased_at is null
     where t.id = target_traveler),
    (select p.id
     from public.pax_travelers t
     join public.people p on p.org_id = target_org and p.cpf = t.cpf
     where t.id = target_traveler and t.cpf is not null and public.import_names_match(p.full_name, t.full_name)
     order by p.created_at, p.id
     limit 1)
  );
$$;

revoke all on function public.pax_client_of(uuid, uuid) from public, anon, authenticated;

/**
 * What the firm reads of a person who came from an agency (0171): the agency, when the passenger agreed, and the
 * trips ONE follows of them for the agency (their flights and where each stands), only while their yes passes the
 * data. Anybody of the firm.
 */
create or replace function public.firm_person_agency(target_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := (select p.org_id from public.people p where p.id = target_person);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if org is null or not public.is_org_member(org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'agencies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'agency', pr.name,
      'lead_at', tr.lead_at,
      'trips', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'status', t.status,
          'case_id', t.case_id,
          'legs', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', l.position, 'flight', l.flight_number, 'origin', l.origin_iata,
              'destination', l.destination_iata,
              'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
              'status', l.status
            ) order by l.scheduled_departure_local, l.position)
            from public.tracked_legs l where l.trip_id = t.id
          ), '[]'::jsonb)
        ) order by t.consent_at desc)
        from public.tracked_trips t
        join public.pax_trips pt on pt.id = t.pax_trip_id
        where t.org_id = org and t.consent_channel = 'agency'
          -- A child travels on the trip of the adult who answers for them.
          and pt.holder_id in (tr.id, tr.guardian_id)
      ), '[]'::jsonb)
    ) order by tr.lead_at)
    from public.pax_travelers tr
    join public.partners pr on pr.id = tr.partner_id
    where tr.firm_person_id = target_person and tr.org_id = org and public.pax_lead_in_force(tr.id)
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.firm_person_agency(uuid) from public, anon;
grant execute on function public.firm_person_agency(uuid) to authenticated;

-- ---------- The case takes the marks of what a lead brought ----------

create or replace function public.pax_hand_over(target_org uuid, target_case uuid, target_trip uuid, target_people jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  traveler public.pax_travelers%rowtype;
  person_row public.people%rowtype;
  fields jsonb;
  field text;
  written text[];
  document public.pax_documents%rowtype;
  case_document uuid;
  documents uuid[] := '{}';
  marks jsonb;
  handed integer := 0;
  holder uuid := (select p.holder_id from public.pax_trips p where p.id = target_trip);
begin
  for item in select key, value from jsonb_each(coalesce(target_people, '{}'::jsonb)) loop
    select * into traveler from public.pax_travelers
    where id = item.key::uuid and org_id = target_org
    for update;
    if not found or holder is null or not public.pax_agreed_by(traveler.id, holder) then
      continue;
    end if;
    select * into person_row from public.people where id = (item.value ->> 'person')::uuid and org_id = target_org;
    if not found then
      continue;
    end if;

    fields := jsonb_strip_nulls(jsonb_build_object(
      'full_name', traveler.full_name, 'cpf', traveler.cpf, 'birth_date', to_char(traveler.birth_date, 'YYYY-MM-DD'),
      'email', traveler.email, 'phone', traveler.phone, 'nationality', traveler.nationality,
      'postal_code', traveler.postal_code, 'street', traveler.street, 'address_number', traveler.address_number,
      'complement', traveler.complement, 'district', traveler.district, 'city', traveler.city, 'uf', traveler.uf
    ));
    written := '{}';
    for field in select jsonb_object_keys(fields) loop
      if coalesce((item.value ->> 'new')::boolean, false) then
        -- A new client takes the agency's record, but for the WhatsApp the conversation gave.
        if field = 'phone' and person_row.phone is not null then
          continue;
        end if;
      elsif (to_jsonb(person_row) -> field) is not null and (to_jsonb(person_row) -> field) <> 'null'::jsonb then
        -- A client the firm had keeps what its record says.
        continue;
      end if;
      if field = 'cpf' and exists (
        select 1 from public.people p where p.org_id = target_org and p.cpf = traveler.cpf and p.id <> person_row.id
      ) then
        continue;
      end if;
      -- Field by field: one value the case's rules refuse never keeps the others out.
      if coalesce((public.apply_person_fields(person_row.id, jsonb_build_object(field, fields ->> field), 'partner')
                   ->> 'ok')::boolean, false) then
        written := written || field;
      end if;
    end loop;

    -- A person the passenger's yes made a lead of the firm (0171) took the agency's record then: what still says
    -- what the agency's record says came from it, and keeps the mark of the document it was read from.
    if traveler.firm_person_id = person_row.id then
      select * into person_row from public.people where id = person_row.id;
      for field in select jsonb_object_keys(fields) loop
        if not field = any (written) and (to_jsonb(person_row) ->> field) = (fields ->> field) then
          written := written || field;
        end if;
      end loop;
    end if;

    -- The person's own documents, and those of this trip; each once.
    for document in
      select d.* from public.pax_documents d
      join public.files f on f.id = d.file_id
      where d.traveler_id = traveler.id and d.reading <> 'uploading' and d.case_document_id is null
        and f.status = 'stored' and (d.trip_id is null or d.trip_id = target_trip)
      order by d.created_at, d.id
      for update of d
    loop
      update public.files set partner_id = null where id = document.file_id;
      insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status)
      values (target_org, target_case,
              -- A ticket is of the trip; the rest of the person.
              case when document.kind = 'ticket' then null else (item.value ->> 'party')::uuid end,
              document.file_id, document.kind, 'partner', 'received')
      returning id into case_document;
      update public.pax_documents set case_document_id = case_document where id = document.id;
      documents := documents || case_document;
    end loop;

    -- What ONE read of a document of the agency stays marked as read, of the case's document now, for what was
    -- written from it.
    select coalesce(jsonb_object_agg(mark.key, jsonb_build_object('document', d.case_document_id, 'kind', d.kind)), '{}'::jsonb)
    into marks
    from jsonb_each(traveler.read_fields) as mark (key, value)
    join public.pax_documents d on d.id::text = mark.value ->> 'document'
    where mark.key = any (written) and d.case_document_id is not null;
    if marks <> '{}'::jsonb then
      update public.people set read_fields = read_fields || marks where id = person_row.id;
    end if;

    update public.pax_travelers
    set case_id = target_case, handed_over_at = coalesce(handed_over_at, now())
    where id = traveler.id;
    handed := handed + 1;
  end loop;
  return jsonb_build_object('people', handed, 'documents', to_jsonb(documents));
end;
$$;

revoke all on function public.pax_hand_over(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------- The answer on the link makes the lead ----------

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
  shares boolean := public.pax_consent_shares_data();
  covered uuid;
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
                                     evidence, phone, shares_data)
    values (link.partner_id, link.org_id, person, holder.id, term, wording, target_answer, link.id,
            case when jsonb_typeof(target_evidence) = 'object' and octet_length(target_evidence::text) <= 2000
                 then target_evidence else '{}'::jsonb end,
            agreed_at, shares);
  end loop;
  followed := public.pax_follow_holder(holder.id, target_answer = 'agreed', wording);
  -- A yes whose words pass the data makes each person it covers a lead of the firm; a no or a withdrawal takes
  -- the lead back where nothing of the firm holds the person (0171).
  for covered in select p.id from public.pax_link_people(holder.id) p loop
    if target_answer = 'agreed' then
      perform public.pax_lead_to_firm(covered);
    else
      perform public.pax_lead_withdrawn(covered);
    end if;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'pax.consent.' || target_answer, 'pax_traveler', holder.id::text,
          jsonb_build_object('partner', link.partner_id, 'followed', followed));
  return jsonb_build_object('ok', true, 'code', target_answer, 'followed', followed);
end;
$$;

revoke all on function public.pax_link_answer(text, text, text, jsonb, text) from public;
grant execute on function public.pax_link_answer(text, text, text, jsonb, text) to anon, authenticated;

-- ---------- A lead is a lead in the funnel ----------

create or replace function public.people_funnel(target_org uuid)
returns table (person_id uuid, point text, reasons text[])
language sql
stable
security definer
set search_path = public
as $$
  with cut as materialized (
    select not public.firm_has_real_case(target_org) as tests
  ), cases_of as materialized (
    select cp.person_id, c.id as case_id, c.status, c.qualification, c.qualification_released_at
    from public.case_parties cp
    join public.cases c on c.id = cp.case_id
    cross join cut
    where c.org_id = target_org and cp.role in ('claimant', 'guardian') and (cut.tests or not c.is_test)
  ), signed as materialized (
    select distinct co.person_id
    from cases_of co
    join public.case_closings(target_org) cl on cl.case_id = co.case_id
    where cl.signed_at is not null
    union
    select distinct co.person_id
    from cases_of co
    join public.proceedings p on p.case_id = co.case_id
    where p.status in ('filed', 'closed')
  ), held as materialized (
    -- A case the rule did not qualify, nobody having gone on with it, is no lead.
    select co.person_id, co.case_id, co.qualification -> 'reasons' as reasons
    from cases_of co
    where co.qualification ->> 'outcome' = 'not_qualified' and co.qualification_released_at is null
  ), going as materialized (
    select distinct co.person_id
    from cases_of co
    where co.status not in ('closed', 'declined')
      and not exists (select 1 from held h where h.case_id = co.case_id)
  ), refused_alerts as materialized (
    select a.person_id, a.qualification -> 'reasons' as reasons
    from public.flight_alerts a
    where a.org_id = target_org and a.person_id is not null and a.qualification ->> 'outcome' = 'not_qualified'
  ), followed as materialized (
    -- A passenger the firm registered and whose trip ONE follows with their agreement (0170), and no case yet.
    select distinct t.person_id
    from public.tracked_trips t
    cross join cut
    where t.org_id = target_org and t.person_id is not null and t.status in ('watching', 'alerted')
      and (cut.tests or not t.is_test)
      and not exists (select 1 from cases_of co where co.person_id = t.person_id)
    union
    -- An agency's passenger whose yes passed their data to the firm (0171), with no case yet.
    select tr.firm_person_id
    from public.pax_travelers tr
    where tr.org_id = target_org and tr.firm_person_id is not null and public.pax_lead_in_force(tr.id)
      and not exists (select 1 from cases_of co where co.person_id = tr.firm_person_id)
  ), talked as materialized (
    -- Who wrote to the firm's WhatsApp, by the number the firm has for them, and has no case.
    select distinct p.id as person_id
    from public.people p
    join public.wa_conversations w on w.org_id = p.org_id
    where p.org_id = target_org and p.phone is not null and w.last_inbound_at is not null
      and w.contact_wa_id = any (public.wa_phone_variants(p.phone))
      and not exists (select 1 from cases_of co where co.person_id = p.id)
  )
  select p.id,
    case
      when exists (select 1 from signed s where s.person_id = p.id) then 'cliente'
      when exists (select 1 from going g where g.person_id = p.id)
        or exists (select 1 from followed fw where fw.person_id = p.id)
        or (exists (select 1 from talked t where t.person_id = p.id)
            and not exists (select 1 from refused_alerts r where r.person_id = p.id)) then 'lead'
      when exists (select 1 from held h where h.person_id = p.id)
        or exists (select 1 from refused_alerts r where r.person_id = p.id) then 'nao_qualificado'
      else 'contato'
    end,
    coalesce((
      select array_agg(distinct reason)
      from (
        select jsonb_array_elements_text(h.reasons) as reason from held h where h.person_id = p.id
        union all
        select jsonb_array_elements_text(r.reasons) from refused_alerts r where r.person_id = p.id
      ) x
    ), '{}')
  from public.people p
  where p.org_id = target_org;
$$;

revoke all on function public.people_funnel(uuid) from public, anon, authenticated;

-- ---------- The firm reads each partnership by its numbers ----------

create or replace function public.firm_partnership_facts(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  week date := date_trunc('week', (now() at time zone 'America/Sao_Paulo'))::date;
  days integer := greatest(public.partner_setting('flight_progress_days', 7), 1);
  manager boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manager := public.is_superadmin() or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]);

  return jsonb_build_object(
    'partnerships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_id', l.id,
        'module', l.module_key,
        'status', l.status,
        'cases_going', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id and c.status not in ('closed', 'declined')
        ),
        'cases_total', (
          select count(*) from public.cases c where c.org_id = target_org and c.partnership_id = l.id
        ),
        'awaiting_client', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id
            and c.status in ('intake', 'documents', 'signature')
            and not exists (
              select 1 from public.client_links k where k.case_id = c.id and k.finished_at is not null
            )
        ),
        -- The agency's passengers by the firm's numbers (0171): registered, never agreed or no longer, leads
        -- (a yes that passes the data, no case yet) and the ones whose trip became a case.
        'passengers', (
          with registered as (
            select tr.id, tr.case_id, tr.firm_person_id,
                   (select c.answer from public.pax_consents c where c.traveler_id = tr.id
                    order by c.created_at desc, c.id desc limit 1) as answer,
                   public.pax_lead_in_force(tr.id) as lead
            from public.pax_travelers tr
            where tr.partnership_id = l.id and not tr.draft
          )
          select jsonb_build_object(
            'registered', (select count(*) from registered),
            'unagreed', (select count(*) from registered r where r.answer is distinct from 'agreed'),
            'leads', (select count(*) from registered r where r.lead and r.case_id is null),
            'converted', (select count(*) from registered r where r.case_id is not null)
          )
        ),
        'readings_today', case when manager then coalesce((
          select r.readings from public.pax_reading_days r where r.partnership_id = l.id and r.day = today
        ), 0) end,
        'flight_reads_today', case when manager then coalesce((
          select sum(t.watch_reads)::integer from public.tracked_trips t
          join public.pax_trips p on p.id = t.pax_trip_id
          where p.partnership_id = l.id and t.org_id = target_org and t.watch_day = today
        ), 0) end,
        'forecast', (
          with agreed as (
            -- Each passenger whose answer in force is a yes, and the day of that answer.
            select (latest.created_at at time zone 'America/Sao_Paulo')::date as day
            from public.pax_travelers tr
            cross join lateral (
              select c.answer, c.created_at from public.pax_consents c
              where c.traveler_id = tr.id order by c.created_at desc, c.id desc limit 1
            ) latest
            where tr.partnership_id = l.id and not tr.draft and latest.answer = 'agreed'
          ),
          followed as (
            select t.id, t.status from public.tracked_trips t
            join public.pax_trips p on p.id = t.pax_trip_id
            where p.partnership_id = l.id and t.org_id = target_org and t.status in ('watching', 'alerted')
          )
          select jsonb_build_object(
            'agreed', (select count(*) from agreed),
            'agreed_since', (select min(a.day) from agreed a),
            'agreed_weeks', (
              select jsonb_agg(jsonb_build_object(
                'week', w.start,
                'agreed', (select count(*) from agreed a where a.day >= w.start and a.day < w.start + 7)
              ) order by w.start)
              from (select (week - (n * 7))::date as start from generate_series(7, 0, -1) n) w
            ),
            'followed', (select count(*) from followed),
            'alerted', (select count(*) from followed f where f.status = 'alerted'),
            'days', (
              select jsonb_agg(jsonb_build_object(
                'day', d.day,
                'trips', (
                  select count(distinct f.id) from followed f
                  join public.tracked_legs fl on fl.trip_id = f.id
                  where fl.scheduled_departure_local::date = d.day
                )
              ) order by d.day)
              from (select (today + n)::date as day from generate_series(0, days - 1) n) d
            ),
            'in_air', (
              select count(*) from followed f join public.tracked_legs fl on fl.trip_id = f.id
              where fl.departed_local is not null and fl.arrived_local is null and fl.status <> 'cancelled'
            ),
            'arrived_today', (
              select count(*) from followed f join public.tracked_legs fl on fl.trip_id = f.id
              where fl.arrived_local::date = today
            )
          )
        )
      ) order by (l.status = 'active') desc, l.started_at desc)
      from public.partner_links l
      where l.org_id = target_org
    ), '[]'::jsonb),
    'manager', manager,
    'forecast_days', days,
    'readings_daily', case when manager then greatest(public.partner_setting('reading_daily', 300), 1) end,
    'flight_reads_today', case when manager then coalesce((
      select sum(t.watch_reads)::integer from public.tracked_trips t
      where t.org_id = target_org and t.watch_day = today
    ), 0) end,
    'flight_reads_share', case when manager then
      greatest(public.flight_alerts_setting('watch_firm_daily_reads', 150), 0) end
  );
end;
$$;

revoke all on function public.firm_partnership_facts(uuid) from public, anon;
grant execute on function public.firm_partnership_facts(uuid) to authenticated;
