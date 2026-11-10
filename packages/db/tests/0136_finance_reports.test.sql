begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- Os relatórios dos livros (0137). Lima's month of September: a fee
-- received, a client's money in and passed on, a capital put in, a transfer,
-- the tax of the month, a distribution of profits, and a receivable written
-- off. The income statement keeps each on its line and leaves the clients'
-- money, the transfer and the capital out; the cash flow keeps the clients'
-- money in its own block. Ana, who configures, closes the month with the
-- second factor once its checklist is green, and reopens it with a reason;
-- the invoice of the fee is recorded against its receipt. Rocha reads nothing.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1360000-0000-4000-8000-000000000001', 'ana@lima-relatorios.invalid', 'Ana Lima'),
  ('a1360000-0000-4000-8000-000000000002', 'caio@lima-relatorios.invalid', 'Caio Lima'),
  ('a1360000-0000-4000-8000-000000000009', 'edu@rocha-relatorios.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1360000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-relatorios', 'a1360000-0000-4000-8000-000000000001'),
  ('b1360000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-relatorios', 'a1360000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1360000-0000-4000-8000-00000000000a', 'a1360000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1360000-0000-4000-8000-00000000000a', 'a1360000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1360000-0000-4000-8000-00000000000b', 'a1360000-0000-4000-8000-000000000009', 'owner', 'socio');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1360000-0000-4000-8000-00000000000a', date '2026-08-01')$$);
-- A cash account: it owes no statement, so the month's checklist reads only the books.
insert into public.finance_accounts (id, org_id, kind, name, opening_cents) values
  ('a3360000-0000-4000-8000-000000000001', 'b1360000-0000-4000-8000-00000000000a', 'cash', 'Caixa', 0);
create function pg_temp.category(code text) returns uuid language sql as $$
  select id from public.finance_categories where org_id = 'b1360000-0000-4000-8000-00000000000a' and code = $1;
$$;
insert into public.finance_entries (id, org_id, account_id, kind, cents, category_id, counterparty, occurred_on, competence_on) values
  ('a4360000-0000-4000-8000-000000000001', 'b1360000-0000-4000-8000-00000000000a', 'a3360000-0000-4000-8000-000000000001',
   'income', 300000, pg_temp.category('receita.exito'), 'Maria Teste', '2026-09-10', '2026-09-10'),
  ('a4360000-0000-4000-8000-000000000002', 'b1360000-0000-4000-8000-00000000000a', 'a3360000-0000-4000-8000-000000000001',
   'client_money', 1000000, pg_temp.category('cliente.recebido'), 'TJGO', '2026-09-05', '2026-09-05'),
  ('a4360000-0000-4000-8000-000000000003', 'b1360000-0000-4000-8000-00000000000a', 'a3360000-0000-4000-8000-000000000001',
   'client_money', -700000, pg_temp.category('cliente.repassado'), 'Maria Teste', '2026-09-12', '2026-09-12'),
  ('a4360000-0000-4000-8000-000000000004', 'b1360000-0000-4000-8000-00000000000a', 'a3360000-0000-4000-8000-000000000001',
   'partner', 500000, pg_temp.category('socio.aporte'), 'Ana Lima', '2026-09-01', '2026-09-01'),
  ('a4360000-0000-4000-8000-000000000005', 'b1360000-0000-4000-8000-00000000000a', 'a3360000-0000-4000-8000-000000000001',
   'expense', -18000, pg_temp.category('despesa.tributos'), 'Receita Federal', '2026-09-20', '2026-09-20'),
  ('a4360000-0000-4000-8000-000000000006', 'b1360000-0000-4000-8000-00000000000a', 'a3360000-0000-4000-8000-000000000001',
   'partner', -100000, pg_temp.category('socio.lucros'), 'Ana Lima', '2026-09-28', '2026-09-28');
-- The client's money was set apart as it arrived.
update public.finance_entries set apart_at = '2026-09-05 15:00+00' where id = 'a4360000-0000-4000-8000-000000000002';
insert into public.finance_bills (org_id, direction, counterparty, description, category_id, cents, due_on, competence_on, status,
                                  closed_at, closed_reason) values
  ('b1360000-0000-4000-8000-00000000000a', 'receive', 'João Teste', 'Honorários', pg_temp.category('receita.contratuais'), 50000,
   '2026-08-01', '2026-08-01', 'written_off', '2026-09-15 12:00+00', 'Cliente não pagou.');

-- ---------- The reports ----------

select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'report',
  $$public.finance_report('b1360000-0000-4000-8000-00000000000a', date '2026-09-01')$$);
select ok(
  (select jsonb_agg(d ->> 'line' order by d ->> 'line') = '["deducao", "receita"]'::jsonb
     and sum((d ->> 'cents')::bigint) = 282000
   from res, jsonb_array_elements(value -> 'current' -> 'dre') d where key = 'report')
    and pg_temp.got('report', '{current,distribution}') = '100000' and pg_temp.got('report', '{current,losses}') = '50000'
    and pg_temp.got('report', '{current,taxes}') = 'true',
  'the income statement keeps the fee and the tax, the distribution and the losses on their lines, and leaves out the clients'' money and the capital'
);
select ok(
  (select (d ->> 'cents')::bigint = 300000 from res, jsonb_array_elements(value -> 'current' -> 'dfc') d
   where key = 'report' and d ->> 'line' = 'clientes'),
  'the cash flow keeps the clients'' money in a block of its own'
);

-- ---------- The closing ----------

select pg_temp.as_person('a1360000-0000-4000-8000-000000000002', 'close-caio',
  $$public.close_finance_month('b1360000-0000-4000-8000-00000000000a', date '2026-09-01')$$);
select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'close-aal1',
  $$public.close_finance_month('b1360000-0000-4000-8000-00000000000a', date '2026-09-01')$$, 'aal1');
select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'close',
  $$public.close_finance_month('b1360000-0000-4000-8000-00000000000a', date '2026-09-01')$$);
select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'reopen-bad',
  $$public.reopen_finance_month('b1360000-0000-4000-8000-00000000000a', date '2026-09-01', 'erro')$$);
select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'reopen',
  $$public.reopen_finance_month('b1360000-0000-4000-8000-00000000000a', date '2026-09-01', 'Faltou lançar a guia do INSS.')$$);
select ok(
  pg_temp.got('close-caio', '{code}') = 'not_allowed' and pg_temp.got('close-aal1', '{code}') = 'second_factor'
    and pg_temp.got('close', '{ok}') = 'true' and pg_temp.got('reopen-bad', '{code}') = 'invalid_data'
    and pg_temp.got('reopen', '{ok}') = 'true'
    and (select reopened_at is not null from public.finance_closings where org_id = 'b1360000-0000-4000-8000-00000000000a'),
  'who configures the books closes a green month with the second factor, and reopens it with a reason'
);

-- ---------- The invoice ----------

select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'invoice',
  $$public.record_finance_invoice('a4360000-0000-4000-8000-000000000001', '2026/123', date '2026-09-11')$$);
select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'invoices',
  $$public.finance_invoice_data('b1360000-0000-4000-8000-00000000000a', date '2026-09-01')$$);
select ok(
  pg_temp.got('invoice', '{ok}') = 'true' and pg_temp.got('invoices', '{0,cents}') = '300000'
    and pg_temp.got('invoices', '{0,invoice,number}') = '2026/123'
    and (select jsonb_array_length(value) = 1 from res where key = 'invoices'),
  'the data of the invoice is the fee received only, and the invoice recorded closes it'
);

select pg_temp.as_person('a1360000-0000-4000-8000-000000000001', 'forecast',
  $$public.finance_forecast('b1360000-0000-4000-8000-00000000000a')$$);
select is((select jsonb_array_length(value -> 'weeks') from res where key = 'forecast'), 13, 'the forecast has the next 13 weeks');

select pg_temp.sign_in('a1360000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok($$ select public.finance_report('b1360000-0000-4000-8000-00000000000a', date '2026-09-01') $$, '42501', null,
  'nobody of another firm reads its reports');
reset role;

select * from finish();
rollback;
