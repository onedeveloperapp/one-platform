-- ============================================================
-- 0137 · Os relatórios dos livros, o fechamento do mês, os dados da nota fiscal e o pacote do contador
--
-- Phase 12 of the plan of the controladoria, the outcome of the cases and
-- the firm's finance, its first cut. Managerial reports, never the firm's
-- accounting nor its Livro Caixa, and ONE computes no tax: the month's
-- income statement by competence (`finance_report`: revenue by kind of fee,
-- deductions, costs, expenses with the pro-labore, financial result, the
-- losses of receivables written off on a line of their own, the result, and
-- the distribution of profits below it; the clients' money, the transfers and
-- the partners' capital out of it, Código Civil, art. 668), the cash flow by
-- the direct method with the clients' money in a block of its own, each
-- against the month before and the same month a year before; and the next 13
-- weeks from the open bills (`finance_forecast`). A month is closed once its
-- checklist is green (`finance_month_check`), by who configures the books with
-- the second factor or by ONE on the 25th of the next month, said as ONE's,
-- and reopened with a reason (`finance_closings`). The data of each invoice of
-- fees received (the firm's part only) is prepared, and the invoice the firm
-- issued is recorded against its receipt, which closes it
-- (`finance_invoices`); ONE issues no invoice and keeps no certificate.
-- ============================================================

-- ---------- The month's reports ----------
/** The sums of a month by line of the income statement and of the cash flow (internal). */
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
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.finance_month_lines(uuid, date) from public, anon, authenticated;

/**
 * The month's income statement and cash flow for who reads the books, against the month before and the same month a
 * year before, with whether its taxes were posted and whether it is closed.
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
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  return jsonb_build_object(
    'month', first,
    'current', public.finance_month_lines(target_org, first),
    'previous', public.finance_month_lines(target_org, (first - interval '1 month')::date),
    'last_year', public.finance_month_lines(target_org, (first - interval '1 year')::date),
    'closing', (select jsonb_build_object('closed_at', f.closed_at, 'by_one', f.by_one, 'reopened_at', f.reopened_at,
                  'reopen_reason', f.reopen_reason)
                from public.finance_closings f where f.org_id = target_org and f.month = first),
    'check', public.finance_month_check(target_org, first)
  );
end;
$$;

-- ---------- The forecast ----------
/**
 * The next 13 weeks from the open bills, for who reads the books: each week what is due to come in and to go out, and
 * the balance it would leave from today's balance of the accounts; the clients' money is never counted as the firm's.
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
    )
  );
end;
$$;

revoke all on function public.finance_forecast(uuid) from public, anon;
grant execute on function public.finance_forecast(uuid) to authenticated;

-- ---------- The closing ----------
create table public.finance_closings (
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id) on delete set null,
  by_one boolean not null default false,
  reopened_at timestamptz,
  reopened_by uuid references public.profiles (id) on delete set null,
  reopen_reason text,
  primary key (org_id, month),
  constraint finance_closings_month_check check (month = date_trunc('month', month)::date),
  constraint finance_closings_reopen_check check ((reopened_at is null) = (reopen_reason is null))
);

alter table public.finance_closings enable row level security;
create policy "finance_closings_select_reader" on public.finance_closings for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_closings to authenticated;
create trigger guard_impersonation_finance_closings after insert or update or delete on public.finance_closings
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The checklist of a month (internal): no line of a statement of the month waits for a person; every account of the
 * firm has a statement up to the month's end; no client's money of the month waits to be set apart. Green when all hold.
 */
create or replace function public.finance_month_check(target_org uuid, target_month date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with month as (select date_trunc('month', target_month)::date as first, (date_trunc('month', target_month) + interval '1 month - 1 day')::date as last),
  items as (
    select
      (select count(*) from public.finance_statement_lines l, month m
       where l.org_id = target_org and l.state = 'pending' and l.posted_on between m.first and m.last) as lines,
      (select count(*) from public.finance_accounts a, month m
       where a.org_id = target_org and a.archived_at is null and a.kind in ('bank', 'card', 'receiving', 'custody')
         and coalesce((select max(coalesce(s.ends_on, (s.imported_at at time zone 'America/Sao_Paulo')::date))
                       from public.finance_statements s where s.account_id = a.id and s.status <> 'removed'), date '1900-01-01') < m.last) as accounts,
      (select count(*) from public.finance_entries e join public.finance_accounts a on a.id = e.account_id, month m
       where e.org_id = target_org and e.kind = 'client_money' and e.cents > 0 and e.cancelled_at is null and e.apart_at is null
         and a.kind <> 'custody' and e.occurred_on between m.first and m.last) as apart
  )
  select jsonb_build_object('lines', i.lines, 'accounts', i.accounts, 'apart', i.apart,
    'green', i.lines = 0 and i.accounts = 0 and i.apart = 0)
  from items i;
$$;

revoke all on function public.finance_month_check(uuid, date) from public, anon, authenticated;
revoke all on function public.finance_report(uuid, date) from public, anon;
grant execute on function public.finance_report(uuid, date) to authenticated;

/** Who configures the books closes a month whose checklist is green, with the second factor; on the record. */
create or replace function public.close_finance_month(target_org uuid, target_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  first date := date_trunc('month', target_month)::date;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if public.finance_level(target_org) <> 'configure' then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if first >= date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date then
    return jsonb_build_object('ok', false, 'code', 'month_open');
  end if;
  if (public.finance_month_check(target_org, first) ->> 'green')::boolean is not true then
    return jsonb_build_object('ok', false, 'code', 'not_green');
  end if;
  insert into public.finance_closings (org_id, month, closed_by)
  values (target_org, first, auth.uid())
  on conflict (org_id, month) do update set closed_at = now(), closed_by = auth.uid(), by_one = false, reopened_at = null,
    reopened_by = null, reopen_reason = null;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.month_closed', 'organization', target_org::text, jsonb_build_object('month', first));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.close_finance_month(uuid, date) from public, anon;
grant execute on function public.close_finance_month(uuid, date) to authenticated;

/** Who configures the books reopens a closed month with its reason and the second factor; on the record. */
create or replace function public.reopen_finance_month(target_org uuid, target_month date, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  first date := date_trunc('month', target_month)::date;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if public.finance_level(target_org) <> 'configure' then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if reason is null or char_length(reason) not between 8 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  update public.finance_closings set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = reason
  where org_id = target_org and month = first and reopened_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_closed');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.month_reopened', 'organization', target_org::text, jsonb_build_object('month', first));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reopen_finance_month(uuid, date, text) from public, anon;
grant execute on function public.reopen_finance_month(uuid, date, text) to authenticated;

/**
 * ONE closes, on the 25th of the next month, every month of a firm whose books are open, whose checklist is green and
 * that nobody closed or reopened (the backend's); said as ONE's. Answers how many it closed.
 */
create or replace function public.close_finance_months_by_one()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  month date := (date_trunc('month', today) - interval '1 month')::date;
  firm record;
  closed integer := 0;
begin
  if extract(day from today) < 25 then
    return 0;
  end if;
  for firm in
    select o.id from public.organizations o
    where o.finance_opened_on is not null and o.finance_opened_on <= month + interval '1 month - 1 day'
      and not exists (select 1 from public.finance_closings f where f.org_id = o.id and f.month = month)
  loop
    if (public.finance_month_check(firm.id, month) ->> 'green')::boolean then
      insert into public.finance_closings (org_id, month, by_one) values (firm.id, month, true) on conflict do nothing;
      insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
      values (firm.id, null, 'system', 'finance.month_closed', 'organization', firm.id::text, jsonb_build_object('month', month, 'auto', true));
      closed := closed + 1;
    end if;
  end loop;
  return closed;
end;
$$;

revoke all on function public.close_finance_months_by_one() from public, anon, authenticated;
grant execute on function public.close_finance_months_by_one() to service_role;

-- ---------- The invoices ----------
create table public.finance_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The receipt of fees it is of: an income entry of the firm's.
  entry_id uuid not null unique references public.finance_entries (id) on delete cascade,
  number text not null,
  issued_on date not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint finance_invoices_number_check check (char_length(btrim(number)) between 1 and 40)
);

alter table public.finance_invoices enable row level security;
create policy "finance_invoices_select_reader" on public.finance_invoices for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_invoices to authenticated;
create trigger guard_impersonation_finance_invoices after insert or update or delete on public.finance_invoices
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The data of each invoice of a month's fees received, for who reads the books: the client as the taker, the value (the
 * firm's part only: a fee received, never a client's money), the description and the competence; and the invoice the
 * firm issued, when it was recorded.
 */
create or replace function public.finance_invoice_data(target_org uuid, target_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  first date := date_trunc('month', target_month)::date;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'entry_id', e.id, 'taker', e.counterparty, 'cents', e.cents, 'description', coalesce(c.name, 'Honorários advocatícios'),
      'competence', e.competence_on, 'occurred_on', e.occurred_on, 'case_seq', cs.seq,
      'invoice', (select jsonb_build_object('number', i.number, 'issued_on', i.issued_on) from public.finance_invoices i where i.entry_id = e.id)
    ) order by e.occurred_on, e.id)
    from public.finance_entries e
    join public.finance_categories c on c.id = e.category_id
    left join public.cases cs on cs.id = e.case_id
    where e.org_id = target_org and e.cancelled_at is null and e.kind = 'income'
      and c.code in ('receita.contratuais', 'receita.exito', 'receita.sucumbencia')
      and e.occurred_on between first and (first + interval '1 month - 1 day')::date
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.finance_invoice_data(uuid, date) from public, anon;
grant execute on function public.finance_invoice_data(uuid, date) to authenticated;

/** Who operates the books records the invoice the firm issued for a receipt of fees, which closes it. On the record. */
create or replace function public.record_finance_invoice(target_entry uuid, target_number text, target_issued_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry public.finance_entries%rowtype;
begin
  select * into entry from public.finance_entries where id = target_entry;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(entry.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if public.finance_level(entry.org_id) not in ('operate', 'configure') then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if entry.kind <> 'income' or char_length(btrim(coalesce(target_number, ''))) not between 1 and 40 or target_issued_on is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  insert into public.finance_invoices (org_id, entry_id, number, issued_on, recorded_by)
  values (entry.org_id, entry.id, btrim(target_number), target_issued_on, auth.uid())
  on conflict (entry_id) do update set number = excluded.number, issued_on = excluded.issued_on, recorded_by = excluded.recorded_by,
    recorded_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (entry.org_id, auth.uid(), 'finance.invoice_recorded', 'finance_entry', entry.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_finance_invoice(uuid, text, date) from public, anon;
grant execute on function public.record_finance_invoice(uuid, text, date) to authenticated;
