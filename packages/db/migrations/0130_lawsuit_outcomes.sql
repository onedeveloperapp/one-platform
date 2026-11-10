-- ============================================================
-- 0130 · O resultado de cada ação
--
-- Phase 6 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its first cut. The firm no longer reads each decision to
-- know how a lawsuit ended: ONE reads, by a rule of code (`resultado-v1`,
-- `@flyee/rules/outcome`), each new movement of the court (the judgment's
-- result, the judgment become final, an appeal and by whom, a judicial
-- deposit, a release of money, a settlement approved, the definitive
-- archiving; a provisional archiving or a suspension never ends anything)
-- and the words of a judgment and of a release the firm's triage says are
-- one (the result, the value beside the condemnation and whether each
-- claimant's, the value of the release), and records each as a fact of the
-- lawsuit (`lawsuit_facts`), marked as ONE's, with the court's words beside
-- it. Where the firm keeps the result to a person (`record_outcome`), a fact
-- waits for a person's confirmation and counts for nothing until then. The
-- lawyers say they are aware of what changes the course (the judgment
-- become final, the archiving, a judgment against the client); a person
-- records a fact by hand, corrects one (never deleted), and registers what
-- a release paid when it arrives. When every lawsuit of a case was archived
-- definitively and every release was received, ONE closes the case
-- (`close_case`), said as ONE's and reopened in a click. The test court
-- judges in part, denies, approves a settlement, takes the defendant's
-- appeal and releases a value. The case's timeline never carries a value.
-- ============================================================

-- ---------- What was read already is history ----------
alter table public.movements add column outcome_read_at timestamptz;
update public.movements set outcome_read_at = now() where outcome_read_at is null;
create index movements_outcome_due_idx on public.movements (learned_at) where outcome_read_at is null;

alter table public.publications add column outcome_read_at timestamptz;
update public.publications set outcome_read_at = now() where outcome_read_at is null;
create index publications_outcome_due_idx on public.publications (captured_at) where outcome_read_at is null;

-- ---------- The facts of a lawsuit ----------
create table public.lawsuit_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  kind text not null,
  -- A judgment's result; who appealed; how money was released.
  result text,
  appeal_by text,
  release_kind text,
  -- A value the court's words set (the condemnation, the settlement, the release), and whether each claimant's.
  cents bigint,
  per_claimant boolean not null default false,
  happened_on date not null,
  -- The court's words the fact was read from, at most 600 characters.
  words text,
  movement_id uuid references public.movements (id) on delete set null,
  publication_id uuid references public.publications (id) on delete set null,
  source text not null,
  rule text,
  by_one boolean not null default false,
  -- A fact ONE read where the firm keeps the result to a person waits for a person's word.
  confirmed boolean not null default true,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- The lawyers say they are aware of what changes the course.
  ack_owed boolean not null default false,
  acked_by uuid references public.profiles (id) on delete set null,
  acked_at timestamptz,
  -- What a release paid, when it arrived.
  received_cents bigint,
  received_on date,
  received_by uuid references public.profiles (id) on delete set null,
  corrected_at timestamptz,
  corrected_by uuid references public.profiles (id) on delete set null,
  corrected_reason text,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  constraint lawsuit_facts_kind_check check (kind in (
    'sentenca', 'acordo', 'transito', 'recurso', 'deposito', 'alvara', 'arquivamento'
  )),
  constraint lawsuit_facts_result_check check (
    (kind = 'sentenca') = (result is not null) and (result is null or result in ('procedente', 'parcial', 'improcedente'))
  ),
  constraint lawsuit_facts_appeal_check check (appeal_by is null or (kind = 'recurso' and appeal_by in ('autor', 're'))),
  constraint lawsuit_facts_release_check check (
    release_kind is null or (kind = 'alvara' and release_kind in ('alvara', 'transferencia', 'rpv', 'precatorio'))
  ),
  constraint lawsuit_facts_cents_check check ((cents is null or cents > 0) and (received_cents is null or received_cents >= 0)),
  constraint lawsuit_facts_words_check check (words is null or char_length(words) <= 600),
  constraint lawsuit_facts_source_check check (source in ('rule', 'person')),
  constraint lawsuit_facts_corrected_check check (
    (corrected_at is null) = (corrected_reason is null)
    and (corrected_reason is null or char_length(corrected_reason) between 3 and 300)
  )
);

create unique index lawsuit_facts_movement_idx on public.lawsuit_facts (movement_id)
  where movement_id is not null and corrected_at is null;
create index lawsuit_facts_case_idx on public.lawsuit_facts (case_id, happened_on);
create index lawsuit_facts_proceeding_idx on public.lawsuit_facts (proceeding_id, kind) where corrected_at is null;

alter table public.lawsuit_facts enable row level security;
create policy "lawsuit_facts_select_member" on public.lawsuit_facts
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.lawsuit_facts to authenticated;
create trigger guard_impersonation_lawsuit_facts after insert or update or delete on public.lawsuit_facts
  for each statement execute function public.guard_impersonation_readonly();

-- A case ONE closed says so until a lawyer says they are aware of it.
alter table public.cases add column closed_by_one boolean not null default false;
alter table public.cases add column close_acked_by uuid references public.profiles (id) on delete set null;
alter table public.cases add column close_acked_at timestamptz;

insert into public.autonomy_decisions (key, task, position, modes) values
  ('record_outcome', null, 130, array['auto', 'approval']),
  ('close_case', null, 140, array['auto', 'approval'])
on conflict (key) do nothing;

insert into public.one_work_kinds (key, family, position, minutes, decision) values
  ('resultado_lido', 'tribunal', 700, 3, 'record_outcome'),
  ('caso_encerrado', 'acoes', 400, 5, 'close_case')
on conflict (key) do nothing;

-- ---------- Recording a fact ----------
/**
 * Records a fact of a lawsuit (internal): from ONE's reading, marked as ONE's and waiting for a person's confirmation
 * where the firm keeps the result to a person; or from a person. A judgment, a settlement, its becoming final and the
 * archiving are one in force per lawsuit: a second reading of one completes the first (its words, its value) and
 * records nothing new. The lawyers are asked to be aware of what changes the course. The timeline says the kind only.
 */
create or replace function public.lawsuit_fact_write(
  target_proceeding uuid,
  target_fact jsonb,
  target_movement uuid,
  target_publication uuid,
  target_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  kind_value text := target_fact ->> 'kind';
  result_value text := nullif(target_fact ->> 'result', '');
  cents_value bigint;
  day_value date;
  words_value text := nullif(left(btrim(regexp_replace(coalesce(target_fact ->> 'words', ''), '\s+', ' ', 'g')), 600), '');
  existing public.lawsuit_facts%rowtype;
  by_one boolean := target_by is null;
  mode text;
  saved uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return null;
  end if;
  if coalesce(target_fact ->> 'cents', '') ~ '^[0-9]{1,13}$' and (target_fact ->> 'cents')::bigint > 0 then
    cents_value := (target_fact ->> 'cents')::bigint;
  end if;
  begin
    day_value := coalesce(nullif(target_fact ->> 'happened_on', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  exception when others then
    day_value := (now() at time zone 'America/Sao_Paulo')::date;
  end;
  if kind_value in ('sentenca', 'acordo', 'transito', 'arquivamento') then
    select * into existing from public.lawsuit_facts f
    where f.proceeding_id = lawsuit.id and f.kind = kind_value and f.corrected_at is null
    order by f.created_at limit 1
    for update;
    if found then
      update public.lawsuit_facts
      -- The words of a publication (the judgment itself) take the place of a movement's title.
      set words = case when target_publication is not null then coalesce(words_value, existing.words)
                       else coalesce(existing.words, words_value) end,
          cents = coalesce(existing.cents, cents_value),
          per_claimant = existing.per_claimant or coalesce((target_fact ->> 'per_claimant')::boolean, false),
          publication_id = coalesce(existing.publication_id, target_publication)
      where id = existing.id;
      return existing.id;
    end if;
  end if;
  mode := public.firm_autonomy_mode(lawsuit.org_id, 'record_outcome');
  insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, appeal_by, release_kind, cents,
    per_claimant, happened_on, words, movement_id, publication_id, source, rule, by_one, confirmed, confirmed_by,
    confirmed_at, created_by, ack_owed)
  values (lawsuit.org_id, lawsuit.case_id, lawsuit.id, kind_value,
    case when kind_value = 'sentenca' then result_value end,
    case when kind_value = 'recurso' then nullif(target_fact ->> 'appeal_by', '') end,
    case when kind_value = 'alvara' then coalesce(nullif(target_fact ->> 'release_kind', ''), 'alvara') end,
    cents_value, coalesce((target_fact ->> 'per_claimant')::boolean, false), day_value, words_value,
    target_movement, target_publication,
    case when by_one then 'rule' else 'person' end,
    case when by_one then 'resultado-v1' end,
    by_one,
    not by_one or mode <> 'approval',
    case when not by_one then target_by end,
    case when not by_one then now() end,
    target_by,
    kind_value in ('transito', 'arquivamento') or (kind_value = 'sentenca' and result_value = 'improcedente'))
  returning id into saved;
  perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'outcome_recorded',
    case when by_one then 'system' else 'person' end,
    jsonb_build_object('proceeding', lawsuit.id, 'fact', saved, 'kind', kind_value));
  return saved;
end;
$$;

revoke all on function public.lawsuit_fact_write(uuid, jsonb, uuid, uuid, uuid) from public, anon, authenticated;

/**
 * What ONE's rule read of a court's movement (the backend's): the movement is read once, and a fact it says is the
 * lawsuit's, as ONE's. A movement that says nothing is marked read all the same.
 */
create or replace function public.record_movement_outcome(target_movement uuid, target_reading jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  movement public.movements%rowtype;
  fact uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.movements set outcome_read_at = now() where id = target_movement and outcome_read_at is null
  returning * into movement;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'read_before');
  end if;
  if target_reading is null or jsonb_typeof(target_reading) <> 'object' or coalesce(target_reading ->> 'kind', '') = '' then
    return jsonb_build_object('ok', true, 'code', 'nothing');
  end if;
  if not exists (select 1 from public.cases c where c.id = movement.case_id and c.status not in ('closed', 'declined')) then
    return jsonb_build_object('ok', true, 'code', 'case_ended');
  end if;
  fact := public.lawsuit_fact_write(movement.proceeding_id,
    target_reading || jsonb_build_object('happened_on', (movement.occurred_at at time zone 'America/Sao_Paulo')::date,
      'words', left(concat_ws('. ', movement.title, movement.detail), 600)),
    movement.id, null, null);
  return jsonb_build_object('ok', true, 'code', 'recorded', 'fact', fact);
end;
$$;

revoke all on function public.record_movement_outcome(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_movement_outcome(uuid, jsonb) to service_role;

/**
 * What ONE's rule read of a publication the firm's triage says is the judgment, or a payment (the backend's): the
 * judgment's result and value, a settlement approved, a release's value. Read once.
 */
create or replace function public.record_publication_outcome(target_publication uuid, target_reading jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  release_fact public.lawsuit_facts%rowtype;
  fact uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.publications set outcome_read_at = now() where id = target_publication and outcome_read_at is null
  returning * into publication;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'read_before');
  end if;
  if publication.proceeding_id is null or target_reading is null or jsonb_typeof(target_reading) <> 'object'
     or coalesce(target_reading ->> 'kind', '') = '' then
    return jsonb_build_object('ok', true, 'code', 'nothing');
  end if;
  if not exists (select 1 from public.cases c where c.id = publication.case_id and c.status not in ('closed', 'declined')) then
    return jsonb_build_object('ok', true, 'code', 'case_ended');
  end if;
  -- A release's value completes the release the movements said, the latest one with no value; else it is its own.
  if target_reading ->> 'kind' = 'alvara' then
    select * into release_fact from public.lawsuit_facts f
    where f.proceeding_id = publication.proceeding_id and f.kind = 'alvara' and f.corrected_at is null and f.cents is null
    order by f.happened_on desc, f.created_at desc limit 1
    for update;
    if found then
      update public.lawsuit_facts
      set cents = (target_reading ->> 'cents')::bigint, words = coalesce(words, left(target_reading ->> 'words', 600)),
          publication_id = publication.id
      where id = release_fact.id;
      return jsonb_build_object('ok', true, 'code', 'completed', 'fact', release_fact.id);
    end if;
  end if;
  fact := public.lawsuit_fact_write(publication.proceeding_id,
    target_reading || jsonb_build_object('happened_on', publication.available_on), null, publication.id, null);
  return jsonb_build_object('ok', true, 'code', 'recorded', 'fact', fact);
end;
$$;

revoke all on function public.record_publication_outcome(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_publication_outcome(uuid, jsonb) to service_role;

-- ---------- What a person does ----------
/** Why a person of the firm may not write a lawsuit's facts, or null: a partner, a lawyer or the controladoria. */
create or replace function public.lawsuit_fact_refusal(target_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return 'support_visit';
  end if;
  if not public.has_firm_function(target_org, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return 'not_allowed';
  end if;
  return null;
end;
$$;

revoke all on function public.lawsuit_fact_refusal(uuid) from public, anon, authenticated;

/** A person records a fact of a lawsuit the court has, by hand: its kind, its day, its result or value. */
create or replace function public.save_lawsuit_fact(target_proceeding uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  refusal text;
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  fact uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  refusal := public.lawsuit_fact_refusal(lawsuit.org_id);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if lawsuit.status <> 'filed' then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  if kind_value is null or kind_value not in ('sentenca', 'acordo', 'transito', 'recurso', 'deposito', 'alvara', 'arquivamento')
     or (kind_value = 'sentenca' and coalesce(fields ->> 'result', '') not in ('procedente', 'parcial', 'improcedente'))
     or (kind_value = 'recurso' and coalesce(fields ->> 'appeal_by', '') not in ('autor', 're')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if coalesce(fields ->> 'happened_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or (fields ->> 'happened_on')::date > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'happened_on');
  end if;
  if coalesce(fields ->> 'cents', '') <> '' and coalesce(fields ->> 'cents', '') !~ '^[0-9]{1,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents');
  end if;
  if kind_value in ('sentenca', 'acordo', 'transito', 'arquivamento') and exists (
    select 1 from public.lawsuit_facts f where f.proceeding_id = lawsuit.id and f.kind = kind_value and f.corrected_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'fact_exists');
  end if;
  fact := public.lawsuit_fact_write(lawsuit.id, fields, null, null, auth.uid());
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (lawsuit.org_id, auth.uid(), 'outcome.fact_written', 'lawsuit_fact', fact::text, jsonb_build_object('kind', kind_value));
  return jsonb_build_object('ok', true, 'fact_id', fact);
end;
$$;

revoke all on function public.save_lawsuit_fact(uuid, jsonb) from public, anon;
grant execute on function public.save_lawsuit_fact(uuid, jsonb) to authenticated;

/**
 * A person acts on a fact: corrects it with the reason (never deleted; ONE never reads that movement again into it),
 * confirms a fact ONE read where the firm keeps the result to a person, says they are aware of it, or registers what a
 * release paid when it arrived.
 */
create or replace function public.act_on_lawsuit_fact(target_fact uuid, target_action text, fields jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fact public.lawsuit_facts%rowtype;
  refusal text;
  reason text := nullif(btrim(coalesce(fields ->> 'reason', '')), '');
begin
  select * into fact from public.lawsuit_facts where id = target_fact for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  refusal := public.lawsuit_fact_refusal(fact.org_id);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if fact.corrected_at is not null then
    return jsonb_build_object('ok', false, 'code', 'corrected');
  end if;
  if target_action = 'correct' then
    if reason is null or char_length(reason) not between 3 and 300 then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
    end if;
    update public.lawsuit_facts set corrected_at = now(), corrected_by = auth.uid(), corrected_reason = reason
    where id = fact.id;
  elsif target_action = 'confirm' then
    update public.lawsuit_facts set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now() where id = fact.id;
  elsif target_action = 'ack' then
    update public.lawsuit_facts set acked_by = auth.uid(), acked_at = now() where id = fact.id and acked_at is null;
  elsif target_action = 'received' then
    if fact.kind <> 'alvara' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
    end if;
    if coalesce(fields ->> 'cents', '') !~ '^[0-9]{1,13}$'
       or coalesce(fields ->> 'received_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (fields ->> 'received_on')::date > (now() at time zone 'America/Sao_Paulo')::date then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'received');
    end if;
    update public.lawsuit_facts
    set received_cents = (fields ->> 'cents')::bigint, received_on = (fields ->> 'received_on')::date, received_by = auth.uid()
    where id = fact.id;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'action');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (fact.org_id, auth.uid(), 'outcome.fact_' || target_action, 'lawsuit_fact', fact.id::text,
    jsonb_build_object('kind', fact.kind));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.act_on_lawsuit_fact(uuid, text, jsonb) from public, anon;
grant execute on function public.act_on_lawsuit_fact(uuid, text, jsonb) to authenticated;

/** A lawyer says they are aware ONE closed the case (a click from reopening it, which `set_case_status` does). */
create or replace function public.acknowledge_case_closure(target_case uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  refusal text;
begin
  select * into current_case from public.cases where id = target_case for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  refusal := public.lawsuit_fact_refusal(current_case.org_id);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  update public.cases set close_acked_by = auth.uid(), close_acked_at = now()
  where id = current_case.id and closed_by_one and close_acked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.acknowledge_case_closure(uuid) from public, anon;
grant execute on function public.acknowledge_case_closure(uuid) to authenticated;

-- ---------- ONE closes a case ----------
/**
 * The cases ready to be closed (internal): a case in court, every lawsuit the court has archived definitively by a
 * confirmed fact in force, and every release in force received. Nothing else open is asked of a case yet: the
 * client's money (phase 10) joins this reading when it is built.
 */
create or replace function public.cases_ready_to_close(target_org uuid)
returns table (case_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.cases c
  where (target_org is null or c.org_id = target_org) and c.status = 'filed'
    and exists (select 1 from public.proceedings p where p.case_id = c.id and p.status = 'filed')
    and not exists (
      select 1 from public.proceedings p
      where p.case_id = c.id and p.status = 'filed'
        and not exists (
          select 1 from public.lawsuit_facts f
          where f.proceeding_id = p.id and f.kind = 'arquivamento' and f.corrected_at is null and f.confirmed
        )
    )
    and not exists (
      select 1 from public.lawsuit_facts f
      where f.case_id = c.id and f.kind = 'alvara' and f.corrected_at is null and f.received_on is null
    );
$$;

revoke all on function public.cases_ready_to_close(uuid) from public, anon, authenticated;

/** ONE closes the cases ready, where the firm lets it (`close_case`), as ONE's, asking the lawyers' awareness. */
create or replace function public.close_cases_by_one(target_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ready record;
  closed integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for ready in
    select c.id, c.org_id from public.cases c
    where c.id in (select r.case_id from public.cases_ready_to_close(null) r)
    order by c.created_at
    limit greatest(coalesce(target_limit, 50), 1)
    for update skip locked
  loop
    continue when public.firm_autonomy_mode(ready.org_id, 'close_case') = 'approval';
    update public.cases
    set status = 'closed', status_changed_at = now(), closed_at = now(), closed_by_one = true,
        close_acked_by = null, close_acked_at = null,
        close_reason = 'Todas as ações foram arquivadas definitivamente e o dinheiro liberado foi recebido.'
    where id = ready.id and status = 'filed';
    if found then
      perform public.record_case_event(ready.org_id, ready.id, 'status_changed', 'system',
        jsonb_build_object('from', 'filed', 'to', 'closed', 'by_one', true));
      closed := closed + 1;
    end if;
  end loop;
  return closed;
end;
$$;

revoke all on function public.close_cases_by_one(integer) from public, anon, authenticated;
grant execute on function public.close_cases_by_one(integer) to service_role;

-- ---------- What waits for a person ----------
/**
 * What the results ask of the firm's people: the facts that change the course and wait for a lawyer's awareness (the
 * judgment become final, the archiving, a judgment against the client), the facts ONE read that wait for a person's
 * confirmation, the releases whose value is still to arrive, the cases ready to close where the firm keeps that to a
 * person, and the cases ONE closed that no lawyer said they saw. Each with its case.
 */
create or replace function public.firm_outcome_attention(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.is_org_member(target_org) then null else jsonb_build_object(
    'acks', coalesce((
      select jsonb_agg(jsonb_build_object('fact_id', f.id, 'case_id', f.case_id, 'seq', c.seq, 'kind', f.kind,
        'result', f.result, 'on', f.happened_on) order by f.happened_on, f.created_at)
      from public.lawsuit_facts f join public.cases c on c.id = f.case_id
      where f.org_id = target_org and f.ack_owed and f.acked_at is null and f.corrected_at is null and f.confirmed
    ), '[]'::jsonb),
    'unconfirmed', coalesce((
      select jsonb_agg(jsonb_build_object('fact_id', f.id, 'case_id', f.case_id, 'seq', c.seq, 'kind', f.kind)
        order by f.created_at)
      from public.lawsuit_facts f join public.cases c on c.id = f.case_id
      where f.org_id = target_org and not f.confirmed and f.corrected_at is null
    ), '[]'::jsonb),
    'releases', coalesce((
      select jsonb_agg(jsonb_build_object('fact_id', f.id, 'case_id', f.case_id, 'seq', c.seq, 'cents', f.cents,
        'on', f.happened_on) order by f.happened_on)
      from public.lawsuit_facts f join public.cases c on c.id = f.case_id
      where f.org_id = target_org and f.kind = 'alvara' and f.corrected_at is null and f.confirmed and f.received_on is null
    ), '[]'::jsonb),
    'ready_to_close', coalesce((
      select jsonb_agg(jsonb_build_object('case_id', c.id, 'seq', c.seq) order by c.seq)
      from public.cases c
      where c.id in (select r.case_id from public.cases_ready_to_close(target_org) r)
        and public.firm_autonomy_mode(target_org, 'close_case') = 'approval'
    ), '[]'::jsonb),
    'closed_by_one', coalesce((
      select jsonb_agg(jsonb_build_object('case_id', c.id, 'seq', c.seq, 'closed_at', c.closed_at) order by c.closed_at)
      from public.cases c
      where c.org_id = target_org and c.status = 'closed' and c.closed_by_one and c.close_acked_at is null
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.firm_outcome_attention(uuid) from public, anon;
grant execute on function public.firm_outcome_attention(uuid) to authenticated;

-- ---------- ONE's work counts the results it read and the cases it closed ----------
/** Every act of ONE's work, the results it read and the cases it closed among them (0130). */
create or replace function public.one_work_acts(target_org uuid, target_from timestamptz, target_to timestamptz)
returns table (kind text, at timestamptz, case_id uuid, assisted boolean, test boolean)
language sql
stable
security definer
set search_path = public
as $$
  -- The conversation: a case ONE opened at the passenger's yes.
  select 'caso_aberto_conversa', e.at, e.case_id, false, null::boolean
  from public.case_events e
  where e.org_id = target_org and e.kind = 'created' and e.actor_type = 'system'
    and e.data ->> 'from' = 'conversation' and e.at >= target_from and e.at < target_to
  union all
  -- ONE's answer that went out in a conversation, written by its model; approved by a person, apart.
  select 'resposta_conversa', m.created_at, null, exists (
           select 1 from public.approvals a
           where a.run_id = m.ai_run_id and a.status = 'approved' and a.decided_by is not null
         ), n.provider = 'test'
  from public.wa_messages m
  join public.ai_runs r on r.id = m.ai_run_id and r.task = 'atendimento.conversa'
  join public.wa_numbers n on n.id = m.number_id
  where m.org_id = target_org and m.direction = 'out' and m.status in ('sent', 'delivered', 'read')
    and m.created_at >= target_from and m.created_at < target_to
  union all
  -- The client's link ONE made and sent, which no person ended or replaced.
  select 'link_cliente', l.created_at, l.case_id, false, null
  from public.client_links l
  where l.org_id = target_org and l.created_by is null and l.revoked_by is null
    and l.created_at >= target_from and l.created_at < target_to
    and exists (
      select 1 from public.case_events e
      where e.case_id = l.case_id and e.kind = 'client_link_created' and e.actor_type = 'system'
        and e.data ->> 'link' = l.id::text
    )
  union all
  -- A file the passenger sent in the conversation, joined to their case by ONE, still there.
  select 'arquivo_conversa', e.at, e.case_id, false, null
  from public.case_events e
  where e.org_id = target_org and e.kind = 'document_added' and e.actor_type = 'system'
    and e.data ->> 'source' = 'whatsapp' and e.at >= target_from and e.at < target_to
    and exists (select 1 from public.case_documents d where d.id::text = e.data ->> 'document')
  union all
  -- An answer of the interview the passenger gave in the conversation and ONE read, which no person rewrote.
  select 'resposta_entrevista', a.answered_at, a.case_id, false, null
  from public.case_interview_answers a
  where a.org_id = target_org and a.source = 'chat' and a.status in ('answered', 'unknown')
    and a.answered_at >= target_from and a.answered_at < target_to
  union all
  -- A document checked by ONE: decided by its check alone, or by a person who approved the check (apart).
  select 'documento_conferido', d.decided_at, d.case_id, d.decided_by is not null, null
  from public.case_documents d
  where d.org_id = target_org and d.status in ('accepted', 'rejected') and d.check_run_id is not null
    and d.decided_at >= target_from and d.decided_at < target_to
    and (d.decided_by is null or exists (
      select 1 from public.approvals a
      where a.run_id = d.check_run_id and a.status = 'approved' and a.decided_by is not null
    ))
  union all
  -- A person's data written from a document, while what was written stands or was confirmed.
  select 'dados_lidos', e.at, e.case_id, e.actor_type = 'person', null
  from public.case_events e
  join public.people p on p.id::text = e.data ->> 'person'
  where e.org_id = target_org and e.kind = 'person_read' and e.at >= target_from and e.at < target_to
    and (
      p.read_fields ?| array(select jsonb_array_elements_text(coalesce(e.data -> 'fields', '[]'::jsonb)))
      or exists (
        select 1 from public.case_events c
        where c.case_id = e.case_id and c.kind = 'person_read_confirmed' and c.at >= e.at
          and c.data ->> 'person' = e.data ->> 'person'
      )
    )
  union all
  -- A photo made a PDF of the size the courts take.
  select 'foto_pdf', f.created_at, d.case_id, false, null
  from public.case_documents d
  join public.files f on f.id = d.normalized_file_id and f.status = 'stored'
  where d.org_id = target_org and f.created_at >= target_from and f.created_at < target_to
  union all
  -- An audio heard and written down, which no person wrote over; approved by a person, apart.
  select 'audio_transcrito', r.finished_at, s.case_id, exists (
           select 1 from public.approvals a
           where a.run_id = s.transcript_run_id and a.status = 'approved' and a.decided_by is not null
         ), null
  from public.case_statements s
  join public.ai_runs r on r.id = s.transcript_run_id
  where s.org_id = target_org and s.audio_file_id is not null and s.transcript is not null
    and r.finished_at >= target_from and r.finished_at < target_to
  union all
  -- The order of the facts that went to the client: by ONE alone, or by a person who approved it (apart).
  select 'ordem_dos_fatos', coalesce(a.decided_at, r.finished_at), s.case_id, a.id is not null, null
  from public.case_statements s
  join public.ai_runs r on r.id = s.chronology_run_id
  left join public.approvals a
    on a.run_id = s.chronology_run_id and a.status = 'approved' and a.decided_by is not null
  where s.org_id = target_org and s.chronology_status in ('approved', 'confirmed', 'contested')
    and coalesce(a.decided_at, r.finished_at) >= target_from and coalesce(a.decided_at, r.finished_at) < target_to
  union all
  -- The lawsuits ONE created.
  select 'acoes_criadas', p.created_at, p.case_id, false, null
  from public.proceedings p
  where p.org_id = target_org and p.created_by_one and p.created_at >= target_from and p.created_at < target_to
  union all
  -- The court's system ONE named for a lawsuit and a person of the firm approved.
  select 'sistema_tribunal', p.system_approved_at, p.case_id, true, null
  from public.proceedings p
  where p.org_id = target_org and p.system_by_one and p.system is not null and p.system_refused_at is null
    and p.system_approved_by is not null
    and p.system_approved_at >= target_from and p.system_approved_at < target_to
  union all
  -- A leg checked against ANAC's record of the flights.
  select 'voo_conferido', f.checked_at, f.case_id, false, null
  from public.flight_checks f
  where f.org_id = target_org and f.source = 'vra' and f.status in ('found', 'not_found')
    and f.checked_at >= target_from and f.checked_at < target_to
  union all
  -- The weather of the affected leg read for the Tema 1.417 (its latest reading).
  select 'clima_lido', (c.weather_read ->> 'at')::timestamptz, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.weather_read ? 'at'
    and (c.weather_read ->> 'at')::timestamptz >= target_from and (c.weather_read ->> 'at')::timestamptz < target_to
  union all
  -- The decision to file or hold on the Tema 1.417, taken by ONE and kept.
  select 'tema_1417', c.suspension_decided_at, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.suspension_decided_auto and c.suspension_decision in ('file', 'hold')
    and c.suspension_decided_at >= target_from and c.suspension_decided_at < target_to
  union all
  -- The first text of a piece written by ONE, not turned down nor given up; approved by a lawyer, apart.
  select 'texto_peca', v.created_at, d.case_id, d.approved_by is not null, null
  from public.case_draft_versions v
  join public.case_drafts d on d.id = v.draft_id
  where v.org_id = target_org and v.version = 1 and v.author = 'ai' and d.status in ('proposed', 'approved', 'issued')
    and v.created_at >= target_from and v.created_at < target_to
  union all
  -- A piece ONE approved itself, and nobody took the approval back.
  select 'peca_aprovada', d.approved_at, d.case_id, false, null
  from public.case_drafts d
  where d.org_id = target_org and d.approved_auto and d.status in ('approved', 'issued')
    and d.approved_at >= target_from and d.approved_at < target_to
  union all
  -- A paper for the client to sign (a power of attorney, a contract) ONE wrote and sent, its signature not ended.
  select 'papel_cliente', p.created_at, p.case_id, false, null
  from public.case_papers p
  left join public.signature_envelopes s on s.id = p.envelope_id
  where p.org_id = target_org and p.created_at >= target_from and p.created_at < target_to
    and (s.id is null or s.status not in ('cancelled', 'failed'))
  union all
  -- A dossier of the case written and issued.
  select 'dossie', d.issued_at, d.case_id, false, null
  from public.dossiers d
  where d.org_id = target_org and d.status = 'issued' and d.issued_at >= target_from and d.issued_at < target_to
  union all
  -- A filing package built, not given up.
  select 'pacote_protocolo', f.built_at, f.case_id, false, null
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.built_at >= target_from and f.built_at < target_to
  union all
  -- The files of a package signed with a lawyer's authorization.
  select 'arquivos_assinados', f.signed_at, f.case_id, false, null
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.signature_status = 'signed'
    and f.signed_at >= target_from and f.signed_at < target_to
  union all
  -- A lawsuit filed by ONE in the court's own channel.
  select 'acao_protocolada', s.filed_at, s.case_id, false, null
  from public.filing_submissions s
  where s.org_id = target_org and s.status = 'filed' and s.filed_at >= target_from and s.filed_at < target_to
  union all
  -- A communication of the DJEN read for the firm.
  select 'publicacao_capturada', p.captured_at, p.case_id, false, null
  from public.publications p
  where p.org_id = target_org and p.captured_at >= target_from and p.captured_at < target_to
  union all
  -- A publication triaged by ONE whose triage stands; checked by a person and kept, apart.
  select 'publicacao_triada', p.triaged_at, p.case_id, p.triaged_by is not null or p.reviewed_by is not null, null
  from public.publications p
  where p.org_id = target_org and p.ai_applied and p.category is not null
    and (p.triaged_by is null or p.category = p.ai_category)
    and p.triaged_at >= target_from and p.triaged_at < target_to
  union all
  -- A deadline ONE read from a publication and proposed, not dismissed.
  select 'prazo_lido', d.created_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.proposed_auto and d.status <> 'dismissed'
    and d.created_at >= target_from and d.created_at < target_to
  union all
  -- A hearing ONE read from a publication and registered, not cancelled.
  select 'audiencia_lida', h.created_at, h.case_id, false, null
  from public.hearings h
  where h.org_id = target_org and h.created_auto and h.status <> 'cancelled'
    and h.created_at >= target_from and h.created_at < target_to
  union all
  -- A movement of a lawsuit the court made and ONE read, never the history its first reading brought.
  select 'andamento_lido', x.learned_at, x.case_id, false, null
  from (
    select m.case_id, m.learned_at, min(m.learned_at) over (partition by m.proceeding_id, m.source) as first_at
    from public.movements m
    where m.org_id = target_org and m.proceeding_id in (
      select n.proceeding_id from public.movements n
      where n.org_id = target_org and n.learned_at >= target_from and n.learned_at < target_to
    )
  ) x
  where x.learned_at > x.first_at and x.learned_at >= target_from and x.learned_at < target_to
  union all
  -- A deadline counted by the rule over the court's calendar, as it stands.
  select 'prazo_contado', d.computed_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.computed_due_on is not null and d.computed_revision = d.revision
    and d.status <> 'dismissed' and d.computed_at >= target_from and d.computed_at < target_to
  union all
  -- A deadline ONE confirmed on the day it counted, as it stands.
  select 'prazo_confirmado', d.confirmed_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.confirmed_auto and d.status in ('confirmed', 'done')
    and d.confirmed_at >= target_from and d.confirmed_at < target_to
  union all
  -- A hearing written to the firm's calendar, as it stands.
  select 'audiencia_agenda', h.synced_at, h.case_id, false, null
  from public.hearings h
  where h.org_id = target_org and h.synced_revision = h.revision and h.synced_calendar is not null
    and h.status <> 'cancelled' and h.synced_at >= target_from and h.synced_at < target_to
  union all
  -- What the client was told on WhatsApp, each notice that went out (never the alert of a flight).
  select case
           when n.kind in ('hearing_reminder', 'hearing_change') then 'aviso_audiencia'
           when n.kind in ('lawsuit_update', 'lawsuit_filed', 'case_received') then 'aviso_andamento'
           when n.kind = 'payment_alert' then 'aviso_golpe'
           else 'pedido_documento'
         end,
         m.created_at, n.case_id, false, null
  from public.client_notices n
  join public.wa_messages m on m.id = n.message_id
  where n.org_id = target_org and m.status in ('sent', 'delivered', 'read')
    and n.kind in ('hearing_reminder', 'hearing_change', 'lawsuit_update', 'lawsuit_filed', 'case_received',
                   'payment_alert', 'document_refused', 'case_questions')
    and m.created_at >= target_from and m.created_at < target_to
  union all
  -- A model of the library ONE made from the firm's own document, while the model is there: saved by ONE, or by a
  -- person from what ONE prepared (apart). The record of its saving is the only one the act leaves.
  select 'modelo_documento', a.created_at, null, a.action = 'library.import_saved', false
  from public.audit_events a
  where a.org_id = target_org and a.action in ('library.import_saved_by_one', 'library.import_saved')
    and a.created_at >= target_from and a.created_at < target_to
    and exists (
      select 1 from public.draft_templates t where t.org_id = target_org and t.id::text = a.metadata ->> 'template_id'
    )
  union all
  -- A line of a bank statement ONE entered or joined in the firm's books, by a rule or by the AI, while it
  -- stands (0128). `firm_one_work` says it only to who reads the books.
  select 'linha_extrato', l.decided_at, null, false, false
  from public.finance_statement_lines l
  where l.org_id = target_org and l.decided_by_one and l.state in ('entered', 'matched')
    and l.decided_at >= target_from and l.decided_at < target_to
  union all
  -- A fact of a lawsuit ONE read and recorded, in force and confirmed (0130).
  select 'resultado_lido', f.created_at, f.case_id, false, null
  from public.lawsuit_facts f
  where f.org_id = target_org and f.by_one and f.confirmed and f.corrected_at is null
    and f.created_at >= target_from and f.created_at < target_to
  union all
  -- A case ONE closed, while it stays closed (0130).
  select 'caso_encerrado', c.closed_at, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.status = 'closed' and c.closed_by_one
    and c.closed_at >= target_from and c.closed_at < target_to;
$$;

revoke all on function public.one_work_acts(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------- The case screen follows the facts ----------
/** The mark of what the case screen shows, the facts of its lawsuits among them (0130). */
create or replace function public.case_pulse(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  stamp text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  select * into advance from public.case_advances where case_id = target_case;

  select md5(concat_ws('|',
    current_case::text,
    (select concat(count(*), '/', max(e.at)) from public.case_events e where e.case_id = target_case),
    (select concat(a.waiting, '/', a.checked_at, '/', a.waiting_since, '/', a.claimed_at, '/', a.woken_at, '/', a.after)
       from public.case_advances a where a.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_parties t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.people t
       where t.id in (select cp.person_id from public.case_parties cp where cp.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_segments t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_documents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_statements t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interviews t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interview_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_links t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_consents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.signature_envelopes t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_papers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.civil_court_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.residence_declarations t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.free_justice_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceedings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_parties t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_lawyers t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceeding_tracking t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_drafts t where t.case_id = target_case),
    (select concat(count(*), '/', max(v.created_at)) from public.case_draft_versions v
       where v.draft_id in (select d.id from public.case_drafts d where d.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.filing_packages t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.dossiers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.deadlines t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.hearings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_notices t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.admin_complaints t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.lawsuit_facts t where t.case_id = target_case),
    -- Of a publication, only what a member reads of it: never the AI's word in the shadow.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.category, t.triaged_at, t.active, t.cancel_seen_at,
        t.review_due, t.judgment, t.judgment_source, t.ack_owed, t.acked_at), ';' order by t.id), ''))
       from public.publications t where t.case_id = target_case),
    (select md5(coalesce(string_agg(concat_ws(',', r.publication_id, r.kind, r.status, r.reason, r.updated_at), ';'
        order by r.publication_id, r.kind), ''))
       from public.publication_readings r
       where r.publication_id in (select p.id from public.publications p where p.case_id = target_case))
  )) into stamp;

  return jsonb_build_object(
    'stamp', stamp,
    'advance', jsonb_build_object(
      'running', coalesce(advance.claimed_at is not null and advance.claimed_at > now() - make_interval(mins => stale), false),
      'due', coalesce(advance.woken_at is not null
        and (advance.checked_at is null or advance.woken_at > advance.checked_at)
        and (advance.after is null or advance.after <= now()), false),
      'waiting_since', advance.waiting_since,
      'checked_at', advance.checked_at
    )
  );
end;
$$;

revoke all on function public.case_pulse(uuid) from public, anon;
grant execute on function public.case_pulse(uuid) to authenticated;

-- ---------- The test court judges every way ----------
/** The test court, which now judges in part, denies, approves a settlement, takes the defendant's appeal and releases a value (0130). */
create or replace function public.test_court_act(target_token text, target_proceeding uuid, target_event text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  held public.proceeding_tracking%rowtype;
  court_row public.courts%rowtype;
  zone text;
  local_now timestamp;
  ahead timestamp;
  court_day date;
  unit_name text;
  done text[];
  moves jsonb := '[]'::jsonb;
  move jsonb;
  ordinal integer := 0;
  body text;
  document_type_value text;
  hearing_local timestamp;
  hearing_moment timestamptz;
  claimed bigint;
  amount text;
  added integer := 0;
  published uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  org := public.test_court_org(target_token);
  if org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_event is null or target_event not in (
    'distribuicao', 'audiencia', 'audiencia_realizada', 'manifestacao', 'sentenca', 'transito', 'alvara', 'arquivamento',
    'sentenca_parcial', 'sentenca_improcedente', 'acordo', 'recurso_re'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_event');
  end if;
  select * into lawsuit from public.proceedings where id = target_proceeding and org_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into current_case from public.cases where id = lawsuit.case_id;
  if not current_case.is_test then
    return jsonb_build_object('ok', false, 'code', 'not_a_test_case');
  end if;
  if lawsuit.status <> 'filed' or lawsuit.cnj is null then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  select * into held from public.proceeding_tracking where proceeding_id = lawsuit.id for update;
  if not found or held.source <> 'teste' then
    return jsonb_build_object('ok', false, 'code', 'not_a_test_case');
  end if;

  select coalesce(array_agg(distinct split_part(m.source_id, ':', 2)), '{}'::text[]) into done
  from public.movements m where m.proceeding_id = lawsuit.id and m.source = 'teste';
  if target_event = any (done) then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;
  -- One judgment or settlement per lawsuit, whatever its way (0130).
  if (target_event like 'sentenca%' or target_event = 'acordo')
     and exists (select 1 from unnest(done) d where d like 'sentenca%' or d = 'acordo') then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;
  if 'arquivamento' = any (done) then
    return jsonb_build_object('ok', false, 'code', 'archived');
  end if;
  if target_event <> 'distribuicao' and not ('distribuicao' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'not_distributed');
  end if;
  if target_event = 'audiencia_realizada' and not ('audiencia' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'no_hearing');
  end if;
  if target_event in ('transito', 'arquivamento', 'recurso_re')
     and not exists (select 1 from unnest(done) d where d like 'sentenca%' or d = 'acordo') then
    return jsonb_build_object('ok', false, 'code', 'no_judgment');
  end if;
  if target_event = 'alvara' and 'sentenca_improcedente' = any (done) then
    return jsonb_build_object('ok', false, 'code', 'nothing_to_release');
  end if;
  if target_event = 'alvara' and not ('transito' = any (done) or 'acordo' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'not_final');
  end if;

  select * into court_row from public.courts where acronym = lawsuit.court;
  zone := coalesce(court_row.time_zone, 'America/Sao_Paulo');
  local_now := now() at time zone zone;
  court_day := local_now::date;

  -- A hearing is held at its moment, never before it.
  if target_event = 'audiencia_realizada' then
    hearing_moment := public.test_court_hearing_at(lawsuit.id);
    if hearing_moment is not null and now() < hearing_moment then
      return jsonb_build_object('ok', false, 'code', 'hearing_later',
        'hearing_at', to_char(hearing_moment at time zone zone, 'YYYY-MM-DD"T"HH24:MI'));
    end if;
  end if;

  unit_name := coalesce(
    nullif(btrim(lawsuit.unit), ''),
    case when lawsuit.kind = 'juizado' then '1º Juizado Especial Cível' else '1ª Vara Cível' end
      || coalesce(' da Comarca de ' || nullif(btrim(lawsuit.comarca), ''), '')
  );

  if target_event = 'distribuicao' then
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Processo distribuído por sorteio', 'detail', unit_name),
      jsonb_build_object('title', 'Expedida a carta de citação da ré'));
  elsif target_event = 'audiencia' then
    -- The next five minutes at least ten minutes away.
    ahead := local_now + interval '10 minutes';
    hearing_local := date_trunc('hour', ahead)
      + make_interval(mins => (ceil(extract(epoch from ahead - date_trunc('hour', ahead)) / 300) * 5)::integer);
    if extract(hour from hearing_local) < 7 or extract(hour from hearing_local) >= 20 then
      hearing_local := (local_now::date + 1) + time '09:00';
      while extract(isodow from hearing_local) > 5 loop
        hearing_local := hearing_local + interval '1 day';
      end loop;
    end if;
    body := 'Designo audiência de conciliação para o dia ' || to_char(hearing_local, 'DD/MM/YYYY') || ', às '
      || to_char(hearing_local, 'HH24:MI') || ', a ser realizada presencialmente na sala de audiências do '
      || unit_name || '. Intimem-se as partes.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(jsonb_build_object(
      'title', 'Audiência de conciliação designada',
      'detail', to_char(hearing_local, 'DD/MM/YYYY') || ' às ' || to_char(hearing_local, 'HH24:MI') || ', presencial'));
  elsif target_event = 'audiencia_realizada' then
    moves := jsonb_build_array(jsonb_build_object(
      'title', 'Audiência de conciliação realizada', 'detail', 'As partes não chegaram a um acordo.'));
  elsif target_event = 'manifestacao' then
    body := 'Intime-se a parte autora para, no prazo de 15 (quinze) dias, manifestar-se sobre a contestação '
      || 'e os documentos juntados pela ré.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Juntada a contestação da ré'),
      jsonb_build_object('title', 'Expedida a intimação da parte autora'));
  elsif target_event = 'sentenca' then
    select sum(cp.claim_cents) into claimed
    from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id
    where pp.proceeding_id = lawsuit.id;
    -- A petition that asked no value leaves the indemnity to the court, which arbitrates it.
    amount := case when claimed is null then 'que arbitro em R$ 5.000,00 (cinco mil reais) por autor'
      else 'de R$ ' || translate(to_char(claimed / 100.0, 'FM999,999,999,990.00'), ',.', '.,') end;
    body := 'SENTENÇA. Dispensado o relatório, nos termos do art. 38 da Lei 9.099/1995. A ré não demonstrou causa '
      || 'que afastasse a sua responsabilidade pelo ocorrido com o voo da parte autora. Ante o exposto, JULGO '
      || 'PROCEDENTE o pedido para condenar a ré a pagar à parte autora indenização por danos morais ' || amount
      || ', com correção monetária e juros de mora na forma da lei. Sem custas e honorários nesta fase, nos termos '
      || 'do art. 55 da Lei 9.099/1995. Publique-se. Registre-se. Intimem-se.';
    document_type_value := 'Sentença';
    moves := jsonb_build_array(jsonb_build_object('title', 'Julgado procedente o pedido', 'detail', 'Sentença registrada.'));
  elsif target_event = 'sentenca_parcial' then
    body := 'SENTENÇA. Dispensado o relatório, nos termos do art. 38 da Lei 9.099/1995. Restou demonstrada '
      || 'parte do dano alegado. Ante o exposto, JULGO PARCIALMENTE PROCEDENTE o pedido para condenar a ré a '
      || 'pagar à parte autora indenização por danos morais de R$ 3.000,00 (três mil reais) por autor, com correção '
      || 'monetária e juros de mora na forma da lei. Sem custas e honorários nesta fase. Publique-se. Registre-se. '
      || 'Intimem-se.';
    document_type_value := 'Sentença';
    moves := jsonb_build_array(jsonb_build_object('title', 'Julgado parcialmente procedente o pedido',
      'detail', 'Sentença registrada.'));
  elsif target_event = 'sentenca_improcedente' then
    body := 'SENTENÇA. Dispensado o relatório, nos termos do art. 38 da Lei 9.099/1995. A ré demonstrou que o '
      || 'cancelamento decorreu de condições meteorológicas adversas. Ante o exposto, JULGO IMPROCEDENTE o pedido. '
      || 'Sem custas e honorários nesta fase. Publique-se. Registre-se. Intimem-se.';
    document_type_value := 'Sentença';
    moves := jsonb_build_array(jsonb_build_object('title', 'Julgado improcedente o pedido',
      'detail', 'Sentença registrada.'));
  elsif target_event = 'acordo' then
    body := 'SENTENÇA. Pelo exposto, HOMOLOGO o acordo celebrado entre as partes, no valor de R$ 4.000,00 '
      || '(quatro mil reais), a ser pago pela ré em 15 dias, para que produza seus efeitos legais, e julgo extinto '
      || 'o processo com resolução do mérito. Publique-se. Intimem-se.';
    document_type_value := 'Sentença';
    moves := jsonb_build_array(jsonb_build_object('title', 'Homologado o acordo entre as partes',
      'detail', 'Sentença registrada.'));
  elsif target_event = 'recurso_re' then
    body := 'Intime-se a parte recorrida para apresentar contrarrazões ao recurso inominado interposto pela ré, '
      || 'no prazo de 10 (dez) dias.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Interposto recurso inominado pela parte ré'),
      jsonb_build_object('title', 'Expedida a intimação da parte autora para contrarrazões'));
  elsif target_event = 'transito' then
    moves := jsonb_build_array(jsonb_build_object('title', 'Certificado o trânsito em julgado da sentença'));
  elsif target_event = 'alvara' then
    -- The value the judgment or the settlement set (0130): what the petition asked, else five thousand reais a
    -- claimant; three thousand a claimant in part; the settlement's four thousand.
    select sum(cp.claim_cents), count(*) into claimed, ordinal
    from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id
    where pp.proceeding_id = lawsuit.id;
    claimed := case
      when 'acordo' = any (done) then 400000
      when 'sentenca_parcial' = any (done) then 300000 * greatest(ordinal, 1)
      else coalesce(claimed, 500000 * greatest(ordinal, 1)) end;
    ordinal := 0;
    amount := translate(to_char(claimed / 100.0, 'FM999,999,999,990.00'), ',.', '.,');
    body := 'Expeça-se alvará eletrônico em favor da parte autora no valor de R$ ' || amount
      || ', para levantamento do valor depositado pela ré, com os acréscimos legais. Intime-se.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Juntado o comprovante do depósito judicial feito pela ré'),
      jsonb_build_object('title', 'Expedido alvará eletrônico em favor da parte autora'));
  else
    body := 'Cumprida a obrigação e levantado o valor depositado, arquivem-se os autos com as baixas necessárias. '
      || 'Intimem-se.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(jsonb_build_object('title', 'Arquivado definitivamente', 'detail', 'Baixa do processo.'));
  end if;

  for move in select value from jsonb_array_elements(moves) loop
    ordinal := ordinal + 1;
    insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title, detail, by_name)
    values (org, lawsuit.case_id, lawsuit.id, 'teste', 'teste:' || target_event || ':' || ordinal,
            now() + make_interval(secs => ordinal), move ->> 'title', nullif(move ->> 'detail', ''), 'Tribunal de teste')
    on conflict (proceeding_id, source, source_id) do nothing;
    if found then
      added := added + 1;
    end if;
  end loop;

  update public.proceeding_tracking t
  set status = 'tracked',
      snapshot = jsonb_build_object(
        'number', public.cnj_formatted(lawsuit.cnj), 'unit', unit_name,
        'status', case when target_event = 'arquivamento' then 'Arquivado' else 'Em andamento' end,
        'subjects', '[]'::jsonb, 'lawyers', '[]'::jsonb, 'responsibles', '[]'::jsonb, 'pending', '[]'::jsonb,
        'vendor', 'tribunal-teste'),
      vendor = 'tribunal-teste',
      movements_count = (select count(*) from public.movements m where m.proceeding_id = lawsuit.id),
      last_movement_at = (select max(m.occurred_at) from public.movements m where m.proceeding_id = lawsuit.id),
      read_at = now(), checked_at = now(), next_read_at = null,
      -- What the test court does is news to the firm, its first step included.
      seen_until = coalesce(t.seen_until, now() - interval '1 second'),
      unseen_count = t.unseen_count + added,
      requested_at = null, work_claimed_at = null, work_attempts = 0, work_error = null
  where t.id = held.id;
  if added > 0 then
    perform public.record_case_event(org, lawsuit.case_id, 'court_moved', 'system',
      jsonb_build_object('proceeding', lawsuit.id, 'source', 'teste', 'count', added));
  end if;

  if body is not null then
    insert into public.publications (
      org_id, hash, court, cnj, available_on, kind, document_type, body, truncated, head, tail, unit, class_name,
      active, lawyer_ids, proceeding_id, case_id
    ) values (
      org, 'teste-' || target_event || '-' || substr(md5(lawsuit.id::text), 1, 16), lawsuit.court, lawsuit.cnj, court_day,
      'Intimação', document_type_value, body, false, left(body, 1200), null, unit_name,
      case when lawsuit.kind = 'juizado' then 'Procedimento do Juizado Especial Cível' else 'Procedimento Comum Cível' end,
      true,
      coalesce((select array_agg(pl.user_id order by pl.user_id) from public.proceeding_lawyers pl where pl.proceeding_id = lawsuit.id),
               '{}'::uuid[]),
      lawsuit.id, lawsuit.case_id
    )
    on conflict (org_id, hash) do nothing
    returning id into published;
    if published is not null then
      perform public.record_case_event(org, lawsuit.case_id, 'publication_captured', 'system',
        jsonb_build_object('publication', published, 'proceeding', lawsuit.id));
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'code', 'done', 'event', target_event, 'moved', added, 'published', published,
    'hearing_at', case when hearing_local is not null then to_char(hearing_local, 'YYYY-MM-DD"T"HH24:MI') end));
end;
$$;

revoke all on function public.test_court_act(text, uuid, text) from public, anon, authenticated;
