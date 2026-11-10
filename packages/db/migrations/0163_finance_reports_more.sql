-- ============================================================
-- 0163 · O mês fechado, o orçamento, os relatórios por centro de custo e por sócio, e o êxito esperado
--
-- Phase 12 of the plan of the controladoria and the finance, its second cut, what the first left as its limits.
--
--   A closed month refuses a person's change: an entry written by hand, or any entry cancelled or changed by a
--   person, whose day or month of competence is in a month closed and not reopened (`finance_month_closed`, a trigger
--   on `finance_entries`): the person reopens the month first, with its reason. ONE's entries from the bank's
--   statement still enter (they are the bank's facts), and the report says the month changed after it closed.
--   The budget (`finance_budgets`): who configures the books says, per category of the chart, what the month should
--   come to, for a month and as many after it as asked (`save_finance_budget`, the second factor, on the record); the
--   report sets each against what the month came to (`finance_budget_lines`).
--   The month's lines by cost centre (income and expense by competence) and by partner (the partners' categories,
--   `socio.*`, by the counterparty written, by cash) join the report (`finance_month_lines` redefined from 0137).
--   The forecast says the success fees expected from the judgments and settlements of open cases whose money did not
--   come yet (`finance_forecast` redefined): never in the weeks, which hold only bills; said apart, with what already
--   became final.
-- ============================================================

-- ---------- The closed month ----------

/** Whether a day's month, or a month of competence, is closed and not reopened (internal). */
create or replace function public.finance_month_closed(target_org uuid, first_day date, second_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.finance_closings f
    where f.org_id = target_org and f.reopened_at is null
      and f.month in (date_trunc('month', first_day)::date, date_trunc('month', coalesce(second_day, first_day))::date)
  );
$$;

revoke all on function public.finance_month_closed(uuid, date, date) from public, anon, authenticated;

/** A person changes nothing of a closed month: an entry by hand, a cancellation, a change of value, day or category. */
create or replace function public.finance_entries_closed_month()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'manual' and new.statement_line_id is null
       and public.finance_month_closed(new.org_id, new.occurred_on, new.competence_on) then
      raise exception 'month_closed' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if (new.cancelled_at is not null and old.cancelled_at is null)
     or (new.cents, new.occurred_on, new.competence_on, new.category_id, new.account_id, new.kind)
        is distinct from (old.cents, old.occurred_on, old.competence_on, old.category_id, old.account_id, old.kind) then
    if public.finance_month_closed(old.org_id, old.occurred_on, old.competence_on)
       or public.finance_month_closed(new.org_id, new.occurred_on, new.competence_on) then
      raise exception 'month_closed' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.finance_entries_closed_month() from public, anon, authenticated;
create trigger finance_entries_closed_month before insert or update on public.finance_entries
  for each row execute function public.finance_entries_closed_month();

-- ---------- The budget ----------

create table public.finance_budgets (
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null,
  category_id uuid not null references public.finance_categories (id) on delete cascade,
  cents bigint not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, month, category_id),
  constraint finance_budgets_month_check check (month = date_trunc('month', month)::date),
  constraint finance_budgets_cents_check check (cents > 0 and cents < 1000000000000)
);

alter table public.finance_budgets enable row level security;
create policy "finance_budgets_select_reader" on public.finance_budgets
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_budgets to authenticated;
create trigger guard_impersonation_finance_budgets after insert or update or delete on public.finance_budgets
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Who configures the books says what each category of income and expense should come to in a month, and in as many
 * months after it as asked (1 to 12): the rows replace that month's budget. With the second factor; on the record.
 */
create or replace function public.save_finance_budget(target_org uuid, target_month date, target_rows jsonb, target_months integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure');
  first date := date_trunc('month', target_month)::date;
  row_value jsonb;
  turn integer;
  saved integer := 0;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if target_month is null or coalesce(target_months, 0) not between 1 and 12 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'months');
  end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'rows');
  end if;
  for row_value in select value from jsonb_array_elements(target_rows) loop
    if coalesce(row_value ->> 'cents', '') !~ '^[0-9]{1,12}$' or (row_value ->> 'cents')::bigint <= 0
       or coalesce(row_value ->> 'category_id', '') !~ '^[0-9a-f-]{36}$'
       or not exists (select 1 from public.finance_categories c
                      where c.id = (row_value ->> 'category_id')::uuid and c.org_id = target_org and c.archived_at is null
                        and c.kind in ('income', 'expense', 'partner_out')) then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'rows');
    end if;
  end loop;
  for turn in 0 .. target_months - 1 loop
    delete from public.finance_budgets b where b.org_id = target_org and b.month = (first + make_interval(months => turn))::date;
    insert into public.finance_budgets (org_id, month, category_id, cents, updated_by)
    select target_org, (first + make_interval(months => turn))::date, (r.value ->> 'category_id')::uuid,
           sum((r.value ->> 'cents')::bigint), auth.uid()
    from jsonb_array_elements(target_rows) r
    group by (r.value ->> 'category_id')::uuid;
    get diagnostics saved = row_count;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.budget_saved', 'organization', target_org::text,
    jsonb_build_object('month', first, 'months', target_months, 'categories', saved));
  return jsonb_build_object('ok', true, 'categories', saved);
end;
$$;

revoke all on function public.save_finance_budget(uuid, date, jsonb, integer) from public, anon;
grant execute on function public.save_finance_budget(uuid, date, jsonb, integer) to authenticated;

/**
 * A month's budget against what it came to (internal): each category budgeted, with what was planned and what the
 * month's entries by competence came to, as positive figures; and what came outside the budget, income and expense.
 */
create or replace function public.finance_budget_lines(target_org uuid, target_month date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with month as (select date_trunc('month', target_month)::date as first,
                        (date_trunc('month', target_month) + interval '1 month - 1 day')::date as last),
  actual as (
    select e.category_id, abs(sum(e.cents))::bigint as cents
    from public.finance_entries e, month m
    where e.org_id = target_org and e.cancelled_at is null and e.category_id is not null
      and e.kind in ('income', 'expense', 'partner') and e.competence_on between m.first and m.last
    group by e.category_id
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', c.id, 'category', c.name, 'kind', c.kind,
               'planned', b.cents, 'actual', coalesce(a.cents, 0)) order by c.kind, c.position, c.name)
      from public.finance_budgets b
      join month m on b.month = m.first
      join public.finance_categories c on c.id = b.category_id
      left join actual a on a.category_id = b.category_id
      where b.org_id = target_org
    ), '[]'::jsonb),
    'outside_income', coalesce((
      select sum(a.cents) from actual a join public.finance_categories c on c.id = a.category_id
      where c.kind = 'income' and not exists (select 1 from public.finance_budgets b, month m
                                              where b.org_id = target_org and b.month = m.first and b.category_id = a.category_id)), 0),
    'outside_expense', coalesce((
      select sum(a.cents) from actual a join public.finance_categories c on c.id = a.category_id
      where c.kind in ('expense', 'partner_out') and not exists (
        select 1 from public.finance_budgets b, month m
        where b.org_id = target_org and b.month = m.first and b.category_id = a.category_id)), 0)
  );
$$;

revoke all on function public.finance_budget_lines(uuid, date) from public, anon, authenticated;

-- ---------- The month's lines, by cost centre and by partner too ----------

/** The sums of a month by line of the income statement and of the cash flow (0137), by cost centre and partner (0163). */
create or replace function public.finance_month_lines(target_org uuid, target_month date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with month as (select date_trunc('month', target_month)::date as first, (date_trunc('month', target_month) + interval '1 month - 1 day')::date as last),
  live as (
    select e.*, c.code, c.name as category, c.dre_line, c.dfc_line
    from public.finance_entries e
    left join public.finance_categories c on c.id = e.category_id
    where e.org_id = target_org and e.cancelled_at is null
  )
  select jsonb_build_object(
    'dre', coalesce((
      select jsonb_agg(jsonb_build_object('line', x.line, 'category', x.category, 'cents', x.cents) order by x.line, x.category)
      from (
        select coalesce(l.dre_line, case when l.kind = 'income' then 'receita' else 'despesa' end) as line,
               coalesce(l.category, 'Sem categoria') as category, sum(l.cents)::bigint as cents
        from live l, month m
        where l.competence_on between m.first and m.last and l.kind in ('income', 'expense', 'partner')
          and coalesce(l.dre_line, '') <> 'fora'
        group by 1, 2
      ) x
    ), '[]'::jsonb),
    'distribution', coalesce((
      select sum(-l.cents) from live l, month m
      where l.competence_on between m.first and m.last and l.code = 'socio.lucros'), 0),
    'losses', coalesce((
      select sum(b.cents - b.paid_cents) from public.finance_bills b, month m
      where b.org_id = target_org and b.status = 'written_off' and b.direction = 'receive'
        and (b.closed_at at time zone 'America/Sao_Paulo')::date between m.first and m.last), 0),
    'taxes', exists (
      select 1 from live l, month m
      where l.competence_on between m.first and m.last and l.code = 'despesa.tributos'),
    'dfc', coalesce((
      select jsonb_agg(jsonb_build_object('line', x.line, 'cents', x.cents) order by x.line)
      from (
        select case when l.kind = 'client_money' then 'clientes' else coalesce(l.dfc_line, 'operacional') end as line,
               sum(l.cents)::bigint as cents
        from live l, month m
        where l.occurred_on between m.first and m.last and l.kind <> 'transfer'
        group by 1
      ) x
    ), '[]'::jsonb),
    'centers', coalesce((
      select jsonb_agg(jsonb_build_object('center', x.center, 'income', x.income, 'expense', x.expense)
                       order by x.center nulls last)
      from (
        select cc.name as center,
               coalesce(sum(l.cents) filter (where l.cents > 0), 0)::bigint as income,
               coalesce(-sum(l.cents) filter (where l.cents < 0), 0)::bigint as expense
        from live l
        join month m on l.competence_on between m.first and m.last
        left join public.finance_cost_centers cc on cc.id = l.cost_center_id
        where l.kind in ('income', 'expense') and coalesce(l.dre_line, '') <> 'fora'
        group by cc.name
      ) x
    ), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(jsonb_build_object('partner', x.partner, 'category', x.category, 'cents', x.cents)
                       order by x.partner, x.category)
      from (
        select coalesce(nullif(btrim(l.counterparty), ''), 'Sem nome') as partner, l.category, sum(l.cents)::bigint as cents
        from live l, month m
        where l.occurred_on between m.first and m.last and l.code like 'socio.%'
        group by 1, 2
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.finance_month_lines(uuid, date) from public, anon, authenticated;

/**
 * The month's income statement and cash flow for who reads the books (0137), with its budget against what it came to
 * and whether a statement changed it after it closed (0163).
 */
create or replace function public.finance_report(target_org uuid, target_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  first date := date_trunc('month', target_month)::date;
  closing public.finance_closings%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  select * into closing from public.finance_closings f where f.org_id = target_org and f.month = first;
  return jsonb_build_object(
    'month', first,
    'current', public.finance_month_lines(target_org, first),
    'previous', public.finance_month_lines(target_org, (first - interval '1 month')::date),
    'last_year', public.finance_month_lines(target_org, (first - interval '1 year')::date),
    'closing', case when closing.org_id is null then null else jsonb_build_object(
                 'closed_at', closing.closed_at, 'by_one', closing.by_one, 'reopened_at', closing.reopened_at,
                 'reopen_reason', closing.reopen_reason,
                 'changed_after', case when closing.reopened_at is null then (
                   select count(*) from public.finance_entries e
                   where e.org_id = target_org and e.created_at > closing.closed_at
                     and (date_trunc('month', e.occurred_on)::date = first or date_trunc('month', e.competence_on)::date = first))
                   else 0 end) end,
    'check', public.finance_month_check(target_org, first),
    'budget', public.finance_budget_lines(target_org, first)
  );
end;
$$;

revoke all on function public.finance_report(uuid, date) from public, anon;
grant execute on function public.finance_report(uuid, date) to authenticated;

-- ---------- The success fees expected ----------

/**
 * The next 13 weeks from the open bills (0137), and, apart, the success fees expected from the judgments won and the
 * settlements of open cases with fees whose money did not come yet (0163): the condemnation or the settlement as the
 * court wrote it (each claimant's when it says so) times the case's percent, never under its minimum; never counted in
 * the weeks, and the part of the lawsuits whose judgment became final said apart.
 */
create or replace function public.finance_forecast(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  start date := today - (extract(isodow from today)::integer - 1);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  return jsonb_build_object(
    'balance', coalesce((
      select sum(e.cents) from public.finance_entries e join public.finance_accounts a on a.id = e.account_id
      where e.org_id = target_org and e.cancelled_at is null and a.kind <> 'custody' and e.kind <> 'client_money'), 0)
      + coalesce((select sum(a.opening_cents) from public.finance_accounts a
                  where a.org_id = target_org and a.archived_at is null and a.kind <> 'custody'), 0),
    'weeks', (
      select jsonb_agg(jsonb_build_object(
        'starts_on', w.starts_on,
        'in_cents', coalesce((select sum(b.cents - b.paid_cents) from public.finance_bills b
                              where b.org_id = target_org and b.status = 'open' and b.direction = 'receive'
                                and greatest(b.due_on, today) between w.starts_on and w.starts_on + 6), 0),
        'out_cents', coalesce((select sum(b.cents - b.paid_cents) from public.finance_bills b
                               where b.org_id = target_org and b.status = 'open' and b.direction = 'pay'
                                 and greatest(b.due_on, today) between w.starts_on and w.starts_on + 6), 0)
      ) order by w.starts_on)
      from (select (start + 7 * n)::date as starts_on from generate_series(0, 12) as n) w
    ),
    'expected', (
      select jsonb_build_object(
        'cents', coalesce(sum(x.fee), 0),
        'final_cents', coalesce(sum(x.fee) filter (where x.final), 0),
        'lawsuits', count(*),
        'cases', count(distinct x.case_id))
      from (
        select f.case_id,
               greatest(round(won.value * (case when won.kind = 'acordo' and fees.settlement_percent is not null
                                                then fees.settlement_percent else fees.success_percent end) / 100)::bigint,
                        fees.success_min_cents) as fee,
               exists (select 1 from public.lawsuit_facts t where t.proceeding_id = f.proceeding_id and t.kind = 'transito'
                         and t.corrected_at is null) as final
        from (select distinct on (lf.proceeding_id) lf.proceeding_id, lf.case_id
              from public.lawsuit_facts lf
              where lf.org_id = target_org and lf.corrected_at is null and lf.cents is not null
                and (lf.kind = 'acordo' or (lf.kind = 'sentenca' and lf.result in ('procedente', 'parcial')))) f
        join public.cases c on c.id = f.case_id and c.status not in ('closed', 'declined') and not c.is_test
        join public.case_fees fees on fees.case_id = f.case_id and fees.success_percent > 0
        cross join lateral (
          select lf.kind, lf.cents * (case when lf.per_claimant
                                           then greatest((select count(*) from public.proceeding_parties pp
                                                          where pp.proceeding_id = lf.proceeding_id), 1)
                                           else 1 end) as value
          from public.lawsuit_facts lf
          where lf.proceeding_id = f.proceeding_id and lf.corrected_at is null and lf.cents is not null
            and (lf.kind = 'acordo' or (lf.kind = 'sentenca' and lf.result in ('procedente', 'parcial')))
          order by (lf.kind = 'acordo') desc, lf.happened_on desc
          limit 1
        ) won
        where not exists (select 1 from public.lawsuit_facts r where r.proceeding_id = f.proceeding_id
                            and r.kind = 'alvara' and r.received_on is not null and r.corrected_at is null)
      ) x
    )
  );
end;
$$;

revoke all on function public.finance_forecast(uuid) from public, anon;
grant execute on function public.finance_forecast(uuid) to authenticated;
