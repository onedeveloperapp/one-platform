begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The firm's accountant and the month's package by e-mail (0166). Ana, a
-- partner of Lima, registers the accountant; Duda, of the controladoria, who
-- operates the books, cannot register one but sends the package to the one
-- registered, never to another address, within the day's sends; the sending
-- says what came of it. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and address here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1640000-0000-4000-8000-000000000001', 'ana@lima-contador.invalid', 'Ana Lima'),
  ('a1640000-0000-4000-8000-000000000004', 'duda@lima-contador.invalid', 'Duda Lima'),
  ('a1640000-0000-4000-8000-000000000009', 'edu@rocha-contador.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1640000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-contador', 'a1640000-0000-4000-8000-000000000001'),
  ('b1640000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-contador', 'a1640000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1640000-0000-4000-8000-00000000000a', 'a1640000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1640000-0000-4000-8000-00000000000a', 'a1640000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1640000-0000-4000-8000-00000000000b', 'a1640000-0000-4000-8000-000000000009', 'owner', 'socio');

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
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

select pg_temp.as_person('a1640000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1640000-0000-4000-8000-00000000000a', current_date - 40)$$);
select pg_temp.as_person('a1640000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1640000-0000-4000-8000-00000000000a', 'a1640000-0000-4000-8000-000000000004', 'operate')$$);

select pg_temp.as_person('a1640000-0000-4000-8000-000000000001', 'none-yet',
  format($$public.begin_finance_package_send('b1640000-0000-4000-8000-00000000000a', %L::date)$$, current_date));
select is(pg_temp.got('none-yet', '{code}'), 'no_accountant', 'with no accountant there is nobody to send the package to');

select pg_temp.as_person('a1640000-0000-4000-8000-000000000004', 'duda-saves',
  $$public.save_finance_accountant('b1640000-0000-4000-8000-00000000000a', '{"name": "Contábil Teste", "email": "contato@contabil.invalid"}'::jsonb)$$);
select is(pg_temp.got('duda-saves', '{code}'), 'not_allowed', 'who only operates the books registers no accountant');

select pg_temp.as_person('a1640000-0000-4000-8000-000000000001', 'no-factor',
  $$public.save_finance_accountant('b1640000-0000-4000-8000-00000000000a', '{"name": "Contábil Teste", "email": "contato@contabil.invalid"}'::jsonb)$$,
  'aal1');
select pg_temp.as_person('a1640000-0000-4000-8000-000000000001', 'saved',
  $$public.save_finance_accountant('b1640000-0000-4000-8000-00000000000a', '{"name": "Bruno Contador", "email": " Bruno@Contabil.invalid ",
    "office": "Contábil Teste", "crc": "go 012345/o"}'::jsonb)$$);
select ok(
  pg_temp.got('no-factor', '{code}') = 'second_factor' and pg_temp.got('saved', '{ok}') = 'true'
    and (select email = 'bruno@contabil.invalid' and crc = 'GO012345/O' from public.finance_accountants
         where org_id = 'b1640000-0000-4000-8000-00000000000a'),
  'who configures the books registers the accountant with the second factor, the address and the CRC written plainly'
);

select pg_temp.as_person('a1640000-0000-4000-8000-000000000004', 'send',
  format($$public.begin_finance_package_send('b1640000-0000-4000-8000-00000000000a', %L::date)$$, current_date - 20));
select ok(
  pg_temp.got('send', '{ok}') = 'true' and pg_temp.got('send', '{email}') = 'bruno@contabil.invalid'
    and exists (select 1 from public.audit_events where action = 'finance.package_sent'
                and org_id = 'b1640000-0000-4000-8000-00000000000a'),
  'who operates the books sends the package to the accountant registered, and the sending is on the record'
);

select pg_temp.as_person('a1640000-0000-4000-8000-000000000004', 'finished',
  format($$public.finish_finance_package_send(%L, true, null)$$, pg_temp.got('send', '{send_id}')));
select ok(
  pg_temp.got('finished', '{ok}') = 'true'
    and (select status = 'sent' and finished_at is not null from public.finance_package_sends
         where id = pg_temp.got('send', '{send_id}')::uuid),
  'the sending says what came of it'
);

select pg_temp.as_person('a1640000-0000-4000-8000-000000000004', 'next-month',
  format($$public.begin_finance_package_send('b1640000-0000-4000-8000-00000000000a', %L::date)$$, current_date + 40));
select is(pg_temp.got('next-month', '{field}'), 'month', 'a month that has not begun has no package to send');

update public.platform_settings set value = value || '{"package_sends": 1}'::jsonb where key = 'finance';
select pg_temp.as_person('a1640000-0000-4000-8000-000000000004', 'over',
  format($$public.begin_finance_package_send('b1640000-0000-4000-8000-00000000000a', %L::date)$$, current_date - 20));
select is(pg_temp.got('over', '{code}'), 'daily_limit', 'the day''s sends end at the setting''s ceiling');

select pg_temp.sign_in('a1640000-0000-4000-8000-000000000009');
set local role authenticated;
select is(
  (select count(*)::integer from public.finance_accountants) + (select count(*)::integer from public.finance_package_sends),
  0, 'another firm reads none of the accountant nor its sendings'
);
reset role;

select * from finish();
rollback;
