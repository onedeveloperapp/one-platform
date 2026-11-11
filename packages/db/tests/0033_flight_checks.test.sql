begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- The flights of a case, checked against what a source recorded (0030).
-- Every leg with a flight and a day owes a check of ANAC's official record,
-- claimed and recorded by the backend; a leg whose flight changes starts
-- over; a person asks the record again, or asks FlightAware, within what
-- the database allows. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@voos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@voos.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@voos.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@voos.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('be100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-voos', 'ae100000-0000-4000-8000-000000000001'),
  ('be100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-voos', 'ae100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('be100000-0000-4000-8000-00000000000b', 'ae100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.check_of(segment uuid, from_source text default 'vra') returns public.flight_checks language sql as
$$ select * from public.flight_checks where segment_id = segment and source = from_source; $$;

-- A case of each firm; firm A's with a leg of LATAM from Goiânia to Congonhas and one with no day yet.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('be100000-0000-4000-8000-00000000000a', 'delay', 'LA', date '2026-08-05',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('leg_a', public.save_flight_segment(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"flight_number": "LA3418", "origin_iata": "GYN", "destination_iata": "CGH", "scheduled_departure_local": "2026-08-05T08:00", "scheduled_arrival_local": "2026-08-05T09:40"}'::jsonb));
insert into res values ('leg_open', public.save_flight_segment(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"flight_number": "G31000", "origin_iata": "GRU"}'::jsonb));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('be100000-0000-4000-8000-00000000000b', 'delay', 'G3', date '2026-08-05',
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('leg_b', public.save_flight_segment(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"flight_number": "G31000", "origin_iata": "GRU", "destination_iata": "BSB", "scheduled_departure_local": "2026-08-05T06:00"}'::jsonb));
reset role;

select ok(
  (select status = 'waiting' and record is null and org_id = 'be100000-0000-4000-8000-00000000000a'
   from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid))
  and (select status = 'incomplete' from pg_temp.check_of(pg_temp.got('leg_open', 'segment_id')::uuid))
  and (select status = 'waiting' from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid))
  and (select count(*) = 0 from public.flight_checks where source = 'flightaware'),
  'a leg with a flight and a day owes a check of the record; one with no day has nothing to ask'
);

-- ---------- The backend's half ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok('select * from public.claim_flight_checks(10)', '42501', null, 'only the backend claims the checks');
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', (select jsonb_agg(to_jsonb(c) order by c.leg_flight) from public.claim_flight_checks(10) c));
reset role;
select ok(
  jsonb_array_length((select payload from res where name = 'claimed')) = 2,
  'the backend claims the checks owed, the incomplete one left out'
);
select ok(
  (select item ->> 'leg_number' = '3418' and item -> 'designators' = '["TAM", "LAN", "LPE", "LAP", "LNE"]'::jsonb
          and item ->> 'origin_icao' = 'SBGO' and item ->> 'destination_icao' = 'SBSP'
          and (item ->> 'origin_offset')::integer = -180 and item ->> 'departure_local' = '2026-08-05T08:00'
          and (item ->> 'claim')::integer = 1
   from jsonb_array_elements((select payload from res where name = 'claimed')) item
   where item ->> 'leg_flight' = 'LA3418'),
  'a claim carries what the leg is: the record''s designators of its airline, the number, the airports and the ticket''s time'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('late', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid)), 7, 'found',
  '{"airline": "TAM", "number": "3418"}'::jsonb, 'operator', '2026-08', 'conferencia-voo-v1'));
insert into res values ('bad', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid)), 1, 'found', '"x"'::jsonb, 'operator', '2026-08', 'conferencia-voo-v1'));
insert into res values ('found', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid)), 1, 'found',
  '{"airline": "TAM", "number": "3418", "origin": "SBGO", "destination": "SBSP", "scheduledDeparture": "2026-08-05T08:00", "actualDeparture": "2026-08-05T12:20", "scheduledArrival": "2026-08-05T09:40", "actualArrival": "2026-08-05T14:05", "state": "realizado", "codeshares": []}'::jsonb,
  'operator', '2026-08', 'conferencia-voo-v1'));
insert into res values ('found_again', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid)), 1, 'found', '{"a": 1}'::jsonb, 'operator', '2026-08', 'conferencia-voo-v1'));
reset role;
select ok(
  pg_temp.got('late', 'code') = 'not_working' and pg_temp.got('bad', 'code') = 'invalid_data'
  and pg_temp.got('found', 'code') = 'found' and pg_temp.got('found_again', 'code') = 'not_working'
  and (select status = 'found' and record ->> 'actualArrival' = '2026-08-05T14:05' and matched_by = 'operator'
              and month = '2026-08' and version = 'conferencia-voo-v1' and checked_at is not null and work_claimed_at is null
       from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid))
  and (select count(*) = 1 from public.case_events where kind = 'flight_checked' and actor_type = 'system'
         and case_id = pg_temp.got('case_a', 'case_id')::uuid),
  'what the record says is kept by the worker that holds the claim, once, and told in the case'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.record_flight_check(%L, 1, %L)', (select id from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid)), 'not_found'),
  '42501', null, 'a person writes nothing a source said'
);
-- A correction of the arrival changes no check; another flight starts it over.
insert into res values ('arrival_told', public.save_flight_segment(pg_temp.got('case_a', 'case_id')::uuid, pg_temp.got('leg_a', 'segment_id')::uuid,
  '{"actual_arrival_local": "2026-08-05T15:00"}'::jsonb));
insert into res values ('kept_after_arrival', jsonb_build_object('status', (select status from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid))));
reset role;

-- The leg of firm B: its month is not out yet, then ANAC does not answer until the attempts are spent.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('unpublished', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid)), 1, 'not_published', null, null, '2026-08'));
insert into res values ('claim_waiting', jsonb_build_object('n', (select count(*) from public.claim_flight_checks(10))));
reset role;
select ok(
  pg_temp.got('kept_after_arrival', 'status') = 'found'
  and pg_temp.got('unpublished', 'code') = 'not_published'
  and (select status = 'not_published' and work_attempts = 0 and work_after > now() + interval '23 hours'
       from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid))
  and pg_temp.got('claim_waiting', 'n') = '0',
  'a month not out yet is asked again a day later, with no attempt spent; an arrival corrected changes no check'
);

update public.platform_settings set value = value || '{"max_attempts": 2}'::jsonb where key = 'flights';
update public.flight_checks set work_after = null where segment_id = pg_temp.got('leg_b', 'segment_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('try1', jsonb_build_object('claim', (select c.claim from public.claim_flight_checks(1) c)));
insert into res values ('retry1', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid)), pg_temp.got('try1', 'claim')::integer, 'retry', null, null, null, null, 'anac_unavailable'));
reset role;
update public.flight_checks set work_after = null where segment_id = pg_temp.got('leg_b', 'segment_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('try2', jsonb_build_object('claim', (select c.claim from public.claim_flight_checks(1) c)));
insert into res values ('retry2', public.record_flight_check(
  (select id from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid)), pg_temp.got('try2', 'claim')::integer, 'retry', null, null, null, null, 'anac_unavailable'));
reset role;
select ok(
  pg_temp.got('retry1', 'code') = 'retry' and pg_temp.got('retry2', 'code') = 'failed'
  and (select status = 'failed' and work_error = 'anac_unavailable' and work_claimed_at is null
       from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid)),
  'a passing failure waits and is tried again, and is given up after the attempts'
);

-- ---------- What a person does ----------

-- The firm let the support in (0203): a visit opens only under its authorization.
insert into public.support_authorizations (org_id, ends_at) values ('be100000-0000-4000-8000-00000000000b', now() + interval '1 day');
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ae100000-0000-4000-8000-000000000009', 'ae100000-0000-4000-8000-000000000004', 'be100000-0000-4000-8000-00000000000b',
        'Conferindo os voos', 'fe100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004', 'fe100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.request_flight_recheck(%L)', pg_temp.got('leg_b', 'segment_id')),
  '42501', 'not_allowed_in_support_session', 'a support visit asks nothing again'
);
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.request_flight_recheck(%L)', pg_temp.got('leg_b', 'segment_id')),
  'P0002', 'case_not_found', 'nor of a case of another firm'
);
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('recheck', public.request_flight_recheck(pg_temp.got('leg_b', 'segment_id')::uuid));
insert into res values ('recheck_again', public.request_flight_recheck(pg_temp.got('leg_b', 'segment_id')::uuid));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('recheck_open', public.request_flight_recheck(pg_temp.got('leg_open', 'segment_id')::uuid));
reset role;
select ok(
  pg_temp.got('recheck', 'code') = 'waiting' and pg_temp.got('recheck_again', 'code') = 'nothing_to_recheck'
  and pg_temp.got('recheck_open', 'code') = 'flight_incomplete'
  and (select status = 'waiting' and work_attempts = 0 and work_error is null
       from pg_temp.check_of(pg_temp.got('leg_b', 'segment_id')::uuid))
  and (select count(*) = 1 from public.audit_events where action = 'flights.recheck'
       and entity_id = pg_temp.got('leg_b', 'segment_id')),
  'a check given up is asked again by a person of the firm, and that is on record; a leg with no day has nothing to ask'
);

-- FlightAware, asked by a person: once in a while per leg, a few times a day per firm.
update public.platform_settings set value = value || '{"lookups_per_day": 4}'::jsonb where key = 'flights';
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('lookup', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
insert into res values ('lookup_soon', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
reset role;
select ok(
  pg_temp.got('lookup', 'flight') = 'LA3418'
  and (select payload -> 'icao_flights' = '["TAM3418", "LAN3418", "LPE3418", "LAP3418", "LNE3418"]'::jsonb from res where name = 'lookup')
  and pg_temp.got('lookup', 'date') = '2026-08-05' and pg_temp.got('lookup', 'origin') = 'GYN'
  and pg_temp.got('lookup', 'destination') = 'CGH' and pg_temp.got('lookup', 'claim') = '1'
  and pg_temp.got('lookup_soon', 'code') = 'lookup_cooldown'
  and (select status = 'waiting' and requested_by = 'ae100000-0000-4000-8000-000000000002'
       from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid, 'flightaware')),
  'a person asks FlightAware about a leg, and the database says what to ask (LATAM under each of its five ICAO designators, in order); the same leg waits a while'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('answer', public.record_flight_lookup(pg_temp.got('lookup', 'check_id')::uuid, 1, 'found',
  '{"flight": "LA3418", "state": "landed", "actualArrival": "2026-08-05T17:05:00Z"}'::jsonb, 'conferencia-voo-v1'));
insert into res values ('answer_again', public.record_flight_lookup(pg_temp.got('lookup', 'check_id')::uuid, 1, 'not_found'));
reset role;
-- Asked again a while later, FlightAware does not answer: the answer it gave stays, and the wait is given back.
update public.flight_checks set requested_at = now() - interval '2 hours'
where segment_id = pg_temp.got('leg_a', 'segment_id')::uuid and source = 'flightaware';
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lookup2', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
-- The first lookup's answer, come late, is not the second's.
insert into res values ('late_answer', public.record_flight_lookup(pg_temp.got('lookup', 'check_id')::uuid, 1, 'not_found'));
insert into res values ('silent', public.record_flight_lookup(pg_temp.got('lookup2', 'check_id')::uuid, 2, 'unavailable', null, null, 'flightaware_no_answer'));
reset role;
select ok(
  pg_temp.got('answer', 'code') = 'found' and pg_temp.got('answer_again', 'code') = 'not_waiting'
  and pg_temp.got('lookup2', 'claim') = '2' and pg_temp.got('late_answer', 'code') = 'not_waiting'
  and pg_temp.got('silent', 'code') = 'unavailable'
  and (select status = 'found' and record ->> 'actualArrival' = '2026-08-05T17:05:00Z' and requested_at is null
              and work_error = 'flightaware_no_answer'
       from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid, 'flightaware'))
  and (select count(*) = 1 from public.case_events where kind = 'flight_looked_up' and case_id = pg_temp.got('case_a', 'case_id')::uuid),
  'what FlightAware answered is kept as it answered; no answer keeps the last one and gives the wait back'
);

-- A lookup whose answer never came back: it waits a few minutes, then may be asked again at once.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lookup3', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
insert into res values ('lookup3_soon', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
reset role;
update public.flight_checks set requested_at = now() - interval '10 minutes'
where segment_id = pg_temp.got('leg_a', 'segment_id')::uuid and source = 'flightaware';
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lookup4', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
reset role;
select ok(
  pg_temp.got('lookup3', 'claim') = '3' and pg_temp.got('lookup3_soon', 'code') = 'lookup_cooldown'
  and pg_temp.got('lookup4', 'claim') = '4',
  'a lookup whose answer was lost is asked again after a few minutes, under another number'
);

-- The firm's answers of the day are spent.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ceiling', public.begin_flight_lookup(pg_temp.got('leg_a', 'segment_id')::uuid));
-- Another flight for the leg: its checks start over, and FlightAware's answer about the old one goes.
insert into res values ('new_flight', public.save_flight_segment(pg_temp.got('case_a', 'case_id')::uuid, pg_temp.got('leg_a', 'segment_id')::uuid,
  '{"flight_number": "LA3420"}'::jsonb));
reset role;
select ok(
  pg_temp.got('ceiling', 'code') = 'daily_limit'
  and (select status = 'waiting' and record is null and matched_by is null and month is null
       from pg_temp.check_of(pg_temp.got('leg_a', 'segment_id')::uuid))
  and (select count(*) = 0 from public.flight_checks where segment_id = pg_temp.got('leg_a', 'segment_id')::uuid and source = 'flightaware'),
  'a firm asks FlightAware a few times a day; a leg on another flight is checked anew'
);

-- ---------- Two firms ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('seen_b', jsonb_build_object(
  'mine', (select count(*) from public.flight_checks where org_id = 'be100000-0000-4000-8000-00000000000b'),
  'theirs', (select count(*) from public.flight_checks where org_id = 'be100000-0000-4000-8000-00000000000a')));
select throws_ok(
  format('select public.begin_flight_lookup(%L)', pg_temp.got('leg_a', 'segment_id')),
  'P0002', 'case_not_found', 'nobody asks FlightAware about a leg of another firm'
);
reset role;
select ok(
  pg_temp.got('seen_b', 'mine') = '1' and pg_temp.got('seen_b', 'theirs') = '0',
  'a firm reads its own checks and none of another'
);

select throws_ok(
  $$update public.airlines set vra_designators = array['gl'] where iata = 'G3'$$,
  '23514', null, 'an airline is named in the record by designators of three letters only'
);

select * from finish();
rollback;
