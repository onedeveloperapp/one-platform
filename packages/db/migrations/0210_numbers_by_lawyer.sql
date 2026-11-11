-- ============================================================
-- 0210 · The numbers by lawyer, and how alike their pieces are (M5).
--
-- The plan's panel of volume and likeness by lawyer, court and state: the
-- firm's numbers (0136, 0168, 0193) already group by court (the state's
-- court), comarca and unit; each lawsuit now also says who of the firm is
-- its lawyer (`proceeding_lawyers`, by the name their profile gives) and how
-- alike its approved piece was to the firm's most alike one (`case_drafts.
-- alike`, in a hundred, 0029), so the firm reads how many lawsuits each
-- lawyer carries, where, and how much their pieces repeat each other: what
-- the courts look at first in mass litigation (Recomendação CNJ 159/2024).
-- It decides nothing. The settlement's value was already given
-- (`settled_cents`); the app now reads it for the range of the settlements by
-- airline. Who may read the numbers is as before (`reads_firm_numbers`).
-- ============================================================

create or replace function public.firm_lawsuit_numbers(target_org uuid, target_tests boolean default false, target_module text default null)
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
  if not public.reads_firm_numbers(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(row_data order by row_data ->> 'filed_on' desc, row_data ->> 'id')
    from (
      select jsonb_build_object(
        'id', p.id, 'case_id', c.id, 'case_seq', c.seq, 'cnj', p.cnj, 'airline', c.airline_iata, 'incident', c.incident,
        'court', p.court, 'comarca', nullif(btrim(coalesce(p.comarca, '')), ''),
        'unit', nullif(btrim(coalesce(p.unit, '')), ''), 'kind', p.kind, 'module', c.module,
        'is_test', c.is_test,
        'filed_on', p.filed_at, 'opened_on', (c.created_at at time zone 'America/Sao_Paulo')::date,
        'result', j.result, 'judged_on', j.happened_on, 'judged_checked', j.checked, 'value_cents', j.per_claimant_cents,
        'claims', j.claims,
        'settled', s.id is not null, 'settled_cents', s.cents,
        'final', exists (select 1 from public.lawsuit_facts f where f.proceeding_id = p.id and f.kind = 'transito' and f.corrected_at is null),
        'paid_on', (select min(f.received_on) from public.lawsuit_facts f
                    where f.proceeding_id = p.id and f.kind = 'alvara' and f.received_on is not null and f.corrected_at is null),
        'closed', c.status in ('closed', 'declined'),
        'claimants', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = p.id),
        'lawyers', (select coalesce(jsonb_agg(coalesce(nullif(btrim(pr.display_name), ''), 'Pessoa sem nome') order by pr.display_name), '[]'::jsonb)
                    from public.proceeding_lawyers pl join public.profiles pr on pr.id = pl.user_id
                    where pl.proceeding_id = p.id and pl.org_id = p.org_id),
        'alike', (select max((a ->> 'percent')::numeric) from public.case_drafts d
                  cross join lateral jsonb_array_elements(d.alike) a
                  where d.proceeding_id = p.id and d.org_id = p.org_id and d.status in ('approved', 'issued')
                    and jsonb_typeof(a -> 'percent') = 'number'),
        'unchecked', (select count(*) from public.lawsuit_facts f where f.proceeding_id = p.id and f.corrected_at is null
                      and f.by_one and f.confirmed_by is null and f.source <> 'person')
      ) as row_data
      from public.proceedings p
      join public.cases c on c.id = p.case_id
      left join lateral (
        select f.result, f.happened_on, (f.source = 'person' or f.confirmed_by is not null) as checked, f.claims,
          case when f.cents is null then null
               when f.per_claimant then f.cents
               else f.cents / greatest((select count(*) from public.proceeding_parties pp where pp.proceeding_id = p.id), 1) end
            as per_claimant_cents
        from public.lawsuit_facts f
        where f.proceeding_id = p.id and f.kind = 'sentenca' and f.corrected_at is null
        order by f.happened_on desc, f.created_at desc limit 1
      ) j on true
      left join lateral (
        select f.id, f.cents from public.lawsuit_facts f
        where f.proceeding_id = p.id and f.kind = 'acordo' and f.corrected_at is null
        order by f.happened_on desc limit 1
      ) s on true
      where p.org_id = target_org and p.filed_at is not null and p.status in ('filed', 'closed')
        and (coalesce(target_tests, false) or not c.is_test)
        and (target_module is null or c.module = target_module)
      order by p.filed_at desc
      limit 5000
    ) rows
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.firm_lawsuit_numbers(uuid, boolean, text) from public, anon;
grant execute on function public.firm_lawsuit_numbers(uuid, boolean, text) to authenticated;
