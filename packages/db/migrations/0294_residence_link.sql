-- ============================================================
-- 0294_residence_link: a proof of address in somebody else's name goes with a document of the client's link to its
-- holder, or, with none, with the residence declaration the client signs (the owner, 2026-11-25).
--
-- "Preciso que na captação do comprovante de endereço seja permitido submissão sem estar no nome da pessoa desde que
-- ela submeta algum documento que comprove o vínculo, como declaração do próprio punho, certidão de casamento e etc."
-- Asked how it sits with the declaration ONE already issues (0123, the client's own word under Lei 7.115/1983), the
-- owner chose "um ou outro": the client sends what shows the link (a marriage or a stable union certificate, a birth
-- certificate, a lease, the holder's own signed declaration that the client lives with them), and ONE checks it; with
-- none, the declaration goes to sign as before.
--
--   * A kind of a case's document of its own, `residence_link`: the firm attaches it, the client sends it on the link,
--     ONE checks it, the filing package takes it as a paper of the person (`case_advance.package_kinds.person`).
--   * The check's eighth instructions read the names written on it (`nomes_no_documento`), and a rule decides
--     whether the person's and the holder's are among them (`residence_link_names_fit`, the names' rule of 0032);
--     one that does not show both, while the person owes a declaration, is refused with why.
--   * A declaration a document of the link settles ends as `linked` (`settle_residence_by_link`): its paper still to
--     sign is cancelled and goes to no court, and the filing no longer waits for it, but for a city of the bill other
--     than the person's record, as before. The link refused after, the declaration is owed again; the bill refused,
--     it ends.
--   * The link (`client_link_residence`) and the case (`case_residence`) say where it stands.
-- ============================================================

-- ---------- 1. The kind ----------

alter table public.case_documents drop constraint case_documents_kind_check;
alter table public.case_documents add constraint case_documents_kind_check check (kind in (
  'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney',
  'residence_declaration', 'residence_link', 'free_justice_declaration', 'income_proof', 'contract', 'petition',
  'baggage_report', 'defense', 'intermediate_petition', 'other'
));

-- The types a court's system names for each kind of file take the new kind too (0189's check, redefined).
create or replace function public.filing_types_ok(types jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(types) = 'object'
    and coalesce((
      select bool_and(
        key in ('petition', 'power_of_attorney', 'identity', 'address_proof', 'residence_declaration', 'residence_link',
                'free_justice_declaration', 'income_proof', 'ticket', 'boarding_pass', 'baggage_report', 'receipt',
                'evidence', 'contract', 'defense', 'intermediate_petition', 'other')
        and jsonb_typeof(value) = 'string'
        and char_length(value #>> '{}') between 2 and 80
        and value #>> '{}' = btrim(value #>> '{}')
      )
      from jsonb_each(types)
    ), true);
$$;

revoke all on function public.filing_types_ok(jsonb) from public, anon, authenticated;

-- ---------- 2. Who sends it, ONE's check of it, the filing that takes it ----------

/** Adds to a case a file of the firm (0022, redefined): as before, and the document of a client's link to the holder of their bill (0294). */
create or replace function public.attach_case_document(
  target_case uuid,
  target_file uuid,
  target_kind text,
  target_party uuid default null,
  target_source text default 'firm'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  document uuid;
begin
  if target_kind is null or target_kind not in (
    'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney', 'contract',
    'petition', 'residence_link', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if target_source not in ('firm', 'whatsapp') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;
  -- A file somebody uploaded or that came in a conversation: never one the backend made for its own
  -- use (the PDF of a photo, a part cut for a filing package), which is somebody else's to forget.
  if not exists (
    select 1 from public.files f
    where f.id = target_file and f.org_id = current_case.org_id and f.status = 'stored'
      and f.purpose in ('upload', 'whatsapp')
  ) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  if exists (select 1 from public.case_documents d where d.file_id = target_file) then
    return jsonb_build_object('ok', false, 'code', 'already_attached');
  end if;
  if target_party is not null and not exists (
    select 1 from public.case_parties cp where cp.id = target_party and cp.case_id = current_case.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status)
  values (current_case.org_id, current_case.id, target_party, target_file, target_kind, target_source, 'received')
  returning id into document;

  perform public.record_case_event(current_case.org_id, current_case.id, 'document_added', 'person',
    jsonb_build_object('document', document, 'kind', target_kind, 'source', target_source));
  return jsonb_build_object('ok', true, 'code', 'attached', 'document_id', document);
end;
$$;

revoke all on function public.attach_case_document(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.attach_case_document(uuid, uuid, text, uuid, text) to authenticated;

/** The reservation of a client's document (0274, redefined): as before, and the document of their link to the holder of their bill (0294). */
create or replace function public.client_link_reserve_upload(
  target_token text,
  target_kind text,
  target_party uuid,
  target_name text,
  target_mime text,
  target_bytes bigint,
  target_need text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  rule jsonb := public.file_purpose_rule('client');
  problem text;
  reserved jsonb;
  document uuid;
  ceiling integer := coalesce((public.cases_setting('client_link_uploads') #>> '{}')::integer, 60);
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  if target_kind is null or target_kind not in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'income_proof',
                                             'residence_link', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  -- What a case of an area asks by name is sent for that need, one of the case's (0274).
  if target_need is not null and (
    target_kind <> 'other' or not exists (
      select 1 from jsonb_array_elements(
        coalesce(public.case_problem_documents(link.case_id) -> 'essential', '[]'::jsonb)
        || coalesce(public.case_problem_documents(link.case_id) -> 'dispensable', '[]'::jsonb)) n
      where n ->> 'need' = target_need)
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if target_party is not null and not exists (
    select 1 from public.client_link_people(link) lp where lp.party_id = target_party
  ) then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;
  if link.upload_count >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'upload_limit');
  end if;
  problem := public.file_reservation_problem(rule, target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;

  reserved := public.insert_file_reservation(link.org_id, 'client', target_name, target_mime, target_bytes, null);
  if not coalesce((reserved ->> 'ok')::boolean, false) then
    return reserved;
  end if;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, link_id, status, need)
  values (link.org_id, link.case_id, target_party, (reserved ->> 'file_id')::uuid, target_kind, 'client', link.id, 'uploading',
          target_need)
  returning id into document;

  update public.client_links set upload_count = upload_count + 1 where id = link.id;

  return jsonb_build_object(
    'ok', true, 'code', 'reserved', 'document_id', document,
    'file_id', reserved ->> 'file_id', 'storage_path', reserved ->> 'storage_path', 'org_id', link.org_id
  );
end;
$$;

revoke all on function public.client_link_reserve_upload(text, text, uuid, text, text, bigint, text) from public;
grant execute on function public.client_link_reserve_upload(text, text, uuid, text, text, bigint, text) to anon, authenticated;

/** 0071, redefined: the document of a client's link to the holder of their bill is checked as the bill is (0294). */
create or replace function public.case_document_processing_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.processing := case
    when new.source in ('client', 'firm', 'whatsapp', 'partner') and new.envelope_id is null
         and new.kind in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'residence_link',
                          'other')
      then 'pending'
    else 'skipped'
  end;
  new.processing_claimed_at := null;
  new.processing_attempts := 0;
  new.processing_error := null;
  return new;
end;
$$;

revoke all on function public.case_document_processing_default() from public, anon, authenticated;

update public.platform_settings
set value = jsonb_set(value, '{check_kinds}', (value -> 'check_kinds') || '["residence_link"]'::jsonb)
where key = 'document_checks' and jsonb_typeof(value -> 'check_kinds') = 'array' and not (value -> 'check_kinds') ? 'residence_link';

update public.platform_settings
set value = jsonb_set(value, '{package_kinds,person}', (value #> '{package_kinds,person}') || '["residence_link"]'::jsonb)
where key = 'case_advance' and jsonb_typeof(value #> '{package_kinds,person}') = 'array'
  and not (value #> '{package_kinds,person}') ? 'residence_link';

/** What a document is called in a notice, with its article (0038, redefined): and the document of the link (0294). */
create or replace function public.notice_document_words(kind text)
returns text
language sql
immutable
as $$
  select case kind
    when 'identity' then 'o documento de identidade'
    when 'address_proof' then 'o comprovante de endereço'
    when 'ticket' then 'o bilhete ou a reserva da passagem'
    when 'boarding_pass' then 'o cartão de embarque'
    when 'receipt' then 'o comprovante de gastos'
    when 'evidence' then 'a prova do problema'
    when 'residence_link' then 'o documento do vínculo com o titular da conta'
    else 'o documento'
  end;
$$;

-- The eighth instructions of the check: what shows the link, and the names written on it.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.documento.conferencia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia'),
  v.provider, v.model, v.effort,
  v.system_prompt || chr(10) || chr(10) ||
    $rule$Quando o documento dito é o que comprova o vínculo da pessoa com o titular de um comprovante de endereço, aceite uma certidão de casamento ou de união estável, uma certidão de nascimento, um contrato de aluguel ou uma declaração assinada do titular de que a pessoa mora com ele, desde que legível; recuse o que não for nenhum desses, dizendo por quê. Em nomes_no_documento, escreva o nome completo de cada pessoa que aparece no documento, como está escrito (em qualquer outro documento, uma lista vazia). Não decida se os nomes são os da pessoa e do titular: uma regra decide por eles.$rule$,
  jsonb_set(
    jsonb_set(v.output_schema, '{properties,nomes_no_documento}',
              '{"type": "array", "maxItems": 12, "items": {"type": "string", "maxLength": 160}}'::jsonb),
    '{required}', (v.output_schema -> 'required') || '["nomes_no_documento"]'::jsonb),
  v.max_tokens, false,
  'Confere o documento que comprova o vínculo com o titular de um comprovante de endereço e lê os nomes escritos nele: uma regra decide se são os da pessoa e do titular (0294).'
from public.prompt_versions v
where v.task = 'caso.documento.conferencia' and v.is_active
  and not (v.output_schema -> 'properties') ? 'nomes_no_documento';

update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.conferencia' and v.is_active
  and not (v.output_schema -> 'properties') ? 'nomes_no_documento'
  and exists (
    select 1 from public.prompt_versions n
    where n.task = v.task and n.version > v.version and (n.output_schema -> 'properties') ? 'nomes_no_documento'
  );
update public.prompt_versions as v set is_active = true
where v.task = 'caso.documento.conferencia'
  and v.version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.documento.conferencia')
  and (v.output_schema -> 'properties') ? 'nomes_no_documento';

-- ---------- 3. What a document of the link settles ----------

alter table public.residence_declarations add column link_document_id uuid references public.case_documents (id) on delete set null;
alter table public.residence_declarations drop constraint residence_declarations_status_check;
alter table public.residence_declarations add constraint residence_declarations_status_check
  check (status in ('open', 'waived', 'void', 'linked'));
alter table public.residence_declarations add constraint residence_declarations_linked_check
  check (status <> 'linked' or link_document_id is not null);
create index residence_declarations_link_idx on public.residence_declarations (link_document_id) where link_document_id is not null;

/**
 * Whether the names ONE read on a document of the link hold the person's and the holder's, each by the names' rule
 * of 0032 (`import_names_match`: the same first name, every word of the shorter name in the longer one). Pure.
 */
create or replace function public.residence_link_names_fit(target_names jsonb, target_person text, target_holder text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(target_names) = 'array'
    and exists (select 1 from jsonb_array_elements_text(target_names) n(name)
                where public.import_names_match(n.name, target_person))
    and exists (select 1 from jsonb_array_elements_text(target_names) n(name)
                where public.import_names_match(n.name, target_holder));
$$;

revoke all on function public.residence_link_names_fit(jsonb, text, text) from public, anon, authenticated;

/**
 * An open declaration settled by a document of the link (0294): it ends as `linked`, its paper still to sign
 * cancelled and kept from any court (`end_residence_declaration`), and the case's trail says so. False when it was
 * no longer open. Internal.
 */
create or replace function public.link_residence_declaration(target_declaration uuid, target_document uuid, target_actor_type text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owed public.residence_declarations%rowtype;
begin
  update public.residence_declarations set link_document_id = target_document
  where id = target_declaration and status = 'open'
  returning * into owed;
  if owed.id is null then
    return false;
  end if;
  perform public.end_residence_declaration(owed.id, 'linked', 'O vínculo com o titular da conta foi comprovado por um documento.',
    target_actor_type);
  perform public.record_case_event(owed.org_id, owed.case_id, 'residence_linked', target_actor_type,
    jsonb_build_object('person', owed.person_id, 'declaration', owed.id, 'document', target_document));
  return true;
end;
$$;

revoke all on function public.link_residence_declaration(uuid, uuid, text) from public, anon, authenticated;

/**
 * Each declaration a person owes in a case that an accepted document of their link settles ends as `linked` (0294):
 * one a person of the firm accepted, or one whose names ONE read are the person's and the declaration's holder's. Its
 * paper still to sign is cancelled and goes to no court (`end_residence_declaration`). Internal.
 */
create or replace function public.settle_residence_by_link(target_case uuid, target_person uuid, target_actor_type text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owed public.residence_declarations%rowtype;
  link uuid;
  settled integer := 0;
begin
  for owed in
    select d.* from public.residence_declarations d
    where d.case_id = target_case and d.person_id = target_person and d.status = 'open'
    for update
  loop
    select doc.id into link
    from public.case_documents doc
    join public.case_parties cp on cp.id = doc.party_id and cp.person_id = target_person
    join public.people p on p.id = target_person
    left join public.ai_runs r on r.id = doc.check_run_id
    where doc.case_id = target_case and doc.kind = 'residence_link' and doc.status = 'accepted'
      and (doc.decided_by is not null
           or public.residence_link_names_fit(r.output -> 'nomes_no_documento', p.full_name, owed.holder_name))
    order by doc.decided_at desc nulls last, doc.created_at desc
    limit 1;
    continue when link is null;
    if public.link_residence_declaration(owed.id, link, target_actor_type) then
      settled := settled + 1;
    end if;
  end loop;
  return settled;
end;
$$;

revoke all on function public.settle_residence_by_link(uuid, uuid, text) from public, anon, authenticated;

/**
 * What a decision on a document changes of a declaration (0294): a document of the link accepted settles what the
 * person owes; the same document refused after, the declaration it settled is owed again (unless another bill owes
 * one already); the bill refused, the declaration the link settled ends with it.
 */
create or replace function public.case_documents_residence_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := case when auth.uid() is null then 'system' else 'person' end;
  person uuid;
  settled public.residence_declarations%rowtype;
begin
  if new.kind = 'residence_link' and new.status = 'accepted' and new.party_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    select cp.person_id into person from public.case_parties cp where cp.id = new.party_id;
    if person is not null then
      perform public.settle_residence_by_link(new.case_id, person, actor);
    end if;
  elsif tg_op = 'UPDATE' and new.kind = 'residence_link' and old.status = 'accepted' and new.status <> 'accepted' then
    for settled in
      select d.* from public.residence_declarations d where d.link_document_id = new.id and d.status = 'linked' for update
    loop
      continue when exists (
        select 1 from public.residence_declarations o
        where o.case_id = settled.case_id and o.person_id = settled.person_id and o.status = 'open'
      );
      update public.residence_declarations
      set status = 'open', link_document_id = null, ended_at = null, ended_by = null, ended_reason = null
      where id = settled.id;
      perform public.record_case_event(settled.org_id, settled.case_id, 'residence_link_withdrawn', actor,
        jsonb_build_object('person', settled.person_id, 'declaration', settled.id, 'document', new.id));
    end loop;
  elsif tg_op = 'UPDATE' and new.kind = 'address_proof' and new.status = 'rejected' and old.status is distinct from 'rejected' then
    update public.residence_declarations
    set status = 'void', link_document_id = null, ended_reason = 'O comprovante de endereço foi recusado.', ended_at = now(),
        ended_by = auth.uid()
    where document_id = new.id and status = 'linked';
  end if;
  return new;
end;
$$;

revoke all on function public.case_documents_residence_link() from public, anon, authenticated;

create trigger case_documents_residence_link after insert or update of status on public.case_documents
  for each row when (new.kind in ('residence_link', 'address_proof'))
  execute function public.case_documents_residence_link();

/** ONE's check of a case's document (0237, redefined): as before, and the document of the link, by its names (0294). */
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
  owed public.residence_declarations%rowtype;
  link_person public.people%rowtype;
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

  -- What shows the link to the holder of a bill in somebody else's name (0294): ONE reads the names on it, and a rule
  -- decides whether they are the person's and the holder's of a declaration the person owes in the case.
  if decision = 'aceitar' and document.kind = 'residence_link' and document.party_id is not null then
    select p.* into link_person
    from public.case_parties cp join public.people p on p.id = cp.person_id
    where cp.id = document.party_id;
    select d.* into owed from public.residence_declarations d
    where d.case_id = document.case_id and d.person_id = link_person.id and d.status = 'open';
    if owed.id is not null
       and not public.residence_link_names_fit(target_output -> 'nomes_no_documento', link_person.full_name, owed.holder_name) then
      decision := 'recusar';
      reason := 'Este documento não traz juntos o nome de ' || coalesce(nullif(split_part(btrim(link_person.full_name), ' ', 1), ''), 'quem está no caso')
        || ' e o de ' || owed.holder_name || ', o titular da conta. Envie um que mostre o vínculo entre os dois, ou assine a declaração de residência.';
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
  -- A document of the link whose names fit the declaration owed settles it, by the names of this very answer (0294).
  if document.kind = 'residence_link' and owed.id is not null then
    perform public.link_residence_declaration(owed.id, document.id, target_actor_type);
  end if;
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
    -- A document of the link the case already accepted settles it at once (0294).
    perform public.settle_residence_by_link(document.case_id, owner, target_actor_type);
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

/**
 * What keeps a person's declaration from going with a filing (0124, redefined): the open one as before; a declaration
 * a document of the link settled, only a city of the bill other than the person's record (0294).
 */
create or replace function public.residence_declaration_blocker(target_case uuid, target_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
       when d.relation is null then 'residence_relation_missing'
       when p.city is not null and d.bill_city is not null
            and (public.plain_name(p.city) <> public.plain_name(d.bill_city)
                 or (p.uf is not null and d.bill_uf is not null and p.uf <> d.bill_uf))
         then 'residence_address_conflict'
       when not exists (
         select 1 from public.case_papers paper
         join public.signature_envelopes e on e.id = paper.envelope_id
         where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
           and paper.created_at >= d.created_at and e.status = 'signed'
       ) then 'residence_declaration_unsigned'
     end
     from public.residence_declarations d
     join public.people p on p.id = d.person_id
     where d.case_id = target_case and d.person_id = target_person and d.status = 'open'),
    -- A bill the link settled still says a city: one other than the person's record waits for a person, as before.
    (select 'residence_address_conflict'
     from public.residence_declarations d
     join public.people p on p.id = d.person_id
     where d.case_id = target_case and d.person_id = target_person and d.status = 'linked'
       and p.city is not null and d.bill_city is not null
       and (public.plain_name(p.city) <> public.plain_name(d.bill_city)
            or (p.uf is not null and d.bill_uf is not null and p.uf <> d.bill_uf))
     limit 1)
  );
$$;

revoke all on function public.residence_declaration_blocker(uuid, uuid) from public, anon, authenticated;

-- ---------- 4. Where it stands, on the link and on the case ----------

/**
 * What a link asks its person about a bill in somebody else's name (0123, redefined): each open declaration of
 * theirs, as before, with the latest document of the link they or the firm sent and where ONE's check of it stands;
 * and each one a document of the link settled, said done (0294).
 */
create or replace function public.client_link_residence(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'holder', d.holder_name, 'city', d.bill_city, 'relation', d.relation, 'note', d.relation_note,
        'answered_at', d.answered_at,
        'issued', exists (
          select 1 from public.case_papers paper
          where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
        ),
        'linked', d.status = 'linked',
        -- The person's party in the case, which a document of the link is sent for.
        'party_id', (select cp.id from public.case_parties cp where cp.case_id = d.case_id and cp.person_id = d.person_id
                     order by cp.created_at, cp.id limit 1),
        'link', (
          select jsonb_build_object('status', doc.status, 'reason', doc.rejected_reason)
          from public.case_documents doc
          join public.case_parties cp on cp.id = doc.party_id and cp.person_id = d.person_id
          where doc.case_id = d.case_id and doc.kind = 'residence_link' and doc.status in ('received', 'accepted', 'rejected')
          order by doc.created_at desc, doc.id desc
          limit 1
        )
      ) order by d.created_at, d.id)
      from public.residence_declarations d
      where d.case_id = link.case_id and d.person_id = link.person_id and d.status in ('open', 'linked')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.client_link_residence(text) from public;
grant execute on function public.client_link_residence(text) to anon, authenticated;

/**
 * A case's declarations of residence as its screen shows them (0123, redefined): as before, and each one a document
 * of the link settled, with that document; the latest document of the link of each open one too (0294).
 */
create or replace function public.case_residence(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'person_id', d.person_id, 'document_id', d.document_id, 'holder', d.holder_name,
    'holder_read', d.holder_read, 'relation', d.relation, 'note', d.relation_note,
    'answered_source', d.answered_source, 'answered_at', d.answered_at, 'bill_city', d.bill_city,
    'status', d.status, 'ended_reason', d.ended_reason, 'ended_at', d.ended_at,
    'blocker', case when d.status in ('open', 'linked') then public.residence_declaration_blocker(d.case_id, d.person_id) end,
    'envelope', (
      select e.status from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
    ),
    'link_document_id', d.link_document_id,
    'link', (
      select jsonb_build_object('id', doc.id, 'status', doc.status, 'reason', doc.rejected_reason)
      from public.case_documents doc
      join public.case_parties cp on cp.id = doc.party_id and cp.person_id = d.person_id
      where doc.case_id = d.case_id and doc.kind = 'residence_link' and doc.status in ('received', 'accepted', 'rejected')
      order by doc.created_at desc, doc.id desc
      limit 1
    )
  ) order by d.created_at, d.id), '[]'::jsonb)
  from public.residence_declarations d
  where d.case_id = target_case and d.status in ('open', 'waived', 'linked') and public.is_org_member(d.org_id);
$$;

revoke all on function public.case_residence(uuid) from public, anon;
grant execute on function public.case_residence(uuid) to authenticated;
