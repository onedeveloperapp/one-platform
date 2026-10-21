begin;
create extension if not exists pgtap;
select plan(26);

-- ============================================================
-- The hearings (0037). Who signs or runs the firm's deadlines writes a
-- hearing of a lawsuit the court has, in the zone it is said in (the
-- court's, or the one the person says for a court whose comarcas keep more
-- than one), and says what came of it; the backend writes each one to the
-- firm's calendar in Google, a revision at a time, claimed by number, takes
-- out the events of hearings that went, and a calendar that stopped by
-- itself is said to the firm (one a person turned off is not). Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of a year
-- to come.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ab100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@audiencia.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ab100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@audiencia.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ab100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@audiencia.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('ab100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@audiencia.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('bb100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-audiencias', 'ab100000-0000-4000-8000-000000000001'),
  ('bb100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-audiencias', 'ab100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bb100000-0000-4000-8000-00000000000a', 'ab100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bb100000-0000-4000-8000-00000000000a', 'ab100000-0000-4000-8000-000000000002', 'member', 'controladoria'),
  ('bb100000-0000-4000-8000-00000000000a', 'ab100000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('bb100000-0000-4000-8000-00000000000b', 'ab100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hearing(name text) returns public.hearings language sql as
$$ select * from public.hearings where id = pg_temp.got(name, 'id')::uuid; $$;
-- A day this many days from today, as a person types it.
create function pg_temp.day(offset_days integer) returns text language sql as
$$ select to_char(current_date + offset_days, 'YYYY-MM-DD'); $$;
-- The claim a round took of a hearing.
create function pg_temp.claim_of(round text, hearing text) returns integer language sql as
$$ select (res.payload -> 'map' ->> pg_temp.got(claim_of.hearing, 'id'))::integer from res where res.name = claim_of.round; $$;

-- Firm A: a case with two lawsuits filed in TJGO, one in TJAM, one still planned. Firm B: a lawsuit in TJGO.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('bb100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "Maria Teste", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('go', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "comarca": "Goiânia", "status": "filed", "cnj": "5000401-61.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
insert into res values ('go2', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "comarca": "Goiânia", "status": "filed", "cnj": "5000405-98.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
insert into res values ('am', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJAM", "system": "projudi", "comarca": "Manaus", "status": "filed", "cnj": "5000403-25.2099.8.04.0001", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
insert into res values ('planned', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "system": "projudi"}'::jsonb));
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bb100000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-01-20',
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('go_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000404-16.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_b', 'party_id')::uuid]));
reset role;

-- A publication of the lawsuit in Goiás that set a hearing, and one of another lawsuit.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, category, triaged_by, triaged_at) values
  ('cb100000-0000-4000-8000-000000000001', 'bb100000-0000-4000-8000-00000000000a', 'audienciahash0001', 'TJGO', '50004016120998090051',
   current_date - 1, 'Intimação', 'Designada audiência de conciliação.', 'audiencia', 'ab100000-0000-4000-8000-000000000001', now()),
  ('cb100000-0000-4000-8000-000000000002', 'bb100000-0000-4000-8000-00000000000a', 'audienciahash0002', 'TJSP', '10002348820998260100',
   current_date - 1, 'Intimação', 'Intime-se.', 'audiencia', 'ab100000-0000-4000-8000-000000000001', now());

-- ---------- The zones, and what nobody writes but through the functions ----------

select ok(
  (select time_zone = 'America/Sao_Paulo' and other_zones = '{}' from public.courts where acronym = 'TJGO')
  and (select time_zone = 'America/Manaus' and other_zones = array['America/Eirunepe'] from public.courts where acronym = 'TJAM')
  and (select time_zone = 'America/Sao_Paulo' and other_zones = array['America/Noronha'] from public.courts where acronym = 'TJPE')
  and (select time_zone = 'America/Rio_Branco' from public.courts where acronym = 'TJAC')
  and (select time_zone = 'America/Cuiaba' from public.courts where acronym = 'TJMT')
  and public.hearing_zone_ok('America/Eirunepe') and not public.hearing_zone_ok('Europe/Lisbon')
  and not public.hearing_zone_ok('America/Atlantida'),
  'each court has the zone of its state and the ones of comarcas that keep another, and a hearing is said in a zone of Brazil'
);

select ok(
  not has_table_privilege('authenticated', 'public.hearings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.hearings', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.firm_calendars', 'INSERT')
  and has_table_privilege('authenticated', 'public.hearings', 'SELECT')
  and not has_table_privilege('authenticated', 'public.hearing_event_removals', 'SELECT')
  and not has_function_privilege('authenticated', 'public.claim_hearing_syncs(integer, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_hearing_sync(uuid, integer, integer, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_hearing_removals(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_hearing_removal(uuid, integer, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_firm_calendar(uuid, uuid, text, text, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_hearing(uuid, uuid, jsonb)', 'EXECUTE'),
  'a session reads the hearings and writes none of them, nor of the calendar, but through the functions'
);

-- ---------- Writing a hearing ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', pg_temp.day(30), 'time', '14:00')));
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('h1', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', pg_temp.day(30), 'time', '14:00',
    'link', 'https://videoconferencia.invalid/sala-7', 'attendee_user_id', 'ab100000-0000-4000-8000-000000000001',
    'publication_id', 'cb100000-0000-4000-8000-000000000001')));
-- The court of Amazonas has comarcas in two zones: with none said, which one is never guessed.
insert into res values ('am_unsaid', public.save_hearing(null, pg_temp.got('am', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(40), 'time', '10:00', 'place', 'Fórum de Manaus, sala 3')));
insert into res values ('h_am', public.save_hearing(null, pg_temp.got('am', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(40), 'time', '10:00', 'time_zone', 'America/Manaus',
    'place', 'Fórum de Manaus, sala 3', 'attendee_name', 'Correspondente Teste')));
insert into res values ('h_west', public.save_hearing(null, pg_temp.got('am', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'instrucao', 'mode', 'hibrida', 'day', pg_temp.day(41), 'time', '10:00',
    'time_zone', 'America/Eirunepe', 'link', 'https://videoconferencia.invalid/sala-9')));
insert into res values ('dup', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.day(30), 'time', '14:00')));
insert into res values ('from_planned', public.save_hearing(null, pg_temp.got('planned', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.day(30), 'time', '09:00')));
insert into res values ('bad_kind', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'julgamento', 'mode', 'presencial', 'day', pg_temp.day(31), 'time', '09:00')));
insert into res values ('bad_time', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(31), 'time', '25:00')));
insert into res values ('bad_day', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(900), 'time', '09:00')));
insert into res values ('bad_link', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'videoconferencia', 'day', pg_temp.day(31), 'time', '09:00', 'link', 'http://sala.invalid')));
insert into res values ('bad_zone', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(31), 'time', '09:00', 'time_zone', 'Europe/Lisbon')));
insert into res values ('bad_attendee', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(31), 'time', '09:00',
    'attendee_user_id', 'ab100000-0000-4000-8000-000000000004')));
insert into res values ('bad_publication', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(31), 'time', '09:00',
    'publication_id', 'cb100000-0000-4000-8000-000000000002')));
-- Words typed past the length a hearing keeps are cut, and what is cut is trimmed again.
insert into res values ('long_place', public.save_hearing(null, pg_temp.got('go2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(33), 'time', '09:00',
    'place', repeat('a', 299) || ' fim')));
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_other', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(31), 'time', '09:00')));
reset role;

select ok(
  pg_temp.got('caio', 'code') = 'not_allowed' and pg_temp.got('h1', 'code') = 'scheduled'
  and pg_temp.got('h_am', 'code') = 'scheduled' and pg_temp.got('h_west', 'code') = 'scheduled'
  and pg_temp.got('dup', 'code') = 'duplicate' and pg_temp.got('from_planned', 'code') = 'not_filed'
  and pg_temp.got('bad_kind', 'field') = 'kind' and pg_temp.got('bad_time', 'field') = 'time'
  and pg_temp.got('bad_day', 'field') = 'day' and pg_temp.got('bad_link', 'field') = 'link'
  and pg_temp.got('bad_zone', 'field') = 'time_zone' and pg_temp.got('bad_attendee', 'field') = 'attendee_user_id'
  and pg_temp.got('bad_publication', 'field') = 'publication_id' and pg_temp.got('davi_other', 'code') = 'not_found'
  and pg_temp.got('h1', 'calendar') = 'false',
  'who signs or runs the deadlines writes a hearing of a filed lawsuit of their firm, once per moment, with what it needs'
);

select ok(
  pg_temp.got('am_unsaid', 'code') = 'zone_required' and pg_temp.got('am_unsaid', 'field') = 'time_zone'
  and pg_temp.got('long_place', 'code') = 'scheduled'
  and (select place = repeat('a', 299) from pg_temp.hearing('long_place')),
  'a court with comarcas in more than one zone has the person say which, and long words are cut and trimmed'
);

select ok(
  (select starts_at = ((current_date + 30) + time '14:00') at time zone 'America/Sao_Paulo'
          and time_zone = 'America/Sao_Paulo' and source = 'publication'
          and publication_id = 'cb100000-0000-4000-8000-000000000001' and revision = 1 and synced_revision is null
          and case_id = pg_temp.got('case_a', 'case_id')::uuid
   from pg_temp.hearing('h1'))
  -- Ten in Manaus is eleven in Brasília; ten in the west of Amazonas, noon.
  and (select (starts_at at time zone 'America/Sao_Paulo')::time = time '11:00' and time_zone = 'America/Manaus'
       from pg_temp.hearing('h_am'))
  and (select (starts_at at time zone 'America/Sao_Paulo')::time = time '12:00' and time_zone = 'America/Eirunepe'
       from pg_temp.hearing('h_west'))
  and (select count(*) = 4 from public.audit_events where action = 'hearing.scheduled')
  and (select count(*) = 4 from public.case_events where kind = 'hearing_scheduled' and actor_type = 'person'),
  'a hearing is kept as the moment it is, in the zone it is said in, with where it came from, on the record'
);

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ab100000-0000-4000-8000-000000000004', 'ab100000-0000-4000-8000-000000000001', 'bb100000-0000-4000-8000-00000000000a',
        'Conferindo a agenda', 'fb100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.save_hearing(null, (select id from public.proceedings where cnj = '50004016120998090051'),
      jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', to_char(current_date + 50, 'YYYY-MM-DD'), 'time', '09:00'))$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit writes no hearing'
);
reset role;

-- ---------- Changing it, and what came of it ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('same', public.save_hearing(pg_temp.got('h1', 'id')::uuid, null,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', pg_temp.day(30), 'time', '14:00',
    'link', 'https://videoconferencia.invalid/sala-7', 'attendee_user_id', 'ab100000-0000-4000-8000-000000000001')));
insert into res values ('moved', public.save_hearing(pg_temp.got('h1', 'id')::uuid, null,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', pg_temp.day(30), 'time', '15:30',
    'link', 'https://videoconferencia.invalid/sala-7', 'attendee_user_id', 'ab100000-0000-4000-8000-000000000001')));
insert into res values ('held_early', public.set_hearing_status(pg_temp.got('h1', 'id')::uuid, 'held', 'acordo', null));
insert into res values ('cancel_bare', public.set_hearing_status(pg_temp.got('h_west', 'id')::uuid, 'cancelled', null, 'curto'));
insert into res values ('cancel', public.set_hearing_status(pg_temp.got('h_west', 'id')::uuid, 'cancelled', null,
  'Redesignada pelo juízo para outro dia.'));
insert into res values ('edit_cancelled', public.save_hearing(pg_temp.got('h_west', 'id')::uuid, null,
  jsonb_build_object('kind', 'instrucao', 'mode', 'hibrida', 'day', pg_temp.day(42), 'time', '10:00', 'time_zone', 'America/Eirunepe')));
-- A hearing of two days ago, held, with a settlement.
insert into res values ('h_past', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.day(-2), 'time', '09:00', 'place', 'Fórum de Goiânia')));
insert into res values ('held', public.set_hearing_status(pg_temp.got('h_past', 'id')::uuid, 'held', 'acordo', 'Acordo homologado.'));
-- And one of five days ago nobody said anything of.
insert into res values ('h_silent', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(-5), 'time', '09:00')));
reset role;

select ok(
  pg_temp.got('same', 'code') = 'unchanged' and pg_temp.got('moved', 'code') = 'updated'
  and (select revision = 2 and (starts_at at time zone 'America/Sao_Paulo')::time = time '15:30' from pg_temp.hearing('h1'))
  and pg_temp.got('held_early', 'field') = 'outcome'
  and pg_temp.got('cancel_bare', 'code') = 'reason_required' and pg_temp.got('cancel', 'code') = 'cancelled'
  and (select status = 'cancelled' and outcome_note = 'Redesignada pelo juízo para outro dia.' and revision = 2
       from pg_temp.hearing('h_west'))
  and pg_temp.got('edit_cancelled', 'code') = 'closed'
  and pg_temp.got('held', 'code') = 'held'
  and (select status = 'held' and outcome = 'acordo' from pg_temp.hearing('h_past'))
  and (select count(*) = 1 from public.case_events where kind = 'hearing_held')
  and (select count(*) = 1 from public.case_events where kind = 'hearing_cancelled'),
  'a hearing still to happen is changed, held once its time came, or cancelled with why; a cancelled one is no longer changed'
);

-- ---------- What the firm reads ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('next', public.firm_hearings('bb100000-0000-4000-8000-00000000000a', 'proximas'));
insert into res values ('silent', public.firm_hearings('bb100000-0000-4000-8000-00000000000a', 'sem_resultado'));
insert into res values ('today_a', public.firm_today('bb100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  (select payload -> 'counts' = '{"proximas": 3, "em_breve": 0, "sem_resultado": 1, "realizadas": 1, "canceladas": 1}'::jsonb
          and payload ->> 'duration_minutes' = '60'
          and payload -> 'rows' -> 0 ->> 'id' = pg_temp.got('h1', 'id')
          and payload -> 'rows' -> 0 ->> 'client_name' = 'Maria Teste'
          and payload -> 'rows' -> 0 ->> 'cnj' = '50004016120998090051'
          and payload -> 'rows' -> 0 -> 'calendar_state' = 'null'::jsonb and payload -> 'calendar' = 'null'::jsonb
   from res where name = 'next')
  and (select (payload ->> 'total')::integer = 1 and payload -> 'rows' -> 0 ->> 'id' = pg_temp.got('h_silent', 'id')
       from res where name = 'silent')
  and pg_temp.got('today_a', 'hearings_soon') = '0' and pg_temp.got('today_a', 'hearings_unresolved') = '1'
  and pg_temp.got('today_a', 'calendar_lost') = '0',
  'anybody of the firm reads the hearings to come, the ones with no word on them, and the home counts them'
);

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.hearings where org_id = 'bb100000-0000-4000-8000-00000000000a'),
  'another firm reads none of the hearings'
);
select throws_ok($$select public.firm_hearings('bb100000-0000-4000-8000-00000000000a', 'proximas')$$, '42501', 'not_authorized',
  'nor lists them');
select throws_ok($$select public.firm_hearings('bb100000-0000-4000-8000-00000000000b', 'todas')$$, '22023', 'invalid_view',
  'and a list that does not exist is refused');
reset role;

-- ---------- The calendar ----------

insert into public.connections (id, org_id, provider, label, status) values
  ('db100000-0000-4000-8000-00000000000a', 'bb100000-0000-4000-8000-00000000000a', 'google_calendar', 'Google Agenda', 'connected'),
  ('db100000-0000-4000-8000-00000000000c', 'bb100000-0000-4000-8000-00000000000a', 'zapsign', 'ZapSign', 'connected');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('cal_other', public.record_firm_calendar('bb100000-0000-4000-8000-00000000000a',
  'db100000-0000-4000-8000-00000000000c', 'agenda-0@group.calendar.invalid', 'Audiências', 'ab100000-0000-4000-8000-000000000001'));
insert into res values ('cal', public.record_firm_calendar('bb100000-0000-4000-8000-00000000000a',
  'db100000-0000-4000-8000-00000000000a', 'agenda-1@group.calendar.invalid', 'Audiências · Souza Advogados',
  'ab100000-0000-4000-8000-000000000001'));
insert into res select 'claims', jsonb_build_object('map', jsonb_object_agg(c.hearing_id::text, c.claim)) from public.claim_hearing_syncs(20) c;
insert into res values ('read1', public.hearing_to_sync(pg_temp.got('h1', 'id')::uuid, pg_temp.claim_of('claims', 'h1')));
insert into res values ('synced1', public.record_hearing_sync(pg_temp.got('h1', 'id')::uuid, pg_temp.claim_of('claims', 'h1'), 2,
  'agenda-1@group.calendar.invalid', 'synced'));
select public.record_hearing_sync(pg_temp.got('long_place', 'id')::uuid, pg_temp.claim_of('claims', 'long_place'), 1,
  'agenda-1@group.calendar.invalid', 'synced');
reset role;

-- The hearings to come, the one held two days ago and the one nobody said anything of are owed their event; the
-- one cancelled before any calendar had it is not.
select ok(
  pg_temp.got('cal_other', 'code') = 'not_connected' and pg_temp.got('cal', 'code') = 'recorded'
  and (select array_agg(k order by k) = array(select unnest(array[pg_temp.got('h1', 'id'), pg_temp.got('h_am', 'id'),
         pg_temp.got('h_past', 'id'), pg_temp.got('h_silent', 'id'), pg_temp.got('long_place', 'id')]) order by 1)
       from res, jsonb_object_keys(payload -> 'map') k where name = 'claims')
  and pg_temp.got('read1', 'calendar_id') = 'agenda-1@group.calendar.invalid'
  and pg_temp.got('read1', 'attendee') = 'Ana Souza'
  -- Nobody of the case goes to a calendar that is shared and shows on phones.
  and (select not (payload ? 'client_name') from res where name = 'read1')
  and pg_temp.got('read1', 'duration_minutes') = '60' and pg_temp.got('read1', 'revision') = '2'
  and pg_temp.got('synced1', 'code') = 'synced'
  and (select synced_revision = 2 and synced_calendar = 'agenda-1@group.calendar.invalid' and sync_claimed_at is null
       from pg_temp.hearing('h1')),
  'a calendar recorded for the firm (of a calendar connection only) is owed the event of each hearing, written by the revision read'
);

-- A hearing changed while its event was written, and one the provider keeps refusing.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
-- Changed with no zone said: it keeps its own.
insert into res values ('am_edit', public.save_hearing(pg_temp.got('h_am', 'id')::uuid, null,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(40), 'time', '11:00', 'place', 'Fórum de Manaus, sala 3',
    'attendee_name', 'Correspondente Teste')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('late', public.record_hearing_sync(pg_temp.got('h_am', 'id')::uuid, pg_temp.claim_of('claims', 'h_am'), 1,
  'agenda-1@group.calendar.invalid', 'synced'));
-- A worker that could not read the grant gives the claim of the silent one back.
insert into res values ('released', public.record_hearing_sync(pg_temp.got('h_silent', 'id')::uuid,
  pg_temp.claim_of('claims', 'h_silent'), 1, null, 'release'));
insert into res values ('retry_past', public.record_hearing_sync(pg_temp.got('h_past', 'id')::uuid,
  pg_temp.claim_of('claims', 'h_past'), 2, 'agenda-1@group.calendar.invalid', 'failed', 'Invalid Request'));
reset role;
select ok(
  pg_temp.got('am_edit', 'code') = 'updated' and pg_temp.got('am_edit', 'calendar') = 'true'
  and (select time_zone = 'America/Manaus' from pg_temp.hearing('h_am'))
  and pg_temp.got('late', 'code') = 'changed'
  -- The calendar may hold an event of it now: known, and written again at the revision in force.
  and (select revision = 2 and synced_revision is null and synced_calendar = 'agenda-1@group.calendar.invalid'
              and sync_claimed_at is null and sync_attempts = 0 from pg_temp.hearing('h_am'))
  and pg_temp.got('retry_past', 'code') = 'failed'
  and (select sync_error = 'invalid' and sync_attempts = 5 from pg_temp.hearing('h_past'))
  and pg_temp.got('released', 'code') = 'released'
  and (select sync_claimed_at is null and sync_attempts = 0 and sync_retry_after > now() from pg_temp.hearing('h_silent')),
  'an event written from a revision no longer in force is written again, and one the provider refuses waits for a person'
);

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_retry', public.retry_hearing_syncs('bb100000-0000-4000-8000-00000000000a'));
insert into res values ('failed_list', public.firm_hearings('bb100000-0000-4000-8000-00000000000a', 'realizadas'));
insert into res values ('cancelled_list', public.firm_hearings('bb100000-0000-4000-8000-00000000000a', 'canceladas'));
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_retry', public.retry_hearing_syncs('bb100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  (select payload -> 'rows' -> 0 ->> 'calendar_state' = 'failed' and payload ->> 'calendar_failed' = '1'
   from res where name = 'failed_list')
  -- Cancelled before any calendar had it: nothing of it is or will be there.
  and (select payload -> 'rows' -> 0 -> 'calendar_state' = 'null'::jsonb from res where name = 'cancelled_list')
  and pg_temp.got('caio_retry', 'code') = 'not_allowed'
  and pg_temp.got('bia_retry', 'code') = 'retried' and pg_temp.got('bia_retry', 'hearings') = '1'
  and (select sync_error is null and sync_attempts = 0 from pg_temp.hearing('h_past')),
  'what the calendar could not take is shown, and who runs the deadlines asks for it again'
);

-- The calendar stops by itself: deleted in Google.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('lost', public.firm_calendar_lost('bb100000-0000-4000-8000-00000000000a',
  'agenda-1@group.calendar.invalid', 'gone'));
insert into res select 'claims_lost', jsonb_build_object('n', count(*)) from public.claim_hearing_syncs(20);
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('today_lost', public.firm_today('bb100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('lost', 'code') = 'lost' and pg_temp.got('claims_lost', 'n') = '0'
  and (select status = 'lost' and problem = 'gone' from public.firm_calendars where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and pg_temp.got('today_lost', 'calendar_lost') = '1'
  and (select count(*) = 1 from public.audit_events where action = 'calendar.lost'),
  'a calendar that stopped takes nothing more, and the firm is told'
);

-- Made again: every hearing is owed its event in the new calendar, the waits of the ones given back over at once.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('cal2', public.record_firm_calendar('bb100000-0000-4000-8000-00000000000a',
  'db100000-0000-4000-8000-00000000000a', 'agenda-2@group.calendar.invalid', 'Audiências · Souza Advogados',
  'ab100000-0000-4000-8000-000000000001'));
insert into res select 'claims2', jsonb_build_object('n', count(*), 'map', jsonb_object_agg(c.hearing_id::text, c.claim))
  from public.claim_hearing_syncs(20) c;
reset role;
select ok(
  pg_temp.got('cal2', 'code') = 'recorded' and pg_temp.got('claims2', 'n') = '5'
  and pg_temp.claim_of('claims2', 'h_silent') is not null,
  'a calendar made again takes every hearing again, the ones given back while it was stopped among them'
);

-- Changed again while each is being written, then refused or tried: a try of what is no longer so counts for nothing.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_hearing(pg_temp.got('h1', 'id')::uuid, null,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', pg_temp.day(30), 'time', '16:00',
    'link', 'https://videoconferencia.invalid/sala-7', 'attendee_user_id', 'ab100000-0000-4000-8000-000000000001'));
select public.save_hearing(pg_temp.got('h_am', 'id')::uuid, null,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(40), 'time', '11:30', 'place', 'Fórum de Manaus, sala 3',
    'attendee_name', 'Correspondente Teste'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale_failed', public.record_hearing_sync(pg_temp.got('h1', 'id')::uuid, pg_temp.claim_of('claims2', 'h1'), 2,
  'agenda-2@group.calendar.invalid', 'failed', 'badRequest'));
insert into res values ('stale_retry', public.record_hearing_sync(pg_temp.got('h_am', 'id')::uuid, pg_temp.claim_of('claims2', 'h_am'), 2,
  'agenda-2@group.calendar.invalid', 'retry', 'status_503'));
reset role;
select ok(
  pg_temp.got('stale_failed', 'code') = 'changed' and pg_temp.got('stale_retry', 'code') = 'changed'
  and (select revision = 3 and sync_error is null and sync_attempts = 0 and sync_retry_after is null and sync_claimed_at is null
       from pg_temp.hearing('h1'))
  and (select revision = 3 and sync_error is null and sync_attempts = 0 and sync_retry_after is null and sync_claimed_at is null
              -- The calendar it was tried in may hold an event of it now: that is the one a removal would take out.
              and synced_calendar = 'agenda-2@group.calendar.invalid'
       from pg_temp.hearing('h_am')),
  'a refusal or a failure of a revision no longer in force spends nothing of the revision in force'
);

-- ---------- The events of hearings that went ----------

-- On the second lawsuit of Goiás: one written to the calendar, one being written, one cancelled and taken out
-- already, and one written to the calendar the firm had before.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('h_gone', public.save_hearing(null, pg_temp.got('go2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(35), 'time', '09:00')));
insert into res values ('h_flight', public.save_hearing(null, pg_temp.got('go2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(36), 'time', '09:00')));
insert into res values ('h_out', public.save_hearing(null, pg_temp.got('go2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(37), 'time', '09:00')));
insert into res values ('h_old', public.save_hearing(null, pg_temp.got('go2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(38), 'time', '09:00')));
insert into res values ('h_moving', public.save_hearing(null, pg_temp.got('go2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(39), 'time', '09:00')));
select public.set_hearing_status(pg_temp.got('h_out', 'id')::uuid, 'cancelled', null, 'Cancelada pelo juízo.');
reset role;
update public.hearings set synced_revision = revision, synced_calendar = 'agenda-2@group.calendar.invalid'
where id in (pg_temp.got('h_gone', 'id')::uuid, pg_temp.got('h_out', 'id')::uuid);
update public.hearings set sync_claimed_at = now(), sync_claims = 1 where id = pg_temp.got('h_flight', 'id')::uuid;
update public.hearings set synced_revision = revision, synced_calendar = 'agenda-1@group.calendar.invalid'
where id = pg_temp.got('h_old', 'id')::uuid;
update public.hearings set synced_revision = revision, synced_calendar = 'agenda-1@group.calendar.invalid',
  sync_claimed_at = now(), sync_claims = 1
where id = pg_temp.got('h_moving', 'id')::uuid;
-- The lawsuit goes (put back to planned and removed), and its hearings with it.
delete from public.proceedings where id = pg_temp.got('go2', 'proceeding_id')::uuid;
insert into res select 'owed', jsonb_object_agg(r.hearing_id::text,
    jsonb_build_object('calendar', r.calendar_id, 'waits', r.retry_after is not null and r.retry_after > now()))
  from public.hearing_event_removals r;
-- And one owed long ago whose tries were all spent by workers that never came back.
insert into public.hearing_event_removals (hearing_id, org_id, calendar_id, claims, claimed_at, attempts)
values ('ab900000-0000-4000-8000-0000000000ff', 'bb100000-0000-4000-8000-00000000000a', 'agenda-2@group.calendar.invalid',
        5, now() - interval '1 hour', 5);
select pg_temp.as_backend();
set local role service_role;
insert into res select 'removals', jsonb_build_object('n', count(*), 'map', jsonb_object_agg(r.hearing_id::text, r.claim),
    'connections', jsonb_agg(distinct r.connection_id))
  from public.claim_hearing_removals(20) r;
insert into res values ('removed', public.record_hearing_removal(pg_temp.got('h_gone', 'id')::uuid,
  pg_temp.claim_of('removals', 'h_gone'), 'done'));
reset role;
-- The writes that were in flight had their time to land.
update public.hearing_event_removals set retry_after = null;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'removals2', jsonb_build_object('n', count(*), 'map', jsonb_object_agg(r.hearing_id::text, r.claim))
  from public.claim_hearing_removals(20) r;
insert into res values ('left', public.record_hearing_removal(pg_temp.got('h_flight', 'id')::uuid,
  pg_temp.claim_of('removals2', 'h_flight'), 'failed', 'forbidden'));
insert into res values ('moved_out', public.record_hearing_removal(pg_temp.got('h_moving', 'id')::uuid,
  pg_temp.claim_of('removals2', 'h_moving'), 'done'));
-- The hearing with the long place was being written to the new calendar too (claimed above, never recorded).
insert into res values ('long_out', public.record_hearing_removal(pg_temp.got('long_place', 'id')::uuid,
  pg_temp.claim_of('removals2', 'long_place'), 'done'));
reset role;
select ok(
  (select payload -> pg_temp.got('h_gone', 'id') = '{"calendar": "agenda-2@group.calendar.invalid", "waits": false}'::jsonb
          -- Being written: in the calendar in use, once the write had its time to land, whatever it was written to before.
          and payload -> pg_temp.got('h_flight', 'id') = '{"calendar": "agenda-2@group.calendar.invalid", "waits": true}'::jsonb
          and payload -> pg_temp.got('h_moving', 'id') = '{"calendar": "agenda-2@group.calendar.invalid", "waits": true}'::jsonb
          and payload -> pg_temp.got('h_old', 'id') ->> 'calendar' = 'agenda-1@group.calendar.invalid'
          and not (payload ? pg_temp.got('h_out', 'id'))
   from res where name = 'owed')
  -- The one of the calendar the firm had before can no longer be reached: let go; the ones in flight wait.
  and pg_temp.got('removals', 'n') = '1'
  and (select payload -> 'connections' = '["db100000-0000-4000-8000-00000000000a"]'::jsonb from res where name = 'removals')
  and pg_temp.got('removals2', 'n') = '3'
  and pg_temp.got('removed', 'code') = 'done' and pg_temp.got('left', 'code') = 'left'
  and pg_temp.got('moved_out', 'code') = 'done' and pg_temp.got('long_out', 'code') = 'done'
  and (select count(*) = 0 from public.hearing_event_removals)
  -- The one refused, and the one whose workers never came back, are left in the calendar on record.
  and (select count(*) = 2 from public.audit_events where action = 'calendar.event_left')
  and (select count(*) = 1 from public.audit_events where action = 'calendar.event_left' and metadata ->> 'code' = 'abandoned'),
  'a hearing that goes with its lawsuit owes the removal of its event, taken out by the backend or left on record'
);

-- ---------- Cut by a person, ended by itself ----------

update public.connections set status = 'disconnected', disconnected_at = now() where id = 'db100000-0000-4000-8000-00000000000a';
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('today_off', public.firm_today('bb100000-0000-4000-8000-00000000000a'));
insert into res values ('next_off', public.firm_hearings('bb100000-0000-4000-8000-00000000000a', 'proximas'));
reset role;
select ok(
  (select status = 'off' and problem is null from public.firm_calendars where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and pg_temp.got('today_off', 'calendar_lost') = '0'
  and (select payload -> 'calendar' = 'null'::jsonb from res where name = 'next_off'),
  'a calendar a person cut is off: nothing is written, and nothing is said to the firm as a problem'
);

-- Connected again, then the connection expires by itself.
update public.connections set status = 'connected', disconnected_at = null, connected_at = now()
where id = 'db100000-0000-4000-8000-00000000000a';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('cal3', public.record_firm_calendar('bb100000-0000-4000-8000-00000000000a',
  'db100000-0000-4000-8000-00000000000a', 'agenda-2@group.calendar.invalid', 'Audiências · Souza Advogados',
  'ab100000-0000-4000-8000-000000000001'));
insert into res values ('stale_lost', public.firm_calendar_lost('bb100000-0000-4000-8000-00000000000a',
  'agenda-2@group.calendar.invalid', 'auth', now() - interval '1 hour'));
reset role;
select ok(
  pg_temp.got('stale_lost', 'code') = 'unchanged'
  and (select status = 'active' from public.firm_calendars where org_id = 'bb100000-0000-4000-8000-00000000000a'),
  'a grant a worker opened before the account was connected again stops nothing of the calendar in use'
);
update public.connections set status = 'expired' where id = 'db100000-0000-4000-8000-00000000000a';
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('today_expired', public.firm_today('bb100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('cal3', 'code') = 'recorded'
  and (select status = 'lost' and problem = 'expired' from public.firm_calendars where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and pg_temp.got('today_expired', 'calendar_lost') = '1',
  'a calendar whose connection expired by itself stopped, and the firm is told'
);

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.record_firm_calendar('bb100000-0000-4000-8000-00000000000a', 'db100000-0000-4000-8000-00000000000a', 'x@y', 'Agenda', null)$$,
  '42501', null,
  'a session never records a calendar: the backend does, after creating it in Google'
);
reset role;

-- The calendar of firm A is nobody's business of firm B.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.firm_calendars) and (select count(*) = 0 from public.hearings),
  'firm B reads neither the calendar nor the hearings of firm A'
);
reset role;

select ok(
  (select count(*) = 1 from public.audit_events where action = 'hearing.held')
  and (select count(*) = 2 from public.audit_events where action = 'hearing.cancelled')
  and (select count(*) = 3 from public.audit_events where action = 'calendar.connected')
  and (select count(*) = 1 from public.audit_events where action = 'calendar.retried'),
  'every step of a hearing and of the calendar is on the record'
);

-- ---------- A firm that goes ----------

-- Firm B has a hearing written to its calendar; the firm goes, and owes Google nothing (its grant went with it).
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('h_b', public.save_hearing(null, pg_temp.got('go_b', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', pg_temp.day(20), 'time', '09:00')));
reset role;
update public.hearings set synced_revision = revision, synced_calendar = 'agenda-b@group.calendar.invalid'
where id = pg_temp.got('h_b', 'id')::uuid;
-- The firm goes the way the platform deletes one: with no person's session (`admin_delete_account` does it so).
select pg_temp.as_backend();
select lives_ok(
  $$delete from public.organizations where id = 'bb100000-0000-4000-8000-00000000000b'$$,
  'a firm that goes takes its hearings with it'
);
select ok(
  pg_temp.got('h_b', 'code') = 'scheduled'
  and (select count(*) = 0 from public.hearing_event_removals where org_id = 'bb100000-0000-4000-8000-00000000000b')
  and (select count(*) = 0 from public.hearings where org_id = 'bb100000-0000-4000-8000-00000000000b'),
  'and owes the calendar it had nothing'
);

select * from finish();
rollback;
