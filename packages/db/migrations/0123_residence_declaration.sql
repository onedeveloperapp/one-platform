-- ============================================================
-- 0123 · A declaração de residência
--
-- Phase 3 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its first cut: a case held today by a utility bill in a
-- relative's name goes on. Where the firm accepts a bill in somebody else's
-- name (`organizations.third_party_bill`, `accept` by default, as the plan
-- chose: the client's declaration, signed under the penalties of the law, is
-- presumed true, Lei 7.115/1983, art. 1º), ONE's check of a proof of address
-- reads whose bill it is (its fifth instructions no longer refuse a bill for
-- the name on it) and the database accepts it, writes its address as of a
-- bill of the person's own, and owes a residence declaration
-- (`residence_declarations`): the client says who the holder is to them, on
-- their link or through the firm, and ONE issues the declaration from the
-- firm's model of it, else the platform's, with the declarant's
-- responsibility written (art. 3º), and sends it to sign as it sends the
-- power of attorney. Where the firm refuses such bills, the check refuses it
-- with the way to send another.
--
-- The declaration goes with the filing package (a document of the kind
-- `residence_declaration`), and the filing waits for it
-- (`filing_blocker`): the client's answer, then their signature; an address
-- on record in another city than the bill's waits for a person, since it
-- decides the forum. A partner or a lawyer may go on without it, with the
-- second factor, after reading what that may cost. A declaration no longer
-- needed (the bill refused, or one in the person's own name accepted) ends,
-- with its envelope.
--
-- The papers ONE issues are a queue: a paper with something missing no
-- longer holds the others back (`advance_paper_to_issue` issues the first
-- paper it can). Who decides for the firm reads how many filing packages of
-- the month carry a bill in somebody else's name (`firm_third_party_bills`).
-- ============================================================

-- ---------- The firm's choice ----------

alter table public.organizations add column third_party_bill text not null default 'accept';
alter table public.organizations add constraint organizations_third_party_bill_check
  check (third_party_bill in ('accept', 'refuse'));
comment on column public.organizations.third_party_bill is
  'Whether the firm accepts a proof of address in somebody else''s name with the client''s residence declaration (0123).';

/**
 * Who decides for the firm says whether it accepts a bill in somebody else's name with the client's declaration
 * (`accept`) or asks every client for one in their own name (`refuse`). Never a support visit; on the record. Bills
 * decided before stay as they were. Answers `{ok}`, or `{ok: false, code}`: `support_visit`, `not_allowed`, `policy`.
 */
create or replace function public.set_third_party_bill(target_org uuid, target_policy text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  prior text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_policy is null or target_policy not in ('accept', 'refuse') then
    return jsonb_build_object('ok', false, 'code', 'policy');
  end if;
  select o.third_party_bill into prior from public.organizations o where o.id = target_org for update;
  if prior is distinct from target_policy then
    update public.organizations set third_party_bill = target_policy where id = target_org;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'firm.third_party_bill_set', 'firm', target_org::text,
            jsonb_build_object('before', prior, 'after', target_policy));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_third_party_bill(uuid, text) from public, anon;
grant execute on function public.set_third_party_bill(uuid, text) to authenticated;

-- ---------- What a declaration is ----------

alter table public.case_documents drop constraint case_documents_kind_check;
alter table public.case_documents add constraint case_documents_kind_check check (kind in (
  'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney',
  'residence_declaration', 'contract', 'petition', 'other'
));
alter table public.case_papers drop constraint case_papers_kind_check;
alter table public.case_papers add constraint case_papers_kind_check
  check (kind in ('procuracao', 'contrato', 'declaracao_residencia'));
alter table public.draft_templates drop constraint draft_templates_document_kind_check;
alter table public.draft_templates add constraint draft_templates_document_kind_check
  check (document_kind in ('piece', 'procuracao', 'contrato', 'declaracao_residencia'));

-- The declaration signed goes to the court with its signer's other papers.
update public.platform_settings
set value = jsonb_set(value, '{package_kinds,person}', (value #> '{package_kinds,person}') || '["residence_declaration"]'::jsonb)
where key = 'case_advance' and not (value #> '{package_kinds,person}') ? 'residence_declaration';

/**
 * A bill in somebody else's name a firm accepted for a person of a case, and the declaration it owes: whose bill it is
 * (as ONE read it, and as the client or the firm wrote it since), who the holder is to the person (`relation`, with
 * the person's own words for `outro`), who said it, the city of the bill (an address on record in another city waits
 * for a person: it decides the forum), and whether it still stands (`open`), a partner or a lawyer went on without
 * it (`waived`), or it is no longer needed (`void`). One open per person of a case.
 */
create table public.residence_declarations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  person_id uuid not null references public.people (id) on delete cascade,
  document_id uuid not null,
  holder_name text not null,
  holder_read text not null,
  relation text,
  relation_note text,
  answered_source text,
  answered_by uuid references public.profiles (id) on delete set null,
  answered_at timestamptz,
  answer_evidence jsonb,
  bill_city text,
  bill_uf text,
  status text not null default 'open',
  ended_reason text,
  ended_by uuid references public.profiles (id) on delete set null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (document_id, org_id) references public.case_documents (id, org_id) on delete cascade,
  constraint residence_declarations_holder_check check (
    char_length(btrim(holder_name)) between 2 and 120 and holder_name !~ '[[:cntrl:]]'
    and char_length(btrim(holder_read)) between 2 and 120
  ),
  constraint residence_declarations_relation_check check (relation is null or relation in (
    'mae', 'pai', 'conjuge', 'filho', 'irmao', 'avo', 'parente', 'proprietario', 'outro'
  )),
  constraint residence_declarations_note_check check (
    (relation is distinct from 'outro' or char_length(btrim(coalesce(relation_note, ''))) between 2 and 60)
    and (relation_note is null or (relation = 'outro' and relation_note !~ '[[:cntrl:]]'))
  ),
  constraint residence_declarations_answer_check check (
    (relation is null) = (answered_at is null) and (relation is null) = (answered_source is null)
    and (answered_source is null or answered_source in ('client', 'firm'))
  ),
  constraint residence_declarations_status_check check (status in ('open', 'waived', 'void')),
  constraint residence_declarations_end_check check (
    (status = 'open') = (ended_at is null)
    and (status <> 'waived' or char_length(btrim(coalesce(ended_reason, ''))) between 8 and 500)
  ),
  constraint residence_declarations_evidence_check check (
    answer_evidence is null or (jsonb_typeof(answer_evidence) = 'object' and octet_length(answer_evidence::text) <= 2000)
  )
);

create unique index residence_declarations_open_idx on public.residence_declarations (case_id, person_id)
  where status = 'open';
create index residence_declarations_document_idx on public.residence_declarations (document_id);

alter table public.residence_declarations enable row level security;
create policy "residence_declarations_select_member" on public.residence_declarations
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.residence_declarations from public, anon, authenticated;
grant select on table public.residence_declarations to authenticated;
create trigger residence_declarations_updated_at before update on public.residence_declarations
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_residence_declarations after insert or update or delete on public.residence_declarations
  for each statement execute function public.guard_impersonation_readonly();

/** Who the holder is to the person, as the declaration writes it: "minha mãe", or the person's own words. */
create or replace function public.residence_relation_words(target_relation text, target_note text)
returns text
language sql
immutable
set search_path = public
as $$
  select case target_relation
    when 'mae' then 'minha mãe'
    when 'pai' then 'meu pai'
    when 'conjuge' then 'meu cônjuge ou a pessoa com quem vivo em união estável'
    when 'filho' then 'um dos meus filhos'
    when 'irmao' then 'um dos meus irmãos'
    when 'avo' then 'um dos meus avós'
    when 'parente' then 'pessoa da minha família'
    when 'proprietario' then 'o proprietário do imóvel em que moro'
    when 'outro' then nullif(btrim(regexp_replace(coalesce(target_note, ''), '\s+', ' ', 'g')), '')
  end;
$$;

revoke all on function public.residence_relation_words(text, text) from public, anon, authenticated;

/**
 * What keeps a person's open declaration from going with a filing, or nothing: the client's word on who the holder
 * is (`residence_relation_missing`), an address on record in another city than the bill's, which decides the forum
 * and waits for a person (`residence_address_conflict`), or the declaration not signed yet
 * (`residence_declaration_unsigned`). Internal.
 */
create or replace function public.residence_declaration_blocker(target_case uuid, target_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d.relation is null then 'residence_relation_missing'
    when p.city is not null and d.bill_city is not null
         and (public.plain_name(p.city) <> public.plain_name(d.bill_city)
              or (p.uf is not null and d.bill_uf is not null and p.uf <> d.bill_uf))
      then 'residence_address_conflict'
    when not exists (
      select 1 from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
        and e.status = 'signed'
    ) then 'residence_declaration_unsigned'
  end
  from public.residence_declarations d
  join public.people p on p.id = d.person_id
  where d.case_id = target_case and d.person_id = target_person and d.status = 'open';
$$;

revoke all on function public.residence_declaration_blocker(uuid, uuid) from public, anon, authenticated;

/**
 * Ends a person's open declaration that is no longer needed (`void`) or that a partner or a lawyer went on without
 * (`waived`), and the envelope of its paper that is still open (a ZapSign envelope already sent owes its cancel at
 * ZapSign, as in 0023). Internal.
 */
create or replace function public.end_residence_declaration(
  target_declaration uuid,
  target_status text,
  target_reason text,
  target_actor_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  declaration public.residence_declarations%rowtype;
  envelope public.signature_envelopes%rowtype;
begin
  update public.residence_declarations
  set status = target_status, ended_reason = left(target_reason, 500), ended_by = auth.uid(), ended_at = now()
  where id = target_declaration and status = 'open'
  returning * into declaration;
  if declaration.id is null then
    return;
  end if;
  select e.* into envelope
  from public.case_papers paper
  join public.signature_envelopes e on e.id = paper.envelope_id
  where paper.case_id = declaration.case_id and paper.person_id = declaration.person_id
    and paper.kind = 'declaracao_residencia'
    and e.status in ('reserved', 'pending', 'received', 'uncertain')
  for update of e;
  if envelope.id is not null then
    update public.signature_envelopes
    set status = 'cancelled', ended_reason = left(target_reason, 500), decided_by = auth.uid(),
        provider_cancel_pending = (envelope.method = 'zapsign' and envelope.status = 'pending' and envelope.provider_id is not null)
    where id = envelope.id;
    perform public.record_case_event(declaration.org_id, declaration.case_id, 'signature_cancelled', target_actor_type,
      jsonb_build_object('envelope', envelope.id));
  end if;
  perform public.record_case_event(declaration.org_id, declaration.case_id,
    case target_status when 'waived' then 'residence_declaration_waived' else 'residence_declaration_ended' end,
    target_actor_type, jsonb_build_object('person', declaration.person_id, 'declaration', declaration.id));
end;
$$;

revoke all on function public.end_residence_declaration(uuid, text, text, text) from public, anon, authenticated;

-- A bill refused after it was accepted owes no declaration any longer.
create or replace function public.case_documents_end_residence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  declaration uuid;
begin
  for declaration in
    select d.id from public.residence_declarations d where d.document_id = new.id and d.status = 'open'
  loop
    perform public.end_residence_declaration(declaration, 'void', 'O comprovante de endereço foi recusado.',
      case when auth.uid() is null then 'system' else 'person' end);
  end loop;
  return new;
end;
$$;

revoke all on function public.case_documents_end_residence() from public, anon, authenticated;

create trigger case_documents_end_residence after update of status on public.case_documents
  for each row when (new.status = 'rejected' and old.status is distinct from 'rejected' and new.kind = 'address_proof')
  execute function public.case_documents_end_residence();

/** The types of a court's system for the kinds of a package (0036, redefined): as before, and the declaration. */
create or replace function public.filing_types_ok(types jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(types) = 'object'
    and coalesce((
      select bool_and(
        key in ('petition', 'power_of_attorney', 'identity', 'address_proof', 'residence_declaration', 'ticket',
                'boarding_pass', 'receipt', 'evidence', 'contract', 'other')
        and jsonb_typeof(value) = 'string'
        and char_length(value #>> '{}') between 2 and 80
        and value #>> '{}' = btrim(value #>> '{}')
      )
      from jsonb_each(types)
    ), true);
$$;

revoke all on function public.filing_types_ok(jsonb) from public, anon, authenticated;

-- ---------- ONE's check reads whose bill it is ----------

/**
 * Applies an answer of the check to its document (0063, redefined). As before, and a proof of address the check
 * accepted in somebody else's name (`confere_com_a_pessoa` "nao") is the firm's to take: where it accepts such bills
 * the document is accepted, its address written as of a bill of the person's own, and a residence declaration owed
 * with the holder's name as read; where it refuses them, or the name could not be read, the document is refused with
 * the way to send another. A bill in the person's own name ends a declaration they owed.
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

  if third then
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

-- The fifth instructions of the check: a bill in somebody else's name is not refused for the name on it.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.documento.conferencia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    '- decisao: "aceitar" quando o arquivo é do tipo dito, está legível e inteiro e, quando traz um nome, é da pessoa; "recusar" em qualquer outro caso.',
    '- decisao: "aceitar" quando o arquivo é do tipo dito, está legível e inteiro e, quando traz um nome, é da pessoa; "recusar" em qualquer outro caso. Um comprovante de endereço em nome de outra pessoa (um parente, o dono do imóvel) é a única exceção: não o recuse pelo nome. Aceite-o quando for do tipo dito, legível e inteiro, escreva em nome_no_documento o nome do titular como está na conta e responda "nao" em confere_com_a_pessoa: o escritório decide se aceita a conta de outra pessoa com uma declaração do cliente.'),
  v.output_schema, v.max_tokens, false,
  'Um comprovante de endereço em nome de outra pessoa não é recusado pelo nome: diz o titular, e o escritório decide.'
from public.prompt_versions v
where v.task = 'caso.documento.conferencia' and v.is_active
  and strpos(v.system_prompt, '"recusar" em qualquer outro caso.') > 0
  and strpos(v.system_prompt, 'Um comprovante de endereço em nome de outra pessoa') = 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.conferencia' and v.is_active
  and exists (
    select 1 from public.prompt_versions n
    where n.task = v.task and n.version > v.version and strpos(n.system_prompt, 'Um comprovante de endereço em nome de outra pessoa') > 0
  );
update public.prompt_versions as v set is_active = true
where v.task = 'caso.documento.conferencia'
  and v.version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.documento.conferencia')
  and strpos(v.system_prompt, 'Um comprovante de endereço em nome de outra pessoa') > 0;

-- ---------- Who the holder is ----------

/**
 * The firm says who the holder of a person's bill is to them, and the holder's name where ONE read it wrong, as the
 * client told it (anybody of the firm who works on the case; never a support visit); a declaration already issued
 * keeps what it says, and is changed only by ending it. On the record. Answers `{ok}`, or `{ok: false, code}`:
 * `not_found`, `issued`, `relation`, `note`, `holder`.
 */
create or replace function public.record_residence_relation(
  target_declaration uuid,
  target_relation text,
  target_note text,
  target_holder text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  declaration public.residence_declarations%rowtype;
  current_case public.cases%rowtype;
  holder text := regexp_replace(btrim(coalesce(target_holder, '')), '\s+', ' ', 'g');
  note text := nullif(regexp_replace(btrim(coalesce(target_note, '')), '\s+', ' ', 'g'), '');
begin
  select * into declaration from public.residence_declarations where id = target_declaration;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(declaration.case_id);
  select * into declaration from public.residence_declarations where id = target_declaration for update;
  if declaration.status <> 'open' then
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
  if holder = '' then
    holder := declaration.holder_name;
  end if;
  if char_length(holder) not between 2 and 120 or holder ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'holder');
  end if;
  update public.residence_declarations
  set relation = target_relation, relation_note = case when target_relation = 'outro' then note end,
      holder_name = holder, answered_source = 'firm', answered_by = auth.uid(), answered_at = now(), answer_evidence = null
  where id = declaration.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'residence_declaration.relation_recorded', 'case', current_case.id::text,
          jsonb_build_object('declaration', declaration.id, 'relation', target_relation,
                             'holder_changed', holder is distinct from declaration.holder_name));
  perform public.record_case_event(current_case.org_id, current_case.id, 'residence_relation_recorded',
    public.case_actor(current_case.id), jsonb_build_object('person', declaration.person_id, 'declaration', declaration.id));
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_residence_relation(uuid, text, text, text) from public, anon;
grant execute on function public.record_residence_relation(uuid, text, text, text) to authenticated;

/**
 * A partner or a lawyer goes on without a person's declaration, with the second factor and a reason the record keeps
 * (never a support visit): the filing no longer waits for it, and its envelope still open ends. Answers `{ok}`, or
 * `{ok: false, code}`: `not_found`, `not_allowed`, `second_factor`, `reason`.
 */
create or replace function public.waive_residence_declaration(target_declaration uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  declaration public.residence_declarations%rowtype;
  current_case public.cases%rowtype;
  reason text := btrim(regexp_replace(coalesce(target_reason, ''), '\s+', ' ', 'g'));
begin
  select * into declaration from public.residence_declarations where id = target_declaration;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(declaration.case_id);
  if declaration.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if char_length(reason) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason');
  end if;
  perform public.end_residence_declaration(declaration.id, 'waived', reason, 'person');
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'residence_declaration.waived', 'case', current_case.id::text,
          jsonb_build_object('declaration', declaration.id, 'person', declaration.person_id));
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.waive_residence_declaration(uuid, text) from public, anon;
grant execute on function public.waive_residence_declaration(uuid, text) to authenticated;

/**
 * What a link asks its person about a bill in somebody else's name: each open declaration of theirs, with the
 * holder's name, the city of the bill, what they answered so far and whether it was issued already.
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
        )
      ) order by d.created_at, d.id)
      from public.residence_declarations d
      where d.case_id = link.case_id and d.person_id = link.person_id and d.status = 'open'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.client_link_residence(text) from public;
grant execute on function public.client_link_residence(text) to anon, authenticated;

/**
 * The client says on their link who the holder of their bill is to them, and the holder's name where ONE read it
 * wrong; with what the server saw of the request. Until the declaration is issued, a new answer replaces the one
 * before. Called by the backend only. Answers `{ok}`, or `{ok: false, code}`: `link_not_open`, `not_found`,
 * `issued`, `relation`, `note`, `holder`.
 */
create or replace function public.client_link_answer_residence(
  target_token text,
  target_declaration uuid,
  target_relation text,
  target_note text,
  target_holder text,
  target_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  declaration public.residence_declarations%rowtype;
  holder text := regexp_replace(btrim(coalesce(target_holder, '')), '\s+', ' ', 'g');
  note text := nullif(regexp_replace(btrim(coalesce(target_note, '')), '\s+', ' ', 'g'), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select * into declaration from public.residence_declarations
  where id = target_declaration and case_id = link.case_id and person_id = link.person_id and status = 'open'
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
  if holder = '' then
    holder := declaration.holder_name;
  end if;
  if char_length(holder) not between 2 and 120 or holder ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'holder');
  end if;
  update public.residence_declarations
  set relation = target_relation, relation_note = case when target_relation = 'outro' then note end,
      holder_name = holder, answered_source = 'client', answered_by = null, answered_at = now(),
      answer_evidence = case
        when jsonb_typeof(target_evidence) = 'object' and octet_length(target_evidence::text) <= 2000 then target_evidence
      end
  where id = declaration.id;
  perform public.record_case_event(declaration.org_id, declaration.case_id, 'residence_relation_answered', 'client',
    jsonb_build_object('person', declaration.person_id, 'declaration', declaration.id));
  perform public.wake_case_advance(declaration.case_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.client_link_answer_residence(text, uuid, text, text, text, jsonb) from public, anon, authenticated;

/**
 * A case's declarations of residence as its screen shows them: each still open or gone without, with whose bill it is,
 * who the holder is to the person and who said it, the city of the bill, what keeps it from the filing
 * (`residence_declaration_blocker`) and where the signature of its paper stands. For anybody of the firm.
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
    'blocker', case when d.status = 'open' then public.residence_declaration_blocker(d.case_id, d.person_id) end,
    'envelope', (
      select e.status from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
    )
  ) order by d.created_at, d.id), '[]'::jsonb)
  from public.residence_declarations d
  where d.case_id = target_case and d.status in ('open', 'waived') and public.is_org_member(d.org_id);
$$;

revoke all on function public.case_residence(uuid) from public, anon;
grant execute on function public.case_residence(uuid) to authenticated;

-- ---------- The papers, a queue ----------

/**
 * The model ONE writes a paper of a firm from (0054, redefined): as before, and the platform's default declaration of
 * residence for a firm with no model of its own of it.
 */
create or replace function public.paper_template_for(target_org uuid, target_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.draft_templates t where t.org_id = target_org and t.document_kind = target_kind
    ) then coalesce(
      (select t.id from public.draft_templates t
       where t.org_id = target_org and t.document_kind = target_kind and t.is_default),
      (select (array_agg(t.id))[1] from public.draft_templates t
       where t.org_id = target_org and t.document_kind = target_kind
       having count(*) = 1)
    )
    when target_kind in ('procuracao', 'declaracao_residencia') then
      (select t.id from public.draft_templates t
       where t.org_id is null and t.document_kind = target_kind and t.is_default)
  end;
$$;

revoke all on function public.paper_template_for(uuid, text) from public, anon, authenticated;

-- The platform's declaration of residence, provisional until the curator reviews it.
insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, provisional)
values (null, 'Declaração de residência', null, 'declaracao_residencia', $body$DECLARAÇÃO DE RESIDÊNCIA

Eu, [[NOME]], com CPF nº [[CPF]], declaro, para fins de prova de residência, que moro no endereço [[ENDERECO]], CEP [[CEP]].

O comprovante de endereço que apresento está em nome de [[TITULAR]], que é [[RELACAO]].

Faço esta declaração sob as penas da lei, nos termos da Lei nº 7.115, de 29 de agosto de 1983, ciente de que a declaração comprovadamente falsa me sujeita às sanções civis, administrativas e criminais previstas na legislação aplicável (art. 3º).

[[LOCAL_DATA]]

[[NOME]]$body$, true, true);

/**
 * The papers a case owes now (0057, redefined): as before, the power of attorney first, then the declaration of
 * residence of a person whose bill in somebody else's name the firm accepted, once they said who the holder is and
 * no address on record in another city waits for a person, then the contract.
 */
create or replace function public.case_papers_due(target_case uuid)
returns table (person_id uuid, kind text, template_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.person_id, k.kind, public.paper_template_for(c.org_id, k.kind)
  from public.cases c
  join public.client_links l on l.case_id = c.id
  cross join (values ('procuracao', 1), ('declaracao_residencia', 2), ('contrato', 3)) as k (kind, position)
  where c.id = target_case
    and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    and (l.finished_at is not null or c.status in ('drafting', 'ready'))
    and l.revoked_at is null and l.expires_at > now()
    and public.firm_autonomy_mode(c.org_id, 'send_signature_papers') = 'auto'
    and public.paper_template_for(c.org_id, k.kind) is not null
    -- Somebody of the case, and an adult: who answers for a minor signs for them.
    and exists (select 1 from public.case_parties cp where cp.case_id = c.id and cp.person_id = l.person_id)
    and not exists (
      select 1 from public.people p
      where p.id = l.person_id and p.birth_date is not null
        and p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
    )
    and not exists (
      select 1 from public.case_papers paper
      where paper.case_id = c.id and paper.person_id = l.person_id and paper.kind = k.kind
    )
    -- A declaration only of a bill in somebody else's name the firm accepted, once the person said who the holder
    -- is and nothing about the address waits for a person.
    and (k.kind <> 'declaracao_residencia' or exists (
      select 1 from public.residence_declarations d
      where d.case_id = c.id and d.person_id = l.person_id and d.status = 'open'
        and public.residence_declaration_blocker(c.id, l.person_id) = 'residence_declaration_unsigned'
    ))
  group by l.person_id, k.kind, k.position, c.org_id
  order by l.person_id, k.position;
$$;

revoke all on function public.case_papers_due(uuid) from public, anon, authenticated;

/** The words a declaration of residence writes of a person's holder, before the rest of the paper is filled. */
create or replace function public.residence_marks_filled(target_case uuid, target_person uuid, target_body text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select replace(replace(coalesce(target_body, ''),
    '[[TITULAR]]', coalesce(d.holder_name, '[COMPLETAR: nome do titular do comprovante de endereço]')),
    '[[RELACAO]]', coalesce(public.residence_relation_words(d.relation, d.relation_note),
      '[COMPLETAR: quem é o titular do comprovante para a pessoa]'))
  from (select 1) as one
  left join public.residence_declarations d
    on d.case_id = target_case and d.person_id = target_person and d.status = 'open';
$$;

revoke all on function public.residence_marks_filled(uuid, uuid, text) from public, anon, authenticated;

/**
 * The next paper a case owes (0054, redefined): the papers are a queue. The first one that can be issued now is
 * answered, so a paper with something missing (`incomplete`) or a character the PDF cannot write (`unwritable`)
 * no longer holds the others back; only when none can be issued is the first of those said, for the case to say it.
 */
create or replace function public.advance_paper_to_issue(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  due record;
  template public.draft_templates%rowtype;
  person public.people%rowtype;
  filled text;
  missing text[];
  unwritable text[];
  held jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = target_case;
  for due in select * from public.case_papers_due(target_case) loop
    select * into template from public.draft_templates where id = due.template_id;
    select * into person from public.people where id = due.person_id;
    filled := template.body;
    if due.kind = 'declaracao_residencia' then
      filled := public.residence_marks_filled(target_case, due.person_id, filled);
    end if;
    filled := public.case_paper_filled(target_case, due.person_id, filled);
    select coalesce(array_agg(distinct m[1]), '{}') into missing
    from regexp_matches(filled, '\[COMPLETAR:\s*([^\]]+)\]', 'g') as m;
    if cardinality(missing) > 0 or filled ~ '\[\[[A-Z_]+\]\]' then
      held := coalesce(held, jsonb_build_object('ok', true, 'code', 'incomplete', 'person_id', due.person_id,
        'kind', due.kind, 'missing', to_jsonb(missing), 'unknown_mark', filled ~ '\[\[[A-Z_]+\]\]'));
      continue;
    end if;
    unwritable := public.unwritable_characters(filled);
    if cardinality(unwritable) > 0 then
      held := coalesce(held, jsonb_build_object('ok', true, 'code', 'unwritable', 'person_id', due.person_id,
        'kind', due.kind, 'characters', to_jsonb(unwritable)));
      continue;
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'due',
      'org_id', current_case.org_id,
      'person_id', due.person_id,
      'kind', due.kind,
      'template_id', due.template_id,
      'title', case due.kind
        when 'procuracao' then 'Procuração'
        when 'declaracao_residencia' then 'Declaração de residência'
        else 'Contrato de prestação de serviços advocatícios' end,
      'person', person.full_name,
      'firm', (select o.name from public.organizations o where o.id = current_case.org_id),
      'body', filled
    );
  end loop;
  return coalesce(held, jsonb_build_object('ok', true, 'code', 'none'));
end;
$$;

revoke all on function public.advance_paper_to_issue(uuid, integer) from public, anon, authenticated;

/**
 * ONE issues a paper and sends it to be signed (0054, redefined): as before, and a declaration of residence is a
 * document of its own kind (`residence_declaration`), which goes with its signer's filing.
 */
create or replace function public.advance_record_paper(
  target_case uuid,
  target_claim integer,
  target_person uuid,
  target_kind text,
  target_template uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  person public.people%rowtype;
  file public.files%rowtype;
  kept jsonb;
  document uuid;
  envelope uuid;
  account uuid;
  method text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  current_case := public.case_for_writer(target_case);
  if not public.case_advance_held(target_case, target_claim) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if not exists (
    select 1 from public.case_papers_due(target_case) d
    where d.person_id = target_person and d.kind = target_kind and d.template_id is not distinct from target_template
  ) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  if coalesce(payload ->> 'file_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(payload ->> 'bytes', '') !~ '^[0-9]{1,12}$'
     or coalesce(payload ->> 'pages', '1') !~ '^[0-9]{1,6}$' then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  select * into file from public.files f
  where f.id = (payload ->> 'file_id')::uuid and f.org_id = current_case.org_id and f.purpose = 'paper' for update;
  if not found then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  kept := public.confirm_file(file.id, payload ->> 'sha256', (payload ->> 'bytes')::bigint, 'application/pdf',
    coalesce((payload ->> 'pages')::integer, 1));
  if not coalesce((kept ->> 'ok')::boolean, false) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_refused');
  end if;
  select * into person from public.people where id = target_person;

  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at)
  values (current_case.org_id, current_case.id, file.id,
    case target_kind
      when 'procuracao' then 'power_of_attorney'
      when 'declaracao_residencia' then 'residence_declaration'
      else 'contract' end,
    'firm', 'accepted', now())
  returning id into document;

  -- How it is signed: by the firm's own ZapSign account where it connected one, else by gov.br on the link.
  select c.id into account from public.connections c
  where c.org_id = current_case.org_id and c.provider = 'zapsign' and c.status = 'connected'
  order by c.connected_at desc nulls last
  limit 1;
  method := case when account is null then 'govbr' else 'zapsign' end;
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id)
  values (current_case.org_id, current_case.id, document, method,
    case when method = 'zapsign' then 'reserved' else 'pending' end,
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'person_id', person.id, 'name', person.full_name, 'sign_url', null, 'signed_at', null)),
    account)
  returning id into envelope;

  insert into public.case_papers (org_id, case_id, person_id, kind, template_id, document_id, envelope_id)
  values (current_case.org_id, current_case.id, target_person, target_kind, target_template, document, envelope);

  perform public.record_case_event(current_case.org_id, current_case.id, 'paper_issued', 'system',
    jsonb_build_object('document', document, 'kind', target_kind, 'person', target_person));
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_requested', 'system',
    jsonb_build_object('envelope', envelope, 'method', method, 'document', document));
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'issued', 'document_id', document, 'envelope_id', envelope,
    'method', method);
end;
$$;

revoke all on function public.advance_record_paper(uuid, integer, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- ---------- The filing waits for it ----------

/**
 * What keeps a lawsuit from being filed (0066, redefined): as before, and then a declaration of residence a person
 * of the lawsuit (or who answers for one) owes: the client's word on the holder, an address on record in another
 * city than the bill's, or its signature.
 */
create or replace function public.filing_blocker(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.status = 'planned' and p.system is not null and p.system_refused_at is not null then 'system_refused'
    when p.status = 'planned' and p.system is not null and p.system_approved_at is null then 'system_unapproved'
    when p.kind = 'juizado' and c.family_choice = 'together' and public.case_has_minor_claimant(c.id)
      then 'family_split_unchosen'
    when p.kind = 'comum' and exists (
      select 1 from public.proceeding_parties pp
      where pp.proceeding_id = p.id
        and coalesce((public.civil_court_answer_in_force(pp.party_id)).accepted, false) is not true
    ) then 'civil_court_unanswered'
    -- A power of attorney ONE sent a person of the lawsuit to sign, and nobody of the firm has confirmed signed yet:
    -- a filing without it would go without the mandate (0054).
    when exists (
      select 1 from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = c.id and paper.kind = 'procuracao'
        and e.status in ('reserved', 'opening', 'pending', 'received', 'uncertain')
        and paper.person_id in (
          select cp.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          where pp.proceeding_id = p.id
          union
          select g.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          join public.case_parties g on g.id = cp.guardian_id
          where pp.proceeding_id = p.id
        )
    ) then 'power_of_attorney_unsigned'
    -- A bill in somebody else's name the firm accepted goes to the court with the client's declaration (0123).
    else (
      select b.code from (
        select public.residence_declaration_blocker(c.id, people.person_id) as code
        from (
          select cp.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          where pp.proceeding_id = p.id
          union
          select g.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          join public.case_parties g on g.id = cp.guardian_id
          where pp.proceeding_id = p.id
        ) as people
      ) as b
      where b.code is not null
      order by case b.code when 'residence_relation_missing' then 1 when 'residence_address_conflict' then 2 else 3 end
      limit 1
    )
  end
  from public.proceedings p
  join public.cases c on c.id = p.case_id
  where p.id = target_proceeding;
$$;

revoke all on function public.filing_blocker(uuid) from public, anon, authenticated;

/**
 * Who a wait of ONE is for (0111, redefined; `WAIT_PLACE` of lib/cases/advance.ts, kept together by a test): as
 * before, and the client's word on the holder of their bill and their signature of the declaration are the client's;
 * an address on record in another city is the firm's.
 */
create or replace function public.wait_owner(target_code text)
returns text
language sql
immutable
as $$
  select case
    when target_code in (
      'case_incomplete', 'civil_court_unanswered', 'power_of_attorney_unsigned', 'client_confirmation',
      'account_missing', 'account_incomplete', 'residence_relation_missing', 'residence_declaration_unsigned'
    ) then 'client'
    when target_code in ('account_preparing', 'account_contested', 'unavailable', 'step_failed') then 'one'
    when target_code in ('ceiling_unknown', 'system_unknown', 'system_refused') then 'platform'
    else 'firm'
  end;
$$;

revoke all on function public.wait_owner(text) from public, anon, authenticated;

-- ---------- What who decides reads ----------

/**
 * How many of the firm's filing packages built this month of Brasília carry a bill in somebody else's name (the
 * declaration of a person of the lawsuit, not ended), of how many: the signal the CNJ's Recomendação 159/2024 names,
 * for who decides for the firm to weigh. Only to them; null to anybody else.
 */
create or replace function public.firm_third_party_bills(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  month_from timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  built integer;
  third integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    return null;
  end if;
  select count(*)::integer,
         count(*) filter (where exists (
           select 1 from public.residence_declarations d
           where d.case_id = f.case_id and d.status <> 'void'
             and d.person_id in (
               select cp.person_id from public.proceeding_parties pp
               join public.case_parties cp on cp.id = pp.party_id
               where pp.proceeding_id = f.proceeding_id
               union
               select g.person_id from public.proceeding_parties pp
               join public.case_parties cp on cp.id = pp.party_id
               join public.case_parties g on g.id = cp.guardian_id
               where pp.proceeding_id = f.proceeding_id
             )
         ))::integer
  into built, third
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.built_at >= month_from;
  return jsonb_build_object('packages', built, 'third_party', third,
    'month', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'));
end;
$$;

revoke all on function public.firm_third_party_bills(uuid) from public, anon;
grant execute on function public.firm_third_party_bills(uuid) to authenticated;

-- ---------- A model of the declaration ----------

/**
 * A model of the firm written (0079, redefined): as before, and a firm writes its own declaration of residence,
 * which ONE then issues in place of the platform's.
 */
create or replace function public.draft_template_write(
  target_org uuid,
  target_actor uuid,
  target_template uuid,
  fields jsonb,
  target_by_one boolean default false,
  target_creator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  longest integer := least(greatest(public.drafts_setting('max_body_chars', 150000), 1000), 200000);
  most integer := greatest(public.drafts_setting('max_templates', 40), 1);
  name_value text := btrim(regexp_replace(coalesce(fields ->> 'name', ''), '[[:cntrl:]]', ' ', 'g'));
  kind_value text := nullif(btrim(coalesce(fields ->> 'proceeding_kind', '')), '');
  document_value text := coalesce(nullif(btrim(coalesce(fields ->> 'document_kind', '')), ''), 'piece');
  body_value text := coalesce(fields ->> 'body', '');
  default_value boolean := coalesce(fields -> 'is_default' = 'true'::jsonb, false);
  by_one boolean := coalesce(target_by_one, false);
  saved uuid;
begin
  if char_length(name_value) < 2 or char_length(name_value) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if kind_value is not null and kind_value not in ('juizado', 'comum') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'proceeding_kind');
  end if;
  if document_value not in ('piece', 'procuracao', 'contrato', 'declaracao_residencia') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document_kind');
  end if;
  -- A power of attorney, a contract or a declaration serves every lawsuit: it names no kind of lawsuit.
  if document_value <> 'piece' then
    kind_value := null;
  end if;
  if char_length(btrim(body_value)) < 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'body');
  end if;
  if char_length(body_value) > longest then
    return jsonb_build_object('ok', false, 'code', 'too_long', 'field', 'body');
  end if;
  if exists (
    select 1 from public.draft_templates t
    where t.org_id = target_org and lower(btrim(t.name)) = lower(name_value) and t.id is distinct from target_template
  ) then
    return jsonb_build_object('ok', false, 'code', 'name_in_use', 'field', 'name');
  end if;

  -- One default per kind: two saving defaults at once wait for each other (before either holds a model), and the
  -- second wins.
  if default_value then
    perform pg_advisory_xact_lock(hashtextextended('draft_template_default:' || target_org::text, 0));
  end if;
  -- The model itself is held then: one removed meanwhile is answered as gone before anything is written.
  if target_template is not null then
    -- `no key update`: a piece being asked from this model at the same moment (its key share) is not waited for.
    perform 1 from public.draft_templates t where t.id = target_template and t.org_id = target_org for no key update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  if target_template is null
     and (select count(*) from public.draft_templates t where t.org_id = target_org) >= most then
    return jsonb_build_object('ok', false, 'code', 'too_many_templates');
  end if;
  if default_value then
    -- The model that was the default of the kind stops being it, on the record.
    with cleared as (
      update public.draft_templates set is_default = false, updated_by = target_actor
      where org_id = target_org and is_default and document_kind = document_value
        and coalesce(proceeding_kind, '') = coalesce(kind_value, '')
        and id is distinct from target_template
      returning id, name
    )
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select target_org, target_actor, 'drafts.template_default_moved', 'draft_template', cleared.id::text,
      jsonb_build_object('name', cleared.name)
    from cleared;
  end if;

  if target_template is null then
    insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, created_by,
                                        updated_by, prepared_by_one)
    values (target_org, name_value, kind_value, document_value, body_value, default_value,
            coalesce(target_creator, target_actor), target_actor, by_one)
    returning id into saved;
  else
    update public.draft_templates
    set name = name_value, proceeding_kind = kind_value, document_kind = document_value, body = body_value,
        is_default = default_value, updated_by = target_actor, prepared_by_one = by_one
    where id = target_template and org_id = target_org
    returning id into saved;
    if saved is null then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_actor, 'drafts.template_saved', 'draft_template', saved::text,
    jsonb_strip_nulls(jsonb_build_object('name', name_value, 'default', case when default_value then true end,
      'by_one', case when by_one then true end)));
  return jsonb_build_object('ok', true, 'code', 'saved', 'template_id', saved);
end;
$$;

revoke all on function public.draft_template_write(uuid, uuid, uuid, jsonb, boolean, uuid) from public, anon, authenticated;

/**
 * The operator saves a model of the platform (0054, redefined): as before, and the platform's declaration of
 * residence.
 */
create or replace function public.admin_save_platform_template(target_template uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  name_value text := btrim(coalesce(fields ->> 'name', ''));
  kind_value text := nullif(btrim(coalesce(fields ->> 'proceeding_kind', '')), '');
  document_value text := coalesce(nullif(btrim(coalesce(fields ->> 'document_kind', '')), ''), 'piece');
  body_value text := coalesce(fields ->> 'body', '');
  default_value boolean := coalesce(fields -> 'is_default' = 'true'::jsonb, false);
  provisional_value boolean := coalesce(fields -> 'provisional' = 'true'::jsonb, false);
  saved uuid;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if kind_value is not null and kind_value not in ('juizado', 'comum') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'proceeding_kind');
  end if;
  -- The platform proposes pieces, a power of attorney and a declaration of residence; a fee contract is only ever
  -- a firm's own.
  if document_value not in ('piece', 'procuracao', 'declaracao_residencia') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document_kind');
  end if;
  if document_value <> 'piece' then
    kind_value := null;
  end if;
  -- Two operators never make two defaults of a kind at once.
  perform pg_advisory_xact_lock(hashtextextended('draft_template_default:platform', 0));
  -- A model that is not the platform's changes nothing, the default of its kind included.
  if target_template is not null
     and not exists (select 1 from public.draft_templates t where t.id = target_template and t.org_id is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  begin
    if default_value then
      update public.draft_templates t set is_default = false, updated_by = caller
      where t.org_id is null and t.is_default and t.document_kind = document_value
        and coalesce(t.proceeding_kind, '') = coalesce(kind_value, '')
        and t.id is distinct from target_template;
    end if;
    if target_template is not null then
      update public.draft_templates t
      set name = name_value, proceeding_kind = kind_value, document_kind = document_value, body = body_value,
          is_default = default_value, provisional = provisional_value, updated_by = caller
      where t.id = target_template and t.org_id is null
      returning t.id into saved;
      if saved is null then
        return jsonb_build_object('ok', false, 'code', 'not_found');
      end if;
    else
      insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, provisional,
        created_by, updated_by)
      values (null, name_value, kind_value, document_value, body_value, default_value, provisional_value, caller, caller)
      returning id into saved;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'name_in_use');
    when check_violation or not_null_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'platform.template_saved', 'draft_template', saved::text,
    jsonb_build_object('kind', kind_value, 'document_kind', document_value, 'is_default', default_value,
      'provisional', provisional_value));
  return jsonb_build_object('ok', true, 'code', 'saved', 'template_id', saved);
end;
$$;

revoke all on function public.admin_save_platform_template(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_platform_template(uuid, jsonb) to authenticated;
