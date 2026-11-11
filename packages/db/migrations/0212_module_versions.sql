-- ============================================================
-- 0212 · The module versioned as data (M6).
--
-- What a module's cases read was spread and edited in place: the documents
-- each kind of problem asks (a platform setting, 0177), the instructions of
-- each AI task (one version in force per task, 0016) and the platform's
-- piece models (0045, 0189). A change reached every case at once, the ones
-- in course included, and nothing said which a case had followed.
--
-- The owner decided on 2026-11-11: a module is a version of its own, which
-- only the operator publishes and nobody edits once published (a change is
-- a new version); each case keeps the version it was opened under, a new
-- case takes the latest published, and a version withdrawn for a defect
-- sends its cases to the latest published. The mold is the previous
-- product's `guard_module_version` (draft, published, withdrawn).
--
-- A version (`module_versions`) is a snapshot of what is in force when the
-- operator prepares it (`module_snapshot`): the documents by problem, the
-- version of each AI task the module names (`product_modules.version_tasks`)
-- and the platform's piece models (the initial's models by their id and the
-- intermediate pieces' by their kind). A case is stamped with the latest
-- published version of its module when it is created
-- (`cases.module_version_id`), and reads through it (`case_module_manifest`):
-- the documents it asks (`case_problem_documents`, read by
-- `case_required_documents`, `case_dispensables` and the app), the prompt
-- version of each run of the module's tasks whose subject is of a case
-- (`start_ai_run`, by `module_prompt_version`; a run of no case, such as a
-- conversation before its case, takes the module's latest published
-- version), and the platform's model a piece starts from
-- (`request_case_draft`, `request_intermediate_piece`). The version in
-- force is published as version 1 with what was in force on 2026-11-11, and
-- every case there was is stamped with it, so nothing changes today.
--
-- Not in a version: ONE's own messages, whose words the code changes by the
-- case (a minor, an agency, who signs first), and the firm's own words of
-- them (0191, versioned by the firm); the fixed questions of the intake,
-- which are a rule in code; and the WhatsApp templates, each firm's and
-- approved by the vendor. The operator reads and publishes versions in
-- `/admin/modulos`.
-- ============================================================

alter table public.product_modules add column version_tasks text[] not null default '{}';

update public.product_modules
set version_tasks = array[
  'atendimento.conversa', 'atendimento.entrada', 'atendimento.entrevista.resposta', 'atendimento.arquivo.tipo',
  'caso.documento.leitura', 'caso.peca.minuta', 'caso.peca.fatos_cliente', 'caso.relato.transcricao',
  'audiencia.resultado', 'parceiro.documento.leitura'
]
where key = 'direito-do-passageiro';

create table public.module_versions (
  id uuid primary key default gen_random_uuid(),
  module text not null references public.product_modules (key) on delete restrict,
  version integer not null,
  -- draft      prepared by the operator, read by no case, discarded or published;
  -- published  read by the cases stamped with it, and by every new case while it is the latest;
  -- withdrawn  a defect: its cases read the latest published.
  status text not null default 'draft',
  manifest jsonb not null,
  -- What changed, in the operator's words.
  note text not null,
  withdraw_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  withdrawn_by uuid references public.profiles (id) on delete set null,
  withdrawn_at timestamptz,
  unique (module, version),
  constraint module_versions_version_check check (version > 0),
  constraint module_versions_status_check check (status in ('draft', 'published', 'withdrawn')),
  constraint module_versions_manifest_check check (
    jsonb_typeof(manifest) = 'object'
    and jsonb_typeof(manifest -> 'documents') = 'object'
    and jsonb_typeof(manifest -> 'prompts') = 'object'
    and jsonb_typeof(manifest -> 'pieces') = 'object'
  ),
  constraint module_versions_note_check check (char_length(btrim(note)) between 3 and 1000),
  constraint module_versions_published_check check ((status = 'draft') = (published_at is null)),
  constraint module_versions_withdrawn_check check (
    (status = 'withdrawn') = (withdrawn_at is not null)
    and (status = 'withdrawn') = (withdraw_reason is not null)
    and (withdraw_reason is null or char_length(btrim(withdraw_reason)) between 3 and 1000)
  )
);

-- One draft at a time per module.
create unique index module_versions_draft_idx on public.module_versions (module) where status = 'draft';
create index module_versions_published_idx on public.module_versions (module, version desc) where status = 'published';

alter table public.module_versions enable row level security;
create policy "module_versions_select_operator" on public.module_versions
  for select to authenticated using (public.is_superadmin());
grant select on table public.module_versions to authenticated;

/**
 * A published version is never edited and never deleted: its manifest, its module and its number stay; it may only
 * be withdrawn. A draft is edited by being prepared again, and discarded.
 */
create or replace function public.guard_module_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'version_released_immutable' using errcode = 'check_violation',
        hint = 'A published version is never deleted. Withdraw it instead.';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (
    new.module is distinct from old.module or new.version is distinct from old.version
    or new.manifest is distinct from old.manifest or new.note is distinct from old.note
  ) then
    raise exception 'version_released_immutable' using errcode = 'check_violation',
      hint = 'Publish a new version instead of editing a published one.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'withdrawn')
  ) then
    raise exception 'invalid_version_transition' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_module_version() from public, anon, authenticated;

create trigger module_versions_guard before update or delete on public.module_versions
  for each row execute function public.guard_module_version();

-- ---------- What a case reads ----------

alter table public.cases add column module_version_id uuid references public.module_versions (id) on delete restrict;

/** The latest published version's manifest of a module, or null. Internal. */
create or replace function public.module_manifest(target_module text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select v.manifest from public.module_versions v
  where v.module = target_module and v.status = 'published'
  order by v.version desc limit 1;
$$;

revoke all on function public.module_manifest(text) from public, anon, authenticated;

/** What a case reads: its own version, else (withdrawn, or none) its module's latest published. Internal. */
create or replace function public.case_module_manifest(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select v.manifest from public.cases c join public.module_versions v on v.id = c.module_version_id
     where c.id = target_case and v.status = 'published'),
    (select public.module_manifest(c.module) from public.cases c where c.id = target_case)
  );
$$;

revoke all on function public.case_module_manifest(uuid) from public, anon, authenticated;

/** A new case is opened under its module's latest published version. */
create or replace function public.cases_stamp_module_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.module_version_id is null then
    select v.id into new.module_version_id from public.module_versions v
    where v.module = new.module and v.status = 'published'
    order by v.version desc limit 1;
  end if;
  return new;
end;
$$;

revoke all on function public.cases_stamp_module_version() from public, anon, authenticated;

create trigger cases_stamp_module_version before insert on public.cases
  for each row execute function public.cases_stamp_module_version();

/** The documents a case's kind of problem asks, as its version has them; the setting where no version says. Internal. */
create or replace function public.case_problem_documents(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.case_module_manifest(c.id) -> 'documents'
      -> case when c.incident like 'baggage%' then 'baggage' else 'default' end,
    public.problem_documents(c.incident)
  )
  from public.cases c where c.id = target_case;
$$;

revoke all on function public.case_problem_documents(uuid) from public, anon, authenticated;

/** The essentials of a case, by its kind of problem and its version (0177, 0212). Internal. */
create or replace function public.case_required_documents(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.case_problem_documents(target_case) -> 'essential', '[]'::jsonb);
$$;

revoke all on function public.case_required_documents(uuid) from public, anon, authenticated;

create or replace function public.case_dispensables(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', d.value ->> 'kind',
    'label', d.value ->> 'label',
    'state', case
      when exists (select 1 from public.case_documents x
                   where x.case_id = c.id and x.kind = d.value ->> 'kind' and x.status <> 'rejected') then 'sent'
      when exists (select 1 from public.case_document_answers a where a.case_id = c.id and a.kind = d.value ->> 'kind')
        then 'not_have'
      when public.case_waits_signature(c.id) then 'later'
      when coalesce(public.case_signed_at(c.id), c.created_at) < now() - make_interval(days => greatest(coalesce(
             (public.cases_setting('dispensable_days') #>> '{}')::integer, 7), 1)) then 'expired'
      else 'asked'
    end
  ) order by d.ordinality), '[]'::jsonb)
  from public.cases c
  cross join lateral jsonb_array_elements(coalesce(public.case_problem_documents(c.id) -> 'dispensable', '[]'::jsonb))
    with ordinality as d (value, ordinality)
  where c.id = target_case;
$$;

revoke all on function public.case_dispensables(uuid) from public, anon, authenticated;

/** The documents by problem of a case's version, for the backend's reading of a case (`advance`). */
create or replace function public.case_version_documents(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.case_module_manifest(target_case) -> 'documents';
$$;

revoke all on function public.case_version_documents(uuid) from public, anon, authenticated;
grant execute on function public.case_version_documents(uuid) to service_role;

/**
 * The version a case was opened under, and the one it reads (the latest published, when its own was withdrawn),
 * with the documents by problem it reads, for anybody of the case's firm.
 */
create or replace function public.case_module_version(target_org uuid, target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.cases%rowtype;
  own public.module_versions%rowtype;
  reads public.module_versions%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into c from public.cases where id = target_case and org_id = target_org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into own from public.module_versions where id = c.module_version_id;
  if own.status = 'published' then
    reads := own;
  else
    select * into reads from public.module_versions v
    where v.module = c.module and v.status = 'published' order by v.version desc limit 1;
  end if;
  return jsonb_build_object(
    'ok', true,
    'module', c.module,
    'module_name', (select m.name from public.product_modules m where m.key = c.module),
    'version', own.version,
    'withdrawn', own.status = 'withdrawn',
    'reads', reads.version,
    'documents', reads.manifest -> 'documents'
  );
end;
$$;

revoke all on function public.case_module_version(uuid, uuid) from public, anon;
grant execute on function public.case_module_version(uuid, uuid) to authenticated;

-- ---------- The AI instructions a run takes ----------

/** The case an AI run is about, by its subject; null for a subject of no case. Internal. */
create or replace function public.ai_subject_case(target_type text, target_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  subject uuid;
begin
  if target_id is null or target_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  subject := target_id::uuid;
  return case target_type
    when 'case' then (select c.id from public.cases c where c.id = subject)
    when 'case_document' then (select d.case_id from public.case_documents d where d.id = subject)
    when 'case_draft' then (select d.case_id from public.case_drafts d where d.id = subject)
    when 'case_interview' then (select i.case_id from public.case_interviews i where i.id = subject)
    when 'piece_fact_check' then (select p.case_id from public.piece_fact_checks p where p.id = subject)
    when 'hearing' then (select h.case_id from public.hearings h where h.id = subject)
  end;
end;
$$;

revoke all on function public.ai_subject_case(text, text) from public, anon, authenticated;

/**
 * The prompt version a run of a module's task takes: the case's version for a subject of a case, the module's
 * latest published for the rest; null for a task no module names, or one its version does not pin. Internal.
 */
create or replace function public.module_prompt_version(target_task text, target_subject_type text, target_subject_id text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owner_module text;
  subject_case uuid;
  manifest jsonb;
  pinned text;
begin
  select m.key into owner_module from public.product_modules m where target_task = any(m.version_tasks) limit 1;
  if owner_module is null then
    return null;
  end if;
  subject_case := public.ai_subject_case(target_subject_type, target_subject_id);
  manifest := case when subject_case is not null then public.case_module_manifest(subject_case) end;
  manifest := coalesce(manifest, public.module_manifest(owner_module));
  pinned := manifest -> 'prompts' ->> target_task;
  return case when pinned ~ '^[0-9]{1,6}$' then pinned::integer end;
end;
$$;

revoke all on function public.module_prompt_version(text, text, text) from public, anon, authenticated;

create or replace function public.start_ai_run(
  target_org uuid,
  target_task text,
  target_input_hash text,
  target_requested_by uuid default null,
  target_subject_type text default null,
  target_subject_id text default null,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.ai_tasks%rowtype;
  version_row public.prompt_versions%rowtype;
  existing public.ai_runs%rowtype;
  new_id uuid;
  pinned integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'firm_not_found');
  end if;
  -- A run asked by a person is asked by a person OF THAT FIRM.
  if target_requested_by is not null and not exists (
    select 1 from public.memberships m where m.org_id = target_org and m.user_id = target_requested_by
  ) then
    return jsonb_build_object('ok', false, 'code', 'requester_not_in_firm');
  end if;

  select * into task_row from public.ai_tasks where slug = target_task and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_task');
  end if;
  -- A task of a module runs in the version its module pins (0212): the case's version for what is of a case,
  -- the module's latest published for the rest; any other task, and a pin with no such version, in the one in force.
  pinned := public.module_prompt_version(target_task, target_subject_type, target_subject_id);
  if pinned is not null then
    select * into version_row from public.prompt_versions where task = target_task and version = pinned;
    if not found then
      pinned := null;
    end if;
  end if;
  if pinned is null then
    select * into version_row from public.prompt_versions where task = target_task and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'no_prompt_version');
    end if;
  end if;

  if target_idempotency_key is not null then
    select * into existing from public.ai_runs
    where org_id = target_org and idempotency_key = target_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'code', 'existing', 'run_id', existing.id, 'status', existing.status);
    end if;
  end if;

  insert into public.ai_runs (
    org_id, task, prompt_version_id, provider, model, effort, input_hash,
    subject_type, subject_id, idempotency_key, requested_by
  ) values (
    target_org, target_task, version_row.id, version_row.provider, version_row.model, version_row.effort,
    target_input_hash, target_subject_type, target_subject_id, target_idempotency_key, target_requested_by
  )
  on conflict (org_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into new_id;

  if new_id is null then
    -- Lost a race with the same key: the other request owns the run.
    select * into existing from public.ai_runs
    where org_id = target_org and idempotency_key = target_idempotency_key;
    return jsonb_build_object('ok', true, 'code', 'existing', 'run_id', existing.id, 'status', existing.status);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'started',
    'run_id', new_id,
    'prompt', jsonb_build_object(
      'version', version_row.version,
      'provider', version_row.provider,
      'model', version_row.model,
      'effort', version_row.effort,
      'system_prompt', version_row.system_prompt,
      'output_schema', version_row.output_schema,
      'max_tokens', version_row.max_tokens
    )
  );
end;
$$;

revoke all on function public.start_ai_run(uuid, text, text, uuid, text, text, text) from public, anon, authenticated;

-- ---------- The platform's models a piece starts from ----------

create or replace function public.request_case_draft(target_proceeding uuid, target_template uuid, target_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  template public.draft_templates%rowtype;
  replaced uuid;
  draft uuid;
  pinned_piece jsonb;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  -- Read again under the lock of its case: a receipt may have just filed it.
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  if lawsuit.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'already_filed');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;
  if target_mode is null or target_mode not in ('ai', 'blank') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'mode');
  end if;
  -- A model of the case's firm, or of the platform (0045).
  select * into template from public.draft_templates
  where id = target_template and (org_id = current_case.org_id or org_id is null);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'template_not_found', 'field', 'template');
  end if;
  -- The platform's model as the version of the case's module has it (0212): a model edited since reaches only the
  -- cases of a version published after it.
  if template.org_id is null then
    pinned_piece := public.case_module_manifest(current_case.id) -> 'pieces' -> 'templates' -> template.id::text;
    if jsonb_typeof(pinned_piece) = 'object' then
      template.name := coalesce(nullif(pinned_piece ->> 'name', ''), template.name);
      template.body := coalesce(nullif(pinned_piece ->> 'body', ''), template.body);
    end if;
  end if;
  if exists (select 1 from public.case_drafts d where d.proceeding_id = lawsuit.id and d.status = 'approved') then
    return jsonb_build_object('ok', false, 'code', 'draft_being_issued');
  end if;
  if exists (select 1 from public.case_drafts d where d.proceeding_id = lawsuit.id and d.status = 'proposed') then
    return jsonb_build_object('ok', false, 'code', 'draft_in_course');
  end if;

  for replaced in
    select d.id from public.case_drafts d
    where d.proceeding_id = lawsuit.id and d.status in ('generating', 'failed')
    order by d.requested_at, d.id
  loop
    perform public.withdraw_draft_approvals(replaced, 'A peça foi substituída por outra.');
    update public.case_drafts
    set status = 'cancelled', work = null, work_claimed_at = null
    where id = replaced and status in ('generating', 'failed');
    if not found then
      -- Its first text arrived while this request waited for its answer in the queue: it waits for a lawyer
      -- now. Raised, never answered: the answer this request just withdrew goes back to waiting with it.
      raise exception 'draft_in_course' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.case_drafts (
    org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status, work, version, requested_by,
    requested_auto
  ) values (
    current_case.org_id, current_case.id, lawsuit.id, template.id, template.name, template.body, target_mode,
    case target_mode when 'ai' then 'generating' else 'proposed' end,
    case target_mode when 'ai' then 'generate' else 'check' end,
    case target_mode when 'ai' then 0 else 1 end,
    auth.uid(),
    public.case_system_writer(current_case.id)
  )
  returning id into draft;
  if target_mode = 'blank' then
    insert into public.case_draft_versions (org_id, draft_id, version, author, author_id, body)
    values (current_case.org_id, draft, 1, 'template', auth.uid(), template.body);
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'draft_requested',
    public.case_actor(current_case.id),
    jsonb_build_object('draft', draft, 'proceeding', lawsuit.id, 'mode', target_mode));
  return jsonb_build_object('ok', true, 'code', 'requested', 'draft_id', draft);
end;
$$;

create or replace function public.request_intermediate_piece(
  target_proceeding uuid,
  target_kind text,
  target_publication uuid default null,
  target_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  kind public.piece_kinds%rowtype;
  publication public.publications%rowtype;
  step text;
  advice jsonb;
  waits text;
  replaced uuid;
  draft uuid;
  source text := nullif(btrim(coalesce(target_source, '')), '');
  pinned_piece jsonb;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  select * into lawsuit from public.proceedings where id = target_proceeding for update;
  if lawsuit.status <> 'filed' or lawsuit.cnj is null then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;
  select * into kind from public.piece_kinds where slug = target_kind;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if target_publication is not null then
    select * into publication from public.publications
    where id = target_publication and org_id = current_case.org_id and proceeding_id = lawsuit.id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'publication_not_found');
    end if;
  end if;
  if source is not null and source !~ '^(publication|amount):[a-z0-9_-]{3,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'source');
  end if;
  if source is not null and exists (
    select 1 from public.case_drafts d
    where d.proceeding_id = lawsuit.id and d.piece_kind = kind.slug and d.source_key = source
  ) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  if exists (select 1 from public.case_drafts d
             where d.proceeding_id = lawsuit.id and d.piece_kind = kind.slug and d.status in ('proposed', 'approved')) then
    return jsonb_build_object('ok', false, 'code', 'draft_in_course');
  end if;
  for replaced in
    select d.id from public.case_drafts d
    where d.proceeding_id = lawsuit.id and d.piece_kind = kind.slug and d.status in ('generating', 'failed')
  loop
    perform public.withdraw_draft_approvals(replaced, 'A peça foi substituída por outra.');
    update public.case_drafts set status = 'cancelled', work = null, work_claimed_at = null, waits_for = null
    where id = replaced and status in ('generating', 'failed');
  end loop;

  step := case when source like 'amount:%' then split_part(source, ':', 2) end;
  advice := public.piece_recommendation(kind.slug, target_publication, step);
  waits := case when kind.slug = 'replica' and not exists (
    select 1 from public.case_documents cd where cd.case_id = current_case.id and cd.kind = 'defense' and cd.status <> 'rejected'
  ) then 'defense' end;

  -- The platform's model of the kind as the version of the case's module has it (0212).
  pinned_piece := public.case_module_manifest(current_case.id) -> 'pieces' -> 'kinds' -> kind.slug;
  if jsonb_typeof(pinned_piece) = 'object' then
    kind.name := coalesce(nullif(pinned_piece ->> 'name', ''), kind.name);
    kind.model := coalesce(nullif(pinned_piece ->> 'model', ''), kind.model);
  end if;

  insert into public.case_drafts (
    org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status, work, version, requested_by,
    requested_auto, piece_kind, publication_id, source_key, recommendation, recommendation_reason, waits_for
  ) values (
    current_case.org_id, current_case.id, lawsuit.id, null, kind.name, kind.model, 'ai', 'generating',
    case when waits is null then 'generate' end, 0, auth.uid(), public.case_system_writer(current_case.id),
    kind.slug, target_publication, source, advice ->> 'recommendation', left(advice ->> 'reason', 1000), waits
  )
  returning id into draft;
  perform public.record_case_event(current_case.org_id, current_case.id, 'piece_requested', public.case_actor(current_case.id),
    jsonb_build_object('draft', draft, 'proceeding', lawsuit.id, 'kind', kind.slug));
  return jsonb_build_object('ok', true, 'code', 'requested', 'draft_id', draft, 'waits_for', waits);
end;
$$;

-- ---------- What is in force now, and the versions ----------

/** What a version of a module would hold if prepared now. Internal. */
create or replace function public.module_snapshot(target_module text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'documents', coalesce((select s.value -> 'documents_by_problem' from public.platform_settings s where s.key = 'cases'),
                          '{}'::jsonb),
    'prompts', coalesce((
      select jsonb_object_agg(p.task, p.version order by p.task)
      from public.prompt_versions p
      join public.product_modules m on m.key = target_module
      where p.is_active and p.task = any(m.version_tasks)
    ), '{}'::jsonb),
    'pieces', jsonb_build_object(
      'templates', coalesce((
        select jsonb_object_agg(t.id::text, jsonb_build_object(
          'name', t.name, 'body', t.body, 'proceeding_kind', t.proceeding_kind, 'is_default', t.is_default))
        from public.draft_templates t
        where t.org_id is null and t.document_kind = 'piece'
      ), '{}'::jsonb),
      'kinds', coalesce((
        select jsonb_object_agg(k.slug, jsonb_build_object('name', k.name, 'model', k.model)) from public.piece_kinds k
      ), '{}'::jsonb)
    )
  );
$$;

revoke all on function public.module_snapshot(text) from public, anon, authenticated;

/** The modules with their versions, how many cases each holds, and what is in force now, for the operator. */
create or replace function public.admin_module_versions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'modules', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', m.key,
      'name', m.name,
      'tasks', to_jsonb(m.version_tasks),
      'now', public.module_snapshot(m.key),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'version', v.version, 'status', v.status, 'note', v.note, 'manifest', v.manifest,
          'withdraw_reason', v.withdraw_reason, 'created_at', v.created_at, 'published_at', v.published_at,
          'withdrawn_at', v.withdrawn_at,
          'cases', (select count(*) from public.cases c where c.module_version_id = v.id),
          'open_cases', (select count(*) from public.cases c
                         where c.module_version_id = v.id and c.status not in ('closed', 'declined'))
        ) order by v.version desc)
        from public.module_versions v where v.module = m.key
      ), '[]'::jsonb)
    ) order by m.created_at, m.key)
    from public.product_modules m where m.retired_at is null
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.admin_module_versions() from public, anon;
grant execute on function public.admin_module_versions() to authenticated;

/** The operator prepares the next version of a module with what is in force now; a draft there was is replaced. */
create or replace function public.admin_draft_module_version(target_module text, target_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  note_value text := btrim(coalesce(target_note, ''));
  next_version integer;
  drafted uuid;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.product_modules m where m.key = target_module and m.retired_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if char_length(note_value) not between 3 and 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'note');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('module_version:' || target_module, 0));
  delete from public.module_versions where module = target_module and status = 'draft';
  select coalesce(max(v.version), 0) + 1 into next_version from public.module_versions v where v.module = target_module;
  insert into public.module_versions (module, version, status, manifest, note, created_by)
  values (target_module, next_version, 'draft', public.module_snapshot(target_module), note_value, caller)
  returning id into drafted;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.module_version_drafted', 'module_version', drafted::text,
          jsonb_build_object('module', target_module, 'version', next_version));
  return jsonb_build_object('ok', true, 'code', 'drafted', 'id', drafted, 'version', next_version);
end;
$$;

revoke all on function public.admin_draft_module_version(text, text) from public, anon;
grant execute on function public.admin_draft_module_version(text, text) to authenticated;

/** The operator publishes a draft: every case opened from now on is opened under it. */
create or replace function public.admin_publish_module_version(target_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v public.module_versions%rowtype;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v from public.module_versions where id = target_version for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not_a_draft');
  end if;
  update public.module_versions set status = 'published', published_at = now(), published_by = caller
  where id = target_version;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.module_version_published', 'module_version', v.id::text,
          jsonb_build_object('module', v.module, 'version', v.version));
  return jsonb_build_object('ok', true, 'code', 'published', 'version', v.version);
end;
$$;

revoke all on function public.admin_publish_module_version(uuid) from public, anon;
grant execute on function public.admin_publish_module_version(uuid) to authenticated;

/**
 * The operator withdraws a published version for a defect, with the reason: its cases read the latest published
 * from then on. The last published version of a module is never withdrawn: its cases would have none to read.
 */
create or replace function public.admin_withdraw_module_version(target_version uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  reason_value text := btrim(coalesce(target_reason, ''));
  v public.module_versions%rowtype;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(reason_value) not between 3 and 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into v from public.module_versions where id = target_version;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('module_version:' || v.module, 0));
  select * into v from public.module_versions where id = target_version for update;
  if v.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'not_published');
  end if;
  if not exists (select 1 from public.module_versions o
                 where o.module = v.module and o.status = 'published' and o.id <> v.id) then
    return jsonb_build_object('ok', false, 'code', 'last_published');
  end if;
  update public.module_versions
  set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = caller, withdraw_reason = reason_value
  where id = target_version;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.module_version_withdrawn', 'module_version', v.id::text,
          jsonb_build_object('module', v.module, 'version', v.version));
  return jsonb_build_object('ok', true, 'code', 'withdrawn', 'version', v.version);
end;
$$;

revoke all on function public.admin_withdraw_module_version(uuid, text) from public, anon;
grant execute on function public.admin_withdraw_module_version(uuid, text) to authenticated;

/** The operator discards a draft. */
create or replace function public.admin_discard_module_version(target_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v public.module_versions%rowtype;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v from public.module_versions where id = target_version for update;
  if not found or v.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not_a_draft');
  end if;
  delete from public.module_versions where id = target_version;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.module_version_discarded', 'module_version', v.id::text,
          jsonb_build_object('module', v.module, 'version', v.version));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.admin_discard_module_version(uuid) from public, anon;
grant execute on function public.admin_discard_module_version(uuid) to authenticated;

-- ---------- Version 1: what was in force on 2026-11-11 ----------

insert into public.module_versions (module, version, status, manifest, note, published_at)
select m.key, 1, 'published', public.module_snapshot(m.key),
       'Primeira versão: o que estava em vigor em 11/11/2026.', now()
from public.product_modules m
where m.retired_at is null;

update public.cases c set module_version_id = v.id
from public.module_versions v
where v.module = c.module and v.version = 1 and c.module_version_id is null;
