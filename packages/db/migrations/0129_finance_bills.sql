-- ============================================================
-- 0129 · Contas a pagar e a receber
--
-- Phase 5 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its first cut. What the firm owes and what it has to
-- receive are bills (`finance_bills`): who, what, the category, the case,
-- the value, the due day and the month they belong to, and, for a bill with
-- a typed line, the line and its barcode as the rule of `@flyee/rules/boleto`
-- checked them in the browser (the value and the due day it says fill the
-- form). A bill that repeats is a series of the months asked. The person pays
-- at the bank and ONE sees it on the statement: a line that pays or receives
-- an open bill (the same value, within the setting's days of its due day, or
-- more after it, the rest written as interest and fine, or less up to its
-- due day, the rest as a discount) settles it, as ONE's, and its entry is the
-- bill's; a person registers a payment by hand too, in part or whole, and a
-- bill paid in part stays open by the rest. Nothing is deleted: a bill is
-- cancelled or renegotiated (the new terms make new bills of the same total,
-- the old one closed as renegotiated) with its reason, and one a client will
-- not pay is written off by who configures, with the second factor. ONE
-- never charges anybody: "O que cobrar ou informar" tells the firm's people
-- which receivables are due or late, and they charge outside ONE. What waits
-- (bills of today and the next days, late ones, receivables to charge) is
-- read by who reads the books and nobody else.
-- ============================================================

-- ---------- The bills ----------
create table public.finance_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- `pay`: the firm owes it; `receive`: the firm has it to receive.
  direction text not null,
  status text not null default 'open',
  counterparty text,
  description text,
  category_id uuid references public.finance_categories (id) on delete restrict,
  cost_center_id uuid references public.finance_cost_centers (id) on delete set null,
  case_id uuid,
  cents bigint not null,
  due_on date not null,
  competence_on date not null,
  -- The typed line and the barcode, checked by the rule in the browser and again by length here.
  typed_line text,
  barcode text,
  series_id uuid,
  series_index integer,
  series_total integer,
  -- Bills a renegotiation made, and the one it closed.
  renegotiated_from uuid references public.finance_bills (id) on delete set null,
  paid_cents bigint not null default 0,
  paid_on date,
  source text not null default 'manual',
  by_one boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  closed_reason text,
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id),
  constraint finance_bills_direction_check check (direction in ('pay', 'receive')),
  constraint finance_bills_status_check check (status in ('open', 'paid', 'cancelled', 'renegotiated', 'written_off')),
  constraint finance_bills_cents_check check (cents > 0 and paid_cents >= 0),
  constraint finance_bills_line_check check (
    (typed_line is null or typed_line ~ '^[0-9]{47,48}$') and (barcode is null or barcode ~ '^[0-9]{44}$')
  ),
  constraint finance_bills_text_check check (
    (counterparty is null or char_length(counterparty) between 1 and 120)
    and (description is null or char_length(description) between 1 and 300)
  ),
  constraint finance_bills_source_check check (source in ('manual', 'series', 'renegotiation')),
  constraint finance_bills_closed_check check (
    (status in ('cancelled', 'renegotiated', 'written_off')) = (closed_reason is not null)
    and (closed_reason is null or char_length(closed_reason) between 3 and 300)
  )
);

create index finance_bills_open_idx on public.finance_bills (org_id, direction, due_on) where status = 'open';
create index finance_bills_org_idx on public.finance_bills (org_id, due_on desc);

alter table public.finance_bills enable row level security;
create policy "finance_bills_select_reader" on public.finance_bills
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_bills to authenticated;
create trigger guard_impersonation_finance_bills after insert or update or delete on public.finance_bills
  for each statement execute function public.guard_impersonation_readonly();

/** Each payment of a bill: the entry it is, what of it went to the bill, and the interest and fine or the discount. */
create table public.finance_bill_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bill_id uuid not null references public.finance_bills (id) on delete cascade,
  entry_id uuid not null references public.finance_entries (id) on delete cascade,
  paid_on date not null,
  base_cents bigint not null,
  extra_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  by_one boolean not null default false,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  constraint finance_bill_payments_cents_check check (base_cents > 0 and extra_cents >= 0 and discount_cents >= 0)
);

create unique index finance_bill_payments_entry_idx on public.finance_bill_payments (entry_id) where undone_at is null;
create index finance_bill_payments_bill_idx on public.finance_bill_payments (bill_id) where undone_at is null;

alter table public.finance_bill_payments enable row level security;
create policy "finance_bill_payments_select_reader" on public.finance_bill_payments
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_bill_payments to authenticated;
create trigger guard_impersonation_finance_bill_payments after insert or update or delete on public.finance_bill_payments
  for each statement execute function public.guard_impersonation_readonly();

-- How far a line is looked for around a bill's due day, how much more after it is interest and fine, and how much less
-- up to it is a discount; how many months a series makes; how many days ahead a bill is said to be soon.
update public.platform_settings
set value = jsonb_build_object('bill_days_before', 30, 'bill_days_after', 60, 'bill_extra_percent', 20,
  'bill_discount_percent', 10, 'bill_series_max', 24, 'bill_soon_days', 7, 'bill_old_years', 5) || value
where key = 'finance';

-- ---------- Who writes a bill ----------
/** Why a bill's fields are not one, or null: the shared checks of a bill written and of a bill renegotiated. */
create or replace function public.finance_bill_problem(
  target_org uuid,
  target_direction text,
  target_category uuid,
  target_cost_center uuid,
  target_case uuid,
  target_cents bigint,
  target_due date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_direction is null or target_direction not in ('pay', 'receive') then 'direction'
    when target_cents is null or target_cents <= 0 then 'cents'
    when target_due is null or target_due < (now() at time zone 'America/Sao_Paulo')::date - interval '10 years'
         or target_due > (now() at time zone 'America/Sao_Paulo')::date + interval '10 years' then 'due_on'
    when target_category is null or not exists (
      select 1 from public.finance_categories c
      where c.id = target_category and c.org_id = target_org and c.archived_at is null
        and case target_direction
          when 'pay' then c.kind in ('expense', 'partner_out', 'client_money')
          else c.kind in ('income', 'partner_in', 'client_money')
        end
    ) then 'category'
    when target_cost_center is not null and not exists (
      select 1 from public.finance_cost_centers c where c.id = target_cost_center and c.org_id = target_org and c.archived_at is null
    ) then 'cost_center'
    when target_case is not null and not exists (select 1 from public.cases c where c.id = target_case and c.org_id = target_org)
      then 'case'
  end;
$$;

revoke all on function public.finance_bill_problem(uuid, text, uuid, uuid, uuid, bigint, date) from public, anon, authenticated;

/**
 * Writes a bill to pay or to receive (`operate`, the second factor), or changes one still open with nothing paid: who,
 * what, the category of its way, the case, the value, the due day, the month it belongs to, the typed line and its
 * barcode, and, for a new one, how many months it repeats (`repeat`: a series, each month a bill of its own).
 */
create or replace function public.save_finance_bill(target_org uuid, target_bill uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  direction_value text := nullif(btrim(coalesce(fields ->> 'direction', '')), '');
  counterparty_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'counterparty', ''), '\s+', ' ', 'g')), '');
  description_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'description', ''), '\s+', ' ', 'g')), '');
  line_value text := nullif(regexp_replace(coalesce(fields ->> 'typed_line', ''), '\D', '', 'g'), '');
  barcode_value text := nullif(regexp_replace(coalesce(fields ->> 'barcode', ''), '\D', '', 'g'), '');
  category_value uuid;
  center_value uuid;
  case_value uuid;
  cents_value bigint;
  due_value date;
  competence_value date;
  repeat_value integer := 1;
  problem text;
  series uuid;
  saved uuid;
  current public.finance_bills%rowtype;
  turn integer;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  begin
    category_value := nullif(fields ->> 'category_id', '')::uuid;
    center_value := nullif(fields ->> 'cost_center_id', '')::uuid;
    case_value := nullif(fields ->> 'case_id', '')::uuid;
    due_value := nullif(fields ->> 'due_on', '')::date;
    competence_value := coalesce(nullif(fields ->> 'competence_on', '')::date, due_value);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'fields');
  end;
  if coalesce(fields ->> 'cents', '') !~ '^[0-9]{1,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents');
  end if;
  cents_value := (fields ->> 'cents')::bigint;
  if coalesce(fields ->> 'repeat', '') ~ '^[0-9]{1,3}$' then
    repeat_value := (fields ->> 'repeat')::integer;
  end if;
  if repeat_value < 1 or repeat_value > public.finance_setting('bill_series_max', 24) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'repeat');
  end if;
  if (counterparty_value is not null and char_length(counterparty_value) > 120)
     or (description_value is not null and char_length(description_value) > 300) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'text');
  end if;
  if (line_value is not null and line_value !~ '^[0-9]{47,48}$') or (barcode_value is not null and barcode_value !~ '^[0-9]{44}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'typed_line');
  end if;

  if target_bill is not null then
    select * into current from public.finance_bills b where b.id = target_bill and b.org_id = target_org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if current.status <> 'open' or current.paid_cents > 0 then
      return jsonb_build_object('ok', false, 'code', 'bill_settled');
    end if;
    direction_value := current.direction;
  end if;
  problem := public.finance_bill_problem(target_org, direction_value, category_value, center_value, case_value, cents_value,
    due_value);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', problem);
  end if;
  if competence_value is null or abs(competence_value - due_value) > 3660 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'competence');
  end if;

  if target_bill is not null then
    update public.finance_bills
    set counterparty = counterparty_value, description = description_value, category_id = category_value,
        cost_center_id = center_value, case_id = case_value, cents = cents_value, due_on = due_value,
        competence_on = competence_value, typed_line = line_value, barcode = barcode_value
    where id = target_bill;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'finance.bill_changed', 'finance_bill', target_bill::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'bill_id', target_bill);
  end if;

  series := case when repeat_value > 1 then gen_random_uuid() end;
  for turn in 0 .. repeat_value - 1 loop
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, cost_center_id, case_id,
      cents, due_on, competence_on, typed_line, barcode, series_id, series_index, series_total, source, created_by)
    values (target_org, direction_value, counterparty_value, description_value, category_value, center_value, case_value,
      cents_value, (due_value + make_interval(months => turn))::date, (competence_value + make_interval(months => turn))::date,
      case when turn = 0 then line_value end, case when turn = 0 then barcode_value end, series,
      case when series is not null then turn + 1 end, case when series is not null then repeat_value end,
      case when turn = 0 then 'manual' else 'series' end, auth.uid())
    returning id into saved;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.bill_written', 'finance_bill', saved::text,
    jsonb_build_object('direction', direction_value, 'months', repeat_value));
  return jsonb_build_object('ok', true, 'bill_id', saved, 'months', repeat_value);
end;
$$;

revoke all on function public.save_finance_bill(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_finance_bill(uuid, uuid, jsonb) to authenticated;

-- ---------- A payment, by hand and by the statement ----------
/**
 * Records a payment of a bill as its entry (internal): what of the money went to the bill, the interest and fine above
 * it, the discount below it; the bill paid once what went to it reaches its value, else open by the rest.
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
  insert into public.finance_bill_payments (org_id, bill_id, entry_id, paid_on, base_cents, extra_cents, discount_cents, by_one)
  values (bill.org_id, bill.id, target_entry, target_paid_on, base, extra, discount, target_by_one);
  update public.finance_bills
  set paid_cents = paid_cents + base,
      status = case when paid_cents + base >= cents then 'paid' else status end,
      paid_on = case when paid_cents + base >= cents then target_paid_on else paid_on end
  where id = bill.id;
end;
$$;

revoke all on function public.finance_pay_bill(uuid, uuid, date, bigint, boolean) from public, anon, authenticated;

/**
 * A person registers a payment or a receipt of a bill (`operate`, the second factor): the account it went through, the
 * day and the value. It is an entry written by hand, which ONE joins to the statement's line when it arrives; the bill
 * is paid by it, or stays open by the rest. A value with a discount the person says (`discount_cents`) closes it too.
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
 * The open bill a statement's line pays or receives (internal), or null: of its way, the same value within the
 * setting's days around its due day, else more after the due day (interest and fine, up to the setting's share) or a
 * little less up to it (a discount); the nearest due day first.
 */
create or replace function public.finance_bill_for_line(target_line uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with line as (select * from public.finance_statement_lines where id = target_line),
  settings as (
    select public.finance_setting('bill_days_before', 30) as before_days,
           public.finance_setting('bill_days_after', 60) as after_days,
           public.finance_setting('bill_extra_percent', 20) as extra,
           public.finance_setting('bill_discount_percent', 10) as discount
  )
  select b.id
  from public.finance_bills b, line l, settings s
  where b.org_id = l.org_id and b.status = 'open'
    and b.direction = case when l.cents > 0 then 'receive' else 'pay' end
    and l.posted_on between b.due_on - s.before_days and b.due_on + s.after_days
    and (
      abs(l.cents) = b.cents - b.paid_cents
      or (l.posted_on > b.due_on and abs(l.cents) > b.cents - b.paid_cents
          and abs(l.cents) * 100 <= (b.cents - b.paid_cents) * (100 + s.extra))
      or (l.posted_on <= b.due_on and abs(l.cents) < b.cents - b.paid_cents
          and abs(l.cents) * 100 >= (b.cents - b.paid_cents) * (100 - s.discount))
    )
  order by (abs(l.cents) = b.cents - b.paid_cents) desc, abs(l.posted_on - b.due_on), b.due_on, b.created_at, b.id
  limit 1;
$$;

revoke all on function public.finance_bill_for_line(uuid) from public, anon, authenticated;
/** What a rule decides of the pending lines, an open bill a line pays or receives among them (0129). */
create or replace function public.finance_decide_lines(target_org uuid, target_statement uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  line public.finance_statement_lines%rowtype;
  other public.finance_statement_lines%rowtype;
  rule public.finance_rules%rowtype;
  entry uuid;
  pair uuid;
  decided integer := 0;
  transfer_category uuid := (select c.id from public.finance_categories c where c.org_id = target_org and c.kind = 'transfer'
                             and c.archived_at is null order by c.position limit 1);
  client_category uuid := (select c.id from public.finance_categories c where c.org_id = target_org and c.kind = 'client_money'
                           and c.archived_at is null order by c.position limit 1);
  match_days integer := public.finance_setting('match_days', 5);
  transfer_days integer := public.finance_setting('transfer_days', 2);
  bill_id uuid;
  bill public.finance_bills%rowtype;
begin
  for line in
    select * from public.finance_statement_lines l
    where l.org_id = target_org and l.state = 'pending' and (target_statement is null or l.statement_id = target_statement)
    order by l.posted_on, l.created_at, l.id
    for update skip locked
  loop
    -- A line decided meanwhile (the other leg of a transfer) is left as it is, and a possible repetition of a line the
    -- bank already sent waits for a person: it may be the same money twice, or two payments of one value.
    continue when (select l.state from public.finance_statement_lines l where l.id = line.id) <> 'pending';
    continue when line.repeat_of is not null;

    -- A client's money, by the setting's words: never revenue.
    if client_category is not null and public.finance_is_client_money(line.memo, line.cents) then
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
        competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id, 'client_money', line.cents, client_category, line.memo, line.posted_on,
        line.posted_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'client_money', decided_at = now() where id = line.id;
      decided := decided + 1;
      continue;
    end if;

    -- An open bill the line pays or receives (0129): its entry is the bill's, as ONE's.
    bill_id := public.finance_bill_for_line(line.id);
    if bill_id is not null then
      select b.* into bill from public.finance_bills b where b.id = bill_id;
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, cost_center_id,
        counterparty, description, case_id, occurred_on, competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id,
        case (select c.kind from public.finance_categories c where c.id = bill.category_id)
          when 'client_money' then 'client_money' when 'partner_in' then 'partner' when 'partner_out' then 'partner'
          else case when bill.direction = 'pay' then 'expense' else 'income' end end,
        line.cents, bill.category_id, bill.cost_center_id, bill.counterparty, line.memo, bill.case_id,
        line.posted_on, bill.competence_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'bill', decided_at = now() where id = line.id;
      perform public.finance_pay_bill(bill_id, entry, line.posted_on, abs(line.cents), true);
      decided := decided + 1;
      bill_id := null;
      continue;
    end if;

    -- An entry written by hand that shows the same money.
    select e.id into entry from public.finance_entries e
    where e.account_id = line.account_id and e.source = 'manual' and e.cancelled_at is null and e.statement_line_id is null
      and e.cents = line.cents and abs(e.occurred_on - line.posted_on) <= match_days
    order by abs(e.occurred_on - line.posted_on), e.created_at, e.id
    limit 1;
    if entry is not null then
      update public.finance_entries set statement_line_id = line.id where id = entry;
      update public.finance_statement_lines set state = 'matched', entry_id = entry, decided_by_one = true,
        decided_rule = 'manual_entry', decided_at = now() where id = line.id;
      decided := decided + 1;
      continue;
    end if;

    -- A transfer between two of the firm's accounts: the other leg pending in another account.
    if transfer_category is not null then
      select l.* into other from public.finance_statement_lines l
      where l.org_id = target_org and l.state = 'pending' and l.account_id <> line.account_id and l.cents = -line.cents
        and abs(l.posted_on - line.posted_on) <= transfer_days and l.id <> line.id
      order by abs(l.posted_on - line.posted_on), l.created_at, l.id
      limit 1
      for update skip locked;
      if other.id is not null then
        pair := gen_random_uuid();
        insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
          competence_on, statement_line_id, transfer_id, source, by_one)
        values (target_org, line.account_id, 'transfer', line.cents, transfer_category, line.memo, line.posted_on,
          line.posted_on, line.id, pair, 'one', true)
        returning id into entry;
        update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
          decided_rule = 'transfer', decided_at = now() where id = line.id;
        insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
          competence_on, statement_line_id, transfer_id, source, by_one)
        values (target_org, other.account_id, 'transfer', other.cents, transfer_category, other.memo, other.posted_on,
          other.posted_on, other.id, pair, 'one', true)
        returning id into entry;
        update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
          decided_rule = 'transfer', decided_at = now() where id = other.id;
        decided := decided + 2;
        other := null;
        continue;
      end if;
    end if;

    -- A firm's rule: the longest words that answer first.
    select r.* into rule from public.finance_rules r
    where r.org_id = target_org and r.direction = case when line.cents > 0 then 'in' else 'out' end
      and strpos(' ' || public.finance_memo_words(line.memo) || ' ', ' ' || public.finance_memo_words(r.words) || ' ') > 0
      and public.finance_entry_problem(target_org, line.account_id, r.kind, line.cents, r.category_id, r.cost_center_id,
            null, line.posted_on) is null
    order by char_length(r.words) desc, r.created_at
    limit 1;
    if rule.id is not null then
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, cost_center_id, counterparty,
        description, occurred_on, competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id, rule.kind, line.cents, rule.category_id, rule.cost_center_id, rule.counterparty,
        line.memo, line.posted_on, line.posted_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'rule:' || rule.id, decided_at = now() where id = line.id;
      decided := decided + 1;
      rule := null;
    end if;
  end loop;
  return decided;
end;
$$;

revoke all on function public.finance_decide_lines(uuid, uuid) from public, anon, authenticated;
/** Cancels entries, and undoes the payment of a bill each was (0129). */
create or replace function public.finance_cancel_entries(target_entries uuid[], target_reason text, target_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.finance_statement_lines l
  set state = 'pending', entry_id = null, decided_by = null, decided_by_one = false, decided_rule = null, decided_at = null
  where l.entry_id = any (target_entries) or l.id in (
    select e.statement_line_id from public.finance_entries e where e.id = any (target_entries) and e.statement_line_id is not null
  );
  update public.finance_entries
  set cancelled_at = now(), cancelled_by = target_by, cancelled_reason = left(target_reason, 300), statement_line_id = null
  where id = any (target_entries) and cancelled_at is null;
  -- A payment of a bill an entry was is undone with it, and the bill is open again by what it had paid (0129).
  update public.finance_bills b
  set paid_cents = greatest(b.paid_cents - p.base_cents, 0),
      status = case when b.status = 'paid' then 'open' else b.status end,
      paid_on = case when b.status = 'paid' then null else b.paid_on end
  from public.finance_bill_payments p
  where p.entry_id = any (target_entries) and p.undone_at is null and p.bill_id = b.id;
  update public.finance_bill_payments set undone_at = now() where entry_id = any (target_entries) and undone_at is null;
end;
$$;

revoke all on function public.finance_cancel_entries(uuid[], text, uuid) from public, anon, authenticated;

-- ---------- Closing a bill, renegotiating it ----------
/**
 * Closes an open bill with its reason, never deleting it: cancelled (`operate`), or, for a receivable a client will not
 * pay, written off (`configure`). Both with the second factor, on the record.
 */
create or replace function public.close_finance_bill(target_org uuid, target_bill uuid, target_how text, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, case when target_how = 'written_off' then 'configure' else 'operate' end);
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
  bill public.finance_bills%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if target_how is null or target_how not in ('cancelled', 'written_off') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'how');
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into bill from public.finance_bills b where b.id = target_bill and b.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if bill.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'bill_settled');
  end if;
  if target_how = 'written_off' and bill.direction <> 'receive' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'how');
  end if;
  update public.finance_bills set status = target_how, closed_at = now(), closed_by = auth.uid(), closed_reason = reason
  where id = bill.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.bill_' || target_how, 'finance_bill', bill.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.close_finance_bill(uuid, uuid, text, text) from public, anon;
grant execute on function public.close_finance_bill(uuid, uuid, text, text) to authenticated;

/**
 * Renegotiates an open bill (`operate`, the second factor): the person says the new terms (how many installments and
 * the first due day) and ONE writes the installments of what is still owed, the cents split so they add up whole; the
 * old bill closes as renegotiated with the reason, never deleted.
 */
create or replace function public.renegotiate_finance_bill(target_org uuid, target_bill uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  reason text := nullif(btrim(coalesce(fields ->> 'reason', '')), '');
  bill public.finance_bills%rowtype;
  parts integer;
  first_due date;
  owed bigint;
  each bigint;
  series uuid := gen_random_uuid();
  turn integer;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if coalesce(fields ->> 'installments', '') !~ '^[0-9]{1,3}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'installments');
  end if;
  parts := (fields ->> 'installments')::integer;
  if parts < 1 or parts > public.finance_setting('bill_series_max', 24) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'installments');
  end if;
  begin
    first_due := (fields ->> 'first_due_on')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'due_on');
  end;
  if first_due is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'due_on');
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into bill from public.finance_bills b where b.id = target_bill and b.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if bill.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'bill_settled');
  end if;
  owed := bill.cents - bill.paid_cents;
  if owed < parts then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'installments');
  end if;
  each := owed / parts;
  for turn in 0 .. parts - 1 loop
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, cost_center_id, case_id,
      cents, due_on, competence_on, series_id, series_index, series_total, renegotiated_from, source, created_by)
    values (target_org, bill.direction, bill.counterparty, bill.description, bill.category_id, bill.cost_center_id,
      bill.case_id, case when turn = parts - 1 then owed - each * (parts - 1) else each end,
      (first_due + make_interval(months => turn))::date, (first_due + make_interval(months => turn))::date,
      series, turn + 1, parts, bill.id, 'renegotiation', auth.uid());
  end loop;
  update public.finance_bills set status = 'renegotiated', closed_at = now(), closed_by = auth.uid(), closed_reason = reason
  where id = bill.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.bill_renegotiated', 'finance_bill', bill.id::text,
    jsonb_build_object('installments', parts));
  return jsonb_build_object('ok', true, 'series_id', series);
end;
$$;

revoke all on function public.renegotiate_finance_bill(uuid, uuid, jsonb) from public, anon;
grant execute on function public.renegotiate_finance_bill(uuid, uuid, jsonb) to authenticated;

-- ---------- What waits, with the bills ----------
/** What waits for somebody of the books, the bills due soon, late and to charge among them (0129). */
create or replace function public.firm_finance_attention(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with books as (
    select o.finance_opened_on as opened, (now() at time zone 'America/Sao_Paulo')::date as today,
      public.finance_setting('statement_late_days', 10) as late_days
    from public.organizations o
    where o.id = target_org and o.finance_opened_on is not null and public.finance_reads(target_org)
  ),
  last_statement as (
    select s.account_id, max(coalesce(s.ends_on, (s.imported_at at time zone 'America/Sao_Paulo')::date)) as last_on
    from public.finance_statements s
    where s.org_id = target_org and s.status <> 'removed'
    group by s.account_id
  )
  select case when not exists (select 1 from books) then null else jsonb_build_object(
    'level', public.finance_level(target_org),
    'lines', (
      select jsonb_build_object('count', count(*), 'accounts', count(distinct l.account_id), 'oldest', min(l.posted_on))
      from public.finance_statement_lines l
      where l.org_id = target_org and l.state = 'pending'
    ),
    'late', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', a.id, 'name', a.name, 'kind', a.kind, 'last_on', ls.last_on)
                       order by ls.last_on nulls first, a.name)
      from public.finance_accounts a
      cross join books b
      left join last_statement ls on ls.account_id = a.id
      where a.org_id = target_org and a.archived_at is null and a.kind in ('bank', 'card', 'receiving', 'custody')
        and coalesce(ls.last_on, greatest(b.opened, (a.created_at at time zone 'America/Sao_Paulo')::date))
            < b.today - b.late_days
    ), '[]'::jsonb),
    'bills', (
      select jsonb_build_object(
        'pay_soon', count(*) filter (where bl.direction = 'pay' and bl.due_on between b.today and b.today + soon),
        'pay_soon_cents', coalesce(sum(bl.cents - bl.paid_cents) filter (
          where bl.direction = 'pay' and bl.due_on between b.today and b.today + soon), 0),
        'pay_late', count(*) filter (where bl.direction = 'pay' and bl.due_on < b.today),
        'pay_late_cents', coalesce(sum(bl.cents - bl.paid_cents) filter (
          where bl.direction = 'pay' and bl.due_on < b.today), 0),
        'receive_late', count(*) filter (where bl.direction = 'receive' and bl.due_on < b.today),
        'receive_late_cents', coalesce(sum(bl.cents - bl.paid_cents) filter (
          where bl.direction = 'receive' and bl.due_on < b.today), 0),
        -- A receivable near the five years in which fees may be charged (Estatuto da Advocacia, art. 25).
        'receive_old', count(*) filter (where bl.direction = 'receive'
          and bl.due_on < (b.today - make_interval(years => old_years) + interval '6 months')::date)
      )
      from public.finance_bills bl
      cross join books b
      cross join (select public.finance_setting('bill_soon_days', 7) as soon,
                         public.finance_setting('bill_old_years', 5) as old_years) s
      where bl.org_id = target_org and bl.status = 'open'
    ),
    'apart', (
      select jsonb_build_object('count', count(*), 'cents', coalesce(sum(e.cents), 0), 'oldest', min(e.occurred_on))
      from public.finance_entries e
      join public.finance_accounts a on a.id = e.account_id
      where e.org_id = target_org and e.kind = 'client_money' and e.cents > 0 and e.cancelled_at is null
        and e.apart_at is null and a.kind <> 'custody'
    )
  ) end;
$$;

revoke all on function public.firm_finance_attention(uuid) from public, anon;
grant execute on function public.firm_finance_attention(uuid) to authenticated;
