-- ============================================================
-- 0214 · The term to pay a condemnation, by the kind of lawsuit.
--
-- From the review of 2026-11-11 against the CPC and the Lei 9.099/1995. ONE
-- waited 15 calendar days from the final judgment in every lawsuit, and then
-- said to ask the cumprimento with the fine of 10 percent (0184). The law
-- counts it otherwise:
--
--   * In the small-claims court the loser is told, when intimated of the
--     judgment, to pay once it becomes final, and the execution follows on
--     request with no new citation (Lei 9.099/1995, art. 52, III and IV): the
--     15 days run from the final judgment, in business days (art. 12-A), over
--     the court's calendar; past them, the fine of 10 percent, with no fees
--     of 10 percent (FONAJE, Enunciado 97).
--   * In the civil court the cumprimento starts at the creditor's request,
--     and the debtor is intimated to pay in 15 business days (CPC, arts. 219,
--     513, § 2º, I, and 523): once the judgment is final with nothing
--     deposited, the next step is the request, and the fine of 10 percent and
--     the fees of 10 percent come only if the airline does not pay in the
--     term of that intimation (art. 523, § 1º).
--
-- The backend counts the business days with the rule of the deadlines
-- (`@flyee/rules/deadlines`) over the court's calendar, so the lawsuits owed a
-- computation say their kind and where they run, and the amount keeps the
-- kind and the last day of the term (`lawsuit_kind`, `pay_until`) for the
-- case's screen to say.
-- ============================================================

alter table public.lawsuit_amounts add column lawsuit_kind text;
alter table public.lawsuit_amounts add column pay_until date;
alter table public.lawsuit_amounts add constraint lawsuit_amounts_kind_check
  check (lawsuit_kind is null or lawsuit_kind in ('juizado', 'comum'));

-- The backend reads a court's calendar to count the term in business days.
grant execute on function public.court_calendar(text, integer) to service_role;

drop function public.lawsuit_amounts_owed(integer);

/**
 * The lawsuits whose amount ONE owes now (service role), as 0184 lists them, now with the lawsuit's kind and where it
 * runs (its court, system and comarca), which the term to pay is counted by.
 */
create function public.lawsuit_amounts_owed(target_limit integer default 20)
returns table (
  proceeding_id uuid, org_id uuid, case_id uuid, judgment_fact_id uuid, principal_cents bigint,
  judgment_on date, interest_from date, final_on date, deposited_cents bigint, last_deposit_on date,
  kind text, court text, system text, comarca text
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
         coalesce(d.total, 0)::bigint, d.last_on,
         p.kind, p.court, p.system, p.comarca
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

/**
 * Records what ONE computed of a lawsuit's amount and its next step (service role, 0184), now with the lawsuit's kind,
 * read from the lawsuit itself, and the last day of the term to pay the backend counted (none in the civil court,
 * where the term runs from the intimation the request asks). Told in the timeline when the step changes.
 */
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
      short_cents, fine_cents, lawsuit_kind, pay_until, computed_at)
    values (
      lawsuit.org_id, lawsuit.case_id, lawsuit.id, (target_amount ->> 'judgment_fact_id')::uuid, target_amount ->> 'rule',
      (target_amount ->> 'principal_cents')::bigint, (target_amount ->> 'correction_from')::date,
      (target_amount ->> 'interest_from')::date, (target_amount ->> 'as_of')::date,
      (target_amount ->> 'corrected_cents')::bigint, (target_amount ->> 'interest_cents')::bigint,
      (target_amount ->> 'total_cents')::bigint,
      coalesce(array(select jsonb_array_elements_text(target_amount -> 'missing')), '{}'),
      coalesce((target_amount ->> 'needs_terms')::boolean, false),
      coalesce((target_amount ->> 'deposited_cents')::bigint, 0), (target_amount ->> 'last_deposit_on')::date, step,
      coalesce((target_amount ->> 'short_cents')::bigint, 0), coalesce((target_amount ->> 'fine_cents')::bigint, 0),
      case when lawsuit.kind in ('juizado', 'comum') then lawsuit.kind end,
      case when lawsuit.kind = 'juizado' then (target_amount ->> 'pay_until')::date end,
      now())
    on conflict (proceeding_id) do update set
      judgment_fact_id = excluded.judgment_fact_id, rule = excluded.rule, principal_cents = excluded.principal_cents,
      correction_from = excluded.correction_from, interest_from = excluded.interest_from, as_of = excluded.as_of,
      corrected_cents = excluded.corrected_cents, interest_cents = excluded.interest_cents,
      total_cents = excluded.total_cents, missing = excluded.missing, needs_terms = excluded.needs_terms,
      deposited_cents = excluded.deposited_cents, last_deposit_on = excluded.last_deposit_on,
      next_step = excluded.next_step, short_cents = excluded.short_cents, fine_cents = excluded.fine_cents,
      lawsuit_kind = excluded.lawsuit_kind, pay_until = excluded.pay_until,
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
