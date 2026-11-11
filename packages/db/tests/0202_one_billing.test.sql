begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- ONE's own billing (0202). The tiers are data: Lima subscribes to the tier
-- "escritorio" (rank 2) and holds a grant of "essencial" (rank 1), so its
-- tier is "escritorio". What Lima uses is measured once a day (its open real
-- cases, its people, its numbers at the vendor), and nearing its ceiling it is
-- told once a month at 80 and 100 percent, to who manages its account and who
-- decides for it. The panel of use is theirs; a lawyer reads that it is not.
-- A change of tier is begun by who manages the account, with the second
-- factor, to a plan of the same period, and recorded by the backend once.
-- Rocha reads nothing of Lima's.
--
-- Every person, firm, plan and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2020000-0000-4000-8000-000000000001', 'ana@lima-faixa.invalid', 'Ana Lima'),
  ('a2020000-0000-4000-8000-000000000002', 'caio@lima-faixa.invalid', 'Caio Lima'),
  ('a2020000-0000-4000-8000-000000000003', 'bia@lima-faixa.invalid', 'Bia Lima'),
  ('a2020000-0000-4000-8000-000000000009', 'edu@rocha-faixa.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2020000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-faixa', 'a2020000-0000-4000-8000-000000000001'),
  ('b2020000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-faixa', 'a2020000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2020000-0000-4000-8000-00000000000a', 'a2020000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2020000-0000-4000-8000-00000000000a', 'a2020000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2020000-0000-4000-8000-00000000000a', 'a2020000-0000-4000-8000-000000000003', 'admin', 'controladoria'),
  ('b2020000-0000-4000-8000-00000000000b', 'a2020000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.plans (id, slug, name, kind, family, tier, rank, period, price_cents, currency, is_public, limits) values
  ('d2020000-0000-4000-8000-000000000001', 'essencial-mensal', 'Essencial', 'recurring', 'essencial', 'essencial', 1,
   'monthly', 49000, 'BRL', true, '{"processos_ativos_max": 3, "assentos_max": 5}'),
  ('d2020000-0000-4000-8000-000000000002', 'escritorio-mensal', 'Escritório', 'recurring', 'escritorio', 'escritorio', 2,
   'monthly', 99000, 'BRL', true, '{"processos_ativos_max": 3, "assentos_max": 10}'),
  ('d2020000-0000-4000-8000-000000000003', 'rede-mensal', 'Rede', 'recurring', 'rede', 'rede', 3,
   'monthly', 199000, 'BRL', true, '{"processos_ativos_max": 300, "assentos_max": 30}'),
  ('d2020000-0000-4000-8000-000000000004', 'rede-anual', 'Rede anual', 'recurring', 'rede', 'rede', 3,
   'yearly', 1990000, 'BRL', true, '{"processos_ativos_max": 300, "assentos_max": 30}');
-- Every firm is founded on the free plan's subscription; Lima's goes for the one it pays.
delete from public.subscriptions where org_id = 'b2020000-0000-4000-8000-00000000000a';
insert into public.subscriptions (id, org_id, plan_id, status, provider, provider_customer_id, provider_subscription_id,
                                  period, price_cents, currency, current_period_start, current_period_end) values
  ('e2020000-0000-4000-8000-000000000001', 'b2020000-0000-4000-8000-00000000000a', 'd2020000-0000-4000-8000-000000000002',
   'active', 'asaas', 'cus_lima', 'sub_lima', 'monthly', 99000, 'BRL', now() - interval '3 days', now() + interval '27 days');
insert into public.entitlement_grants (org_id, kind, plan_id, limits, source, note) values
  ('b2020000-0000-4000-8000-00000000000a', 'comp', 'd2020000-0000-4000-8000-000000000001', '{"assentos_max": 5}',
   'admin', 'Cortesia de teste');

-- Lima: three open real cases, a test case and a closed one.
insert into public.cases (org_id, seq, module, incident, status, is_test, closed_at) values
  ('b2020000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake', false, null),
  ('b2020000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed', false, null),
  ('b2020000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'documents', false, null),
  ('b2020000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'delay', 'intake', true, null),
  ('b2020000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay', 'closed', false, now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.sign_in(person uuid, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;

select pg_temp.sign_in('a2020000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'rights', public.org_entitlements('b2020000-0000-4000-8000-00000000000a');
reset role;

select ok(
  pg_temp.got('rights', '{tier}') = 'escritorio' and pg_temp.got('rights', '{limits,assentos_max}') = '10',
  'the tier is the one of the live source of the highest rank, written as data'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'first', public.record_usage_day(500);
delete from public.usage_ledger where org_id = 'b2020000-0000-4000-8000-00000000000a';
insert into res select 'again', public.record_usage_day(500);
reset role;

select ok(
  (select value = 3 from public.usage_ledger where org_id = 'b2020000-0000-4000-8000-00000000000a' and metric = 'processos_ativos')
  and (select value = 3 from public.usage_ledger where org_id = 'b2020000-0000-4000-8000-00000000000a' and metric = 'assentos')
  and (select value = 0 from public.usage_ledger where org_id = 'b2020000-0000-4000-8000-00000000000a' and metric = 'whatsapp_numeros'),
  'a firm''s day is measured: its open real cases, its people and its numbers at the vendor'
);

select ok(
  (select array_agg((a ->> 'percent')::integer order by (a ->> 'percent')::integer)
   from res, jsonb_array_elements(payload -> 'alerts') a
   where name = 'first' and a ->> 'org_id' = 'b2020000-0000-4000-8000-00000000000a' and a ->> 'metric' = 'processos_ativos')
  = array[80, 100]
  and not exists (select 1 from res, jsonb_array_elements(payload -> 'alerts') a
                  where name = 'again' and a ->> 'org_id' = 'b2020000-0000-4000-8000-00000000000a'),
  'nearing a ceiling the firm is told at each share once a month'
);

select ok(
  (select array_agg(p #>> '{}' order by p #>> '{}')
   from res, jsonb_array_elements(payload -> 'alerts') a, jsonb_array_elements(a -> 'people') p
   where name = 'first' and a ->> 'percent' = '100' and a ->> 'metric' = 'processos_ativos'
     and a ->> 'org_id' = 'b2020000-0000-4000-8000-00000000000a')
  = array['a2020000-0000-4000-8000-000000000001', 'a2020000-0000-4000-8000-000000000003'],
  'who is told is who manages the firm''s account and who decides for it'
);

select pg_temp.sign_in('a2020000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'panel', public.firm_usage('b2020000-0000-4000-8000-00000000000a');
reset role;
select pg_temp.sign_in('a2020000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'lawyer_panel', public.firm_usage('b2020000-0000-4000-8000-00000000000a');
insert into res select 'lawyer_change', public.begin_plan_change('b2020000-0000-4000-8000-00000000000a',
  'd2020000-0000-4000-8000-000000000003');
reset role;

select ok(
  pg_temp.got('panel', '{manages}') = 'true' and pg_temp.got('panel', '{plan,name}') = 'Escritório'
  and pg_temp.got('panel', '{metrics,0,metric}') = 'processos_ativos' and pg_temp.got('panel', '{metrics,0,now}') = '3'
  and pg_temp.got('panel', '{metrics,0,ceiling}') = '3'
  and (select jsonb_array_length(payload -> 'alerts') = 2 from res where name = 'panel')
  and (select array_agg(x ->> 'name' order by (x ->> 'rank')::integer) from res, jsonb_array_elements(payload -> 'plans') x
       where name = 'panel') = array['Essencial', 'Escritório', 'Rede']
  and pg_temp.got('lawyer_panel', '{manages}') = 'false' and pg_temp.got('lawyer_panel', '{metrics}') is null,
  'the panel says the plan, each metric against its ceiling, the month''s alerts and the plans of the same period'
);

select pg_temp.sign_in('a2020000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
insert into res select 'no_factor', public.begin_plan_change('b2020000-0000-4000-8000-00000000000a',
  'd2020000-0000-4000-8000-000000000003');
reset role;
select pg_temp.sign_in('a2020000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'same', public.begin_plan_change('b2020000-0000-4000-8000-00000000000a',
  'd2020000-0000-4000-8000-000000000002');
insert into res select 'yearly', public.begin_plan_change('b2020000-0000-4000-8000-00000000000a',
  'd2020000-0000-4000-8000-000000000004');
insert into res select 'up', public.begin_plan_change('b2020000-0000-4000-8000-00000000000a',
  'd2020000-0000-4000-8000-000000000003');
reset role;

select ok(
  pg_temp.got('lawyer_change', '{code}') = 'not_allowed' and pg_temp.got('no_factor', '{code}') = 'second_factor'
  and pg_temp.got('same', '{code}') = 'same_plan' and pg_temp.got('yearly', '{code}') = 'period_mismatch'
  and pg_temp.got('up', '{ok}') = 'true' and pg_temp.got('up', '{provider_subscription_id}') = 'sub_lima'
  and pg_temp.got('up', '{price_cents}') = '199000' and pg_temp.got('up', '{up}') = 'true'
  and (select plan_id = 'd2020000-0000-4000-8000-000000000002' from public.subscriptions
       where id = 'e2020000-0000-4000-8000-000000000001'),
  'a change of tier is begun only by who manages the account, with the second factor, to a plan of the same period'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'commit', public.commit_plan_change('e2020000-0000-4000-8000-000000000001',
  'd2020000-0000-4000-8000-000000000003', 'a2020000-0000-4000-8000-000000000001');
insert into res select 'commit_again', public.commit_plan_change('e2020000-0000-4000-8000-000000000001',
  'd2020000-0000-4000-8000-000000000003', 'a2020000-0000-4000-8000-000000000001');
reset role;

select ok(
  pg_temp.got('commit', '{code}') = 'changed' and pg_temp.got('commit_again', '{code}') = 'already'
  and (select plan_id = 'd2020000-0000-4000-8000-000000000003' and price_cents = 199000 from public.subscriptions
       where id = 'e2020000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.audit_events where action = 'billing.plan_changed'
         and org_id = 'b2020000-0000-4000-8000-00000000000a'),
  'the backend records the change Asaas took, once, on the record'
);

select pg_temp.sign_in('a2020000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok($$ select public.firm_usage('b2020000-0000-4000-8000-00000000000a') $$, '42501', null,
  'nobody reads another firm''s use');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.record_usage_day(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commit_plan_change(uuid, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.usage_now(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.firm_usage(uuid)', 'EXECUTE'),
  'only the backend measures and records a change; a person reads the panel'
);

select * from finish();
rollback;
