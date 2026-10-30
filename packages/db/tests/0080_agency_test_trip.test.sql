begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- A trip an agency registered keeps its day in the test chat (0076): the
-- tools make its problem happen on the day the agency wrote, while a ready
-- trip of the chat is still moved to the day it is used. Two firms: the
-- second's trip is no trip of the first's chat.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-agenciateste.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-agenciateste.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-agenciateste', 'a8000000-0000-4000-8000-000000000001'),
  ('b8000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-agenciateste', 'a8000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c8000000-0000-4000-8000-00000000000a', 'b8000000-0000-4000-8000-00000000000a', 'whatsapp', 'agenciateste-waba-a',
   'Chat de teste', 'connected', 'a8000000-0000-4000-8000-000000000001', now());

-- Firm A's agency, its passenger with the test chat's number, and the trip the agency wrote for three days ahead.
insert into public.partners (id, name) values ('c8000000-0000-4000-8000-0000000000aa', 'Viagens Sol');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d8000000-0000-4000-8000-00000000000a', 'c8000000-0000-4000-8000-0000000000aa', 'b8000000-0000-4000-8000-00000000000a',
   'direito-do-passageiro');
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone) values
  ('f8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-0000000000aa', 'd8000000-0000-4000-8000-00000000000a',
   'b8000000-0000-4000-8000-00000000000a', 'Mariana Teste', '1988-03-02', '5500988880006');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('18000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-0000000000aa', 'd8000000-0000-4000-8000-00000000000a',
   'b8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000001', 'AGT123');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b8000000-0000-4000-8000-00000000000a',
  'c8000000-0000-4000-8000-00000000000a', 'test', 'agenciateste-number-a', 'agenciateste-waba-a', '5500900000081',
  'Souza Advogados', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b8000000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('w', 43), 'a8000000-0000-4000-8000-000000000001'));
reset role;

-- The agency's trip, followed by the test chat as the passenger's agreement makes it (0071), and a trip of firm B.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording,
                                  consent_at, consent_channel, status, watch, pax_trip_id) values
  ('28000000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-00000000000a', 'Mariana Teste', '5500988880006', 'LA',
   true, 'agencia', 'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching',
   'simulated', '18000000-0000-4000-8000-000000000001'),
  ('28000000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990002', 'G3',
   true, 'cancelamento', 'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'test', 'watching',
   'simulated', null);
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                 scheduled_departure_local, scheduled_arrival_local) values
  ('b8000000-0000-4000-8000-00000000000a', '28000000-0000-4000-8000-000000000001', 1, 'LA3456', 'GRU', 'REC',
   ((now() at time zone 'America/Sao_Paulo')::date + 3) + time '08:10', ((now() at time zone 'America/Sao_Paulo')::date + 3) + time '11:25'),
  ('b8000000-0000-4000-8000-00000000000b', '28000000-0000-4000-8000-000000000002', 1, 'G31450', 'BSB', 'GIG',
   ((now() at time zone 'America/Sao_Paulo')::date - 2) + time '14:00', ((now() at time zone 'America/Sao_Paulo')::date - 2) + time '15:45');

-- A ready trip of firm A's chat, made days ago.
update public.tracked_legs l set
  scheduled_departure_local = l.scheduled_departure_local - interval '4 days',
  scheduled_arrival_local = l.scheduled_arrival_local - interval '4 days'
from public.tracked_trips t
where t.id = l.trip_id and t.org_id = 'b8000000-0000-4000-8000-00000000000a' and t.label = 'cancelamento';

select pg_temp.as_backend();
set local role service_role;
insert into res values ('agency_tool', public.test_chat_set_legs(repeat('w', 43), '28000000-0000-4000-8000-000000000001',
  '[{"position": 1, "status": "cancelled"}]'::jsonb));
insert into res values ('ready_tool', public.test_chat_set_legs(repeat('w', 43),
  (select t.id from public.tracked_trips t where t.org_id = 'b8000000-0000-4000-8000-00000000000a' and t.label = 'cancelamento'),
  '[{"position": 1, "status": "cancelled"}]'::jsonb));
insert into res values ('other_firm', public.test_chat_set_legs(repeat('w', 43), '28000000-0000-4000-8000-000000000002',
  '[{"position": 1, "status": "cancelled"}]'::jsonb));
reset role;

select is(
  (select l.scheduled_departure_local::date from public.tracked_legs l where l.trip_id = '28000000-0000-4000-8000-000000000001'),
  (now() at time zone 'America/Sao_Paulo')::date + 3,
  'a trip the agency registered keeps the day the agency wrote when a tool makes its problem happen'
);

select is(
  (select l.status from public.tracked_legs l where l.trip_id = '28000000-0000-4000-8000-000000000001'),
  'cancelled',
  'and the tool made its problem happen'
);

select is(
  (select min(l.scheduled_departure_local)::date from public.tracked_legs l
   join public.tracked_trips t on t.id = l.trip_id
   where t.org_id = 'b8000000-0000-4000-8000-00000000000a' and t.label = 'cancelamento'),
  (now() at time zone 'America/Sao_Paulo')::date,
  'a ready trip of the chat is still moved to the day it is used'
);

select is(pg_temp.got('other_firm', 'code'), 'trip_not_found', 'a trip of another firm is no trip of this chat');

select is(
  (select l.scheduled_departure_local::date from public.tracked_legs l where l.trip_id = '28000000-0000-4000-8000-000000000002'),
  (now() at time zone 'America/Sao_Paulo')::date - 2,
  'and it is left as it was'
);

select * from finish();
rollback;
