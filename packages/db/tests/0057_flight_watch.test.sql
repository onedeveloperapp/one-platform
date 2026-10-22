begin;
create extension if not exists pgtap;
select plan(15);

-- ============================================================
-- ONE follows a trip's flights at FlightAware (0051): the trips in their
-- window are claimed under a number, within the platform's daily reads;
-- what FlightAware said of each leg is kept on it; the test chat's ready
-- trips are never read anywhere, and its real flight is; ONE's first word to
-- a real passenger waits for the operator's release, given with the note of
-- the legal opinion. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-voos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-voos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a5700000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one-voos.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a5700000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b5700000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-voos', 'a5700000-0000-4000-8000-000000000001'),
  ('b5700000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-voos', 'a5700000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5700000-0000-4000-8000-00000000000a', 'a5700000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5700000-0000-4000-8000-00000000000b', 'a5700000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c5700000-0000-4000-8000-00000000000a', 'b5700000-0000-4000-8000-00000000000a', 'whatsapp', 'voos-waba-a', 'Chat de teste',
   'connected', 'a5700000-0000-4000-8000-000000000001', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A real passenger's trip as a firm keeps one, with its legs around now (Brasília).
create function pg_temp.real_trip(firm uuid, phone text, starts interval) returns uuid language plpgsql as $$
declare
  trip uuid;
  here timestamp := (now() at time zone 'America/Sao_Paulo')::timestamp(0);
begin
  insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel)
  values (firm, 'Helena Teste', phone, 'G3',
          'Concordo em receber, pelo WhatsApp do escritório, avisos sobre a minha viagem.', now(), 'firm')
  returning id into trip;
  insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                   scheduled_departure_local, scheduled_arrival_local)
  values (firm, trip, 1, 'G31702', 'CGH', 'SDU', here + starts, here + starts + interval '1 hour'),
         (firm, trip, 2, 'G31840', 'SDU', 'SSA', here + starts + interval '2 hours', here + starts + interval '4 hours');
  return trip;
end;
$$;

-- Firm A has a test chat (four ready trips) and two real passengers, one flying now and one in two weeks;
-- firm B a real passenger flying now.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b5700000-0000-4000-8000-00000000000a',
  'c5700000-0000-4000-8000-00000000000a', 'test', 'voos-number-a', 'voos-waba-a', '5500900000071', 'Souza Advogados', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b5700000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('v', 43), 'a5700000-0000-4000-8000-000000000001'));
reset role;
insert into res values ('helena', jsonb_build_object('id', pg_temp.real_trip('b5700000-0000-4000-8000-00000000000a', '5511988887771', interval '1 hour')));
insert into res values ('later', jsonb_build_object('id', pg_temp.real_trip('b5700000-0000-4000-8000-00000000000a', '5511988887772', interval '14 days')));
insert into res values ('rocha', jsonb_build_object('id', pg_temp.real_trip('b5700000-0000-4000-8000-00000000000b', '5511988887773', interval '30 minutes')));

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', jsonb_build_object('items', public.claim_trip_watch(10)));
insert into res values ('claimed_again', jsonb_build_object('items', public.claim_trip_watch(10)));
reset role;

select ok(
  (select bool_and(t.watch = 'simulated') from public.tracked_trips t
   where t.org_id = 'b5700000-0000-4000-8000-00000000000a' and t.is_test)
  and (select count(*) = 4 from public.tracked_trips t where t.org_id = 'b5700000-0000-4000-8000-00000000000a' and t.is_test),
  'the test chat''s ready trips are made to happen by its tools, never read anywhere'
);

select throws_ok(
  $$insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel, watch)
    values ('b5700000-0000-4000-8000-00000000000b', 'Outra Teste', '5511988887779', 'LA',
            'Concordo em receber avisos sobre a minha viagem.', now(), 'firm', 'simulated')$$,
  '23514', null, 'a real passenger''s trip is only ever read at its source'
);

select ok(
  (select array_agg(item ->> 'trip_id' order by item ->> 'trip_id')
   from res, jsonb_array_elements(payload -> 'items') as x (item) where name = 'claimed')
    = (select array_agg(id::text order by id::text) from (values (pg_temp.got('helena', 'id')::uuid), (pg_temp.got('rocha', 'id')::uuid)) v (id))
  and jsonb_array_length((select payload -> 'items' from res where name = 'claimed_again')) = 0
  and (select jsonb_array_length(item -> 'legs') = 2 from res, jsonb_array_elements(payload -> 'items') as x (item)
       where name = 'claimed' and item ->> 'trip_id' = pg_temp.got('helena', 'id')),
  'the trips in their window are claimed once, with their legs, and a trip of two weeks ahead waits'
);

select ok(
  (select sum(t.watch_reads) = 4 from public.tracked_trips t
   where t.watch_day = (now() at time zone 'America/Sao_Paulo')::date),
  'each leg read counts against the platform''s daily reads'
);

-- FlightAware said: Helena's first leg is late, the second cancelled; Rocha's trip could not be read whole.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('recorded', public.record_trip_watch(pg_temp.got('helena', 'id')::uuid,
  (select (item ->> 'claim')::integer from res, jsonb_array_elements(payload -> 'items') as x (item)
   where name = 'claimed' and item ->> 'trip_id' = pg_temp.got('helena', 'id')),
  jsonb_build_array(
    jsonb_build_object('position', 1, 'status', 'delayed',
      'estimated_arrival', to_char((now() at time zone 'America/Sao_Paulo') + interval '6 hours', 'YYYY-MM-DD"T"HH24:MI')),
    jsonb_build_object('position', 2, 'status', 'cancelled', 'estimated_arrival', '2099-01-01T00:00'),
    jsonb_build_object('position', 3, 'status', 'landed'),
    jsonb_build_object('position', 1, 'status', 'delayed')
  ), null));
insert into res values ('wrong_claim', public.record_trip_watch(pg_temp.got('rocha', 'id')::uuid, 999, '[]'::jsonb, null));
select public.release_trip_watch(pg_temp.got('rocha', 'id')::uuid,
  (select (item ->> 'claim')::integer from res, jsonb_array_elements(payload -> 'items') as x (item)
   where name = 'claimed' and item ->> 'trip_id' = pg_temp.got('rocha', 'id')));
insert into res values ('rocha_again', jsonb_build_object('items', public.claim_trip_watch(10, pg_temp.got('rocha', 'id')::uuid)));
reset role;

select ok(
  pg_temp.got('recorded', 'ok')::boolean
  and (select l.status = 'delayed' and l.status_source = 'flightaware' and l.estimated_arrival_local is not null
       from public.tracked_legs l where l.trip_id = pg_temp.got('helena', 'id')::uuid and l.position = 1)
  and (select l.status = 'cancelled' and l.estimated_arrival_local is null
       from public.tracked_legs l where l.trip_id = pg_temp.got('helena', 'id')::uuid and l.position = 2)
  and (select t.watched_at is not null and t.watch_claimed_at is null from public.tracked_trips t
       where t.id = pg_temp.got('helena', 'id')::uuid)
  and jsonb_array_length((select payload -> 'legs' from res where name = 'recorded')) = 2
  and (select (payload ->> 'delay_minutes')::integer = 240 from res where name = 'recorded'),
  'what FlightAware said of each leg is kept on it, a delay with when it is now expected, a cancellation with none'
);

select ok(
  pg_temp.got('wrong_claim', 'code') = 'not_working'
  and jsonb_array_length((select payload -> 'items' from res where name = 'rocha_again')) = 1,
  'only the claim holder records, and a claim given back is read again'
);

-- The ceiling: a platform that read its day's legs reads nothing more.
update public.platform_settings set value = value || '{"watch_daily_reads": 6}'::jsonb where key = 'flight_alerts';
update public.tracked_trips set watch_claimed_at = null, watched_at = null where id = pg_temp.got('helena', 'id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('ceiling', jsonb_build_object('items', public.claim_trip_watch(10)));
reset role;
update public.platform_settings set value = value || '{"watch_daily_reads": 400}'::jsonb where key = 'flight_alerts';

select is(
  jsonb_array_length((select payload -> 'items' from res where name = 'ceiling')),
  0, 'past the platform''s daily reads, nothing more is read at FlightAware'
);

-- ONE's first word to a real passenger: held until the platform releases it.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('alert', public.record_flight_alert(pg_temp.got('helena', 'id')::uuid, 'cancelled', 2, null, 'flight-problem-v1'));
insert into res values ('alert_claim', jsonb_build_object('claim',
  (public.claim_flight_alerts(1, pg_temp.got('alert', 'alert_id')::uuid) -> 0) ->> 'claim'));
insert into res values ('held', public.reserve_flight_alert(pg_temp.got('alert', 'alert_id')::uuid,
  pg_temp.got('alert_claim', 'claim')::integer,
  array['Helena', 'Souza Advogados', 'Voo de teste', 'foi cancelado', 'oferecer outro voo']));
reset role;

select ok(
  pg_temp.got('held', 'code') = 'skipped' and pg_temp.got('held', 'reason') = 'not_released'
  and (select a.status = 'skipped' and a.reason = 'not_released' from public.flight_alerts a
       where a.id = pg_temp.got('alert', 'alert_id')::uuid),
  'ONE''s first word to a real passenger is kept and not sent while the platform has not released it'
);

-- The release: an operator only, with the second factor and the note of the legal opinion.
select pg_temp.sign_in('a5700000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.admin_set_flight_alerts_release(true, 'Parecer jurídico favorável, nota 1/2026.')$$,
  '42501', null, 'a firm never releases ONE''s first word to real passengers');
reset role;
select pg_temp.sign_in('a5700000-0000-4000-8000-000000000009', 'aal1');
set local role authenticated;
select throws_ok($$select public.admin_set_flight_alerts_release(true, 'Parecer jurídico favorável, nota 1/2026.')$$,
  '42501', null, 'the operator releases it with the second factor');
reset role;
select pg_temp.sign_in('a5700000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('no_note', public.admin_set_flight_alerts_release(true, 'curta'));
insert into res values ('released', public.admin_set_flight_alerts_release(true, 'Parecer jurídico favorável, nota 1/2026.'));
insert into res values ('status', public.admin_flight_watch_status());
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('alert_later', public.record_flight_alert(pg_temp.got('rocha', 'id')::uuid, 'cancelled', 1, null, 'flight-problem-v1'));
insert into res values ('later_claim', jsonb_build_object('claim',
  (public.claim_flight_alerts(1, pg_temp.got('alert_later', 'alert_id')::uuid) -> 0) ->> 'claim'));
insert into res values ('after_release', public.reserve_flight_alert(pg_temp.got('alert_later', 'alert_id')::uuid,
  pg_temp.got('later_claim', 'claim')::integer,
  array['Helena', 'Rocha Advocacia', 'Voo de teste', 'foi cancelado', 'oferecer outro voo']));
reset role;

select ok(
  pg_temp.got('no_note', 'code') = 'note_required' and pg_temp.got('released', 'code') = 'released'
  and (select (value ->> 'released')::boolean and value ->> 'released_note' = 'Parecer jurídico favorável, nota 1/2026.'
       from public.platform_settings where key = 'flight_alerts')
  and exists (select 1 from public.audit_events e where e.action = 'flight_alerts.released'
              and e.actor_id = 'a5700000-0000-4000-8000-000000000009'),
  'the operator releases it with the note of the legal opinion, on the record'
);

select ok(
  pg_temp.got('after_release', 'code') = 'skipped' and pg_temp.got('after_release', 'reason') <> 'not_released'
  and (select (payload ->> 'released')::boolean and (payload ->> 'held_alerts')::integer = 1
              and (payload ->> 'following_real')::integer = 3 and (payload ->> 'daily_reads')::integer = 400
       from res where name = 'status'),
  'once released, a real passenger''s word goes as any other would, and the operator reads how the following stands'
);

-- A real flight in the test chat.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('follow', public.test_chat_follow_flight(repeat('v', 43), jsonb_build_array(
  jsonb_build_object('position', 1, 'flight_number', 'LA3300', 'origin', 'GRU', 'destination', 'BSB',
    'departure', to_char((now() at time zone 'America/Sao_Paulo') + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI'),
    'arrival', to_char((now() at time zone 'America/Sao_Paulo') + interval '4 hours', 'YYYY-MM-DD"T"HH24:MI')))));
insert into res values ('follow_again', public.test_chat_follow_flight(repeat('v', 43), jsonb_build_array(
  jsonb_build_object('position', 1, 'flight_number', 'G31010', 'origin', 'GRU', 'destination', 'POA',
    'departure', to_char((now() at time zone 'America/Sao_Paulo') + interval '3 hours', 'YYYY-MM-DD"T"HH24:MI'),
    'arrival', to_char((now() at time zone 'America/Sao_Paulo') + interval '5 hours', 'YYYY-MM-DD"T"HH24:MI')))));
insert into res values ('follow_bad', public.test_chat_follow_flight(repeat('v', 43), jsonb_build_array(
  jsonb_build_object('position', 1, 'flight_number', 'nada', 'origin', 'GRU', 'destination', 'GRU',
    'departure', 'amanhã', 'arrival', 'depois'))));
insert into res values ('follow_missing', public.test_chat_follow_flight(repeat('x', 43), '[]'::jsonb));
insert into res values ('real_claimed', jsonb_build_object('items', public.claim_trip_watch(10, pg_temp.got('follow_again', 'trip_id')::uuid)));
insert into res values ('real_tool', public.test_chat_set_legs(repeat('v', 43), pg_temp.got('follow_again', 'trip_id')::uuid,
  '[{"position": 1, "status": "cancelled"}]'::jsonb, false));
insert into res values ('real_reset', public.test_chat_set_legs(repeat('v', 43), pg_temp.got('follow_again', 'trip_id')::uuid, null, true));
reset role;

select ok(
  pg_temp.got('follow', 'code') = 'following' and pg_temp.got('follow_again', 'code') = 'following'
  and (select count(*) = 1 from public.tracked_trips t where t.org_id = 'b5700000-0000-4000-8000-00000000000a' and t.label = 'voo_real')
  and (select t.is_test and t.watch = 'flightaware' and t.airline_iata = 'G3' and t.consent_channel = 'test'
       from public.tracked_trips t where t.id = pg_temp.got('follow_again', 'trip_id')::uuid)
  and (select l.flight_number = 'G31010' from public.tracked_legs l where l.trip_id = pg_temp.got('follow_again', 'trip_id')::uuid)
  and jsonb_array_length((select payload -> 'items' from res where name = 'real_claimed')) = 1,
  'the test chat follows a real flight, one at a time, read at FlightAware like a real passenger''s'
);

select ok(
  pg_temp.got('follow_bad', 'code') = 'invalid_legs' and pg_temp.got('follow_missing', 'code') = 'not_found'
  and (select count(*) = 1 from public.tracked_trips t where t.org_id = 'b5700000-0000-4000-8000-00000000000a' and t.label = 'voo_real'),
  'a flight that is not one, or a link that opens nothing, follows nothing and leaves the flight followed as it was'
);

select ok(
  pg_temp.got('real_tool', 'code') = 'real_flight' and pg_temp.got('real_reset', 'ok')::boolean
  and (select l.status = 'scheduled' and l.scheduled_departure_local::date = ((now() at time zone 'America/Sao_Paulo') + interval '3 hours')::date
       from public.tracked_legs l where l.trip_id = pg_temp.got('follow_again', 'trip_id')::uuid),
  'no tool makes a real flight happen, and started over it keeps its own day'
);

select * from finish();
rollback;
