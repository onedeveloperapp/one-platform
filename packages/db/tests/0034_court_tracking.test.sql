begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- The course of a lawsuit, read from the court (0031). Every lawsuit filed
-- with a number owes its reading, from TJGO's Projudi or from an aggregator
-- by its number; the backend claims and records it, each movement once; what
-- the firm did not see yet is counted until a person says they saw it. Two
-- firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('af100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@andamento.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('af100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@andamento.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('af100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@andamento.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('af100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@andamento.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('bf100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-andamento', 'af100000-0000-4000-8000-000000000001'),
  ('bf100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-andamento', 'af100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bf100000-0000-4000-8000-00000000000b', 'af100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.tracking_of(lawsuit text) returns public.proceeding_tracking language sql as
$$ select * from public.proceeding_tracking where proceeding_id = pg_temp.got(lawsuit, 'proceeding_id')::uuid; $$;
create function pg_temp.today(org uuid, field text) returns text language sql as
$$ select public.firm_today(org) ->> field; $$;

-- Firm A: a lawsuit of TJGO, one of TJSP, and one still planned. Firm B: one of TJGO.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-07-20',
  '{"full_name": "Maria Teste", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('go', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000123-60.2099.8.09.0051", "filed_at": "2026-08-03"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
insert into res values ('sp', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJSP", "system": "esaj", "status": "filed", "cnj": "1000234-88.2099.8.26.0100", "filed_at": "2026-08-04"}'::jsonb));
insert into res values ('planned', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "system": "projudi"}'::jsonb));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bf100000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-07-20',
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('go_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000789-61.2099.8.09.0051", "filed_at": "2026-08-03"}'::jsonb,
  array[pg_temp.got('case_b', 'party_id')::uuid]));
reset role;

select ok(
  (select source = 'projudi' and status = 'waiting' and cnj = '50001236020998090051' and next_read_at <= now()
   from pg_temp.tracking_of('go'))
  and (select source = 'aggregator' and status = 'waiting' from pg_temp.tracking_of('sp'))
  and (select count(*) = 0 from public.proceeding_tracking where proceeding_id = pg_temp.got('planned', 'proceeding_id')::uuid)
  and (select org_id = 'bf100000-0000-4000-8000-00000000000b' from pg_temp.tracking_of('go_b')),
  'a lawsuit filed with a number owes its reading, from Projudi for TJGO''s and an aggregator for the others; a planned one none'
);

-- ---------- The backend's half ----------

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim1', to_jsonb(c) from public.claim_proceeding_reads(array['projudi'], 10, false,
  (select id from pg_temp.tracking_of('go'))) c;
insert into res select 'claim_sources', jsonb_build_object('n', count(*))
  from public.claim_proceeding_reads(array['projudi'], 10, false, (select id from pg_temp.tracking_of('sp')));
-- The first reading: a history, not news.
insert into res values ('first', public.record_proceeding_read((select id from pg_temp.tracking_of('go')),
  pg_temp.got('claim1', 'claim')::integer, 'read',
  '{"number": "5000123-60.2099.8.09.0051", "unit": "Goiânia - 3º Juizado Especial Cível", "status": "Ativo"}'::jsonb,
  '[{"id": "900000001", "at": "2026-08-03T20:36:41.000Z", "title": "Petição Enviada", "detail": null, "by": "ANA TESTE"},
    {"id": "900000002", "at": "2026-08-03T20:36:42.000Z", "title": "Processo Distribuído", "detail": "3º Juizado", "by": "SISTEMA PROJUDI"}]'::jsonb));
reset role;
select ok(
  pg_temp.got('claim1', 'first_read') = 'true' and pg_temp.got('claim1', 'cnj') = '50001236020998090051'
  and pg_temp.got('claim_sources', 'n') = '0'
  and pg_temp.got('first', 'learned') = '2'
  and (select status = 'tracked' and movements_count = 2 and seen_until = read_at and next_read_at > now() + interval '23 hours'
              and snapshot ->> 'unit' = 'Goiânia - 3º Juizado Especial Cível' and work_claimed_at is null
       from pg_temp.tracking_of('go'))
  and (select count(*) = 0 from public.case_events where kind = 'court_moved'),
  'the backend claims the readings of the sources it reads, and the first keeps the lawsuit''s history as no news'
);

-- The next reading: one movement more, and an answer that is not whole refused.
-- (The test runs in one transaction, at one moment: the first reading is set a day back.)
update public.movements set learned_at = learned_at - interval '1 day' where proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid;
update public.proceeding_tracking set read_at = read_at - interval '1 day', seen_until = seen_until - interval '1 day'
where id = (select id from pg_temp.tracking_of('go'));
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('go'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim2', to_jsonb(c) from public.claim_proceeding_reads(array['projudi', 'aggregator'], 10, false,
  (select id from pg_temp.tracking_of('go'))) c;
insert into res values ('bad', public.record_proceeding_read((select id from pg_temp.tracking_of('go')),
  pg_temp.got('claim2', 'claim')::integer, 'read', '{"number": "x"}'::jsonb,
  '[{"id": "900000003", "at": "ontem", "title": "Decisão"}]'::jsonb));
insert into res values ('second', public.record_proceeding_read((select id from pg_temp.tracking_of('go')),
  pg_temp.got('claim2', 'claim')::integer, 'read', '{"number": "5000123-60.2099.8.09.0051", "status": "Ativo"}'::jsonb,
  '[{"id": "900000001", "at": "2026-08-03T20:36:41.000Z", "title": "Petição Enviada"},
    {"id": "900000002", "at": "2026-08-03T20:36:42.000Z", "title": "Processo Distribuído"},
    {"id": "900000003", "at": "2026-08-10T18:46:42.000Z", "title": "Decisão -> Outras Decisões", "detail": "Recebe inicial"}]'::jsonb));
-- A worker whose claim is not the latest writes nothing.
insert into res values ('late', public.record_proceeding_read((select id from pg_temp.tracking_of('go')),
  pg_temp.got('claim1', 'claim')::integer, 'not_found'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('today_a', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('claim2', 'first_read') = 'false' and pg_temp.got('bad', 'code') = 'invalid_data'
  and pg_temp.got('second', 'learned') = '1' and pg_temp.got('late', 'code') = 'not_working'
  and (select movements_count = 3 and last_movement_at = '2026-08-10T18:46:42Z'::timestamptz and status = 'tracked'
       from pg_temp.tracking_of('go'))
  and (select count(*) = 3 from public.movements where proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'court_moved' and data ->> 'count' = '1')
  and pg_temp.got('today_a', 'movements_new') = '1'
  and (select unseen_count = 1 from pg_temp.tracking_of('go')),
  'each movement is kept once, the new one told in the case and counted for the firm; a late worker and a broken answer write nothing'
);

-- A person says they saw it.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('seen', public.acknowledge_proceeding_movements(pg_temp.got('go', 'proceeding_id')::uuid));
insert into res values ('today_seen', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('seen', 'code') = 'seen' and pg_temp.got('today_seen', 'movements_new') = '0'
  and (select unseen_count = 0 from pg_temp.tracking_of('go'))
  and (select count(*) = 1 from public.audit_events where action = 'proceedings.movements_seen'
       and entity_id = pg_temp.got('go', 'proceeding_id')),
  'a person of the firm says they saw what the court did, and that is on record'
);

-- ---------- What a person asks ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask', public.request_proceeding_read(pg_temp.got('sp', 'proceeding_id')::uuid));
insert into res values ('ask_again', public.request_proceeding_read(pg_temp.got('sp', 'proceeding_id')::uuid));
insert into res values ('ask_planned', public.request_proceeding_read(pg_temp.got('planned', 'proceeding_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
-- Out of a source's hours, only what a person asked is claimed.
insert into res select 'asked_only', jsonb_build_object('ids', jsonb_agg(c.tracking_id), 'n', count(*))
  from public.claim_proceeding_reads(array['projudi', 'aggregator'], 10, true) c;
reset role;
select ok(
  pg_temp.got('ask', 'source') = 'aggregator' and pg_temp.got('ask_again', 'code') = 'read_cooldown'
  and pg_temp.got('ask_planned', 'code') = 'not_tracked'
  and pg_temp.got('asked_only', 'n') = '1'
  and (select payload -> 'ids' ->> 0 = (select id::text from pg_temp.tracking_of('sp')) from res where name = 'asked_only')
  and (select count(*) = 1 from public.audit_events where action = 'proceedings.read_requested'),
  'a person asks for a reading now, once in a while; it goes first, and alone when the routine waits for its hours'
);

-- What the source says of it: not found, then no answer until given up; a person asks again.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('missing', public.record_proceeding_read((select id from pg_temp.tracking_of('sp')),
  (select work_claims from pg_temp.tracking_of('sp')), 'not_found'));
reset role;
insert into res select 'after_missing', jsonb_build_object(
  'status', status, 'later', next_read_at > now() + interval '71 hours', 'read', checked_at is not null and read_at is null)
  from pg_temp.tracking_of('sp');
update public.platform_settings set value = value || '{"max_attempts": 2}'::jsonb where key = 'tracking';
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('sp'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'c3', to_jsonb(c) from public.claim_proceeding_reads(array['aggregator'], 10, false,
  (select id from pg_temp.tracking_of('sp'))) c;
insert into res values ('retry', public.record_proceeding_read((select id from pg_temp.tracking_of('sp')),
  pg_temp.got('c3', 'claim')::integer, 'retry', null, null, 'aggregator_http_503'));
reset role;
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('sp'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'c4', to_jsonb(c) from public.claim_proceeding_reads(array['aggregator'], 10, false,
  (select id from pg_temp.tracking_of('sp'))) c;
insert into res values ('given_up', public.record_proceeding_read((select id from pg_temp.tracking_of('sp')),
  pg_temp.got('c4', 'claim')::integer, 'retry', null, null, 'aggregator_http_503'));
reset role;
insert into res select 'after_given_up', jsonb_build_object('asked', requested_at is not null) from pg_temp.tracking_of('sp');
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today_failed', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
update public.proceeding_tracking set requested_at = now() - interval '2 hours' where id = (select id from pg_temp.tracking_of('sp'));
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask_failed', public.request_proceeding_read(pg_temp.got('sp', 'proceeding_id')::uuid));
reset role;
select ok(
  pg_temp.got('missing', 'code') = 'not_found' and pg_temp.got('after_missing', 'status') = 'not_found'
  and pg_temp.got('after_missing', 'later') = 'true' and pg_temp.got('after_missing', 'read') = 'true'
  and pg_temp.got('retry', 'code') = 'retry' and pg_temp.got('given_up', 'code') = 'failed'
  and pg_temp.got('today_failed', 'tracking_failed') = '1' and pg_temp.got('after_given_up', 'asked') = 'false'
  and pg_temp.got('ask_failed', 'ok') = 'true'
  and (select status = 'waiting' and work_attempts = 0 and work_error is null from pg_temp.tracking_of('sp')),
  'a lawsuit the source does not show is asked again later; one with no answer is given up, and a person asks again'
);

-- The aggregator refused the platform's key: the lawsuit's attempt is given back, and it is asked again later.
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('sp'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'c5', to_jsonb(c) from public.claim_proceeding_reads(array['aggregator'], 10, false,
  (select id from pg_temp.tracking_of('sp'))) c;
insert into res values ('released', public.record_proceeding_read((select id from pg_temp.tracking_of('sp')),
  pg_temp.got('c5', 'claim')::integer, 'release', null, null, 'escavador_key_refused'));
reset role;
select ok(
  pg_temp.got('released', 'code') = 'release'
  and (select status = 'waiting' and work_attempts = 0 and work_claimed_at is null and work_error = 'escavador_key_refused'
              and next_read_at > now() + interval '59 minutes' from pg_temp.tracking_of('sp')),
  'a refused key or a balance run out spends no attempt of the lawsuit, which is asked again later'
);

-- A lawsuit in secret: the court shows nothing of its course.
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('go_b'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'cb', to_jsonb(c) from public.claim_proceeding_reads(array['projudi'], 10, false,
  (select id from pg_temp.tracking_of('go_b'))) c;
insert into res values ('secret', public.record_proceeding_read((select id from pg_temp.tracking_of('go_b')),
  pg_temp.got('cb', 'claim')::integer, 'secret', '{"number": "5000789-61.2099.8.09.0051", "secret": true}'::jsonb));
reset role;
select ok(
  pg_temp.got('secret', 'code') = 'secret'
  and (select status = 'secret' and movements_count = 0 and next_read_at > now() from pg_temp.tracking_of('go_b')),
  'a lawsuit in secret is said so, and read again in its time'
);

-- ---------- Another aggregator, and a case that ended ----------

update public.proceeding_tracking set next_read_at = now(), status = 'waiting' where id = (select id from pg_temp.tracking_of('sp'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'c6', to_jsonb(c) from public.claim_proceeding_reads(array['aggregator'], 10, false,
  (select id from pg_temp.tracking_of('sp'))) c;
insert into res values ('by_escavador', public.record_proceeding_read((select id from pg_temp.tracking_of('sp')),
  pg_temp.got('c6', 'claim')::integer, 'read', '{"number": "1000234-88.2099.8.26.0100"}'::jsonb,
  '[{"id": "e1", "at": "2026-08-04T15:00:00.000Z", "title": "Distribuído"}]'::jsonb, null, 'escavador'));
reset role;
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('sp'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'c7', to_jsonb(c) from public.claim_proceeding_reads(array['aggregator'], 10, false,
  (select id from pg_temp.tracking_of('sp'))) c;
insert into res values ('by_judit', public.record_proceeding_read((select id from pg_temp.tracking_of('sp')),
  pg_temp.got('c7', 'claim')::integer, 'read', '{"number": "1000234-88.2099.8.26.0100"}'::jsonb,
  '[{"id": "j-1", "at": "2026-08-04T15:00:00.000Z", "title": "Distribuído"},
    {"id": "j-2", "at": "2026-08-20T15:00:00.000Z", "title": "Citação"}]'::jsonb, null, 'judit'));
reset role;
select ok(
  pg_temp.got('c7', 'first_read') = 'false'
  and (select vendor = 'judit' and movements_count = 2 and unseen_count = 0 and seen_until is not null from pg_temp.tracking_of('sp'))
  and (select count(*) = 0 from public.movements where proceeding_id = pg_temp.got('sp', 'proceeding_id')::uuid and source_id = 'e1')
  and (select count(*) = 0 from public.case_events where kind = 'court_moved' and data ->> 'source' = 'judit'),
  'another aggregator is another copy: what the one before read goes, and its first reading is no news'
);

-- Firm B's case ends: its lawsuit is not read any more.
update public.cases set status = 'closed', closed_at = now() where id = pg_temp.got('case_b', 'case_id')::uuid;
update public.proceeding_tracking set next_read_at = now() where id = (select id from pg_temp.tracking_of('go_b'));
select pg_temp.as_backend();
set local role service_role;
insert into res select 'ended', jsonb_build_object('n', count(*))
  from public.claim_proceeding_reads(array['projudi'], 10, false, (select id from pg_temp.tracking_of('go_b'))) c;
reset role;
select ok(pg_temp.got('ended', 'n') = '0', 'a lawsuit of a case that ended is not read');

-- ---------- A lawsuit's number and state ----------

-- Another number is another lawsuit: what was read of the old one goes. Closed, it is not read; filed again, it is.
update public.proceedings set cnj = '50004561220998090051' where id = pg_temp.got('go', 'proceeding_id')::uuid;
insert into res select 'renumbered', jsonb_build_object(
  'tracking', (select status = 'waiting' and cnj = '50004561220998090051' and movements_count = 0 and snapshot is null
                      and read_at is null and seen_until is null from pg_temp.tracking_of('go')),
  'movements', (select count(*) from public.movements where proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid));
update public.proceeding_tracking set unseen_count = 2 where id = (select id from pg_temp.tracking_of('go'));
update public.proceedings set status = 'closed' where id = pg_temp.got('go', 'proceeding_id')::uuid;
insert into res select 'closed', jsonb_build_object('status', status, 'next', next_read_at, 'unseen', unseen_count)
  from pg_temp.tracking_of('go');
update public.proceedings set status = 'filed' where id = pg_temp.got('go', 'proceeding_id')::uuid;
select ok(
  pg_temp.got('renumbered', 'tracking') = 'true' and pg_temp.got('renumbered', 'movements') = '0'
  and pg_temp.got('closed', 'status') = 'off' and pg_temp.got('closed', 'next') is null
  and pg_temp.got('closed', 'unseen') = '0'
  and (select status = 'waiting' and next_read_at <= now() from pg_temp.tracking_of('go')),
  'a number corrected starts the reading over; a lawsuit closed is not read, and one filed again is'
);

-- ---------- Two firms ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('seen_b', jsonb_build_object(
  'tracking', (select count(*) from public.proceeding_tracking where org_id = 'bf100000-0000-4000-8000-00000000000a'),
  'movements', (select count(*) from public.movements where org_id = 'bf100000-0000-4000-8000-00000000000a'),
  'mine', (select count(*) from public.proceeding_tracking where org_id = 'bf100000-0000-4000-8000-00000000000b')));
select throws_ok(
  format('select public.request_proceeding_read(%L)', pg_temp.got('sp', 'proceeding_id')),
  'P0002', 'case_not_found', 'nobody asks for the reading of a lawsuit of another firm'
);
select throws_ok(
  format('select public.acknowledge_proceeding_movements(%L)', pg_temp.got('sp', 'proceeding_id')),
  'P0002', 'case_not_found', 'nobody says they saw the course of a lawsuit of another firm'
);
reset role;
select ok(
  pg_temp.got('seen_b', 'tracking') = '0' and pg_temp.got('seen_b', 'movements') = '0' and pg_temp.got('seen_b', 'mine') = '1',
  'a firm reads the course of its own lawsuits and nothing of another'
);

-- ---------- Who may write ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.record_proceeding_read(%L, 1, %L)', (select id from pg_temp.tracking_of('sp')), 'not_found'),
  '42501', null, 'a member never records a reading'
);
select throws_ok(
  $$select * from public.claim_proceeding_reads(array['projudi'])$$,
  '42501', null, 'a member never claims a reading'
);
select throws_ok(
  format($$insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title)
           values (%L, %L, %L, 'projudi', 'x1', now(), 'Inventado')$$,
         'bf100000-0000-4000-8000-00000000000a', pg_temp.got('case_a', 'case_id'), pg_temp.got('go', 'proceeding_id')),
  '42501', null, 'a member never writes a movement'
);
reset role;

-- A support visit asks for nothing and sees nothing in the firm's name.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('af100000-0000-4000-8000-000000000009', 'af100000-0000-4000-8000-000000000002', 'bf100000-0000-4000-8000-00000000000a',
        'Conferindo o andamento', 'ff100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002', 'ff100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.request_proceeding_read(%L)', pg_temp.got('go', 'proceeding_id')),
  '42501', 'not_allowed_in_support_session', 'a support visit asks for no reading'
);
reset role;

select * from finish();
rollback;
