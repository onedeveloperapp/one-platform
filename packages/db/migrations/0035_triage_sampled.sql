-- ============================================================
-- 0035_triage_sampled: the AI's triage of publications, let out of the
-- shadow in the categories where it met its goal, with a sample a person
-- checks, and put back in the shadow the moment a person finds that what it
-- said hid a deadline or a hearing.
--
--   publication_triage_policies  per category of the AI's answer: `shadow`
--                                (the answer is kept beside the
--                                publication and decides nothing, as in
--                                0028) or `sampled` (the answer is the
--                                publication's triage, and one in
--                                `sample_percent` waits for a person to
--                                check it);
--   publications                 what the AI's answer did to each one: it
--                                was applied (`ai_applied`), it waits for
--                                a person's check (`review_due`), who
--                                checked it and when;
--   organizations                whether the firm lets the AI's answer be
--                                its triage at all (a partner decides; off
--                                until one does).
--
-- A category leaves the shadow only by the operator, on the record, and only
-- when its measure met the goal the setting names: of the publications the
-- AI said were of it and a person triaged without the AI's word in front of
-- them, enough of them, nearly all agreeing, and none where a person found a
-- deadline or a hearing the AI had not seen. It goes back to the shadow by
-- itself at the first such miss, whoever finds it and however (a check of
-- the AI's triage, or a person's own triage of a publication the AI also
-- read), in every firm, and every publication of that category the AI
-- triaged and nobody checked in the last days waits for a person again.
--
-- A deadline, a hearing, a decision and a payment never leave the shadow:
-- what follows their triage (the deadline proposed and counted, the hearing
-- kept, the decision read for an appeal, the money told to the client) is a
-- person's work, and a triage nobody saw would leave it undone. What the AI
-- may triage alone is what asks nothing of anybody: a notice, and the rest.
--
-- The answers of the task are still not the firm's to read (`ai_tasks.shadow`,
-- 0016, keeps its runs out of the firm's sight and out of any queue): what a
-- firm sees of a promoted category is the triage itself, said to be the AI's.
-- ============================================================

-- The goal a category must meet to leave the shadow, and how a demotion reaches back.
update public.platform_settings
set value = jsonb_build_object(
    -- The window the measure of a category is read in, by the day each publication was captured.
    'promote_window_days', 90,
    -- The fewest publications a person also triaged before a category may leave the shadow.
    'promote_min_compared', 100,
    -- The share of those where the person said what the AI said, in percent.
    'promote_min_agreed_percent', 97,
    -- How many publications in the window where the person found a deadline or a hearing the AI did not see.
    'promote_max_misses', 0,
    -- The share of the AI's triage that waits for a person's check, when the operator names none.
    'sample_percent', 20,
    -- How many days back a demotion puts the AI's triage nobody checked in front of a person again.
    'review_days', 30
  ) || value
where key = 'publications';

-- ---------- The policy of each category ----------

create table public.publication_triage_policies (
  category text primary key,
  mode text not null default 'shadow',
  sample_percent integer not null default 20,
  note text,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz,
  -- When the category went back to the shadow by itself, at a person's correction that showed a miss.
  demoted_at timestamptz,
  constraint publication_triage_policies_category_check check (
    category in ('prazo', 'audiencia', 'decisao', 'pagamento', 'ciencia', 'outro')
  ),
  constraint publication_triage_policies_mode_check check (mode in ('shadow', 'sampled')),
  constraint publication_triage_policies_sample_check check (sample_percent between 1 and 100),
  constraint publication_triage_policies_note_check check (note is null or char_length(note) <= 1000),
  -- What asks a person for what comes after its triage stays in the shadow (`triage_acting`).
  constraint publication_triage_policies_acting_check check (
    mode = 'shadow' or category not in ('prazo', 'audiencia', 'decisao', 'pagamento')
  )
);

alter table public.publication_triage_policies enable row level security;
-- Every session reads which categories the AI triages: a firm is told what of its publications the AI decided.
-- Only that: the operator's note, who changed it and when it went back are the platform's.
create policy "publication_triage_policies_select_all" on public.publication_triage_policies
  for select to authenticated using (true);
grant select (category, mode, sample_percent) on table public.publication_triage_policies to authenticated;

insert into public.publication_triage_policies (category)
select c from unnest(array['prazo', 'audiencia', 'decisao', 'pagamento', 'ciencia', 'outro']) as c
on conflict (category) do nothing;

-- ---------- What the AI's answer did to each publication, and the firm's word ----------

-- Off until a partner of the firm says the AI's answer may be its triage.
alter table public.organizations add column publication_ai_triage boolean not null default false;

alter table public.publications add column ai_applied boolean not null default false;
alter table public.publications add column review_due boolean not null default false;
alter table public.publications add column reviewed_by uuid references public.profiles (id) on delete set null;
alter table public.publications add column reviewed_at timestamptz;
-- Only the AI's own triage waits for a check, and a check is of a triage.
alter table public.publications add constraint publications_review_check check (
  (not review_due or (ai_applied and category is not null)) and (reviewed_at is null or category is not null)
);

create index publications_review_idx on public.publications (org_id, triaged_at) where review_due and active;
create index publications_applied_idx on public.publications (captured_at)
  where ai_applied and triaged_by is null and not review_due;

-- What the AI's triage did is the firm's to read once it is the publication's triage.
grant select (ai_applied, review_due, reviewed_by, reviewed_at) on table public.publications to authenticated;

update public.ai_tasks set
  name = 'Triagem de publicação',
  description = 'Classifica cada publicação capturada do DJEN: prazo, audiência, decisão, pagamento, ciência ou outro. Em modo sombra a resposta não decide nada e é comparada com a triagem feita por uma pessoa; numa categoria liberada pelo operador, por ter batido a meta de acerto, a resposta é a triagem da publicação, e uma parte delas espera a conferência de uma pessoa.'
where slug = 'publicacao.triagem';

/** True for a category whose triage asks a person for what comes after it: a deadline, a hearing, a decision, a payment. */
create or replace function public.triage_acting(category text)
returns boolean
language sql
immutable
as $$
  select coalesce(category in ('prazo', 'audiencia', 'decisao', 'pagamento'), false);
$$;

revoke all on function public.triage_acting(text) from public, anon, authenticated;

/**
 * True when a person's word shows that the AI's would have hidden what the
 * firm must act on: the person says what asks somebody's work (a deadline, a
 * hearing, a decision, a payment), and the AI said anything else (one of
 * them taken for another asks another work too).
 */
create or replace function public.triage_missed(ai_category text, person_category text)
returns boolean
language sql
immutable
as $$
  select public.triage_acting(person_category) and ai_category is not null
    and ai_category is distinct from person_category;
$$;

revoke all on function public.triage_missed(text, text) from public, anon, authenticated;

/**
 * How the AI's answers of one category fared with the people, in the
 * window of the setting: of the publications the AI said were of it and a
 * person triaged without the AI's word in front of them, how many agreed
 * (a check of the AI's own triage is no comparison: the person read its
 * word first); and how many a person found a deadline or a hearing in,
 * however it was found. What a category is let out of the shadow on.
 */
create or replace function public.triage_category_measure(target_category text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with window_rows as (
    select p.category, p.ai_category, p.ai_applied
    from public.publications p
    where p.ai_category = target_category and p.category is not null and p.triaged_by is not null
      and p.captured_at > now() - make_interval(days => greatest(public.publications_setting('promote_window_days', 90), 1))
  )
  select jsonb_build_object(
    'category', target_category,
    'compared', (select count(*) from window_rows w where not w.ai_applied),
    'agreed', (select count(*) from window_rows w where not w.ai_applied and w.category = w.ai_category),
    'misses', (select count(*) from window_rows w where public.triage_missed(w.ai_category, w.category))
  );
$$;

revoke all on function public.triage_category_measure(text) from public, anon, authenticated;

/**
 * Lets a category of the AI's answer out of the shadow, with the share of it
 * a person checks, or puts it back. Leaving the shadow needs the measure to
 * meet the goal of the setting, said back with the numbers when it does not.
 * The operator only; the note is required (it is where the decision is
 * written down); on the record.
 */
create or replace function public.set_publication_triage_policy(
  target_category text,
  target_mode text,
  target_sample_percent integer,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  before public.publication_triage_policies%rowtype;
  measure jsonb;
  compared integer;
  agreed integer;
  misses integer;
  note_value text := nullif(btrim(coalesce(target_note, '')), '');
  sample integer := coalesce(target_sample_percent, public.publications_setting('sample_percent', 20));
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if note_value is null or char_length(note_value) < 8 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if target_mode is null or target_mode not in ('shadow', 'sampled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  if sample not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  select * into before from public.publication_triage_policies where category = target_category for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_mode = 'sampled' and public.triage_acting(target_category) then
    return jsonb_build_object('ok', false, 'code', 'acting_category');
  end if;
  if target_mode = 'sampled' then
    measure := public.triage_category_measure(target_category);
    compared := (measure ->> 'compared')::integer;
    agreed := (measure ->> 'agreed')::integer;
    misses := (measure ->> 'misses')::integer;
    if compared < greatest(public.publications_setting('promote_min_compared', 100), 1)
       or agreed * 100 < compared * least(greatest(public.publications_setting('promote_min_agreed_percent', 97), 1), 100)
       or misses > greatest(public.publications_setting('promote_max_misses', 0), 0) then
      return jsonb_build_object('ok', false, 'code', 'below_goal', 'measure', measure);
    end if;
  end if;
  update public.publication_triage_policies set
    mode = target_mode,
    sample_percent = sample,
    note = left(note_value, 1000),
    changed_by = caller,
    changed_at = now()
  where category = target_category;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'publications.triage_policy_changed', 'ai_task', 'publicacao.triagem',
    jsonb_strip_nulls(jsonb_build_object('category', target_category, 'from', before.mode, 'to', target_mode,
      'sample_percent', sample, 'measure', measure, 'note', left(note_value, 500))));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_publication_triage_policy(text, text, integer, text) from public, anon;
grant execute on function public.set_publication_triage_policy(text, text, integer, text) to authenticated;

/**
 * A category of the AI's answer back in the shadow, at a miss somebody found
 * (`triage_missed`): in every firm, and what the AI triaged of it and nobody
 * checked in the last days (the setting says how many) waits for a person
 * again. Nothing when the category is in the shadow already. On the record,
 * with who found it (a person, or nobody when the AI's answer came after a
 * person's triage). Called by the functions that find a miss.
 */
create or replace function public.demote_publication_triage(target_category text, target_found text, target_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reopened integer := 0;
begin
  update public.publication_triage_policies
  set mode = 'shadow', demoted_at = now()
  where category = target_category and mode = 'sampled';
  if not found then
    return false;
  end if;
  -- One a person is triaging right now is passed over: it is being looked at, and waiting for it could
  -- meet that person's own demotion the other way round.
  update public.publications p set review_due = true
  where p.id in (
    select q.id from public.publications q
    where q.ai_applied and q.triaged_by is null and not q.review_due and q.active
      and q.category = target_category
      and q.captured_at > now() - make_interval(days => greatest(public.publications_setting('review_days', 30), 1))
    for update skip locked
  );
  get diagnostics reopened = row_count;
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (null, target_actor, case when target_actor is null then 'system' else 'person' end,
    'publications.triage_demoted', 'ai_task', 'publicacao.triagem',
    jsonb_build_object('category', target_category, 'found', target_found, 'reopened', reopened));
  return true;
end;
$$;

revoke all on function public.demote_publication_triage(text, text, uuid) from public, anon, authenticated;

/**
 * A partner says whether the AI's answer may be the firm's triage in the
 * categories the platform let out of the shadow. Off (as a firm starts),
 * every publication of the firm waits for a person, as in the shadow; what
 * the AI already triaged stays as it is. Never a support visit; on the
 * record.
 */
create or replace function public.set_firm_publication_ai_triage(target_org uuid, target_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  before boolean;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(target_org, array['socio']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  select o.publication_ai_triage into before from public.organizations o where o.id = target_org for no key update;
  if before = target_enabled then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.organizations set publication_ai_triage = target_enabled where id = target_org;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'publications.ai_triage_set', 'organization', target_org::text,
    jsonb_build_object('enabled', target_enabled));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_publication_ai_triage(uuid, boolean) from public, anon;
grant execute on function public.set_firm_publication_ai_triage(uuid, boolean) to authenticated;

/**
 * What the AI's triage of a publication came to (replaces the one of 0028).
 *
 *   done      the run's own answer is kept beside the publication (the
 *             database reads it from the run, never from the worker); in a
 *             category let out of the shadow, of a publication nobody
 *             triaged yet, of a firm that lets the AI's answer be its
 *             triage, it is the publication's triage, and one in the
 *             category's share waits for a person's check (decided by the
 *             publication's own id, so the same publication always gives
 *             the same answer). Of a publication a person triaged first, an
 *             answer that would have hidden the deadline or the hearing the
 *             person found puts its category back in the shadow;
 *   retry     a failure that may pass, of this publication's own run: tried
 *             again after a wait, until its attempts are spent;
 *   failed    final for this publication: the model cannot classify it;
 *   released  nothing was learned of this publication (the provider is out,
 *             a key was refused, the task has no instructions): the try does
 *             not count, and it waits before the next. A request the provider
 *             itself refused is counted apart: after as many as the setting
 *             says, it is this publication it refuses, and it is given up.
 *
 * Service role only.
 */
create or replace function public.record_publication_triage(
  target_publication uuid,
  target_claim integer,
  target_outcome text,
  target_run uuid default null,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  run public.ai_runs%rowtype;
  policy public.publication_triage_policies%rowtype;
  tries integer := greatest(public.publications_setting('max_attempts', 3), 1);
  pause integer := greatest(public.publications_setting('retry_minutes', 20), 1);
  rejections integer := greatest(public.publications_setting('max_rejections', 6), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  outcome text := target_outcome;
  said text;
  refused boolean;
  applies boolean := false;
  sampled boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('done', 'retry', 'failed', 'released') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into publication from public.publications where id = target_publication for update;
  if not found or publication.ai_claimed_at is null or publication.ai_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;

  if outcome = 'released' then
    -- The provider refusing the request may be the key or the model (every publication meets the same,
    -- and the operator puts them back once it is put right) or this very publication: refused so many
    -- times, it is given up, so one publication never comes back to the head of the line for ever.
    refused := code = 'provider_rejected' and publication.ai_rejections + 1 >= rejections;
    update public.publications set
      ai_claimed_at = null,
      ai_rejections = ai_rejections + case when code = 'provider_rejected' then 1 else 0 end,
      ai_attempts = case when refused then tries else greatest(ai_attempts - 1, 0) end,
      ai_retry_after = case when refused then null else now() + make_interval(mins => pause) end,
      ai_error = code
    where id = publication.id;
    return jsonb_build_object('ok', true, 'code', case when refused then 'failed' else 'released' end);
  end if;

  if outcome = 'done' then
    select * into run from public.ai_runs r
    where r.id = target_run and r.org_id = publication.org_id and r.task = 'publicacao.triagem'
      and r.subject_type = 'publication' and r.subject_id = publication.id::text;
    if not found or run.status <> 'succeeded' then
      return jsonb_build_object('ok', false, 'code', 'run_not_found');
    end if;
    said := run.output ->> 'categoria';
    if said is null or said not in ('prazo', 'audiencia', 'decisao', 'pagamento', 'ciencia', 'outro') then
      outcome := 'failed';
      code := 'invalid_answer';
    else
      -- Read under the policy's lock: a demotion in course is waited for, so nothing applies after it.
      select * into policy from public.publication_triage_policies where category = said for share;
      applies := policy.mode = 'sampled' and publication.category is null and publication.active
        and coalesce((select o.publication_ai_triage from public.organizations o where o.id = publication.org_id), false);
      -- A hash can be negative: the remainder is brought into 0..99 first.
      sampled := applies
        and mod(mod(hashtextextended(publication.id::text, 7), 100) + 100, 100) < policy.sample_percent;
    end if;
  elsif outcome = 'retry' and publication.ai_attempts >= tries then
    outcome := 'failed';
  end if;

  update public.publications set
    ai_category = case when outcome = 'done' then said else ai_category end,
    ai_urgent = case when outcome = 'done' then coalesce((run.output ->> 'urgente')::boolean, false) else ai_urgent end,
    ai_run_id = case when outcome = 'done' then run.id else ai_run_id end,
    ai_claimed_at = null,
    ai_retry_after = case when outcome = 'retry' then now() + make_interval(mins => pause * publication.ai_attempts) end,
    -- A final failure spends the attempts: the sweep does not pick it again.
    ai_attempts = case when outcome = 'failed' then tries else ai_attempts end,
    ai_error = case when outcome = 'done' then null else code end,
    category = case when applies then said else category end,
    triaged_at = case when applies then now() else triaged_at end,
    ai_applied = ai_applied or applies,
    review_due = case when applies then sampled else review_due end
  where id = publication.id;

  -- A person triaged it first, and what the AI says now would have hidden what the person found.
  if outcome = 'done' and publication.triaged_by is not null and public.triage_missed(said, publication.category) then
    perform public.demote_publication_triage(said, publication.category, null);
  end if;

  if applies then
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (publication.org_id, null, 'ai', 'publication.triaged_by_ai', 'publication', publication.id::text,
      jsonb_build_object('category', said, 'sampled', sampled, 'run', run.id));
    if publication.case_id is not null then
      perform public.record_case_event(publication.org_id, publication.case_id, 'publication_triaged', 'ai',
        jsonb_build_object('publication', publication.id, 'category', said));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'code', outcome, 'applied', applies, 'sampled', sampled);
end;
$$;

revoke all on function public.record_publication_triage(uuid, integer, text, uuid, text) from public, anon, authenticated;

/**
 * A person says what a publication is (replaces the one of 0028). Of one the
 * AI triaged, it is the person's check: the same word confirms it, another
 * corrects it. Whatever the person saw, a word that shows the AI's answer of
 * this publication hid a deadline or a hearing puts the AI's category back
 * in the shadow (`demote_publication_triage`); the person is told only when
 * they were checking the AI's own triage, for the AI's word on a category in
 * the shadow is not the firm's to read. Who signs, or who runs the firm's
 * deadlines; never a support visit.
 */
create or replace function public.triage_publication(
  target_publication uuid,
  target_category text,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  caller uuid := auth.uid();
  note_value text := nullif(btrim(coalesce(target_note, '')), '');
  checking boolean;
  missed boolean;
  demoted boolean := false;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into publication from public.publications where id = target_publication for update;
  if not found or not public.is_org_member(publication.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(publication.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not publication.active then
    return jsonb_build_object('ok', false, 'code', 'cancelled');
  end if;
  if target_category is null or target_category not in ('prazo', 'audiencia', 'decisao', 'pagamento', 'ciencia', 'outro') then
    return jsonb_build_object('ok', false, 'code', 'invalid_category', 'field', 'category');
  end if;
  if char_length(coalesce(note_value, '')) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'note');
  end if;
  -- The AI's triage nobody checked yet: what the person says now is its check.
  checking := publication.ai_applied and publication.triaged_by is null;
  -- The AI's own word on this publication, applied or not, against the person's, when the person says something
  -- new: the same word said again (a note changed) found nothing new.
  missed := publication.category is distinct from target_category
    and public.triage_missed(publication.ai_category, target_category);

  update public.publications
  set category = target_category, note = note_value, triaged_by = caller, triaged_at = now(),
      review_due = false,
      reviewed_by = case when checking then caller else reviewed_by end,
      reviewed_at = case when checking then now() else reviewed_at end
  where id = publication.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (publication.org_id, caller, 'publication.triaged', 'publication', publication.id::text,
    jsonb_strip_nulls(jsonb_build_object('category', target_category, 'previous', publication.category,
      'checked_ai', case when checking then true end)));
  if publication.case_id is not null and publication.category is distinct from target_category then
    perform public.record_case_event(publication.org_id, publication.case_id, 'publication_triaged', 'person',
      jsonb_build_object('publication', publication.id, 'category', target_category));
  end if;

  if missed then
    demoted := public.demote_publication_triage(publication.ai_category, target_category, caller);
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved', 'demoted', checking and demoted);
end;
$$;

revoke all on function public.triage_publication(uuid, text, text) from public, anon;
grant execute on function public.triage_publication(uuid, text, text) to authenticated;

/**
 * How the AI's triage compares with the people's, for the operator
 * (replaces the one of 0028): what it said before, and now by the AI's own
 * category, each with its policy and its measure against the goal. Counts
 * only, across every firm.
 */
create or replace function public.admin_publication_triage_measure(window_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  span integer := least(greatest(coalesce(window_days, 90), 1), 730);
  tries integer := greatest(public.publications_setting('max_attempts', 3), 1);
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with recent as (
      select p.category, p.ai_category, p.ai_attempts, p.active, p.triaged_by, p.ai_applied, p.review_due
      from public.publications p
      where p.captured_at > now() - make_interval(days => span)
    )
    select jsonb_build_object(
      'window_days', span,
      'captured', (select count(*) from recent),
      'classified_by_ai', (select count(*) from recent r where r.ai_category is not null),
      'gave_up', (select count(*) from recent r where r.ai_category is null and r.active and r.ai_attempts >= tries),
      -- A person's triage with no AI's word in front of them: a check of the AI's own triage is counted apart.
      'compared', (select count(*) from recent r
        where r.ai_category is not null and r.category is not null and r.triaged_by is not null and not r.ai_applied),
      'agreed', (select count(*) from recent r
        where r.ai_category is not null and r.triaged_by is not null and not r.ai_applied and r.category = r.ai_category),
      'checked', (select count(*) from recent r where r.ai_applied and r.triaged_by is not null),
      'applied', (select count(*) from recent r where r.ai_applied),
      'waiting_review', (select count(*) from recent r where r.review_due and r.active),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', c.category, 'compared', c.compared, 'agreed', c.agreed) order by c.category)
        from (
          select r.category, count(*) as compared, count(*) filter (where r.ai_category = r.category) as agreed
          from recent r
          where r.ai_category is not null and r.category is not null and r.triaged_by is not null and not r.ai_applied
          group by r.category
        ) c
      ), '[]'::jsonb),
      'goal', jsonb_build_object(
        'window_days', greatest(public.publications_setting('promote_window_days', 90), 1),
        'min_compared', greatest(public.publications_setting('promote_min_compared', 100), 1),
        'min_agreed_percent', least(greatest(public.publications_setting('promote_min_agreed_percent', 97), 1), 100),
        'max_misses', greatest(public.publications_setting('promote_max_misses', 0), 0)
      ),
      'by_ai_category', coalesce((
        select jsonb_agg(public.triage_category_measure(pol.category) || jsonb_build_object(
          'mode', pol.mode, 'sample_percent', pol.sample_percent, 'changed_at', pol.changed_at,
          'demoted_at', pol.demoted_at
        ) order by pol.category)
        from public.publication_triage_policies pol
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_publication_triage_measure(integer) from public, anon;
grant execute on function public.admin_publication_triage_measure(integer) to authenticated;

-- ---------- What needs somebody today ----------

/**
 * What needs somebody of the firm today (replaces the one of 0034), with the
 * AI's triage of publications that waits for a person's check.
 */
create or replace function public.firm_today(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  my_function public.firm_function;
  late_hours integer := greatest(public.publications_setting('late_hours', 24), 1);
  left_days integer := greatest(public.publications_setting('left_out_days', 7), 1);
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
  soon integer := greatest(public.deadlines_setting('soon_days', 3), 0);
  watch integer := greatest(public.deadlines_setting('watch_days', 30), 1);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.firm_function into my_function
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'approvals_mine', (
      select count(*) from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and my_function = any (a.approver_functions)
    ),
    'approvals_waiting', (
      select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'
    ),
    'conversations_waiting', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
    ),
    'conversations_closing', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
        and public.wa_window_open(c.last_inbound_at)
        and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)
    ),
    'sends_failed', (
      select count(*) from public.wa_messages m
      where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours'
    ),
    'documents_to_review', (
      select count(*) from public.case_documents d where d.org_id = target_org and d.status = 'received'
    ),
    'clients_finished', (
      select count(distinct l.case_id) from public.client_links l
      join public.cases c on c.id = l.case_id
      where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
        and c.status in ('intake', 'documents', 'signature')
    ),
    'chronologies_contested', (
      select count(distinct s.case_id) from public.case_statements s
      join public.cases c on c.id = s.case_id
      where s.org_id = target_org and s.chronology_status = 'contested'
        and c.status not in ('closed', 'declined')
    ),
    'complaints_overdue', (
      select count(distinct a.case_id) from public.admin_complaints a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.outcome = 'pending'
        and a.answer_due_on < today
        and c.status not in ('closed', 'declined')
    ),
    'filings_ready', (
      select count(*) from public.filing_packages p
      join public.cases c on c.id = p.case_id
      where p.org_id = target_org and p.status = 'ready' and c.status not in ('closed', 'declined')
    ),
    'drafts_waiting', (
      select count(*) from public.case_drafts d
      join public.cases c on c.id = d.case_id
      join public.proceedings p on p.id = d.proceeding_id
      where d.org_id = target_org and c.status not in ('closed', 'declined') and p.status = 'planned'
        and (
          (d.status = 'proposed' and d.work is distinct from 'revise' and not exists (
            select 1 from public.approvals a where a.run_id = d.run_id and a.status = 'pending'
          ))
          or d.status = 'failed'
          or (d.status = 'approved' and d.work is null)
        )
    ),
    'publications_new', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.category is null and p.active
    ),
    'publications_cancelled', (
      select count(*) from public.publications p where p.org_id = target_org and p.cancel_pending
    ),
    'publications_to_review', (
      select count(*) from public.publications p where p.org_id = target_org and p.review_due and p.active
    ),
    'djen_late', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active
        and coalesce(c.captured_at, c.created_at) < now() - make_interval(hours => late_hours)
    ) + (
      -- A registration no sweep has seen for that long: the reading itself is not running.
      select count(*) from public.oab_registrations r
      join public.memberships m on m.user_id = r.user_id
      where m.org_id = target_org
        and greatest(r.created_at, m.created_at) < now() - make_interval(hours => late_hours)
        and not exists (
          select 1 from public.djen_captures c where c.org_id = m.org_id and c.uf = r.uf and c.number = r.number
        )
    ),
    'djen_incomplete', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active and c.last_skipped > 0
        and c.skipped_at > now() - make_interval(days => left_days)
    ),
    'djen_stopped', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and not c.active and c.user_id is not null
        and exists (
          select 1 from public.proceeding_lawyers pl
          join public.proceedings p on p.id = pl.proceeding_id
          where pl.org_id = c.org_id and pl.user_id = c.user_id and p.status = 'filed'
        )
    ),
    'movements_new', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status <> 'off' and t.unseen_count > 0 and c.status not in ('closed', 'declined')
    ),
    'tracking_failed', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status = 'failed' and t.unseen_count = 0 and c.status not in ('closed', 'declined')
    ),
    'deadlines_to_confirm', (
      select count(*) from public.deadlines d where d.org_id = target_org and d.status = 'proposed'
    ),
    'deadlines_soon', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) between today and today + soon
    ),
    'deadlines_overdue', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) < today
    ),
    'deadlines_review', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and cardinality(public.deadline_review_reasons_of(d.status, d.publication_id, d.confirmed_at,
          d.confirmed_revision, d.revision, d.computed_revision, d.computed_due_on, d.confirmed_against, d.due_on,
          d.count_error, d.count_claimed_at, d.count_attempts)) > 0
    ),
    'publications_without_deadline', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.active and p.category = 'prazo'
        and public.publication_watched_since(p.available_on, p.triaged_at, p.captured_at) >= today - watch
        and not exists (select 1 from public.deadlines d where d.publication_id = p.id)
    ),
    'whatsapp', case
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active') then 'active'
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org) then 'disconnected'
      else 'none'
    end
  );
end;
$$;

revoke all on function public.firm_today(uuid) from public, anon;
grant execute on function public.firm_today(uuid) to authenticated;
