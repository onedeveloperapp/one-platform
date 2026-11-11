-- ============================================================
-- 0208 · The migration by the OAB from the DJEN (M6): the lawsuits the DJEN
-- already shows of the firm's lawyers, ready to be brought in.
--
-- The DJEN is read by the firm's registrations at the bar from the moment
-- they are added (0028), so a firm that arrives has, in days, the
-- publications of its lawyers' lawsuits. What it does not have in ONE is
-- each lawsuit's client. `firm_djen_lawsuits` lists the lawsuits of the
-- firm's publications that no lawsuit of the firm has yet (by the CNJ
-- number), each with its court, its unit and class as the latest publication
-- names them, when it was published first and last, how many times, and the
-- airline its texts name (the companies' names in court, 0032, else their
-- own names, when only one of them is named). The app turns the list into a
-- spreadsheet in the import's own columns, for the firm to write each
-- client's name and bring it in by the import of 0032, which checks each
-- line again. Who may import (a partner, a lawyer or the controladoria)
-- reads it; never in a support visit.
-- ============================================================

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
                )) as airline_iata
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
        'airline_name', (select coalesce(a.legal_name, a.name) from public.airlines a where a.iata = l.airline_iata)
      ) order by l.last_on desc, l.cnj), '[]'::jsonb)
    )
    from listed l
  );
end;
$$;

revoke all on function public.firm_djen_lawsuits(uuid, integer) from public, anon;
grant execute on function public.firm_djen_lawsuits(uuid, integer) to authenticated;
