begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- As contas em aberto do sistema antigo (0154). Lima's books are open: Ana,
-- a partner, configures; Duda operates; Caio reads only the costs of the
-- cases. Duda brings four lines: the rent of a category the firm has, a
-- receivable of a lawsuit of the firm, a bill of a category the firm does
-- not have, and one with no value. The same file again opens nothing twice.
-- One bill is paid, then the import is undone: what was paid stays.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1520000-0000-4000-8000-000000000001', 'ana@lima-importa.invalid', 'Ana Lima'),
  ('a1520000-0000-4000-8000-000000000002', 'caio@lima-importa.invalid', 'Caio Lima'),
  ('a1520000-0000-4000-8000-000000000004', 'duda@lima-importa.invalid', 'Duda Lima'),
  ('a1520000-0000-4000-8000-000000000005', 'edu@rocha-importa.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1520000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-importa', 'a1520000-0000-4000-8000-000000000001'),
  ('b1520000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-importa', 'a1520000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1520000-0000-4000-8000-00000000000a', 'a1520000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1520000-0000-4000-8000-00000000000a', 'a1520000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1520000-0000-4000-8000-00000000000a', 'a1520000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1520000-0000-4000-8000-00000000000b', 'a1520000-0000-4000-8000-000000000005', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1520000-0000-4000-8000-000000000001', 'b1520000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1520000-0000-4000-8000-000000000001', 'b1520000-0000-4000-8000-00000000000a', 'c1520000-0000-4000-8000-000000000001',
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

select pg_temp.as_person('a1520000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1520000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1520000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1520000-0000-4000-8000-00000000000a', 'a1520000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1520000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1520000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

create temp table lines (value jsonb) on commit drop;
insert into lines values (jsonb_build_array(
  jsonb_build_object('line', 1, 'key', 'chave-aluguel-0001', 'direction', 'pay', 'counterparty', 'Imobiliária Teste',
    'description', 'Aluguel', 'cents', 250000, 'due_on', current_date + 10, 'category', 'aluguel e condominio'),
  jsonb_build_object('line', 2, 'key', 'chave-parcela-0001', 'direction', 'receive', 'counterparty', 'Maria Teste',
    'description', 'Parcela dos honorários', 'cents', 50000, 'due_on', current_date - 5, 'competence_on', current_date - 35,
    'cnj', '10003012720998090100'),
  jsonb_build_object('line', 3, 'key', 'chave-papel-00001', 'direction', 'pay', 'counterparty', 'Papelaria Teste',
    'cents', 3000, 'due_on', current_date + 3, 'category', 'Material de escritório antigo'),
  jsonb_build_object('line', 4, 'key', 'chave-sem-valor-01', 'direction', 'pay', 'counterparty', 'Ninguém Teste',
    'cents', 0, 'due_on', current_date + 3)
));
grant select on lines to authenticated;

select pg_temp.as_person('a1520000-0000-4000-8000-000000000002', 'caio',
  $$public.import_finance_bills('b1520000-0000-4000-8000-00000000000a', null, 'contas.xlsx', (select value from lines))$$);
select is(pg_temp.got('caio', '{code}'), 'not_allowed', 'only who operates the books brings bills from a spreadsheet');

select pg_temp.as_person('a1520000-0000-4000-8000-000000000004', 'first',
  $$public.import_finance_bills('b1520000-0000-4000-8000-00000000000a', null, 'contas.xlsx', (select value from lines))$$);
select ok(
  pg_temp.got('first', '{opened}') = '3' and pg_temp.got('first', '{existed}') = '0'
    and (select value -> 'notes' from res where key = 'first') @> '[{"line": 4, "code": "cents"}, {"line": 3, "code": "category_other"}]'::jsonb,
  'each line becomes a bill, one with no value is refused with why, and a category the firm lacks is said'
);

select ok(
  (select c.code = 'despesa.aluguel' from public.finance_bills b join public.finance_categories c on c.id = b.category_id
   where b.counterparty = 'Imobiliária Teste')
    and (select c.code = 'despesa.outras' from public.finance_bills b join public.finance_categories c on c.id = b.category_id
         where b.counterparty = 'Papelaria Teste')
    and (select case_id = 'c1520000-0000-4000-8000-000000000001' and source = 'import'
                and competence_on = date_trunc('month', current_date - 35)::date
         from public.finance_bills where counterparty = 'Maria Teste'),
  'the category is the firm''s of that name, else its "other"; the lawsuit''s number makes it a bill of its case'
);

select pg_temp.as_person('a1520000-0000-4000-8000-000000000004', 'again',
  $$public.import_finance_bills('b1520000-0000-4000-8000-00000000000a', null, 'contas.xlsx', (select value from lines))$$);
select ok(
  pg_temp.got('again', '{opened}') = '0' and pg_temp.got('again', '{existed}') = '3'
    and (select count(*) from public.finance_bills where org_id = 'b1520000-0000-4000-8000-00000000000a') = 3,
  'the same file brought twice opens nothing twice'
);

select pg_temp.as_person('a1520000-0000-4000-8000-000000000004', 'read',
  $$public.firm_finance_imports('b1520000-0000-4000-8000-00000000000a')$$);
select ok(
  (select e ->> 'file_name' = 'contas.xlsx' and e ->> 'opened' = '3' and e ->> 'refused' = '1' and e ->> 'lines' = '4'
   from res, jsonb_array_elements(res.value) e
   where res.key = 'read' and e ->> 'id' = pg_temp.got('first', '{import_id}')),
  'who reads the books sees each import with what came of it'
);

select pg_temp.sign_in('a1520000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.finance_imports), 0, 'another firm reads none of it');
reset role;

-- ---------- Undone, with what was paid kept ----------

select pg_temp.as_person('a1520000-0000-4000-8000-000000000004', 'paid',
  format($$public.settle_finance_bill('b1520000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_bills where counterparty = 'Papelaria Teste'),
    jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'), 'paid_on', current_date - 1, 'cents', '3000')));
select pg_temp.as_person('a1520000-0000-4000-8000-000000000004', 'undo',
  format($$public.undo_finance_import('b1520000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('first', '{import_id}')));
select ok(
  pg_temp.got('undo', '{cancelled}') = '2' and pg_temp.got('undo', '{kept}') = '1'
    and (select status = 'paid' from public.finance_bills where counterparty = 'Papelaria Teste')
    and (select count(*) from public.finance_bills where status = 'cancelled' and closed_reason = 'Importação desfeita.') = 2,
  'an import undone cancels what nothing paid, never deletes, and keeps what was paid'
);

select pg_temp.as_person('a1520000-0000-4000-8000-000000000004', 'after',
  $$public.import_finance_bills('b1520000-0000-4000-8000-00000000000a', null, 'contas.xlsx', (select value from lines))$$);
select ok(
  pg_temp.got('after', '{opened}') = '2' and pg_temp.got('after', '{existed}') = '1',
  'after it was undone, the same file brings again what the undoing cancelled'
);

select * from finish();
rollback;
