-- ============================================================
-- What a condemnation is worth, and what to ask for it (0184), item 4.6 of
-- the case journey plan. A lawsuit whose judgment condemned the airline to a
-- value and became final has its amount due computed by ONE, by
-- `atualizacao-v1` of `@flyee/rules/update` (from 30/08/2024 the IPCA and the
-- Selic less the IPCA, Lei 14.905/2024; a judgment before that day needs its
-- own terms, which ONE says it lacks), with the Banco Central's monthly rates
-- read by the backend (`@flyee/indices`). Against what the airline deposited,
-- ONE says the next step: the deposit is whole, so the levantamento; it came
-- short, so the complementação of the difference; nothing was deposited in
-- the 15 days after the judgment became final, so the cumprimento with the
-- fine of 10 percent (CPC, art. 523, § 1º; FONAJE, Enunciado 97); or wait.
-- The backend computes it (`lawsuit_amounts_owed`, `record_lawsuit_amount`),
-- the case's card "Resultado" says it, and nothing here moves money: the
-- firm's books follow the release as before (0130, 0135).
-- ============================================================

create table public.lawsuit_amounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null unique references public.proceedings (id) on delete cascade,
  judgment_fact_id uuid references public.lawsuit_facts (id) on delete set null,
  rule text not null,
  principal_cents bigint not null,
  correction_from date not null,
  interest_from date not null,
  as_of date not null,
  corrected_cents bigint not null,
  interest_cents bigint not null,
  total_cents bigint not null,
  -- The months no series answered: counted at zero, and said.
  missing text[] not null default '{}',
  -- A judgment before 30/08/2024: its own terms are needed for the months before that day, which ONE does not read.
  needs_terms boolean not null default false,
  deposited_cents bigint not null default 0,
  last_deposit_on date,
  -- aguardar: the airline's term runs; levantamento: the deposit is whole; complementacao: it came short;
  -- cumprimento: nothing came in the term.
  next_step text not null,
  short_cents bigint not null default 0,
  fine_cents bigint not null default 0,
  computed_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint lawsuit_amounts_step_check check (next_step in ('aguardar', 'levantamento', 'complementacao', 'cumprimento')),
  constraint lawsuit_amounts_cents_check check (
    principal_cents > 0 and corrected_cents >= 0 and interest_cents >= 0 and total_cents >= 0
    and deposited_cents >= 0 and short_cents >= 0 and fine_cents >= 0
  ),
  constraint lawsuit_amounts_rule_check check (rule ~ '^[a-z0-9-]{3,40}$')
);

create index lawsuit_amounts_case_idx on public.lawsuit_amounts (case_id);

alter table public.lawsuit_amounts enable row level security;
create policy "lawsuit_amounts_select_member" on public.lawsuit_amounts
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.lawsuit_amounts to authenticated;
create trigger guard_impersonation_lawsuit_amounts after insert or update or delete on public.lawsuit_amounts
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The lawsuits whose amount ONE owes now (service role): a judgment in force that condemned the airline to a value
 * (won in whole or in part), become final, of a case that did not end, whose amount was not computed today or whose
 * deposits changed since. With what the computation reads: the value, the judgment's day, the day the interest runs
 * from (the citation, read as the filing while ONE does not read the citation's day), the final judgment's day and
 * what was deposited.
 */
create or replace function public.lawsuit_amounts_owed(target_limit integer default 20)
returns table (
  proceeding_id uuid, org_id uuid, case_id uuid, judgment_fact_id uuid, principal_cents bigint,
  judgment_on date, interest_from date, final_on date, deposited_cents bigint, last_deposit_on date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select p.id, p.org_id, p.case_id, j.id, j.cents, j.happened_on,
         coalesce(p.filed_at::date, j.happened_on), t.happened_on,
         coalesce(d.total, 0)::bigint, d.last_on
  from public.proceedings p
  join public.cases c on c.id = p.case_id and c.status not in ('closed', 'declined')
  cross join lateral (
    select f.* from public.lawsuit_facts f
    where f.proceeding_id = p.id and f.kind = 'sentenca' and f.corrected_at is null
      and f.result in ('procedente', 'parcial') and f.cents is not null
    order by f.happened_on desc, f.created_at desc limit 1
  ) j
  cross join lateral (
    select f.* from public.lawsuit_facts f
    where f.proceeding_id = p.id and f.kind = 'transito' and f.corrected_at is null
    order by f.happened_on desc limit 1
  ) t
  left join lateral (
    select sum(f.cents) as total, max(f.happened_on) as last_on from public.lawsuit_facts f
    where f.proceeding_id = p.id and f.kind = 'deposito' and f.corrected_at is null and f.cents is not null
  ) d on true
  left join public.lawsuit_amounts a on a.proceeding_id = p.id
  where p.status = 'filed'
    and not exists (
      select 1 from public.lawsuit_facts f
      where f.proceeding_id = p.id and f.kind = 'arquivamento' and f.corrected_at is null
    )
    and (a.id is null
         or a.as_of < (now() at time zone 'America/Sao_Paulo')::date
         or a.deposited_cents is distinct from coalesce(d.total, 0)
         or a.judgment_fact_id is distinct from j.id)
  order by a.computed_at nulls first, p.id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.lawsuit_amounts_owed(integer) from public, anon, authenticated;
grant execute on function public.lawsuit_amounts_owed(integer) to service_role;

/** Records what ONE computed of a lawsuit's amount and its next step (service role), told in the timeline when it changes. */
create or replace function public.record_lawsuit_amount(target_proceeding uuid, target_amount jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  before public.lawsuit_amounts%rowtype;
  step text := target_amount ->> 'next_step';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into before from public.lawsuit_amounts where proceeding_id = lawsuit.id;
  begin
    insert into public.lawsuit_amounts (
      org_id, case_id, proceeding_id, judgment_fact_id, rule, principal_cents, correction_from, interest_from, as_of,
      corrected_cents, interest_cents, total_cents, missing, needs_terms, deposited_cents, last_deposit_on, next_step,
      short_cents, fine_cents, computed_at)
    values (
      lawsuit.org_id, lawsuit.case_id, lawsuit.id, (target_amount ->> 'judgment_fact_id')::uuid, target_amount ->> 'rule',
      (target_amount ->> 'principal_cents')::bigint, (target_amount ->> 'correction_from')::date,
      (target_amount ->> 'interest_from')::date, (target_amount ->> 'as_of')::date,
      (target_amount ->> 'corrected_cents')::bigint, (target_amount ->> 'interest_cents')::bigint,
      (target_amount ->> 'total_cents')::bigint,
      coalesce(array(select jsonb_array_elements_text(target_amount -> 'missing')), '{}'),
      coalesce((target_amount ->> 'needs_terms')::boolean, false),
      coalesce((target_amount ->> 'deposited_cents')::bigint, 0), (target_amount ->> 'last_deposit_on')::date, step,
      coalesce((target_amount ->> 'short_cents')::bigint, 0), coalesce((target_amount ->> 'fine_cents')::bigint, 0), now())
    on conflict (proceeding_id) do update set
      judgment_fact_id = excluded.judgment_fact_id, rule = excluded.rule, principal_cents = excluded.principal_cents,
      correction_from = excluded.correction_from, interest_from = excluded.interest_from, as_of = excluded.as_of,
      corrected_cents = excluded.corrected_cents, interest_cents = excluded.interest_cents,
      total_cents = excluded.total_cents, missing = excluded.missing, needs_terms = excluded.needs_terms,
      deposited_cents = excluded.deposited_cents, last_deposit_on = excluded.last_deposit_on,
      next_step = excluded.next_step, short_cents = excluded.short_cents, fine_cents = excluded.fine_cents,
      computed_at = now();
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  if before.id is null or before.next_step is distinct from step then
    perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'amount_step', 'system',
      jsonb_build_object('proceeding', lawsuit.id, 'step', step));
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_lawsuit_amount(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_lawsuit_amount(uuid, jsonb) to service_role;
