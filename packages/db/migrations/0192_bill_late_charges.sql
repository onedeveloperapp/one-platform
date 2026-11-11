-- ============================================================
-- The interest and the fine of a bill's payment, each apart.
--
-- A payment above what a bill still owed kept what was more as one figure,
-- "interest and fine" (0129). Now each payment says, when it is known, how
-- much of it was the fine and how much the interest (`fine_cents`,
-- `interest_cents`, which add up to `extra_cents`; both zero is "not split"):
--   * a person says it when registering the payment (`settle_finance_bill`,
--     redefined from 0129: `fine_cents` and `interest_cents`, which must add up
--     to what was paid above the rest), or later (`split_finance_payment`, who
--     operates the books, the second factor, on the record);
--   * where nobody says it, a fee of a case paid late is split by the case's
--     contract (0159: `case_fees.late_fine_percent`, `late_interest_percent`):
--     the fine is the contract's on what was owed, at most what was paid above
--     it, and the rest is interest; a contract with no interest splits only a
--     payment whose extra is exactly its fine (`split_by` 'contract'). ONE
--     reads it so and may err; a person changes it.
-- The month's income statement takes what was paid above a bill out of the
-- bill's category and says it on the financial line: the fines and the
-- interest paid or received, and what nobody split (`finance_month_lines`,
-- redefined from 0163); the budget counts the category without it and the
-- charges outside the budget (`finance_budget_lines`, redefined from 0163).
-- ============================================================

alter table public.finance_bill_payments add column fine_cents bigint not null default 0;
alter table public.finance_bill_payments add column interest_cents bigint not null default 0;
alter table public.finance_bill_payments add column split_by text;
alter table public.finance_bill_payments add column split_at timestamptz;
alter table public.finance_bill_payments add constraint finance_bill_payments_split_check check (
  fine_cents >= 0 and interest_cents >= 0
  and ((fine_cents = 0 and interest_cents = 0 and split_by is null)
       or (fine_cents + interest_cents = extra_cents and extra_cents > 0 and split_by in ('person', 'contract')))
);

-- ---------- The contract's split ----------
/**
 * How the contract of a fee of a case splits what was paid above it (internal): the fine of the contract on what was
 * owed, at most the extra, and the rest as interest; null where the bill is no fee of a case paid after its due day,
 * the case has no late terms, or the contract has no interest and the extra is more than its fine.
 */
create or replace function public.finance_contract_split(
  target_bill uuid,
  target_paid_on date,
  target_owed bigint,
  target_extra bigint
)
returns bigint[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bill public.finance_bills%rowtype;
  fine_percent numeric;
  interest_percent numeric;
  fine bigint;
begin
  if target_extra <= 0 then
    return null;
  end if;
  select * into bill from public.finance_bills b where b.id = target_bill;
  if not found or bill.direction <> 'receive' or bill.case_id is null or bill.source not in ('fees', 'act', 'success')
     or target_paid_on <= bill.due_on then
    return null;
  end if;
  select f.late_fine_percent, f.late_interest_percent into fine_percent, interest_percent
  from public.case_fees f where f.case_id = bill.case_id;
  if not found or (coalesce(fine_percent, 0) = 0 and coalesce(interest_percent, 0) = 0) then
    return null;
  end if;
  fine := least(round(target_owed * coalesce(fine_percent, 0) / 100)::bigint, target_extra);
  if coalesce(interest_percent, 0) = 0 and fine <> target_extra then
    return null;
  end if;
  return array[fine, target_extra - fine];
end;
$$;

revoke all on function public.finance_contract_split(uuid, date, bigint, bigint) from public, anon, authenticated;

/**
 * Records a payment of a bill as its entry (internal, 0129): what of the money went to the bill, the interest and fine
 * above it, the discount below it; the bill paid once what went to it reaches its value, else open by the rest. What
 * was paid above it is split by the contract of a fee of a case (0192), else left for a person to split.
 */
create or replace function public.finance_pay_bill(
  target_bill uuid,
  target_entry uuid,
  target_paid_on date,
  target_cents bigint,
  target_by_one boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bill public.finance_bills%rowtype;
  rest bigint;
  base bigint;
  extra bigint := 0;
  discount bigint := 0;
  discount_limit integer := public.finance_setting('bill_discount_percent', 10);
  split bigint[];
begin
  select * into bill from public.finance_bills b where b.id = target_bill for update;
  rest := bill.cents - bill.paid_cents;
  if target_cents >= rest then
    base := rest;
    extra := target_cents - rest;
  elsif target_paid_on <= bill.due_on and target_cents * 100 >= rest * (100 - discount_limit) and target_by_one then
    -- ONE reads a little less up to the due day as a discount; a person says it in their own payment.
    base := rest;
    discount := rest - target_cents;
  else
    base := target_cents;
  end if;
  split := public.finance_contract_split(bill.id, target_paid_on, rest, extra);
  insert into public.finance_bill_payments (org_id, bill_id, entry_id, paid_on, base_cents, extra_cents, discount_cents,
    by_one, fine_cents, interest_cents, split_by, split_at)
  values (bill.org_id, bill.id, target_entry, target_paid_on, base, extra, discount, target_by_one,
    coalesce(split[1], 0), coalesce(split[2], 0), case when split is not null then 'contract' end,
    case when split is not null then now() end);
  update public.finance_bills
  set paid_cents = paid_cents + base,
      status = case when paid_cents + base >= cents then 'paid' else status end,
      paid_on = case when paid_cents + base >= cents then target_paid_on else paid_on end
  where id = bill.id;
end;
$$;

revoke all on function public.finance_pay_bill(uuid, uuid, date, bigint, boolean) from public, anon, authenticated;

/** Whether two amounts a person typed split an extra (internal): both whole, at least zero, adding up to it. */
create or replace function public.finance_split_problem(fields jsonb, target_extra bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(fields ->> 'fine_cents', '') = '' and coalesce(fields ->> 'interest_cents', '') = '' then null
    when coalesce(fields ->> 'fine_cents', '') !~ '^[0-9]{1,13}$'
      or coalesce(fields ->> 'interest_cents', '') !~ '^[0-9]{1,13}$' then 'late'
    when target_extra <= 0 then 'late'
    when (fields ->> 'fine_cents')::bigint + (fields ->> 'interest_cents')::bigint <> target_extra then 'late'
  end;
$$;

revoke all on function public.finance_split_problem(jsonb, bigint) from public, anon, authenticated;

/**
 * A person registers a payment or a receipt of a bill (`operate`, the second factor; 0129): the account it went
 * through, the day and the value. It is an entry written by hand, which ONE joins to the statement's line when it
 * arrives; the bill is paid by it, or stays open by the rest. A value with a discount the person says
 * (`discount_cents`) closes it too. What was paid above the rest may be said as its fine and its interest
 * (`fine_cents`, `interest_cents`, adding up to it; 0192), else the contract of a fee of a case splits it.
 */
create or replace function public.settle_finance_bill(target_org uuid, target_bill uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  bill public.finance_bills%rowtype;
  category public.finance_categories%rowtype;
  account_value uuid;
  day_value date;
  cents_value bigint;
  discount_value bigint := 0;
  extra_value bigint;
  entry_kind text;
  answer jsonb;
  entry uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into bill from public.finance_bills b where b.id = target_bill and b.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if bill.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'bill_settled');
  end if;
  begin
    account_value := nullif(fields ->> 'account_id', '')::uuid;
    day_value := nullif(fields ->> 'paid_on', '')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'fields');
  end;
  if coalesce(fields ->> 'cents', '') !~ '^[0-9]{1,13}$' or (fields ->> 'cents')::bigint <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents');
  end if;
  cents_value := (fields ->> 'cents')::bigint;
  if coalesce(fields ->> 'discount_cents', '') ~ '^[0-9]{1,13}$' then
    discount_value := (fields ->> 'discount_cents')::bigint;
  end if;
  if discount_value > 0 and cents_value + discount_value <> bill.cents - bill.paid_cents then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'discount');
  end if;
  extra_value := greatest(cents_value - (bill.cents - bill.paid_cents), 0);
  if public.finance_split_problem(fields, extra_value) is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'late');
  end if;
  select * into category from public.finance_categories c where c.id = bill.category_id;
  entry_kind := case
    when category.kind = 'client_money' then 'client_money'
    when category.kind in ('partner_in', 'partner_out') then 'partner'
    when bill.direction = 'pay' then 'expense'
    else 'income'
  end;
  -- The entry is written as a person writes one, through the books' own function and its checks.
  answer := public.save_finance_entry(target_org, jsonb_build_object(
    'kind', entry_kind, 'account_id', account_value,
    'cents', (case when bill.direction = 'pay' then -cents_value else cents_value end)::text,
    'category_id', bill.category_id, 'cost_center_id', bill.cost_center_id, 'case_id', bill.case_id,
    'counterparty', bill.counterparty, 'description', bill.description, 'occurred_on', day_value,
    'competence_on', bill.competence_on));
  if (answer ->> 'ok')::boolean is not true then
    return answer;
  end if;
  entry := (answer ->> 'entry_id')::uuid;
  if discount_value > 0 then
    insert into public.finance_bill_payments (org_id, bill_id, entry_id, paid_on, base_cents, discount_cents)
    values (target_org, bill.id, entry, day_value, bill.cents - bill.paid_cents, discount_value);
    update public.finance_bills set paid_cents = cents, status = 'paid', paid_on = day_value where id = bill.id;
  else
    perform public.finance_pay_bill(bill.id, entry, day_value, cents_value, false);
    if extra_value > 0 and coalesce(fields ->> 'fine_cents', '') <> '' then
      update public.finance_bill_payments
      set fine_cents = (fields ->> 'fine_cents')::bigint, interest_cents = (fields ->> 'interest_cents')::bigint,
          split_by = 'person', split_at = now()
      where entry_id = entry and undone_at is null;
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.bill_settled', 'finance_bill', bill.id::text,
    jsonb_build_object('direction', bill.direction));
  return jsonb_build_object('ok', true, 'entry_id', entry,
    'status', (select b.status from public.finance_bills b where b.id = bill.id));
end;
$$;

revoke all on function public.settle_finance_bill(uuid, uuid, jsonb) from public, anon;
grant execute on function public.settle_finance_bill(uuid, uuid, jsonb) to authenticated;

/**
 * Who operates the books says how much of what a payment paid above its bill was the fine and how much the interest
 * (the second factor, on the record): a payment ONE left unsplit, or one whose split a person corrects. Both empty takes
 * the split back.
 */
create or replace function public.split_finance_payment(target_org uuid, target_payment uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  payment public.finance_bill_payments%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into payment from public.finance_bill_payments p
  where p.id = target_payment and p.org_id = target_org and p.undone_at is null for update;
  if not found or payment.extra_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if coalesce(fields ->> 'fine_cents', '') = '' and coalesce(fields ->> 'interest_cents', '') = '' then
    update public.finance_bill_payments
    set fine_cents = 0, interest_cents = 0, split_by = null, split_at = null where id = payment.id;
  elsif public.finance_split_problem(fields, payment.extra_cents) is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'late');
  else
    update public.finance_bill_payments
    set fine_cents = (fields ->> 'fine_cents')::bigint, interest_cents = (fields ->> 'interest_cents')::bigint,
        split_by = 'person', split_at = now()
    where id = payment.id;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.payment_split', 'finance_bill', payment.bill_id::text,
    jsonb_build_object('payment', payment.id));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.split_finance_payment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.split_finance_payment(uuid, uuid, jsonb) to authenticated;

-- ---------- The reports ----------

/**
 * What came of each category in a month against its budget (0163): the late charges of the bills paid (0192) are no
 * part of a category, and count outside the budget.
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
  live as (
    select e.category_id, e.cents, coalesce(p.extra_cents, 0) as extra
    from public.finance_entries e
    cross join month m
    left join public.finance_bill_payments p on p.entry_id = e.id and p.undone_at is null
    where e.org_id = target_org and e.cancelled_at is null and e.category_id is not null
      and e.kind in ('income', 'expense', 'partner') and e.competence_on between m.first and m.last
  ),
  actual as (
    select l.category_id, abs(sum(l.cents - sign(l.cents)::bigint * l.extra))::bigint as cents
    from live l
    group by l.category_id
  ),
  late as (
    select coalesce(sum(l.extra) filter (where l.cents > 0), 0)::bigint as income,
           coalesce(sum(l.extra) filter (where l.cents < 0), 0)::bigint as expense
    from live l
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
                                              where b.org_id = target_org and b.month = m.first and b.category_id = a.category_id)), 0)
      + (select income from late),
    'outside_expense', coalesce((
      select sum(a.cents) from actual a join public.finance_categories c on c.id = a.category_id
      where c.kind in ('expense', 'partner_out') and not exists (
        select 1 from public.finance_budgets b, month m
        where b.org_id = target_org and b.month = m.first and b.category_id = a.category_id)), 0)
      + (select expense from late)
  );
$$;

revoke all on function public.finance_budget_lines(uuid, date) from public, anon, authenticated;

/**
 * The sums of a month by line of the income statement and of the cash flow (0137), by cost centre and partner (0163);
 * what a bill's payment paid above it is on the financial line, its fine and its interest apart where known (0192).
 */
create or replace function public.finance_month_lines(target_org uuid, target_month date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with month as (select date_trunc('month', target_month)::date as first, (date_trunc('month', target_month) + interval '1 month - 1 day')::date as last),
  live as (
    select e.*, c.code, c.name as category, c.dre_line, c.dfc_line,
           coalesce(p.extra_cents, 0) as late_extra, coalesce(p.fine_cents, 0) as late_fine,
           coalesce(p.interest_cents, 0) as late_interest
    from public.finance_entries e
    left join public.finance_categories c on c.id = e.category_id
    left join public.finance_bill_payments p on p.entry_id = e.id and p.undone_at is null
    where e.org_id = target_org and e.cancelled_at is null
  ),
  dre_rows as (
    select coalesce(l.dre_line, case when l.kind = 'income' then 'receita' else 'despesa' end) as line,
           coalesce(l.category, 'Sem categoria') as category, l.cents - sign(l.cents)::bigint * l.late_extra as cents
    from live l, month m
    where l.competence_on between m.first and m.last and l.kind in ('income', 'expense', 'partner')
      and coalesce(l.dre_line, '') <> 'fora'
    union all
    select 'financeiro', x.category, x.cents
    from live l
    cross join month m
    cross join lateral (values
      (case when l.cents > 0 then 'Multas recebidas' else 'Multas pagas' end, sign(l.cents)::bigint * l.late_fine),
      (case when l.cents > 0 then 'Juros recebidos' else 'Juros pagos' end, sign(l.cents)::bigint * l.late_interest),
      (case when l.cents > 0 then 'Juros e multas recebidos, sem separar' else 'Juros e multas pagos, sem separar' end,
       sign(l.cents)::bigint * (l.late_extra - l.late_fine - l.late_interest))
    ) as x (category, cents)
    where l.competence_on between m.first and m.last and l.kind in ('income', 'expense', 'partner')
      and coalesce(l.dre_line, '') <> 'fora' and l.late_extra > 0 and x.cents <> 0
  )
  select jsonb_build_object(
    'dre', coalesce((
      select jsonb_agg(jsonb_build_object('line', x.line, 'category', x.category, 'cents', x.cents) order by x.line, x.category)
      from (
        select r.line, r.category, sum(r.cents)::bigint as cents
        from dre_rows r
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
