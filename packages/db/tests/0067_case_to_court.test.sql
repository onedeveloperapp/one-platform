begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- A case follows its lawsuits into court (0062): once a planned lawsuit is
-- filed and none of the case's lawsuits is still planned, a case still
-- being prepared is at the stage `filed`, as ONE's step in its timeline; a
-- case a person already put in court keeps its record, and a case written
-- with its lawsuit in one transaction (as an import writes it) is left to
-- what wrote it. Two firms: what one files moves nothing of the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@ajuizado.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@ajuizado.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6700000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-ajuizado', 'a6700000-0000-4000-8000-000000000001'),
  ('b6700000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-ajuizado', 'a6700000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6700000-0000-4000-8000-00000000000a', 'a6700000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6700000-0000-4000-8000-00000000000b', 'a6700000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.case_id(name text) returns uuid language sql as
$$ select (payload ->> 'case_id')::uuid from res where res.name = case_id.name; $$;
create function pg_temp.stage(name text) returns text language sql as
$$ select status from public.cases where id = pg_temp.case_id(stage.name); $$;
create function pg_temp.moves(name text, actor text) returns bigint language sql as
$$ select count(*) from public.case_events
   where case_id = pg_temp.case_id(moves.name) and kind = 'status_changed' and actor_type = moves.actor; $$;
-- A lawsuit of the small-claims court planned, and the same filed with a number of 2099.
create function pg_temp.planned(kind text) returns jsonb language sql as
$$ select jsonb_build_object('kind', planned.kind, 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia'); $$;
create function pg_temp.filed(kind text, cnj text) returns jsonb language sql as
$$ select pg_temp.planned(filed.kind)
     || jsonb_build_object('status', 'filed', 'cnj', filed.cnj, 'filed_at', current_date::text); $$;

-- Firm A: three cases opened the day before, and one written now with its lawsuit already filed.
select pg_temp.sign_in('a6700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('one', public.create_case('b6700000-0000-4000-8000-00000000000a', 'cancellation', 'LA', current_date,
  '{"full_name": "Mariana Teste"}'::jsonb));
insert into res values ('two', public.create_case('b6700000-0000-4000-8000-00000000000a', 'delay', 'G3', current_date,
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('set', public.create_case('b6700000-0000-4000-8000-00000000000a', 'delay', 'AD', current_date,
  '{"full_name": "Lucia Teste"}'::jsonb));
insert into res values ('now', public.create_case('b6700000-0000-4000-8000-00000000000a', 'cancellation', 'LA', current_date,
  '{"full_name": "Rafael Teste"}'::jsonb));
reset role;
-- Firm B: a case opened the day before.
select pg_temp.sign_in('a6700000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b', public.create_case('b6700000-0000-4000-8000-00000000000b', 'cancellation', 'AD', current_date,
  '{"full_name": "Pedro Teste"}'::jsonb));
reset role;
update public.cases set created_at = now() - interval '1 day'
where id in (pg_temp.case_id('one'), pg_temp.case_id('two'), pg_temp.case_id('set'), pg_temp.case_id('b'));

-- Their lawsuits planned; the case a person puts in court before anything was filed.
select pg_temp.sign_in('a6700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('one_l', public.save_proceeding(pg_temp.case_id('one'), null, pg_temp.planned('juizado')));
insert into res values ('two_l1', public.save_proceeding(pg_temp.case_id('two'), null, pg_temp.planned('juizado')));
insert into res values ('two_l2', public.save_proceeding(pg_temp.case_id('two'), null, pg_temp.planned('comum')));
insert into res values ('set_l', public.save_proceeding(pg_temp.case_id('set'), null, pg_temp.planned('juizado')));
insert into res values ('set_stage', public.set_case_status(pg_temp.case_id('set'), 'filed'));
reset role;
select pg_temp.sign_in('a6700000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_l', public.save_proceeding(pg_temp.case_id('b'), null, pg_temp.planned('juizado')));
reset role;

-- Firm A files: the only lawsuit of one case, the first of two of another, the lawsuit of the case a person
-- put in court, and a new lawsuit filed at once in the case written now.
select pg_temp.sign_in('a6700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('one_filed', public.save_proceeding(pg_temp.case_id('one'), pg_temp.got('one_l', 'proceeding_id')::uuid,
  pg_temp.filed('juizado', '5000401-61.2099.8.09.0051')));
insert into res values ('two_first', public.save_proceeding(pg_temp.case_id('two'), pg_temp.got('two_l1', 'proceeding_id')::uuid,
  pg_temp.filed('juizado', '5000402-46.2099.8.09.0051')));
insert into res values ('set_filed', public.save_proceeding(pg_temp.case_id('set'), pg_temp.got('set_l', 'proceeding_id')::uuid,
  pg_temp.filed('juizado', '5000404-16.2099.8.09.0051')));
insert into res values ('now_l', public.save_proceeding(pg_temp.case_id('now'), null,
  pg_temp.filed('juizado', '5000405-98.2099.8.09.0051')));
reset role;
insert into res select 'two_between', to_jsonb(c) from public.cases c where c.id = pg_temp.case_id('two');
insert into res select 'b_between', to_jsonb(c) from public.cases c where c.id = pg_temp.case_id('b');

select ok(
  pg_temp.got('one_filed', 'code') = 'saved'
  and pg_temp.stage('one') = 'filed'
  and pg_temp.moves('one', 'system') = 1 and pg_temp.moves('one', 'person') = 0
  and (select data ->> 'from' = 'intake' and data ->> 'to' = 'filed' from public.case_events
       where case_id = pg_temp.case_id('one') and kind = 'status_changed')
  -- The audit trail keeps it under the session that caused it (the database stamps the kind of actor).
  and exists (select 1 from public.audit_events where entity_id = pg_temp.case_id('one')::text
              and action = 'case.status_changed'),
  'the only planned lawsuit of a case filed, the case is in court, ONE''s step in its timeline'
);

select ok(
  pg_temp.got('two_first', 'code') = 'saved'
  and pg_temp.got('two_between', 'status') = 'intake'
  and pg_temp.got('b_between', 'status') = 'intake',
  'a case with a lawsuit still planned stays where it was, and what one firm files moves nothing of the other'
);

select pg_temp.sign_in('a6700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('two_second', public.save_proceeding(pg_temp.case_id('two'), pg_temp.got('two_l2', 'proceeding_id')::uuid,
  pg_temp.filed('comum', '5000403-31.2099.8.09.0051')));
reset role;
select ok(
  pg_temp.got('two_second', 'code') = 'saved'
  and pg_temp.stage('two') = 'filed' and pg_temp.moves('two', 'system') = 1,
  'the last planned lawsuit filed, the case goes to court once'
);

select ok(
  pg_temp.got('set_stage', 'code') = 'saved' and pg_temp.got('set_filed', 'code') = 'saved'
  and pg_temp.stage('set') = 'filed'
  and pg_temp.moves('set', 'person') = 1 and pg_temp.moves('set', 'system') = 0,
  'a case a person already put in court keeps that record, and ONE writes no step of its own'
);

select ok(
  pg_temp.got('now_l', 'code') = 'saved'
  and pg_temp.stage('now') = 'intake'
  and pg_temp.moves('now', 'system') = 0,
  'a case written with its lawsuit in one transaction, as an import writes it, is left to what wrote it'
);

select pg_temp.sign_in('a6700000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_filed', public.save_proceeding(pg_temp.case_id('b'), pg_temp.got('b_l', 'proceeding_id')::uuid,
  pg_temp.filed('juizado', '5000406-83.2099.8.09.0051')));
reset role;
select pg_temp.sign_in('a6700000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.case_events where case_id = pg_temp.case_id('b'))
  and (select count(*) = 0 from public.cases where id = pg_temp.case_id('b')),
  'firm A reads nothing of firm B''s case'
);
reset role;

select ok(
  pg_temp.got('b_filed', 'code') = 'saved' and pg_temp.stage('b') = 'filed' and pg_temp.moves('b', 'system') = 1
  and not has_function_privilege('authenticated', 'public.proceedings_case_to_court()', 'execute')
  and not has_function_privilege('anon', 'public.test_court_hearing_at(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.test_court_hearing_at(uuid)', 'execute'),
  'firm B''s case goes to court with its own lawsuit; only the database runs these'
);

select * from finish();
rollback;
