begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- Os dados de uma pessoa chegam ao dinheiro do cliente (0139). Lima has
-- Maria's case closed, her lawsuit closed, a release split and her part
-- owed, and the Pix key she gave. Her export carries her part and her
-- account; her erasure is refused while the part is owed and, once it was
-- passed on, takes her account and keeps the part's values. Rocha reads
-- nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1380000-0000-4000-8000-000000000001', 'ana@lima-dados.invalid', 'Ana Lima'),
  ('a1380000-0000-4000-8000-000000000009', 'edu@rocha-dados.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1380000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-dados', 'a1380000-0000-4000-8000-000000000001'),
  ('b1380000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-dados', 'a1380000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1380000-0000-4000-8000-00000000000a', 'a1380000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1380000-0000-4000-8000-00000000000b', 'a1380000-0000-4000-8000-000000000009', 'owner', 'socio');

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

insert into public.people (id, org_id, full_name, cpf, birth_date, phone) values
  ('d1380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '1990-03-10', '5562999990001');
insert into public.cases (id, org_id, seq, module, incident, status, closed_at) values
  ('c1380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'closed', now());
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'c1380000-0000-4000-8000-000000000001',
   'd1380000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'c1380000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003039420998090100', '2026-09-01');
update public.proceedings set status = 'closed' where id = 'f1380000-0000-4000-8000-000000000001';
insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source,
                                  received_cents, received_on) values
  ('a9380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'c1380000-0000-4000-8000-000000000001',
   'f1380000-0000-4000-8000-000000000001', 'alvara', 'alvara', 1000000, current_date - 3, 'person', 1000000, current_date - 2);
insert into public.money_releases (id, org_id, case_id, proceeding_id, fact_id, path, received_cents, received_on, status) values
  ('a6380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'c1380000-0000-4000-8000-000000000001',
   'f1380000-0000-4000-8000-000000000001', 'a9380000-0000-4000-8000-000000000001', 'firm', 1000000, current_date - 2, 'split');
insert into public.money_shares (id, org_id, release_id, case_id, person_id, gross_cents, fees_cents, payable_cents, status) values
  ('a5380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'a6380000-0000-4000-8000-000000000001',
   'c1380000-0000-4000-8000-000000000001', 'd1380000-0000-4000-8000-000000000001', 1000000, 300000, 700000, 'owed');
insert into public.client_payment_accounts (person_id, org_id, kind, pix_key) values
  ('d1380000-0000-4000-8000-000000000001', 'b1380000-0000-4000-8000-00000000000a', 'pix', '52998224725');

-- ---------- The export ----------

select pg_temp.as_person('a1380000-0000-4000-8000-000000000001', 'export',
  $$public.person_data_export('b1380000-0000-4000-8000-00000000000a', 'd1380000-0000-4000-8000-000000000001', 'email')$$);
select ok(
  pg_temp.got('export', '{money,0,payable_cents}') = '700000' and pg_temp.got('export', '{money,0,status}') = 'owed'
    and pg_temp.got('export', '{payment_account,pix_key}') = '52998224725',
  'a person''s export carries their part of a release and the account they receive in'
);

select pg_temp.sign_in('a1380000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$ select public.person_data_export('b1380000-0000-4000-8000-00000000000a', 'd1380000-0000-4000-8000-000000000001', 'email') $$,
  '42501', null, 'another firm reads nothing of it');
reset role;

-- ---------- The erasure ----------

select pg_temp.as_person('a1380000-0000-4000-8000-000000000001', 'erase-owed',
  $$public.erase_person('b1380000-0000-4000-8000-00000000000a', 'd1380000-0000-4000-8000-000000000001', 'email')$$);
select ok(
  pg_temp.got('erase-owed', '{code}') = 'money_owed'
    and exists (select 1 from public.person_data_requests where person_id = 'd1380000-0000-4000-8000-000000000001'
                and kind = 'erase' and status = 'refused' and refusal = 'money_owed')
    and exists (select 1 from public.client_payment_accounts where person_id = 'd1380000-0000-4000-8000-000000000001'),
  'an erasure is refused, on the record, while a part of theirs is still owed'
);

update public.money_shares set status = 'paid', paid_on = current_date where id = 'a5380000-0000-4000-8000-000000000001';
select pg_temp.as_person('a1380000-0000-4000-8000-000000000001', 'erase',
  $$public.erase_person('b1380000-0000-4000-8000-00000000000a', 'd1380000-0000-4000-8000-000000000001', 'email')$$);
select ok(
  pg_temp.got('erase', '{ok}') = 'true'
    and not exists (select 1 from public.client_payment_accounts where person_id = 'd1380000-0000-4000-8000-000000000001')
    and (select phone is null and erased_at is not null from public.people where id = 'd1380000-0000-4000-8000-000000000001'),
  'once the part was passed on, the erasure takes the account they receive in'
);
select is(
  (select payable_cents from public.money_shares where id = 'a5380000-0000-4000-8000-000000000001'), 700000::bigint,
  'the part''s values stay, as the firm''s records'
);

select * from finish();
rollback;
