begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- Mais formas de honorários e a divisão (0159). Lima's books are open: Ana,
-- a partner, confirms terms with a monthly fee of R$ 500,00 for 3 months,
-- R$ 300,00 a hearing, R$ 400,00 an appeal, a 2 percent fine and 1 percent a
-- month of interest. Duda, of the controladoria, sets Maria's case from the
-- terms: ONE writes the three months. A hearing held and an appeal of the
-- client each owe their fee, once. Duda splits the case's fees 20 percent
-- with a lawyer of the bar; an agency with no registration is refused. The
-- entry received owes the lawyer 20 percent of it; undone, the part goes.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1570000-0000-4000-8000-000000000001', 'ana@lima-formas.invalid', 'Ana Lima'),
  ('a1570000-0000-4000-8000-000000000004', 'duda@lima-formas.invalid', 'Duda Lima'),
  ('a1570000-0000-4000-8000-000000000009', 'edu@rocha-formas.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1570000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-formas', 'a1570000-0000-4000-8000-000000000001'),
  ('b1570000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-formas', 'a1570000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1570000-0000-4000-8000-00000000000a', 'a1570000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1570000-0000-4000-8000-00000000000a', 'a1570000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1570000-0000-4000-8000-00000000000b', 'a1570000-0000-4000-8000-000000000009', 'owner', 'socio');
insert into public.people (id, org_id, full_name) values
  ('d1570000-0000-4000-8000-000000000001', 'b1570000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1570000-0000-4000-8000-000000000001', 'b1570000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1570000-0000-4000-8000-000000000001', 'b1570000-0000-4000-8000-00000000000a', 'c1570000-0000-4000-8000-000000000001',
   'd1570000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1570000-0000-4000-8000-000000000001', 'b1570000-0000-4000-8000-00000000000a', 'c1570000-0000-4000-8000-000000000001',
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
create function pg_temp.bills(what text) returns integer language sql as $$
  select count(*)::integer from public.finance_bills where org_id = 'b1570000-0000-4000-8000-00000000000a' and description = what;
$$;

select pg_temp.as_person('a1570000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1570000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1570000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1570000-0000-4000-8000-00000000000a', 'a1570000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1570000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1570000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

select pg_temp.as_person('a1570000-0000-4000-8000-000000000001', 'terms',
  $$public.save_fee_terms('b1570000-0000-4000-8000-00000000000a', '{"entry_cents": "100000", "success_percent": "30",
    "monthly_cents": "50000", "monthly_months": "3", "hearing_cents": "30000", "appeal_cents": "40000",
    "late_fine_percent": "2", "late_interest_percent": "1"}'::jsonb)$$);
select ok(
  pg_temp.got('terms', '{ok}') = 'true'
    and (select monthly_cents = 50000 and monthly_months = 3 and hearing_cents = 30000 and appeal_cents = 40000
           and late_fine_percent = 2 and late_interest_percent = 1
         from public.fee_terms where org_id = 'b1570000-0000-4000-8000-00000000000a' and archived_at is null),
  'the firm''s terms hold a monthly fee, a fee per hearing and per appeal, and the fine and interest of a late fee'
);

select pg_temp.as_person('a1570000-0000-4000-8000-000000000004', 'case',
  $$public.save_case_fees('c1570000-0000-4000-8000-000000000001', '{"from_terms": "true"}'::jsonb)$$);
select ok(
  pg_temp.got('case', '{ok}') = 'true' and pg_temp.bills('Mensalidade dos honorários') = 3
    and pg_temp.bills('Entrada dos honorários') = 1
    and (select late_fine_percent = 2 and hearing_cents = 30000 from public.case_fees
         where case_id = 'c1570000-0000-4000-8000-000000000001'),
  'the case takes every form of the terms, and ONE writes the three months beside the entry'
);

-- ---------- The acts ----------
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, link) values
  ('a6570000-0000-4000-8000-000000000001', 'b1570000-0000-4000-8000-00000000000a', 'c1570000-0000-4000-8000-000000000001',
   'f1570000-0000-4000-8000-000000000001', 'conciliacao', now() - interval '2 hours', 'America/Sao_Paulo', 'videoconferencia',
   'https://audiencia.invalid/sala-1');
update public.hearings set status = 'held', outcome = 'sem_acordo' where id = 'a6570000-0000-4000-8000-000000000001';
update public.hearings set status = 'scheduled', outcome = null where id = 'a6570000-0000-4000-8000-000000000001';
update public.hearings set status = 'held', outcome = 'sem_acordo' where id = 'a6570000-0000-4000-8000-000000000001';
select ok(
  pg_temp.bills('Honorários por audiência') = 1
    and (select cents = 30000 and source = 'act' from public.finance_bills where description = 'Honorários por audiência'),
  'a hearing held owes the fee per hearing, once however its state is said again'
);

insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, appeal_by, happened_on, source) values
  ('b1570000-0000-4000-8000-00000000000a', 'c1570000-0000-4000-8000-000000000001', 'f1570000-0000-4000-8000-000000000001',
   'recurso', 'autor', current_date, 'person'),
  ('b1570000-0000-4000-8000-00000000000a', 'c1570000-0000-4000-8000-000000000001', 'f1570000-0000-4000-8000-000000000001',
   'recurso', 're', current_date, 'person');
select ok(
  pg_temp.bills('Honorários por recurso') = 1,
  'an appeal the firm files for the client owes the fee per appeal; the airline''s appeal owes none'
);

-- ---------- The split ----------
select pg_temp.as_person('a1570000-0000-4000-8000-000000000004', 'agency',
  $$public.save_fee_split('c1570000-0000-4000-8000-000000000001', '{"name": "Agência Teste Viagens",
    "document": "11222333000181", "bar_registration": "", "percent": "10"}'::jsonb)$$);
select is(pg_temp.got('agency', '{field}'), 'bar_registration', 'nobody who is not of the bar shares the fees');

select pg_temp.as_person('a1570000-0000-4000-8000-000000000004', 'split',
  $$public.save_fee_split('c1570000-0000-4000-8000-000000000001', '{"name": "Carlos Teste Advogado",
    "document": "529.982.247-25", "bar_registration": "OAB/GO 12345", "percent": "20"}'::jsonb)$$);
select ok(
  pg_temp.got('split', '{ok}') = 'true'
    and (select bar_registration = 'GO 12345' and document = '52998224725' from public.case_fee_splits),
  'a lawyer of the bar shares the case''s fees, the registration written as the bar writes it'
);

select pg_temp.as_person('a1570000-0000-4000-8000-000000000004', 'paid',
  format($$public.settle_finance_bill('b1570000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_bills where description = 'Entrada dos honorários'),
    jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'), 'paid_on', current_date, 'cents', '100000')));
select ok(
  (select count(*) = 1 and sum(cents) = 20000 and bool_and(direction = 'pay' and counterparty = 'Carlos Teste Advogado' and source = 'split')
   from public.finance_bills where source = 'split'),
  'the fee received owes the lawyer their percent of it, a bill to pay ONE writes'
);

select pg_temp.as_person('a1570000-0000-4000-8000-000000000004', 'cancel',
  format($$public.cancel_finance_entry('b1570000-0000-4000-8000-00000000000a', %L, 'Lançado em dobro')$$,
    pg_temp.got('paid', '{entry_id}')));
select ok(
  (select status = 'cancelled' from public.finance_bills where source = 'split'),
  'the payment undone cancels the part nobody paid'
);

select pg_temp.sign_in('a1570000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::integer from public.case_fee_splits), 0, 'another firm reads none of it');
reset role;

select * from finish();
rollback;
