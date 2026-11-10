-- ============================================================
-- 0134 · A tela Pessoas: os números de quem o escritório atende, e os segmentos de marketing
--
-- Phase 9 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its second part. The screen Pessoas lists who the firm
-- serves (`firm_people`) with its numbers (`firm_people_numbers`: registered,
-- with a case going and without, and the people by origin, age, profession,
-- city, airline, kind of problem and outcome of the lawsuit).
--
-- A segment is a set of filters with a name (`marketing_segments`), in the
-- registration pattern of phase 0, that the firm uses in its own marketing
-- tools, at its own risk (decision 7): ONE sends no campaign. Only once a
-- partner accepted, with the second factor, the term by which the firm takes
-- that risk before the LGPD and the bar's rules on advertising
-- (`firm_marketing_terms`, the text kept as accepted); without it the screen
-- shows the numbers and makes no segment. A segment never holds a minor,
-- somebody who asked not to receive marketing (0133), anybody whose data were
-- erased, nor anybody of a test case. Each export asks the second factor and
-- is on the record (who, when, which segment, how many people, which columns).
-- ============================================================

insert into public.platform_settings (key, value) values ('marketing_term', jsonb_build_object(
  'version', 'termo-marketing-v1',
  'text', 'O escritório declara que o uso dos dados de clientes e contatos em ações de marketing, inclusive a exportação de listas pelo ONE, é decisão e responsabilidade do escritório, como controlador dos dados perante a Lei Geral de Proteção de Dados (Lei 13.709/2018) e perante as regras de publicidade da advocacia (Código de Ética e Disciplina da OAB e Provimento 205/2021). O ONE não envia campanhas, não escolhe quem recebe nem o que se diz. O escritório se compromete a usar as listas apenas com base legal adequada, a não incluir menores de idade nem quem pediu para não receber marketing, e a atender os pedidos dos titulares.'
)) on conflict (key) do nothing;

-- ---------- The facts of each person ----------
/**
 * What the numbers and the segments read of each person of a firm (internal): their age, whether they are an adult
 * (no birth date makes a minor, nor being a claimant a guardian answers for), whether a case of theirs is going, and
 * the origins, airlines, kinds of problem and outcomes of their cases (the test cases out).
 */
create or replace function public.people_facts(target_org uuid)
returns table (
  person_id uuid, full_name text, email text, phone text, age integer, adult boolean, active boolean, has_case boolean,
  origins text[], airlines text[], incidents text[], outcomes text[], profession text, city text, uf text,
  marketing_off boolean, erased boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with cases_of as (
    select cp.person_id, c.id as case_id, c.status, c.origin, c.airline_iata, c.incident
    from public.case_parties cp join public.cases c on c.id = cp.case_id
    where c.org_id = target_org and not c.is_test
  ),
  outcomes_of as (
    select co.person_id, array_agg(distinct coalesce(f.result, f.kind)) as list
    from cases_of co join public.lawsuit_facts f on f.case_id = co.case_id
    where f.kind in ('sentenca', 'acordo') and f.corrected_at is null
    group by co.person_id
  )
  select p.id, p.full_name, p.email, p.phone,
    case when p.birth_date is not null
      then extract(year from age((now() at time zone 'America/Sao_Paulo')::date, p.birth_date))::integer end,
    not public.person_minor(p.id),
    coalesce(bool_or(co.status not in ('closed', 'declined')), false),
    count(co.case_id) > 0,
    coalesce(array_agg(distinct co.origin) filter (where co.origin is not null), '{}'),
    coalesce(array_agg(distinct co.airline_iata) filter (where co.airline_iata is not null), '{}'),
    coalesce(array_agg(distinct co.incident) filter (where co.incident is not null), '{}'),
    coalesce((select o.list from outcomes_of o where o.person_id = p.id), '{}'),
    nullif(btrim(coalesce(p.profession, '')), ''), nullif(btrim(coalesce(p.city, '')), ''), p.uf,
    p.marketing_off_at is not null, p.erased_at is not null
  from public.people p
  left join cases_of co on co.person_id = p.id
  where p.org_id = target_org
  group by p.id;
$$;

revoke all on function public.people_facts(uuid) from public, anon, authenticated;

/** The numbers of the screen Pessoas (anybody of the firm), the test cases out. */
create or replace function public.firm_people_numbers(target_org uuid)
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
  return (
    with f as (select * from public.people_facts(target_org) where not erased),
    tally as (
      select key, count(*)::integer as n from f, unnest(origins) as key group by key
    )
    select jsonb_build_object(
      'registered', (select count(*) from f),
      'active', (select count(*) from f where active),
      'inactive', (select count(*) from f where not active),
      'marketing_off', (select count(*) from f where marketing_off),
      'origins', coalesce((select jsonb_object_agg(key, n) from tally), '{}'::jsonb),
      'ages', (select jsonb_build_object(
        'minor', count(*) filter (where not adult),
        '18_29', count(*) filter (where adult and age between 18 and 29),
        '30_39', count(*) filter (where adult and age between 30 and 39),
        '40_49', count(*) filter (where adult and age between 40 and 49),
        '50_59', count(*) filter (where adult and age between 50 and 59),
        '60', count(*) filter (where adult and age >= 60),
        'unknown', count(*) filter (where adult and age is null)) from f),
      'professions', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select profession as k, count(*)::integer as n from f where profession is not null
              group by profession order by count(*) desc, profession limit 10) x), '[]'::jsonb),
      'cities', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select concat_ws('/', city, uf) as k, count(*)::integer as n from f where city is not null
              group by concat_ws('/', city, uf) order by count(*) desc, concat_ws('/', city, uf) limit 10) x), '[]'::jsonb),
      'airlines', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select key as k, count(*)::integer as n from f, unnest(airlines) as key group by key order by count(*) desc, key limit 10) x), '[]'::jsonb),
      'incidents', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select key as k, count(*)::integer as n from f, unnest(incidents) as key group by key) x), '[]'::jsonb),
      'outcomes', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select key as k, count(*)::integer as n from f, unnest(outcomes) as key group by key) x), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_people_numbers(uuid) from public, anon;
grant execute on function public.firm_people_numbers(uuid) to authenticated;

/**
 * The firm's people a page at a time (anybody of the firm): every one, with a case going, without, or who asked not
 * to receive marketing; searched by a name, a CPF or a telephone; with each view's count.
 */
create or replace function public.firm_people(target_org uuid, target_view text default 'todos', target_search text default null,
  target_limit integer default 50, target_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  typed text := left(btrim(coalesce(target_search, '')), 120);
  digits text := regexp_replace(typed, '\D', '', 'g');
  name_words text[] := case when typed ~ '[[:alpha:]]' then
    array(select w from regexp_split_to_table(public.slugify(typed), '-') as w where w <> '') end;
  view_wanted text := coalesce(nullif(btrim(coalesce(target_view, '')), ''), 'todos');
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with f as (
      select x.*, p.cpf, p.created_at from public.people_facts(target_org) x join public.people p on p.id = x.person_id
      where (name_words is null and digits = '')
         or (name_words is not null and not exists (
               select 1 from unnest(name_words) as word where position(word in public.slugify(x.full_name)) = 0))
         or (name_words is null and char_length(digits) = 11 and p.cpf = digits)
         or (name_words is null and char_length(digits) >= 8
             and right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 8) = right(digits, 8))
    ),
    shown as (
      select * from f
      where case view_wanted
        when 'ativos' then active
        when 'sem-caso-ativo' then not active
        when 'sem-marketing' then marketing_off
        else true end
    )
    select jsonb_build_object(
      'counts', jsonb_build_object(
        'todos', (select count(*) from f),
        'ativos', (select count(*) from f where active),
        'sem-caso-ativo', (select count(*) from f where not active),
        'sem-marketing', (select count(*) from f where marketing_off)),
      'total', (select count(*) from shown),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.person_id, 'name', s.full_name, 'cpf', s.cpf, 'city', s.city, 'uf', s.uf, 'phone', s.phone,
          'active', s.active, 'has_case', s.has_case, 'adult', s.adult, 'marketing_off', s.marketing_off, 'erased', s.erased
        ) order by s.full_name, s.person_id)
        from (select * from shown order by full_name, person_id
              limit least(greatest(coalesce(target_limit, 50), 1), 100) offset greatest(coalesce(target_offset, 0), 0)) s
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_people(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.firm_people(uuid, text, text, integer, integer) to authenticated;

-- ---------- The firm's term ----------
create table public.firm_marketing_terms (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  version text not null,
  -- The words as accepted: a newer version of the platform's never changes them.
  text text not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz not null default now()
);

alter table public.firm_marketing_terms enable row level security;
create policy "firm_marketing_terms_select_member" on public.firm_marketing_terms
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_marketing_terms to authenticated;
create trigger guard_impersonation_firm_marketing_terms after insert or update or delete on public.firm_marketing_terms
  for each statement execute function public.guard_impersonation_readonly();

/** Who makes, changes, archives and exports the segments: who decides for the firm, or the controladoria. */
create or replace function public.may_manage_segments(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org) and not public.is_impersonated()
    and (public.decides_for_firm(target_org) or public.has_firm_function(target_org, array['controladoria']::public.firm_function[]));
$$;

revoke all on function public.may_manage_segments(uuid) from public, anon;
grant execute on function public.may_manage_segments(uuid) to authenticated;

/** The term in force of the platform, and whether the firm accepted it (anybody of the firm). */
create or replace function public.firm_marketing_term(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null or not public.is_org_member(target_org) then null else jsonb_build_object(
    'version', s.value ->> 'version', 'text', s.value ->> 'text',
    'accepted', exists (select 1 from public.firm_marketing_terms t where t.org_id = target_org and t.version = s.value ->> 'version'),
    'accepted_at', (select t.accepted_at from public.firm_marketing_terms t where t.org_id = target_org),
    'decides', public.decides_for_firm(target_org) and not public.is_impersonated(),
    'manages', public.may_manage_segments(target_org)
  ) end
  from public.platform_settings s where s.key = 'marketing_term';
$$;

revoke all on function public.firm_marketing_term(uuid) from public, anon;
grant execute on function public.firm_marketing_term(uuid) to authenticated;

/** A partner (who decides for the firm) accepts the term in force, with the second factor, once; on the record. */
create or replace function public.accept_marketing_term(target_org uuid, target_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  term jsonb := (select s.value from public.platform_settings s where s.key = 'marketing_term');
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if term is null or target_version is distinct from term ->> 'version' then
    return jsonb_build_object('ok', false, 'code', 'term_changed');
  end if;
  insert into public.firm_marketing_terms (org_id, version, text, accepted_by)
  values (target_org, term ->> 'version', term ->> 'text', auth.uid())
  on conflict (org_id) do update set version = excluded.version, text = excluded.text, accepted_by = excluded.accepted_by,
    accepted_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'marketing.term_accepted', 'organization', target_org::text,
    jsonb_build_object('version', term ->> 'version'));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.accept_marketing_term(uuid, text) from public, anon;
grant execute on function public.accept_marketing_term(uuid, text) to authenticated;

-- ---------- The segments ----------
create table public.marketing_segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  archive_reason text,
  constraint marketing_segments_name_check check (char_length(btrim(name)) between 3 and 80),
  constraint marketing_segments_filters_check check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 4000),
  constraint marketing_segments_archive_check check (
    (archived_at is null) = (archive_reason is null) and coalesce(char_length(archive_reason), 3) between 3 and 300)
);

create index marketing_segments_org_idx on public.marketing_segments (org_id, created_at);

alter table public.marketing_segments enable row level security;
create policy "marketing_segments_select_manager" on public.marketing_segments
  for select to authenticated using (public.may_manage_segments(org_id));
grant select on table public.marketing_segments to authenticated;
create trigger guard_impersonation_marketing_segments after insert or update or delete on public.marketing_segments
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The people a segment's filters hold (internal): only adults with a case, never who asked not to receive marketing,
 * nor anybody whose data were erased. Each filter left out is every one: the origins, the airlines, the kinds of
 * problem and the outcomes are any of the listed; the ages bound by both ends (a person with no birth date is out of a
 * filter by age); the cities and the states by their names; a case going or none.
 */
create or replace function public.segment_people_ids(target_org uuid, target_filters jsonb)
returns table (person_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select
      array(select jsonb_array_elements_text(coalesce(target_filters -> 'origins', '[]'::jsonb))) as origins,
      array(select jsonb_array_elements_text(coalesce(target_filters -> 'airlines', '[]'::jsonb))) as airlines,
      array(select jsonb_array_elements_text(coalesce(target_filters -> 'incidents', '[]'::jsonb))) as incidents,
      array(select jsonb_array_elements_text(coalesce(target_filters -> 'outcomes', '[]'::jsonb))) as outcomes,
      array(select public.slugify(x) from jsonb_array_elements_text(coalesce(target_filters -> 'cities', '[]'::jsonb)) x) as cities,
      array(select upper(x) from jsonb_array_elements_text(coalesce(target_filters -> 'ufs', '[]'::jsonb)) x) as ufs,
      array(select public.slugify(x) from jsonb_array_elements_text(coalesce(target_filters -> 'professions', '[]'::jsonb)) x) as professions,
      case when (target_filters ->> 'age_min') ~ '^[0-9]{1,3}$' then (target_filters ->> 'age_min')::integer end as age_min,
      case when (target_filters ->> 'age_max') ~ '^[0-9]{1,3}$' then (target_filters ->> 'age_max')::integer end as age_max,
      case when target_filters ->> 'active' in ('true', 'false') then (target_filters ->> 'active')::boolean end as active
  )
  select f.person_id
  from public.people_facts(target_org) f, wanted w
  where f.adult and f.has_case and not f.marketing_off and not f.erased
    and (cardinality(w.origins) = 0 or f.origins && w.origins)
    and (cardinality(w.airlines) = 0 or f.airlines && w.airlines)
    and (cardinality(w.incidents) = 0 or f.incidents && w.incidents)
    and (cardinality(w.outcomes) = 0 or f.outcomes && w.outcomes)
    and (cardinality(w.cities) = 0 or public.slugify(coalesce(f.city, '')) = any (w.cities))
    and (cardinality(w.ufs) = 0 or f.uf = any (w.ufs))
    and (cardinality(w.professions) = 0 or public.slugify(coalesce(f.profession, '')) = any (w.professions))
    and (w.age_min is null or f.age >= w.age_min)
    and (w.age_max is null or f.age <= w.age_max)
    and (w.active is null or f.active = w.active);
$$;

revoke all on function public.segment_people_ids(uuid, jsonb) from public, anon, authenticated;

/** The keys a segment's filters may have. */
create or replace function public.segment_filters_valid(target_filters jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(target_filters) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(target_filters) k
      where k not in ('origins', 'airlines', 'incidents', 'outcomes', 'cities', 'ufs', 'professions', 'age_min', 'age_max', 'active')
    )
    and not exists (
      select 1 from jsonb_each(target_filters) e
      where e.key in ('origins', 'airlines', 'incidents', 'outcomes', 'cities', 'ufs', 'professions')
        and (jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 50)
    );
$$;

revoke all on function public.segment_filters_valid(jsonb) from public, anon, authenticated;

/** What may be done with segments now (internal): who may, never a support visit, and the term in force accepted. */
create or replace function public.segment_refusal(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_impersonated() then 'support_visit'
    when not public.may_manage_segments(target_org) then 'not_allowed'
    when not exists (
      select 1 from public.firm_marketing_terms t join public.platform_settings s on s.key = 'marketing_term'
      where t.org_id = target_org and t.version = s.value ->> 'version') then 'term_missing'
  end;
$$;

revoke all on function public.segment_refusal(uuid) from public, anon, authenticated;

/** How many people some filters hold, before a segment is saved (who manages the segments). */
create or replace function public.segment_count(target_org uuid, target_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  refusal text;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.segment_refusal(target_org);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if not public.segment_filters_valid(coalesce(target_filters, '{}'::jsonb)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  return jsonb_build_object('ok', true, 'count', (select count(*) from public.segment_people_ids(target_org, target_filters)));
end;
$$;

revoke all on function public.segment_count(uuid, jsonb) from public, anon;
grant execute on function public.segment_count(uuid, jsonb) to authenticated;

/** Makes or changes a segment (who manages them, the term accepted); on the record. */
create or replace function public.save_marketing_segment(target_org uuid, target_segment uuid, target_name text, target_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text;
  saved uuid;
  name_value text := btrim(regexp_replace(coalesce(target_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.segment_refusal(target_org);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if char_length(name_value) not between 3 and 80 or not public.segment_filters_valid(coalesce(target_filters, '{}'::jsonb)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if target_segment is null then
    insert into public.marketing_segments (org_id, name, filters, created_by)
    values (target_org, name_value, coalesce(target_filters, '{}'::jsonb), auth.uid())
    returning id into saved;
  else
    update public.marketing_segments set name = name_value, filters = coalesce(target_filters, '{}'::jsonb), updated_at = now()
    where id = target_segment and org_id = target_org and archived_at is null
    returning id into saved;
    if saved is null then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), case when target_segment is null then 'marketing.segment_created' else 'marketing.segment_changed' end,
    'marketing_segment', saved::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'segment_id', saved);
end;
$$;

revoke all on function public.save_marketing_segment(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_marketing_segment(uuid, uuid, text, jsonb) to authenticated;

/** Archives a segment with its reason, or brings it back (no reason); on the record. */
create or replace function public.archive_marketing_segment(target_segment uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  segment public.marketing_segments%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  select * into segment from public.marketing_segments where id = target_segment for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(segment.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.may_manage_segments(segment.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if reason is not null and char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  update public.marketing_segments set archived_at = case when reason is null then null else now() end,
    archived_by = case when reason is null then null else auth.uid() end, archive_reason = reason, updated_at = now()
  where id = segment.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (segment.org_id, auth.uid(), case when reason is null then 'marketing.segment_restored' else 'marketing.segment_archived' end,
    'marketing_segment', segment.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.archive_marketing_segment(uuid, text) from public, anon;
grant execute on function public.archive_marketing_segment(uuid, text) to authenticated;

/** The firm's segments with how many people each holds now (who manages them). */
create or replace function public.firm_segments(target_org uuid)
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
  if not public.may_manage_segments(target_org) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'filters', s.filters, 'created_at', s.created_at, 'updated_at', s.updated_at,
      'archived_at', s.archived_at, 'archive_reason', s.archive_reason,
      'count', (select count(*) from public.segment_people_ids(target_org, s.filters))
    ) order by s.archived_at nulls first, s.name)
    from public.marketing_segments s where s.org_id = target_org
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_segments(uuid) from public, anon;
grant execute on function public.firm_segments(uuid) to authenticated;

/**
 * A segment's people, with the columns the firm chose, for a spreadsheet the browser writes: who manages the segments,
 * with the second factor, the term accepted, at most the setting's 20,000 people; on the record (who, when, which
 * segment, how many, which columns), never with the people.
 */
create or replace function public.export_marketing_segment(target_segment uuid, target_columns text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  segment public.marketing_segments%rowtype;
  refusal text;
  allowed constant text[] := array['nome', 'primeiro_nome', 'email', 'telefone', 'cidade', 'uf', 'idade', 'profissao',
    'origem', 'companhia', 'problema', 'resultado'];
  -- The columns in the order the person chose them, each once.
  columns_wanted text[] := array(
    select u.c from unnest(coalesce(target_columns, '{}')) with ordinality as u (c, i)
    where u.c = any (allowed) group by u.c order by min(u.i));
  limit_rows integer := 20000;
  total integer;
begin
  select * into segment from public.marketing_segments where id = target_segment;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(segment.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.segment_refusal(segment.org_id);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if segment.archived_at is not null or cardinality(columns_wanted) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select count(*) into total from public.segment_people_ids(segment.org_id, segment.filters);
  if total > limit_rows then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'limit', limit_rows);
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (segment.org_id, auth.uid(), 'marketing.segment_exported', 'marketing_segment', segment.id::text,
    jsonb_build_object('people', total, 'columns', to_jsonb(columns_wanted)));
  return jsonb_build_object('ok', true, 'columns', to_jsonb(columns_wanted), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nome', f.full_name, 'primeiro_nome', split_part(f.full_name, ' ', 1), 'email', f.email, 'telefone', f.phone,
      'cidade', f.city, 'uf', f.uf, 'idade', f.age, 'profissao', f.profession,
      'origem', array_to_string(f.origins, ', '), 'companhia', array_to_string(f.airlines, ', '),
      'problema', array_to_string(f.incidents, ', '), 'resultado', array_to_string(f.outcomes, ', ')
    ) - array(select c from unnest(allowed) c where c <> all (columns_wanted)) order by f.full_name)
    from public.people_facts(segment.org_id) f
    where f.person_id in (select i.person_id from public.segment_people_ids(segment.org_id, segment.filters) i)
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.export_marketing_segment(uuid, text[]) from public, anon;
grant execute on function public.export_marketing_segment(uuid, text[]) to authenticated;
