begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- O caminho do dinheiro (0158). The TJSP is said to accept paying the client
-- directly, the TJGO not. Lima keeps the default, the firm's account: a
-- release in the TJSP still goes to the firm. Ana, a partner, says the firm
-- prefers the direct way: the TJSP's next release goes direct, the TJGO's
-- still to the firm. Duda, who operates the books, says one case goes to the
-- firm: its next release does. Caio reads only the costs and changes
-- nothing. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1560000-0000-4000-8000-000000000001', 'ana@lima-caminho.invalid', 'Ana Lima'),
  ('a1560000-0000-4000-8000-000000000002', 'caio@lima-caminho.invalid', 'Caio Lima'),
  ('a1560000-0000-4000-8000-000000000004', 'duda@lima-caminho.invalid', 'Duda Lima'),
  ('a1560000-0000-4000-8000-000000000009', 'edu@rocha-caminho.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1560000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-caminho', 'a1560000-0000-4000-8000-000000000001'),
  ('b1560000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-caminho', 'a1560000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1560000-0000-4000-8000-00000000000a', 'a1560000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1560000-0000-4000-8000-00000000000a', 'a1560000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1560000-0000-4000-8000-00000000000a', 'a1560000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1560000-0000-4000-8000-00000000000b', 'a1560000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.court_payment_paths (court, direct, form, highlights_fees, confirmed)
values ('TJSP', true, 'conta', true, false)
on conflict (court) do update set direct = true;

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1560000-0000-4000-8000-000000000001', 'b1560000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1560000-0000-4000-8000-000000000002', 'b1560000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1560000-0000-4000-8000-000000000001', 'b1560000-0000-4000-8000-00000000000a', 'c1560000-0000-4000-8000-000000000001',
   'juizado', 'TJSP', 'filed', '10003015320998260100', '2026-09-01'),
  ('f1560000-0000-4000-8000-000000000002', 'b1560000-0000-4000-8000-00000000000a', 'c1560000-0000-4000-8000-000000000002',
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
-- A release of a case's lawsuit, received: the way its money took.
create function pg_temp.release(fact uuid, of_case uuid, lawsuit uuid) returns text language plpgsql as $$
begin
  insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source)
  values (fact, 'b1560000-0000-4000-8000-00000000000a', of_case, lawsuit, 'alvara', 'alvara', 100000, current_date - 2, 'person');
  update public.lawsuit_facts set received_cents = 100000, received_on = current_date - 1 where id = fact;
  return (select path from public.money_releases where fact_id = fact);
end;
$$;

select pg_temp.as_person('a1560000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1560000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1560000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1560000-0000-4000-8000-00000000000a', 'a1560000-0000-4000-8000-000000000004', 'operate')$$);

select is(
  pg_temp.release('a9560000-0000-4000-8000-000000000001', 'c1560000-0000-4000-8000-000000000001', 'f1560000-0000-4000-8000-000000000001'),
  'firm',
  'by default the money goes to the firm''s account, even where the court accepts paying the client directly'
);

select pg_temp.as_person('a1560000-0000-4000-8000-000000000002', 'caio',
  $$public.set_money_path('b1560000-0000-4000-8000-00000000000a', 'direct')$$);
select is(pg_temp.got('caio', '{code}'), 'not_allowed', 'only who configures the books says the firm''s way');

select pg_temp.as_person('a1560000-0000-4000-8000-000000000001', 'direct',
  $$public.set_money_path('b1560000-0000-4000-8000-00000000000a', 'direct')$$);
select ok(
  pg_temp.got('direct', '{ok}') = 'true'
    and pg_temp.release('a9560000-0000-4000-8000-000000000002', 'c1560000-0000-4000-8000-000000000001', 'f1560000-0000-4000-8000-000000000001') = 'direct',
  'a firm that chose the direct way has it where the court accepts it'
);
select is(
  pg_temp.release('a9560000-0000-4000-8000-000000000003', 'c1560000-0000-4000-8000-000000000002', 'f1560000-0000-4000-8000-000000000002'),
  'firm',
  'and the firm''s account where the court does not'
);

select pg_temp.as_person('a1560000-0000-4000-8000-000000000004', 'case-firm',
  $$public.set_case_money_path('c1560000-0000-4000-8000-000000000001', 'firm')$$);
select ok(
  pg_temp.got('case-firm', '{ok}') = 'true'
    and pg_temp.release('a9560000-0000-4000-8000-000000000004', 'c1560000-0000-4000-8000-000000000001', 'f1560000-0000-4000-8000-000000000001') = 'firm'
    and (select path = 'direct' from public.money_releases where fact_id = 'a9560000-0000-4000-8000-000000000002'),
  'a case''s own way wins over the firm''s, and a release already registered keeps the way it took'
);

select pg_temp.as_person('a1560000-0000-4000-8000-000000000004', 'read',
  $$public.case_money_path('c1560000-0000-4000-8000-000000000001')$$);
select pg_temp.as_person('a1560000-0000-4000-8000-000000000004', 'read-goias',
  $$public.case_money_path('c1560000-0000-4000-8000-000000000002')$$);
select ok(
  pg_temp.got('read', '{case}') = 'firm' and pg_temp.got('read', '{firm}') = 'direct' and pg_temp.got('read', '{accepts}') = 'true'
    and pg_temp.got('read-goias', '{case}') is null and pg_temp.got('read-goias', '{accepts}') = 'false',
  'the case''s card reads the way chosen, whose, and whether its court accepts the direct one'
);

select pg_temp.as_person('a1560000-0000-4000-8000-000000000002', 'read-caio',
  $$public.case_money_path('c1560000-0000-4000-8000-000000000001')$$);
select ok(
  (select value is null or value = 'null'::jsonb from res where key = 'read-caio'),
  'who reads only the costs reads nothing of it'
);

select pg_temp.sign_in('a1560000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$select public.set_case_money_path('c1560000-0000-4000-8000-000000000001', 'direct')$$,
  '42501', null,
  'another firm changes nothing of Lima''s'
);
reset role;

select * from finish();
rollback;
