-- ============================================================
-- 0034_deadlines: the deadlines of the firm's lawsuits, counted by the rule
-- over each court's forensic calendar, and confirmed by a person.
--
--   court_calendar_years  the years of a court's calendar somebody checked
--                         against the court's acts: where they were read,
--                         and whose comarcas' own days they hold;
--   court_calendar_days   the days a court had no business, suspended the
--                         terms or had partial business, for every lawsuit
--                         of the court or for a kind of lawsuit, a system or
--                         some comarcas;
--   deadline_acts         the acts a term is usually set for, with the days
--                         the law gives them: where a person starts from,
--                         never a decision;
--   deadlines             the firm's: what is to be done, of which lawsuit,
--                         from what day and in how many days; what the rule
--                         counted (`@flyee/rules/deadlines`, written by the
--                         backend that ran it, never by a person); and what
--                         the person who confirmed it said.
--
-- The rule counts and a person confirms. A deadline the rule counted waits
-- in the queue of who runs the firm's deadlines (a partner or the
-- controladoria), who confirms the day the rule gave, or another one with a
-- reason. The rule never gives a day later than the true one and says what
-- it could not know. The calendar is the platform's, kept by its operator
-- from the courts' acts: a change in it has the open deadlines of that court
-- whose count goes through the days that changed counted again, and a
-- confirmed deadline whose count changed is shown to the firm, never changed
-- under it. What a person is asked to look at again (a publication the court
-- took back, a count that changed, a count that could not be made) stops
-- being asked once who runs the deadlines confirmed the deadline knowing it.
-- A publication somebody triaged as a deadline and no deadline came from is
-- shown to who runs the deadlines, so none is lost between the two steps.
-- ============================================================

insert into public.platform_settings (key, value, is_public) values
  ('deadlines', jsonb_build_object(
    -- A deadline due within this many days is due soon: the firm's home counts it.
    'soon_days', 3,
    -- A count claimed and not finished for this long goes back to the line.
    'working_minutes', 10,
    -- How many times in a row a count is tried before it waits for a person.
    'max_attempts', 3,
    -- After a passing failure, the wait before the next attempt, times the attempt.
    'retry_minutes', 10,
    -- The most deadlines open at once of one publication or of one lawsuit: more is a mistake, not a term.
    'max_open', 20,
    -- For how many days after it was triaged (or made available, when that came later) a publication triaged
    -- as a deadline with no deadline proposed from it is shown to who runs the deadlines: longer than the
    -- longest usual term with the year's-end suspension in it.
    'watch_days', 60
  ), true)
on conflict (key) do nothing;

/** A setting of the deadlines, or its default: also when what is written there is not a number. */
create or replace function public.deadlines_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> setting ~ '^[0-9]{1,9}$' then (s.value ->> setting)::integer end
     from public.platform_settings s where s.key = 'deadlines'),
    fallback
  );
$$;

revoke all on function public.deadlines_setting(text, integer) from public, anon, authenticated;

/** Names of comarcas as a calendar keeps them: trimmed, of a sensible length, no control character, not too many. */
create or replace function public.calendar_names_ok(names text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(n = btrim(n) and char_length(n) between 2 and 120 and n !~ '[[:cntrl:]]'), true)
         and coalesce(cardinality(names), 0) <= 400
  from unnest(names) as n;
$$;

revoke all on function public.calendar_names_ok(text[]) from public, anon, authenticated;

-- ---------- The forensic calendar ----------

create table public.court_calendar_years (
  court text not null references public.courts (acronym) on delete cascade,
  year integer not null,
  -- Where the calendar was read: the court's act, or its page of holidays.
  source_url text not null,
  source_title text,
  -- The calendar holds the own days of every comarca of the court (their local holidays included);
  -- otherwise, of the comarcas named only.
  all_comarcas boolean not null default false,
  comarcas text[] not null default '{}',
  -- The day somebody checked it against the court's act, and what it does not hold.
  checked_on date not null,
  note text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (court, year),
  constraint court_calendar_years_year_check check (year between 2019 and 2100),
  constraint court_calendar_years_source_check check (source_url ~* '^https://' and char_length(source_url) <= 500),
  constraint court_calendar_years_title_check check (source_title is null or char_length(btrim(source_title)) between 2 and 200),
  constraint court_calendar_years_comarcas_check check (public.calendar_names_ok(comarcas)),
  constraint court_calendar_years_note_check check (note is null or char_length(note) <= 2000)
);

alter table public.court_calendar_years enable row level security;
create policy "court_calendar_years_select_all" on public.court_calendar_years
  for select to authenticated using (true);
grant select on table public.court_calendar_years to authenticated;

create table public.court_calendar_days (
  id uuid primary key default gen_random_uuid(),
  court text not null references public.courts (acronym) on delete cascade,
  day date not null,
  -- closed     no forensic business: a holiday of the court or of a comarca, a recess, a day off decreed;
  -- partial    business started late or ended early, or the electronic system was unavailable
  --            (CPC, art. 224, par. 1): a last day on it moves to the next business day;
  -- suspended  the court suspended the terms, with business or without.
  kind text not null,
  -- What the court's act calls it: "Carnaval", "Ponto facultativo".
  label text not null,
  -- Who it applies to: empty is every lawsuit of the court.
  proceeding_kinds text[] not null default '{}',
  systems text[] not null default '{}',
  comarcas text[] not null default '{}',
  -- Where it was read, when not in the source of its year (an act decreed during the year).
  source_url text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (court, day, kind, label),
  constraint court_calendar_days_day_check check (day between date '2019-01-01' and date '2100-12-31'),
  constraint court_calendar_days_kind_check check (kind in ('closed', 'partial', 'suspended')),
  constraint court_calendar_days_label_check check (
    label = btrim(label) and char_length(label) between 2 and 120 and label !~ '[[:cntrl:]]'
  ),
  constraint court_calendar_days_kinds_check check (proceeding_kinds <@ array['juizado', 'comum']::text[]),
  constraint court_calendar_days_systems_check check (systems <@ array['projudi', 'eproc', 'pje', 'esaj', 'outro']::text[]),
  constraint court_calendar_days_comarcas_check check (public.calendar_names_ok(comarcas)),
  constraint court_calendar_days_source_check check (
    source_url is null or (source_url ~* '^https://' and char_length(source_url) <= 500)
  )
);

create index court_calendar_days_court_idx on public.court_calendar_days (court, day);

alter table public.court_calendar_days enable row level security;
create policy "court_calendar_days_select_all" on public.court_calendar_days
  for select to authenticated using (true);
grant select on table public.court_calendar_days to authenticated;

-- ---------- The acts a term is usually set for ----------

create table public.deadline_acts (
  slug text primary key,
  name text not null,
  days integer not null,
  counting text not null default 'business',
  -- The kinds of lawsuit the act is of: empty is both.
  proceeding_kinds text[] not null default '{}',
  -- The law that gives the term.
  basis text not null,
  position integer not null default 100,
  active boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint deadline_acts_slug_check check (slug ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint deadline_acts_name_check check (name = btrim(name) and char_length(name) between 2 and 120),
  constraint deadline_acts_days_check check (days between 1 and 365),
  constraint deadline_acts_counting_check check (counting in ('business', 'calendar')),
  constraint deadline_acts_kinds_check check (proceeding_kinds <@ array['juizado', 'comum']::text[]),
  constraint deadline_acts_basis_check check (basis = btrim(basis) and char_length(basis) between 2 and 200)
);

alter table public.deadline_acts enable row level security;
create policy "deadline_acts_select_all" on public.deadline_acts for select to authenticated using (true);
grant select on table public.deadline_acts to authenticated;

-- The terms the law gives the acts a firm of passengers' claims meets most, read in the Código de
-- Processo Civil and in the Lei nº 9.099/1995. A judge may set another one: the days are where the
-- person starts from, and are theirs to change.
insert into public.deadline_acts (slug, name, days, proceeding_kinds, basis, position) values
  ('manifestacao', 'Manifestação (sem prazo fixado)', 5, '{}', 'CPC, art. 218, § 3º', 10),
  ('emenda_inicial', 'Emenda da petição inicial', 15, '{}', 'CPC, art. 321', 20),
  ('manifestacao_documentos', 'Manifestação sobre documentos', 15, '{}', 'CPC, art. 437, § 1º', 30),
  ('replica', 'Réplica à contestação', 15, '{comum}', 'CPC, arts. 350 e 351', 40),
  ('embargos_declaracao', 'Embargos de declaração', 5, '{}', 'CPC, art. 1.023; Lei nº 9.099/1995, art. 49', 50),
  ('recurso_inominado', 'Recurso inominado', 10, '{juizado}', 'Lei nº 9.099/1995, art. 42', 60),
  ('contrarrazoes_recurso_inominado', 'Contrarrazões ao recurso inominado', 10, '{juizado}', 'Lei nº 9.099/1995, art. 42, § 2º', 70),
  ('apelacao', 'Apelação', 15, '{comum}', 'CPC, art. 1.003, § 5º', 80),
  ('contrarrazoes_apelacao', 'Contrarrazões de apelação', 15, '{comum}', 'CPC, art. 1.010, § 1º', 90),
  ('agravo_instrumento', 'Agravo de instrumento', 15, '{comum}', 'CPC, art. 1.003, § 5º', 100),
  ('agravo_interno', 'Agravo interno', 15, '{}', 'CPC, arts. 1.021 e 1.070', 110),
  ('recurso_extraordinario', 'Recurso extraordinário', 15, '{}', 'CPC, art. 1.003, § 5º', 120),
  ('recurso_especial', 'Recurso especial', 15, '{comum}', 'CPC, art. 1.003, § 5º', 130)
on conflict (slug) do nothing;

-- ---------- The firm's deadlines ----------

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The lawsuit, by its number and its court: what a deadline is of, whatever is linked to it. The court
  -- is the one the count read its calendar for (a court with no calendar here is counted with none).
  cnj text not null,
  court text not null,
  case_id uuid,
  proceeding_id uuid,
  -- The publication it came from. A deadline of a publication follows the lawsuit the publication is of.
  publication_id uuid,
  -- What is to be done, and the act of the list it was chosen from.
  title text not null,
  act text references public.deadline_acts (slug) on delete set null,
  -- publication  from the day the DJEN made the publication available (the rule finds its publication);
  -- day          from a day a person names: an intimation read in the court's system, one in a hearing.
  trigger text not null,
  trigger_on date not null,
  days integer not null,
  counting text not null,
  -- Each change of what the count reads (the inputs, the lawsuit's place, the court's calendar) is a
  -- revision: the backend counts the deadline again until the count is of the revision in force.
  revision integer not null default 1,
  -- What the rule counted, written by the backend that ran it, and of which revision.
  computed_revision integer,
  rule_version text,
  published_on date,
  starts_on date,
  computed_due_on date,
  explanation jsonb,
  assumptions text[] not null default '{}',
  computed_at timestamptz,
  -- The backend's work on the count: a numbered claim, so a late worker writes nothing.
  count_claimed_at timestamptz,
  count_claims integer not null default 0,
  count_attempts integer not null default 0,
  count_retry_after timestamptz,
  count_error text,
  -- proposed   counted, or being counted, and waiting for who confirms;
  -- confirmed  a person confirmed its day: no later count changes it;
  -- done       the act was done;
  -- dismissed  there was no such deadline after all, with why.
  status text not null default 'proposed',
  -- The day the firm works with: the counted one while proposed, the confirmed one after.
  due_on date,
  -- Confirmed on another day than the counted one, with why.
  corrected boolean not null default false,
  correction_reason text,
  -- The counted day the confirmation was made against: a later count that gives another is shown to the firm.
  confirmed_against date,
  -- The revision the confirmation was made on: a later one that could not be counted is shown to the firm.
  confirmed_revision integer,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  -- Confirmed by ONE, on the day counted, where the firm lets it (0016, `deadline_confirm`).
  confirmed_auto boolean not null default false,
  done_note text,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz,
  dismiss_reason text,
  dismissed_by uuid references public.profiles (id) on delete set null,
  dismissed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  -- Proposed by ONE from the publication it read, where the firm lets it (0040, `publication_deadline`).
  proposed_auto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id),
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete set null (proceeding_id),
  foreign key (publication_id, org_id) references public.publications (id, org_id) on delete set null (publication_id),
  constraint deadlines_cnj_check check (cnj ~ '^[0-9]{20}$'),
  constraint deadlines_court_check check (court ~ '^[A-Z0-9-]{2,12}$'),
  constraint deadlines_title_check check (title = btrim(title) and char_length(title) between 2 and 200 and title !~ '[[:cntrl:]]'),
  constraint deadlines_trigger_check check (trigger in ('publication', 'day')),
  constraint deadlines_trigger_on_check check (trigger_on between date '2019-01-01' and date '2100-12-31'),
  constraint deadlines_days_check check (days between 1 and 365),
  constraint deadlines_counting_check check (counting in ('business', 'calendar')),
  constraint deadlines_revision_check check (revision >= 1 and (computed_revision is null or computed_revision between 1 and revision)),
  constraint deadlines_rule_check check (rule_version is null or rule_version ~ '^prazo-v[0-9]{1,3}$'),
  constraint deadlines_explanation_check check (
    explanation is null or (jsonb_typeof(explanation) = 'object' and octet_length(explanation::text) <= 32000)
  ),
  constraint deadlines_assumptions_check check (assumptions <@ array[
    'calendar_unchecked', 'comarca_unknown', 'local_days_unchecked', 'scope_unknown', 'partial_start',
    'start_not_business', 'djen_before_rule', 'calendar_suspension'
  ]::text[]),
  constraint deadlines_count_error_check check (count_error is null or count_error ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint deadlines_status_check check (status in ('proposed', 'confirmed', 'done', 'dismissed')),
  constraint deadlines_due_check check (due_on is null or due_on >= trigger_on),
  constraint deadlines_correction_check check (
    corrected = (correction_reason is not null)
    and (correction_reason is null or char_length(correction_reason) between 8 and 1000)
  ),
  constraint deadlines_confirmed_check check (status <> 'confirmed' or (confirmed_at is not null and due_on is not null)),
  constraint deadlines_done_check check ((status = 'done') = (done_at is not null) and coalesce(char_length(done_note), 0) <= 1000),
  constraint deadlines_dismissed_check check (
    (status = 'dismissed') = (dismissed_at is not null)
    and (status <> 'dismissed' or char_length(coalesce(dismiss_reason, '')) between 8 and 1000)
  )
);

create index deadlines_open_idx on public.deadlines (org_id, due_on) where status in ('proposed', 'confirmed');
create index deadlines_count_idx on public.deadlines (updated_at)
  where status in ('proposed', 'confirmed') and computed_revision is distinct from revision;
create index deadlines_court_idx on public.deadlines (court) where status in ('proposed', 'confirmed');
create index deadlines_case_idx on public.deadlines (case_id, due_on) where case_id is not null;
create index deadlines_proceeding_idx on public.deadlines (proceeding_id) where proceeding_id is not null;
create index deadlines_publication_idx on public.deadlines (publication_id) where publication_id is not null;
create index deadlines_closed_idx on public.deadlines (org_id, (coalesce(done_at, dismissed_at)) desc)
  where status in ('done', 'dismissed');
-- The few counts a worker holds: what the release of a claim nobody finished looks at.
create index deadlines_claimed_idx on public.deadlines (count_claimed_at) where count_claimed_at is not null;
-- The publications triaged as a deadline: what the watch over the ones with no deadline reads.
create index publications_deadline_watch_idx on public.publications (org_id, triaged_at) where category = 'prazo' and active;

/**
 * The day a publication triaged as a deadline is watched from: the day it
 * was triaged, in Brasília, or the day the DJEN made it available when that
 * came later. A publication read late is watched from when it was read.
 */
create or replace function public.publication_watched_since(
  target_available_on date,
  target_triaged_at timestamptz,
  target_captured_at timestamptz
)
returns date
language sql
immutable
as $$
  select greatest(target_available_on,
    (coalesce(target_triaged_at, target_captured_at) at time zone 'America/Sao_Paulo')::date);
$$;

revoke all on function public.publication_watched_since(date, timestamptz, timestamptz) from public, anon, authenticated;

alter table public.deadlines enable row level security;
create policy "deadlines_select_member" on public.deadlines
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.deadlines to authenticated;

create trigger deadlines_updated_at before update on public.deadlines
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_deadlines after insert or update or delete on public.deadlines
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A deadline of a publication follows the lawsuit the publication is of:
 * when a lawsuit gets the publication's number, or lets it go, its deadlines
 * go with it, and an open one is counted again (the lawsuit's comarca and
 * system may have local days).
 */
create or replace function public.publications_carry_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deadlines d set
    proceeding_id = new.proceeding_id,
    case_id = new.case_id,
    revision = case when d.status in ('proposed', 'confirmed') then d.revision + 1 else d.revision end,
    count_attempts = 0,
    count_error = null,
    count_retry_after = null
  where d.publication_id = new.id
    and (d.proceeding_id is distinct from new.proceeding_id or d.case_id is distinct from new.case_id);
  return null;
end;
$$;

revoke all on function public.publications_carry_deadlines() from public, anon, authenticated;

create trigger publications_carry_deadlines after update of proceeding_id, case_id on public.publications
  for each row execute function public.publications_carry_deadlines();

/**
 * A lawsuit whose place changed (its court, comarca, system or kind) has its
 * open deadlines counted again. One with no publication is of the lawsuit
 * itself: its number, its court and its case follow the lawsuit's.
 */
create or replace function public.proceedings_recount_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.court is not distinct from new.court and old.comarca is not distinct from new.comarca
     and old.system is not distinct from new.system and old.kind is not distinct from new.kind
     and old.case_id is not distinct from new.case_id and old.cnj is not distinct from new.cnj then
    return null;
  end if;
  update public.deadlines d set
    case_id = case when d.publication_id is null then new.case_id else d.case_id end,
    cnj = case when d.publication_id is null then coalesce(new.cnj, d.cnj) else d.cnj end,
    court = case when d.publication_id is null then coalesce(new.court, d.court) else d.court end,
    revision = case when d.status in ('proposed', 'confirmed') then d.revision + 1 else d.revision end,
    count_attempts = 0,
    count_error = null,
    count_retry_after = null
  where d.proceeding_id = new.id;
  return null;
end;
$$;

revoke all on function public.proceedings_recount_deadlines() from public, anon, authenticated;

create trigger proceedings_recount_deadlines after update on public.proceedings
  for each row execute function public.proceedings_recount_deadlines();

/**
 * The open deadlines of a court whose count went through some days are
 * counted again: the calendar of those days changed. A count reads the days
 * from the one it runs from to its last, so a day outside them changes
 * nothing of it; a deadline not counted yet is counted anyway. Answers how
 * many.
 */
create or replace function public.recount_court_deadlines(target_court text, target_from date, target_to date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.deadlines d set
    revision = d.revision + 1,
    count_attempts = 0,
    count_error = null,
    count_retry_after = null
  where d.court = target_court and d.status in ('proposed', 'confirmed')
    and d.trigger_on <= target_to
    and (d.computed_due_on is null or d.computed_revision is distinct from d.revision or d.computed_due_on >= target_from);
  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recount_court_deadlines(text, date, date) from public, anon, authenticated;

/** The words a person typed, as a deadline keeps them: trimmed, or null when nothing is left. */
create or replace function public.deadline_text(value text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(coalesce(value, ''), '[[:cntrl:]]+', ' ', 'g')), '');
$$;

revoke all on function public.deadline_text(text) from public, anon, authenticated;

/**
 * Checks what a person gives a deadline: what is to be done, from what and
 * in how many days. Answers null when it may be written, or the refusal.
 */
create or replace function public.deadline_input_refusal(
  target_title text,
  target_act text,
  target_trigger text,
  target_trigger_on date,
  target_days integer,
  target_counting text,
  current_act text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_title is null or char_length(target_title) not between 2 and 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'title');
  end if;
  -- The act a deadline already has stays its own when the operator takes it off the list: only a new choice is of the list.
  if target_act is not null and target_act is distinct from current_act
     and not exists (select 1 from public.deadline_acts a where a.slug = target_act and a.active) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'act');
  end if;
  if target_trigger is null or target_trigger not in ('publication', 'day') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'trigger');
  end if;
  -- A day to come is allowed (a term set to run from a hearing already scheduled), not a year ahead.
  if target_trigger_on is null or target_trigger_on < date '2019-01-01'
     or target_trigger_on > (now() at time zone 'America/Sao_Paulo')::date + 366 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'trigger_on');
  end if;
  if target_days is null or target_days not between 1 and 365 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'days');
  end if;
  if target_counting is null or target_counting not in ('business', 'calendar') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'counting');
  end if;
  return null;
end;
$$;

revoke all on function public.deadline_input_refusal(text, text, text, date, integer, text, text) from public, anon, authenticated;

/**
 * A person proposes a deadline: of a publication (from the day the DJEN made
 * it available, or from a day they name) or of a lawsuit of the firm the
 * court has, filed or closed (from a day they name). Who signs, or who runs
 * the firm's deadlines; never a support visit. ONE proposes one too, from a
 * publication of a case it read (0040), through its own function for that
 * case (`case_system_writer`). The backend counts it right after
 * (`deadline_to_count`, `record_deadline_count`), and it waits for who
 * confirms.
 */
create or replace function public.propose_deadline(
  target_publication uuid,
  target_proceeding uuid,
  target_title text,
  target_act text,
  target_trigger text,
  target_trigger_on date,
  target_days integer,
  target_counting text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  publication public.publications%rowtype;
  lawsuit public.proceedings%rowtype;
  firm uuid;
  found_case uuid;
  found_proceeding uuid;
  lawsuit_number text;
  court_code text;
  from_day date := target_trigger_on;
  title_value text := public.deadline_text(target_title);
  act_value text := nullif(btrim(coalesce(target_act, '')), '');
  refusal jsonb;
  open_count integer;
  new_id uuid;
begin
  if caller is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  if target_publication is not null then
    select * into publication from public.publications where id = target_publication for no key update;
    -- A person of the firm; ONE is held to the case its own function named, below.
    if not found or (caller is not null and not public.is_org_member(publication.org_id)) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if not publication.active then
      return jsonb_build_object('ok', false, 'code', 'cancelled');
    end if;
    firm := publication.org_id;
    found_case := publication.case_id;
    found_proceeding := publication.proceeding_id;
    lawsuit_number := publication.cnj;
    court_code := publication.court;
    if target_trigger = 'publication' then
      from_day := publication.available_on;
    end if;
  elsif target_proceeding is not null then
    select * into lawsuit from public.proceedings where id = target_proceeding for no key update;
    if not found or (caller is not null and not public.is_org_member(lawsuit.org_id)) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    firm := lawsuit.org_id;
    if lawsuit.status = 'planned' or lawsuit.cnj is null then
      return jsonb_build_object('ok', false, 'code', 'not_filed');
    end if;
    if lawsuit.court is null then
      return jsonb_build_object('ok', false, 'code', 'court_unknown');
    end if;
    if target_trigger = 'publication' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'trigger');
    end if;
    found_case := lawsuit.case_id;
    found_proceeding := lawsuit.id;
    lawsuit_number := lawsuit.cnj;
    court_code := lawsuit.court;
  else
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- ONE writes only to the case its own function named.
  if caller is null and not public.case_system_writer(found_case) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if caller is not null
     and not public.has_firm_function(firm, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  refusal := public.deadline_input_refusal(title_value, act_value, target_trigger, from_day, target_days, target_counting);
  if refusal is not null then
    return refusal;
  end if;
  select count(*) into open_count from public.deadlines d
  where d.org_id = firm and d.status in ('proposed', 'confirmed')
    and (case when target_publication is not null then d.publication_id = target_publication
              else d.proceeding_id = found_proceeding and d.publication_id is null end);
  if open_count >= greatest(public.deadlines_setting('max_open', 20), 1) then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  insert into public.deadlines (
    org_id, cnj, court, case_id, proceeding_id, publication_id, title, act, trigger, trigger_on, days, counting,
    created_by, proposed_auto
  ) values (
    firm, lawsuit_number, court_code, found_case, found_proceeding, target_publication, title_value, act_value,
    target_trigger, from_day, target_days, target_counting, caller, caller is null
  )
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (firm, caller, 'deadline.proposed', 'deadline', new_id::text, jsonb_strip_nulls(jsonb_build_object(
    'publication', target_publication, 'proceeding', found_proceeding, 'act', act_value, 'days', target_days,
    'counting', target_counting, 'trigger', target_trigger, 'auto', case when caller is null then true end
  )));
  if found_case is not null then
    perform public.record_case_event(firm, found_case, 'deadline_proposed', public.case_actor(found_case),
      jsonb_build_object('deadline', new_id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'proposed', 'id', new_id);
end;
$$;

revoke all on function public.propose_deadline(uuid, uuid, text, text, text, date, integer, text) from public, anon;
grant execute on function public.propose_deadline(uuid, uuid, text, text, text, date, integer, text) to authenticated;

/** The deadline a person of the firm is writing to, locked; null when it is not theirs to see. */
create or replace function public.deadline_for_writer(target_deadline uuid)
returns public.deadlines
language plpgsql
security definer
set search_path = public
as $$
declare
  found_deadline public.deadlines%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into found_deadline from public.deadlines where id = target_deadline for update;
  if not found or not public.is_org_member(found_deadline.org_id) then
    return null;
  end if;
  return found_deadline;
end;
$$;

revoke all on function public.deadline_for_writer(uuid) from public, anon, authenticated;

/**
 * A person corrects a deadline: what is to be done, and what it is counted
 * from (the day, the days, how they count). An open deadline only. A change
 * of what the count reads sends a confirmed deadline back to the queue,
 * since its day may change, and the backend counts it again; a change of
 * its words alone leaves its count and its confirmation as they are.
 */
create or replace function public.update_deadline(
  target_deadline uuid,
  target_title text,
  target_act text,
  target_trigger text,
  target_trigger_on date,
  target_days integer,
  target_counting text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
  publication public.publications%rowtype;
  title_value text := public.deadline_text(target_title);
  act_value text := nullif(btrim(coalesce(target_act, '')), '');
  from_day date := target_trigger_on;
  refusal jsonb;
  recounts boolean;
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('proposed', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if target_trigger = 'publication' then
    select * into publication from public.publications where id = current_deadline.publication_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'trigger');
    end if;
    -- A term newly set to run from a publication the court took back is refused, as proposing one is.
    if not publication.active and current_deadline.trigger <> 'publication' then
      return jsonb_build_object('ok', false, 'code', 'cancelled');
    end if;
    from_day := publication.available_on;
  end if;
  refusal := public.deadline_input_refusal(title_value, act_value, target_trigger, from_day, target_days,
    target_counting, current_deadline.act);
  if refusal is not null then
    return refusal;
  end if;
  recounts := target_trigger <> current_deadline.trigger or from_day <> current_deadline.trigger_on
    or target_days <> current_deadline.days or target_counting <> current_deadline.counting;
  if not recounts and title_value = current_deadline.title and act_value is not distinct from current_deadline.act then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;

  if recounts then
    update public.deadlines set
      title = title_value,
      act = act_value,
      trigger = target_trigger,
      trigger_on = from_day,
      days = target_days,
      counting = target_counting,
      revision = revision + 1,
      count_attempts = 0,
      count_error = null,
      count_retry_after = null,
      status = 'proposed',
      due_on = null,
      corrected = false,
      correction_reason = null,
      confirmed_against = null,
      confirmed_revision = null,
      confirmed_by = null,
      confirmed_auto = false,
      confirmed_at = null
    where id = current_deadline.id;
  else
    update public.deadlines set title = title_value, act = act_value where id = current_deadline.id;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.updated', 'deadline', current_deadline.id::text,
    jsonb_build_object('recounts', recounts, 'was_confirmed', current_deadline.status = 'confirmed',
      'days', target_days, 'counting', target_counting, 'trigger', target_trigger));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_updated', 'person',
      jsonb_build_object('deadline', current_deadline.id));
  end if;
  return jsonb_build_object('ok', true, 'code', case when recounts then 'updated' else 'renamed' end);
end;
$$;

revoke all on function public.update_deadline(uuid, text, text, text, date, integer, text) from public, anon;
grant execute on function public.update_deadline(uuid, text, text, text, date, integer, text) to authenticated;

/**
 * Who runs the firm's deadlines (a partner or the controladoria) confirms
 * one: on the day the rule counted, or on another with the reason. The
 * person names the revision whose count they read, so a count that changed
 * meanwhile is never confirmed unseen. A deadline whose count failed for
 * good is confirmed on a day the person counted, with the reason. A
 * confirmed deadline is confirmed again the same way: on the new count, or
 * keeping its day with the reason, which is how a person answers what they
 * were asked to look at again (`deadline_review_reasons`).
 */
create or replace function public.confirm_deadline(
  target_deadline uuid,
  target_revision integer,
  target_due_on date,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
  counted boolean;
  given_up boolean;
  chosen_day date;
  reason text := public.deadline_text(target_reason);
  is_corrected boolean;
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('proposed', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if target_revision is distinct from current_deadline.revision then
    return jsonb_build_object('ok', false, 'code', 'changed');
  end if;
  counted := current_deadline.computed_revision = current_deadline.revision and current_deadline.computed_due_on is not null;
  given_up := not counted and current_deadline.count_error is not null and current_deadline.count_claimed_at is null
    and current_deadline.count_attempts >= tries;
  if not counted and not given_up then
    return jsonb_build_object('ok', false, 'code', 'counting');
  end if;
  chosen_day := coalesce(target_due_on, case when counted then current_deadline.computed_due_on end);
  if chosen_day is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'due_on');
  end if;
  if chosen_day < current_deadline.trigger_on or chosen_day > current_deadline.trigger_on + 1100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'due_on');
  end if;
  is_corrected := not counted or chosen_day <> current_deadline.computed_due_on;
  if is_corrected and (reason is null or char_length(reason) not between 8 and 1000) then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'reason');
  end if;

  update public.deadlines set
    status = 'confirmed',
    due_on = chosen_day,
    corrected = is_corrected,
    correction_reason = case when is_corrected then reason end,
    confirmed_against = case when counted then current_deadline.computed_due_on end,
    confirmed_revision = current_deadline.revision,
    confirmed_by = auth.uid(),
    confirmed_auto = false,
    confirmed_at = now()
  where id = current_deadline.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.confirmed', 'deadline', current_deadline.id::text,
    jsonb_strip_nulls(jsonb_build_object('due_on', chosen_day, 'counted', case when counted then current_deadline.computed_due_on end,
      'corrected', is_corrected, 'again', current_deadline.status = 'confirmed')));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_confirmed', 'person',
      jsonb_build_object('deadline', current_deadline.id, 'corrected', is_corrected));
  end if;
  return jsonb_build_object('ok', true, 'code', 'confirmed', 'due_on', chosen_day);
end;
$$;

revoke all on function public.confirm_deadline(uuid, integer, date, text) from public, anon;
grant execute on function public.confirm_deadline(uuid, integer, date, text) to authenticated;

-- Confirming a deadline on the day the rule counted is ONE's by default; a firm may have a partner or its
-- controladoria confirm every one. What a person is asked to look at again (a count that changed after the
-- confirmation, a publication the court took back, a count that failed) is still a person's.
insert into public.autonomy_decisions (key, position, modes) values
  ('deadline_confirm', 40, array['auto', 'approval'])
on conflict (key) do nothing;

/**
 * ONE confirms a deadline on the day counted, for the revision in force,
 * where its firm lets it: called by the record of a count. A deadline no
 * longer waiting, or whose count is not of its revision, is left as it is.
 */
create or replace function public.confirm_deadline_unattended(target_deadline uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype;
begin
  select * into current_deadline from public.deadlines where id = target_deadline for update;
  if not found or current_deadline.status <> 'proposed' or current_deadline.computed_due_on is null
     or current_deadline.computed_revision is distinct from current_deadline.revision
     or public.firm_autonomy_mode(current_deadline.org_id, 'deadline_confirm') is distinct from 'auto'
     -- What a person is to look at (a publication the court took back) is never confirmed by ONE.
     or cardinality(public.deadline_review_reasons(current_deadline)) > 0 then
    return false;
  end if;
  update public.deadlines set
    status = 'confirmed',
    due_on = current_deadline.computed_due_on,
    corrected = false,
    correction_reason = null,
    confirmed_against = current_deadline.computed_due_on,
    confirmed_revision = current_deadline.revision,
    confirmed_by = null,
    confirmed_auto = true,
    confirmed_at = now()
  where id = current_deadline.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, null, 'deadline.confirmed', 'deadline', current_deadline.id::text,
    jsonb_build_object('due_on', current_deadline.computed_due_on, 'counted', current_deadline.computed_due_on,
      'corrected', false, 'auto', true));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_confirmed', 'system',
      jsonb_build_object('deadline', current_deadline.id, 'corrected', false, 'auto', true));
  end if;
  return true;
end;
$$;

revoke all on function public.confirm_deadline_unattended(uuid) from public, anon, authenticated;

/** The act of an open deadline was done: who signs, or who runs the firm's deadlines, says so, with a note when one helps. */
create or replace function public.complete_deadline(target_deadline uuid, target_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
  note text := public.deadline_text(target_note);
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('proposed', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if char_length(coalesce(note, '')) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'note');
  end if;
  update public.deadlines set status = 'done', done_note = note, done_by = auth.uid(), done_at = now()
  where id = current_deadline.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.done', 'deadline', current_deadline.id::text,
    jsonb_build_object('was', current_deadline.status, 'due_on', current_deadline.due_on));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_done', 'person',
      jsonb_build_object('deadline', current_deadline.id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'done');
end;
$$;

revoke all on function public.complete_deadline(uuid, text) from public, anon;
grant execute on function public.complete_deadline(uuid, text) to authenticated;

/** There was no such deadline after all (a publication read twice, a term that does not run): said with why. */
create or replace function public.dismiss_deadline(target_deadline uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
  reason text := public.deadline_text(target_reason);
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('proposed', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if reason is null or char_length(reason) not between 8 and 1000 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'reason');
  end if;
  update public.deadlines set status = 'dismissed', dismiss_reason = reason, dismissed_by = auth.uid(), dismissed_at = now()
  where id = current_deadline.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.dismissed', 'deadline', current_deadline.id::text,
    jsonb_build_object('was', current_deadline.status, 'due_on', current_deadline.due_on));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_dismissed', 'person',
      jsonb_build_object('deadline', current_deadline.id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'dismissed');
end;
$$;

revoke all on function public.dismiss_deadline(uuid, text) from public, anon;
grant execute on function public.dismiss_deadline(uuid, text) to authenticated;

/**
 * A deadline marked done or dismissed by mistake goes back to the queue: it
 * is counted again and confirmed again, since the calendar may have changed
 * meanwhile.
 */
create or replace function public.reopen_deadline(target_deadline uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('done', 'dismissed') then
    return jsonb_build_object('ok', false, 'code', 'open');
  end if;
  update public.deadlines set
    status = 'proposed',
    revision = revision + 1,
    count_attempts = 0,
    count_error = null,
    count_retry_after = null,
    due_on = null,
    corrected = false,
    correction_reason = null,
    confirmed_against = null,
    confirmed_revision = null,
    confirmed_by = null,
    confirmed_auto = false,
    confirmed_at = null,
    done_note = null,
    done_by = null,
    done_at = null,
    dismiss_reason = null,
    dismissed_by = null,
    dismissed_at = null
  where id = current_deadline.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.reopened', 'deadline', current_deadline.id::text,
    jsonb_build_object('was', current_deadline.status));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_reopened', 'person',
      jsonb_build_object('deadline', current_deadline.id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'reopened');
end;
$$;

revoke all on function public.reopen_deadline(uuid) from public, anon;
grant execute on function public.reopen_deadline(uuid) to authenticated;

/**
 * A person asks for the count of an open deadline again, after the backend
 * gave it up (the rule refused it, or the attempts ran out on a failure that
 * was not the deadline's): the attempts start over, and the backend counts
 * the revision in force. Who signs, or who runs the firm's deadlines.
 */
create or replace function public.retry_deadline_count(target_deadline uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('proposed', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if current_deadline.computed_revision = current_deadline.revision then
    return jsonb_build_object('ok', true, 'code', 'counted');
  end if;
  -- A worker holds it now: its answer is on the way, and nothing is asked twice.
  if current_deadline.count_claimed_at is not null then
    return jsonb_build_object('ok', true, 'code', 'counting');
  end if;
  update public.deadlines set count_attempts = 0, count_error = null, count_retry_after = null
  where id = current_deadline.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.count_retried', 'deadline', current_deadline.id::text,
    jsonb_strip_nulls(jsonb_build_object('error', current_deadline.count_error)));
  return jsonb_build_object('ok', true, 'code', 'retried');
end;
$$;

revoke all on function public.retry_deadline_count(uuid) from public, anon;
grant execute on function public.retry_deadline_count(uuid) to authenticated;

-- ---------- The count, by the backend ----------

/**
 * Claims the open deadlines whose count is not of their revision in force
 * (or the one named), each with the number of its claim, the oldest change
 * first. A claim not finished in time goes back to the line. Service role
 * only.
 */
create or replace function public.claim_deadline_counts(target_limit integer default 10, target_deadline uuid default null)
returns table (deadline_id uuid, claim integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.deadlines_setting('working_minutes', 10), 1);
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.deadlines d
  set count_claimed_at = null,
      count_error = case when d.count_attempts >= tries then 'abandoned' else d.count_error end
  where d.count_claimed_at is not null and d.count_claimed_at < now() - make_interval(mins => minutes);

  return query
  with picked as (
    select d.id from public.deadlines d
    where d.status in ('proposed', 'confirmed') and d.computed_revision is distinct from d.revision
      and d.count_claimed_at is null and d.count_attempts < tries
      and (d.count_retry_after is null or d.count_retry_after <= now())
      and (target_deadline is null or d.id = target_deadline)
    order by d.updated_at
    limit greatest(least(coalesce(target_limit, 10), 100), 1)
    for update skip locked
  )
  update public.deadlines d
  set count_claimed_at = now(), count_retry_after = null, count_attempts = d.count_attempts + 1,
      count_claims = d.count_claims + 1
  from picked where d.id = picked.id
  returning d.id, d.count_claims;
end;
$$;

revoke all on function public.claim_deadline_counts(integer, uuid) from public, anon, authenticated;

/**
 * A worker gives back a claim it could not finish: what the count reads
 * could not be read, or its answer could not be written. Nothing was learned
 * of the deadline, whatever its revision is now, so it is tried again after
 * a wait that grows; when the attempts are spent it waits for a person, who
 * asks for the count again (`retry_deadline_count`) or confirms a day of
 * their own. A claim is never left to its clock when its worker can still
 * say it stopped. Service role only.
 */
create or replace function public.release_deadline_count(
  target_deadline uuid,
  target_claim integer,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
  pause integer := greatest(public.deadlines_setting('retry_minutes', 10), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'unfinished');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.deadlines set
    count_claimed_at = null,
    count_retry_after = case when count_attempts < tries
      then now() + make_interval(mins => pause * greatest(count_attempts, 1)) end,
    count_error = code
  where id = target_deadline and count_claimed_at is not null and count_claims = target_claim;
  return jsonb_build_object('ok', found, 'code', case when found then 'released' else 'not_working' end);
end;
$$;

revoke all on function public.release_deadline_count(uuid, integer, text) from public, anon, authenticated;

/**
 * A court's calendar for the years a count from that year may go through:
 * the years somebody checked, each with the day it was checked, and the
 * days on record. One reading for the backend's count and for the count a
 * person is shown before proposing, so the two can never differ. Public
 * reference data, read by every session.
 */
create or replace function public.court_calendar(target_court text, target_first_year integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- The longest term (365 business days, with two year-end suspensions in it) ends within two years
  -- of the year it runs from. A year no deadline can be of is read as the nearest one that can.
  with span as (
    select least(greatest(coalesce(target_first_year, 2019), 2019), 2100) as first_year
  )
  select jsonb_build_object(
    'years', coalesce((
      select jsonb_agg(jsonb_build_object(
        'year', y.year, 'all_comarcas', y.all_comarcas, 'comarcas', to_jsonb(y.comarcas), 'checked_on', y.checked_on
      ) order by y.year)
      from public.court_calendar_years y
      where y.court = target_court and y.year between span.first_year and span.first_year + 2
    ), '[]'::jsonb),
    'days_off', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', c.day, 'kind', c.kind, 'label', c.label, 'proceeding_kinds', to_jsonb(c.proceeding_kinds),
        'systems', to_jsonb(c.systems), 'comarcas', to_jsonb(c.comarcas)
      ) order by c.day, c.kind, c.label)
      from public.court_calendar_days c
      where c.court = target_court
        and c.day between make_date(span.first_year, 1, 1) and make_date(span.first_year + 2, 12, 31)
    ), '[]'::jsonb)
  )
  from span;
$$;

revoke all on function public.court_calendar(text, integer) from public, anon;
grant execute on function public.court_calendar(text, integer) to authenticated;

/**
 * What the count of a deadline reads, for the worker that holds the claim:
 * what the person gave, where the lawsuit is (its kind, system and comarca,
 * when the deadline is of a lawsuit of the firm), and the court's calendar
 * of the years the count may go through. Service role only.
 */
create or replace function public.deadline_to_count(target_deadline uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype;
  lawsuit public.proceedings%rowtype;
  court_code text;
  first_year integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into current_deadline from public.deadlines d
  where d.id = target_deadline and d.count_claimed_at is not null and d.count_claims = target_claim;
  if not found then
    return null;
  end if;
  if current_deadline.proceeding_id is not null then
    select * into lawsuit from public.proceedings p where p.id = current_deadline.proceeding_id;
  end if;
  court_code := coalesce(lawsuit.court, current_deadline.court);
  first_year := extract(year from current_deadline.trigger_on)::integer;
  return jsonb_build_object(
    'id', current_deadline.id,
    'org_id', current_deadline.org_id,
    'claim', current_deadline.count_claims,
    'revision', current_deadline.revision,
    'trigger', current_deadline.trigger,
    'trigger_on', current_deadline.trigger_on,
    'days', current_deadline.days,
    'counting', current_deadline.counting,
    'court', court_code,
    'place', jsonb_build_object('proceeding_kind', lawsuit.kind, 'system', lawsuit.system, 'comarca', lawsuit.comarca)
  ) || public.court_calendar(court_code, first_year);
end;
$$;

revoke all on function public.deadline_to_count(uuid, integer) from public, anon, authenticated;

/**
 * What the count of a deadline came to, for the revision the worker read:
 *
 *   counted  the rule's answer, kept whole (what a person reads of the
 *            count) with its days in columns. A proposed deadline takes the
 *            counted day; a confirmed one keeps its own;
 *   retry    a failure that may pass: tried again after a wait, until the
 *            attempts are spent;
 *   failed   the rule refused to count it: a person confirms a day of their
 *            own, or corrects what it was counted from.
 *
 * A count of a revision no longer in force writes nothing: the deadline is
 * counted again. Service role only.
 */
create or replace function public.record_deadline_count(
  target_deadline uuid,
  target_claim integer,
  target_revision integer,
  target_outcome text,
  target_result jsonb default null,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype;
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
  pause integer := greatest(public.deadlines_setting('retry_minutes', 10), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  outcome text := target_outcome;
  due date;
  starts date;
  published date;
  codes text[];
  used_court text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('counted', 'retry', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into current_deadline from public.deadlines where id = target_deadline for update;
  if not found or current_deadline.count_claimed_at is null or current_deadline.count_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_revision is distinct from current_deadline.revision or current_deadline.status not in ('proposed', 'confirmed') then
    -- Counted from what is no longer so: the try does not count, and the deadline waits for its next count.
    update public.deadlines set count_claimed_at = null, count_attempts = greatest(count_attempts - 1, 0)
    where id = current_deadline.id;
    return jsonb_build_object('ok', true, 'code', 'changed');
  end if;

  if outcome = 'counted' then
    begin
      if jsonb_typeof(target_result) is distinct from 'object'
         or coalesce(target_result ->> 'rule', '') !~ '^prazo-v[0-9]{1,3}$'
         or (target_result ->> 'days')::integer is distinct from current_deadline.days
         or target_result ->> 'trigger' is distinct from current_deadline.trigger
         or target_result ->> 'counting' is distinct from current_deadline.counting
         or (target_result ->> 'triggerDay')::date is distinct from current_deadline.trigger_on
         or jsonb_typeof(target_result -> 'assumptions') is distinct from 'array'
         or jsonb_typeof(target_result -> 'skipped') is distinct from 'array'
         or octet_length(target_result::text) > 32000 then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      due := (target_result ->> 'dueOn')::date;
      starts := (target_result ->> 'startsOn')::date;
      published := (target_result ->> 'publishedOn')::date;
      if due is null or starts is null or due < starts or starts <= current_deadline.trigger_on
         or (current_deadline.trigger = 'publication') <> (published is not null) then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      select coalesce(array_agg(distinct a ->> 'code'), '{}') into codes
      from jsonb_array_elements(target_result -> 'assumptions') a;
      used_court := target_result #>> '{place,court}';
      if used_court is not null and used_court !~ '^[A-Z0-9-]{2,12}$' then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      update public.deadlines set
        computed_revision = revision,
        rule_version = target_result ->> 'rule',
        published_on = published,
        starts_on = starts,
        computed_due_on = due,
        explanation = target_result,
        assumptions = codes,
        computed_at = now(),
        court = coalesce(used_court, court),
        count_claimed_at = null,
        count_attempts = 0,
        count_retry_after = null,
        count_error = null,
        due_on = case when status = 'proposed' then due else due_on end
      where id = current_deadline.id;
      -- The firm lets ONE confirm its deadlines (0016, `deadline_confirm`): one still waiting for confirmation
      -- is confirmed on the day the rule counted, which is the earlier day wherever the rule could not know.
      if current_deadline.status = 'proposed'
         and public.firm_autonomy_mode(current_deadline.org_id, 'deadline_confirm') = 'auto' then
        perform public.confirm_deadline_unattended(current_deadline.id);
      end if;
      return jsonb_build_object('ok', true, 'code', 'counted', 'due_on', due);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
                    or invalid_parameter_value or check_violation or numeric_value_out_of_range then
      outcome := 'failed';
      code := 'invalid_result';
    end;
  end if;

  if outcome = 'retry' and current_deadline.count_attempts >= tries then
    outcome := 'failed';
  end if;
  update public.deadlines set
    count_claimed_at = null,
    count_retry_after = case when outcome = 'retry' then now() + make_interval(mins => pause * greatest(count_attempts, 1)) end,
    -- A final failure spends the attempts: the sweep does not pick it again until something changes.
    count_attempts = case when outcome = 'failed' then tries else count_attempts end,
    count_error = code
  where id = current_deadline.id;
  return jsonb_build_object('ok', true, 'code', outcome);
end;
$$;

revoke all on function public.record_deadline_count(uuid, integer, integer, text, jsonb, text) from public, anon, authenticated;

-- ---------- What the firm reads ----------

/**
 * Why somebody should look at an open deadline again, each reason until who
 * runs the deadlines confirms the deadline knowing it:
 *
 *   publication_cancelled  the court took back the publication it came from,
 *                          and nobody confirmed the deadline since;
 *   count_changed          the count gives another day than the one the
 *                          confirmation was made against (or, for a day
 *                          confirmed with no count to read, than that day);
 *   count_failed           it could not be counted, and nobody confirmed it
 *                          since.
 *
 * Empty for a deadline in order, and for one that is closed. Taken from the
 * columns it reads, so a list counts it without reading any row whole.
 */
create or replace function public.deadline_review_reasons_of(
  target_status text,
  target_publication uuid,
  target_confirmed_at timestamptz,
  target_confirmed_revision integer,
  target_revision integer,
  target_computed_revision integer,
  target_computed_due_on date,
  target_confirmed_against date,
  target_due_on date,
  target_count_error text,
  target_count_claimed_at timestamptz,
  target_count_attempts integer
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case when target_status not in ('proposed', 'confirmed') then '{}'::text[] else array_remove(array[
    case when exists (
      select 1 from public.publications p
      where p.id = target_publication and not p.active
        and (target_status = 'proposed' or target_confirmed_at <= p.cancelled_at)
    ) then 'publication_cancelled' end,
    case when target_status = 'confirmed' and target_computed_revision = target_revision
      and target_computed_due_on is distinct from coalesce(target_confirmed_against, target_due_on)
    then 'count_changed' end,
    case when target_computed_revision is distinct from target_revision and target_count_error is not null
      and target_count_claimed_at is null
      and target_count_attempts >= greatest(public.deadlines_setting('max_attempts', 3), 1)
      and (target_status = 'proposed' or target_confirmed_revision is distinct from target_revision)
    then 'count_failed' end
  ], null) end;
$$;

revoke all on function public.deadline_review_reasons_of(text, uuid, timestamptz, integer, integer, integer, date, date, date,
  text, timestamptz, integer) from public, anon, authenticated;

/** Why somebody should look at a deadline again (`deadline_review_reasons_of`), of the deadline itself. */
create or replace function public.deadline_review_reasons(target public.deadlines)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select public.deadline_review_reasons_of(target.status, target.publication_id, target.confirmed_at,
    target.confirmed_revision, target.revision, target.computed_revision, target.computed_due_on,
    target.confirmed_against, target.due_on, target.count_error, target.count_claimed_at, target.count_attempts);
$$;

revoke all on function public.deadline_review_reasons(public.deadlines) from public, anon, authenticated;

/**
 * The day an open deadline is urgent by: its own day, but for a confirmed one
 * whose count in force now gives another day than the one it was confirmed
 * against, the earlier of the two, until a person confirms it again. A
 * deadline is never shown later than the count says it may be.
 */
create or replace function public.deadline_urgent_on(
  target_status text,
  target_due_on date,
  target_computed_due_on date,
  target_computed_revision integer,
  target_revision integer,
  target_confirmed_against date
)
returns date
language sql
immutable
as $$
  select case
    when target_status = 'confirmed' and target_computed_revision = target_revision
      and target_computed_due_on is distinct from coalesce(target_confirmed_against, target_due_on)
    then least(target_due_on, target_computed_due_on)
    else target_due_on
  end;
$$;

revoke all on function public.deadline_urgent_on(text, date, date, integer, integer, date) from public, anon, authenticated;

/** True for an open deadline somebody should look at again (`deadline_review_reasons`). */
create or replace function public.deadline_needs_review(target public.deadlines)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select cardinality(public.deadline_review_reasons(target)) > 0;
$$;

revoke all on function public.deadline_needs_review(public.deadlines) from public, anon, authenticated;

/**
 * A page of the firm's deadlines, with the count of each list:
 *
 *   confirmar   counted and waiting for who confirms;
 *   proximos    open and due from today on, the nearest first (what the home counts as due soon is here,
 *               counted apart as `em_breve`);
 *   vencidos    open and past their day;
 *   rever       open and needing a second look (`deadline_review_reasons_of`);
 *   abertos     every open one, the nearest first;
 *   concluidos  done or dismissed, the latest first.
 *
 * An open deadline is due, and ordered, by the day it is urgent by
 * (`deadline_urgent_on`). Of one case, when it is named: the lists and their
 * counts are of that case's deadlines. Today is Brasília's. The open
 * deadlines and the closed ones are each read by the firm's own index; only
 * the page's rows are read whole. Each row carries what the screens show of
 * it, never another firm's.
 */
create or replace function public.firm_deadlines(
  target_org uuid,
  target_view text,
  target_limit integer default 25,
  target_offset integer default 0,
  target_case uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := greatest(coalesce(target_offset, 0), 0);
  soon integer := greatest(public.deadlines_setting('soon_days', 3), 0);
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_view is null or target_view not in ('confirmar', 'proximos', 'vencidos', 'rever', 'abertos', 'concluidos') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  return (
    with open_rows as materialized (
      select d.id, d.status, d.created_at,
        public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) as urgent_on,
        public.deadline_review_reasons_of(d.status, d.publication_id, d.confirmed_at, d.confirmed_revision, d.revision,
          d.computed_revision, d.computed_due_on, d.confirmed_against, d.due_on, d.count_error, d.count_claimed_at,
          d.count_attempts) as review_reasons
      from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and (target_case is null or d.case_id = target_case)
    ),
    listed as (
      select o.id, o.urgent_on, null::timestamptz as closed_at, o.created_at
      from open_rows o
      where target_view <> 'concluidos' and case target_view
        when 'confirmar' then o.status = 'proposed'
        when 'proximos' then o.urgent_on >= today
        when 'vencidos' then o.urgent_on < today
        when 'rever' then cardinality(o.review_reasons) > 0
        else true
      end
      union all
      select d.id, null::date, coalesce(d.done_at, d.dismissed_at), d.created_at
      from public.deadlines d
      where target_view = 'concluidos' and d.org_id = target_org and d.status in ('done', 'dismissed')
        and (target_case is null or d.case_id = target_case)
    ),
    page as (
      select l.id,
        row_number() over (order by l.urgent_on asc nulls last, l.closed_at desc nulls last, l.created_at, l.id) as position
      from listed l
      order by l.urgent_on asc nulls last, l.closed_at desc nulls last, l.created_at, l.id
      limit size offset skip
    )
    select jsonb_build_object(
      'today', today,
      -- Within how many days a deadline is said to be due soon: the same days the home counts by.
      'soon_days', soon,
      'counts', jsonb_build_object(
        'confirmar', (select count(*) from open_rows o where o.status = 'proposed'),
        'proximos', (select count(*) from open_rows o where o.urgent_on >= today),
        'em_breve', (select count(*) from open_rows o where o.urgent_on between today and today + soon),
        'vencidos', (select count(*) from open_rows o where o.urgent_on < today),
        'rever', (select count(*) from open_rows o where cardinality(o.review_reasons) > 0),
        'abertos', (select count(*) from open_rows),
        'concluidos', (
          select count(*) from public.deadlines d
          where d.org_id = target_org and d.status in ('done', 'dismissed')
            and (target_case is null or d.case_id = target_case)
        )
      ),
      'total', (select count(*) from listed),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'act', p.act,
          'status', p.status,
          'due_on', p.due_on,
          'urgent_on', o.urgent_on,
          'computed_due_on', p.computed_due_on,
          'corrected', p.corrected,
          'correction_reason', p.correction_reason,
          'confirmed_against', p.confirmed_against,
          'trigger', p.trigger,
          'trigger_on', p.trigger_on,
          'days', p.days,
          'counting', p.counting,
          'published_on', p.published_on,
          'starts_on', p.starts_on,
          'explanation', p.explanation,
          -- The checked years of the court's calendar the count goes through, as they are now: a year
          -- checked again since the count says its latest day, with no count made again for it.
          'calendar_checked', coalesce((
            select jsonb_agg(jsonb_build_object('year', y.year, 'checked_on', y.checked_on) order by y.year)
            from public.court_calendar_years y
            where y.court = p.court
              and y.year between extract(year from p.trigger_on)::integer
                and extract(year from coalesce(p.computed_due_on, p.due_on, p.trigger_on))::integer
          ), '[]'::jsonb),
          'revision', p.revision,
          'counted', p.computed_revision = p.revision,
          'count_failed', p.computed_revision is distinct from p.revision and p.count_error is not null
            and p.count_claimed_at is null and p.count_attempts >= tries,
          'overdue', coalesce(o.urgent_on < today, false),
          'review', coalesce(cardinality(o.review_reasons) > 0, false),
          'review_reasons', coalesce(to_jsonb(o.review_reasons), '[]'::jsonb),
          'cnj', p.cnj,
          'court', p.court,
          'case_id', p.case_id,
          'case_seq', (select c.seq from public.cases c where c.id = p.case_id),
          'proceeding_id', p.proceeding_id,
          'proceeding_kind', (select pr.kind from public.proceedings pr where pr.id = p.proceeding_id),
          'publication_id', p.publication_id,
          'publication_active', (select pu.active from public.publications pu where pu.id = p.publication_id),
          'publication_available_on', (select pu.available_on from public.publications pu where pu.id = p.publication_id),
          'confirmed_by', p.confirmed_by,
          'confirmed_at', p.confirmed_at,
          'confirmed_auto', p.confirmed_auto,
          'done_by', p.done_by,
          'done_at', p.done_at,
          'done_note', p.done_note,
          'dismissed_by', p.dismissed_by,
          'dismissed_at', p.dismissed_at,
          'dismiss_reason', p.dismiss_reason,
          'created_by', p.created_by,
          'created_at', p.created_at,
          'proposed_auto', p.proposed_auto
        ) order by pg.position)
        from page pg
        join public.deadlines p on p.id = pg.id
        left join open_rows o on o.id = pg.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_deadlines(uuid, text, integer, integer, uuid) from public, anon;
grant execute on function public.firm_deadlines(uuid, text, integer, integer, uuid) to authenticated;

/**
 * Whether a publication triaged as a deadline still owes the firm its
 * deadline: none came from it. What ONE reads of it is reckoned where ONE
 * reads (0040). Internal.
 */
create or replace function public.publication_owes_deadline(target_publication uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.deadlines d where d.publication_id = target_publication);
$$;

revoke all on function public.publication_owes_deadline(uuid) from public, anon, authenticated;

/**
 * The publications somebody of the firm triaged as a deadline, in the last
 * days of the setting (from the triage, `publication_watched_since`), from
 * which no deadline was proposed (nor proposed and dismissed), nor linked
 * to one (`link_deadline_publication`): what the firm's deadlines would lose
 * without a look. The oldest first, each with what a list shows of it (the
 * start of its text, never the whole of it, never the AI's word) and the
 * deadlines of its lawsuit that came from no publication, one of which may
 * be its own, recorded from the court's system.
 */
create or replace function public.firm_publications_without_deadline(target_org uuid, target_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  watch integer := greatest(public.deadlines_setting('watch_days', 30), 1);
  size integer := least(greatest(coalesce(target_limit, 20), 1), 100);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with waiting as (
      select p.id, p.cnj, p.court, p.available_on, p.kind, p.head, p.case_id, p.proceeding_id, p.triaged_by,
        p.triaged_at
      from public.publications p
      where p.org_id = target_org and p.active and p.category = 'prazo'
        and public.publication_watched_since(p.available_on, p.triaged_at, p.captured_at) >= today - watch
        and public.publication_owes_deadline(p.id)
    )
    select jsonb_build_object(
      'watch_days', watch,
      'total', (select count(*) from waiting),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', w.id,
          'cnj', w.cnj,
          'court', w.court,
          'available_on', w.available_on,
          'kind', w.kind,
          'head', left(w.head, 400),
          'case_id', w.case_id,
          'case_seq', (select c.seq from public.cases c where c.id = w.case_id),
          'proceeding_id', w.proceeding_id,
          'proceeding_kind', (select pr.kind from public.proceedings pr where pr.id = w.proceeding_id),
          'triaged_by', w.triaged_by,
          'triaged_at', w.triaged_at,
          -- The deadlines of its lawsuit that came from no publication: one may be this one's.
          'lawsuit_deadlines', coalesce((
            select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status, 'due_on', l.due_on)
              order by l.created_at desc)
            from (
              select d.id, d.title, d.status, d.due_on, d.created_at from public.deadlines d
              where d.org_id = target_org and d.cnj = w.cnj and d.publication_id is null and d.status <> 'dismissed'
              order by d.created_at desc
              limit 5
            ) l
          ), '[]'::jsonb)
        ) order by w.available_on, w.id)
        from (select * from waiting order by available_on, id limit size) w
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_publications_without_deadline(uuid, integer) from public, anon;
grant execute on function public.firm_publications_without_deadline(uuid, integer) to authenticated;

/**
 * A person says a deadline of a lawsuit, recorded from a day (an intimation
 * read in the court's system), is the one of a publication of that lawsuit:
 * the publication then has its deadline, and the deadline follows what the
 * publication is (a cancelling of it is shown on the deadline). The same
 * firm and lawsuit, a deadline that came from no publication and was not
 * dismissed, a publication in force. Who signs, or who runs the firm's
 * deadlines; never a support visit.
 */
create or replace function public.link_deadline_publication(target_deadline uuid, target_publication uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
  publication public.publications%rowtype;
begin
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  select * into publication from public.publications
  where id = target_publication and org_id = current_deadline.org_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not publication.active then
    return jsonb_build_object('ok', false, 'code', 'cancelled');
  end if;
  if publication.cnj <> current_deadline.cnj or current_deadline.publication_id is not null
     or current_deadline.status = 'dismissed' then
    return jsonb_build_object('ok', false, 'code', 'not_linkable');
  end if;
  update public.deadlines set publication_id = publication.id where id = current_deadline.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.publication_linked', 'deadline', current_deadline.id::text,
    jsonb_build_object('publication', publication.id));
  return jsonb_build_object('ok', true, 'code', 'linked');
end;
$$;

revoke all on function public.link_deadline_publication(uuid, uuid) from public, anon;
grant execute on function public.link_deadline_publication(uuid, uuid) to authenticated;

-- ---------- What only the operator changes ----------

/**
 * The operator records a year of a court's calendar as checked against the
 * court's act: where it was read, and whose comarcas' own days it holds.
 * When what a count reads of the year changed (a year now checked, the
 * comarcas it holds), the open deadlines of the court whose count goes
 * through that year are counted again; checking the year again on a later
 * day changes no count.
 */
create or replace function public.admin_save_calendar_year(
  target_court text,
  target_year integer,
  target_source_url text,
  target_source_title text,
  target_all_comarcas boolean,
  target_comarcas text[],
  target_checked_on date,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  names text[];
  before public.court_calendar_years%rowtype;
  recounted integer := 0;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courts c where c.acronym = target_court) then
    return jsonb_build_object('ok', false, 'code', 'court_not_found');
  end if;
  if target_checked_on is null or target_checked_on > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_value', 'field', 'checked_on');
  end if;
  select * into before from public.court_calendar_years where court = target_court and year = target_year;
  names := array(
    select distinct public.deadline_text(n) from unnest(coalesce(target_comarcas, '{}'::text[])) as n
    where public.deadline_text(n) is not null order by 1
  );
  insert into public.court_calendar_years as y (
    court, year, source_url, source_title, all_comarcas, comarcas, checked_on, note, updated_by
  ) values (
    target_court, target_year, btrim(coalesce(target_source_url, '')), public.deadline_text(target_source_title),
    coalesce(target_all_comarcas, false), case when coalesce(target_all_comarcas, false) then '{}'::text[] else names end,
    target_checked_on, public.deadline_text(target_note), caller
  )
  on conflict (court, year) do update set
    source_url = excluded.source_url,
    source_title = excluded.source_title,
    all_comarcas = excluded.all_comarcas,
    comarcas = excluded.comarcas,
    checked_on = excluded.checked_on,
    note = excluded.note,
    updated_by = caller,
    updated_at = now();
  -- A count says what the year holds: it is counted again when that changed (a year now checked, the
  -- comarcas it holds), never for a note, an address or the day the year was checked again (that day is
  -- read beside a count, `firm_deadlines`, and is not what a count is made of).
  if before.court is null or before.all_comarcas is distinct from coalesce(target_all_comarcas, false)
     or before.comarcas is distinct from (case when coalesce(target_all_comarcas, false) then '{}'::text[] else names end) then
    recounted := public.recount_court_deadlines(target_court, make_date(target_year, 1, 1), make_date(target_year, 12, 31));
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.calendar.year_saved', 'court_calendar', target_court || '/' || target_year,
    jsonb_build_object('all_comarcas', coalesce(target_all_comarcas, false), 'comarcas', cardinality(names),
      'recounted', recounted));
  return jsonb_build_object('ok', true, 'code', 'saved', 'recounted', recounted);
exception when check_violation or not_null_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.admin_save_calendar_year(text, integer, text, text, boolean, text[], date, text) from public, anon;
grant execute on function public.admin_save_calendar_year(text, integer, text, text, boolean, text[], date, text) to authenticated;

/** The operator takes a year back as not checked: its days stay, and the deadlines it reaches say the year is not checked. */
create or replace function public.admin_remove_calendar_year(target_court text, target_year integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  recounted integer;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.court_calendar_years where court = target_court and year = target_year;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  recounted := public.recount_court_deadlines(target_court, make_date(target_year, 1, 1), make_date(target_year, 12, 31));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.calendar.year_removed', 'court_calendar', target_court || '/' || target_year,
    jsonb_build_object('recounted', recounted));
  return jsonb_build_object('ok', true, 'code', 'removed', 'recounted', recounted);
end;
$$;

revoke all on function public.admin_remove_calendar_year(text, integer) from public, anon;
grant execute on function public.admin_remove_calendar_year(text, integer) to authenticated;

/**
 * The operator records a day of a court's calendar, or the days of a span
 * (a recess), each the same: what it is, what the act calls it, and who it
 * applies to. Named by its id, an existing day is changed instead. The open
 * deadlines of the court whose count goes through those days are counted
 * again.
 */
create or replace function public.admin_save_calendar_day(
  target_day_id uuid,
  target_court text,
  target_day date,
  target_last_day date,
  target_kind text,
  target_label text,
  target_proceeding_kinds text[],
  target_systems text[],
  target_comarcas text[],
  target_source_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  label_value text := public.deadline_text(target_label);
  last_day date := coalesce(target_last_day, target_day);
  names text[];
  kinds text[];
  systems_value text[];
  source text := nullif(btrim(coalesce(target_source_url, '')), '');
  saved integer := 0;
  recounted integer := 0;
  before_day public.court_calendar_days%rowtype;
  reads_changed boolean := true;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courts c where c.acronym = target_court) then
    return jsonb_build_object('ok', false, 'code', 'court_not_found');
  end if;
  if target_day is null or last_day < target_day or last_day - target_day > 62 then
    return jsonb_build_object('ok', false, 'code', 'invalid_value', 'field', 'day');
  end if;
  names := array(
    select distinct public.deadline_text(n) from unnest(coalesce(target_comarcas, '{}'::text[])) as n
    where public.deadline_text(n) is not null order by 1
  );
  kinds := array(select distinct k from unnest(coalesce(target_proceeding_kinds, '{}'::text[])) as k order by 1);
  systems_value := array(select distinct s from unnest(coalesce(target_systems, '{}'::text[])) as s order by 1);

  if target_day_id is not null then
    if last_day <> target_day then
      return jsonb_build_object('ok', false, 'code', 'invalid_value', 'field', 'day');
    end if;
    select * into before_day from public.court_calendar_days c where c.id = target_day_id and c.court = target_court
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    update public.court_calendar_days set
      day = target_day, kind = target_kind, label = label_value, proceeding_kinds = kinds, systems = systems_value,
      comarcas = names, source_url = source
    where id = target_day_id;
    saved := 1;
    -- Where a day was read is no part of a count.
    reads_changed := before_day.day <> target_day or before_day.kind is distinct from target_kind
      or before_day.label is distinct from label_value or before_day.proceeding_kinds is distinct from kinds
      or before_day.systems is distinct from systems_value or before_day.comarcas is distinct from names;
  else
    insert into public.court_calendar_days as c (
      court, day, kind, label, proceeding_kinds, systems, comarcas, source_url, created_by
    )
    select target_court, d::date, target_kind, label_value, kinds, systems_value, names, source, caller
    from generate_series(target_day, last_day, interval '1 day') as d
    on conflict (court, day, kind, label) do update set
      proceeding_kinds = excluded.proceeding_kinds,
      systems = excluded.systems,
      comarcas = excluded.comarcas,
      source_url = excluded.source_url;
    get diagnostics saved = row_count;
  end if;

  -- The day it was, when it moved, and the days it is now.
  if reads_changed then
    recounted := public.recount_court_deadlines(target_court, least(target_day, coalesce(before_day.day, target_day)),
      greatest(last_day, coalesce(before_day.day, last_day)));
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.calendar.day_saved', 'court_calendar', target_court || '/' || target_day,
    jsonb_build_object('last_day', last_day, 'kind', target_kind, 'days', saved, 'recounted', recounted));
  return jsonb_build_object('ok', true, 'code', 'saved', 'days', saved, 'recounted', recounted);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate');
  when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.admin_save_calendar_day(uuid, text, date, date, text, text, text[], text[], text[], text)
  from public, anon;
grant execute on function public.admin_save_calendar_day(uuid, text, date, date, text, text, text[], text[], text[], text)
  to authenticated;

/** The operator removes a day of a court's calendar. The open deadlines of the court whose count goes through it are counted again. */
create or replace function public.admin_remove_calendar_day(target_day_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  removed public.court_calendar_days%rowtype;
  recounted integer;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.court_calendar_days where id = target_day_id returning * into removed;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  recounted := public.recount_court_deadlines(removed.court, removed.day, removed.day);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.calendar.day_removed', 'court_calendar', removed.court || '/' || removed.day,
    jsonb_build_object('kind', removed.kind, 'recounted', recounted));
  return jsonb_build_object('ok', true, 'code', 'removed', 'recounted', recounted);
end;
$$;

revoke all on function public.admin_remove_calendar_day(uuid) from public, anon;
grant execute on function public.admin_remove_calendar_day(uuid) to authenticated;

/** The operator adds an act to the list, or changes one: its name, its days, the law that gives them. */
create or replace function public.admin_save_deadline_act(
  target_slug text,
  target_name text,
  target_days integer,
  target_counting text,
  target_proceeding_kinds text[],
  target_basis text,
  target_position integer,
  target_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.deadline_acts as a (slug, name, days, counting, proceeding_kinds, basis, position, active, updated_by)
  values (
    btrim(coalesce(target_slug, '')), public.deadline_text(target_name), target_days, coalesce(target_counting, 'business'),
    array(select distinct k from unnest(coalesce(target_proceeding_kinds, '{}'::text[])) as k order by 1),
    public.deadline_text(target_basis), coalesce(target_position, 100), coalesce(target_active, true), caller
  )
  on conflict (slug) do update set
    name = excluded.name,
    days = excluded.days,
    counting = excluded.counting,
    proceeding_kinds = excluded.proceeding_kinds,
    basis = excluded.basis,
    position = excluded.position,
    active = excluded.active,
    updated_by = caller,
    updated_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.deadline_act.saved', 'deadline_act', btrim(coalesce(target_slug, '')),
    jsonb_build_object('days', target_days, 'active', coalesce(target_active, true)));
  return jsonb_build_object('ok', true, 'code', 'saved');
exception when check_violation or not_null_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.admin_save_deadline_act(text, text, integer, text, text[], text, integer, boolean) from public, anon;
grant execute on function public.admin_save_deadline_act(text, text, integer, text, text[], text, integer, boolean) to authenticated;

-- ---------- The calendar of the Tribunal de Justiça de Goiás ----------

-- Read on 2026-10-11 in the court's list of holidays for 2026 (version of 8 June 2026), which says its
-- basis: art. 123 of the court's Regimento Interno (Resolução nº 170/2021) and art. 91 of the Código de
-- Organização Judiciária do Estado de Goiás (Lei nº 21.268/2022). It names the days of the court and of
-- all its comarcas, and of the municipal holidays only the one Goiânia (the court's seat) shares with
-- three other comarcas. The national holidays of federal law are the rule's own and are not repeated.
insert into public.court_calendar_years (court, year, source_url, source_title, all_comarcas, comarcas, checked_on, note) values (
  'TJGO', 2026,
  'https://docs.tjgo.jus.br/institucional/feriados/DOC_feriados_2026_08062026.pdf',
  'Feriados 2026 do Tribunal de Justiça do Estado de Goiás (versão de 08/06/2026)',
  false, array['Goiânia'], date '2026-10-11',
  'Traz os feriados e pontos facultativos do Tribunal e de todas as comarcas. Dos feriados municipais, só os de Goiânia, sede do Tribunal. O Tribunal avisa que as datas podem mudar e que a Presidência pode decretar pontos facultativos no curso do ano.'
)
on conflict (court, year) do nothing;

insert into public.court_calendar_days (court, day, kind, label, comarcas)
select 'TJGO', d.day, d.kind, d.label, d.comarcas
from (values
  (date '2026-02-16', 'closed', 'Carnaval', '{}'::text[]),
  (date '2026-02-17', 'closed', 'Carnaval', '{}'::text[]),
  (date '2026-02-18', 'partial', 'Carnaval (feriado até 12h)', '{}'::text[]),
  (date '2026-03-20', 'closed', 'Ponto facultativo (MotoGP em Goiânia)', '{}'::text[]),
  (date '2026-04-01', 'closed', 'Semana Santa', '{}'::text[]),
  (date '2026-04-02', 'closed', 'Semana Santa', '{}'::text[]),
  (date '2026-04-03', 'closed', 'Semana Santa', '{}'::text[]),
  (date '2026-04-20', 'closed', 'Ponto facultativo', '{}'::text[]),
  (date '2026-05-24', 'closed', 'Dia de Nossa Senhora Auxiliadora', array['Goiânia', 'Iporá', 'Leopoldo de Bulhões', 'Senador Canedo']),
  (date '2026-06-04', 'closed', 'Corpus Christi', '{}'::text[]),
  (date '2026-06-05', 'closed', 'Ponto facultativo', '{}'::text[]),
  (date '2026-07-26', 'closed', 'Fundação da Cidade de Goiás', '{}'::text[]),
  (date '2026-10-24', 'closed', 'Aniversário de Goiânia', '{}'::text[]),
  (date '2026-10-28', 'closed', 'Dia do Servidor Público', '{}'::text[]),
  (date '2026-12-08', 'closed', 'Dia da Justiça', '{}'::text[])
) as d (day, kind, label, comarcas)
union all
-- The recess, from 20 December 2026 to 6 January 2027 (art. 123 of the Regimento Interno): the days of
-- 2027 are said by this list, while the calendar of 2027 itself is not checked yet.
select 'TJGO', d::date, 'closed', 'Recesso forense', '{}'::text[]
from generate_series(date '2026-12-20', date '2027-01-06', interval '1 day') as d
on conflict (court, day, kind, label) do nothing;

-- ---------- What needs somebody today ----------

/**
 * What needs somebody of the firm today (replaces the one of 0031), with the
 * deadlines: the ones waiting for who confirms, the ones due today or in the
 * next days, the ones past their day (each by the day it is urgent by), the
 * ones to look at again, and the publications triaged as a deadline that no
 * deadline came from.
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
