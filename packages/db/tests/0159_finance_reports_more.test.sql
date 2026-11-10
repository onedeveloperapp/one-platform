begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The closed month, the budget, the lines by cost centre and by partner, and
-- the success fees expected (0163). Lima's books are open. Two months ago is
-- closed: Ana, a partner, cannot write an entry by hand in it nor cancel one
-- of it, while ONE's entry from the bank's statement still enters and the
-- report says the month changed after it closed. Ana budgets last month's rent
-- and fees for two months; the report sets them against what came. A case won
-- by judgment with 30 percent of success expects its fee in the forecast,
-- final once the judgment became final. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1590000-0000-4000-8000-000000000001', 'ana@lima-meses.invalid', 'Ana Lima'),
  ('a1590000-0000-4000-8000-000000000009', 'edu@rocha-meses.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1590000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-meses', 'a1590000-0000-4000-8000-000000000001'),
  ('b1590000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-meses', 'a1590000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1590000-0000-4000-8000-00000000000a', 'a1590000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1590000-0000-4000-8000-00000000000b', 'a1590000-0000-4000-8000-000000000009', 'owner', 'socio');
insert into public.people (id, org_id, full_name) values
  ('d1590000-0000-4000-8000-000000000001', 'b1590000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1590000-0000-4000-8000-000000000001', 'b1590000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1590000-0000-4000-8000-000000000001', 'b1590000-0000-4000-8000-00000000000a', 'c1590000-0000-4000-8000-000000000001',
   'd1590000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1590000-0000-4000-8000-000000000001', 'b1590000-0000-4000-8000-00000000000a', 'c1590000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
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
create function pg_temp.category(code text) returns uuid language sql as $$
  select id from public.finance_categories where org_id = 'b1590000-0000-4000-8000-00000000000a' and finance_categories.code = category.code;
$$;
create temp table months as
select date_trunc('month', current_date - interval '2 months')::date as closed_month,
       date_trunc('month', current_date - interval '1 month')::date as last_month;
grant select on months to authenticated;

select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'open',
  format($$public.open_finance_books('b1590000-0000-4000-8000-00000000000a', %L::date)$$, (select closed_month - 30 from months)));
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1590000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

-- An entry of the month that will close, written while it was open.
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'rent-old',
  format($$public.save_finance_entry('b1590000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-300000',
    'category_id', pg_temp.category('despesa.aluguel'), 'occurred_on', (select closed_month + 4 from months))));
update public.finance_entries set created_at = now() - interval '2 hours'
where id = pg_temp.got('rent-old', '{entry_id}')::uuid;
insert into public.finance_closings (org_id, month, closed_by, closed_at)
select 'b1590000-0000-4000-8000-00000000000a', closed_month, 'a1590000-0000-4000-8000-000000000001', now() - interval '1 hour'
from months;

-- ---------- The closed month ----------
select pg_temp.sign_in('a1590000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.save_finance_entry('b1590000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-5000',
    'category_id', pg_temp.category('despesa.material'), 'occurred_on', (select closed_month + 10 from months))),
  'P0001', 'month_closed', 'an entry by hand in a closed month is refused'
);
select throws_ok(
  format($$select public.cancel_finance_entry('b1590000-0000-4000-8000-00000000000a', %L, 'Lançado errado')$$,
    pg_temp.got('rent-old', '{entry_id}')),
  'P0001', 'month_closed', 'and so is the cancelling of one of its entries'
);
reset role;

insert into public.finance_entries (org_id, account_id, kind, cents, category_id, occurred_on, competence_on, source, by_one)
select 'b1590000-0000-4000-8000-00000000000a', pg_temp.got('bank', '{account_id}')::uuid, 'expense', -1290,
  pg_temp.category('despesa.financeiras'), closed_month + 20, closed_month + 20, 'one', true from months;
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'closed-report',
  format($$public.finance_report('b1590000-0000-4000-8000-00000000000a', %L::date)$$, (select closed_month from months)));
select is(pg_temp.got('closed-report', '{closing,changed_after}'), '1',
  'ONE''s entry from the bank still enters, and the report says the month changed after it closed');

-- ---------- The budget ----------
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'budget',
  format($$public.save_finance_budget('b1590000-0000-4000-8000-00000000000a', %L::date, %L::jsonb, 2)$$,
    (select last_month from months),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.category('despesa.aluguel'), 'cents', '300000'),
      jsonb_build_object('category_id', pg_temp.category('receita.contratuais'), 'cents', '1000000'))));
select ok(
  pg_temp.got('budget', '{ok}') = 'true'
    and (select count(*) = 4 from public.finance_budgets where org_id = 'b1590000-0000-4000-8000-00000000000a'),
  'the budget is saved for the month and the one after it'
);

select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'rent',
  format($$public.save_finance_entry('b1590000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-320000',
    'category_id', pg_temp.category('despesa.aluguel'), 'counterparty', 'Imobiliária Teste',
    'cost_center_id', (select id from public.finance_cost_centers where org_id = 'b1590000-0000-4000-8000-00000000000a' limit 1),
    'occurred_on', (select last_month + 5 from months))));
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'labore',
  format($$public.save_finance_entry('b1590000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'partner', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-500000',
    'category_id', pg_temp.category('socio.prolabore'), 'counterparty', 'Ana Lima',
    'occurred_on', (select last_month + 6 from months))));
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'report',
  format($$public.finance_report('b1590000-0000-4000-8000-00000000000a', %L::date)$$, (select last_month from months)));
select ok(
  (select (r -> 'planned')::bigint = 300000 and (r -> 'actual')::bigint = 320000
   from res, jsonb_array_elements(res.value -> 'budget' -> 'rows') r
   where res.key = 'report' and r ->> 'category' = 'Aluguel e condomínio')
    and (select (r -> 'actual')::bigint = 0 from res, jsonb_array_elements(res.value -> 'budget' -> 'rows') r
         where res.key = 'report' and r ->> 'category' = 'Honorários contratuais'),
  'the report sets each category budgeted against what the month came to'
);
select ok(
  (select (r -> 'expense')::bigint = 320000 from res, jsonb_array_elements(res.value -> 'current' -> 'centers') r
   where res.key = 'report' and r ->> 'center' is not null)
    and (select (r -> 'cents')::bigint = -500000 from res, jsonb_array_elements(res.value -> 'current' -> 'partners') r
         where res.key = 'report' and r ->> 'partner' = 'Ana Lima'),
  'the month''s lines say each cost centre and each partner'
);

-- ---------- The success fees expected ----------
insert into public.case_fees (case_id, org_id, success_percent, success_min_cents, source)
values ('c1590000-0000-4000-8000-000000000001', 'b1590000-0000-4000-8000-00000000000a', 30, 0, 'person');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b1590000-0000-4000-8000-00000000000a', 'c1590000-0000-4000-8000-000000000001', 'f1590000-0000-4000-8000-000000000001',
   'sentenca', 'procedente', 1000000, current_date - 10, 'person');
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'forecast',
  $$public.finance_forecast('b1590000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('forecast', '{expected,cents}') = '300000' and pg_temp.got('forecast', '{expected,final_cents}') = '0'
    and pg_temp.got('forecast', '{expected,cases}') = '1',
  'a judgment won expects 30 percent of its condemnation as success fees'
);
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, happened_on, source) values
  ('b1590000-0000-4000-8000-00000000000a', 'c1590000-0000-4000-8000-000000000001', 'f1590000-0000-4000-8000-000000000001',
   'transito', current_date - 2, 'person');
select pg_temp.as_person('a1590000-0000-4000-8000-000000000001', 'forecast-final',
  $$public.finance_forecast('b1590000-0000-4000-8000-00000000000a')$$);
select is(pg_temp.got('forecast-final', '{expected,final_cents}'), '300000', 'and says it final once the judgment became final');

select pg_temp.sign_in('a1590000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::integer from public.finance_budgets), 0, 'another firm reads none of the budget');
reset role;

select * from finish();
rollback;
