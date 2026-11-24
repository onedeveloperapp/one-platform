-- ============================================================
-- 0287_portfolio_by_one: the lawsuits a firm already has when it arrives, brought into ONE by ONE.
--
-- The owner, 2026-11-24, asked how a new firm's lawsuits in course and closed come into ONE, and whether its
-- people would open the cases by hand; on the answer ("pode seguir com os itens 1, 2 e 4"):
--
-- 1. The cases of the lawsuits the DJEN shows, opened by ONE (`open_case_from_djen`, a decision of each firm, ONE's
--    by default, as the case opened from a conversation). A lawsuit of the publications of the firm's lawyers that
--    no lawsuit of the firm has, of a court ONE knows, whose texts name an airline, of a firm that has the
--    passenger module, is owed a reading (`djen_case_reads`, prepared and claimed by the sweep `djen-cases`): the
--    DJEN is asked for it by its number, and from what its communications are addressed to, ONE takes the firm's
--    clients (the parties of the side that sues in the communications that go through a lawyer of the firm) and
--    the airline (the side sued, else the texts). ONE then opens the case in court (`filed`), with the lawsuit, its
--    claimants, its unit and its kind, inside a batch of the import of its own (`import_batches.kind` 'djen', one
--    a day), so the firm undoes it as any import, and ONE reads its history (0286). A firm that keeps the decision
--    with a person has the cases opened when a partner, a lawyer or the controladoria asks (`ask_djen_cases`). A
--    lawsuit ONE opened once is never opened by ONE again, even when the firm undid it: the firm's undoing stands.
--    Each case it opened, and the firm kept, is ONE's work of the month (`caso_aberto_djen`, `one_work_acts`).
-- 2. The history of every lawsuit an import brings still in course (`commit_import_batch`, redefined from 0032) is
--    owed to the DJEN at once (`queue_proceeding_history`, 0286), never asked lawsuit by lawsuit. A lawsuit the
--    old system says ended is brought as it is: its history waits for a lawyer to ask it (the cost of the AI's
--    reading of a closed portfolio is the owner's to weigh).
-- 3. What only the firm gives of those cases, the CPF of each client ONE named (`firm_djen_cases`,
--    `complete_djen_client`, which takes the person the firm already has by that CPF when the names are one).
-- 4. Where the firm's portfolio stands, for the home (`firm_portfolio`): whether it said it used a system before
--    and brought nothing from it yet, and what ONE opened.
--
-- Every person, number and text of its tests is invented.
-- ============================================================

-- ---------- The decision ----------

insert into public.autonomy_decisions (key, task, position, modes) values
  ('open_case_from_djen', null, 4, array['auto', 'approval'])
on conflict (key) do nothing;

-- ---------- What the DJEN names: the airlines, and who is no client ----------

/**
 * The airlines a text names (in capitals and with no accents, as the publications' words are compared, 0208): each
 * active one whose name in court, or its own name, is there as whole words ("TAM" is not in "ESTAMOS"). Internal.
 */
create or replace function public.airlines_named(target_words text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a.iata order by a.iata), '{}'::text[])
  from public.airlines a
  where a.active
    and exists (
      select 1 from unnest(coalesce(a.court_names, '{}'::text[]) || array[a.name]) n
      where char_length(n) >= 3
        and coalesce(target_words, '') ~ ('\m' || regexp_replace(translate(upper(n), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'),
                                                                 '([.*+?^$(){}|\\\[\]])', '\\\1', 'g') || '\M')
    );
$$;

revoke all on function public.airlines_named(text) from public, anon, authenticated;

/** A party's name as the publications' words are compared: in capitals, with no accents. Internal. */
create or replace function public.djen_words(target_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select translate(upper(coalesce(target_text, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN');
$$;

revoke all on function public.djen_words(text) from public, anon, authenticated;

/**
 * Whether a party's name is a company or a public body rather than a person a firm of passengers serves: a word of
 * a company's form or of an institution (never "SA" alone, which is "Sá"). Internal.
 */
create or replace function public.djen_name_is_company(target_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.djen_words(target_name) ~ (
    '(\m(LTDA|EIRELI|EPP|CIA|COMPANHIA|BANCO|SEGUROS|SEGURADORA|ASSOCIACAO|CONDOMINIO|MINISTERIO|DEFENSORIA|'
    || 'MUNICIPIO|FAZENDA|INSTITUTO|FUNDACAO|EMPRESA|COMERCIO|SERVICOS|TURISMO|VIAGENS|AGENCIA|LINHAS)\M'
    || '|\mS/A\M|\mS\.A\M)');
$$;

revoke all on function public.djen_name_is_company(text) from public, anon, authenticated;

-- ---------- The batch of ONE's own ----------

alter table public.import_batches drop constraint import_batches_kind_check;
alter table public.import_batches add constraint import_batches_kind_check check (kind in ('portfolio', 'djen'));
comment on column public.import_batches.kind is
  'portfolio: a spreadsheet a person brought (0032); djen: the cases ONE opened from the lawsuits the DJEN shows, one batch a day (0287).';

-- The claimants after the first a line wrote (a lawsuit of several), which go with its case when it is undone.
alter table public.import_rows add column more_people uuid[] not null default '{}';
comment on column public.import_rows.more_people is
  'The people this line wrote besides `person_id` (the other claimants of a lawsuit ONE opened from the DJEN, 0287): they go when its case is undone and nothing else holds them.';

/** A line undone takes with it the other people it wrote, once no case holds them (0287). */
create or replace function public.import_rows_more_people_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.outcome = 'reverted' and old.outcome is distinct from 'reverted' and cardinality(old.more_people) > 0 then
    begin
      delete from public.people p
      where p.id = any (old.more_people) and p.org_id = new.org_id
        and not exists (select 1 from public.case_parties cp where cp.person_id = p.id);
    exception when foreign_key_violation then
      -- Somebody gave one of them something of their own since: they stay.
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.import_rows_more_people_gone() from public, anon, authenticated;

create trigger import_rows_more_people_gone after update of outcome on public.import_rows
  for each row execute function public.import_rows_more_people_gone();

-- ---------- The readings ----------

create table public.djen_case_reads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  cnj text not null,
  -- due      waits for the sweep: ONE reads the lawsuit at the DJEN and opens its case;
  -- working  claimed (`claims`, `claimed_at`); one held for ten minutes was left by a worker that stopped;
  -- retry    the DJEN did not answer, or limited the calls: tried again after `retry_after`;
  -- opened   its case was opened (`case_id`, emptied when the firm undid it: ONE never opens it again);
  -- skipped  ONE did not open it (`code`): tried again once a newer publication of it arrives.
  status text not null default 'due',
  code text,
  claims integer not null default 0,
  claimed_at timestamptz,
  attempts integer not null default 0,
  retry_after timestamptz,
  -- Who asked for it, where the firm keeps the decision with a person (`ask_djen_cases`).
  asked_by uuid references public.profiles (id) on delete set null,
  case_id uuid references public.cases (id) on delete set null,
  batch_id uuid references public.import_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, cnj),
  constraint djen_case_reads_cnj_check check (cnj ~ '^[0-9]{20}$'),
  constraint djen_case_reads_status_check check (status in ('due', 'working', 'retry', 'opened', 'skipped')),
  constraint djen_case_reads_code_check check (code is null or code ~ '^[a-z][a-z0-9_]{1,59}$')
);

create index djen_case_reads_due_idx on public.djen_case_reads (created_at) where status in ('due', 'working', 'retry');
create index djen_case_reads_case_idx on public.djen_case_reads (case_id);

alter table public.djen_case_reads enable row level security;
create policy "djen_case_reads_select_member" on public.djen_case_reads
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.djen_case_reads from public, anon, authenticated;
grant select on table public.djen_case_reads to authenticated;
create trigger djen_case_reads_updated_at before update on public.djen_case_reads
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_djen_case_reads after insert or update or delete on public.djen_case_reads
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The lawsuits of the DJEN a firm could have opened by ONE (one firm, or every firm): of its publications (active),
 * with a number of a court ONE knows, with no lawsuit of the firm and no reading yet, whose texts name an airline,
 * of a firm that has the passenger module. Internal.
 */
create or replace function public.djen_case_candidates(target_org uuid, target_limit integer default 500)
returns table (org_id uuid, cnj text)
language sql
stable
security definer
set search_path = public
as $$
  with lawsuits as (
    select p.org_id, p.cnj, public.djen_words(string_agg(left(p.body, 4000), ' ')) as words
    from public.publications p
    where (target_org is null or p.org_id = target_org)
      and p.cnj ~ '^[0-9]{20}$' and p.active
      and not exists (select 1 from public.proceedings pr where pr.org_id = p.org_id and pr.cnj = p.cnj)
      and not exists (select 1 from public.djen_case_reads r where r.org_id = p.org_id and r.cnj = p.cnj)
      and exists (
        select 1 from public.courts c where c.cnj_segment = substr(p.cnj, 14, 1) and c.cnj_code = substr(p.cnj, 15, 2)
      )
    group by p.org_id, p.cnj
  )
  select l.org_id, l.cnj
  from lawsuits l
  where public.firm_uses_module(l.org_id, 'direito-do-passageiro')
    and cardinality(public.airlines_named(l.words)) > 0
  order by l.org_id, l.cnj
  limit greatest(least(coalesce(target_limit, 500), 5000), 1);
$$;

revoke all on function public.djen_case_candidates(uuid, integer) from public, anon, authenticated;

/**
 * What the sweep owes, recomputed from the data on each round: a reading for each lawsuit a firm that leaves the
 * decision to ONE could have opened, and again for one ONE did not open once a newer publication of it arrived
 * (never one the firm already has). Service role. Answers how many were added and how many owed again.
 */
create or replace function public.prepare_djen_case_reads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  added integer;
  again integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.djen_case_reads (org_id, cnj)
  select c.org_id, c.cnj from public.djen_case_candidates(null, 500) c
  where public.firm_autonomy_mode(c.org_id, 'open_case_from_djen') = 'auto'
  on conflict (org_id, cnj) do nothing;
  get diagnostics added = row_count;

  update public.djen_case_reads r
  set status = 'due', code = null, attempts = 0, retry_after = null
  where r.status = 'skipped' and r.code is distinct from 'exists'
    and (r.asked_by is not null or public.firm_autonomy_mode(r.org_id, 'open_case_from_djen') = 'auto')
    and not exists (select 1 from public.proceedings pr where pr.org_id = r.org_id and pr.cnj = r.cnj)
    and exists (
      select 1 from public.publications p
      where p.org_id = r.org_id and p.cnj = r.cnj and p.active and p.captured_at > r.updated_at
    );
  get diagnostics again = row_count;
  return jsonb_build_object('added', added, 'again', again);
end;
$$;

revoke all on function public.prepare_djen_case_reads() from public, anon, authenticated;
grant execute on function public.prepare_djen_case_reads() to service_role;

/**
 * The readings owed, the oldest first (of one firm, when one is named), claimed under a new number: one held for ten
 * minutes was left by a worker that stopped, and is owed again. Service role.
 */
create or replace function public.claim_djen_case_reads(target_limit integer default 5, target_org uuid default null)
returns table (read_id uuid, claim integer, cnj text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  with picked as (
    select r.id from public.djen_case_reads r
    where (target_org is null or r.org_id = target_org)
      and (r.status = 'due'
           or (r.status = 'retry' and coalesce(r.retry_after, now()) <= now())
           or (r.status = 'working' and r.claimed_at < now() - interval '10 minutes'))
    order by r.created_at, r.id
    limit greatest(least(coalesce(target_limit, 5), 50), 1)
    for update skip locked
  )
  update public.djen_case_reads r
  set status = 'working', claims = r.claims + 1, claimed_at = now()
  from picked
  where r.id = picked.id
  returning r.id, r.claims, r.cnj;
end;
$$;

revoke all on function public.claim_djen_case_reads(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_djen_case_reads(integer, uuid) to service_role;

/**
 * A reading that met the DJEN out of the air or limiting its calls (`retry`: tried again after twenty minutes a
 * try, and set aside after five), or one that cannot be read (`skipped`, with why). Service role.
 */
create or replace function public.record_djen_case_read(
  target_read uuid,
  target_claim integer,
  target_outcome text,
  target_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reading public.djen_case_reads%rowtype;
  code_value text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}$'), 'failed');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('retry', 'skipped') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into reading from public.djen_case_reads where id = target_read for update;
  if not found or reading.status <> 'working' or reading.claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_outcome = 'retry' and reading.attempts + 1 < 5 then
    update public.djen_case_reads
    set status = 'retry', code = code_value, attempts = reading.attempts + 1, claimed_at = null,
        retry_after = now() + make_interval(mins => 20 * (reading.attempts + 1))
    where id = reading.id;
    return jsonb_build_object('ok', true, 'code', 'retry');
  end if;
  update public.djen_case_reads
  set status = 'skipped', code = code_value, attempts = reading.attempts + 1, claimed_at = null, retry_after = null
  where id = reading.id;
  return jsonb_build_object('ok', true, 'code', 'skipped');
end;
$$;

revoke all on function public.record_djen_case_read(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_djen_case_read(uuid, integer, text, text) to service_role;

-- ---------- ONE opens the case ----------

/**
 * ONE opens the case of a lawsuit it read at the DJEN (`target_communications`: what each communication of the
 * lawsuit is addressed to, `{parties: [{name, side}], lawyers: [{uf, number}]}`). The firm's clients are the
 * parties of the side that sues in the communications that go through a lawyer of the firm (a person, never a
 * company nor an airline, each once, ten at most), written as names; the airline is the one the side sued names,
 * else the one the firm's publications of it name, and only one. Then, as ONE: the case in court, of the passenger
 * module, with its claimants; the lawsuit filed with its number, its court, its unit and its kind; a line of the
 * day's batch of ONE's own, which the firm undoes as any import; and its history owed to the DJEN (0286).
 *
 * What ONE does not open stays on record with why (`skipped`): the lawsuit already in the firm (`exists`), no
 * lawyer of the firm in what the DJEN addresses (`no_lawyer_of_firm`), the firm on the side sued
 * (`firm_on_defense`), no client of the side that sues (`no_client`), no airline or more than one
 * (`airline_unclear`), a firm that no longer has the module or keeps the decision with a person (`by_person`).
 * Service role.
 */
create or replace function public.one_open_djen_case(target_read uuid, target_claim integer, target_communications jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reading public.djen_case_reads%rowtype;
  communications jsonb := case when jsonb_typeof(target_communications) = 'array' then target_communications else '[]'::jsonb end;
  firm_lawyers text[];
  mine jsonb;
  active_names text[];
  passive_words text;
  airline_codes text[];
  airline text;
  clients text[] := '{}';
  candidate text;
  cleaned text;
  latest_unit text;
  latest_class text;
  court_row public.courts%rowtype;
  kind_value text;
  batch public.import_batches%rowtype;
  next_seq integer;
  new_case uuid;
  person uuid;
  first_person uuid;
  others uuid[] := '{}';
  parties uuid[] := '{}';
  party uuid;
  saved jsonb;
  line integer;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into reading from public.djen_case_reads where id = target_read for update;
  if not found or reading.status <> 'working' or reading.claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if jsonb_array_length(communications) > 1000 then
    communications := '[]'::jsonb;
  end if;

  -- Who the firm's lawyers are: their registrations at the bar, as the DJEN keys them.
  select coalesce(array_agg(r.uf || r.number), '{}') into firm_lawyers
  from public.oab_registrations r
  join public.memberships m on m.user_id = r.user_id and m.org_id = reading.org_id;
  -- What goes through one of them.
  select coalesce(jsonb_agg(c.value), '[]'::jsonb) into mine
  from jsonb_array_elements(communications) c
  where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(c.value -> 'lawyers') = 'array' then c.value -> 'lawyers' else '[]'::jsonb end) l
    where upper(coalesce(l.value ->> 'uf', '')) || upper(coalesce(l.value ->> 'number', '')) = any (firm_lawyers)
  );
  select coalesce(array_agg(distinct btrim(regexp_replace(p.value ->> 'name', '\s+', ' ', 'g'))), '{}') into active_names
  from jsonb_array_elements(mine) c,
       jsonb_array_elements(case when jsonb_typeof(c.value -> 'parties') = 'array' then c.value -> 'parties' else '[]'::jsonb end) p
  where p.value ->> 'side' = 'active' and char_length(btrim(coalesce(p.value ->> 'name', ''))) between 3 and 200;
  select public.djen_words(string_agg(p.value ->> 'name', ' ')) into passive_words
  from jsonb_array_elements(communications) c,
       jsonb_array_elements(case when jsonb_typeof(c.value -> 'parties') = 'array' then c.value -> 'parties' else '[]'::jsonb end) p
  where p.value ->> 'side' = 'passive';

  if exists (select 1 from public.proceedings pr where pr.org_id = reading.org_id and pr.cnj = reading.cnj) then
    skip := 'exists';
  elsif not public.firm_uses_module(reading.org_id, 'direito-do-passageiro')
        or (reading.asked_by is null and public.firm_autonomy_mode(reading.org_id, 'open_case_from_djen') <> 'auto') then
    skip := 'by_person';
  elsif jsonb_array_length(mine) = 0 then
    skip := 'no_lawyer_of_firm';
  elsif cardinality(active_names) = 0 and exists (
    select 1 from jsonb_array_elements(mine) c,
         jsonb_array_elements(case when jsonb_typeof(c.value -> 'parties') = 'array' then c.value -> 'parties' else '[]'::jsonb end) p
    where p.value ->> 'side' = 'passive'
  ) then
    skip := 'firm_on_defense';
  end if;

  if skip is null then
    -- The airline: the one the side sued names, else the one the firm's publications of the lawsuit name.
    airline_codes := public.airlines_named(passive_words);
    if cardinality(airline_codes) <> 1 then
      airline_codes := public.airlines_named((
        select public.djen_words(string_agg(left(p.body, 4000), ' '))
        from public.publications p where p.org_id = reading.org_id and p.cnj = reading.cnj and p.active));
    end if;
    if cardinality(airline_codes) = 1 then
      airline := airline_codes[1];
    else
      skip := 'airline_unclear';
    end if;
  end if;

  if skip is null then
    -- The clients: people, never a company nor an airline, ten at most, each once whatever its capitals and accents
    -- (never by a part of the name: a father and a son "Filho" are two claimants).
    foreach candidate in array active_names loop
      cleaned := public.name_case(candidate);
      if cleaned !~ '[[:alpha:]]' or cleaned ~ '[0-9]' or public.djen_name_is_company(cleaned)
         or cardinality(public.airlines_named(public.djen_words(cleaned))) > 0 then
        continue;
      end if;
      if exists (select 1 from unnest(clients) chosen where public.slugify(chosen) = public.slugify(cleaned)) then
        continue;
      end if;
      clients := clients || left(cleaned, 200);
      exit when cardinality(clients) >= 10;
    end loop;
    if cardinality(clients) = 0 then
      skip := 'no_client';
    end if;
  end if;

  if skip is not null then
    update public.djen_case_reads set status = 'skipped', code = skip, claimed_at = null where id = reading.id;
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  -- The court, by the number; the unit and the kind, by the latest publication that names them.
  select * into court_row from public.courts c
  where c.cnj_segment = substr(reading.cnj, 14, 1) and c.cnj_code = substr(reading.cnj, 15, 2);
  select p.unit, p.class_name into latest_unit, latest_class
  from public.publications p
  where p.org_id = reading.org_id and p.cnj = reading.cnj and (p.unit is not null or p.class_name is not null)
  order by p.available_on desc, p.captured_at desc
  limit 1;
  kind_value := case
    when public.djen_words(coalesce(latest_unit, '') || ' ' || coalesce(latest_class, '')) ~ '\m(JUIZADO|RECURSAL|INOMINADO)'
    then 'juizado' else 'comum' end;

  -- The day's batch of ONE's own, or a new one.
  select * into batch from public.import_batches b
  where b.org_id = reading.org_id and b.kind = 'djen' and b.status = 'committed'
    and (b.created_at at time zone 'America/Sao_Paulo')::date = today
  order by b.created_at desc
  limit 1
  for update;
  if not found then
    insert into public.import_batches (org_id, kind, source_system, status, committed_at, created_by)
    values (reading.org_id, 'djen', 'DJEN', 'committed', now(), reading.asked_by)
    returning * into batch;
  end if;

  -- The case, as ONE: in court, of the passenger module, with its claimants.
  perform set_config('one.system_case', '', true);
  perform 1 from public.organizations where id = reading.org_id for no key update;
  select coalesce(max(c.seq), 0) + 1 into next_seq from public.cases c where c.org_id = reading.org_id;
  insert into public.cases (org_id, seq, module, incident, airline_iata, status, status_changed_at)
  values (reading.org_id, next_seq, 'direito-do-passageiro', 'other', airline, 'filed', now())
  returning id into new_case;
  perform set_config('one.system_case', new_case::text, true);

  foreach candidate in array clients loop
    insert into public.people (org_id, full_name, updated_via)
    values (reading.org_id, candidate, 'firm')
    returning id into person;
    insert into public.case_parties (org_id, case_id, person_id, role)
    values (reading.org_id, new_case, person, 'claimant')
    returning id into party;
    parties := parties || party;
    if first_person is null then
      first_person := person;
    else
      others := others || person;
    end if;
  end loop;

  saved := public.save_proceeding(new_case, null,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', kind_value, 'court', court_row.acronym, 'cnj', reading.cnj, 'status', 'filed',
      'unit', left(latest_unit, 200))),
    parties);
  if not coalesce((saved ->> 'ok')::boolean, false) then
    raise exception using errcode = 'P0001', message = coalesce(saved ->> 'code', 'lawsuit_refused');
  end if;

  line := batch.rows_count + 1;
  insert into public.import_rows (org_id, batch_id, row_number, cnj, outcome, decided_at, case_id, proceeding_id,
                                  person_id, person_created, more_people)
  values (reading.org_id, batch.id, line, reading.cnj, 'created', clock_timestamp(), new_case,
          (saved ->> 'proceeding_id')::uuid, first_person, true, others);
  update public.import_batches set rows_count = line, updated_at = now() where id = batch.id;
  update public.import_batches set counts = public.import_batch_counts(batch.id) where id = batch.id;

  perform public.record_case_event(reading.org_id, new_case, 'opened_from_djen', 'system',
    jsonb_build_object('seq', next_seq, 'batch', batch.id, 'line', line, 'proceeding', (saved ->> 'proceeding_id')::uuid,
                       'claimants', cardinality(clients)));
  perform public.queue_proceeding_history((saved ->> 'proceeding_id')::uuid, reading.asked_by);
  perform set_config('one.system_case', '', true);

  update public.djen_case_reads
  set status = 'opened', code = null, claimed_at = null, case_id = new_case, batch_id = batch.id
  where id = reading.id;
  return jsonb_build_object('ok', true, 'code', 'opened', 'case_id', new_case, 'seq', next_seq);
exception when sqlstate 'P0001' then
  perform set_config('one.system_case', '', true);
  update public.djen_case_reads
  set status = 'skipped', code = coalesce(substring(lower(sqlerrm) from '^[a-z][a-z0-9_]{1,59}$'), 'refused'), claimed_at = null
  where id = target_read;
  return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', 'refused');
end;
$$;

revoke all on function public.one_open_djen_case(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.one_open_djen_case(uuid, integer, jsonb) to service_role;

/**
 * A partner, a lawyer or the controladoria asks ONE to open the cases of the lawsuits the DJEN shows (a firm that
 * keeps the decision with a person: the asking is the person's decision, on record). With the second factor, as
 * the import. Answers how many ONE now reads.
 */
create or replace function public.ask_djen_cases(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  asked integer;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.firm_function in ('socio', 'advogado', 'controladoria')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  perform public.require_aal2();
  insert into public.djen_case_reads (org_id, cnj, asked_by)
  select c.org_id, c.cnj, auth.uid() from public.djen_case_candidates(target_org, 5000) c
  on conflict (org_id, cnj) do nothing;
  get diagnostics asked = row_count;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'djen_cases.asked', 'organization', target_org::text,
          jsonb_build_object('lawsuits', asked));
  return jsonb_build_object('ok', true, 'code', case when asked > 0 then 'queued' else 'none' end, 'lawsuits', asked);
end;
$$;

revoke all on function public.ask_djen_cases(uuid) from public, anon;
grant execute on function public.ask_djen_cases(uuid) to authenticated;

-- ---------- What the firm gives of them: the CPF ----------

/**
 * The cases ONE opened from the DJEN, as the import's screen says them, for who may bring the portfolio (a partner,
 * a lawyer or the controladoria; never in a support visit): how the firm keeps the decision, how many ONE is
 * reading and opened, why it left the others, whether a person may ask it to open what waits, and each client ONE
 * named who has no CPF yet (three hundred at most, the count of all beside them).
 */
create or replace function public.firm_djen_cases(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mode text;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.firm_function in ('socio', 'advogado', 'controladoria')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  mode := public.firm_autonomy_mode(target_org, 'open_case_from_djen');
  return (
    with clients as (
      select p.id as person_id, p.full_name, c.id as case_id, c.seq, r.cnj
      from public.djen_case_reads r
      join public.cases c on c.id = r.case_id
      join public.case_parties cp on cp.case_id = c.id and cp.role = 'claimant'
      join public.people p on p.id = cp.person_id
      where r.org_id = target_org and r.status = 'opened' and p.cpf is null
    )
    select jsonb_build_object(
      'ok', true,
      'mode', mode,
      'module', public.firm_uses_module(target_org, 'direito-do-passageiro'),
      'opening', (select count(*) from public.djen_case_reads r
                  where r.org_id = target_org and r.status in ('due', 'working', 'retry')),
      'opened', (select count(*) from public.djen_case_reads r
                 where r.org_id = target_org and r.status = 'opened' and r.case_id is not null),
      'skipped', coalesce((select jsonb_object_agg(s.code, s.n) from (
                   select r.code, count(*) as n from public.djen_case_reads r
                   where r.org_id = target_org and r.status = 'skipped' and r.code is not null
                   group by r.code) s), '{}'::jsonb),
      'waiting', case when mode = 'auto' then 0
                      else (select count(*) from public.djen_case_candidates(target_org, 5000)) end,
      'without_cpf_total', (select count(*) from clients),
      'without_cpf', coalesce((
        select jsonb_agg(jsonb_build_object('person_id', w.person_id, 'name', w.full_name, 'case_id', w.case_id,
                                            'seq', w.seq, 'cnj', w.cnj) order by w.seq, w.full_name)
        from (select * from clients order by seq, full_name limit 300) w), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_djen_cases(uuid) from public, anon;
grant execute on function public.firm_djen_cases(uuid) to authenticated;

/**
 * The CPF of a client ONE named from the DJEN, given by the firm (anybody of it, never in a support visit). A CPF the
 * firm already has for a person of the same name is that person: the case takes them, and the person ONE wrote goes
 * when nothing else holds them (`merged`). One the firm has for somebody of another name is refused
 * (`cpf_other_name`), and so is a person who already has a CPF (`has_cpf`).
 */
create or replace function public.complete_djen_client(target_person uuid, target_cpf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  known public.people%rowtype;
  cpf_value text := nullif(regexp_replace(coalesce(target_cpf, ''), '\D', '', 'g'), '');
  applied jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into person from public.people where id = target_person for update;
  if not found or not public.is_org_member(person.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if person.cpf is not null then
    return jsonb_build_object('ok', false, 'code', 'has_cpf');
  end if;
  if cpf_value is null or not public.cpf_is_valid(cpf_value) then
    return jsonb_build_object('ok', false, 'code', 'invalid_cpf', 'field', 'cpf');
  end if;
  select * into known from public.people p where p.org_id = person.org_id and p.cpf = cpf_value and p.id <> person.id;
  if found then
    if not public.import_names_match(known.full_name, person.full_name) then
      return jsonb_build_object('ok', false, 'code', 'cpf_other_name', 'field', 'cpf');
    end if;
    -- The person the firm has takes the cases ONE wrote this one into (a case that already holds them keeps one).
    delete from public.case_parties cp
    where cp.person_id = person.id
      and exists (select 1 from public.case_parties other
                  where other.case_id = cp.case_id and other.person_id = known.id and other.role = cp.role);
    update public.case_parties set person_id = known.id where person_id = person.id;
    begin
      delete from public.people where id = person.id;
    exception when foreign_key_violation then
      null;
    end;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (person.org_id, auth.uid(), 'person.merged', 'person', known.id::text,
            jsonb_build_object('from', person.id, 'by', 'cpf'));
    return jsonb_build_object('ok', true, 'code', 'merged', 'person_id', known.id);
  end if;
  applied := public.apply_person_fields(person.id, jsonb_build_object('cpf', cpf_value), 'firm');
  if not coalesce((applied ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(applied ->> 'code', 'invalid_cpf'), 'field', 'cpf');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (person.org_id, auth.uid(), 'person.cpf_given', 'person', person.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'saved', 'person_id', person.id);
end;
$$;

revoke all on function public.complete_djen_client(uuid, text) from public, anon;
grant execute on function public.complete_djen_client(uuid, text) to authenticated;

-- ---------- The lawsuits the DJEN shows, with what ONE does of each ----------

/**
 * As in 0208, and each lawsuit says what ONE does of it (`one`: being read to be opened, or left with why), so the
 * spreadsheet to complete holds only what ONE does not open.
 */
create or replace function public.firm_djen_lawsuits(target_org uuid, target_limit integer default 2000)
returns jsonb
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
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.firm_function in ('socio', 'advogado', 'controladoria')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  return (
    with found as (
      select p.cnj, p.court,
             min(p.available_on) as first_on, max(p.available_on) as last_on, count(*) as publications,
             (array_agg(p.unit order by p.available_on desc, p.captured_at desc) filter (where p.unit is not null))[1] as unit,
             (array_agg(p.class_name order by p.available_on desc, p.captured_at desc) filter (where p.class_name is not null))[1] as class_name,
             translate(upper(string_agg(left(p.body, 4000), ' ')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC') as words
      from public.publications p
      where p.org_id = target_org and p.cnj ~ '^[0-9]{20}$'
        and not exists (select 1 from public.proceedings pr where pr.org_id = target_org and pr.cnj = p.cnj)
      group by p.cnj, p.court
    ), listed as (
      select f.*,
             (select case when count(*) = 1 then min(a.iata) end
              from public.airlines a
              where a.active
                and exists (
                  select 1 from unnest(a.court_names || array[a.name]) n
                  where char_length(n) >= 3
                    -- The name as a whole word or words: "TAM" is not in "ESTAMOS".
                    and f.words ~ ('\m' || regexp_replace(translate(upper(n), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'),
                                                         '([.*+?^$(){}|\\\[\]])', '\\\1', 'g') || '\M')
                )) as airline_iata,
             (select case when r.status in ('due', 'working', 'retry') then 'opening' when r.status = 'skipped' then r.code end
              from public.djen_case_reads r where r.org_id = target_org and r.cnj = f.cnj) as one
      from found f
      order by f.last_on desc, f.cnj
      limit greatest(least(coalesce(target_limit, 2000), 5000), 1)
    )
    select jsonb_build_object(
      'ok', true,
      'total', (select count(*) from found),
      'lawsuits', coalesce(jsonb_agg(jsonb_build_object(
        'cnj', l.cnj, 'court', l.court, 'unit', l.unit, 'class_name', l.class_name,
        'first_on', l.first_on, 'last_on', l.last_on, 'publications', l.publications,
        'airline_iata', l.airline_iata,
        'airline_name', (select coalesce(a.legal_name, a.name) from public.airlines a where a.iata = l.airline_iata),
        'one', l.one
      ) order by l.last_on desc, l.cnj), '[]'::jsonb)
    )
    from listed l
  );
end;
$$;

revoke all on function public.firm_djen_lawsuits(uuid, integer) from public, anon;
grant execute on function public.firm_djen_lawsuits(uuid, integer) to authenticated;

-- ---------- Where the portfolio stands, for the home ----------

/**
 * For anybody of the firm: whether it said it used a system before ONE (`firm_operations.previous_system`) and
 * brought no spreadsheet of it yet, whether this person may bring it, and what ONE opened from the DJEN (how many,
 * how many it is reading, how many of their clients have no CPF yet).
 */
create or replace function public.firm_portfolio(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  system_name text;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select o.previous_system into system_name from public.firm_operations o where o.org_id = target_org;
  return jsonb_build_object(
    'ok', true,
    'system', case when system_name in ('astrea', 'advbox', 'projuris', 'planilha', 'outro') then system_name end,
    'brought', exists (
      select 1 from public.import_batches b
      where b.org_id = target_org and b.kind = 'portfolio' and b.status = 'committed'),
    'can_import', not public.is_impersonated() and exists (
      select 1 from public.memberships m
      where m.org_id = target_org and m.user_id = auth.uid() and m.firm_function in ('socio', 'advogado', 'controladoria')),
    'opening', (select count(*) from public.djen_case_reads r
                where r.org_id = target_org and r.status in ('due', 'working', 'retry')),
    'opened', (select count(*) from public.djen_case_reads r
               where r.org_id = target_org and r.status = 'opened' and r.case_id is not null),
    'without_cpf', (
      select count(*) from public.djen_case_reads r
      join public.case_parties cp on cp.case_id = r.case_id and cp.role = 'claimant'
      join public.people p on p.id = cp.person_id
      where r.org_id = target_org and r.status = 'opened' and p.cpf is null)
  );
end;
$$;

revoke all on function public.firm_portfolio(uuid) from public, anon;
grant execute on function public.firm_portfolio(uuid) to authenticated;

-- ---------- The import: the history of what it brings in course ----------

/**
 * As in 0032, and each lawsuit a line brings still in course has its history owed to the DJEN at once (0286,
 * `queue_proceeding_history`), never asked lawsuit by lawsuit: ONE reads what the lawsuit had before ONE, settles
 * what already passed and follows what is still ahead. A lawsuit the old system says ended is brought as it was.
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
        -- What the lawsuit had before ONE, read from the DJEN by its number (0286, 0287).
        perform public.queue_proceeding_history((saved ->> 'proceeding_id')::uuid, auth.uid());
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

-- ---------- The work of ONE counts it ----------

insert into public.one_work_kinds (key, family, position, minutes, decision) values
  ('caso_aberto_djen', 'atendimento', 15, 5, 'open_case_from_djen')
on conflict (key) do nothing;

/** As in 0156, and the cases ONE opened of the lawsuits the DJEN shows (0287). Internal. */
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
  -- A case ONE opened of a lawsuit the DJEN shows (0287), which the firm did not undo.
  select 'caso_aberto_djen', e.at, e.case_id, false, null::boolean
  from public.case_events e
  where e.org_id = target_org and e.kind = 'opened_from_djen' and e.actor_type = 'system'
    and e.at >= target_from and e.at < target_to
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
    and c.closed_at >= target_from and c.closed_at < target_to
  union all
  -- A receipt ONE issued to a client, while it stands (0152); one a person asked for, apart.
  select 'recibo_cliente', r.issued_at, r.case_id, r.requested_at is not null, null
  from public.finance_receipts r
  where r.org_id = target_org and r.status = 'issued'
    and r.issued_at >= target_from and r.issued_at < target_to
  union all
  -- An accountability statement ONE issued to a client, while it stands (0156); one a person asked for, apart.
  select 'prestacao_contas', s.issued_at, s.case_id, s.requested_at is not null, null
  from public.money_statements s
  where s.org_id = target_org and s.status = 'issued'
    and s.issued_at >= target_from and s.issued_at < target_to;
$$;

revoke all on function public.one_work_acts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
