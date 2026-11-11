begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The day of the trip (0173): the trips whose day may owe a word are read
-- with each leg's moments as instants; a word is written once per journey
-- and kind, and what cannot go is kept as skipped with why: a real
-- passenger before the platform's release, a journey whose problem was
-- told, a firm with no template. Two firms: nothing of one reaches the other.
--
-- Every person, firm, flight and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1720000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-dia.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1720000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-dia.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1720000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-dia', 'a1720000-0000-4000-8000-000000000001'),
  ('b1720000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-dia', 'a1720000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1720000-0000-4000-8000-00000000000a', 'a1720000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1720000-0000-4000-8000-00000000000b', 'a1720000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Firm A's passenger leaves Goiânia in an hour; firm B's flight is in a week.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, consent_wording, consent_at,
                                  consent_channel, watch) values
  ('e1720000-0000-4000-8000-00000000000a', 'b1720000-0000-4000-8000-00000000000a', 'Mariana Teste', '5562999990001', 'LA',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware'),
  ('e1720000-0000-4000-8000-00000000000b', 'b1720000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990003', 'G3',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware');
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                 scheduled_departure_local, scheduled_arrival_local) values
  ('b1720000-0000-4000-8000-00000000000a', 'e1720000-0000-4000-8000-00000000000a', 1, 'LA3456', 'GYN', 'GRU',
   (now() at time zone 'America/Sao_Paulo') + interval '1 hour', (now() at time zone 'America/Sao_Paulo') + interval '2 hours 45 minutes'),
  ('b1720000-0000-4000-8000-00000000000b', 'e1720000-0000-4000-8000-00000000000b', 1, 'G31450', 'BSB', 'GIG',
   (now() at time zone 'America/Sao_Paulo') + interval '7 days', (now() at time zone 'America/Sao_Paulo') + interval '7 days 2 hours');

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

select pg_temp.backend('trips', $$select public.trip_day_trips(50)$$);
select ok(
  (select count(*) = 1 from jsonb_array_elements((select payload from res where name = 'trips')) t
   where t ->> 'trip_id' = 'e1720000-0000-4000-8000-00000000000a'
     and abs(extract(epoch from ((t -> 'legs' -> 0 ->> 'departure_at')::timestamptz - (now() + interval '1 hour')))) < 120)
  and not exists (select 1 from jsonb_array_elements((select payload from res where name = 'trips')) t
                  where t ->> 'trip_id' = 'e1720000-0000-4000-8000-00000000000b'),
  'the trips whose day owes a word now are read, each leg''s departure as an instant at its airport'
);

select ok(
  (select public.leg_instant(timestamp '2099-10-22 10:00', 'MAO')) = timestamptz '2099-10-22 14:00+00'
  and (select public.leg_instant(timestamp '2099-10-22 10:00', 'ZZZ')) = timestamptz '2099-10-22 13:00+00',
  'a leg''s local moment is an instant by its airport''s offset, Brasília''s where none is known'
);

select pg_temp.backend('real', $$select public.reserve_trip_day_message('e1720000-0000-4000-8000-00000000000a', 1, 'departure',
  array['Mariana', 'Souza Advogados', 'LA 3456 de Goiânia (GYN) para São Paulo (GRU)'])$$);
select pg_temp.backend('again', $$select public.reserve_trip_day_message('e1720000-0000-4000-8000-00000000000a', 1, 'departure',
  array['Mariana', 'Souza Advogados', 'LA 3456 de Goiânia (GYN) para São Paulo (GRU)'])$$);
select ok(
  pg_temp.got('real', 'reason') = 'not_released' and pg_temp.got('again', 'code') = 'already'
  and (select status = 'skipped' and reason = 'not_released' from public.trip_day_messages
       where trip_id = 'e1720000-0000-4000-8000-00000000000a' and journey = 1 and kind = 'departure'),
  'a real passenger is written nothing before the platform''s release, kept so it is never tried again'
);

insert into public.flight_alerts (org_id, trip_id, kind, rule_version, status, sent_at, journey, legs) values
  ('b1720000-0000-4000-8000-00000000000a', 'e1720000-0000-4000-8000-00000000000a', 'delayed', 'flight-problem-v4', 'sent', now(), 1, array[1]);
select pg_temp.backend('told', $$select public.reserve_trip_day_message('e1720000-0000-4000-8000-00000000000a', 1, 'arrival',
  array['Mariana', 'Souza Advogados', 'LA 3456 de Goiânia (GYN) para São Paulo (GRU)'])$$);
select is(pg_temp.got('told', 'reason'), 'problem_told', 'a journey whose problem was told is written nothing more');

select pg_temp.backend('bad', $$select public.reserve_trip_day_message('e1720000-0000-4000-8000-00000000000a', 1, 'boas_vindas', null)$$);
select is(pg_temp.got('bad', 'code'), 'invalid_data', 'a kind that is not one is refused');

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1720000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::integer from public.trip_day_messages),
  0,
  'firm B reads nothing of what was written of firm A''s trip'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.reserve_trip_day_message(uuid, integer, text, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.trip_day_trips(integer, uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.trip_day_messages', 'INSERT'),
  'only the backend writes the day of a trip'
);

select * from finish();
rollback;
