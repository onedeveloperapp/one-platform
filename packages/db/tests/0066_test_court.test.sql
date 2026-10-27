begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- The test court (0061, 0062): a case a trip of the test chat opened is a
-- test case for good; its lawsuits are the test court's, never read from a
-- real source; and the firm's test chat link acts as their court, numbering
-- a lawsuit and moving it step by step, each movement kept as a reading
-- keeps it and each publication as a capture of the DJEN keeps it, a
-- hearing held only from its moment. Two firms: nothing of one reaches the
-- other, and a case that is not a test is never touched.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@tribunal.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@tribunal.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-tribunal', 'a6600000-0000-4000-8000-000000000001'),
  ('b6600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-tribunal', 'a6600000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6600000-0000-4000-8000-00000000000a', 'a6600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6600000-0000-4000-8000-00000000000b', 'a6600000-0000-4000-8000-000000000004', 'owner', 'advogado');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c6600000-0000-4000-8000-00000000000a', 'b6600000-0000-4000-8000-00000000000a', 'whatsapp', 'test-waba-ta', 'Chat de teste',
   'connected', 'a6600000-0000-4000-8000-000000000001', now()),
  ('c6600000-0000-4000-8000-00000000000b', 'b6600000-0000-4000-8000-00000000000b', 'whatsapp', 'test-waba-tb', 'Chat de teste',
   'connected', 'a6600000-0000-4000-8000-000000000004', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.tracking_of(lawsuit text) returns public.proceeding_tracking language sql as
$$ select * from public.proceeding_tracking where proceeding_id = pg_temp.got(lawsuit, 'proceeding_id')::uuid; $$;

-- Each firm's test chat, with the link its page opens by.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b6600000-0000-4000-8000-00000000000a',
  'c6600000-0000-4000-8000-00000000000a', 'test', 'test-number-ta', 'test-waba-ta', '5500900000066', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b6600000-0000-4000-8000-00000000000b',
  'c6600000-0000-4000-8000-00000000000b', 'test', 'test-number-tb', 'test-waba-tb', '5500900000067', 'Rocha Advocacia', 'cloud'));
reset role;
insert into public.test_chats (org_id, number_id, token) values
  ('b6600000-0000-4000-8000-00000000000a', pg_temp.got('number_a', 'number_id')::uuid, 'link-do-tribunal-de-teste-da-souza-0001'),
  ('b6600000-0000-4000-8000-00000000000b', pg_temp.got('number_b', 'number_id')::uuid, 'link-do-tribunal-de-teste-da-rocha-0002');

-- Firm A: a case its test chat opened and one a person opened, each with a lawsuit filed (the fixtures' numbers,
-- of 2099), and a lawsuit still planned of the test case. Firm B: a test case with a lawsuit filed.
select pg_temp.sign_in('a6600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_t', public.create_case('b6600000-0000-4000-8000-00000000000a', 'cancellation', 'LA', current_date,
  '{"full_name": "Mariana Teste", "birth_date": "1988-03-02"}'::jsonb));
insert into res values ('case_r', public.create_case('b6600000-0000-4000-8000-00000000000a', 'delay', 'G3', current_date,
  '{"full_name": "Paulo Teste", "birth_date": "1985-04-02"}'::jsonb));
reset role;
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel)
values ('d6600000-0000-4000-8000-00000000000a', 'b6600000-0000-4000-8000-00000000000a', 'Mariana Teste', '5500988880066', 'LA',
        true, 'cancelamento', 'A passageira de teste concorda em ser acompanhada.', now(), 'test');
update public.tracked_trips set status = 'case_opened', case_id = pg_temp.got('case_t', 'case_id')::uuid
where id = 'd6600000-0000-4000-8000-00000000000a';
select pg_temp.sign_in('a6600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('test_go', public.save_proceeding(pg_temp.got('case_t', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
    'cnj', '5000123-60.2099.8.09.0051', 'filed_at', current_date::text),
  array[pg_temp.got('case_t', 'party_id')::uuid]));
insert into res values ('test_planned', public.save_proceeding(pg_temp.got('case_t', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "system": "projudi"}'::jsonb));
insert into res values ('real_go', public.save_proceeding(pg_temp.got('case_r', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'status', 'filed',
    'cnj', '5000789-61.2099.8.09.0051', 'filed_at', current_date::text),
  array[pg_temp.got('case_r', 'party_id')::uuid]));
reset role;
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  (pg_temp.got('test_go', 'proceeding_id')::uuid, 'a6600000-0000-4000-8000-000000000001', 'b6600000-0000-4000-8000-00000000000a');
-- A trip started over lets go of its case: the case stays a test.
update public.tracked_trips set status = 'watching', case_id = null where id = 'd6600000-0000-4000-8000-00000000000a';

select pg_temp.sign_in('a6600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b6600000-0000-4000-8000-00000000000b', 'cancellation', 'AD', current_date,
  '{"full_name": "Pedro Teste"}'::jsonb));
reset role;
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel,
                                  status, case_id)
values ('d6600000-0000-4000-8000-00000000000b', 'b6600000-0000-4000-8000-00000000000b', 'Pedro Teste', '5500988880067', 'AD',
        true, 'cancelamento', 'O passageiro de teste concorda em ser acompanhado.', now(), 'test',
        'case_opened', pg_temp.got('case_b', 'case_id')::uuid);
select pg_temp.sign_in('a6600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('test_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'status', 'filed',
    'cnj', '5000123-60.2099.8.09.0051', 'filed_at', current_date::text),
  array[pg_temp.got('case_b', 'party_id')::uuid]));
reset role;

select ok(
  (select is_test from public.cases where id = pg_temp.got('case_t', 'case_id')::uuid)
  and (select is_test from public.cases where id = pg_temp.got('case_b', 'case_id')::uuid)
  and not (select is_test from public.cases where id = pg_temp.got('case_r', 'case_id')::uuid),
  'a case a trip of the test chat opened is a test case, and stays one once the trip lets go of it; a case a person opened is not'
);

select ok(
  (select source = 'teste' and status = 'waiting' and next_read_at is null from pg_temp.tracking_of('test_go'))
  and (select source = 'projudi' and status = 'waiting' and next_read_at is not null from pg_temp.tracking_of('real_go'))
  and (select source = 'teste' from pg_temp.tracking_of('test_b')),
  'a lawsuit of a test case is the test court''s, owed no reading; one of another case is read from its court as before'
);

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claimed', jsonb_build_object('ids', coalesce(jsonb_agg(c.tracking_id), '[]'::jsonb))
  from public.claim_proceeding_reads(array['projudi', 'aggregator', 'teste'], 100) c;
reset role;
select ok(
  (pg_temp.got('claimed', 'ids'))::jsonb ? (select id::text from pg_temp.tracking_of('real_go'))
  and not (pg_temp.got('claimed', 'ids'))::jsonb ? (select id::text from pg_temp.tracking_of('test_go'))
  and not (pg_temp.got('claimed', 'ids'))::jsonb ? (select id::text from pg_temp.tracking_of('test_b')),
  'the backend never claims a reading of a test lawsuit, whatever sources it names'
);

select ok(
  public.cnj_is_valid(public.test_court_number(pg_temp.got('test_planned', 'proceeding_id')::uuid))
  and substr(public.test_court_number(pg_temp.got('test_planned', 'proceeding_id')::uuid), 10, 7) = '2099809'
  and substr(public.test_court_number(pg_temp.got('test_planned', 'proceeding_id')::uuid), 17, 4) = '0001'
  and public.test_court_number(pg_temp.got('test_planned', 'proceeding_id')::uuid)
    = public.test_court_number(pg_temp.got('test_planned', 'proceeding_id')::uuid)
  and public.test_court_number(pg_temp.got('test_planned', 'proceeding_id')::uuid) not in ('50001236020998090051', '50007896120998090051'),
  'the test court numbers a lawsuit of 2099, of its own court, with its check digits, always the same, never one the firm has'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('view_a', public.test_court_view('link-do-tribunal-de-teste-da-souza-0001'));
insert into res values ('view_b', public.test_court_view('link-do-tribunal-de-teste-da-rocha-0002'));
insert into res values ('view_x', public.test_court_view('link-que-nao-existe-em-tribunal-nenhum-00'));
reset role;
select ok(
  pg_temp.got('view_a', 'found') = 'true' and pg_temp.got('view_a', 'firm') = 'Souza Advogados'
  and jsonb_array_length(pg_temp.got('view_a', 'lawsuits')::jsonb) = 1
  and (pg_temp.got('view_a', 'lawsuits')::jsonb -> 0 ->> 'id') = pg_temp.got('test_go', 'proceeding_id')
  and (pg_temp.got('view_a', 'lawsuits')::jsonb -> 0 ->> 'client') = 'Mariana Teste'
  and jsonb_array_length(pg_temp.got('view_a', 'packages')::jsonb) = 0
  and jsonb_array_length(pg_temp.got('view_b', 'lawsuits')::jsonb) = 1
  and (pg_temp.got('view_b', 'lawsuits')::jsonb -> 0 ->> 'id') = pg_temp.got('test_b', 'proceeding_id')
  and pg_temp.got('view_x', 'found') = 'false',
  'the test court''s page shows by the link the test lawsuits of its own firm, and nothing by a link that is not one'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('other_firm', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_b', 'proceeding_id')::uuid, 'distribuicao'));
insert into res values ('not_test', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('real_go', 'proceeding_id')::uuid, 'distribuicao'));
insert into res values ('too_soon', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'sentenca'));
insert into res values ('no_event', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'citacao'));
insert into res values ('planned', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_planned', 'proceeding_id')::uuid, 'distribuicao'));
reset role;
select ok(
  pg_temp.got('other_firm', 'code') = 'not_found' and pg_temp.got('not_test', 'code') = 'not_a_test_case'
  and pg_temp.got('too_soon', 'code') = 'not_distributed' and pg_temp.got('no_event', 'code') = 'invalid_event'
  and pg_temp.got('planned', 'code') = 'not_filed'
  and (select count(*) = 0 from public.movements where proceeding_id = pg_temp.got('real_go', 'proceeding_id')::uuid),
  'the test court acts only on a filed lawsuit of a test case of its own firm, distributed before anything else'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('distributed', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'distribuicao'));
insert into res values ('again', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'distribuicao'));
reset role;
select pg_temp.sign_in('a6600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today_a', public.firm_today('b6600000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('distributed', 'code') = 'done' and pg_temp.got('distributed', 'moved') = '2'
  and (select count(*) = 2 from public.movements
       where proceeding_id = pg_temp.got('test_go', 'proceeding_id')::uuid and source = 'teste')
  and (select status = 'tracked' and unseen_count = 2 and vendor = 'tribunal-teste' and movements_count = 2
              and snapshot ->> 'status' = 'Em andamento' and next_read_at is null
       from pg_temp.tracking_of('test_go'))
  and (select bool_and(m.learned_at > t.seen_until) from public.movements m
       join public.proceeding_tracking t on t.proceeding_id = m.proceeding_id
       where m.proceeding_id = pg_temp.got('test_go', 'proceeding_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_t', 'case_id')::uuid
              and e.kind = 'court_moved' and e.data ->> 'source' = 'teste')
  and pg_temp.got('today_a', 'movements_new') = '1'
  and pg_temp.got('again', 'code') = 'already',
  'distributing keeps its movements as news to the firm, tells the timeline, and is done once'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('hearing', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'audiencia'));
reset role;
select ok(
  pg_temp.got('hearing', 'code') = 'done' and pg_temp.got('hearing', 'published') is not null
  and (pg_temp.got('hearing', 'hearing_at'))::timestamp at time zone 'America/Sao_Paulo' >= now() + interval '10 minutes'
  and extract(hour from (pg_temp.got('hearing', 'hearing_at'))::timestamp) between 7 and 19
  and (select p.hash like 'teste-audiencia-%' and p.court = 'TJGO' and p.cnj = '50001236020998090051'
              and p.proceeding_id = pg_temp.got('test_go', 'proceeding_id')::uuid
              and p.case_id = pg_temp.got('case_t', 'case_id')::uuid
              and p.category is null and p.active and not p.truncated
              and p.lawyer_ids = array['a6600000-0000-4000-8000-000000000001']::uuid[]
              and p.available_on = (now() at time zone 'America/Sao_Paulo')::date
              and p.body like '%audiência de conciliação para o dia '
                || to_char((pg_temp.got('hearing', 'hearing_at'))::timestamp, 'DD/MM/YYYY') || ', às '
                || to_char((pg_temp.got('hearing', 'hearing_at'))::timestamp, 'HH24:MI') || ', a ser realizada presencialmente%'
       from public.publications p where p.id = pg_temp.got('hearing', 'published')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_t', 'case_id')::uuid
              and e.kind = 'publication_captured'),
  'setting a hearing publishes it to the lawyers of the lawsuit, at least ten minutes ahead and in the hours of a hearing'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('held_early', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'audiencia_realizada'));
insert into res values ('view_hearing', public.test_court_view('link-do-tribunal-de-teste-da-souza-0001'));
reset role;
select ok(
  pg_temp.got('held_early', 'code') = 'hearing_later'
  and pg_temp.got('held_early', 'hearing_at') = pg_temp.got('hearing', 'hearing_at')
  and (pg_temp.got('view_hearing', 'lawsuits')::jsonb -> 0 ->> 'hearing_at')::timestamptz
    = (pg_temp.got('hearing', 'hearing_at'))::timestamp at time zone 'America/Sao_Paulo'
  and not exists (select 1 from public.movements
                  where proceeding_id = pg_temp.got('test_go', 'proceeding_id')::uuid
                    and source_id like 'teste:audiencia\_realizada:%'),
  'the court holds no hearing before its moment, and its page reads that moment'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('answer', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'manifestacao'));
insert into res values ('pay_early', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'alvara'));
insert into res values ('judgment', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'sentenca'));
reset role;
select ok(
  pg_temp.got('answer', 'code') = 'done'
  and (select body like '%no prazo de 15 (quinze) dias, manifestar-se sobre a contestação%'
       from public.publications where id = pg_temp.got('answer', 'published')::uuid)
  and pg_temp.got('pay_early', 'code') = 'not_final'
  and pg_temp.got('judgment', 'code') = 'done'
  and (select document_type = 'Sentença' and body like '%JULGO PROCEDENTE%'
       from public.publications where id = pg_temp.got('judgment', 'published')::uuid),
  'the court asks for an answer within 15 days and gives its judgment, and pays nothing before the judgment is final'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('final', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'transito'));
insert into res values ('paid', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'alvara'));
insert into res values ('archived', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'arquivamento'));
insert into res values ('after', public.test_court_act('link-do-tribunal-de-teste-da-souza-0001',
  pg_temp.got('test_go', 'proceeding_id')::uuid, 'audiencia_realizada'));
reset role;
select ok(
  pg_temp.got('final', 'code') = 'done' and pg_temp.got('final', 'published') is null
  and pg_temp.got('paid', 'code') = 'done'
  and (select body like 'Expeça-se alvará eletrônico em favor da parte autora%'
       from public.publications where id = pg_temp.got('paid', 'published')::uuid)
  and pg_temp.got('archived', 'code') = 'done'
  and (select snapshot ->> 'status' = 'Arquivado' from pg_temp.tracking_of('test_go'))
  and pg_temp.got('after', 'code') = 'archived'
  and (select count(*) = 5 from public.publications where org_id = 'b6600000-0000-4000-8000-00000000000a'),
  'the judgment made final, the money released and the lawsuit archived, after which the court does nothing more'
);

select pg_temp.sign_in('a6600000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.publications)
  and (select count(*) = 0 from public.movements)
  and (select count(*) = 0 from public.proceeding_tracking where status <> 'waiting'),
  'firm B reads none of what the test court did for firm A'
);
reset role;

-- Firm B's hearing, set and then come: its movement written as of a minute ago.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_distributed', public.test_court_act('link-do-tribunal-de-teste-da-rocha-0002',
  pg_temp.got('test_b', 'proceeding_id')::uuid, 'distribuicao'));
insert into res values ('b_hearing', public.test_court_act('link-do-tribunal-de-teste-da-rocha-0002',
  pg_temp.got('test_b', 'proceeding_id')::uuid, 'audiencia'));
reset role;
update public.movements
set detail = to_char((now() at time zone 'America/Sao_Paulo') - interval '1 minute', 'DD/MM/YYYY "às" HH24:MI') || ', presencial'
where proceeding_id = pg_temp.got('test_b', 'proceeding_id')::uuid and source_id = 'teste:audiencia:1';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_held', public.test_court_act('link-do-tribunal-de-teste-da-rocha-0002',
  pg_temp.got('test_b', 'proceeding_id')::uuid, 'audiencia_realizada'));
reset role;
select ok(
  pg_temp.got('b_distributed', 'code') = 'done' and pg_temp.got('b_hearing', 'code') = 'done'
  and pg_temp.got('b_held', 'code') = 'done'
  and exists (select 1 from public.movements
              where proceeding_id = pg_temp.got('test_b', 'proceeding_id')::uuid
                and source_id = 'teste:audiencia_realizada:1' and title = 'Audiência de conciliação realizada'),
  'once its moment came, the court holds the hearing'
);

select ok(
  not has_function_privilege('anon', 'public.test_court_act(text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.test_court_act(text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.test_court_view(text)', 'execute'),
  'only the backend acts as the test court, by the link a page hands it'
);

select * from finish();
rollback;
