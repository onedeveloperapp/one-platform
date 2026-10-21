-- 0032_portfolio_import.sql
--
-- A firm brings the lawsuits it already has in court from the spreadsheet of
-- the system it used before (docs/ONE-PLANO-DESENVOLVIMENTO.md, S8). The
-- spreadsheet is read in the person's browser; what comes here is the lines
-- the person confirmed, each a lawsuit by its number. A lawsuit is matched by
-- its number: one the firm already has is never opened twice.
--
--   setting `import`    how many lines a batch holds, how many a call takes, how long a batch nobody
--                       finished is kept, the oldest day a lawsuit is taken to be distributed on
--   airlines.court_names   the names an airline is written by in court, which a spreadsheet repeats
--   import_batches      one per spreadsheet a person brought, with what came of it
--   import_rows         its lines: the lawsuit's number, what the line said, and what it became
--
-- A batch is committed a few lines a call, and undone the same way: each
-- line is decided once, so a call that is cut is asked again and goes on, and
-- a line that cannot be written is refused alone. Undoing removes the cases
-- the batch opened that nobody touched since; a case somebody worked on
-- stays, and the answer says how many did. What a spreadsheet said of people
-- stays here only while its batch is being brought: a batch that ended (all
-- its lines decided, undone, or left for too long) keeps each lawsuit's
-- number and what became of it, nothing else.

insert into public.platform_settings (key, value, is_public) values
  ('import', jsonb_build_object(
    -- The most lines one batch holds, and the most one call adds or decides.
    'max_rows', 20000,
    'rows_per_call', 200,
    -- A batch nobody finished is closed this many days after its last call, and what its lines said of
    -- people (a name, a CPF) goes with that.
    'keep_days', 7,
    -- A day of distribution before this one is no lawsuit's (an old system writes "01/01/1900" for none):
    -- the line goes without it.
    'oldest_filed_on', '1990-01-01'
  ), false)
on conflict (key) do nothing;

/** An integer of the setting `import`, or the fallback. Internal. */
create or replace function public.import_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> setting ~ '^[0-9]{1,9}$' then (s.value ->> setting)::integer end
     from public.platform_settings s where s.key = 'import'),
    fallback
  );
$$;

revoke all on function public.import_setting(text, integer) from public, anon, authenticated;

/** A day written "YYYY-MM-DD", when it is a day of the calendar; null otherwise ("2026-02-31"). Internal. */
create or replace function public.import_day(value text)
returns date
language plpgsql
stable
set search_path = public
as $$
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return value::date;
exception when others then
  return null;
end;
$$;

revoke all on function public.import_day(text) from public, anon, authenticated;

/** The oldest day a lawsuit of a spreadsheet is taken to be distributed on (the setting's). Internal. */
create or replace function public.import_oldest_day()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.import_day(s.value ->> 'oldest_filed_on') from public.platform_settings s where s.key = 'import'),
    date '1990-01-01'
  );
$$;

revoke all on function public.import_oldest_day() from public, anon, authenticated;

/**
 * What the screen reads a spreadsheet by: how many lines a batch holds and a
 * call takes, and the oldest day of distribution a line may carry. The
 * numbers are the setting's, so a screen never sends what a call refuses.
 */
create or replace function public.import_limits()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'max_rows', greatest(public.import_setting('max_rows', 20000), 1),
    'rows_per_call', greatest(public.import_setting('rows_per_call', 200), 1),
    'oldest_filed_on', to_char(public.import_oldest_day(), 'YYYY-MM-DD'));
$$;

revoke all on function public.import_limits() from public, anon;
grant execute on function public.import_limits() to authenticated;

/**
 * Whether two ways of writing a name are one person's, as a spreadsheet and
 * the firm's record may write it: the same first name (or its initial), and
 * every word of the shorter one in the longer one (an initial for a word),
 * with no accents, no case and no particles ("da", "de", "do", "das", "dos",
 * "e"), an apostrophe joining what it separates ("D'Ávila" is one word).
 * "Maria Teste" is "MARIA TESTE DA SILVA"; "Pedro Teste" is not "Maria
 * Teste". The same rule as `namesMatch` of `apps/web/src/lib/import`, the
 * letters read as `slugify` reads them. Internal.
 */
create or replace function public.import_names_match(first_name text, second_name text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  -- The words of each, with no accents, no case and no particles.
  a text[] := array(
    select w from regexp_split_to_table(public.slugify(regexp_replace(coalesce(first_name, ''), '[''’‘`´]', '', 'g')), '-') as w
    where w <> '' and not w = any (array['da', 'de', 'do', 'das', 'dos', 'e']));
  b text[] := array(
    select w from regexp_split_to_table(public.slugify(regexp_replace(coalesce(second_name, ''), '[''’‘`´]', '', 'g')), '-') as w
    where w <> '' and not w = any (array['da', 'de', 'do', 'das', 'dos', 'e']));
  shorter text[];
  longer text[];
  word text;
begin
  if cardinality(a) = 0 or cardinality(b) = 0 then
    return false;
  end if;
  if not (a[1] = b[1] or (char_length(a[1]) = 1 and left(b[1], 1) = a[1])
          or (char_length(b[1]) = 1 and left(a[1], 1) = b[1])) then
    return false;
  end if;
  if cardinality(a) <= cardinality(b) then
    shorter := a;
    longer := b;
  else
    shorter := b;
    longer := a;
  end if;
  foreach word in array shorter loop
    if not exists (
      select 1 from unnest(longer) as other
      where other = word or (char_length(word) = 1 and left(other, 1) = word)
         or (char_length(other) = 1 and left(word, 1) = other)
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.import_names_match(text, text) from public, anon, authenticated;

-- ---------- The airlines, as a party is named in court ----------

/** True when every element is a name (2 to 120 characters, trimmed, nothing a keyboard does not type); twelve at most. Internal. */
create or replace function public.court_names_ok(names text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(n = btrim(n) and char_length(n) between 2 and 120 and n !~ '[[:cntrl:]]'), true)
         and coalesce(cardinality(names), 0) <= 12
  from unnest(names) as n;
$$;

revoke all on function public.court_names_ok(text[]) from public, anon, authenticated;

-- A firm's old records name the other party as the court does, by the company that answers there, which
-- is often not the name on the aircraft: "TAM Linhas Aéreas S.A." is LATAM in Brazil, "Passaredo
-- Transportes Aéreos S.A." is Voepass, "VRG Linhas Aéreas S.A." was Gol's name. These are the names an
-- airline is recognised by in a spreadsheet, before its own and beside its `legal_name`. Each was read in
-- the company's public registration (2026-10-11); the list is the operator's to complete. LATAM's
-- Brazilian company is read as "LA", the designator its flights are sold under (0030), whichever of its
-- names the spreadsheet writes.
alter table public.airlines add column court_names text[] not null default '{}';
alter table public.airlines add constraint airlines_court_names_check check (public.court_names_ok(court_names));

-- Avianca Brasil (Oceanair Linhas Aéreas), which stopped flying in 2019 and whose lawsuits may still be in a
-- firm's portfolio: inactive, so no case is opened under it, and known by its names, so that a party named
-- "Oceanair (Avianca Brasil)" is never read as Avianca, which is another company.
insert into public.airlines (iata, name, country, active) values ('O6', 'Avianca Brasil', 'BR', false)
on conflict (iata) do nothing;

update public.airlines a set court_names = d.names
from (values
  ('LA', array['TAM', 'LATAM Airlines', 'LATAM Brasil', 'LATAM Airlines Brasil']),
  ('G3', array['VRG']),
  ('2Z', array['Passaredo']),
  ('TP', array['Transportes Aéreos Portugueses']),
  ('O6', array['Oceanair', 'Avianca Brasil'])
) as d (iata, names)
where a.iata = d.iata;

-- ---------- The batches and their lines ----------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'portfolio',
  -- The file as the person named it, and the system it came from, as she said.
  file_name text,
  source_system text,
  -- staged     its lines wait for the person to commit them (or are being decided, a few a call);
  -- committed  every line was decided;
  -- reverted   the cases it opened that nobody touched were removed.
  status text not null default 'staged',
  rows_count integer not null default 0,
  -- What came of its lines, counted when it was committed and when it was undone.
  counts jsonb,
  -- What the person's screen counted of the whole file when the batch started (its lines, the lawsuits
  -- the firm already had, the repeated ones, the ones not read): the record of the spreadsheet, never
  -- trusted for anything the batch decides.
  file_counts jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  reverted_at timestamptz,
  -- Every call that adds, decides or undoes lines moves it: the daily sweep counts from it.
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint import_batches_kind_check check (kind in ('portfolio')),
  constraint import_batches_status_check check (status in ('staged', 'committed', 'reverted')),
  constraint import_batches_text_check check (
    coalesce(char_length(file_name), 0) <= 200 and coalesce(char_length(source_system), 0) <= 80
  ),
  constraint import_batches_file_counts_check check (
    file_counts is null or (jsonb_typeof(file_counts) = 'object' and octet_length(file_counts::text) <= 400)
  )
);

create index import_batches_org_idx on public.import_batches (org_id, created_at desc);

alter table public.import_batches enable row level security;
create policy "import_batches_select_member" on public.import_batches
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.import_batches to authenticated;
create trigger import_batches_updated_at before update on public.import_batches
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_import_batches after insert or update or delete on public.import_batches
  for each statement execute function public.guard_impersonation_readonly();

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  -- The line of the spreadsheet, as the person sees it.
  row_number integer not null,
  cnj text not null,
  -- What the line said: the client (`client_name`, `cpf`), the airline, the kind, the court, the unit, the
  -- comarca, the day it was distributed, whether it ended, and the firm's note. Emptied when the batch ends.
  fields jsonb not null default '{}'::jsonb,
  -- created   a case was opened for it (`code` `cpf_other_name`: its client was written without the CPF,
  --           which the firm has for another person);
  -- exists    the firm already had the lawsuit;
  -- refused   it could not be written, or its batch ended before it was decided (`code`);
  -- reverted  the case it opened was removed;
  -- kept      its batch was undone, and its case stayed because somebody worked on it.
  outcome text,
  code text,
  decided_at timestamptz,
  case_id uuid references public.cases (id) on delete set null,
  proceeding_id uuid references public.proceedings (id) on delete set null,
  person_id uuid references public.people (id) on delete set null,
  -- The person was written by this line (and not one the firm already had by the CPF).
  person_created boolean not null default false,
  unique (batch_id, row_number),
  unique (batch_id, cnj),
  foreign key (batch_id, org_id) references public.import_batches (id, org_id) on delete cascade,
  constraint import_rows_row_check check (row_number > 0),
  constraint import_rows_cnj_check check (public.cnj_is_valid(cnj)),
  constraint import_rows_fields_check check (jsonb_typeof(fields) = 'object' and octet_length(fields::text) <= 6000),
  constraint import_rows_outcome_check check (
    outcome is null or outcome in ('created', 'exists', 'refused', 'reverted', 'kept')
  ),
  constraint import_rows_code_check check (code is null or code ~ '^[a-z][a-z0-9_]{1,59}$')
);

create index import_rows_pending_idx on public.import_rows (batch_id, row_number) where outcome is null;
create index import_rows_case_idx on public.import_rows (case_id) where case_id is not null;
create index import_rows_person_idx on public.import_rows (person_id) where person_id is not null;
create index import_rows_proceeding_idx on public.import_rows (proceeding_id) where proceeding_id is not null;

alter table public.import_rows enable row level security;
create policy "import_rows_select_member" on public.import_rows
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.import_rows to authenticated;
create trigger guard_impersonation_import_rows after insert or update or delete on public.import_rows
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Who brings a portfolio ----------

/**
 * The batch, for who may write it: a partner, a lawyer or who runs the
 * firm's deadlines, of the batch's own firm, never in a support visit. The
 * batch is locked, so two calls deciding its lines wait for each other.
 * Internal.
 */
create or replace function public.import_batch_for_writer(target_batch uuid)
returns public.import_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.import_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into batch from public.import_batches where id = target_batch for update;
  if not found or not exists (
    select 1 from public.memberships m
    where m.org_id = batch.org_id and m.user_id = auth.uid() and m.firm_function in ('socio', 'advogado', 'controladoria')
  ) then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  return batch;
end;
$$;

revoke all on function public.import_batch_for_writer(uuid) from public, anon, authenticated;

/**
 * Which of these lawsuits (twenty digits each, a thousand at most) the firm
 * already has: what the screen marks as already in ONE before anything is
 * sent. Anybody of the firm; the list travels in the request's body.
 */
create or replace function public.known_lawsuits(target_org uuid, target_cnjs text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if coalesce(cardinality(target_cnjs), 0) > 1000 then
    raise exception 'too_many_numbers' using errcode = '22023';
  end if;
  return array(
    select distinct p.cnj from public.proceedings p
    where p.org_id = target_org and p.cnj = any (coalesce(target_cnjs, '{}'::text[]))
    order by p.cnj
  );
end;
$$;

revoke all on function public.known_lawsuits(uuid, text[]) from public, anon;
grant execute on function public.known_lawsuits(uuid, text[]) to authenticated;

/**
 * A person starts bringing a spreadsheet: the batch its lines will join,
 * with what the person's screen counted of the whole file. A partner, a
 * lawyer or who runs the firm's deadlines; never a support visit.
 */
create or replace function public.create_import_batch(
  target_org uuid,
  target_file_name text default null,
  target_source text default null,
  target_file_counts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch uuid;
  counted jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.firm_function in ('socio', 'advogado', 'controladoria')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  -- Only the counts the screen has, each a whole number: anything else is left out.
  counted := (
    select jsonb_object_agg(item.key, item.value::integer)
    from jsonb_each_text(case when jsonb_typeof(target_file_counts) = 'object' then target_file_counts else '{}'::jsonb end) as item
    where item.key in ('lines', 'exists', 'duplicate', 'error', 'over') and item.value ~ '^[0-9]{1,7}$'
  );
  insert into public.import_batches (org_id, file_name, source_system, file_counts, created_by)
  values (target_org, nullif(left(btrim(coalesce(target_file_name, '')), 200), ''),
          nullif(left(btrim(coalesce(target_source, '')), 80), ''), counted, auth.uid())
  returning id into batch;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'import.started', 'import_batch', batch::text, coalesce(counted, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'code', 'staged', 'batch_id', batch);
end;
$$;

revoke all on function public.create_import_batch(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_import_batch(uuid, text, text, jsonb) to authenticated;

/**
 * Lines join a batch still staged, a few a call: each `{ row, cnj,
 * client_name, cpf, airline, kind, court, unit, comarca, filed_on, closed,
 * summary }`, checked here again (what the browser read is never trusted): a
 * valid number of the court named, a name, a CPF that is one, a kind, a day
 * of the calendar between the setting's oldest and today, an airline ONE
 * knows. One line that is not right refuses the call, and says which and
 * what of it (`row`, `field`).
 */
create or replace function public.add_import_rows(target_batch uuid, target_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.import_batches%rowtype := public.import_batch_for_writer(target_batch);
  most integer := greatest(public.import_setting('max_rows', 20000), 1);
  per_call integer := greatest(public.import_setting('rows_per_call', 200), 1);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  oldest date := public.import_oldest_day();
  bad_line integer;
  bad_field text;
  added integer;
begin
  if batch.status <> 'staged' or exists (select 1 from public.import_rows r where r.batch_id = batch.id and r.outcome is not null) then
    return jsonb_build_object('ok', false, 'code', 'batch_not_staged');
  end if;
  if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows) = 0
     or jsonb_array_length(target_rows) > per_call then
    return jsonb_build_object('ok', false, 'code', 'invalid_rows');
  end if;
  if batch.rows_count + jsonb_array_length(target_rows) > most then
    return jsonb_build_object('ok', false, 'code', 'too_many_rows');
  end if;

  select item.line, item.field into bad_line, bad_field
  from (
    select case when r ->> 'row' ~ '^[0-9]{1,7}$' then (r ->> 'row')::integer end as line,
      case
        when jsonb_typeof(r) <> 'object' or coalesce(r ->> 'row', '') !~ '^[1-9][0-9]{0,6}$' then 'row'
        when not public.cnj_is_valid(coalesce(r ->> 'cnj', '')) then 'cnj'
        when char_length(btrim(coalesce(r ->> 'client_name', ''))) not between 3 and 200 then 'client_name'
        when r ->> 'cpf' is not null and not public.cpf_is_valid(r ->> 'cpf') then 'cpf'
        when coalesce(r ->> 'kind', '') not in ('juizado', 'comum') then 'kind'
        when not exists (
          select 1 from public.courts c
          where c.acronym = r ->> 'court' and c.cnj_segment = substr(r ->> 'cnj', 14, 1) and c.cnj_code = substr(r ->> 'cnj', 15, 2)
        ) then 'court'
        when r ->> 'airline' is not null and not exists (
          select 1 from public.airlines a where a.iata = r ->> 'airline' and a.active
        ) then 'airline'
        when r ->> 'filed_on' is not null
             and coalesce(public.import_day(r ->> 'filed_on') not between oldest and today, true) then 'filed_on'
        when coalesce(jsonb_typeof(r -> 'closed'), 'boolean') <> 'boolean' then 'closed'
        when coalesce(char_length(r ->> 'unit'), 0) > 200 or coalesce(char_length(r ->> 'comarca'), 0) > 120
             or coalesce(char_length(r ->> 'summary'), 0) > 1000 then 'text'
      end as field
    from jsonb_array_elements(target_rows) as r
  ) as item
  where item.field is not null
  limit 1;
  if bad_field is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_row', 'row', bad_line, 'field', bad_field);
  end if;

  begin
    insert into public.import_rows (org_id, batch_id, row_number, cnj, fields)
    select batch.org_id, batch.id, (r ->> 'row')::integer, r ->> 'cnj',
           jsonb_strip_nulls(jsonb_build_object(
             'client_name', left(regexp_replace(btrim(r ->> 'client_name'), '\s+', ' ', 'g'), 200),
             'cpf', r ->> 'cpf', 'airline', r ->> 'airline', 'kind', r ->> 'kind', 'court', r ->> 'court',
             'unit', nullif(btrim(coalesce(r ->> 'unit', '')), ''), 'comarca', nullif(btrim(coalesce(r ->> 'comarca', '')), ''),
             'filed_on', r ->> 'filed_on', 'closed', coalesce((r ->> 'closed')::boolean, false),
             'summary', nullif(btrim(coalesce(r ->> 'summary', '')), '')))
    from jsonb_array_elements(target_rows) r;
    get diagnostics added = row_count;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'repeated_line');
  end;
  update public.import_batches set rows_count = rows_count + added where id = batch.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (batch.org_id, auth.uid(), 'import.lines_added', 'import_batch', batch.id::text,
          jsonb_build_object('added', added, 'rows', batch.rows_count + added));
  return jsonb_build_object('ok', true, 'code', 'added', 'rows', batch.rows_count + added);
end;
$$;

revoke all on function public.add_import_rows(uuid, jsonb) from public, anon;
grant execute on function public.add_import_rows(uuid, jsonb) to authenticated;

/** What came of a batch's lines, counted. Internal. */
create or replace function public.import_batch_counts(target_batch uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rows', count(*),
    'pending', count(*) filter (where r.outcome is null),
    'created', count(*) filter (where r.outcome = 'created'),
    'exists', count(*) filter (where r.outcome = 'exists'),
    'refused', count(*) filter (where r.outcome = 'refused'),
    'reverted', count(*) filter (where r.outcome = 'reverted'),
    'kept', count(*) filter (where r.outcome = 'kept'))
  from public.import_rows r where r.batch_id = target_batch;
$$;

revoke all on function public.import_batch_counts(uuid) from public, anon, authenticated;

/**
 * Decides a few lines of a batch, in their order, and says how many are
 * left: the caller asks again until none is. Each line once: a lawsuit the
 * firm already has is left as it is (`exists`); another opens a case, with
 * its client (the one the firm has by the CPF, under the name the firm gave
 * them, or a new one), the lawsuit as the court has it (filed, or closed)
 * and the case at the stage that is (`created`); one that cannot be written
 * leaves nothing behind and says why (`refused`), and so does one that fails
 * for a reason nobody foresaw: one line never holds the others back. A CPF
 * the firm has for a person of another name is that person's, and the
 * line's client is written without it (`cpf_other_name`): a lawsuit never
 * goes to somebody it is not of. With the second factor: a spreadsheet may
 * hold thousands of lawsuits. When no line is left, the batch is committed,
 * and its lines keep the lawsuit's number and what became of it, nothing of
 * what the spreadsheet said.
 */
create or replace function public.commit_import_batch(target_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.import_batches%rowtype := public.import_batch_for_writer(target_batch);
  per_call integer := greatest(public.import_setting('rows_per_call', 200), 1);
  line public.import_rows%rowtype;
  held record;
  known record;
  other_name boolean;
  opened jsonb;
  saved jsonb;
  refusal text;
  tally jsonb;
begin
  perform public.require_aal2();
  if batch.status <> 'staged' then
    return jsonb_build_object('ok', true, 'code', 'already_committed', 'counts', public.import_batch_counts(batch.id));
  end if;
  if batch.rows_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_rows');
  end if;
  -- A batch being brought is not one nobody finished: the daily sweep counts from its last call.
  update public.import_batches set updated_at = now() where id = batch.id;

  for line in
    select * from public.import_rows r where r.batch_id = batch.id and r.outcome is null order by r.row_number limit per_call
  loop
    select p.id, p.case_id into held from public.proceedings p where p.org_id = batch.org_id and p.cnj = line.cnj;
    if found then
      update public.import_rows
      set outcome = 'exists', decided_at = now(), case_id = held.case_id, proceeding_id = held.id
      where id = line.id;
      continue;
    end if;
    begin
      -- A client the firm already has, by the CPF, keeps the name the firm gave them: a spreadsheet never
      -- renames somebody, and undoing it would not give the name back. A CPF the firm has for a person of
      -- another name is that person's: the line's client is another, written without it.
      select p.id, p.full_name into known from public.people p where p.org_id = batch.org_id and p.cpf = line.fields ->> 'cpf';
      other_name := known.id is not null and not public.import_names_match(known.full_name, line.fields ->> 'client_name');
      opened := public.create_case(batch.org_id, 'other', line.fields ->> 'airline', null,
        jsonb_strip_nulls(jsonb_build_object(
          'full_name', case when known.id is not null and not other_name then known.full_name else line.fields ->> 'client_name' end,
          'cpf', case when other_name then null else line.fields ->> 'cpf' end)),
        null, line.fields ->> 'summary');
      if not coalesce((opened ->> 'ok')::boolean, false) then
        raise exception using errcode = 'P0001', message = coalesce(opened ->> 'code', 'case_refused');
      end if;
      saved := public.save_proceeding((opened ->> 'case_id')::uuid, null,
        jsonb_strip_nulls(jsonb_build_object(
          'kind', line.fields ->> 'kind', 'court', line.fields ->> 'court', 'cnj', line.cnj,
          'status', case when coalesce((line.fields ->> 'closed')::boolean, false) then 'closed' else 'filed' end,
          'filed_at', line.fields ->> 'filed_on', 'unit', line.fields ->> 'unit', 'comarca', line.fields ->> 'comarca')),
        array[(opened ->> 'party_id')::uuid]);
      if not coalesce((saved ->> 'ok')::boolean, false) then
        raise exception using errcode = 'P0001', message = coalesce(saved ->> 'code', 'lawsuit_refused');
      end if;
      -- The case is where its lawsuit is: in court, or ended.
      if coalesce((line.fields ->> 'closed')::boolean, false) then
        perform public.set_case_status((opened ->> 'case_id')::uuid, 'closed', 'Encerrado no sistema de onde foi importado');
      else
        perform public.set_case_status((opened ->> 'case_id')::uuid, 'filed');
      end if;
      perform public.record_case_event(batch.org_id, (opened ->> 'case_id')::uuid, 'imported', 'person',
        jsonb_build_object('batch', batch.id, 'line', line.row_number));
      update public.import_rows
      set outcome = 'created', decided_at = clock_timestamp(), case_id = (opened ->> 'case_id')::uuid,
          proceeding_id = (saved ->> 'proceeding_id')::uuid, person_id = (opened ->> 'person_id')::uuid,
          person_created = known.id is null or other_name,
          code = case when other_name then 'cpf_other_name' end
      where id = line.id;
    exception
      -- Who may not, and what passes by itself, is not about the line: the call fails and is asked again.
      when insufficient_privilege or serialization_failure or deadlock_detected or lock_not_available then
        raise;
      when others then
        -- What the line would have written is gone with it. A line that fails for any other reason is
        -- refused alone (`failed`), or the same line would stop every call after it.
        refusal := case when sqlstate = 'P0001'
          then coalesce(substring(lower(sqlerrm) from '^[a-z][a-z0-9_]{1,59}$'), 'refused') else 'failed' end;
        -- Somebody wrote this lawsuit while the line was being decided: the firm has it.
        select p.id, p.case_id into held from public.proceedings p where p.org_id = batch.org_id and p.cnj = line.cnj;
        if found then
          update public.import_rows
          set outcome = 'exists', decided_at = now(), case_id = held.case_id, proceeding_id = held.id
          where id = line.id;
        else
          update public.import_rows set outcome = 'refused', decided_at = now(), code = refusal where id = line.id;
        end if;
    end;
  end loop;

  tally := public.import_batch_counts(batch.id);
  if (tally ->> 'pending')::integer > 0 then
    return jsonb_build_object('ok', true, 'code', 'in_progress', 'counts', tally);
  end if;
  update public.import_batches set status = 'committed', committed_at = now(), counts = tally where id = batch.id;
  -- The people are the firm's clients now, or were not brought: the lines keep the lawsuit's number and
  -- what became of it, and nothing of what the spreadsheet said.
  update public.import_rows set fields = '{}'::jsonb where batch_id = batch.id and fields <> '{}'::jsonb;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (batch.org_id, auth.uid(), 'import.committed', 'import_batch', batch.id::text, tally);
  return jsonb_build_object('ok', true, 'code', 'committed', 'counts', tally);
end;
$$;

revoke all on function public.commit_import_batch(uuid) from public, anon;
grant execute on function public.commit_import_batch(uuid) to authenticated;

/**
 * Whether somebody did anything in a case a batch opened, since the batch
 * opened it: a person, a client or the AI wrote in its timeline; something
 * was asked of one of its lawsuits or its people that only the audit trail
 * records (a lawsuit's news marked as seen, a reading asked for); or a CPF
 * of its people was looked up at the registry. What the backend did by
 * itself (a reading of the court, a check of a flight) does not count.
 * Internal.
 */
create or replace function public.import_case_touched(target_case uuid, target_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.case_events e
      where e.case_id = target_case and e.actor_type <> 'system' and e.at > target_since
    )
    or exists (
      select 1 from public.proceedings p
      join public.audit_events a on a.entity_type = 'proceeding' and a.entity_id = p.id::text
      where p.case_id = target_case and a.actor_type <> 'system' and a.created_at > target_since
    )
    or exists (
      select 1 from public.case_parties cp
      join public.audit_events a on a.entity_type = 'person' and a.entity_id = cp.person_id::text
      where cp.case_id = target_case and a.actor_type <> 'system' and a.created_at > target_since
    )
    or exists (
      select 1 from public.case_parties cp
      join public.people p on p.id = cp.person_id
      where cp.case_id = target_case and p.cpf_checked_at > target_since
    );
$$;

revoke all on function public.import_case_touched(uuid, timestamptz) from public, anon, authenticated;

/**
 * Undoes a batch, a few lines a call: the case a line opened is removed when
 * nobody touched it since (`import_case_touched`); one somebody worked on
 * stays (`kept`). A case another spreadsheet not undone found in the firm
 * (`exists`) passes to that one: its line becomes the one that opened it,
 * and the case is undone with it (`kept`, `handed_over`). A client an import
 * wrote goes with the last case of theirs, whichever line of whichever
 * spreadsheet wrote them. Each case removed is on record as it goes. A batch
 * that stopped half way is undone as far as it went, and the lines nobody
 * decided are not brought (`undone`). With the second factor. The answer
 * counts, and says how many lines are left.
 */
create or replace function public.revert_import_batch(target_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.import_batches%rowtype := public.import_batch_for_writer(target_batch);
  per_call integer := greatest(public.import_setting('rows_per_call', 200), 1);
  line public.import_rows%rowtype;
  heir record;
  tally jsonb;
begin
  -- Nothing of it was written yet: there is nothing to undo, and the person gives it up instead.
  if batch.status = 'staged' and not exists (
    select 1 from public.import_rows r where r.batch_id = batch.id and r.outcome is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'batch_not_committed');
  end if;
  perform public.require_aal2();
  update public.import_batches set updated_at = now() where id = batch.id;

  for line in
    select * from public.import_rows r where r.batch_id = batch.id and r.outcome = 'created' order by r.row_number limit per_call
  loop
    if line.case_id is null then
      update public.import_rows set outcome = 'reverted', decided_at = now() where id = line.id;
      continue;
    end if;
    -- Another spreadsheet, not undone, found this case in the firm: it is that one's now.
    select r.id, r.batch_id into heir
    from public.import_rows r
    join public.import_batches b on b.id = r.batch_id
    where r.case_id = line.case_id and r.batch_id <> batch.id and r.outcome = 'exists' and b.status <> 'reverted'
    order by b.created_at desc
    limit 1;
    if found then
      update public.import_rows
      set outcome = 'created', decided_at = line.decided_at, person_id = line.person_id,
          person_created = line.person_created, code = line.code
      where id = heir.id;
      update public.import_rows set outcome = 'kept', code = 'handed_over', decided_at = now() where id = line.id;
    elsif public.import_case_touched(line.case_id, line.decided_at) then
      update public.import_rows set outcome = 'kept', decided_at = now() where id = line.id;
    else
      delete from public.cases where id = line.case_id and org_id = batch.org_id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (batch.org_id, auth.uid(), 'import.case_removed', 'case', line.case_id::text,
              jsonb_build_object('batch', batch.id, 'line', line.row_number, 'proceeding', line.proceeding_id));
      delete from public.people p
      where p.id = line.person_id and p.org_id = batch.org_id
        and not exists (select 1 from public.case_parties cp where cp.person_id = p.id)
        and exists (select 1 from public.import_rows r where r.person_id = p.id and r.person_created);
      update public.import_rows set outcome = 'reverted', decided_at = now() where id = line.id;
    end if;
  end loop;

  if exists (select 1 from public.import_rows r where r.batch_id = batch.id and r.outcome = 'created') then
    return jsonb_build_object('ok', true, 'code', 'in_progress', 'counts', public.import_batch_counts(batch.id));
  end if;
  if batch.status <> 'reverted' then
    update public.import_rows set outcome = 'refused', code = 'undone', decided_at = now()
    where batch_id = batch.id and outcome is null;
    update public.import_rows set fields = '{}'::jsonb where batch_id = batch.id and fields <> '{}'::jsonb;
    tally := public.import_batch_counts(batch.id);
    update public.import_batches set status = 'reverted', reverted_at = now(), counts = tally where id = batch.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (batch.org_id, auth.uid(), 'import.reverted', 'import_batch', batch.id::text, tally);
  end if;
  return jsonb_build_object('ok', true, 'code', 'reverted', 'counts', public.import_batch_counts(batch.id));
end;
$$;

revoke all on function public.revert_import_batch(uuid) from public, anon;
grant execute on function public.revert_import_batch(uuid) to authenticated;

/** A person gives up a batch none of whose lines was decided: it goes, with its lines, and that is on record. */
create or replace function public.discard_import_batch(target_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.import_batches%rowtype := public.import_batch_for_writer(target_batch);
begin
  if batch.status <> 'staged' or exists (select 1 from public.import_rows r where r.batch_id = batch.id and r.outcome is not null) then
    return jsonb_build_object('ok', false, 'code', 'batch_not_staged');
  end if;
  delete from public.import_batches where id = batch.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (batch.org_id, auth.uid(), 'import.discarded', 'import_batch', batch.id::text,
          jsonb_build_object('rows', batch.rows_count));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_import_batch(uuid) from public, anon;
grant execute on function public.discard_import_batch(uuid) to authenticated;

/**
 * A batch nobody finished does not keep what a spreadsheet said of people
 * for ever. After `keep_days` without a call, one none of whose lines was
 * decided goes, with its lines; one that stopped half way is closed as far
 * as it went: the lines nobody decided are not brought (`expired`), and the
 * cases it opened stay, to be undone by a person as with any batch. A batch
 * a call is working on is left alone. Each is on record. Service role only:
 * the daily sweep.
 */
create or replace function public.expire_import_batches()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer := greatest(public.import_setting('keep_days', 7), 1);
  stale record;
  tally jsonb;
  dropped integer := 0;
  closed integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for stale in
    select b.id, b.org_id, b.rows_count,
           exists (select 1 from public.import_rows r where r.batch_id = b.id and r.outcome is not null) as started
    from public.import_batches b
    where b.status = 'staged' and b.updated_at < now() - make_interval(days => days)
    order by b.updated_at
    limit 50
    for update of b skip locked
  loop
    if not stale.started then
      delete from public.import_batches where id = stale.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (stale.org_id, null, 'import.dropped', 'import_batch', stale.id::text, jsonb_build_object('rows', stale.rows_count));
      dropped := dropped + 1;
      continue;
    end if;
    update public.import_rows set outcome = 'refused', code = 'expired', decided_at = now()
    where batch_id = stale.id and outcome is null;
    update public.import_rows set fields = '{}'::jsonb where batch_id = stale.id and fields <> '{}'::jsonb;
    tally := public.import_batch_counts(stale.id);
    update public.import_batches set status = 'committed', committed_at = now(), counts = tally where id = stale.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (stale.org_id, null, 'import.expired', 'import_batch', stale.id::text, tally);
    closed := closed + 1;
  end loop;
  return jsonb_build_object('ok', true, 'dropped', dropped, 'closed', closed);
end;
$$;

revoke all on function public.expire_import_batches() from public, anon, authenticated;
