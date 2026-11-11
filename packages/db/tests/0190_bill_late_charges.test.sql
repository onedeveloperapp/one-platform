begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The interest and the fine of a bill's payment, each apart (0192). Lima's
-- books are open: Ana, a partner, configures; Duda operates; Bia views. Duda
-- pays the rent late saying its fine and its interest; a sum that does not
-- add up is refused; the power bill paid late with nothing said stays
-- unsplit, and Duda splits it afterwards (Bia cannot, Rocha cannot reach it);
-- Maria's entry fee, paid late, is split by her case's contract (a fine of 2
-- percent, the rest interest). The month's income statement says the fines
-- and the interest on the financial line, out of the rent's and the fees'
-- categories, and the budget counts them outside.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1900000-0000-4000-8000-000000000001', 'ana@lima-juros.invalid', 'Ana Lima'),
  ('a1900000-0000-4000-8000-000000000003', 'bia@lima-juros.invalid', 'Bia Lima'),
  ('a1900000-0000-4000-8000-000000000004', 'duda@lima-juros.invalid', 'Duda Lima'),
  ('a1900000-0000-4000-8000-000000000009', 'edu@rocha-juros.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1900000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-juros', 'a1900000-0000-4000-8000-000000000001'),
  ('b1900000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-juros', 'a1900000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1900000-0000-4000-8000-00000000000a', 'a1900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1900000-0000-4000-8000-00000000000a', 'a1900000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1900000-0000-4000-8000-00000000000a', 'a1900000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1900000-0000-4000-8000-00000000000b', 'a1900000-0000-4000-8000-000000000009', 'owner', 'socio');
insert into public.people (id, org_id, full_name) values
  ('d1900000-0000-4000-8000-000000000001', 'b1900000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1900000-0000-4000-8000-000000000001', 'b1900000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1900000-0000-4000-8000-000000000001', 'b1900000-0000-4000-8000-00000000000a', 'c1900000-0000-4000-8000-000000000001',
   'd1900000-0000-4000-8000-000000000001', 'claimant');

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
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;
create function pg_temp.category(target_code text) returns text language sql as $$
  select id::text from public.finance_categories where org_id = 'b1900000-0000-4000-8000-00000000000a' and code = target_code;
$$;
create function pg_temp.bill(target_who text) returns uuid language sql as $$
  select id from public.finance_bills where org_id = 'b1900000-0000-4000-8000-00000000000a' and counterparty = target_who
  order by due_on limit 1;
$$;
create function pg_temp.payment(target_bill uuid) returns public.finance_bill_payments language sql as $$
  select * from public.finance_bill_payments where bill_id = target_bill and undone_at is null;
$$;
create function pg_temp.month() returns date language sql as $$ select date_trunc('month', current_date)::date $$;

select pg_temp.as_person('a1900000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1900000-0000-4000-8000-00000000000a', current_date - 120)$$);
select pg_temp.as_person('a1900000-0000-4000-8000-000000000001', 'grant-bia',
  $$public.set_finance_access('b1900000-0000-4000-8000-00000000000a', 'a1900000-0000-4000-8000-000000000003', 'view')$$);
select pg_temp.as_person('a1900000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1900000-0000-4000-8000-00000000000a', 'a1900000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1900000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1900000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'rent',
  format($$public.save_finance_bill('b1900000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'counterparty', 'Imobiliária Teste', 'category_id', pg_temp.category('despesa.aluguel'),
    'cents', '250000', 'due_on', current_date - 20, 'competence_on', pg_temp.month())));
select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'power',
  format($$public.save_finance_bill('b1900000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'counterparty', 'Energia Teste', 'category_id', pg_temp.category('despesa.utilidades'),
    'cents', '20000', 'due_on', current_date - 20, 'competence_on', pg_temp.month())));

-- ---------- A person says the fine and the interest ----------

select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'rent-wrong',
  format($$public.settle_finance_bill('b1900000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.bill('Imobiliária Teste'), jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'),
      'paid_on', current_date - 2, 'cents', '257500', 'fine_cents', '5000', 'interest_cents', '1000')));
select ok(
  pg_temp.got('rent-wrong', '{code}') = 'invalid_data' and pg_temp.got('rent-wrong', '{field}') = 'late'
    and (select status = 'open' and paid_cents = 0 from public.finance_bills where id = pg_temp.bill('Imobiliária Teste'))
    and (select count(*) = 0 from public.finance_entries where org_id = 'b1900000-0000-4000-8000-00000000000a'),
  'a fine and an interest that do not add up to what was paid above the bill are refused, and nothing is written'
);

select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'rent-paid',
  format($$public.settle_finance_bill('b1900000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.bill('Imobiliária Teste'), jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'),
      'paid_on', current_date - 2, 'cents', '257500', 'fine_cents', '5000', 'interest_cents', '2500')));
select ok(
  pg_temp.got('rent-paid', '{status}') = 'paid'
    and (select base_cents = 250000 and extra_cents = 7500 and fine_cents = 5000 and interest_cents = 2500
           and split_by = 'person' from pg_temp.payment(pg_temp.bill('Imobiliária Teste'))),
  'a person says the fine and the interest of what was paid above the bill when paying it'
);

-- ---------- Unsplit, then split afterwards ----------

select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'power-paid',
  format($$public.settle_finance_bill('b1900000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.bill('Energia Teste'), jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'),
      'paid_on', current_date - 1, 'cents', '20900')));
select ok(
  (select extra_cents = 900 and fine_cents = 0 and interest_cents = 0 and split_by is null
   from pg_temp.payment(pg_temp.bill('Energia Teste'))),
  'nothing said of a bill that is no fee of a case, what was paid above it stays unsplit'
);

select pg_temp.as_person('a1900000-0000-4000-8000-000000000003', 'bia-split',
  format($$public.split_finance_payment('b1900000-0000-4000-8000-00000000000a', %L, '{"fine_cents": "400", "interest_cents": "500"}'::jsonb)$$,
    (pg_temp.payment(pg_temp.bill('Energia Teste'))).id));
select pg_temp.as_person('a1900000-0000-4000-8000-000000000009', 'rocha-open',
  $$public.open_finance_books('b1900000-0000-4000-8000-00000000000b', current_date - 30)$$);
select pg_temp.as_person('a1900000-0000-4000-8000-000000000009', 'rocha-split',
  format($$public.split_finance_payment('b1900000-0000-4000-8000-00000000000b', %L, '{"fine_cents": "400", "interest_cents": "500"}'::jsonb)$$,
    (pg_temp.payment(pg_temp.bill('Energia Teste'))).id));
select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'duda-split',
  format($$public.split_finance_payment('b1900000-0000-4000-8000-00000000000a', %L, '{"fine_cents": "400", "interest_cents": "500"}'::jsonb)$$,
    (pg_temp.payment(pg_temp.bill('Energia Teste'))).id));
select ok(
  pg_temp.got('bia-split', '{code}') = 'not_allowed' and pg_temp.got('rocha-split', '{code}') = 'not_found'
    and pg_temp.got('duda-split', '{ok}') = 'true'
    and (select fine_cents = 400 and interest_cents = 500 and split_by = 'person'
         from pg_temp.payment(pg_temp.bill('Energia Teste')))
    and exists (select 1 from public.audit_events where action = 'finance.payment_split'
                and org_id = 'b1900000-0000-4000-8000-00000000000a'),
  'who operates the books splits it afterwards, on the record; who views cannot, and another firm does not reach it'
);

-- ---------- The contract splits a fee of a case ----------

select pg_temp.as_person('a1900000-0000-4000-8000-000000000001', 'terms',
  $$public.save_fee_terms('b1900000-0000-4000-8000-00000000000a', '{"entry_cents": "100000", "success_percent": "30",
    "late_fine_percent": "2", "late_interest_percent": "1"}'::jsonb)$$);
select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'case-fees',
  $$public.save_case_fees('c1900000-0000-4000-8000-000000000001', '{"from_terms": "true"}'::jsonb)$$);
update public.finance_bills set counterparty = 'Maria Teste', due_on = current_date - 30, competence_on = pg_temp.month()
where org_id = 'b1900000-0000-4000-8000-00000000000a' and description = 'Entrada dos honorários';
select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'fee-paid',
  format($$public.settle_finance_bill('b1900000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.bill('Maria Teste'), jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'),
      'paid_on', current_date, 'cents', '103000')));
select ok(
  pg_temp.got('case-fees', '{ok}') = 'true'
    and (select extra_cents = 3000 and fine_cents = 2000 and interest_cents = 1000 and split_by = 'contract'
         from pg_temp.payment(pg_temp.bill('Maria Teste'))),
  'a fee of a case paid late is split by its contract: the fine of 2 percent on what was owed, the rest interest'
);

-- ---------- Taking a split back ----------

select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'unsplit',
  format($$public.split_finance_payment('b1900000-0000-4000-8000-00000000000a', %L, '{}'::jsonb)$$,
    (pg_temp.payment(pg_temp.bill('Maria Teste'))).id));
select pg_temp.as_person('a1900000-0000-4000-8000-000000000004', 'resplit',
  format($$public.split_finance_payment('b1900000-0000-4000-8000-00000000000a', %L, '{"fine_cents": "2000", "interest_cents": "1000"}'::jsonb)$$,
    (pg_temp.payment(pg_temp.bill('Maria Teste'))).id));
select ok(
  pg_temp.got('unsplit', '{ok}') = 'true' and pg_temp.got('resplit', '{ok}') = 'true'
    and (select fine_cents = 2000 and split_by = 'person' from pg_temp.payment(pg_temp.bill('Maria Teste'))),
  'a split is taken back with both amounts empty, and said again'
);

-- ---------- The reports ----------

select ok(
  (select bool_and(
     case r ->> 'category'
       when 'Aluguel e condomínio' then (r ->> 'cents')::bigint = -250000
       when 'Energia, água e internet' then (r ->> 'cents')::bigint = -20000
       when 'Honorários contratuais' then (r ->> 'cents')::bigint = 100000
       when 'Multas pagas' then (r ->> 'cents')::bigint = -5400 and r ->> 'line' = 'financeiro'
       when 'Juros pagos' then (r ->> 'cents')::bigint = -3000 and r ->> 'line' = 'financeiro'
       when 'Multas recebidas' then (r ->> 'cents')::bigint = 2000 and r ->> 'line' = 'financeiro'
       when 'Juros recebidos' then (r ->> 'cents')::bigint = 1000 and r ->> 'line' = 'financeiro'
       else true end)
     and count(*) filter (where r ->> 'category' in ('Multas pagas', 'Juros pagos', 'Multas recebidas', 'Juros recebidos')) = 4
   from jsonb_array_elements(public.finance_month_lines('b1900000-0000-4000-8000-00000000000a', pg_temp.month()) -> 'dre') r),
  'the income statement says the fines and the interest on the financial line, out of the bills'' categories'
);

select pg_temp.as_person('a1900000-0000-4000-8000-000000000001', 'budget',
  format($$public.save_finance_budget('b1900000-0000-4000-8000-00000000000a', %L::date, %L::jsonb, 1)$$,
    pg_temp.month(), jsonb_build_array(jsonb_build_object('category_id', pg_temp.category('despesa.aluguel'), 'cents', '250000'))));
select ok(
  pg_temp.got('budget', '{ok}') = 'true'
    and (select (r ->> 'actual')::bigint = 250000
         from jsonb_array_elements(public.finance_budget_lines('b1900000-0000-4000-8000-00000000000a', pg_temp.month()) -> 'rows') r
         where r ->> 'category' = 'Aluguel e condomínio')
    and (public.finance_budget_lines('b1900000-0000-4000-8000-00000000000a', pg_temp.month()) ->> 'outside_expense')::bigint
        = 20000 + 8400
    and (public.finance_budget_lines('b1900000-0000-4000-8000-00000000000a', pg_temp.month()) ->> 'outside_income')::bigint
        = 100000 + 3000,
  'the budget counts the rent without its late charges, and the charges outside it'
);

select * from finish();
rollback;
