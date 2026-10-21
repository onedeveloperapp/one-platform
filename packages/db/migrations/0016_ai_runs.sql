-- ============================================================
-- 0016_ai_runs: what the platform asks of a model, what the model answered,
-- and the person who decided what to do with the answer.
--
-- AI suggests and records. It never decides a rule (forum, deadline,
-- eligibility are code) and nothing interpretive takes effect before a
-- lawyer of the firm approves it:
--   ai_tasks         what the platform may ask, as data: who approves the
--                    answer and how much autonomy the task has earned;
--   prompt_versions  the exact instructions a run used. A published version
--                    is immutable: a correction is a new version;
--   ai_runs          one call: the task, the prompt version, the model, the
--                    effort, a hash of the input, the output, the cost;
--   approvals        the queue: one row per answer that waits for a person;
--   autonomy_decisions  what ONE may decide alone, and `firm_autonomy` what each
--                    firm chose (by default ONE decides: the owner's decision of
--                    2026-10-14), which decides whether an answer waits.
--
-- The INPUT of a run is never stored, only its hash: it is the firm's own
-- data (a document, a message), which already lives where it belongs.
-- The output is firm data and reads only inside the firm; the platform
-- operator sees counts and cost (0014), never an answer.
--
-- Only the backend starts and finishes a run (the service role, through the
-- functions below, which take the firm). Deciding an approval is a person of
-- the firm, in the function the task names, with the second factor.
-- ============================================================

-- ---------- Tasks ----------

create table public.ai_tasks (
  -- `<area>.<what>`: also what the cost ledger files the spend under (0014).
  slug text primary key,
  name text not null,
  description text,
  -- approval    every answer waits for a person;
  -- sampled     one answer in `sample_percent` waits, the rest take effect;
  -- autonomous  no answer waits.
  -- A task leaves `approval` only by measured accuracy (admin_ai_task_accuracy),
  -- and the operator records the change with a note.
  autonomy text not null default 'approval',
  sample_percent integer not null default 100,
  -- A task in shadow mode watches: no answer of it waits for a person or takes effect, whatever its
  -- autonomy says, and its runs are not the firm's to read (an answer nobody may act on must not be
  -- read as one). What it answers is compared with what people do, by the operator, which is how it
  -- may one day be let out of the shadow, by a migration, on the record.
  shadow boolean not null default false,
  -- An answer of this task may be sent back with what to change in it (`returned`): the task is then
  -- asked again with that answer and the note in front of it, and the new answer waits like the first.
  -- Only for a task whose own code reads the note; an answer of any other is approved or turned down.
  revisable boolean not null default false,
  -- Who in a firm may decide an answer of this task.
  approver_functions public.firm_function[] not null default array['socio', 'advogado']::public.firm_function[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_tasks_slug_check check (slug ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  constraint ai_tasks_name_check check (char_length(btrim(name)) between 2 and 120),
  constraint ai_tasks_autonomy_check check (autonomy in ('approval', 'sampled', 'autonomous')),
  constraint ai_tasks_sample_check check (sample_percent between 1 and 100),
  constraint ai_tasks_approvers_check check (cardinality(approver_functions) > 0)
);

alter table public.ai_tasks enable row level security;

create policy "ai_tasks_select_active" on public.ai_tasks
  for select to authenticated
  using (is_active or public.is_superadmin());

-- Written by set_ai_task_autonomy and by migrations only.
grant select on table public.ai_tasks to authenticated;

create trigger ai_tasks_updated_at
  before update on public.ai_tasks
  for each row execute function public.set_updated_at();

-- ---------- Prompt versions ----------

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  task text not null references public.ai_tasks (slug) on delete restrict,
  version integer not null,
  provider text not null,
  model text not null,
  -- How hard the model is asked to think, when the provider has such a knob.
  effort text,
  system_prompt text not null,
  -- JSON Schema of the answer. A run of this version returns an object that
  -- fits it, never free text.
  output_schema jsonb not null,
  -- The cap of the whole reply. On the models that think before answering,
  -- the thinking is spent from this same cap: too little and the answer is
  -- cut before it is complete (the run fails as `output_truncated`).
  max_tokens integer not null default 2048,
  is_active boolean not null default false,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task, version),
  constraint prompt_versions_version_check check (version > 0),
  constraint prompt_versions_provider_check check (provider in ('anthropic', 'gemini', 'openai', 'openrouter')),
  constraint prompt_versions_effort_check check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  constraint prompt_versions_prompt_check check (char_length(btrim(system_prompt)) between 20 and 60000),
  constraint prompt_versions_schema_check check (jsonb_typeof(output_schema) = 'object'),
  constraint prompt_versions_tokens_check check (max_tokens between 64 and 64000)
);

-- One version in force per task.
create unique index prompt_versions_one_active_idx on public.prompt_versions (task) where is_active;

alter table public.prompt_versions enable row level security;

-- The instructions are the platform's: only its operator reads them. A run
-- names the version it used, which is all a firm needs.
create policy "prompt_versions_select_superadmin" on public.prompt_versions
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.prompt_versions to authenticated;

/**
 * A published version says exactly what was asked of the model in every run
 * that names it. Nothing about it may change afterwards except whether it is
 * the one in force; a correction is the next version.
 */
create or replace function public.guard_prompt_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.ai_runs r where r.prompt_version_id = old.id) then
      raise exception 'prompt_version_in_use' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.task is distinct from old.task
     or new.version is distinct from old.version
     or new.provider is distinct from old.provider
     or new.model is distinct from old.model
     or new.effort is distinct from old.effort
     or new.system_prompt is distinct from old.system_prompt
     or new.output_schema is distinct from old.output_schema
     or new.max_tokens is distinct from old.max_tokens then
    raise exception 'prompt_version_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_prompt_version() from public, anon;

create trigger prompt_versions_guard
  before update or delete on public.prompt_versions
  for each row execute function public.guard_prompt_version();

/**
 * Publishes the next version of a task's instructions and puts it in force.
 * Platform operator only, never from a support visit, audited.
 */
create or replace function public.publish_prompt_version(
  target_task text,
  target_provider text,
  target_model text,
  target_system_prompt text,
  target_output_schema jsonb,
  target_effort text default null,
  target_max_tokens integer default 2048,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  new_id uuid;
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ai_tasks t where t.slug = target_task) then
    raise exception 'unknown_task' using errcode = '22023';
  end if;

  -- One writer per task at a time: the version number is counted.
  perform pg_advisory_xact_lock(hashtextextended('prompt-version:' || target_task, 0));

  select coalesce(max(v.version), 0) + 1 into next_version
  from public.prompt_versions v where v.task = target_task;

  update public.prompt_versions set is_active = false where task = target_task and is_active;

  insert into public.prompt_versions (
    task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note, created_by
  ) values (
    target_task, next_version, target_provider, btrim(target_model), nullif(btrim(target_effort), ''),
    target_system_prompt, target_output_schema, coalesce(target_max_tokens, 2048), true,
    nullif(btrim(target_note), ''), auth.uid()
  )
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, auth.uid(), 'ai.prompt.published', 'prompt_version', new_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'task', target_task, 'version', next_version, 'provider', target_provider, 'model', btrim(target_model),
      'note', nullif(btrim(target_note), '')
    ))
  );

  return jsonb_build_object('ok', true, 'id', new_id, 'version', next_version);
end;
$$;

revoke all on function public.publish_prompt_version(text, text, text, text, jsonb, text, integer, text) from public, anon;
grant execute on function public.publish_prompt_version(text, text, text, text, jsonb, text, integer, text) to authenticated;

/**
 * Changes how much autonomy a task has. The note is required: it is where the
 * measured accuracy that justifies the change is written down.
 */
create or replace function public.set_ai_task_autonomy(
  target_task text,
  target_autonomy text,
  target_sample_percent integer,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before public.ai_tasks%rowtype;
  note text := nullif(btrim(target_note), '');
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if note is null or char_length(note) < 8 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into before from public.ai_tasks where slug = target_task for update;
  if not found then
    raise exception 'unknown_task' using errcode = '22023';
  end if;

  update public.ai_tasks
  set autonomy = target_autonomy,
      sample_percent = case when target_autonomy = 'sampled' then coalesce(target_sample_percent, 10) else 100 end
  where slug = target_task;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, auth.uid(), 'ai.task.autonomy_changed', 'ai_task', target_task,
    jsonb_build_object('from', before.autonomy, 'to', target_autonomy, 'sample_percent', target_sample_percent, 'note', left(note, 500))
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_ai_task_autonomy(text, text, integer, text) from public, anon;
grant execute on function public.set_ai_task_autonomy(text, text, integer, text) to authenticated;

-- ---------- What each firm lets ONE decide alone ----------

-- The decisions ONE may take by itself, as data: each with the ways a firm may choose among (`auto`: ONE
-- decides; `sampled`: ONE decides and a share of its decisions waits for a person's check; `approval`: a
-- person decides, as before) and the platform's default, which is ONE deciding (the owner's decision of
-- 2026-10-14: automation first, and each firm asks for a person where it wants). A decision an AI task takes
-- names it, and its answers wait for a person only as the firm chose (`finish_ai_run`). The operator may hold
-- a decision for every firm (`held`, with the reason): a person decides it everywhere while it is looked into; a
-- decision an AI task takes is also held through the task's own autonomy (`set_ai_task_autonomy` to `approval`,
-- the operator's ceiling of the task), and one with no task only here. Each feature seeds its decision where it
-- is built (0024, 0025, 0026, 0029, 0034).
create table public.autonomy_decisions (
  key text primary key,
  task text references public.ai_tasks (slug) on delete set null,
  position integer not null default 100,
  modes text[] not null,
  default_mode text not null default 'auto',
  held boolean not null default false,
  held_note text,
  held_by uuid references public.profiles (id) on delete set null,
  held_at timestamptz,
  constraint autonomy_decisions_key_check check (key ~ '^[a-z][a-z_]{2,40}$'),
  constraint autonomy_decisions_modes_check check (
    cardinality(modes) between 2 and 3 and modes <@ array['auto', 'sampled', 'approval']
    and 'auto' = any (modes) and 'approval' = any (modes)
  ),
  constraint autonomy_decisions_default_check check (default_mode = any (modes)),
  constraint autonomy_decisions_held_check check (
    held = (held_note is not null) and (held_note is null or char_length(held_note) between 8 and 500)
  )
);

-- A decision is taken by one task at most: `finish_ai_run` reads the decision of a task.
create unique index autonomy_decisions_task_key on public.autonomy_decisions (task) where task is not null;

alter table public.autonomy_decisions enable row level security;
create policy "autonomy_decisions_select_all" on public.autonomy_decisions for select to authenticated using (true);
-- A firm reads what decides its screen; the operator's note and who held a decision are the operator's.
grant select (key, task, position, modes, default_mode, held) on table public.autonomy_decisions to authenticated;

/** What a firm chose for a decision; a decision with no row follows the platform's default. */
create table public.firm_autonomy (
  org_id uuid not null references public.organizations (id) on delete cascade,
  decision text not null references public.autonomy_decisions (key) on delete cascade,
  mode text not null,
  -- For `sampled`: the share of ONE's decisions that waits for a person's check.
  sample_percent integer not null default 20,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (org_id, decision),
  constraint firm_autonomy_mode_check check (mode in ('auto', 'sampled', 'approval')),
  constraint firm_autonomy_sample_check check (sample_percent between 1 and 100)
);

alter table public.firm_autonomy enable row level security;
create policy "firm_autonomy_select_member" on public.firm_autonomy
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_autonomy to authenticated;
create trigger guard_impersonation_firm_autonomy after insert or update or delete on public.firm_autonomy
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Whether the operator holds a decision for every firm: held in the catalog,
 * or, for a decision an AI task takes, the task's own autonomy set to
 * `approval` (the operator's ceiling of the task).
 */
create or replace function public.autonomy_held(target_decision text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.held or exists (
      select 1 from public.ai_tasks t where t.slug = d.task and t.autonomy = 'approval'
    )
    from public.autonomy_decisions d where d.key = target_decision
  ), false);
$$;

revoke all on function public.autonomy_held(text) from public, anon, authenticated;

/**
 * How a decision is taken in a firm now: `approval` while the operator holds
 * it, otherwise what the firm chose, or the platform's default. Null for a
 * decision that does not exist.
 */
create or replace function public.firm_autonomy_mode(target_org uuid, target_decision text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.autonomy_held(d.key) then 'approval' else coalesce(f.mode, d.default_mode) end
  from public.autonomy_decisions d
  left join public.firm_autonomy f on f.org_id = target_org and f.decision = d.key
  where d.key = target_decision;
$$;

revoke all on function public.firm_autonomy_mode(uuid, text) from public, anon, authenticated;

/** The share of ONE's decisions a firm has a person check, for a decision it samples. */
create or replace function public.firm_autonomy_sample(target_org uuid, target_decision text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select f.sample_percent from public.firm_autonomy f where f.org_id = target_org and f.decision = target_decision),
    20
  );
$$;

revoke all on function public.firm_autonomy_sample(uuid, text) from public, anon, authenticated;

/** Each decision ONE may take alone, as the firm has it now, for anybody of the firm. */
create or replace function public.firm_autonomy(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', d.key, 'modes', to_jsonb(d.modes), 'default_mode', d.default_mode, 'held', public.autonomy_held(d.key),
      'chosen', f.mode, 'mode', public.firm_autonomy_mode(target_org, d.key),
      'sample_percent', coalesce(f.sample_percent, 20), 'changed_by', f.changed_by, 'changed_at', f.changed_at
    ) order by d.position, d.key)
    from public.autonomy_decisions d
    left join public.firm_autonomy f on f.org_id = target_org and f.decision = d.key
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_autonomy(uuid) from public, anon;
grant execute on function public.firm_autonomy(uuid) to authenticated;

/**
 * A partner of the firm chooses how a decision is taken: by ONE, by ONE with
 * a share checked by a person, or by a person. With the second factor, on
 * the record, never from a support visit. What ONE already decided stays.
 */
create or replace function public.set_firm_autonomy(
  target_org uuid,
  target_decision text,
  target_mode text,
  target_sample_percent integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen public.autonomy_decisions%rowtype;
  before text;
  sample integer := coalesce(target_sample_percent, 20);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.has_firm_function(target_org, array['socio']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_partner');
  end if;
  select * into chosen from public.autonomy_decisions d where d.key = target_decision;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'decision_not_found');
  end if;
  if target_mode is null or not (target_mode = any (chosen.modes)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_mode');
  end if;
  if sample not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_sample');
  end if;
  perform public.require_aal2();
  before := coalesce(
    (select f.mode from public.firm_autonomy f where f.org_id = target_org and f.decision = target_decision),
    chosen.default_mode
  );
  insert into public.firm_autonomy as f (org_id, decision, mode, sample_percent, changed_by)
  values (target_org, target_decision, target_mode, sample, auth.uid())
  on conflict (org_id, decision) do update set
    mode = excluded.mode, sample_percent = excluded.sample_percent, changed_by = excluded.changed_by, changed_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'autonomy.set', 'autonomy_decision', target_decision,
    jsonb_strip_nulls(jsonb_build_object('from', before, 'to', target_mode,
      'sample_percent', case when target_mode = 'sampled' then sample end)));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_autonomy(uuid, text, text, integer) from public, anon;
grant execute on function public.set_firm_autonomy(uuid, text, text, integer) to authenticated;

/** The operator holds a decision for every firm (a person decides it everywhere), with the reason, or lets it go. */
create or replace function public.admin_set_autonomy_hold(target_decision text, target_held boolean, target_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  note_value text := nullif(btrim(coalesce(target_note, '')), '');
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_held is null or (target_held and (note_value is null or char_length(note_value) not between 8 and 500)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  update public.autonomy_decisions set
    held = target_held,
    held_note = case when target_held then note_value end,
    held_by = case when target_held then caller end,
    held_at = case when target_held then now() end
  where key = target_decision;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.autonomy.' || case when target_held then 'held' else 'released' end,
    'autonomy_decision', target_decision, jsonb_strip_nulls(jsonb_build_object('note', note_value)));
  return jsonb_build_object('ok', true, 'code', case when target_held then 'held' else 'released' end);
end;
$$;

revoke all on function public.admin_set_autonomy_hold(text, boolean, text) from public, anon;
grant execute on function public.admin_set_autonomy_hold(text, boolean, text) to authenticated;

/** The catalog as the operator reads it, the reasons of the holds included. */
create or replace function public.admin_autonomy_catalog()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', d.key, 'task', d.task, 'held', d.held, 'held_note', d.held_note, 'held_at', d.held_at,
      'task_held', exists (select 1 from public.ai_tasks t where t.slug = d.task and t.autonomy = 'approval')
    ) order by d.position, d.key)
    from public.autonomy_decisions d
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_autonomy_catalog() from public, anon;
grant execute on function public.admin_autonomy_catalog() to authenticated;

-- ---------- Runs ----------

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task text not null references public.ai_tasks (slug) on delete restrict,
  prompt_version_id uuid not null references public.prompt_versions (id) on delete restrict,
  -- Copied from the version when the run starts, and the model corrected to the
  -- one that actually answered when it finishes.
  provider text not null,
  model text not null,
  effort text,
  -- SHA-256 of the input, in hex. The input itself is not kept here.
  input_hash text not null,
  -- What the run is about (a document, a message), for the screen that shows it.
  subject_type text,
  subject_id text,
  -- The same request made twice (a retry, a job that ran again) is one run.
  idempotency_key text,
  -- The person who asked, when a person did. NULL for a job.
  requested_by uuid references public.profiles (id) on delete set null,
  status text not null default 'running',
  output jsonb,
  error_code text,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd_micros bigint not null default 0,
  priced boolean not null default false,
  spend_id uuid references public.ai_spend (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ai_runs_status_check check (status in ('running', 'succeeded', 'failed', 'blocked')),
  constraint ai_runs_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint ai_runs_subject_check check (
    (subject_type is null and subject_id is null)
    or (subject_type ~ '^[a-z][a-z0-9_]{1,39}$' and char_length(subject_id) between 1 and 80)
  ),
  constraint ai_runs_idempotency_check check (idempotency_key is null or char_length(idempotency_key) between 8 and 120),
  constraint ai_runs_finished_check check ((status = 'running') = (finished_at is null))
);

create index ai_runs_org_idx on public.ai_runs (org_id, started_at desc);
create index ai_runs_subject_idx on public.ai_runs (org_id, subject_type, subject_id) where subject_type is not null;
create unique index ai_runs_idempotency_idx on public.ai_runs (org_id, idempotency_key) where idempotency_key is not null;
-- What the sweep reads: the few runs still open, oldest first.
create index ai_runs_running_idx on public.ai_runs (started_at) where status = 'running';

alter table public.ai_runs enable row level security;

/** True for a task in shadow mode. Read by the policy below, whoever may read the catalog of tasks. */
create or replace function public.ai_task_is_shadow(target_task text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select t.shadow from public.ai_tasks t where t.slug = target_task), false);
$$;

revoke all on function public.ai_task_is_shadow(text) from public, anon;
grant execute on function public.ai_task_is_shadow(text) to authenticated;

-- The firm reads its own runs, except the ones of a task in shadow mode: what such a task answered
-- is kept for the comparison and is nobody's to act on. Not the platform operator either: an
-- answer is about a client of the firm.
create policy "ai_runs_select_member" on public.ai_runs
  for select to authenticated
  using (public.is_org_member(org_id) and not public.ai_task_is_shadow(task));

grant select on table public.ai_runs to authenticated;

-- ---------- The approval queue ----------

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null unique references public.ai_runs (id) on delete cascade,
  task text not null references public.ai_tasks (slug) on delete restrict,
  -- Who may decide, as it was when the answer entered the queue.
  approver_functions public.firm_function[] not null,
  -- pending   waits for a person;
  -- approved  takes effect, as the model gave it or as the person corrected it;
  -- rejected  turned down, with the reason;
  -- returned  sent back with what to change (`decision_note`): the task is asked again, and what it
  --           answers then is another run, with its own row here.
  status text not null default 'pending',
  -- What takes effect: the answer as the model gave it, or as the person
  -- corrected it before approving. NULL while pending, when rejected and when sent back.
  final_output jsonb,
  -- The person changed the answer before approving: what the accuracy counts.
  edited boolean not null default false,
  -- Decided by ONE where the firm lets it (a piece's first text, 0029): no person, and no part of the measure.
  decided_auto boolean not null default false,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'returned')),
  constraint approvals_decided_check check ((status = 'pending') = (decided_at is null)),
  constraint approvals_output_check check ((status = 'approved') = (final_output is not null)),
  constraint approvals_note_check check (decision_note is null or char_length(decision_note) <= 2000)
);

create index approvals_queue_idx on public.approvals (org_id, created_at) where status = 'pending';
create index approvals_org_idx on public.approvals (org_id, created_at desc);

alter table public.approvals enable row level security;

create policy "approvals_select_member" on public.approvals
  for select to authenticated
  using (public.is_org_member(org_id));

-- Read-only for the API roles: an answer is decided by decide_approval only.
grant select on table public.approvals to authenticated;

/**
 * The versions of an answer in the queue keep who decided it, how and when,
 * never what was decided: the answer as approved (a whole piece of a lawsuit,
 * the order of a client's account) and the words of a decision (why it was
 * turned down, what a lawyer asked to change) are about a client of the firm.
 * A row version is read by the platform operator and outlives its row; the
 * firm reads the answer and the note where they are, in the queue itself.
 */
create or replace function public.audit_approval_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
begin
  if tg_op = 'DELETE' then
    snapshot := to_jsonb(old);
  else
    snapshot := to_jsonb(new);
  end if;
  insert into public.record_versions (table_name, record_id, org_id, operation, data, changed_by)
  values (
    tg_table_name, (snapshot ->> 'id')::uuid, (snapshot ->> 'org_id')::uuid, tg_op,
    (snapshot - 'final_output' - 'decision_note')
      || jsonb_build_object('withheld', jsonb_build_array('final_output', 'decision_note')),
    auth.uid()
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_approval_version() from public, anon, authenticated;

create trigger audit_row_versions after insert or update or delete on public.approvals
  for each row execute function public.audit_approval_version();

-- A support visit decides nothing in a firm's name.
create trigger guard_impersonation_approvals
  after insert or update or delete on public.approvals
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Starting and finishing a run (the backend) ----------

/**
 * Starts a run of a task for a firm and hands back the instructions in force.
 * Service role only. The same idempotency key returns the run that already
 * exists instead of starting a second one.
 */
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
  select * into version_row from public.prompt_versions where task = target_task and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_prompt_version');
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

/**
 * Closes a run: records what it consumed in the cost ledger of its firm and,
 * when it succeeded and the task asks for it, puts the answer in the firm's
 * approval queue. Service role only; a run is finished once, and the answer
 * always says the status the record has, which is not the one asked for when
 * the run was already closed.
 *
 * `sampled` decides from the run's own id, so the same run always gives the
 * same answer and nothing is left to chance at a retry.
 */
create or replace function public.finish_ai_run(
  target_run uuid,
  target_status text,
  target_output jsonb default null,
  target_tokens_in bigint default 0,
  target_tokens_out bigint default 0,
  target_model text default null,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run public.ai_runs%rowtype;
  task_row public.ai_tasks%rowtype;
  served_model text;
  used_in bigint := greatest(coalesce(target_tokens_in, 0), 0);
  used_out bigint := greatest(coalesce(target_tokens_out, 0), 0);
  cost_micros bigint := 0;
  cost_priced boolean := false;
  spend uuid;
  approval uuid;
  waits boolean := false;
  decision_key text;
  firm_mode text;
  share integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_status not in ('succeeded', 'failed', 'blocked') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if target_status = 'succeeded' and (target_output is null or jsonb_typeof(target_output) <> 'object') then
    raise exception 'output_required' using errcode = '22023';
  end if;

  select * into run from public.ai_runs where id = target_run for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'run_not_found');
  end if;

  served_model := coalesce(nullif(btrim(target_model), ''), run.model);

  -- A call that reached the provider cost something whatever came of it. That
  -- includes the call that lands after the sweep gave its run up as abandoned:
  -- the answer is discarded then, what it consumed is still the firm's cost.
  if (used_in > 0 or used_out > 0) and run.spend_id is null
     and (run.status = 'running' or run.error_code = 'abandoned') then
    select c.cost_usd_micros, c.priced into cost_micros, cost_priced
    from public.ai_spend_cost(served_model, used_in, used_out) c;

    insert into public.ai_spend (
      org_id, feature, provider, model, tokens_in, tokens_out, cost_usd_micros, priced, ref_id, created_by
    ) values (
      run.org_id, run.task, run.provider, served_model, used_in, used_out,
      cost_micros, cost_priced, run.id, run.requested_by
    )
    returning id into spend;
  end if;

  if run.status <> 'running' then
    if spend is not null then
      update public.ai_runs set
        model = served_model,
        tokens_in = used_in,
        tokens_out = used_out,
        cost_usd_micros = cost_micros,
        priced = cost_priced,
        spend_id = spend
      where id = run.id;
    else
      cost_micros := run.cost_usd_micros;
      cost_priced := run.priced;
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'already_finished', 'status', run.status,
      'approval_id', (select a.id from public.approvals a where a.run_id = run.id),
      'cost_usd_micros', cost_micros,
      'priced', cost_priced
    );
  end if;

  update public.ai_runs set
    status = target_status,
    model = served_model,
    output = case when target_status = 'succeeded' then target_output end,
    error_code = case when target_status <> 'succeeded' then left(coalesce(nullif(btrim(target_error_code), ''), 'failed'), 80) end,
    tokens_in = used_in,
    tokens_out = used_out,
    cost_usd_micros = cost_micros,
    priced = cost_priced,
    spend_id = spend,
    finished_at = now()
  where id = run.id;

  if target_status = 'succeeded' then
    select * into task_row from public.ai_tasks where slug = run.task;
    -- What the firm lets ONE decide alone, for a task that takes one of those decisions.
    select d.key into decision_key from public.autonomy_decisions d where d.task = run.task;
    firm_mode := case when decision_key is not null then public.firm_autonomy_mode(run.org_id, decision_key) end;
    -- The share of answers checked: the larger of the firm's and the operator's, where each samples.
    share := greatest(
      case when firm_mode = 'sampled' then public.firm_autonomy_sample(run.org_id, decision_key) else 0 end,
      case when task_row.autonomy = 'sampled' then task_row.sample_percent else 0 end
    );
    waits := case
      -- A task in shadow mode asks nobody anything, whatever its autonomy is set to.
      when task_row.shadow then false
      -- The operator holds the task for every firm, or the firm wants a person to decide.
      when task_row.autonomy = 'approval' or firm_mode = 'approval' then true
      -- A hash can be negative: the remainder is brought into 0..99 first.
      when share > 0 then mod(mod(hashtextextended(run.id::text, 0), 100) + 100, 100) < share
      else false
    end;
    if waits then
      insert into public.approvals (org_id, run_id, task, approver_functions)
      values (run.org_id, run.id, run.task, task_row.approver_functions)
      returning id into approval;
      -- A trigger of a task may enter the answer already withdrawn (0024: its document was decided, or
      -- another check of it waits): it waits for nobody.
      waits := exists (select 1 from public.approvals a where a.id = approval and a.status = 'pending');
      if not waits then
        approval := null;
      end if;
    end if;
  end if;

  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    run.org_id, run.requested_by, 'ai', 'ai.run.' || target_status, 'ai_run', run.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'task', run.task,
      'model', served_model,
      'awaits_approval', waits,
      'error_code', case when target_status <> 'succeeded' then left(coalesce(nullif(btrim(target_error_code), ''), 'failed'), 80) end
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'finished',
    'status', target_status,
    'approval_id', approval,
    'cost_usd_micros', cost_micros,
    'priced', cost_priced
  );
end;
$$;

revoke all on function public.finish_ai_run(uuid, text, jsonb, bigint, bigint, text, text) from public, anon, authenticated;

/**
 * Gives up the runs that started and were never finished: the process that
 * asked the model stopped before it could record what came of it. Left alone,
 * such a run would stay `running` for ever and hold its idempotency key.
 *
 * Service role only (the maintenance job). What is stale is recomputed from
 * the data on each sweep, and how long a run may take is configuration:
 * `platform_settings` key `ai_runs`, `stale_after_minutes`.
 */
create or replace function public.expire_stale_ai_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  span integer;
  given_up integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select least(greatest(coalesce((s.value ->> 'stale_after_minutes')::integer, 30), 5), 1440) into span
  from public.platform_settings s where s.key = 'ai_runs';
  span := coalesce(span, 30);

  with stale as (
    select r.id
    from public.ai_runs r
    where r.status = 'running' and r.started_at < now() - make_interval(mins => span)
    order by r.started_at
    limit 500
    for update skip locked
  ),
  closed as (
    update public.ai_runs r
    set status = 'failed', error_code = 'abandoned', finished_at = now()
    from stale
    where r.id = stale.id
    returning r.id, r.org_id, r.task
  ),
  audited as (
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    select c.org_id, null, 'system', 'ai.run.failed', 'ai_run', c.id::text,
           jsonb_build_object('task', c.task, 'error_code', 'abandoned')
    from closed c
    returning 1
  )
  select count(*)::integer into given_up from audited;

  return given_up;
end;
$$;

revoke all on function public.expire_stale_ai_runs() from public, anon, authenticated;

insert into public.platform_settings (key, value, is_public)
values ('ai_runs', '{"stale_after_minutes": 30}'::jsonb, false)
on conflict (key) do nothing;

-- ---------- Deciding an answer (a person of the firm) ----------

/**
 * Approves an answer that waits in the queue of the caller's firm, turns it
 * down, or sends it back with what to change.
 *
 * Who decides: a person of the firm whose function the task names. With the
 * second factor, never from a support visit, once. Approving with a
 * `target_final_output` different from what the model gave is an approval of
 * the CORRECTED answer, counted as edited: that is what the accuracy of a
 * task is measured by.
 *
 * Sent back (`returned`), an answer takes no effect: the note says what to
 * change, the task is asked again by what the answer is about (a trigger of
 * the task, which may refuse it), and what it answers then waits here as
 * another answer. Only for a task that reads the note (`ai_tasks.revisable`).
 */
create or replace function public.decide_approval(
  target_approval uuid,
  target_decision text,
  target_final_output jsonb default null,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  approval public.approvals%rowtype;
  run public.ai_runs%rowtype;
  note text := nullif(btrim(target_note), '');
  final jsonb;
  was_edited boolean := false;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if target_decision is null or target_decision not in ('approved', 'rejected', 'returned') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into approval from public.approvals where id = target_approval for update;
  -- The same answer for one that does not exist and one of another firm.
  if not found or not public.is_org_member(approval.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(approval.org_id, approval.approver_functions) then
    return jsonb_build_object('ok', false, 'code', 'not_an_approver');
  end if;
  perform public.require_aal2();

  if approval.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_decided', 'status', approval.status);
  end if;
  if target_decision in ('rejected', 'returned') and note is null then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  if target_decision = 'returned'
     and not coalesce((select t.revisable from public.ai_tasks t where t.slug = approval.task), false) then
    return jsonb_build_object('ok', false, 'code', 'not_revisable');
  end if;

  select * into run from public.ai_runs where id = approval.run_id;

  if target_decision = 'approved' then
    final := coalesce(target_final_output, run.output);
    if final is null or jsonb_typeof(final) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'invalid_output');
    end if;
    -- A correction changes what the answer SAYS, never its shape: the same
    -- fields as the model gave, each of the same kind (a field the model left
    -- empty may be filled in, and one may be emptied). What reads the approved
    -- answer afterwards counts on that shape, and nothing may be slipped into
    -- it under a lawyer's approval.
    if final is distinct from run.output then
      if octet_length(final::text) > 200000
         or exists (select 1 from jsonb_object_keys(final) as given (key) where not run.output ? given.key)
         or exists (
           select 1 from jsonb_each(run.output) as original (key, value)
           where not final ? original.key
              or (
                jsonb_typeof(final -> original.key) <> jsonb_typeof(original.value)
                and jsonb_typeof(final -> original.key) <> 'null'
                and jsonb_typeof(original.value) <> 'null'
              )
         ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_output');
      end if;
      was_edited := true;
    end if;
  end if;

  update public.approvals set
    status = target_decision,
    final_output = final,
    edited = was_edited,
    decided_by = caller,
    decided_at = now(),
    decision_note = left(note, 2000)
  where id = approval.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    approval.org_id, caller, 'ai.approval.' || target_decision, 'approval', approval.id::text,
    jsonb_build_object('task', approval.task, 'run_id', approval.run_id, 'edited', was_edited)
  );

  return jsonb_build_object('ok', true, 'code', target_decision, 'edited', was_edited);
end;
$$;

revoke all on function public.decide_approval(uuid, text, jsonb, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, jsonb, text) to authenticated;

-- ---------- What the operator reads ----------

/**
 * How the answers of each task fared with the people who decided them, in a
 * window of days: the measure a task's autonomy is granted on. Counts only,
 * across every firm: no answer and no firm is named.
 */
create or replace function public.admin_ai_task_accuracy(window_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  span integer := least(greatest(coalesce(window_days, 90), 1), 730);
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_data order by row_data ->> 'task'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'task', t.slug,
      'name', t.name,
      'autonomy', t.autonomy,
      'shadow', t.shadow,
      'samplePercent', t.sample_percent,
      'approvers', to_jsonb(t.approver_functions),
      'activeVersion', (select v.version from public.prompt_versions v where v.task = t.slug and v.is_active),
      'provider', (select v.provider from public.prompt_versions v where v.task = t.slug and v.is_active),
      'model', (select v.model from public.prompt_versions v where v.task = t.slug and v.is_active),
      'runs', (
        select count(*) from public.ai_runs r
        where r.task = t.slug and r.started_at > now() - make_interval(days => span)
      ),
      'succeeded', (
        select count(*) from public.ai_runs r
        where r.task = t.slug and r.status = 'succeeded' and r.started_at > now() - make_interval(days => span)
      ),
      'failed', (
        select count(*) from public.ai_runs r
        where r.task = t.slug and r.status in ('failed', 'blocked') and r.started_at > now() - make_interval(days => span)
      ),
      'pending', (
        select count(*) from public.approvals a where a.task = t.slug and a.status = 'pending'
      ),
      -- What a person decided: an answer ONE decided where the firm lets it is no measure of the task.
      'approved', (
        select count(*) from public.approvals a
        where a.task = t.slug and a.status = 'approved' and not a.edited and not a.decided_auto
          and a.decided_at > now() - make_interval(days => span)
      ),
      'approvedEdited', (
        select count(*) from public.approvals a
        where a.task = t.slug and a.status = 'approved' and a.edited
          and a.decided_at > now() - make_interval(days => span)
      ),
      'rejected', (
        select count(*) from public.approvals a
        where a.task = t.slug and a.status = 'rejected'
          and a.decided_at > now() - make_interval(days => span)
      ),
      -- Sent back with what to change: an answer that was not good as it came, like a corrected one.
      'returned', (
        select count(*) from public.approvals a
        where a.task = t.slug and a.status = 'returned'
          and a.decided_at > now() - make_interval(days => span)
      ),
      'revisable', t.revisable
    ) as row_data
    from public.ai_tasks t
  ) tasks;

  return jsonb_build_object('generatedAt', now(), 'windowDays', span, 'tasks', result);
end;
$$;

revoke all on function public.admin_ai_task_accuracy(integer) from public, anon;
grant execute on function public.admin_ai_task_accuracy(integer) to authenticated;

-- ---------- The first task ----------

-- A task with nothing of a client in it: the operator runs it for a firm to
-- see the whole path work (the instructions, the model, the cost, the queue
-- and a lawyer's decision) before any task of the product depends on it.
insert into public.ai_tasks (slug, name, description, autonomy, approver_functions) values
  (
    'plataforma.verificacao',
    'Verificação do executor de IA',
    'Uma pergunta fixa, sem dado de cliente, para conferir que a execução, o custo e a fila de aprovação funcionam no escritório.',
    'approval',
    array['socio', 'advogado']::public.firm_function[]
  )
on conflict (slug) do nothing;

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'plataforma.verificacao', 1, 'anthropic', 'claude-opus-5-5', 'low',
  'Você é o executor de tarefas do ONE, um software para escritórios de advocacia. Esta é uma verificação técnica, sem nenhum dado de cliente. Responda em português do Brasil, em uma frase curta, confirmando que recebeu a pergunta, e diga o nome da tarefa que foi pedida.',
  '{"type": "object", "additionalProperties": false, "required": ["resposta", "tarefa"], "properties": {"resposta": {"type": "string", "description": "Uma frase curta em português confirmando o recebimento."}, "tarefa": {"type": "string", "description": "O nome da tarefa pedida."}}}'::jsonb,
  2048, true, 'Versão inicial.'
where not exists (select 1 from public.prompt_versions v where v.task = 'plataforma.verificacao');
