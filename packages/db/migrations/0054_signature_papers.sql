-- 0054_signature_papers: the power of attorney and the fee contract, sent by ONE to the client to sign as soon
-- as the client said they finished (the test of 2026-10-26: after "Terminei" nothing happened, and the case would
-- have reached its filing package with no mandate in it).
--
-- A model of the library now says which document it writes (`draft_templates.document_kind`): the piece of a
-- lawsuit (as before), a power of attorney (`procuracao`) or a fee contract (`contrato`). The platform proposes a
-- power of attorney, provisional until the curator reviews it; a contract is only ever the firm's own model: the
-- fees are each firm's business, never ONE's (docs/PRODUCT.md), so ONE never writes or proposes one.
--
-- Where the firm lets it (`send_signature_papers`, ONE's by default), once an adult of a case said they finished
-- on their own link (`client_links.finished_at`, the link still open), ONE issues each paper the firm has a model
-- for, with that person's own facts written in (`case_paper_filled`: who grants it, each minor of the case they
-- answer for, the firm's signers with their registrations at the bar, the company, what happened and the place
-- and day), as a document of the case, and sends it to that person to sign: by the firm's own ZapSign account
-- where it connected one, else by gov.br on the link (the client downloads it, signs it at gov.br and sends it
-- back; a person of the firm confirms it, as in 0023). Never twice (`case_papers`, one per case, person and kind:
-- an envelope a person cancelled stays cancelled). A paper whose facts are not all on record is not issued and
-- the case says what is missing (`paper_incomplete`). A signed paper is now the signer's document of the case
-- (`case_documents_signed_party`, for every envelope), so it goes with the filing package of a lawsuit of theirs;
-- and a power of attorney ONE sent and nobody confirmed signed keeps the lawsuits of who grants it from being
-- filed (`filing_blocker`, `power_of_attorney_unsigned`).

-- ---------- What a model writes ----------

alter table public.draft_templates add column document_kind text not null default 'piece';
alter table public.draft_templates add constraint draft_templates_document_kind_check
  check (document_kind in ('piece', 'procuracao', 'contrato'));
-- A power of attorney or a contract serves every lawsuit: it names no kind of lawsuit.
alter table public.draft_templates add constraint draft_templates_paper_kind_check
  check (document_kind = 'piece' or proceeding_kind is null);
-- The fees are each firm's: the platform never writes a contract.
alter table public.draft_templates add constraint draft_templates_platform_contract_check
  check (org_id is not null or document_kind <> 'contrato');

comment on column public.draft_templates.document_kind is
  'What the model writes: the piece of a lawsuit, a power of attorney (procuracao) or a fee contract (contrato).';

-- One default per document and kind of lawsuit, for a firm and for the platform.
drop index public.draft_templates_default_idx;
create unique index draft_templates_default_idx on public.draft_templates
  (org_id, document_kind, coalesce(proceeding_kind, '')) where is_default;
drop index public.draft_templates_platform_default_idx;
create unique index draft_templates_platform_default_idx on public.draft_templates
  (document_kind, coalesce(proceeding_kind, '')) where org_id is null and is_default;

/**
 * A partner or a lawyer writes a model of the firm, or changes one (replaces
 * the one of 0029, adding what the model writes, `document_kind`: a piece,
 * a power of attorney or a contract; one of the two papers names no kind of
 * lawsuit). Never a support visit. A model said to be the default of its
 * document and kind is the one ONE writes from, and the one that was before
 * stops being it.
 */
create or replace function public.save_draft_template(target_org uuid, target_template uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  longest integer := least(greatest(public.drafts_setting('max_body_chars', 150000), 1000), 200000);
  most integer := greatest(public.drafts_setting('max_templates', 40), 1);
  name_value text := btrim(regexp_replace(coalesce(fields ->> 'name', ''), '[[:cntrl:]]', ' ', 'g'));
  kind_value text := nullif(btrim(coalesce(fields ->> 'proceeding_kind', '')), '');
  document_value text := coalesce(nullif(btrim(coalesce(fields ->> 'document_kind', '')), ''), 'piece');
  body_value text := coalesce(fields ->> 'body', '');
  default_value boolean := coalesce(fields -> 'is_default' = 'true'::jsonb, false);
  saved uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.has_firm_function(target_org, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if char_length(name_value) < 2 or char_length(name_value) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if kind_value is not null and kind_value not in ('juizado', 'comum') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'proceeding_kind');
  end if;
  if document_value not in ('piece', 'procuracao', 'contrato') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document_kind');
  end if;
  -- A power of attorney or a contract serves every lawsuit: it names no kind of lawsuit.
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

  -- One default per kind: two partners saving defaults at once wait for each other (before either holds a model),
  -- and the second wins.
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
      update public.draft_templates set is_default = false, updated_by = caller
      where org_id = target_org and is_default and document_kind = document_value
        and coalesce(proceeding_kind, '') = coalesce(kind_value, '')
        and id is distinct from target_template
      returning id, name
    )
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select target_org, caller, 'drafts.template_default_moved', 'draft_template', cleared.id::text,
      jsonb_build_object('name', cleared.name)
    from cleared;
  end if;

  if target_template is null then
    insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, created_by, updated_by)
    values (target_org, name_value, kind_value, document_value, body_value, default_value, caller, caller)
    returning id into saved;
  else
    update public.draft_templates
    set name = name_value, proceeding_kind = kind_value, document_kind = document_value, body = body_value,
        is_default = default_value, updated_by = caller
    where id = target_template and org_id = target_org
    returning id into saved;
    if saved is null then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'drafts.template_saved', 'draft_template', saved::text,
    jsonb_strip_nulls(jsonb_build_object('name', name_value, 'default', case when default_value then true end)));
  return jsonb_build_object('ok', true, 'code', 'saved', 'template_id', saved);
end;
$$;

revoke all on function public.save_draft_template(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_draft_template(uuid, uuid, jsonb) to authenticated;

/**
 * The operator saves a model of the platform (replaces the one of 0045,
 * adding what it writes: a piece or a power of attorney, never a contract).
 * On the record, with no firm.
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
  -- The platform proposes pieces and a power of attorney; a fee contract is only ever a firm's own.
  if document_value not in ('piece', 'procuracao') then
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

/**
 * The model ONE writes the piece of a lawsuit of a kind from (replaces the
 * one of 0045): as before, among the models that write a piece only.
 */
create or replace function public.draft_template_for(target_org uuid, target_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.draft_templates t
      where t.org_id = target_org and t.document_kind = 'piece'
        and (t.proceeding_kind = target_kind or t.proceeding_kind is null)
    ) then coalesce(
      (select t.id from public.draft_templates t
       where t.org_id = target_org and t.document_kind = 'piece' and t.is_default and t.proceeding_kind = target_kind),
      (select t.id from public.draft_templates t
       where t.org_id = target_org and t.document_kind = 'piece' and t.is_default and t.proceeding_kind is null),
      (select (array_agg(t.id))[1] from public.draft_templates t
       where t.org_id = target_org and t.document_kind = 'piece'
         and (t.proceeding_kind = target_kind or t.proceeding_kind is null)
       having count(*) = 1)
    )
    else coalesce(
      (select t.id from public.draft_templates t
       where t.org_id is null and t.document_kind = 'piece' and t.is_default and t.proceeding_kind = target_kind),
      (select t.id from public.draft_templates t
       where t.org_id is null and t.document_kind = 'piece' and t.is_default and t.proceeding_kind is null)
    )
  end;
$$;

revoke all on function public.draft_template_for(uuid, text) from public, anon, authenticated;

/** A piece is never written from a model of a power of attorney or a contract. */
create or replace function public.case_drafts_piece_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.template_id is not null and exists (
    select 1 from public.draft_templates t where t.id = new.template_id and t.document_kind <> 'piece'
  ) then
    raise exception 'not_a_piece_template' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.case_drafts_piece_template() from public, anon, authenticated;

create trigger case_drafts_piece_template before insert or update of template_id on public.case_drafts
  for each row execute function public.case_drafts_piece_template();

/**
 * The model ONE writes a paper of a firm from: its default of that document,
 * else its only model of it (nothing when it has more than one and no
 * default: a person chooses); for a firm with none, the platform's default
 * power of attorney. A contract is only ever the firm's own.
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
    when target_kind = 'procuracao' then
      (select t.id from public.draft_templates t
       where t.org_id is null and t.document_kind = 'procuracao' and t.is_default)
  end;
$$;

revoke all on function public.paper_template_for(uuid, text) from public, anon, authenticated;

-- The platform's power of attorney, provisional until the curator reviews it.
insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, provisional)
values (null, 'Procuração para ação de passageiro aéreo', null, 'procuracao', $body$PROCURAÇÃO

OUTORGANTE: [[OUTORGANTE]].

OUTORGADOS: [[OUTORGADOS]], do escritório [[ESCRITORIO]].

PODERES: pelo presente instrumento particular, a parte outorgante nomeia e constitui seus procuradores os advogados acima, a quem confere os poderes da cláusula ad judicia et extra para o foro em geral, em qualquer juízo, instância ou tribunal, para propor as ações competentes e defender seus interesses nas que lhe forem propostas, seguindo umas e outras até decisão final, usando os recursos legais e acompanhando-os, em especial para propor ação de indenização contra [[RE]] em razão de [[OBJETO]].

Confere ainda os poderes especiais para receber citação, confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar ao direito sobre o qual se funda a ação, receber valores e dar quitação, levantar alvarás, firmar compromisso e assinar declaração de hipossuficiência econômica (Código de Processo Civil, art. 105), podendo substabelecer, com ou sem reserva de iguais poderes, e agir em conjunto ou separadamente.

[[LOCAL_DATA]].

[[NOME]]$body$, true, true)
on conflict do nothing;

-- ---------- What the firm lets ONE do ----------

insert into public.autonomy_decisions (key, position, modes) values
  ('send_signature_papers', 6, array['auto', 'approval'])
on conflict (key) do nothing;

-- A paper ONE issues is kept under its own purpose, written by the backend only.
update public.platform_settings
set value = jsonb_set(value, '{purposes,paper}', jsonb_build_object(
  'people', false,
  'max_bytes', 31457280,
  'mimes', jsonb_build_array('application/pdf')
))
where key = 'files' and not (value -> 'purposes') ? 'paper';

-- ---------- The papers ONE sent ----------

/** Each paper ONE issued for a person of a case and sent them to sign: never a second of the same kind. */
create table public.case_papers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  person_id uuid not null,
  kind text not null,
  template_id uuid references public.draft_templates (id) on delete set null,
  -- The paper as ONE issued it, a document of the case, and the envelope it was sent in.
  document_id uuid not null,
  envelope_id uuid,
  created_at timestamptz not null default now(),
  unique (case_id, person_id, kind),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  foreign key (document_id, org_id) references public.case_documents (id, org_id) on delete cascade,
  foreign key (envelope_id, org_id) references public.signature_envelopes (id, org_id) on delete set null (envelope_id),
  constraint case_papers_kind_check check (kind in ('procuracao', 'contrato'))
);

create index case_papers_envelope_idx on public.case_papers (envelope_id) where envelope_id is not null;

alter table public.case_papers enable row level security;
create policy "case_papers_select_member" on public.case_papers
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_papers to authenticated;
create trigger guard_impersonation_case_papers after insert or update or delete on public.case_papers
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The text of a paper with the facts of a person of a case written in. A
 * model names them by a mark, never by their value:
 *
 *   [[OUTORGANTE]], [[CONTRATANTE]]  the person, qualified, and each minor of the case they answer for;
 *   [[OUTORGADOS]]                   the firm's signers, each with every registration at the bar;
 *   [[ESCRITORIO]]                   the firm, with its CNPJ when it has one on record;
 *   [[RE]]                           the company: the name it answers in court by and its CNPJ, or else the
 *                                    name it flies under;
 *   [[OBJETO]]                       what happened: the problem, the flight and its day;
 *   [[LOCAL_DATA]]                   the person's city and today, as a paper is dated;
 *   [[NOME]]                         the person's name, under the line they sign on.
 *
 * A fact that is not on record is written as "[COMPLETAR: ...]", which keeps
 * the paper from being issued.
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
    else '' end;

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

  filled := replace(filled, '[[OUTORGANTE]]', grantor);
  filled := replace(filled, '[[CONTRATANTE]]', grantor);
  filled := replace(filled, '[[OUTORGADOS]]', coalesce(lawyers, '[COMPLETAR: advogados que assinam pelo escritório]'));
  filled := replace(filled, '[[ESCRITORIO]]', office);
  filled := replace(filled, '[[RE]]', defendant);
  filled := replace(filled, '[[OBJETO]]', subject);
  filled := replace(filled, '[[LOCAL_DATA]]', place);
  filled := replace(filled, '[[NOME]]', person.full_name);
  return filled;
end;
$$;

revoke all on function public.case_paper_filled(uuid, uuid, text) from public, anon, authenticated;

/**
 * The papers a case owes now, where its firm lets ONE send them: for each
 * adult of the case whose own link of the case says they finished and is
 * still open (who signs on it), each document the firm has a model of
 * (`paper_template_for`), not issued for them before, while the case has not
 * reached the court. The power of attorney first.
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
  cross join (values ('procuracao', 1), ('contrato', 2)) as k (kind, position)
  where c.id = target_case
    and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    and l.finished_at is not null and l.revoked_at is null and l.expires_at > now()
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
  group by l.person_id, k.kind, k.position, c.org_id
  order by l.person_id, k.position;
$$;

revoke all on function public.case_papers_due(uuid) from public, anon, authenticated;

/** A case owes a paper ONE may issue now. */
create or replace function public.case_advance_papers_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.case_papers_due(target_case));
$$;

revoke all on function public.case_advance_papers_due(uuid) from public, anon, authenticated;

/**
 * Claims the cases ONE may carry on now (replaces the one of 0046, adding a
 * paper ONE may issue: `papers_due`). The rest as in 0046.
 */
create or replace function public.claim_case_advances(target_limit integer default 10, target_case uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  wait integer := greatest(public.case_advance_setting('wait_minutes', 360), 1);
  scan integer := least(greatest(public.case_advance_setting('scan', 200), 1), 2000);
  wanted integer := greatest(least(coalesce(target_limit, 10), 50), 1);
  claimed jsonb := '[]'::jsonb;
  parked integer := 0;
  candidate uuid;
  link boolean;
  lawsuits boolean;
  package boolean;
  papers boolean;
  claims_now integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for candidate in
    select a.case_id from public.case_advances a
    where (target_case is null or a.case_id = target_case)
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    order by coalesce(a.after, a.created_at), a.case_id
    limit case when target_case is null then scan else 1 end
  loop
    -- Locked one at a time, and read again under the lock: another worker may have taken it meanwhile.
    perform 1 from public.case_advances a
    where a.case_id = candidate
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    for update skip locked;
    if not found then
      continue;
    end if;
    link := public.case_advance_link_due(candidate);
    lawsuits := public.case_advance_lawsuits_due(candidate);
    package := public.case_advance_package_due(candidate);
    papers := public.case_advance_papers_due(candidate);
    if link or lawsuits or package or papers or public.case_advance_steps_due(candidate) then
      update public.case_advances a set claimed_at = clock_timestamp(), claims = a.claims + 1
      where a.case_id = candidate
      returning a.claims into claims_now;
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'case_id', candidate, 'claim', claims_now, 'link_due', link, 'lawsuits_due', lawsuits, 'package_due', package,
        'papers_due', papers));
      exit when jsonb_array_length(claimed) >= wanted;
    else
      -- A case set aside for good (it ended, or is with the court) stays so.
      update public.case_advances a
      set after = greatest(coalesce(a.after, '-infinity'::timestamptz), now() + make_interval(mins => wait)),
          waiting = null, checked_at = now(), claimed_at = null, attempts = 0
      where a.case_id = candidate;
      parked := parked + 1;
    end if;
  end loop;
  return jsonb_build_object('claimed', claimed, 'parked', parked);
end;
$$;

revoke all on function public.claim_case_advances(integer, uuid) from public, anon, authenticated;

/**
 * The next paper a case owes, for the worker that holds its claim: who it is
 * for, the document, the model, and its text with that person's facts
 * written in (`case_paper_filled`), to be made a PDF of the firm's own; or
 * why it cannot be issued (`incomplete`, with what is missing; `unwritable`,
 * a character the PDF cannot write), which the case says. Nothing when none
 * is owed. Service role only.
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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = target_case;
  select * into due from public.case_papers_due(target_case) limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'none');
  end if;
  select * into template from public.draft_templates where id = due.template_id;
  select * into person from public.people where id = due.person_id;
  filled := public.case_paper_filled(target_case, due.person_id, template.body);
  select coalesce(array_agg(distinct m[1]), '{}') into missing
  from regexp_matches(filled, '\[COMPLETAR:\s*([^\]]+)\]', 'g') as m;
  if cardinality(missing) > 0 or filled ~ '\[\[[A-Z_]+\]\]' then
    return jsonb_build_object('ok', true, 'code', 'incomplete', 'person_id', due.person_id, 'kind', due.kind,
      'missing', to_jsonb(missing), 'unknown_mark', filled ~ '\[\[[A-Z_]+\]\]');
  end if;
  unwritable := public.unwritable_characters(filled);
  if cardinality(unwritable) > 0 then
    return jsonb_build_object('ok', true, 'code', 'unwritable', 'person_id', due.person_id, 'kind', due.kind,
      'characters', to_jsonb(unwritable));
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', 'due',
    'org_id', current_case.org_id,
    'person_id', due.person_id,
    'kind', due.kind,
    'template_id', due.template_id,
    'title', case due.kind when 'procuracao' then 'Procuração' else 'Contrato de prestação de serviços advocatícios' end,
    'person', person.full_name,
    'firm', (select o.name from public.organizations o where o.id = current_case.org_id),
    'body', filled
  );
end;
$$;

revoke all on function public.advance_paper_to_issue(uuid, integer) from public, anon, authenticated;

/**
 * ONE issues a paper and sends it to be signed, in one step under the case's
 * own lock: the PDF the worker made and kept under the purpose `paper`
 * becomes an accepted document of the case of its kind (nobody's own until
 * it is signed: a paper not signed never goes with a filing package), and an
 * envelope sends it to the person to sign: by the firm's own ZapSign account
 * where it connected one (opened by the backend, as in 0023), else by gov.br
 * on their link. Said in the timeline as ONE's. Refused when the paper is no
 * longer owed (`not_due`). For the worker that holds the claim; service role
 * only.
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
    case target_kind when 'procuracao' then 'power_of_attorney' else 'contract' end, 'firm', 'accepted', now())
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

-- ---------- A signed paper is its signer's ----------

/**
 * A signed file accepted for an envelope with one signer is that signer's
 * document of the case (their party, a claimant before a guardian): the
 * signed power of attorney goes with the filing package of a lawsuit of
 * theirs (0039), as the identity and the proof of address do. The original
 * stays nobody's.
 */
create or replace function public.case_documents_signed_party()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signer uuid;
begin
  if new.party_id is null and new.status = 'accepted' and new.envelope_id is not null then
    select (e.signers -> 0 ->> 'person_id')::uuid into signer
    from public.signature_envelopes e
    where e.id = new.envelope_id and e.document_id <> new.id and jsonb_array_length(e.signers) = 1;
    if signer is not null then
      new.party_id := (
        select cp.id from public.case_parties cp
        where cp.case_id = new.case_id and cp.person_id = signer
        order by (cp.role = 'claimant') desc, cp.created_at, cp.id
        limit 1
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.case_documents_signed_party() from public, anon, authenticated;

create trigger case_documents_signed_party before insert or update of status, envelope_id on public.case_documents
  for each row execute function public.case_documents_signed_party();

-- ---------- What keeps a lawsuit from being filed ----------

/**
 * Why a lawsuit's filing may not go on now, or null (replaces the one of
 * 0025, adding a power of attorney ONE sent a person of the lawsuit to sign,
 * or who answers for one, that nobody confirmed signed yet:
 * `power_of_attorney_unsigned`). The rest as in 0025.
 */
create or replace function public.filing_blocker(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
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
  end
  from public.proceedings p
  join public.cases c on c.id = p.case_id
  where p.id = target_proceeding;
$$;

revoke all on function public.filing_blocker(uuid) from public, anon, authenticated;

-- ---------- What wakes a case owed a paper ----------

/** A client said they finished on their link: the case may now owe the papers they sign. */
create or replace function public.client_links_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.finished_at is not null and old.finished_at is distinct from new.finished_at then
    perform public.wake_case_advance(new.case_id);
  end if;
  return null;
end;
$$;

revoke all on function public.client_links_wake_advance() from public, anon, authenticated;

create trigger client_links_wake_advance after update of finished_at on public.client_links
  for each row execute function public.client_links_wake_advance();

/** A model of a paper of a firm, added or changed: its cases whose clients finished may now owe that paper. */
create or replace function public.draft_templates_wake_papers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is null or new.document_kind = 'piece' then
    return null;
  end if;
  update public.case_advances a
  set after = null, woken_at = clock_timestamp()
  where a.case_id in (
    select b.case_id from public.case_advances b
    join public.cases k on k.id = b.case_id
    where b.org_id = new.org_id and b.after is distinct from 'infinity'::timestamptz
      and k.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
      and exists (select 1 from public.client_links l where l.case_id = k.id and l.finished_at is not null)
    order by b.case_id
    for update
  );
  return null;
end;
$$;

revoke all on function public.draft_templates_wake_papers() from public, anon, authenticated;

create trigger draft_templates_wake_papers after insert or update of body, document_kind, is_default on public.draft_templates
  for each row execute function public.draft_templates_wake_papers();
