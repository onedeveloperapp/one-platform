-- ============================================================
-- The first documents in the chat (0236). The owner, as a client, typed one
-- name and sent an identity in another (2026-11-12): the check refused it
-- for the name, though the document was right and the name typed was not.
-- A name a person typed in a chat (or how they asked to be called, 0227)
-- is not a settled name: the identity's name takes its place while no
-- document, issued paper or registry settled it (`person_name_settled`),
-- and an identity is refused for its name only once the name is settled
-- (`apply_document_check`, redefined from 0123, with the sixth version of
-- the check's instructions). And the case opened in the chat asks the
-- identity alone, with no link (the backend's words): the firm's own text
-- of that moment no longer needs the link (`one_messages` `link_steps`).
-- ============================================================

-- ---------- The case opened in the chat, without the link ----------

update public.one_messages
set required = '{}',
    optional = array['nome', 'caso', 'link'],
    where_said = 'Logo que o passageiro aceita seguir e o caso é aberto: o primeiro documento pedido na conversa.',
    example = 'Pronto, {nome}. O seu caso está aberto no escritório. Agora mande aqui a foto do seu documento de identidade, RG ou CNH, com a frente e o verso.'
where key = 'link_steps';

-- ---------- Whose name is settled ----------

/**
 * Whether a person's name is settled (0236): a document already wrote it, a paper was issued in it, the registry
 * found it on their CPF, or an identity of theirs other than `target_except` was accepted. A name only typed (in a
 * chat, on a form) is not. Internal.
 */
create or replace function public.person_name_settled(target_person uuid, target_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.people p
                 where p.id = target_person and (p.read_fields ? 'full_name' or p.cpf_name_matches is true))
      or exists (select 1 from public.case_papers paper where paper.person_id = target_person)
      or exists (
        select 1 from public.case_documents d join public.case_parties cp on cp.id = d.party_id
        where cp.person_id = target_person and d.kind = 'identity' and d.status = 'accepted'
          and d.id is distinct from target_except
      );
$$;

revoke all on function public.person_name_settled(uuid, uuid) from public, anon, authenticated;

-- ---------- The check of a document, the identity's name first ----------

/**
 * A check's answer applied to its document (0123, redefined): as before, and an identity in another name than the
 * case's is accepted with the document's name for the person while their name is not settled, or refused for it
 * once it is (0236).
 */
create or replace function public.apply_document_check(
  target_run uuid,
  target_output jsonb,
  target_actor_type text,
  target_approval uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.case_documents%rowtype;
  decision text := lower(btrim(coalesce(target_output ->> 'decisao', '')));
  reason text := nullif(btrim(coalesce(target_output ->> 'motivo', '')), '');
  match text := lower(btrim(coalesce(target_output ->> 'confere_com_a_pessoa', '')));
  holder text := regexp_replace(btrim(coalesce(target_output ->> 'nome_no_documento', '')), '\s+', ' ', 'g');
  third boolean := false;
  named boolean := false;
  person public.people%rowtype;
  read_name text;
  applied_name jsonb;
  owner uuid;
  ended uuid;
  leg jsonb;
  segment uuid;
  applied jsonb;
  flight text;
  departure text;
  added integer := 0;
begin
  select * into document from public.case_documents where id = public.document_of_check(target_run) for update;
  if not found or document.status <> 'received' then
    return 'already_decided';
  end if;

  -- An identity in another name than the case's (0236): the name a person typed in a chat, or a nickname, gives way
  -- to the document's while no document, paper or registry settled it; once settled, it is another person's.
  if decision = 'aceitar' and document.kind = 'identity' and match = 'nao' and document.party_id is not null then
    select p.* into person
    from public.case_parties cp join public.people p on p.id = cp.person_id
    where cp.id = document.party_id;
    read_name := public.name_case(regexp_replace(btrim(coalesce(
      nullif(target_output #>> '{dados_lidos,nome_completo}', ''), holder)), '\s+', ' ', 'g'));
    if person.id is not null and char_length(coalesce(read_name, '')) between 3 and 160
       and not public.person_name_settled(person.id, document.id) then
      named := true;
    else
      decision := 'recusar';
      reason := 'O nome neste documento não é o de ' || coalesce(nullif(split_part(btrim(person.full_name), ' ', 1), ''), 'quem está no caso')
        || '. Envie o documento de identidade de ' || coalesce(nullif(split_part(btrim(person.full_name), ' ', 1), ''), 'quem está no caso') || '.';
    end if;
  end if;

  -- A bill in somebody else's name: the firm's choice, and a name read, decide it.
  if decision = 'aceitar' and document.kind = 'address_proof' and match = 'nao' and document.party_id is not null then
    if (select o.third_party_bill from public.organizations o where o.id = document.org_id) = 'refuse' then
      decision := 'recusar';
      reason := 'A conta está em nome de outra pessoa, e o escritório pede um comprovante de endereço no seu nome. Envie uma conta, um extrato ou um contrato de aluguel em seu nome.';
    elsif char_length(holder) not between 2 and 120 then
      decision := 'recusar';
      reason := 'Não deu para ler em nome de quem está a conta. Envie uma foto em que o nome apareça inteiro.';
    else
      third := true;
    end if;
  end if;

  if decision = 'recusar' then
    update public.case_documents
    set status = 'rejected', rejected_reason = left(coalesce(reason, 'O documento não pôde ser aceito. Envie outro arquivo.'), 500),
        decided_by = auth.uid(), decided_at = now()
    where id = document.id;
    perform public.record_case_event(document.org_id, document.case_id, 'document_rejected', target_actor_type,
      jsonb_strip_nulls(jsonb_build_object('document', document.id, 'kind', document.kind, 'approval', target_approval)));
    perform public.withdraw_document_checks(document.id, target_approval);
    return 'rejected';
  end if;
  if decision <> 'aceitar' then
    return 'no_decision';
  end if;

  update public.case_documents set status = 'accepted', decided_by = auth.uid(), decided_at = now()
  where id = document.id;
  perform public.record_case_event(document.org_id, document.case_id, 'document_accepted', target_actor_type,
    jsonb_strip_nulls(jsonb_build_object('document', document.id, 'kind', document.kind, 'approval', target_approval)));
  perform public.withdraw_document_checks(document.id, target_approval);

  if document.kind = 'address_proof' and document.party_id is not null and match in ('sim', 'nao') then
    select cp.person_id into owner from public.case_parties cp where cp.id = document.party_id;
    -- Another bill of the person replaces the declaration the last one owed; one of their own needs none.
    for ended in
      select d.id from public.residence_declarations d
      where d.case_id = document.case_id and d.person_id = owner and d.status = 'open'
    loop
      perform public.end_residence_declaration(ended, 'void',
        case when third then 'Outro comprovante de endereço em nome de outra pessoa foi aceito.'
             else 'Um comprovante de endereço no nome da pessoa foi aceito.' end,
        target_actor_type);
    end loop;
  end if;

  if named then
    -- The document's name is the person's, and what else it says of them is read as of a document of theirs.
    applied_name := public.apply_person_fields(person.id, jsonb_build_object('full_name', read_name), 'document');
    if (applied_name ->> 'ok')::boolean then
      update public.people
      set read_fields = read_fields || jsonb_build_object('full_name', jsonb_build_object('document', document.id, 'kind', document.kind))
      where id = person.id;
      perform public.record_case_event(document.org_id, document.case_id, 'person_named_by_document', target_actor_type,
        jsonb_strip_nulls(jsonb_build_object('person', person.id, 'document', document.id, 'approval', target_approval)));
    end if;
    perform public.apply_document_data(document.id, target_output || '{"confere_com_a_pessoa": "sim"}'::jsonb,
      target_actor_type);
  elsif third then
    insert into public.residence_declarations (org_id, case_id, person_id, document_id, holder_name, holder_read,
                                                bill_city, bill_uf)
    values (document.org_id, document.case_id, owner, document.id, public.name_case(holder), holder,
            nullif(public.name_case(regexp_replace(btrim(coalesce(target_output #>> '{dados_lidos,cidade}', '')), '\s+', ' ', 'g')), ''),
            nullif(upper(btrim(coalesce(target_output #>> '{dados_lidos,uf}', ''))), ''));
    perform public.record_case_event(document.org_id, document.case_id, 'residence_declaration_owed', target_actor_type,
      jsonb_build_object('person', owner, 'document', document.id));
    -- The bill says where the person lives, as a bill of their own would: the declaration says they live there.
    perform public.apply_document_data(document.id, target_output || '{"confere_com_a_pessoa": "sim"}'::jsonb,
      target_actor_type);
  else
    perform public.apply_document_data(document.id, target_output, target_actor_type);
  end if;

  if document.kind in ('ticket', 'boarding_pass') and jsonb_typeof(target_output -> 'trechos') = 'array' then
    for leg in select value from jsonb_array_elements(target_output -> 'trechos') limit 8 loop
      continue when jsonb_typeof(leg) <> 'object';
      flight := upper(regexp_replace(coalesce(leg ->> 'voo', ''), '[[:space:]-]', '', 'g'));
      flight := (select m[1] || m[2] || m[3] from regexp_match(flight, '^([A-Z0-9]{2})0*([1-9][0-9]{0,3})([A-Z]?)$') as m);
      continue when flight is null;
      departure := substring(btrim(coalesce(leg ->> 'saida_prevista', '')) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}');
      continue when exists (
        select 1 from public.flight_segments s
        where s.case_id = document.case_id and s.flight_number = flight
          and (departure is null or s.scheduled_departure_local is null
               or to_char(s.scheduled_departure_local, 'YYYY-MM-DD') = departure)
      );
      continue when coalesce((select max(s.position) from public.flight_segments s where s.case_id = document.case_id), 0) >= 20;
      begin
        insert into public.flight_segments (org_id, case_id, position, source)
        values (document.org_id, document.case_id,
                coalesce((select max(s.position) + 1 from public.flight_segments s where s.case_id = document.case_id), 1),
                'firm')
        returning id into segment;
        applied := public.apply_segment_fields(segment, jsonb_build_object(
          'flight_number', leg ->> 'voo',
          'origin_iata', leg ->> 'origem',
          'destination_iata', leg ->> 'destino',
          'scheduled_departure_local', leg ->> 'saida_prevista',
          'scheduled_arrival_local', leg ->> 'chegada_prevista',
          'booking_reference', leg ->> 'reserva'
        ), 'firm');
        if not (applied ->> 'ok')::boolean then
          raise exception using errcode = 'P0001', message = applied ->> 'code';
        end if;
        added := added + 1;
      exception when raise_exception or check_violation or not_null_violation or foreign_key_violation
                  or invalid_text_representation or datetime_field_overflow then
        null;
      end;
    end loop;
    if added > 0 then
      perform public.record_case_event(document.org_id, document.case_id, 'segments_read', target_actor_type,
        jsonb_strip_nulls(jsonb_build_object('document', document.id, 'count', added, 'approval', target_approval)));
    end if;
  end if;
  return 'accepted';
end;
$$;

revoke all on function public.apply_document_check(uuid, jsonb, text, uuid) from public, anon, authenticated;

-- ---------- The sixth instructions of the check ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.documento.conferencia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    '"recusar" em qualquer outro caso. Um comprovante de endereço em nome de outra pessoa (um parente, o dono do imóvel) é a única exceção: não o recuse pelo nome.',
    '"recusar" em qualquer outro caso. Nunca recuse um documento de identidade pelo nome: o nome do caso pode ter vindo do que a pessoa escreveu numa conversa, com erro de digitação ou um apelido. Aceite-o quando for do tipo dito, legível e inteiro, escreva em nome_no_documento o nome como está nele e responda "nao" em confere_com_a_pessoa quando não bater: uma regra decide se o nome do documento passa a ser o do caso. Um comprovante de endereço em nome de outra pessoa (um parente, o dono do imóvel) também não é recusado pelo nome.'),
  v.output_schema, v.max_tokens, false,
  'Um documento de identidade não é recusado pelo nome: uma regra decide se o nome dele passa a ser o do caso (0236).'
from public.prompt_versions v
where v.task = 'caso.documento.conferencia' and v.is_active
  and strpos(v.system_prompt, '"recusar" em qualquer outro caso. Um comprovante de endereço em nome de outra pessoa (um parente, o dono do imóvel) é a única exceção: não o recuse pelo nome.') > 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.conferencia' and v.is_active
  and exists (
    select 1 from public.prompt_versions n
    where n.task = v.task and n.version > v.version and strpos(n.system_prompt, 'Nunca recuse um documento de identidade pelo nome') > 0
  );
update public.prompt_versions as v set is_active = true
where v.task = 'caso.documento.conferencia'
  and v.version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.documento.conferencia')
  and strpos(v.system_prompt, 'Nunca recuse um documento de identidade pelo nome') > 0;
