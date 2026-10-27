-- 0065_document_data_case.sql
-- ============================================================
-- What a document says of its person is written as names are written (0063, after its first walk).
--
-- The walk of 2026-10-27 against the development project, with the real model, read an identity and a bill
-- right: the full name, the CPF, the birth date (never the day it was issued nor its validity), the
-- nationality, and the address the bill is for (never the company's that issued it). The name came written as
-- a name, as the instructions asked; the address came as the bill prints it, in capitals ("RUA DAS PALMEIRAS",
-- "SETOR BUENO", "GOIÂNIA"), and that is how the record, the client's page, the power of attorney and the piece
-- would write it. So:
--
--   * the third version of the check's instructions asks for the street, the number, the complement, the
--     district and the city written as names, as it asks for the person's name;
--   * and the database writes as a name what a document read gives all in capitals (`name_case`: each word
--     with its capital, de, da, do, das, dos and e in small letters but the first), whatever wrote it: an answer
--     of the version before, or a model that copied the capitals all the same. A value with a small letter in
--     it is left as it came.
-- ============================================================

-- ---------- A name written in capitals, written as a name ----------

/**
 * A value read all in capitals, written as a name ("RUA DAS PALMEIRAS" is "Rua das Palmeiras", "APTO 302" is
 * "Apto 302", "S/N" stays "S/N"): each word with its first letter in capital and the rest in small letters, and
 * de, da, do, das, dos and e in small letters unless first. A value with any small letter in it, or none, is
 * left as it is.
 */
create or replace function public.name_case(target_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  words text[];
  result text[] := '{}';
  word text;
  place integer := 0;
begin
  if target_value is null or target_value ~ '[[:lower:]]' or btrim(target_value) = '' then
    return target_value;
  end if;
  words := regexp_split_to_array(btrim(regexp_replace(target_value, '\s+', ' ', 'g')), ' ');
  foreach word in array words loop
    place := place + 1;
    result := result || case
      when place > 1 and lower(word) in ('de', 'da', 'do', 'das', 'dos', 'e') then lower(word)
      else initcap(word)
    end;
  end loop;
  return array_to_string(result, ' ');
end;
$$;

revoke all on function public.name_case(text) from public, anon, authenticated;

-- ---------- What an accepted document says, written as names ----------

/**
 * What an accepted document says of its person (0063, redefined): as before, and the name read and the street,
 * the number, the complement, the district and the city of an address written as names when the document gave
 * them in capitals (`name_case`).
 */
create or replace function public.apply_document_data(target_document uuid, target_output jsonb, target_actor_type text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.case_documents%rowtype;
  current_case public.cases%rowtype;
  person public.people%rowtype;
  link public.client_links%rowtype;
  data jsonb := target_output -> 'dados_lidos';
  value text;
  address jsonb;
  missing jsonb;
  applied jsonb;
  written text[] := '{}';
begin
  select * into document from public.case_documents where id = target_document;
  if not found or document.party_id is null or document.status <> 'accepted'
     or document.kind not in ('identity', 'address_proof')
     or jsonb_typeof(data) is distinct from 'object'
     or coalesce(target_output ->> 'confere_com_a_pessoa', '') <> 'sim' then
    return written;
  end if;
  select * into current_case from public.cases where id = document.case_id;
  if not found or current_case.status not in ('intake', 'documents', 'signature') then
    return written;
  end if;
  select p.* into person
  from public.case_parties cp join public.people p on p.id = cp.person_id
  where cp.id = document.party_id
  for update of p;
  if not found then
    return written;
  end if;

  if document.kind = 'identity' then
    -- The name the document completes: the model writes it as a name, and says it as the document prints it.
    -- Once: a name another document completed already is not completed again (a maiden name on one paper and
    -- a married one on another would take turns).
    value := public.name_case(regexp_replace(btrim(coalesce(data ->> 'nome_completo', '')), '\s+', ' ', 'g'));
    if value <> '' and public.plain_name(value) = public.plain_name(target_output ->> 'nome_no_documento')
       and not person.read_fields ? 'full_name'
       and not exists (select 1 from public.case_papers paper where paper.person_id = person.id) then
      value := public.completed_name(person.full_name, value);
      if value is not null then
        applied := public.apply_person_fields(person.id, jsonb_build_object('full_name', value), 'document');
        if (applied ->> 'ok')::boolean then
          written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
        end if;
      end if;
    end if;

    -- The CPF, where there is none: a new CPF is one more of what the link that sent the document may write.
    value := regexp_replace(coalesce(data ->> 'cpf', ''), '\D', '', 'g');
    if person.cpf is null and value ~ '^[0-9]{11}$' and public.cpf_is_valid(value) then
      if document.link_id is not null then
        select * into link from public.client_links where id = document.link_id for update;
      end if;
      if link.id is null or not public.client_link_cpf_spent(link) then
        applied := public.apply_person_fields(person.id, jsonb_build_object('cpf', value), 'document');
        if link.id is not null and ((applied ->> 'ok')::boolean or applied ->> 'code' = 'cpf_in_use') then
          update public.client_links set cpf_attempts = cpf_attempts + 1 where id = link.id;
        end if;
        if (applied ->> 'ok')::boolean then
          written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
        end if;
      end if;
    end if;

    value := btrim(coalesce(data ->> 'data_nascimento', ''));
    if person.birth_date is null and value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      applied := public.apply_person_fields(person.id, jsonb_build_object('birth_date', value), 'document');
      if (applied ->> 'ok')::boolean then
        written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
      end if;
    end if;

    -- Nobody asks a minor's nationality: a minor's record takes none (by the birth date just written, too).
    value := lower(regexp_replace(btrim(coalesce(data ->> 'nacionalidade', '')), '\s+', ' ', 'g'));
    if person.nationality is null and value <> '' and not public.case_party_is_minor(document.party_id) then
      applied := public.apply_person_fields(person.id, jsonb_build_object('nationality', value), 'document');
      if (applied ->> 'ok')::boolean then
        written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
      end if;
    end if;
  else
    -- The address, whole: a postal code, a street, a city and a state at least, and nothing of what the record
    -- has of an address saying another one. Its words written as names.
    address := jsonb_strip_nulls(jsonb_build_object(
      'postal_code', nullif(regexp_replace(coalesce(data ->> 'cep', ''), '\D', '', 'g'), ''),
      'street', nullif(public.name_case(regexp_replace(btrim(coalesce(data ->> 'logradouro', '')), '\s+', ' ', 'g')), ''),
      'address_number', nullif(public.name_case(regexp_replace(btrim(coalesce(data ->> 'numero', '')), '\s+', ' ', 'g')), ''),
      'complement', nullif(public.name_case(regexp_replace(btrim(coalesce(data ->> 'complemento', '')), '\s+', ' ', 'g')), ''),
      'district', nullif(public.name_case(regexp_replace(btrim(coalesce(data ->> 'bairro', '')), '\s+', ' ', 'g')), ''),
      'city', nullif(public.name_case(regexp_replace(btrim(coalesce(data ->> 'cidade', '')), '\s+', ' ', 'g')), ''),
      'uf', nullif(upper(btrim(coalesce(data ->> 'uf', ''))), '')
    ));
    if address ? 'postal_code' and address ? 'street' and address ? 'city' and address ? 'uf'
       and (person.postal_code is null or person.postal_code = address ->> 'postal_code')
       and (person.uf is null or person.uf = address ->> 'uf')
       and (person.city is null or public.plain_name(person.city) = public.plain_name(address ->> 'city'))
       and (person.street is null or public.plain_name(person.street) = public.plain_name(address ->> 'street'))
       and (person.district is null or not address ? 'district'
            or public.plain_name(person.district) = public.plain_name(address ->> 'district'))
       and (person.address_number is null or not address ? 'address_number'
            or public.plain_name(person.address_number) = public.plain_name(address ->> 'address_number'))
       and (person.complement is null or not address ? 'complement'
            or public.plain_name(person.complement) = public.plain_name(address ->> 'complement')) then
      select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb) into missing
      from jsonb_each(address) as item
      where to_jsonb(person) -> item.key = 'null'::jsonb;
      if missing <> '{}'::jsonb then
        applied := public.apply_person_fields(person.id, missing, 'document');
        if (applied ->> 'ok')::boolean then
          written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
        end if;
      end if;
    end if;
  end if;

  if cardinality(written) > 0 then
    update public.people
    set read_fields = read_fields || (
      select jsonb_object_agg(field, jsonb_build_object('document', document.id, 'kind', document.kind))
      from unnest(written) as field
    )
    where id = person.id;
    perform public.record_case_event(document.org_id, document.case_id, 'person_read', target_actor_type,
      jsonb_build_object('person', person.id, 'document', document.id, 'kind', document.kind,
        'fields', to_jsonb(written)));
  end if;
  return written;
end;
$$;

revoke all on function public.apply_document_data(uuid, jsonb, text) from public, anon, authenticated;

-- ---------- The third version of the check's instructions ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.documento.conferencia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    'cep (os 8 dígitos), logradouro, numero, complemento, bairro, cidade e uf (a sigla do estado).',
    'cep (os 8 dígitos), logradouro, numero, complemento, bairro e cidade (cada um escrito como um nome: maiúscula só no início de cada palavra, de, da, do, das, dos e e em minúsculas, com os acentos que o documento traz, como Rua das Flores ou Jardim América) e uf (a sigla do estado).'),
  v.output_schema, v.max_tokens, false,
  'Escreve o endereço lido na grafia de um nome, como já escrevia o nome da pessoa.'
from public.prompt_versions v
where v.task = 'caso.documento.conferencia' and v.is_active
  and strpos(v.system_prompt, 'cep (os 8 dígitos), logradouro, numero, complemento, bairro, cidade e uf (a sigla do estado).') > 0;

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.conferencia' and v.is_active
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version
      and strpos(w.system_prompt, 'bairro e cidade (cada um escrito como um nome') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.documento.conferencia'
  and version = (
    select max(w.version) from public.prompt_versions w
    where w.task = 'caso.documento.conferencia' and strpos(w.system_prompt, 'bairro e cidade (cada um escrito como um nome') > 0
  )
  and not exists (select 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia' and w.is_active);
