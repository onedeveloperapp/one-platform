begin;
create extension if not exists pgtap;
select plan(28);

-- ============================================================
-- The flight itself, step by step, for the agency, and the firm's forecast
-- in numbers (0084). Two firms, each with its agency: what an agency reads
-- is its own passengers' flights, and what a firm reads of a partnership
-- names nobody.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-voosteste.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-voosteste.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8700000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@sol-voosteste.invalid', '', now(), '{}', '{"display_name":"Lia Sol"}', now(), now()),
  ('a8700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rui@mar-voosteste.invalid', '', now(), '{}', '{"display_name":"Rui Mar"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8700000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-voosteste', 'a8700000-0000-4000-8000-000000000001'),
  ('b8700000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-voosteste', 'a8700000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8700000-0000-4000-8000-00000000000a', 'a8700000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8700000-0000-4000-8000-00000000000b', 'a8700000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c8700000-0000-4000-8000-00000000000a', 'b8700000-0000-4000-8000-00000000000a', 'whatsapp', 'voosteste-waba-a',
   'Chat de teste', 'connected', 'a8700000-0000-4000-8000-000000000001', now());

-- Each firm's agency, with somebody of it.
insert into public.partners (id, name) values
  ('c8700000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c8700000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c8700000-0000-4000-8000-0000000000aa', 'a8700000-0000-4000-8000-000000000003', 'owner'),
  ('c8700000-0000-4000-8000-0000000000bb', 'a8700000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d8700000-0000-4000-8000-00000000000a', 'c8700000-0000-4000-8000-0000000000aa', 'b8700000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d8700000-0000-4000-8000-00000000000b', 'c8700000-0000-4000-8000-0000000000bb', 'b8700000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');

-- Firm A's agency: Mariana agreed yesterday and flies today (two legs); Elisa agreed and flies in three weeks; Bruno
-- agreed and took it back; Clara said no. Firm B's agency: Vera agreed and flies today.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, phone) values
  ('f8700000-0000-4000-8000-000000000001', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'Mariana Teste', '5500988880006'),
  ('f8700000-0000-4000-8000-000000000002', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'Elisa Teste', '5562999990011'),
  ('f8700000-0000-4000-8000-000000000003', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'Bruno Teste', '5562999990012'),
  ('f8700000-0000-4000-8000-000000000004', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'Clara Teste', '5562999990013'),
  ('f8700000-0000-4000-8000-000000000005', 'c8700000-0000-4000-8000-0000000000bb', 'd8700000-0000-4000-8000-00000000000b',
   'b8700000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990014');
insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, wording, answer, created_at) values
  ('c8700000-0000-4000-8000-0000000000aa', 'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000001',
   'f8700000-0000-4000-8000-000000000001', 'Concordo com o acompanhamento dos meus voos.', 'agreed', now() - interval '1 day'),
  ('c8700000-0000-4000-8000-0000000000aa', 'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000002',
   'f8700000-0000-4000-8000-000000000002', 'Concordo com o acompanhamento dos meus voos.', 'agreed', now()),
  ('c8700000-0000-4000-8000-0000000000aa', 'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000003',
   'f8700000-0000-4000-8000-000000000003', 'Concordo com o acompanhamento dos meus voos.', 'agreed', now() - interval '3 days'),
  ('c8700000-0000-4000-8000-0000000000aa', 'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000003',
   'f8700000-0000-4000-8000-000000000003', 'Concordo com o acompanhamento dos meus voos.', 'withdrawn', now() - interval '2 days'),
  ('c8700000-0000-4000-8000-0000000000aa', 'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000004',
   'f8700000-0000-4000-8000-000000000004', 'Concordo com o acompanhamento dos meus voos.', 'declined', now()),
  ('c8700000-0000-4000-8000-0000000000bb', 'b8700000-0000-4000-8000-00000000000b', 'f8700000-0000-4000-8000-000000000005',
   'f8700000-0000-4000-8000-000000000005', 'Concordo com o acompanhamento dos meus voos.', 'agreed', now());
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('18700000-0000-4000-8000-000000000001', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000001', 'SOL123'),
  ('18700000-0000-4000-8000-000000000002', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000002', 'SOL456'),
  ('18700000-0000-4000-8000-000000000003', 'c8700000-0000-4000-8000-0000000000aa', 'd8700000-0000-4000-8000-00000000000a',
   'b8700000-0000-4000-8000-00000000000a', 'f8700000-0000-4000-8000-000000000003', 'SOL789'),
  ('18700000-0000-4000-8000-000000000005', 'c8700000-0000-4000-8000-0000000000bb', 'd8700000-0000-4000-8000-00000000000b',
   'b8700000-0000-4000-8000-00000000000b', 'f8700000-0000-4000-8000-000000000005', 'MAR123');

-- The trips ONE follows, as each passenger's agreement made them (0071): Mariana's in the test chat, the others read
-- at FlightAware; Bruno's stopped when he took his agreement back.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording,
                                  consent_at, consent_channel, status, watch, pax_trip_id) values
  ('28700000-0000-4000-8000-000000000001', 'b8700000-0000-4000-8000-00000000000a', 'Mariana Teste', '5500988880006', 'LA',
   true, 'agencia', 'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching',
   'simulated', '18700000-0000-4000-8000-000000000001'),
  ('28700000-0000-4000-8000-000000000002', 'b8700000-0000-4000-8000-00000000000a', 'Elisa Teste', '5562999990011', 'G3',
   false, null, 'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching',
   'flightaware', '18700000-0000-4000-8000-000000000002'),
  ('28700000-0000-4000-8000-000000000003', 'b8700000-0000-4000-8000-00000000000a', 'Bruno Teste', '5562999990012', 'AD',
   false, null, 'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'stopped',
   'flightaware', '18700000-0000-4000-8000-000000000003'),
  ('28700000-0000-4000-8000-000000000005', 'b8700000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990014', 'G3',
   false, null, 'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching',
   'flightaware', '18700000-0000-4000-8000-000000000005');
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                 scheduled_departure_local, scheduled_arrival_local) values
  ('b8700000-0000-4000-8000-00000000000a', '28700000-0000-4000-8000-000000000001', 1, 'LA3100', 'GRU', 'BSB',
   (now() at time zone 'America/Sao_Paulo')::date + time '06:10', (now() at time zone 'America/Sao_Paulo')::date + time '07:50'),
  ('b8700000-0000-4000-8000-00000000000a', '28700000-0000-4000-8000-000000000001', 2, 'LA3200', 'BSB', 'REC',
   (now() at time zone 'America/Sao_Paulo')::date + time '09:00', (now() at time zone 'America/Sao_Paulo')::date + time '11:40'),
  ('b8700000-0000-4000-8000-00000000000a', '28700000-0000-4000-8000-000000000002', 1, 'G31450', 'BSB', 'GIG',
   (now() at time zone 'America/Sao_Paulo')::date + 21 + time '14:00', (now() at time zone 'America/Sao_Paulo')::date + 21 + time '15:45'),
  ('b8700000-0000-4000-8000-00000000000a', '28700000-0000-4000-8000-000000000003', 1, 'AD4000', 'CNF', 'POA',
   (now() at time zone 'America/Sao_Paulo')::date + time '10:00', (now() at time zone 'America/Sao_Paulo')::date + time '12:20'),
  ('b8700000-0000-4000-8000-00000000000b', '28700000-0000-4000-8000-000000000005', 1, 'G31500', 'GYN', 'GRU',
   (now() at time zone 'America/Sao_Paulo')::date + time '13:00', (now() at time zone 'America/Sao_Paulo')::date + time '14:30');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.leg(trip uuid, at integer) returns public.tracked_legs language sql as
$$ select * from public.tracked_legs l where l.trip_id = trip and l.position = at; $$;

-- ---------- What FlightAware said of a leg ----------

update public.tracked_trips set watch_claims = 1, watch_claimed_at = now() where id = '28700000-0000-4000-8000-000000000005';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_1', public.record_trip_watch('28700000-0000-4000-8000-000000000005', 1,
  jsonb_build_array(jsonb_build_object('position', 1, 'status', 'scheduled', 'estimated_arrival', null,
    'departed', to_char((now() at time zone 'America/Sao_Paulo')::date + time '13:05', 'YYYY-MM-DD"T"HH24:MI'),
    'arrived', null))));
reset role;

select is(
  (pg_temp.leg('28700000-0000-4000-8000-000000000005', 1)).departed_local,
  (now() at time zone 'America/Sao_Paulo')::date + time '13:05',
  'a leg keeps when its source said it left, in its airport''s local time'
);
select ok(
  (pg_temp.leg('28700000-0000-4000-8000-000000000005', 1)).arrived_local is null,
  'and has not arrived while no source said it did'
);

update public.tracked_trips set watch_claims = 2, watch_claimed_at = now() where id = '28700000-0000-4000-8000-000000000005';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_2', public.record_trip_watch('28700000-0000-4000-8000-000000000005', 2,
  jsonb_build_array(jsonb_build_object('position', 1, 'status', 'landed',
    'estimated_arrival', to_char((now() at time zone 'America/Sao_Paulo')::date + time '14:28', 'YYYY-MM-DD"T"HH24:MI'),
    'arrived', to_char((now() at time zone 'America/Sao_Paulo')::date + time '14:28', 'YYYY-MM-DD"T"HH24:MI')))));
reset role;

select is(
  (pg_temp.leg('28700000-0000-4000-8000-000000000005', 1)).arrived_local,
  (now() at time zone 'America/Sao_Paulo')::date + time '14:28',
  'a leg that landed keeps when it arrived'
);
select is(
  (pg_temp.leg('28700000-0000-4000-8000-000000000005', 1)).departed_local,
  (now() at time zone 'America/Sao_Paulo')::date + time '13:05',
  'and a reading that does not repeat when it left erases nothing of it'
);

update public.tracked_trips set watch_claims = 3, watch_claimed_at = now() where id = '28700000-0000-4000-8000-000000000003';
update public.tracked_legs set departed_local = (now() at time zone 'America/Sao_Paulo')::date + time '10:00'
where trip_id = '28700000-0000-4000-8000-000000000003';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_3', public.record_trip_watch('28700000-0000-4000-8000-000000000003', 3,
  '[{"position": 1, "status": "cancelled", "departed": "not a time"}]'::jsonb));
reset role;

select ok(
  (pg_temp.leg('28700000-0000-4000-8000-000000000003', 1)).departed_local is null
    and (pg_temp.leg('28700000-0000-4000-8000-000000000003', 1)).status = 'cancelled',
  'a cancelled leg never left, and a time that is not one is no time'
);

-- ---------- The test chat makes a flight go as a flight with no problem goes ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b8700000-0000-4000-8000-00000000000a',
  'c8700000-0000-4000-8000-00000000000a', 'test', 'voosteste-number-a', 'voosteste-waba-a', '5500900000087',
  'Souza Advogados', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b8700000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('v', 43), 'a8700000-0000-4000-8000-000000000001'));
insert into res values ('depart_1', public.test_chat_set_legs(repeat('v', 43), '28700000-0000-4000-8000-000000000001',
  '[{"position": 1, "event": "depart"}]'::jsonb));
insert into res values ('land_1', public.test_chat_set_legs(repeat('v', 43), '28700000-0000-4000-8000-000000000001',
  '[{"position": 1, "event": "land"}]'::jsonb));
insert into res values ('depart_2', public.test_chat_set_legs(repeat('v', 43), '28700000-0000-4000-8000-000000000001',
  '[{"position": 2, "event": "depart"}]'::jsonb));
insert into res values ('bad_event', public.test_chat_set_legs(repeat('v', 43), '28700000-0000-4000-8000-000000000001',
  '[{"position": 2, "event": "taxi"}]'::jsonb));
reset role;

select is(
  (pg_temp.leg('28700000-0000-4000-8000-000000000001', 1)).departed_local,
  (now() at time zone 'America/Sao_Paulo')::date + time '06:10',
  'a tool makes a leg leave at its scheduled time'
);
select ok(
  (pg_temp.leg('28700000-0000-4000-8000-000000000001', 1)).arrived_local
    = (now() at time zone 'America/Sao_Paulo')::date + time '07:50'
  and (pg_temp.leg('28700000-0000-4000-8000-000000000001', 1)).status = 'landed',
  'and another makes it arrive, at its scheduled time when nothing made it late'
);
select ok(
  (pg_temp.leg('28700000-0000-4000-8000-000000000001', 2)).departed_local is not null
    and (pg_temp.leg('28700000-0000-4000-8000-000000000001', 2)).arrived_local is null,
  'the next leg leaves and is in the air'
);
select is(pg_temp.got('bad_event', 'code'), 'invalid_legs', 'a tool that is not one changes nothing');

-- ---------- What the agency reads of its passengers' flights ----------

select pg_temp.sign_in('a8700000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('home_a', public.pax_flight_progress('c8700000-0000-4000-8000-0000000000aa'));
insert into res values ('elisa', public.pax_flight_progress('c8700000-0000-4000-8000-0000000000aa',
  'f8700000-0000-4000-8000-000000000002'));
insert into res values ('bruno', public.pax_flight_progress('c8700000-0000-4000-8000-0000000000aa',
  'f8700000-0000-4000-8000-000000000003'));
reset role;

select is(
  (select jsonb_agg(trip ->> 'locator') from jsonb_array_elements((select payload -> 'trips' from res where name = 'home_a')) trip),
  '["SOL123"]'::jsonb,
  'the agency''s home reads the trips ONE follows in the next days: not one weeks ahead, nor one whose agreement was taken back'
);
select is(
  (select payload #>> '{trips,0,legs,1,departed}' from res where name = 'home_a'),
  to_char((now() at time zone 'America/Sao_Paulo')::date + time '09:00', 'YYYY-MM-DD"T"HH24:MI'),
  'with when each leg left'
);
select is(
  (select payload #>> '{trips,0,legs,0,arrived}' from res where name = 'home_a'),
  to_char((now() at time zone 'America/Sao_Paulo')::date + time '07:50', 'YYYY-MM-DD"T"HH24:MI'),
  'and when it arrived'
);
select is(
  (select payload #>> '{trips,0,holder}' from res where name = 'home_a'),
  'Mariana Teste',
  'each trip with its holder, the agency''s own record'
);
select is(
  (select jsonb_agg(trip ->> 'locator') from jsonb_array_elements((select payload -> 'trips' from res where name = 'elisa')) trip),
  '["SOL456"]'::jsonb,
  'a passenger''s page reads every trip of theirs ONE follows, whatever its days'
);
select is(
  (select jsonb_array_length(payload -> 'trips') from res where name = 'bruno'),
  0,
  'but not one whose agreement was taken back'
);

select pg_temp.sign_in('a8700000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.pax_flight_progress('c8700000-0000-4000-8000-0000000000aa') $$,
  '42501', 'not_authorized',
  'another agency reads nothing of these flights'
);
reset role;

select pg_temp.sign_in('a8700000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.pax_flight_progress('c8700000-0000-4000-8000-0000000000aa') $$,
  '42501', 'not_authorized',
  'nor does the firm, by this way: it reads the forecast, with nobody named'
);
reset role;

select ok(
  not has_function_privilege('anon', 'public.pax_flight_progress(uuid, uuid)', 'EXECUTE'),
  'and nobody signed out reads them'
);

-- ---------- The firm foresees, in numbers ----------

select pg_temp.sign_in('a8700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('facts_a', public.firm_partnership_facts('b8700000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a8700000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('facts_b', public.firm_partnership_facts('b8700000-0000-4000-8000-00000000000b'));
reset role;

select is(
  (select (payload #>> '{partnerships,0,forecast,agreed}')::integer from res where name = 'facts_a'),
  2,
  'the firm counts its agency''s passengers whose answer in force is a yes: not who took it back nor who said no'
);
select is(
  (select payload #>> '{partnerships,0,forecast,agreed_since}' from res where name = 'facts_a'),
  ((now() - interval '1 day') at time zone 'America/Sao_Paulo')::date::text,
  'and from when they agreed'
);
select is(
  (select sum((week ->> 'agreed')::integer)::integer
   from jsonb_array_elements((select payload #> '{partnerships,0,forecast,agreed_weeks}' from res where name = 'facts_a')) week),
  2,
  'week by week, over the last eight'
);
select is(
  (select jsonb_array_length(payload #> '{partnerships,0,forecast,agreed_weeks}') from res where name = 'facts_a'),
  8,
  'each of the eight weeks said, an empty one as none'
);
select is(
  (select (payload #>> '{partnerships,0,forecast,followed}')::integer from res where name = 'facts_a'),
  2,
  'the trips ONE follows now'
);
select is(
  (select (payload #>> '{partnerships,0,forecast,days,0,trips}')::integer from res where name = 'facts_a'),
  1,
  'how many of them fly today'
);
select is(
  (select jsonb_array_length(payload #> '{partnerships,0,forecast,days}') from res where name = 'facts_a'),
  7,
  'and on each of the setting''s next days'
);
select is(
  (select (payload #>> '{partnerships,0,forecast,in_air}')::integer + 10 * (payload #>> '{partnerships,0,forecast,arrived_today}')::integer
   from res where name = 'facts_a'),
  11,
  'how many legs are in the air, and how many arrived today'
);
select ok(
  (select payload::text from res where name = 'facts_a') !~ '(Mariana|Elisa|Bruno|Clara|SOL123|5500988880006)',
  'and nobody is named: no name, locator or phone'
);
select is(
  (select jsonb_build_array(jsonb_array_length(payload -> 'partnerships'), payload #>> '{partnerships,0,forecast,agreed}')
   from res where name = 'facts_b'),
  '[1, "1"]'::jsonb,
  'another firm reads only its own partnership''s numbers'
);

select * from finish();
rollback;
