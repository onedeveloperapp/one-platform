-- ============================================================
-- 0148_funnel: where each person of the firm stands, as the owner decided on
-- 2026-11-10: a lead is who got in touch with ONE or with the firm and did not
-- sign the power of attorney.
--
-- The funnel goes by opportunity, and a person shows the furthest point any
-- of theirs reached (`people_funnel`):
--
--   cliente          signed a power of attorney or a contract of a case
--                    (`case_closings`, 0146), or has a lawsuit in court;
--   lead             a case going with no signature yet, or a conversation
--                    with the firm and no case;
--   nao_qualificado  the rule said their problem does not qualify (0147) and
--                    nobody went on with it, on a case or at their yes to ONE's
--                    word, with the reasons;
--   contato          known to the firm, and none of the above.
--
-- Pessoas reads the four as views and counts (`firm_people`,
-- `firm_people_numbers`), its counts the lists' own. The test cases count as
-- the rest of Pessoas counts them (0138): while the firm has no real case.
-- ============================================================

/** Where each person of a firm stands in the funnel, with the rule's reasons for one not qualified. Internal. */
create or replace function public.people_funnel(target_org uuid)
returns table (person_id uuid, point text, reasons text[])
language sql
stable
security definer
set search_path = public
as $$
  with cut as materialized (
    select not public.firm_has_real_case(target_org) as tests
  ), cases_of as materialized (
    select cp.person_id, c.id as case_id, c.status, c.qualification, c.qualification_released_at
    from public.case_parties cp
    join public.cases c on c.id = cp.case_id
    cross join cut
    where c.org_id = target_org and cp.role in ('claimant', 'guardian') and (cut.tests or not c.is_test)
  ), signed as materialized (
    select distinct co.person_id
    from cases_of co
    join public.case_closings(target_org) cl on cl.case_id = co.case_id
    where cl.signed_at is not null
    union
    select distinct co.person_id
    from cases_of co
    join public.proceedings p on p.case_id = co.case_id
    where p.status in ('filed', 'closed')
  ), held as materialized (
    -- A case the rule did not qualify, nobody having gone on with it, is no lead.
    select co.person_id, co.case_id, co.qualification -> 'reasons' as reasons
    from cases_of co
    where co.qualification ->> 'outcome' = 'not_qualified' and co.qualification_released_at is null
  ), going as materialized (
    select distinct co.person_id
    from cases_of co
    where co.status not in ('closed', 'declined')
      and not exists (select 1 from held h where h.case_id = co.case_id)
  ), refused_alerts as materialized (
    select a.person_id, a.qualification -> 'reasons' as reasons
    from public.flight_alerts a
    where a.org_id = target_org and a.person_id is not null and a.qualification ->> 'outcome' = 'not_qualified'
  ), talked as materialized (
    -- Who wrote to the firm's WhatsApp, by the number the firm has for them, and has no case.
    select distinct p.id as person_id
    from public.people p
    join public.wa_conversations w on w.org_id = p.org_id
    where p.org_id = target_org and p.phone is not null and w.last_inbound_at is not null
      and w.contact_wa_id = any (public.wa_phone_variants(p.phone))
      and not exists (select 1 from cases_of co where co.person_id = p.id)
  )
  select p.id,
    case
      when exists (select 1 from signed s where s.person_id = p.id) then 'cliente'
      when exists (select 1 from going g where g.person_id = p.id)
        or (exists (select 1 from talked t where t.person_id = p.id)
            and not exists (select 1 from refused_alerts r where r.person_id = p.id)) then 'lead'
      when exists (select 1 from held h where h.person_id = p.id)
        or exists (select 1 from refused_alerts r where r.person_id = p.id) then 'nao_qualificado'
      else 'contato'
    end,
    coalesce((
      select array_agg(distinct reason)
      from (
        select jsonb_array_elements_text(h.reasons) as reason from held h where h.person_id = p.id
        union all
        select jsonb_array_elements_text(r.reasons) from refused_alerts r where r.person_id = p.id
      ) x
    ), '{}')
  from public.people p
  where p.org_id = target_org;
$$;

revoke all on function public.people_funnel(uuid) from public, anon, authenticated;

/** The firm's people (0134), with where each stands in the funnel: the four points as views, counted. */
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
      select x.*, p.cpf, p.created_at, fu.point, fu.reasons
      from public.people_facts(target_org) x
      join public.people p on p.id = x.person_id
      join public.people_funnel(target_org) fu on fu.person_id = x.person_id
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
        when 'leads' then point = 'lead'
        when 'clientes' then point = 'cliente'
        when 'nao-qualificados' then point = 'nao_qualificado'
        when 'contatos' then point = 'contato'
        else true end
    )
    select jsonb_build_object(
      'counts', jsonb_build_object(
        'todos', (select count(*) from f),
        'ativos', (select count(*) from f where active),
        'sem-caso-ativo', (select count(*) from f where not active),
        'sem-marketing', (select count(*) from f where marketing_off),
        'leads', (select count(*) from f where point = 'lead'),
        'clientes', (select count(*) from f where point = 'cliente'),
        'nao-qualificados', (select count(*) from f where point = 'nao_qualificado'),
        'contatos', (select count(*) from f where point = 'contato')),
      'total', (select count(*) from shown),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.person_id, 'name', s.full_name, 'cpf', s.cpf, 'city', s.city, 'uf', s.uf, 'phone', s.phone,
          'active', s.active, 'has_case', s.has_case, 'adult', s.adult, 'marketing_off', s.marketing_off, 'erased', s.erased,
          'point', s.point, 'reasons', to_jsonb(s.reasons)
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

/** The numbers of who the firm serves (0138), with the funnel: how many leads, clients, not qualified and contacts. */
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
    funnel as (
      select fu.point from public.people_funnel(target_org) fu
      join f on f.person_id = fu.person_id
    ),
    tally as (
      select key, count(*)::integer as n from f, unnest(origins) as key group by key
    )
    select jsonb_build_object(
      'registered', (select count(*) from f),
      'tests_counted', not public.firm_has_real_case(target_org)
        and exists (select 1 from public.cases c where c.org_id = target_org and c.is_test),
      'active', (select count(*) from f where active),
      'inactive', (select count(*) from f where not active),
      'marketing_off', (select count(*) from f where marketing_off),
      'funnel', jsonb_build_object(
        'lead', (select count(*) from funnel where point = 'lead'),
        'cliente', (select count(*) from funnel where point = 'cliente'),
        'nao_qualificado', (select count(*) from funnel where point = 'nao_qualificado'),
        'contato', (select count(*) from funnel where point = 'contato')),
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
