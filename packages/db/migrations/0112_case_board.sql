-- ============================================================
-- 0112 · The board of the controladoria, by step
--
-- Phase 1 of the plan of the controladoria, the outcome of the cases and
-- the firm's finance: besides the list, the controladoria sees the cases
-- going as a board, a column per step of their way, only to look at (ONE
-- moves a case from one step to the next; nobody drags a card).
--
-- `firm_case_board` reads who has each case and its step by the rule of
-- the top of the case (`case_standing`, 0111) and answers each step with
-- how many cases are at it, how many stagnated, and its first cases, the
-- longest at the step first (then the oldest case), each with its client,
-- its days at the step, whether it stagnated and who has it and why; or,
-- for one step and from a position, the next cases of that column. Of
-- every module, or of one. For anybody of the firm: the page decides who
-- sees it, as with the stock.
-- ============================================================

create or replace function public.firm_case_board(
  target_org uuid,
  target_module text default null,
  target_step text default null,
  target_offset integer default 0,
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  limits jsonb := coalesce(
    (select s.value -> 'stagnant_days' from public.platform_settings s where s.key = 'controladoria'), '{}'::jsonb
  );
  take integer := least(greatest(coalesce(target_limit, 10), 1), 50);
  skip integer := least(greatest(coalesce(target_offset, 0), 0), 100000);
  answer jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  with standing as materialized (
    select s.case_id, s.holder, s.why, s.step, s.step_since,
           greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) as days
    from public.case_standing(target_org, target_module) s
    where target_step is null or s.step = target_step
  ), marked as (
    select st.*, c.seq,
           coalesce(case when jsonb_typeof(limits -> st.step) = 'number'
             then st.days > (limits ->> st.step)::numeric end, false) as stagnant,
           -- The longest at the step first, then the oldest case.
           row_number() over (partition by st.step order by st.days desc, c.seq) as pos
    from standing st
    join public.cases c on c.id = st.case_id
  ), shown as (
    select m.* from marked m where m.pos > skip and m.pos <= skip + take
  )
  select jsonb_build_object(
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'step', g.step,
        'cases', g.cases,
        'stagnant', g.stagnant,
        'limit', case when jsonb_typeof(limits -> g.step) = 'number' then (limits ->> g.step)::integer end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', sh.case_id,
            'seq', sh.seq,
            -- The case is named as the list names it: its first adult claimant, else who answers for a minor.
            'client', coalesce((
              select p.full_name from public.case_parties cp
              join public.people p on p.id = cp.person_id
              where cp.case_id = sh.case_id
              order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                       cp.created_at, cp.id
              limit 1
            ), ''),
            'holder', sh.holder,
            'why', sh.why,
            'step_since', sh.step_since,
            'days', sh.days,
            'stagnant', sh.stagnant
          ) order by sh.pos)
          from shown sh where sh.step = g.step
        ), '[]'::jsonb)
      ) order by g.step)
      from (
        select m.step, count(*)::integer as cases, count(*) filter (where m.stagnant)::integer as stagnant
        from marked m
        group by m.step
      ) g
    ), '[]'::jsonb),
    'offset', skip,
    'limits', limits
  ) into answer;
  return answer;
end;
$$;

revoke all on function public.firm_case_board(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.firm_case_board(uuid, text, text, integer, integer) to authenticated;
