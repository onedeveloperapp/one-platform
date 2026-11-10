begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- As contas que se repetem (0151). Lima's books are open: Ana, a partner,
-- configures; Duda operates; Caio reads only the costs of the cases. The
-- rent was paid on the 10th of each of the last three months, the power
-- bill with values far apart, and a supplier only twice: ONE makes a series
-- of the rent alone and writes its next bill, once however many rounds run.
-- Duda stops it with the reason: its open bill is cancelled and ONE never
-- makes it again. Caio and Rocha read nothing of it.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1500000-0000-4000-8000-000000000001', 'ana@lima-serie.invalid', 'Ana Lima'),
  ('a1500000-0000-4000-8000-000000000002', 'caio@lima-serie.invalid', 'Caio Lima'),
  ('a1500000-0000-4000-8000-000000000004', 'duda@lima-serie.invalid', 'Duda Lima'),
  ('a1500000-0000-4000-8000-000000000005', 'edu@rocha-serie.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1500000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-serie', 'a1500000-0000-4000-8000-000000000001'),
  ('b1500000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-serie', 'a1500000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1500000-0000-4000-8000-00000000000a', 'a1500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1500000-0000-4000-8000-00000000000a', 'a1500000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1500000-0000-4000-8000-00000000000a', 'a1500000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1500000-0000-4000-8000-00000000000b', 'a1500000-0000-4000-8000-000000000005', 'owner', 'socio');

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
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  set local role service_role;
  execute format('insert into res values (%L, to_jsonb((%s)))', name, call);
  reset role;
end;
$$;
create function pg_temp.category(target_code text) returns uuid language sql as $$
  select id from public.finance_categories where org_id = 'b1500000-0000-4000-8000-00000000000a' and code = target_code;
$$;
-- The 10th of a month this many months back, in Brasília's days.
create function pg_temp.back(months integer, day integer default 10) returns date language sql as $$
  select (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - make_interval(months => months))::date + (day - 1);
$$;

select pg_temp.as_person('a1500000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1500000-0000-4000-8000-00000000000a', current_date - 150)$$);
select pg_temp.as_person('a1500000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1500000-0000-4000-8000-00000000000a', 'a1500000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1500000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1500000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, occurred_on, competence_on, source)
select 'b1500000-0000-4000-8000-00000000000a', pg_temp.got('bank', '{account_id}')::uuid, 'expense', cents,
  pg_temp.category(code), who, pg_temp.back(back, day), pg_temp.back(back, 1), 'one'
from (values
  ('Imobiliária Teste', 'despesa.aluguel', -250000, 3, 10),
  ('Imobiliária Teste', 'despesa.aluguel', -250000, 2, 11),
  ('Imobiliária Teste', 'despesa.aluguel', -250000, 1, 9),
  ('Energia Teste', 'despesa.utilidades', -18000, 3, 5),
  ('Energia Teste', 'despesa.utilidades', -39000, 2, 5),
  ('Energia Teste', 'despesa.utilidades', -18500, 1, 5),
  ('Papelaria Teste', 'despesa.utilidades', -3200, 2, 20),
  ('Papelaria Teste', 'despesa.utilidades', -3200, 1, 20)
) as m (who, code, cents, back, day);

-- ---------- ONE finds what repeats ----------

select pg_temp.as_backend('round', $$public.finance_series_round('b1500000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_backend('round-again', $$public.finance_series_round('b1500000-0000-4000-8000-00000000000a')$$);
select ok(
  (select count(*) from public.finance_series where org_id = 'b1500000-0000-4000-8000-00000000000a') = 1
    and (select counterparty = 'Imobiliária Teste' and cents = 250000 and day = 10 and direction = 'pay'
         from public.finance_series where org_id = 'b1500000-0000-4000-8000-00000000000a'),
  'only what was paid once in each of the last three months, of values close to each other, becomes a series'
);
select ok(
  (select count(*) from public.finance_bills b join public.finance_series s on s.id = b.series_id
   where b.org_id = 'b1500000-0000-4000-8000-00000000000a' and b.by_one and b.source = 'series' and b.status = 'open'
     and b.cents = 250000 and extract(day from b.due_on) = 10) = 1
    and pg_temp.got('round-again', '{bills}') = '0',
  'ONE writes the next bill of the series, once however many rounds run'
);

select pg_temp.as_person('a1500000-0000-4000-8000-000000000004', 'read',
  $$public.firm_finance_series('b1500000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1500000-0000-4000-8000-000000000002', 'read-caio',
  $$public.firm_finance_series('b1500000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('read', '{0,counterparty}') = 'Imobiliária Teste' and pg_temp.got('read', '{0,next_due_on}') is not null
    and (select value is null or value = 'null'::jsonb from res where key = 'read-caio'),
  'who reads the books sees the series and its next bill; who reads only the costs, nothing'
);

select pg_temp.sign_in('a1500000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.finance_series), 0, 'another firm reads none of it');
reset role;

-- ---------- A person stops it ----------

select pg_temp.as_person('a1500000-0000-4000-8000-000000000004', 'stop',
  format($$public.stop_finance_series('b1500000-0000-4000-8000-00000000000a', %L, 'Mudamos de sala')$$,
    pg_temp.got('read', '{0,id}')));
select ok(
  pg_temp.got('stop', '{cancelled}') = '1'
    and not exists (select 1 from public.finance_bills where org_id = 'b1500000-0000-4000-8000-00000000000a' and status = 'open'),
  'a person stops a series with the reason, and its open bill is cancelled with it'
);

select pg_temp.as_backend('round-after', $$public.finance_series_round('b1500000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('round-after', '{series}') = '0' and pg_temp.got('round-after', '{bills}') = '0',
  'ONE never makes a stopped series again, nor writes its bills'
);

select pg_temp.as_person('a1500000-0000-4000-8000-000000000002', 'stop-caio',
  format($$public.stop_finance_series('b1500000-0000-4000-8000-00000000000a', %L, 'Mudamos de sala')$$,
    pg_temp.got('read', '{0,id}')));
select is(pg_temp.got('stop-caio', '{code}'), 'not_allowed', 'only who writes in the books stops a series');

select * from finish();
rollback;
