-- ============================================================
-- 0217 · Where the firm is, in the power of attorney.
--
-- From the review of 2026-11-11 against the CPC. A power of attorney names
-- each lawyer with the registration at the bar and the full address (CPC,
-- art. 105, § 2º); a lawyer of a society of lawyers, the society too, with
-- its registration at the bar and its full address (§ 3º); and the one that
-- goes with the petition gives the lawyer's electronic and non-electronic
-- addresses (art. 287). ONE's power of attorney named the lawyers with their
-- registration and the firm by its name and CNPJ only (0054, 0093), and the
-- firm had nowhere to give the rest: "Dados do escritório" held its name.
--
-- The firm now gives where it is (`organizations.office_*`: the CEP, the
-- street, the number, the complement, the district, the city, the state),
-- its professional e-mail (`office_email`) and, when it is a society, its
-- registration at the bar (`oab_society_uf`, `oab_society_number`), through
-- `set_firm_office`, by who manages the firm account, on the record. The
-- mark `[[ESCRITORIO]]` (`case_paper_filled`, redefined from 0093) writes
-- them after the name and the CNPJ, so the lawyers, "do escritório", have
-- the office's address and e-mail as theirs; a firm that gave none is named
-- as before, and its setup and its case say what is missing. A firm whose
-- own model writes its society as its words keeps its words.
-- ============================================================

alter table public.organizations
  add column office_postal_code text,
  add column office_street text,
  add column office_number text,
  add column office_complement text,
  add column office_district text,
  add column office_city text,
  add column office_uf text,
  add column office_email text,
  add column oab_society_uf text,
  add column oab_society_number text;

alter table public.organizations
  add constraint organizations_office_postal_code_check
    check (office_postal_code is null or office_postal_code ~ '^[0-9]{8}$'),
  add constraint organizations_office_uf_check check (office_uf is null or office_uf ~ '^[A-Z]{2}$'),
  add constraint organizations_office_text_check check (
    (office_street is null or char_length(office_street) between 2 and 160)
    and (office_number is null or char_length(office_number) between 1 and 20)
    and (office_complement is null or char_length(office_complement) between 1 and 80)
    and (office_district is null or char_length(office_district) between 2 and 80)
    and (office_city is null or char_length(office_city) between 2 and 80)
  ),
  add constraint organizations_office_email_check
    check (office_email is null or (char_length(office_email) <= 160 and office_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add constraint organizations_oab_society_check check (
    (oab_society_uf is null) = (oab_society_number is null)
    and (oab_society_uf is null or oab_society_uf ~ '^[A-Z]{2}$')
    and (oab_society_number is null or oab_society_number ~ '^[0-9]{1,10}$')
  );

/**
 * Who manages the firm account says where the firm is, its professional e-mail and, when it is a society of lawyers,
 * its registration at the bar (0217). The address is whole or none: the CEP, the street, the city and the state, with
 * the number, the complement and the district when it has them. Never a support visit; on the record.
 */
create or replace function public.set_firm_office(target_org uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean jsonb := '{}'::jsonb;
  field text;
  value text;
  postal text := nullif(regexp_replace(coalesce(payload ->> 'postal_code', ''), '\D', '', 'g'), '');
  uf text := nullif(upper(btrim(coalesce(payload ->> 'uf', ''))), '');
  society_uf text := nullif(upper(btrim(coalesce(payload ->> 'society_uf', ''))), '');
  society_number text := nullif(regexp_replace(coalesce(payload ->> 'society_number', ''), '\D', '', 'g'), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  foreach field in array array['street', 'number', 'complement', 'district', 'city', 'email'] loop
    value := nullif(btrim(regexp_replace(coalesce(payload ->> field, ''), '\s+', ' ', 'g')), '');
    clean := clean || jsonb_build_object(field, value);
  end loop;
  -- The address is whole or none.
  if (postal is null) <> (clean ->> 'street' is null) or (postal is null) <> (clean ->> 'city' is null)
     or (postal is null) <> (uf is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'address');
  end if;
  if (society_uf is null) <> (society_number is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'society');
  end if;
  begin
    update public.organizations set
      office_postal_code = postal,
      office_street = clean ->> 'street',
      office_number = clean ->> 'number',
      office_complement = clean ->> 'complement',
      office_district = clean ->> 'district',
      office_city = clean ->> 'city',
      office_uf = uf,
      office_email = lower(clean ->> 'email'),
      oab_society_uf = society_uf,
      oab_society_number = society_number
    where id = target_org;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'office');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.office_set', 'organization', target_org::text, jsonb_build_object(
    'address', postal is not null, 'email', clean ->> 'email' is not null, 'society', society_uf is not null));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_office(uuid, jsonb) from public, anon;
grant execute on function public.set_firm_office(uuid, jsonb) to authenticated;

/**
 * What a paper says of the firm after its name and CNPJ (0217): its registration at the bar, its address and its
 * e-mail, each where the firm gave it, else nothing. Internal.
 */
create or replace function public.firm_office_words(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
      ', inscrita na OAB/' || o.oab_society_uf || ' sob o nº ' || o.oab_society_number, '')
    || case when o.office_postal_code is null then '' else
         ', com sede em ' || o.office_street
         || coalesce(', nº ' || o.office_number, '')
         || coalesce(', ' || o.office_complement, '')
         || coalesce(', ' || o.office_district, '')
         || ', ' || o.office_city || '/' || o.office_uf
         || ', CEP ' || regexp_replace(o.office_postal_code, '^(\d{5})(\d{3})$', '\1-\2')
       end
    || coalesce(', endereço eletrônico ' || o.office_email, '')
  from public.organizations o
  where o.id = target_org;
$$;

revoke all on function public.firm_office_words(uuid) from public, anon, authenticated;

/**
 * The text of a paper with the facts of a person of a case written in (0054, 0093). Now (0217) `[[ESCRITORIO]]`
 * names the firm's registration at the bar, its address and its e-mail after its name and CNPJ, where the firm gave
 * them. The other marks are filled as before.
 */
create or replace function public.case_paper_filled(target_case uuid, target_person uuid, target_body text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  firm public.organizations%rowtype;
  airline public.airlines%rowtype;
  person public.people%rowtype;
  leg public.flight_segments%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  months text[] := array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro',
    'outubro', 'novembro', 'dezembro'];
  grantor text;
  lawyers text;
  office text;
  defendant text;
  subject text;
  place text;
  minors text;
  marital_word text;
  address_text text;
  digits text;
  phone_text text;
  written_date text;
  filled text := coalesce(target_body, '');
begin
  select * into current_case from public.cases where id = target_case;
  select * into firm from public.organizations where id = current_case.org_id;
  select * into airline from public.airlines a where a.iata = current_case.airline_iata;
  select * into person from public.people where id = target_person;
  if person.id is null then
    return filled;
  end if;

  -- Who grants it, and each minor of the case they answer for: under sixteen represented, from sixteen assisted.
  grantor := public.person_qualification(target_person, false) || coalesce((
    select string_agg(
      case when pe.birth_date is not null and pe.birth_date <= today - interval '16 years'
        then '; e assistindo ' else '; e como representante legal de ' end
      || public.person_qualification(cp.person_id, true), '' order by cp.created_at, cp.id)
    from public.case_parties g
    join public.case_parties cp on cp.guardian_id = g.id and cp.role = 'claimant'
    join public.people pe on pe.id = cp.person_id
    where g.case_id = target_case and g.person_id = target_person
  ), '');

  -- Who receives it: the firm's signers who are its partners or lawyers, each with every registration at the bar.
  select string_agg(
    coalesce(nullif(btrim(pr.display_name), ''), '[COMPLETAR: nome de quem assina]') || ', ' || coalesce((
      select string_agg('OAB/' || r.uf || ' nº ' || r.number, ' e ' order by (r.kind = 'principal') desc, r.uf)
      from public.oab_registrations r where r.user_id = s.user_id
    ), '[COMPLETAR: inscrição na OAB]'),
    '; ' order by s.added_at, s.user_id)
  into lawyers
  from public.firm_signers s
  join public.memberships m on m.org_id = s.org_id and m.user_id = s.user_id and m.firm_function in ('socio', 'advogado')
  join public.profiles pr on pr.id = s.user_id
  where s.org_id = current_case.org_id;

  office := coalesce(nullif(btrim(firm.name), ''), '[COMPLETAR: nome do escritório]') || case
    when firm.billing_cpf_cnpj ~ '^\d{14}$' then
      ', CNPJ nº ' || regexp_replace(firm.billing_cpf_cnpj, '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5')
    else '' end
    -- Its registration at the bar, its address and its e-mail, where the firm gave them (0217): what a power of
    -- attorney says of the lawyers and of their society (CPC, art. 105, §§ 2º and 3º, and art. 287).
    || coalesce(public.firm_office_words(firm.id), '');

  -- The company as the operator recorded it, with its CNPJ; where the operator has not, by the name it flies
  -- under (a mandate names who it is against, and needs no registration of it): never guessed.
  defendant := case
    when nullif(btrim(airline.legal_name), '') is not null then btrim(airline.legal_name) || coalesce(
      ', CNPJ nº ' || regexp_replace(airline.cnpj, '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5'), '')
    when nullif(btrim(airline.name), '') is not null then 'a companhia aérea ' || btrim(airline.name)
    else 'a companhia aérea responsável pelo voo'
  end;

  -- What happened: the problem, on the leg it happened on (the one marked, else the first), and its day.
  select * into leg from public.flight_segments f
  where f.case_id = target_case
  order by f.affected desc, f.position, f.id
  limit 1;
  subject := case current_case.incident
      when 'delay' then 'o atraso'
      when 'cancellation' then 'o cancelamento'
      when 'overbooking' then 'a preterição de embarque'
      when 'missed_connection' then 'a perda da conexão'
      when 'downgrade' then 'a mudança para uma classe inferior'
      when 'baggage_lost' then 'o extravio da bagagem'
      when 'baggage_damaged' then 'o dano à bagagem'
      when 'baggage_delayed' then 'o atraso na entrega da bagagem'
      else 'o problema'
    end || case
      when leg.flight_number is not null then
        ' do voo ' || substr(leg.flight_number, 1, 2) || ' ' || substr(leg.flight_number, 3)
        || coalesce(' de ' || leg.origin_iata || ' para ' || leg.destination_iata, '')
        || coalesce(', de ' || to_char(coalesce(leg.scheduled_departure_local::date, current_case.flight_date), 'DD/MM/YYYY'), '')
      when current_case.flight_date is not null then ' da viagem de ' || to_char(current_case.flight_date, 'DD/MM/YYYY')
      else ' da viagem'
    end;

  place := coalesce(nullif(btrim(person.city), ''), '[COMPLETAR: cidade de ' || person.full_name || ']')
    || ', ' || extract(day from today)::integer || ' de ' || months[extract(month from today)::integer]
    || ' de ' || extract(year from today)::integer;

  -- Field by field (0093), for a model that writes the person's data one line each, as a firm's own form does:
  -- what is not on record keeps the paper from being issued, as in the qualification; an e-mail or a telephone the
  -- person has none of is said so.
  minors := (
    select string_agg(
      case when pe.birth_date is not null and pe.birth_date <= today - interval '16 years'
        then 'assistindo ' else 'como representante legal de ' end
      || public.person_qualification(cp.person_id, true), '; e ' order by cp.created_at, cp.id)
    from public.case_parties g
    join public.case_parties cp on cp.guardian_id = g.id and cp.role = 'claimant'
    join public.people pe on pe.id = cp.person_id
    where g.case_id = target_case and g.person_id = target_person
  );
  marital_word := case person.marital_status
    when 'solteiro' then 'solteiro(a)' when 'casado' then 'casado(a)' when 'uniao_estavel' then 'em união estável'
    when 'divorciado' then 'divorciado(a)' when 'separado' then 'separado(a)' when 'viuvo' then 'viúvo(a)' end;
  address_text := case when person.street is not null and person.city is not null and person.uf is not null then
    person.street || coalesce(', nº ' || nullif(btrim(person.address_number), ''), '')
      || coalesce(', ' || nullif(btrim(person.complement), ''), '')
      || coalesce(', ' || nullif(btrim(person.district), ''), '')
      || ', ' || person.city || '/' || person.uf end;
  digits := regexp_replace(coalesce(person.phone, ''), '\D', '', 'g');
  if char_length(digits) in (12, 13) and left(digits, 2) = '55' then
    digits := substr(digits, 3);
  end if;
  phone_text := case
    when char_length(digits) = 11 then '(' || substr(digits, 1, 2) || ') ' || substr(digits, 3, 5) || '-' || substr(digits, 8)
    when char_length(digits) = 10 then '(' || substr(digits, 1, 2) || ') ' || substr(digits, 3, 4) || '-' || substr(digits, 7)
    else nullif(btrim(person.phone), '')
  end;
  written_date := extract(day from today)::integer || ' de ' || months[extract(month from today)::integer]
    || ' de ' || extract(year from today)::integer;

  filled := replace(filled, '[[OUTORGANTE]]', grantor);
  filled := replace(filled, '[[CONTRATANTE]]', grantor);
  filled := replace(filled, '[[OUTORGADOS]]', coalesce(lawyers, '[COMPLETAR: advogados que assinam pelo escritório]'));
  filled := replace(filled, '[[ESCRITORIO]]', office);
  filled := replace(filled, '[[RE]]', defendant);
  filled := replace(filled, '[[OBJETO]]', subject);
  filled := replace(filled, '[[LOCAL_DATA]]', place);
  filled := replace(filled, '[[NOME]]', person.full_name);
  filled := replace(filled, '[[NACIONALIDADE]]', coalesce(nullif(btrim(person.nationality), ''),
    '[COMPLETAR: nacionalidade de ' || person.full_name || ']'));
  filled := replace(filled, '[[ESTADO_CIVIL]]', coalesce(marital_word,
    '[COMPLETAR: estado civil de ' || person.full_name || ']'));
  filled := replace(filled, '[[PROFISSAO]]', coalesce(nullif(btrim(person.profession), ''),
    '[COMPLETAR: profissão de ' || person.full_name || ']'));
  filled := replace(filled, '[[CPF]]', coalesce(regexp_replace(person.cpf, '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4'),
    '[COMPLETAR: CPF de ' || person.full_name || ']'));
  filled := replace(filled, '[[NASCIMENTO]]', coalesce(to_char(person.birth_date, 'DD/MM/YYYY'),
    '[COMPLETAR: data de nascimento de ' || person.full_name || ']'));
  filled := replace(filled, '[[ENDERECO]]', coalesce(address_text,
    '[COMPLETAR: endereço de ' || person.full_name || ']'));
  filled := replace(filled, '[[CEP]]', coalesce(regexp_replace(person.postal_code, '^(\d{5})(\d{3})$', '\1-\2'),
    '[COMPLETAR: CEP de ' || person.full_name || ']'));
  filled := replace(filled, '[[EMAIL]]', coalesce(nullif(btrim(person.email), ''), 'não informado'));
  filled := replace(filled, '[[TELEFONE]]', coalesce(phone_text, 'não informado'));
  filled := replace(filled, '[[DATA]]', written_date);
  -- The minors the person represents in the case; with none, a paragraph that holds only the mark goes.
  if minors is null then
    filled := regexp_replace(filled, '(^|\n)[ \t]*\[\[REPRESENTADOS\]\][ \t]*[.;]?[ \t]*(\n|$)', '\1', 'g');
    filled := btrim(regexp_replace(filled, '\n{3,}', E'\n\n', 'g'), E'\n');
  end if;
  filled := replace(filled, '[[REPRESENTADOS]]', coalesce('Neste ato, ' || minors || '.', ''));
  return filled;
end;
$$;

revoke all on function public.case_paper_filled(uuid, uuid, text) from public, anon, authenticated;
