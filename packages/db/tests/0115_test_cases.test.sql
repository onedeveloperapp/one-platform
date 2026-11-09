begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- The test cases in the firm's numbers, and the test court's quiet lawsuits
-- (0114): how many real and test cases a firm has; the list, the export, the
-- stock and the board with or without its test cases, each marking them; a
-- lawsuit moved today in the test court in "Movimentados hoje"; and one the
-- test court left quiet in each mark of what is quiet. Two firms: nothing of
-- one reaches the other, and a real lawsuit is never moved back.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1150000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@testes.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1150000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@testes.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1150000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-testes', 'a1150000-0000-4000-8000-000000000001'),
  ('b1150000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-testes', 'a1150000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1150000-0000-4000-8000-00000000000a', 'a1150000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1150000-0000-4000-8000-00000000000b', 'a1150000-0000-4000-8000-000000000004', 'owner', 'advogado');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c1150000-0000-4000-8000-00000000000a', 'b1150000-0000-4000-8000-00000000000a', 'whatsapp', 'test-waba-ca', 'Chat de teste',
   'connected', 'a1150000-0000-4000-8000-000000000001', now()),
  ('c1150000-0000-4000-8000-00000000000b', 'b1150000-0000-4000-8000-00000000000b', 'whatsapp', 'test-waba-cb', 'Chat de teste',
   'connected', 'a1150000-0000-4000-8000-000000000004', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.seqs(name text) returns jsonb language sql as
$$ select coalesce(jsonb_agg((r ->> 'seq')::int order by (r ->> 'seq')::int), '[]'::jsonb) from res, jsonb_array_elements(res.payload -> 'rows') r where res.name = seqs.name; $$;

-- Each firm's test chat, with the link its page opens by.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b1150000-0000-4000-8000-00000000000a',
  'c1150000-0000-4000-8000-00000000000a', 'test', 'test-number-ca', 'test-waba-ca', '5500900000115', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b1150000-0000-4000-8000-00000000000b',
  'c1150000-0000-4000-8000-00000000000b', 'test', 'test-number-cb', 'test-waba-cb', '5500900000116', 'Rocha Advocacia', 'cloud'));
reset role;
insert into public.test_chats (org_id, number_id, token) values
  ('b1150000-0000-4000-8000-00000000000a', pg_temp.got('number_a', 'number_id')::uuid, 'link-dos-casos-de-teste-da-souza-00001'),
  ('b1150000-0000-4000-8000-00000000000b', pg_temp.got('number_b', 'number_id')::uuid, 'link-dos-casos-de-teste-da-rocha-00002');

-- Firm A: a case its test chat opened and one a person opened, each with a lawsuit filed today. Firm B: a test case.
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_t', public.create_case('b1150000-0000-4000-8000-00000000000a', 'cancellation', 'LA', current_date,
  '{"full_name": "Mariana Teste", "birth_date": "1988-03-02"}'::jsonb));
insert into res values ('case_r', public.create_case('b1150000-0000-4000-8000-00000000000a', 'delay', 'G3', current_date,
  '{"full_name": "Paulo Teste", "birth_date": "1985-04-02"}'::jsonb));
reset role;
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel, status, case_id)
values ('d1150000-0000-4000-8000-00000000000a', 'b1150000-0000-4000-8000-00000000000a', 'Mariana Teste', '5500988880115', 'LA',
        true, 'cancelamento', 'A passageira de teste concorda em ser acompanhada.', now(), 'test', 'case_opened', pg_temp.got('case_t', 'case_id')::uuid);
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('test_go', public.save_proceeding(pg_temp.got('case_t', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
    'cnj', '5000123-60.2099.8.09.0051', 'filed_at', current_date::text),
  array[pg_temp.got('case_t', 'party_id')::uuid]));
insert into res values ('real_go', public.save_proceeding(pg_temp.got('case_r', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'status', 'filed',
    'cnj', '5000789-61.2099.8.09.0051', 'filed_at', current_date::text),
  array[pg_temp.got('case_r', 'party_id')::uuid]));
reset role;
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b1150000-0000-4000-8000-00000000000b', 'cancellation', 'AD', current_date,
  '{"full_name": "Pedro Teste"}'::jsonb));
reset role;
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel, status, case_id)
values ('d1150000-0000-4000-8000-00000000000b', 'b1150000-0000-4000-8000-00000000000b', 'Pedro Teste', '5500988880116', 'AD',
        true, 'cancelamento', 'O passageiro de teste concorda em ser acompanhado.', now(), 'test', 'case_opened', pg_temp.got('case_b', 'case_id')::uuid);

-- A case written with its lawsuit in one transaction stays at its stage (0062): these two are in court.
update public.cases set status = 'filed'
where id in (pg_temp.got('case_t', 'case_id')::uuid, pg_temp.got('case_r', 'case_id')::uuid);

-- ---------- The firm's numbers, with and without the test cases ----------

select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('count_a', public.firm_test_cases('b1150000-0000-4000-8000-00000000000a'));
insert into res values ('all', public.firm_cases('b1150000-0000-4000-8000-00000000000a'));
insert into res values ('real', public.firm_cases(target_org => 'b1150000-0000-4000-8000-00000000000a', target_tests => false));
insert into res values ('stock_all', public.firm_case_stock('b1150000-0000-4000-8000-00000000000a'));
insert into res values ('stock_real', public.firm_case_stock(target_org => 'b1150000-0000-4000-8000-00000000000a', target_tests => false));
insert into res values ('board_all', public.firm_case_board('b1150000-0000-4000-8000-00000000000a'));
insert into res values ('board_real', public.firm_case_board(target_org => 'b1150000-0000-4000-8000-00000000000a', target_tests => false));
insert into res values ('begun', public.begin_case_export('b1150000-0000-4000-8000-00000000000a', null, null, false, 1));
insert into res values ('export', public.firm_cases_export(target_org => 'b1150000-0000-4000-8000-00000000000a', target_tests => false));
reset role;
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('count_b', public.firm_test_cases('b1150000-0000-4000-8000-00000000000b'));
select throws_ok(
  $$ select public.firm_test_cases('b1150000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'nobody of another firm reads how many cases a firm has'
);
reset role;

select ok(
  pg_temp.got('count_a', 'real') = '1' and pg_temp.got('count_a', 'test') = '1'
    and pg_temp.got('count_b', 'real') = '0' and pg_temp.got('count_b', 'test') = '1',
  'a firm says how many real and test cases it has, its own alone'
);
select ok(
  pg_temp.seqs('all') = '[1, 2]'::jsonb
    and (select bool_and((r ->> 'is_test')::boolean = ((r ->> 'seq')::int = 1)) from res, jsonb_array_elements(payload -> 'rows') r where name = 'all'),
  'by default the list holds every case, each row saying whether it is a test'
);
select ok(
  pg_temp.seqs('real') = '[2]'::jsonb
    and (select (payload #>> '{counts,going}')::int = 1 and (payload ->> 'total')::int = 1 and (payload #>> '{numbers,going}')::int = 1 from res where name = 'real'),
  'without the test cases the list, its counts and its numbers hold the real ones alone'
);
select ok(
  (select (payload ->> 'total')::int from res where name = 'stock_all') = 2
    and (select (payload ->> 'total')::int from res where name = 'stock_real') = 1,
  'so does the stock'
);
select ok(
  (select count(*) from res, jsonb_array_elements(payload -> 'columns') c, jsonb_array_elements(c -> 'items') i
   where name = 'board_all' and (i ->> 'is_test')::boolean) = 1
    and (select count(*) from res, jsonb_array_elements(payload -> 'columns') c, jsonb_array_elements(c -> 'items') i
         where name = 'board_real' and (i ->> 'is_test')::boolean) = 0
    and (select sum((c ->> 'cases')::int) from res, jsonb_array_elements(payload -> 'columns') c where name = 'board_real') = 1,
  'and the board, which marks a test case on its card'
);
select is(pg_temp.seqs('export'), '[2]'::jsonb, 'and the export');

-- ---------- What the test court moves and what it leaves quiet ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('moved', public.test_court_act('link-dos-casos-de-teste-da-souza-00001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'distribuicao'));
reset role;
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'mov-hoje'));
reset role;
select is(pg_temp.seqs('today'), '[1]'::jsonb, 'a lawsuit moved today in the test court is in "Movimentados hoje"');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('quiet_31', public.test_court_quiet('link-dos-casos-de-teste-da-souza-00001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 31));
reset role;
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('q31_30', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'parado-30'));
insert into res values ('q31_45', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'parado-45'));
insert into res values ('q31_today', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'mov-hoje'));
reset role;
select ok(
  pg_temp.got('quiet_31', 'ok')::boolean and pg_temp.seqs('q31_30') = '[1]'::jsonb and pg_temp.seqs('q31_45') = '[]'::jsonb
    and pg_temp.seqs('q31_today') = '[]'::jsonb,
  'left quiet for 31 days, it passes the mark of 30 and no other, and did not move today'
);
select ok(
  (select max(m.occurred_at)::date = (now() - interval '31 days')::date from public.movements m
   where m.proceeding_id = pg_temp.got('test_go', 'proceeding_id')::uuid)
    and (select p.filed_at <= (now() at time zone 'America/Sao_Paulo')::date - 31 from public.proceedings p
         where p.id = pg_temp.got('test_go', 'proceeding_id')::uuid),
  'its movements went back with it, and a filing later than that too'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('quiet_46', public.test_court_quiet('link-dos-casos-de-teste-da-souza-00001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 46));
reset role;
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('q46_45', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'parado-45'));
insert into res values ('q46_90', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'parado-90'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('quiet_91', public.test_court_quiet('link-dos-casos-de-teste-da-souza-00001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 91));
reset role;
select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('q91_90', public.firm_cases('b1150000-0000-4000-8000-00000000000a', 'parado-90'));
reset role;
select ok(
  pg_temp.seqs('q46_45') = '[1]'::jsonb and pg_temp.seqs('q46_90') = '[]'::jsonb and pg_temp.seqs('q91_90') = '[1]'::jsonb,
  'and for 46 and 91 days it passes each of the other marks'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('days', public.test_court_quiet('link-dos-casos-de-teste-da-souza-00001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 10));
insert into res values ('real_quiet', public.test_court_quiet('link-dos-casos-de-teste-da-souza-00001',
  pg_temp.got('real_go', 'proceeding_id')::uuid, 31));
insert into res values ('other_link', public.test_court_quiet('link-dos-casos-de-teste-da-rocha-00002',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 31));
reset role;
select ok(
  pg_temp.got('days', 'code') = 'invalid_days' and pg_temp.got('real_quiet', 'code') = 'not_a_test_case'
    and pg_temp.got('other_link', 'code') = 'not_found',
  'only those days, never a real lawsuit, never another firm''s by its link'
);
select ok(
  (select p.filed_at = current_date from public.proceedings p where p.id = pg_temp.got('real_go', 'proceeding_id')::uuid),
  'and a real lawsuit stays as it was'
);

select pg_temp.sign_in('a1150000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.test_court_quiet('link-dos-casos-de-teste-da-souza-00001', gen_random_uuid(), 31) $$,
  '42501', null,
  'a person calls it only through the backend'
);
reset role;

select * from finish();
rollback;
