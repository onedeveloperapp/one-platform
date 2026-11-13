-- ============================================================
-- The proof of address in the chat (0237). The owner, 2026-11-13: ONE
-- asks a proof of address in the client's own name and of the last three
-- months, and never offers one in somebody else's name, since that one
-- costs the client more steps; when the client sends one anyway, or asks,
-- the firm's choice of 0123 applies as before. Three parts:
--
--   * the date of a bill: the check's seventh instructions read it
--     (`dados_lidos.data_referencia`) and a rule refuses a bill older than
--     the months the platform takes (`platform_settings` `address_proof`,
--     three), by its month, counted from the day the file arrived;
--   * who the holder of a bill in somebody else's name is to the client,
--     asked in the chat as the link asks it (`chat_questions_owed` gains
--     `residence`, before the other words), answered there
--     (`one_answer_residence`, as the client), the step ended whenever the
--     declaration no longer waits for that answer;
--   * the papers signed by gov.br: the link they are on goes with the
--     message that tells them, since the case opened in the chat no longer
--     sends it (0236): `one_tell_signature_links` makes a new link of the
--     person's case when the backend hands it a token.
-- ============================================================

insert into public.platform_settings (key, value)
values ('address_proof', jsonb_build_object('max_age_months', 3))
on conflict (key) do nothing;

/** How many months back a proof of address may be dated, by its month (0237): the platform's setting, three by default. */
create or replace function public.address_proof_months()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(least(coalesce((
    select case when s.value ->> 'max_age_months' ~ '^[0-9]{1,2}$' then (s.value ->> 'max_age_months')::integer end
    from public.platform_settings s where s.key = 'address_proof'), 3), 24), 1);
$$;

revoke all on function public.address_proof_months() from public, anon;
grant execute on function public.address_proof_months() to authenticated, service_role;

/** A day written `YYYY-MM-DD`, or null when it is not one. Internal. */
create or replace function public.read_day(target text)
returns date
language plpgsql
immutable
set search_path = public
as $$
begin
  if target is null or btrim(target) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return btrim(target)::date;
exception when others then
  return null;
end;
$$;

revoke all on function public.read_day(text) from public, anon, authenticated;

/** A month as a sentence says it: "agosto de 2026". Internal. */
create or replace function public.month_words(target date)
returns text
language sql
immutable
set search_path = public
as $$
  select (array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
                'novembro', 'dezembro'])[extract(month from target)::integer]
         || ' de ' || extract(year from target)::integer;
$$;

revoke all on function public.month_words(date) from public, anon, authenticated;

-- ---------- The check of a document, the date of a bill ----------

/**
 * A check's answer applied to its document (0123, 0236, redefined): as before, and a proof of address older than the
 * months the platform takes is refused, its date read by the model and the rule here (0237).
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
  bill_day date;
  max_months integer := public.address_proof_months();
  arrived date;
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

  -- A proof of address older than the months the platform takes (0237): the date ONE read decides, by its month,
  -- counted from the day the file arrived; a bill with no date read is not refused for it.
  if decision = 'aceitar' and document.kind = 'address_proof' then
    bill_day := public.read_day(target_output #>> '{dados_lidos,data_referencia}');
    arrived := (document.created_at at time zone 'America/Sao_Paulo')::date;
    if bill_day is not null and bill_day <= arrived
       and date_trunc('month', bill_day) < date_trunc('month', arrived) - make_interval(months => max_months) then
      decision := 'recusar';
      reason := 'Esta conta é de ' || public.month_words(bill_day)
        || '. Envie um comprovante de endereço no seu nome '
        || case when max_months = 1 then 'do último mês' else 'dos últimos ' || max_months || ' meses' end || '.';
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

-- ---------- The seventh instructions of the check: the date of a bill ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.documento.conferencia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    'Jardim América) e uf (a sigla do estado).',
    'Jardim América), uf (a sigla do estado) e data_referencia (AAAA-MM-DD: o dia em que a conta ou o documento foi emitido; sem ele, o vencimento; sem ele, o primeiro dia do mês a que a conta se refere). Não recuse um comprovante de endereço pela data: uma regra decide por ela.'),
  jsonb_set(
    jsonb_set(v.output_schema, '{properties,dados_lidos,properties,data_referencia}',
              '{"type": "string", "description": "AAAA-MM-DD, ou vazio."}'::jsonb),
    '{properties,dados_lidos,required}',
    (v.output_schema #> '{properties,dados_lidos,required}') || '["data_referencia"]'::jsonb),
  v.max_tokens, false,
  'Lê a data de um comprovante de endereço: uma regra recusa o que for mais antigo que os meses aceitos (0237).'
from public.prompt_versions v
where v.task = 'caso.documento.conferencia' and v.is_active
  and strpos(v.system_prompt, 'Jardim América) e uf (a sigla do estado).') > 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.conferencia' and v.is_active
  and exists (
    select 1 from public.prompt_versions n
    where n.task = v.task and n.version > v.version and strpos(n.system_prompt, 'data_referencia') > 0
  );
update public.prompt_versions as v set is_active = true
where v.task = 'caso.documento.conferencia'
  and v.version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.documento.conferencia')
  and strpos(v.system_prompt, 'data_referencia') > 0;

-- ---------- Who the holder of a bill is, asked in the chat ----------

/**
 * The client's words ONE owes a question for in the chat (replaces 0235's): as before, and first of all who the holder
 * of a bill in somebody else's name is to the client (`residence`, the holder's name as `wording`), while the
 * declaration waits for that answer and its paper was not issued (0237). Service role.
 */
create or replace function public.chat_questions_owed(target_limit integer default 20)
returns table (
  conversation_id uuid,
  org_id uuid,
  case_id uuid,
  kind text,
  party_id uuid,
  party_name text,
  own boolean,
  appeal boolean,
  wording text
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
  with talk as (
    select wc.id as conversation_id, wc.org_id, p.id as person_id, wc.last_inbound_at
    from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.people p on p.org_id = wc.org_id and p.erased_at is null and p.phone is not null
      and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and coalesce(wc.chat_step ->> 'step', '') = ''
      and not public.conversation_account_waits(wc)
      and not exists (select 1 from public.wa_optouts o where o.org_id = wc.org_id and o.contact_wa_id = wc.contact_wa_id)
  ), cases_of as (
    select distinct t.conversation_id, t.org_id, t.person_id, t.last_inbound_at, c.id as case_id
    from talk t
    join public.case_parties cp on cp.person_id = t.person_id
    join public.cases c on c.id = cp.case_id and c.org_id = t.org_id and c.status not in ('closed', 'declined')
  ), owed as (
    select co.conversation_id, co.org_id, co.case_id, 'residence'::text as kind,
           (select x.id from public.case_parties x where x.case_id = d.case_id and x.person_id = d.person_id
            order by (x.role = 'claimant') desc, x.created_at, x.id limit 1) as party_id,
           true as own, false as appeal, d.holder_name as wording, -1 as rank, co.last_inbound_at
    from cases_of co
    join public.residence_declarations d on d.case_id = co.case_id and d.person_id = co.person_id
      and d.status = 'open' and d.relation is null
    where not exists (
      select 1 from public.case_papers paper
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
    )
    union all
    select co.conversation_id, co.org_id, co.case_id, 'free_justice'::text, n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           public.lawsuit_appeal_open(n.proceeding_id), null::text, 0,
           co.last_inbound_at
    from cases_of co
    cross join lateral public.free_justice_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.answer_id is null
    union all
    select co.conversation_id, co.org_id, co.case_id, 'civil_court', n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           false, public.civil_court_wording(n.party_id), 1, co.last_inbound_at
    from cases_of co
    cross join lateral public.civil_court_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.planned and n.answer_id is null
      and public.civil_court_wording(n.party_id) is not null
  )
  select distinct on (o.conversation_id)
         o.conversation_id, o.org_id, o.case_id, o.kind, o.party_id, pp.full_name, o.own, o.appeal, o.wording
  from owed o
  join public.case_parties cp on cp.id = o.party_id
  join public.people pp on pp.id = cp.person_id
  order by o.conversation_id, o.rank, o.party_id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.chat_questions_owed(integer) from public, anon, authenticated;
grant execute on function public.chat_questions_owed(integer) to service_role;

/**
 * The client says in the chat who the holder of their bill is to them (0237), kept as on their link
 * (`client_link_answer_residence`): by the person of this conversation, for the declaration of the case ONE asked
 * about, until its paper is issued; `outro` with the client's own words. The conversation's step ends whatever the
 * answer meets. Answers `{ok}`, or `{ok: false, code}`: `not_working`, `not_asked`, `not_found`, `issued`,
 * `relation`, `note`. Service role, for the conversation the backend holds.
 */
create or replace function public.one_answer_residence(
  target_conversation uuid,
  target_claim integer,
  target_relation text,
  target_note text,
  target_message uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  party uuid;
  asked_case uuid;
  person uuid;
  declaration public.residence_declarations%rowtype;
  note text := nullif(regexp_replace(btrim(coalesce(target_note, '')), '\s+', ' ', 'g'), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if coalesce(conversation.chat_step ->> 'step', '') <> 'residence' then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  party := nullif(conversation.chat_step ->> 'party', '')::uuid;
  asked_case := nullif(conversation.chat_step ->> 'case', '')::uuid;
  update public.wa_conversations set chat_step = chat_step - 'step' - 'party' - 'case' - 'ask' where id = conversation.id;
  select p.id into person from public.people p
  join public.case_parties cp on cp.person_id = p.id and cp.id = party and cp.case_id = asked_case
  where p.org_id = conversation.org_id and p.erased_at is null
    and conversation.contact_wa_id = any (public.wa_phone_variants(p.phone));
  if person is null then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  select * into declaration from public.residence_declarations
  where case_id = asked_case and person_id = person and status = 'open'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (
    select 1 from public.case_papers paper
    where paper.case_id = declaration.case_id and paper.person_id = declaration.person_id
      and paper.kind = 'declaracao_residencia'
  ) then
    return jsonb_build_object('ok', false, 'code', 'issued');
  end if;
  if target_relation is null or target_relation not in (
    'mae', 'pai', 'conjuge', 'filho', 'irmao', 'avo', 'parente', 'proprietario', 'outro'
  ) then
    return jsonb_build_object('ok', false, 'code', 'relation');
  end if;
  if target_relation = 'outro' and (note is null or char_length(note) not between 2 and 60 or note ~ '[[:cntrl:]]') then
    return jsonb_build_object('ok', false, 'code', 'note');
  end if;
  update public.residence_declarations
  set relation = target_relation, relation_note = case when target_relation = 'outro' then note end,
      answered_source = 'client', answered_by = null, answered_at = now(),
      answer_evidence = jsonb_strip_nulls(jsonb_build_object('channel', 'whatsapp', 'message', target_message))
  where id = declaration.id;
  perform public.record_case_event(declaration.org_id, declaration.case_id, 'residence_relation_answered', 'client',
    jsonb_build_object('person', declaration.person_id, 'declaration', declaration.id, 'from', 'conversation'));
  perform public.wake_case_advance(declaration.case_id);
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.one_answer_residence(uuid, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.one_answer_residence(uuid, integer, text, text, uuid) to service_role;

/**
 * The question of a declaration ends with it (0237): once the holder's relation is said (in the chat, on the link or
 * by the firm) or the declaration no longer stands, a conversation of the firm still waiting for that answer of that
 * case waits no more.
 */
create or replace function public.residence_declarations_end_chat_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'open' or new.relation is not null then
    update public.wa_conversations
    set chat_step = chat_step - 'step' - 'party' - 'case' - 'ask'
    where org_id = new.org_id and chat_step ->> 'step' = 'residence' and chat_step ->> 'case' = new.case_id::text;
  end if;
  return null;
end;
$$;

revoke all on function public.residence_declarations_end_chat_step() from public, anon, authenticated;

create trigger residence_declarations_end_chat_step
after update of relation, status on public.residence_declarations
for each row execute function public.residence_declarations_end_chat_step();

-- ---------- The papers signed by gov.br, with the link they are on ----------

drop function public.one_tell_signature_links(uuid, uuid[], text);

/**
 * ONE writes the links to sign in the conversation (0231, redefined): only the papers still owed a word (checked again
 * under the conversation's lock), each marked told in the same transaction as the message; with `target_token_hash`,
 * a new link of the person's case is made in the same transaction (the papers signed by gov.br are on it, and the case
 * opened in the chat sent none, 0236), and nothing is told when it cannot be. Service role.
 */
create or replace function public.one_tell_signature_links(
  target_conversation uuid,
  target_papers uuid[],
  target_body text,
  target_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  owed_row record;
  message uuid;
  told integer;
  made jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into owed_row from public.signature_links_owed(100) o where o.conversation_id = target_conversation limit 1;
  if owed_row.conversation_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation for update;
  update public.case_papers set told_in_chat_at = now()
  where id = any (target_papers) and told_in_chat_at is null and case_id = owed_row.case_id
    and person_id = owed_row.person_id;
  get diagnostics told = row_count;
  if told = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  if target_token_hash is not null then
    perform set_config('one.system_case', owed_row.case_id::text, true);
    made := public.create_client_link(owed_row.case_id, owed_row.person_id, target_token_hash);
    perform set_config('one.system_case', '', true);
    if not coalesce((made ->> 'ok')::boolean, false) then
      raise exception using errcode = 'P0001', message = 'link_' || coalesce(made ->> 'code', 'failed');
    end if;
  end if;
  -- A message that cannot be written (the window closed, the person asked to stop) undoes the marks with it.
  message := public.one_message(conversation, target_body, null, null);
  perform public.record_case_event(owed_row.org_id, owed_row.case_id, 'signature_told', 'system',
    jsonb_build_object('papers', told, 'from', 'conversation'));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'told', told);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_tell_signature_links(uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.one_tell_signature_links(uuid, uuid[], text, text) to service_role;

-- ---------- The client's data written in the chat wakes the case ----------

/**
 * The client writes their own data in the chat (0232, redefined): as before, and the case is looked at again right
 * after (0237). The write runs as ONE's own (`one.system_case`), which wakes nothing, so a power of attorney that
 * waited for the client's profession or marital status waited for the next round of the sweep, hours later (the
 * owner's test of 2026-11-13). Service role, for the conversation the backend holds.
 */
create or replace function public.one_person_fields(
  target_conversation uuid,
  target_claim integer,
  target_fields jsonb,
  target_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  data jsonb;
  person uuid;
  written jsonb := jsonb_build_object('ok', true, 'changed', '[]'::jsonb);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  data := public.conversation_person_data(conversation);
  if data is null then
    return jsonb_build_object('ok', false, 'code', 'no_case');
  end if;
  person := (data ->> 'person_id')::uuid;
  perform set_config('one.system_case', data ->> 'case_id', true);
  if jsonb_typeof(coalesce(target_fields, '{}'::jsonb)) = 'object' and coalesce(target_fields, '{}'::jsonb) <> '{}'::jsonb then
    written := public.apply_person_fields(person, target_fields, 'client');
    if not coalesce((written ->> 'ok')::boolean, false) then
      perform set_config('one.system_case', '', true);
      return written;
    end if;
  end if;
  if target_confirm then
    update public.people set read_fields = '{}'::jsonb where id = person and read_fields <> '{}'::jsonb;
    perform public.record_case_event(conversation.org_id, (data ->> 'case_id')::uuid, 'person_confirmed', 'client',
      jsonb_build_object('person', person, 'from', 'conversation'));
  end if;
  perform set_config('one.system_case', '', true);
  -- What the client wrote is the client's: the case is looked at again, as a write on their link wakes it.
  perform public.wake_case_advance((data ->> 'case_id')::uuid);
  return jsonb_build_object('ok', true, 'code', 'kept', 'changed', coalesce(written -> 'changed', '[]'::jsonb));
end;
$$;

revoke all on function public.one_person_fields(uuid, integer, jsonb, boolean) from public, anon, authenticated;
