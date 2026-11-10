begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The books in "Levar a carteira inteira" (0164). Ana, a partner of Lima,
-- opens the books, writes a rent paid by hand and a fee to receive, cancels a
-- wrong entry, and takes the whole portfolio: its counts hold every entry, the
-- cancelled one too, and every bill; their pages hold what each is. Rocha's
-- partner reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1620000-0000-4000-8000-000000000001', 'ana@lima-livros.invalid', 'Ana Lima'),
  ('a1620000-0000-4000-8000-000000000009', 'edu@rocha-livros.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1620000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-livros', 'a1620000-0000-4000-8000-000000000001'),
  ('b1620000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-livros', 'a1620000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1620000-0000-4000-8000-00000000000a', 'a1620000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1620000-0000-4000-8000-00000000000b', 'a1620000-0000-4000-8000-000000000009', 'owner', 'socio');

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
  select id from public.finance_categories where org_id = 'b1620000-0000-4000-8000-00000000000a' and finance_categories.code = category.code;
$$;

select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1620000-0000-4000-8000-00000000000a', current_date - 40)$$);
select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1620000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);
select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'rent',
  format($$public.save_finance_entry('b1620000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-300000',
    'category_id', pg_temp.category('despesa.aluguel'), 'counterparty', 'Imobiliária Teste', 'occurred_on', current_date - 5)));
select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'wrong',
  format($$public.save_finance_entry('b1620000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-100',
    'category_id', pg_temp.category('despesa.material'), 'occurred_on', current_date - 4)));
select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'cancel',
  format($$public.cancel_finance_entry('b1620000-0000-4000-8000-00000000000a', %L, 'Lançado em dobro')$$,
    pg_temp.got('wrong', '{entry_id}')));
insert into public.finance_bills (org_id, direction, counterparty, description, category_id, cents, due_on, competence_on)
values ('b1620000-0000-4000-8000-00000000000a', 'receive', 'Maria Teste', 'Entrada dos honorários',
  pg_temp.category('receita.contratuais'), 150000, current_date + 7, current_date);

select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'begun',
  $$public.begin_portfolio_export('b1620000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('begun', '{ok}') = 'true' and pg_temp.got('begun', '{counts,lancamentos}') = '2'
    and pg_temp.got('begun', '{counts,contas}') = '1',
  'the portfolio counts every entry of the books, the cancelled one too, and every bill'
);

select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'entries',
  $$public.firm_portfolio_page('b1620000-0000-4000-8000-00000000000a', 'lancamentos', 0)$$);
select ok(
  (select r ->> 'account' = 'Itaú PJ' and r ->> 'category' = 'Aluguel e condomínio' and (r ->> 'cents')::bigint = -300000
     and r ->> 'counterparty' = 'Imobiliária Teste' and r ->> 'cancelled_at' is null
   from res, jsonb_array_elements(res.value -> 'rows') r where res.key = 'entries' and r ->> 'kind' = 'expense'
     and (r ->> 'cents')::bigint = -300000),
  'an entry goes with its account, category, value and who it was of'
);
select ok(
  (select r ->> 'cancelled_at' is not null and r ->> 'cancelled_reason' = 'Lançado em dobro'
   from res, jsonb_array_elements(res.value -> 'rows') r where res.key = 'entries' and (r ->> 'cents')::bigint = -100),
  'a cancelled entry goes with when and why'
);

select pg_temp.as_person('a1620000-0000-4000-8000-000000000001', 'bills',
  $$public.firm_portfolio_page('b1620000-0000-4000-8000-00000000000a', 'contas', 0)$$);
select ok(
  (select r ->> 'direction' = 'receive' and r ->> 'status' = 'open' and (r ->> 'cents')::bigint = 150000
     and r ->> 'category' = 'Honorários contratuais'
   from res, jsonb_array_elements(res.value -> 'rows') r where res.key = 'bills'),
  'a bill goes with where it stands, its value and its category'
);

select pg_temp.sign_in('a1620000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$select public.firm_portfolio_page('b1620000-0000-4000-8000-00000000000a', 'lancamentos', 0)$$,
  '42501', null, 'another firm reads none of the books'
);
reset role;

select * from finish();
rollback;
