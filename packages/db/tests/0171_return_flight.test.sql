begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The way back is still followed (0172): an alert is of a journey, one per
-- journey and kind; a trip whose outbound became a case is read while it has
-- a leg no case took, told of a problem there and never again of the journey
-- the case took; a no or a stop ends what was left of it, never its case.
-- Two firms: nothing of one reaches the other.
--
-- Every person, firm, flight and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1710000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-volta.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1710000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-volta.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1710000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-volta', 'a1710000-0000-4000-8000-000000000001'),
  ('b1710000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-volta', 'a1710000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1710000-0000-4000-8000-00000000000a', 'a1710000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1710000-0000-4000-8000-00000000000b', 'a1710000-0000-4000-8000-000000000002', 'owner', 'socio');

-- A round trip of each firm, read at FlightAware: the way out flown an hour ago, the way back leaving in two hours.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, consent_wording, consent_at,
                                  consent_channel, watch) values
  ('e1710000-0000-4000-8000-00000000000a', 'b1710000-0000-4000-8000-00000000000a', 'Mariana Teste', '5562999990001', 'LA',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware'),
  ('e1710000-0000-4000-8000-00000000000b', 'b1710000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990003', 'G3',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware');
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                 scheduled_departure_local, scheduled_arrival_local) values
  ('b1710000-0000-4000-8000-00000000000a', 'e1710000-0000-4000-8000-00000000000a', 1, 'LA3456', 'GRU', 'REC',
   (now() at time zone 'America/Sao_Paulo') - interval '4 hours', (now() at time zone 'America/Sao_Paulo') - interval '1 hour'),
  ('b1710000-0000-4000-8000-00000000000a', 'e1710000-0000-4000-8000-00000000000a', 2, 'LA3457', 'REC', 'GRU',
   (now() at time zone 'America/Sao_Paulo') + interval '2 hours', (now() at time zone 'America/Sao_Paulo') + interval '5 hours'),
  ('b1710000-0000-4000-8000-00000000000b', 'e1710000-0000-4000-8000-00000000000b', 1, 'G31450', 'BSB', 'GIG',
   (now() at time zone 'America/Sao_Paulo') - interval '4 hours', (now() at time zone 'America/Sao_Paulo') - interval '1 hour');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1710000-0000-4000-8000-00000000000a', 'b1710000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'intake');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.backend(name text, call text) returns void language plpgsql as $$
declare
  answer jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  execute call into answer;
  execute 'reset role';
  insert into res values (name, answer);
end;
$$;

select pg_temp.backend('out', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'cancelled', 1, null,
  'flight-problem-v4', 1, array[1])$$);
select pg_temp.backend('back', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'cancelled', 2, null,
  'flight-problem-v4', 2, array[2])$$);
select pg_temp.backend('again', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'cancelled', 1, null,
  'flight-problem-v4', 1, array[1])$$);

select ok(
  pg_temp.got('out', 'code') = 'recorded' and pg_temp.got('back', 'code') = 'recorded'
  and pg_temp.got('again', 'code') = 'already_known'
  and (select array_agg(a.journey order by a.journey) = array[1, 2] from public.flight_alerts a
       where a.trip_id = 'e1710000-0000-4000-8000-00000000000a'),
  'an alert is of a journey: the way out and the way back each have their own, once'
);

-- The way out became a case: the trip is case_opened, and its first leg says the case it went into.
delete from public.flight_alerts where trip_id = 'e1710000-0000-4000-8000-00000000000a' and journey = 2;
update public.flight_alerts set case_id = 'c1710000-0000-4000-8000-00000000000a', answer = 'yes'
where trip_id = 'e1710000-0000-4000-8000-00000000000a' and journey = 1;
update public.tracked_trips set status = 'case_opened', case_id = 'c1710000-0000-4000-8000-00000000000a'
where id = 'e1710000-0000-4000-8000-00000000000a';
update public.tracked_legs set case_id = 'c1710000-0000-4000-8000-00000000000a'
where trip_id = 'e1710000-0000-4000-8000-00000000000a' and position = 1;

select ok(
  public.trip_still_followed('e1710000-0000-4000-8000-00000000000a')
  and public.trip_still_followed('e1710000-0000-4000-8000-00000000000b'),
  'a trip that became a case is still followed while it has a leg no case took'
);

select pg_temp.backend('claim', $$select public.claim_trip_watch(50)$$);
select ok(
  exists (select 1 from jsonb_array_elements((select payload from res where name = 'claim')) c
          where c ->> 'trip_id' = 'e1710000-0000-4000-8000-00000000000a'),
  'and the backend claims it to read what is left'
);

select pg_temp.backend('covered', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'delayed', 1, 300,
  'flight-problem-v4', 1, array[1])$$);
select pg_temp.backend('old_caller', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'delayed', 2, 300,
  'flight-problem-v4')$$);
select ok(
  pg_temp.got('covered', 'code') = 'covered' and pg_temp.got('old_caller', 'code') = 'covered',
  'the journey the case took is told nothing more, nor an alert that does not say its legs'
);

select pg_temp.backend('return', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'delayed', 2, 300,
  'flight-problem-v4', 2, array[2])$$);
select ok(
  pg_temp.got('return', 'code') = 'recorded'
  and (select a.legs = array[2] and a.case_id is null from public.flight_alerts a
       where a.id = pg_temp.got('return', 'alert_id')::uuid),
  'the way back is told of its own problem'
);

select ok(
  not exists (select 1 from public.flight_alerts a where a.org_id = 'b1710000-0000-4000-8000-00000000000b'),
  'nothing of firm A''s trip reaches firm B'
);

-- The passenger said no to the way back's alert: what was left of the trip is followed no more, its case stays.
update public.tracked_trips set rest_closed = true where id = 'e1710000-0000-4000-8000-00000000000a';
select pg_temp.backend('closed', $$select public.record_flight_alert('e1710000-0000-4000-8000-00000000000a', 'changed', 2, null,
  'flight-problem-v4', 2, array[2])$$);
select ok(
  not public.trip_still_followed('e1710000-0000-4000-8000-00000000000a')
  and pg_temp.got('closed', 'code') = 'trip_closed'
  and (select status = 'case_opened' and case_id = 'c1710000-0000-4000-8000-00000000000a' from public.tracked_trips
       where id = 'e1710000-0000-4000-8000-00000000000a'),
  'a no to it ends what was left of the trip, never the case it had'
);

select ok(
  not has_function_privilege('authenticated', 'public.record_flight_alert(uuid, text, integer, integer, text, integer, integer[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.trip_still_followed(uuid)', 'EXECUTE'),
  'only the backend keeps an alert'
);

select * from finish();
rollback;
