begin;
create extension if not exists pgtap;
select plan(25);

-- ============================================================
-- What the review of the agency's area found, put right (0074). An agreement
-- covers who gave it and the children it was given for, at the WhatsApp it
-- was given with: an adult who goes along is followed only on the trips they
-- hold and never handed to the firm by another's yes; another holder or
-- another WhatsApp waits for an agreement again; taking it back stops a trip
-- told of a problem, and a yes after it opens nothing with the agency's
-- record. One firm's share of the flight reads holds no other firm back, and
-- each leg is read around its own flight. Forgetting a passenger forgets what
-- the AI read of them and touches only their trips; a deletion on the link
-- keeps nothing of the request; the passenger's rights outlive the
-- partnership. And the smaller ones: an upload whose answer was lost, a date
-- that is no date, an abandoned upload in no firm's audit, a ceiling of
-- readings a day, a ceiling of passengers on a trip, the legs in the order
-- they fly. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-salvaguarda.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-salvaguarda.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-salvaguarda.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a7800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@mar-salvaguarda.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b7800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-salvaguarda', 'a7800000-0000-4000-8000-000000000001'),
  ('b7800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-salvaguarda', 'a7800000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7800000-0000-4000-8000-00000000000a', 'a7800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7800000-0000-4000-8000-00000000000b', 'a7800000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a', 'whatsapp', 'guard-waba-a', 'Chat de teste',
   'connected', 'a7800000-0000-4000-8000-000000000001', now());
insert into public.partners (id, name) values
  ('c7800000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c7800000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c7800000-0000-4000-8000-0000000000aa', 'a7800000-0000-4000-8000-000000000003', 'owner'),
  ('c7800000-0000-4000-8000-0000000000bb', 'a7800000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d7800000-0000-4000-8000-00000000000b', 'c7800000-0000-4000-8000-0000000000bb', 'b7800000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c7800000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.'),
  ('c7800000-0000-4000-8000-0000000000bb', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');

-- The agency Sol's passengers: two adults who travel together, a child of each, and others for each case below.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, cpf, birth_date, phone) values
  ('f7800000-0000-4000-8000-000000000001', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Rafaela Teste Lima', null, '1990-04-12', '5562999990001'),
  ('f7800000-0000-4000-8000-000000000002', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Bruno Teste', null, '1985-01-20', '5562999990002'),
  ('f7800000-0000-4000-8000-000000000005', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Marta Teste', null, '1979-07-07', '5500988880006'),
  ('f7800000-0000-4000-8000-000000000006', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Pedro Teste', null, '1982-02-02', null),
  ('f7800000-0000-4000-8000-000000000007', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Xavier Teste', null, '1975-05-05', null),
  ('f7800000-0000-4000-8000-000000000008', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Gabi Teste', null, '1988-08-08', '5562999990008'),
  ('f7800000-0000-4000-8000-000000000009', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Ivo Teste', null, null, null),
  ('f7800000-0000-4000-8000-000000000010', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Nina Teste', null, '1992-09-09', '5562999990010'),
  -- The agency Mar's passengers, with firm B.
  ('f7800000-0000-4000-8000-000000000011', 'c7800000-0000-4000-8000-0000000000bb', 'd7800000-0000-4000-8000-00000000000b',
   'b7800000-0000-4000-8000-00000000000b', 'Vera Teste', null, '1970-10-10', '5562999990011'),
  ('f7800000-0000-4000-8000-000000000012', 'c7800000-0000-4000-8000-0000000000bb', 'd7800000-0000-4000-8000-00000000000b',
   'b7800000-0000-4000-8000-00000000000b', 'Wanda Teste', null, '1971-11-11', null);
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, guardian_id) values
  ('f7800000-0000-4000-8000-000000000003', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Lia Teste', (current_date - interval '8 years')::date,
   'f7800000-0000-4000-8000-000000000001'),
  ('f7800000-0000-4000-8000-000000000004', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'Otto Teste', (current_date - interval '6 years')::date,
   'f7800000-0000-4000-8000-000000000002');

-- Rafaela's trip, with Bruno, Lia and Otto; Rafaela's second trip, with Pedro and Lia; Marta's; Gabi's two, one of
-- them with Xavier.
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('17800000-0000-4000-8000-000000000001', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'f7800000-0000-4000-8000-000000000001', 'GRD101'),
  ('17800000-0000-4000-8000-000000000002', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'f7800000-0000-4000-8000-000000000001', 'GRD102'),
  ('17800000-0000-4000-8000-000000000005', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'f7800000-0000-4000-8000-000000000005', 'GRD105'),
  ('17800000-0000-4000-8000-000000000008', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'f7800000-0000-4000-8000-000000000008', 'GRD108'),
  ('17800000-0000-4000-8000-000000000009', 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a',
   'b7800000-0000-4000-8000-00000000000a', 'f7800000-0000-4000-8000-000000000008', 'GRD109');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('17800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000001'),
  ('17800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000002'),
  ('17800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000003'),
  ('17800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000004'),
  ('17800000-0000-4000-8000-000000000002', 'f7800000-0000-4000-8000-000000000001'),
  ('17800000-0000-4000-8000-000000000002', 'f7800000-0000-4000-8000-000000000006'),
  ('17800000-0000-4000-8000-000000000002', 'f7800000-0000-4000-8000-000000000003'),
  ('17800000-0000-4000-8000-000000000005', 'f7800000-0000-4000-8000-000000000005'),
  ('17800000-0000-4000-8000-000000000008', 'f7800000-0000-4000-8000-000000000008'),
  ('17800000-0000-4000-8000-000000000008', 'f7800000-0000-4000-8000-000000000007'),
  ('17800000-0000-4000-8000-000000000009', 'f7800000-0000-4000-8000-000000000008');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('17800000-0000-4000-8000-000000000001', 1, 'LA3456', 'GRU', 'REC', current_date + 30 + time '08:10', current_date + 30 + time '11:25'),
  ('17800000-0000-4000-8000-000000000002', 1, 'LA3456', 'GRU', 'REC', current_date + 40 + time '08:10', current_date + 40 + time '11:25'),
  ('17800000-0000-4000-8000-000000000005', 1, 'LA3456', 'GRU', 'REC', current_date + time '08:10', current_date + time '11:25'),
  ('17800000-0000-4000-8000-000000000008', 1, 'G31450', 'BSB', 'GIG', current_date + 20 + time '14:00', current_date + 20 + time '15:45'),
  ('17800000-0000-4000-8000-000000000009', 1, 'AD4010', 'VCP', 'CNF', current_date + 25 + time '07:00', current_date + 25 + time '08:10');

-- The links: one of each adult who answers here, and Vera's, replaced once.
insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, expires_at, created_at, ended_at) values
  ('c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000001', encode(sha256(convert_to('salvaguarda-rafaela-000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now(), null),
  ('c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000002', encode(sha256(convert_to('salvaguarda-bruno-0000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now(), null),
  ('c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000005', encode(sha256(convert_to('salvaguarda-marta-0000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now(), null),
  ('c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000008', encode(sha256(convert_to('salvaguarda-gabi-00000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now(), null),
  ('c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000010', encode(sha256(convert_to('salvaguarda-nina-00000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now(), null),
  ('c7800000-0000-4000-8000-0000000000bb', 'd7800000-0000-4000-8000-00000000000b', 'b7800000-0000-4000-8000-00000000000b',
   'f7800000-0000-4000-8000-000000000011', encode(sha256(convert_to('salvaguarda-vera-antigo-0000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now() - interval '2 days', now() - interval '1 day'),
  ('c7800000-0000-4000-8000-0000000000bb', 'd7800000-0000-4000-8000-00000000000b', 'b7800000-0000-4000-8000-00000000000b',
   'f7800000-0000-4000-8000-000000000011', encode(sha256(convert_to('salvaguarda-vera-novo-000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now(), null);

-- ONE answers at once here: a test is one transaction, and every message in it is of the same moment.
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.tracked(trip uuid) returns public.tracked_trips language sql as
$$ select t.* from public.tracked_trips t where t.pax_trip_id = trip; $$;

insert into res
select 'w_' || x.name, jsonb_build_object('text', public.pax_consent_wording(x.id))
from (values ('rafaela', 'f7800000-0000-4000-8000-000000000001'::uuid), ('bruno', 'f7800000-0000-4000-8000-000000000002'::uuid),
             ('marta', 'f7800000-0000-4000-8000-000000000005'::uuid), ('gabi', 'f7800000-0000-4000-8000-000000000008'::uuid))
  as x (name, id);

-- ---------- An agreement covers who gave it and the children it was given for ----------

select pg_temp.anonymous();
set local role anon;
insert into res values ('rafaela_agreed', public.pax_link_answer('salvaguarda-rafaela-000000000000', 'agreed',
  pg_temp.got('w_rafaela', 'text')));
insert into res values ('rafaela_open', public.pax_link_open('salvaguarda-rafaela-000000000000'));
reset role;

select ok(
  pg_temp.got('rafaela_agreed', 'followed') = '2'
  and jsonb_array_length((pg_temp.tracked('17800000-0000-4000-8000-000000000001')).companions) = 1
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).companions -> 0 ->> 'pax_traveler_id'
      = 'f7800000-0000-4000-8000-000000000003',
  'a trip ONE follows names along only the children its holder agreed for'
);
select ok(
  (select p.value ->> 'phone_end' from jsonb_array_elements(pg_temp.got('rafaela_open', 'people')::jsonb) p
   where (p.value ->> 'is_holder')::boolean) = '0001'
  and (select count(*) from jsonb_array_elements(pg_temp.got('rafaela_open', 'people')::jsonb) p
       where p.value ->> 'phone_end' is not null) = 1,
  'the link shows the end of the WhatsApp the alerts go to, and only the adult''s'
);

-- Bruno agrees for himself and Otto; the agency then saves Rafaela's trip as it was.
select pg_temp.anonymous();
set local role anon;
insert into res values ('bruno_agreed', public.pax_link_answer('salvaguarda-bruno-0000000000000000', 'agreed',
  pg_temp.got('w_bruno', 'text')));
reset role;
select pg_temp.sign_in('a7800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('resaved', public.pax_save_trip('d7800000-0000-4000-8000-00000000000a',
  '17800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000001',
  array['f7800000-0000-4000-8000-000000000002', 'f7800000-0000-4000-8000-000000000003',
        'f7800000-0000-4000-8000-000000000004']::uuid[], 'GRD101',
  jsonb_build_array(jsonb_build_object('flight_number', 'LA3456', 'origin_iata', 'GRU', 'destination_iata', 'REC',
    'departure', to_char(current_date + 30 + time '08:10', 'YYYY-MM-DD"T"HH24:MI'),
    'arrival', to_char(current_date + 30 + time '11:25', 'YYYY-MM-DD"T"HH24:MI')))));
reset role;
select ok(
  pg_temp.got('bruno_agreed', 'followed') = '0' and pg_temp.got('resaved', 'code') = 'saved'
  and jsonb_array_length((pg_temp.tracked('17800000-0000-4000-8000-000000000001')).companions) = 1
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).companions -> 0 ->> 'name' = 'Lia Teste',
  'an adult who agreed for themself is followed on the trips they hold, never along on somebody else''s'
);

-- The agency makes Bruno the holder of that trip.
select pg_temp.sign_in('a7800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('new_holder', public.pax_save_trip('d7800000-0000-4000-8000-00000000000a',
  '17800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000002',
  array['f7800000-0000-4000-8000-000000000001', 'f7800000-0000-4000-8000-000000000003',
        'f7800000-0000-4000-8000-000000000004']::uuid[], 'GRD101',
  jsonb_build_array(jsonb_build_object('flight_number', 'LA3456', 'origin_iata', 'GRU', 'destination_iata', 'REC',
    'departure', to_char(current_date + 30 + time '08:10', 'YYYY-MM-DD"T"HH24:MI'),
    'arrival', to_char(current_date + 30 + time '11:25', 'YYYY-MM-DD"T"HH24:MI')))));
reset role;
select ok(
  pg_temp.got('new_holder', 'code') = 'saved'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).id is null
  and public.pax_trip_state('17800000-0000-4000-8000-000000000001') = 'waiting_consent',
  'another holder waits for their own agreement: what ONE followed was the one before''s'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('bruno_again', public.pax_link_answer('salvaguarda-bruno-0000000000000000', 'agreed',
  pg_temp.got('w_bruno', 'text')));
reset role;
select ok(
  pg_temp.got('bruno_again', 'followed') = '1'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).phone = '5562999990002'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).passenger_name = 'Bruno Teste'
  and jsonb_array_length((pg_temp.tracked('17800000-0000-4000-8000-000000000001')).companions) = 1
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).companions -> 0 ->> 'name' = 'Otto Teste',
  'agreeing again follows the trip under its new holder, with the children that holder agreed for'
);

-- The agency writes another WhatsApp for Bruno.
select pg_temp.sign_in('a7800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('new_phone', public.pax_save_traveler('d7800000-0000-4000-8000-00000000000a',
  'f7800000-0000-4000-8000-000000000002', '{"phone": "62999990009"}'::jsonb, null));
reset role;
select ok(
  pg_temp.got('new_phone', 'code') = 'saved'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).id is null
  and public.pax_trip_state('17800000-0000-4000-8000-000000000001') = 'waiting_consent',
  'another WhatsApp of the holder waits for the passenger to agree with it'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('bruno_number', public.pax_link_answer('salvaguarda-bruno-0000000000000000', 'agreed',
  pg_temp.got('w_bruno', 'text'), '{}'::jsonb, '(62) 99999-0003'));
reset role;
select ok(
  pg_temp.got('bruno_number', 'followed') = '1'
  and (select phone = '5562999990003' and updated_via = 'passenger' from public.pax_travelers
       where id = 'f7800000-0000-4000-8000-000000000002')
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).phone = '5562999990003'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).status = 'watching',
  'the passenger may give another WhatsApp when they agree, and the alerts go to it'
);

-- A problem was told of the trip; then Bruno takes his agreement back.
update public.tracked_trips set status = 'alerted' where pax_trip_id = '17800000-0000-4000-8000-000000000001';
select pg_temp.anonymous();
set local role anon;
insert into res values ('bruno_withdrawn', public.pax_link_answer('salvaguarda-bruno-0000000000000000', 'withdrawn',
  pg_temp.got('w_bruno', 'text')));
reset role;
select ok(
  pg_temp.got('bruno_withdrawn', 'code') = 'withdrawn'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000001')).status = 'stopped',
  'taking the agreement back stops a trip already told of a problem too'
);

-- ---------- The handoff passes on only who the agreement covers ----------

insert into public.cases (id, org_id, seq, incident) values
  ('e7800000-0000-4000-8000-0000000000c1', 'b7800000-0000-4000-8000-00000000000a', 901, 'cancellation');
insert into public.people (id, org_id, full_name) values
  ('e7800000-0000-4000-8000-0000000000a6', 'b7800000-0000-4000-8000-00000000000a', 'Pedro Teste'),
  ('e7800000-0000-4000-8000-0000000000a3', 'b7800000-0000-4000-8000-00000000000a', 'Lia Teste');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e7800000-0000-4000-8000-0000000000d6', 'b7800000-0000-4000-8000-00000000000a', 'e7800000-0000-4000-8000-0000000000c1',
   'e7800000-0000-4000-8000-0000000000a6', 'claimant'),
  ('e7800000-0000-4000-8000-0000000000d3', 'b7800000-0000-4000-8000-00000000000a', 'e7800000-0000-4000-8000-0000000000c1',
   'e7800000-0000-4000-8000-0000000000a3', 'claimant');
insert into res values ('handed', public.pax_hand_over('b7800000-0000-4000-8000-00000000000a',
  'e7800000-0000-4000-8000-0000000000c1', '17800000-0000-4000-8000-000000000002', jsonb_build_object(
    'f7800000-0000-4000-8000-000000000006', jsonb_build_object('person', 'e7800000-0000-4000-8000-0000000000a6',
      'party', 'e7800000-0000-4000-8000-0000000000d6', 'new', true),
    'f7800000-0000-4000-8000-000000000003', jsonb_build_object('person', 'e7800000-0000-4000-8000-0000000000a3',
      'party', 'e7800000-0000-4000-8000-0000000000d3', 'new', true))));
select ok(
  pg_temp.got('handed', 'people') = '1'
  and (select handed_over_at is not null from public.pax_travelers where id = 'f7800000-0000-4000-8000-000000000003')
  and (select handed_over_at is null from public.pax_travelers where id = 'f7800000-0000-4000-8000-000000000006'),
  'the handoff passes on the child the holder agreed for, and nobody the agreement does not cover'
);

-- ---------- A yes after the agreement was taken back ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('number', public.register_wa_number('b7800000-0000-4000-8000-00000000000a',
  'c7800000-0000-4000-8000-00000000000a', 'test', 'guard-number-a', 'guard-waba-a', '5500900000078', 'Souza Advogados', 'cloud'));
insert into res values ('chat', public.start_test_chat('b7800000-0000-4000-8000-00000000000a',
  pg_temp.got('number', 'number_id')::uuid, repeat('g', 43), 'a7800000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.anonymous();
set local role anon;
insert into res values ('marta_agreed', public.pax_link_answer('salvaguarda-marta-0000000000000000', 'agreed',
  pg_temp.got('w_marta', 'text')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('alert', jsonb_build_object('id', (public.record_flight_alert(
  (pg_temp.tracked('17800000-0000-4000-8000-000000000005')).id, 'cancelled', 1, null, 'flight-problem-v2') ->> 'alert_id')));
insert into res values ('alert_claim', jsonb_build_object('claim',
  (public.claim_flight_alerts(1, pg_temp.got('alert', 'id')::uuid) -> 0) ->> 'claim'));
insert into res values ('reserved', public.reserve_flight_alert(pg_temp.got('alert', 'id')::uuid,
  pg_temp.got('alert_claim', 'claim')::integer,
  array['Marta', 'Souza Advogados', 'Voo de teste de hoje', 'foi cancelado', 'oferecer outro voo']));
insert into res values ('conversation', jsonb_build_object('id', public.wa_ingest_inbound('b7800000-0000-4000-8000-00000000000a',
  pg_temp.got('number', 'number_id')::uuid, '5500988880006', 'Marta', 'test.in.guard-1', 'button', 'SIM') ->> 'conversation_id'));
insert into res values ('turn', jsonb_build_object('claim',
  (public.claim_conversation_turns(1, pg_temp.got('conversation', 'id')::uuid) -> 0) ->> 'claim'));
reset role;
select pg_temp.anonymous();
set local role anon;
insert into res values ('marta_withdrawn', public.pax_link_answer('salvaguarda-marta-0000000000000000', 'withdrawn',
  pg_temp.got('w_marta', 'text')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('opened', public.one_open_case_from_alert(pg_temp.got('conversation', 'id')::uuid,
  pg_temp.got('turn', 'claim')::integer, pg_temp.got('alert', 'id')::uuid,
  encode(sha256(convert_to('salvaguarda-cliente-marta-0000000000000000000000', 'UTF8')), 'hex'),
  'Pronto, Marta. O escritório abriu o seu caso, número {caso}.'));
reset role;
select ok(
  pg_temp.got('marta_agreed', 'followed') = '1' and pg_temp.got('opened', 'code') = 'agency_closed'
  and (pg_temp.tracked('17800000-0000-4000-8000-000000000005')).status = 'stopped'
  and not exists (select 1 from public.cases where org_id = 'b7800000-0000-4000-8000-00000000000a' and origin = 'agency')
  and (select handed_over_at is null from public.pax_travelers where id = 'f7800000-0000-4000-8000-000000000005'),
  'a yes after the agreement was taken back opens nothing with the agency''s record'
);

-- ---------- The flight reads ----------

update public.platform_settings set value = value || '{"watch_firm_daily_reads": 2}'::jsonb where key = 'flight_alerts';
-- Their ids sort before any other trip's, so a sweep meets them first on a database that is not empty.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel,
                                  status, watch, watch_day, watch_reads) values
  -- What firm A already read today: its whole share.
  ('07800000-0000-4000-8000-000000000001', 'b7800000-0000-4000-8000-00000000000a', 'Gasta Teste', '5562999990021', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'stopped', 'flightaware',
   (now() at time zone 'America/Sao_Paulo')::date, 2),
  -- Three of firm A's trips due now, and one of firm B's.
  ('07800000-0000-4000-8000-000000000002', 'b7800000-0000-4000-8000-00000000000a', 'Leitura Um', '5562999990022', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware', null, 0),
  ('07800000-0000-4000-8000-000000000003', 'b7800000-0000-4000-8000-00000000000a', 'Leitura Dois', '5562999990023', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware', null, 0),
  ('07800000-0000-4000-8000-000000000004', 'b7800000-0000-4000-8000-00000000000a', 'Leitura Tres', '5562999990024', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware', null, 0),
  ('07800000-0000-4000-8000-00000000000b', 'b7800000-0000-4000-8000-00000000000b', 'Leitura Quatro', '5562999990025', 'G3',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware', null, 0),
  -- A round trip of firm B: the way out now, the way back in a week.
  ('07800000-0000-4000-8000-00000000000c', 'b7800000-0000-4000-8000-00000000000b', 'Ida e Volta', '5562999990026', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware', null, 0);
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                 scheduled_departure_local, scheduled_arrival_local)
select t.org_id, t.id, 1, 'LA3456', 'GRU', 'REC',
       (now() at time zone 'America/Sao_Paulo') - interval '1 hour', (now() at time zone 'America/Sao_Paulo') + interval '2 hours'
from public.tracked_trips t
where t.id in ('07800000-0000-4000-8000-000000000002', '07800000-0000-4000-8000-000000000003',
               '07800000-0000-4000-8000-000000000004', '07800000-0000-4000-8000-00000000000b',
               '07800000-0000-4000-8000-00000000000c')
union all
select t.org_id, t.id, 2, 'LA3457', 'REC', 'GRU',
       (now() at time zone 'America/Sao_Paulo') + interval '7 days', (now() at time zone 'America/Sao_Paulo') + interval '7 days 3 hours'
from public.tracked_trips t where t.id = '07800000-0000-4000-8000-00000000000c';

select pg_temp.as_backend();
set local role service_role;
insert into res values ('one_claimed', jsonb_build_object('trips', public.claim_trip_watch(1)));
insert into res values ('round_claimed', jsonb_build_object('trips',
  public.claim_trip_watch(10, '07800000-0000-4000-8000-00000000000c')));
reset role;
select ok(
  jsonb_array_length(pg_temp.got('one_claimed', 'trips')::jsonb) = 1
  and (pg_temp.got('one_claimed', 'trips')::jsonb -> 0 ->> 'trip_id') = '07800000-0000-4000-8000-00000000000b',
  'a firm that spent its share of the day holds no other firm''s trips back'
);
select ok(
  jsonb_array_length(pg_temp.got('round_claimed', 'trips')::jsonb -> 0 -> 'legs') = 1
  and (pg_temp.got('round_claimed', 'trips')::jsonb -> 0 -> 'legs' -> 0 ->> 'position') = '1'
  and (select watch_reads from public.tracked_trips where id = '07800000-0000-4000-8000-00000000000c') = 1,
  'each leg is read only around its own flight: a round trip is not read through the days in between'
);

-- ---------- Forgetting a passenger ----------

-- Gabi agrees: her two trips are followed, and FlightAware said both are late.
select pg_temp.anonymous();
set local role anon;
insert into res values ('gabi_agreed', public.pax_link_answer('salvaguarda-gabi-00000000000000000', 'agreed',
  pg_temp.got('w_gabi', 'text')));
reset role;
update public.tracked_legs l set status = 'delayed', estimated_arrival_local = l.scheduled_arrival_local + interval '5 hours',
                                 status_source = 'flightaware', status_at = now()
from public.tracked_trips t
where t.id = l.trip_id and t.pax_trip_id in ('17800000-0000-4000-8000-000000000008', '17800000-0000-4000-8000-000000000009');

-- Xavier's identity, read by the AI.
insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status,
                          sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('27800000-0000-4000-8000-000000000007', 'b7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7800000-0000-4000-8000-00000000000a/pax_document/27800000-0000-4000-8000-000000000007',
   'rg-xavier.jpg', 'image/jpeg', 2000, 'stored', repeat('a', 64), 2000, 'image/jpeg', now() + interval '1 hour', now());
insert into public.pax_documents (id, partner_id, org_id, traveler_id, kind, file_id, source, reading) values
  ('37800000-0000-4000-8000-000000000007', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000007', 'identity', '27800000-0000-4000-8000-000000000007', 'partner', 'done');
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, subject_type, subject_id,
                            status, output, cost_usd_micros, finished_at)
select '57800000-0000-4000-8000-000000000007', 'b7800000-0000-4000-8000-00000000000a', 'parceiro.documento.leitura', v.id,
       v.provider, v.model, repeat('c', 64), 'pax_document', '37800000-0000-4000-8000-000000000007', 'succeeded',
       '{"dados_lidos": {"cpf": "52998224725", "nome_completo": "Xavier Teste"}}'::jsonb, 1200, now()
from public.prompt_versions v where v.task = 'parceiro.documento.leitura' and v.version = 1;

insert into res values ('forget_x', public.pax_forget('f7800000-0000-4000-8000-000000000007', 'agency'));
select ok(
  pg_temp.got('forget_x', 'code') = 'forgotten'
  and (select output is null and cost_usd_micros = 1200 from public.ai_runs where id = '57800000-0000-4000-8000-000000000007'),
  'forgetting a passenger forgets what the AI read of their documents, and keeps the run''s cost'
);
select ok(
  pg_temp.got('gabi_agreed', 'followed') = '2'
  and (select count(*) from public.tracked_legs l join public.tracked_trips t on t.id = l.trip_id
       where t.pax_trip_id in ('17800000-0000-4000-8000-000000000008', '17800000-0000-4000-8000-000000000009')
         and l.status = 'delayed') = 2,
  'forgetting a passenger keeps what FlightAware said of the trips ONE follows'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('nina_forget', public.pax_link_forget('salvaguarda-nina-00000000000000000',
  '{"ip": "203.0.113.9", "user_agent": "navegador de teste"}'::jsonb));
reset role;
select ok(
  pg_temp.got('nina_forget', 'code') = 'forgotten'
  and (select e.metadata = '{"people": 1}'::jsonb from public.audit_events e
       where e.action = 'pax.link.forgotten' and e.entity_id = 'c7800000-0000-4000-8000-0000000000aa'),
  'a deletion asked on the link keeps nothing of the request'
);

-- ---------- The passenger's rights outlive the partnership ----------

select pg_temp.sign_in('a7800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ended', public.end_partner_link('d7800000-0000-4000-8000-00000000000b', 'Fim do contrato de teste'));
reset role;
select pg_temp.anonymous();
set local role anon;
insert into res values ('vera_open', public.pax_link_open('salvaguarda-vera-novo-000000000000'));
insert into res values ('vera_old_open', public.pax_link_open('salvaguarda-vera-antigo-0000000000'));
insert into res values ('vera_export', public.pax_link_export('salvaguarda-vera-novo-000000000000'));
insert into res values ('vera_old_export', public.pax_link_export('salvaguarda-vera-antigo-0000000000'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('vera_forget', public.pax_link_forget('salvaguarda-vera-novo-000000000000'));
reset role;
select ok(
  pg_temp.got('ended', 'code') = 'ended'
  and pg_temp.got('vera_open', 'state') = 'partnership_ended' and pg_temp.got('vera_open', 'rights') = 'true'
  and pg_temp.got('vera_old_open', 'rights') = 'false'
  and pg_temp.got('vera_export', 'ok') = 'true' and pg_temp.got('vera_old_export', 'code') = 'link_not_found'
  and pg_temp.got('vera_forget', 'code') = 'forgotten'
  and not exists (select 1 from public.pax_travelers where id = 'f7800000-0000-4000-8000-000000000011'),
  'after the partnership ended, the passenger still takes and deletes what the agency keeps, through their latest link'
);

-- ---------- What a trip takes, and in what order ----------

update public.platform_settings set value = value || '{"trip_travelers": 3}'::jsonb where key = 'partners';
insert into public.pax_travelers (partner_id, partnership_id, org_id, full_name, birth_date, guardian_id)
select 'c7800000-0000-4000-8000-0000000000aa', 'd7800000-0000-4000-8000-00000000000a', 'b7800000-0000-4000-8000-00000000000a',
       'Criança ' || n || ' Teste', (current_date - interval '5 years')::date, 'f7800000-0000-4000-8000-000000000008'
from generate_series(1, 10) as n;
select pg_temp.sign_in('a7800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('too_many', public.pax_save_trip('d7800000-0000-4000-8000-00000000000a', null,
  'f7800000-0000-4000-8000-000000000001',
  array['f7800000-0000-4000-8000-000000000002', 'f7800000-0000-4000-8000-000000000006',
        'f7800000-0000-4000-8000-000000000009']::uuid[], null,
  '[{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC", "departure": "2099-12-01T08:10", "arrival": "2099-12-01T11:25"}]'));
reset role;
update public.platform_settings set value = value || '{"trip_travelers": 20}'::jsonb where key = 'partners';
select pg_temp.sign_in('a7800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('children', public.pax_save_trip('d7800000-0000-4000-8000-00000000000a', null,
  'f7800000-0000-4000-8000-000000000008',
  array(select t.id from public.pax_travelers t where t.full_name like 'Criança % Teste'), null,
  '[{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC", "departure": "2099-12-01T08:10", "arrival": "2099-12-01T11:25"}]'));
insert into res values ('ordered', public.pax_save_trip('d7800000-0000-4000-8000-00000000000a', null,
  'f7800000-0000-4000-8000-000000000006', null, 'ORD123',
  '[{"flight_number": "LA3457", "origin_iata": "REC", "destination_iata": "GRU", "departure": "2099-12-10T18:00", "arrival": "2099-12-10T21:20"},
    {"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC", "departure": "2099-12-01T08:10", "arrival": "2099-12-01T11:25"}]'));
insert into res values ('imported', public.pax_import_rows('d7800000-0000-4000-8000-00000000000a', '[
  {"line": 2, "nome": "Pedro Teste", "nascimento": "1982-02-02", "localizador": "ORD123", "voo": "G3 1000",
   "origem": "GYN", "destino": "GRU", "partida": "2099-11-30T20:00", "chegada": "2099-11-30T21:30"},
  {"line": 3, "nome": "Zeca Planilha", "nascimento": "1980-03-03", "localizador": "GRD101"}
]'));
reset role;
select ok(
  pg_temp.got('too_many', 'code') = 'too_many_travelers' and pg_temp.got('children', 'code') = 'too_many_children',
  'a trip takes at most the setting''s passengers and nine children of its holder'
);
select ok(
  (select array_agg(l.flight_number order by l.position) from public.pax_trip_legs l
   where l.trip_id = pg_temp.got('ordered', 'trip_id')::uuid) = array['G31000', 'LA3456', 'LA3457'],
  'the legs of a trip are kept in the order they fly, a spreadsheet''s too'
);
select ok(
  pg_temp.got('imported', 'problems')::jsonb @> '[{"line": 3, "code": "trip_locked"}]'::jsonb
  and not exists (select 1 from public.pax_trip_travelers tt join public.pax_travelers t on t.id = tt.traveler_id
                  where tt.trip_id = '17800000-0000-4000-8000-000000000001' and t.full_name = 'Zeca Planilha'),
  'a spreadsheet leaves a trip ONE told of a problem as it is'
);

-- ---------- An upload whose answer was lost ----------

insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status,
                          sha256, bytes, detected_mime, rejected_reason, expires_at, confirmed_at, created_at) values
  -- Measured and kept, its document never told.
  ('27800000-0000-4000-8000-000000000021', 'b7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7800000-0000-4000-8000-00000000000a/pax_document/27800000-0000-4000-8000-000000000021',
   'rg-rafaela.jpg', 'image/jpeg', 2000, 'stored', repeat('b', 64), 2000, 'image/jpeg', null, now() + interval '1 hour', now(), now()),
  -- The same, twenty minutes ago.
  ('27800000-0000-4000-8000-000000000022', 'b7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7800000-0000-4000-8000-00000000000a/pax_document/27800000-0000-4000-8000-000000000022',
   'conta-rafaela.pdf', 'application/pdf', 2000, 'stored', repeat('d', 64), 2000, 'application/pdf', null,
   now() + interval '1 hour', now() - interval '20 minutes', now() - interval '20 minutes'),
  -- Measured and refused, twenty minutes ago.
  ('27800000-0000-4000-8000-000000000023', 'b7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7800000-0000-4000-8000-00000000000a/pax_document/27800000-0000-4000-8000-000000000023',
   'outro.exe', 'application/pdf', 2000, 'rejected', null, null, null, 'type_not_allowed',
   now() + interval '1 hour', now() - interval '20 minutes', now() - interval '20 minutes');
insert into public.pax_documents (id, partner_id, org_id, traveler_id, kind, file_id, source, reading) values
  ('37800000-0000-4000-8000-000000000021', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000001', 'identity', '27800000-0000-4000-8000-000000000021', 'partner', 'uploading'),
  ('37800000-0000-4000-8000-000000000022', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000001', 'address_proof', '27800000-0000-4000-8000-000000000022', 'partner', 'uploading'),
  ('37800000-0000-4000-8000-000000000023', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000001', 'identity', '27800000-0000-4000-8000-000000000023', 'partner', 'uploading');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('to_finish', jsonb_build_object('rows', (select jsonb_agg(to_jsonb(x))
  from public.pax_upload_to_finish('27800000-0000-4000-8000-000000000021') x)));
insert into res values ('finished', public.pax_document_uploaded('27800000-0000-4000-8000-000000000021'));
insert into res values ('swept', jsonb_build_object('claimed', (select jsonb_agg(c.document_id)
  from public.claim_pax_document_readings(10) c)));
reset role;
select ok(
  (pg_temp.got('to_finish', 'rows')::jsonb -> 0 ->> 'file_status') = 'stored'
  and pg_temp.got('finished', 'code') = 'pending',
  'an upload whose answer was lost is finished by the next request'
);
select ok(
  (select reading in ('pending', 'working') from public.pax_documents where id = '37800000-0000-4000-8000-000000000022')
  and not exists (select 1 from public.pax_documents where id = '37800000-0000-4000-8000-000000000023')
  and not exists (select 1 from public.files where id = '27800000-0000-4000-8000-000000000023'),
  'the sweep takes up an upload measured long ago, and lets a refused one go with its file'
);

-- ---------- A date a document says that is no date ----------

insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status,
                          sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('27800000-0000-4000-8000-000000000009', 'b7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7800000-0000-4000-8000-00000000000a/pax_document/27800000-0000-4000-8000-000000000009',
   'rg-ivo.jpg', 'image/jpeg', 2000, 'stored', repeat('e', 64), 2000, 'image/jpeg', now() + interval '1 hour', now());
insert into public.pax_documents (id, partner_id, org_id, traveler_id, kind, file_id, source, reading) values
  ('37800000-0000-4000-8000-000000000009', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000009', 'identity', '27800000-0000-4000-8000-000000000009', 'partner', 'done');
insert into res values ('ivo_read', jsonb_build_object('written', public.pax_apply_reading('37800000-0000-4000-8000-000000000009',
  '{"confere_tipo": "sim", "legivel": true, "dados_lidos": {"nome_completo": "Ivo Teste", "cpf": "529.982.247-25",
    "data_nascimento": "1990-02-30", "nacionalidade": "brasileira"}}'::jsonb)));
select ok(
  pg_temp.got('ivo_read', 'written')::jsonb @> '["cpf", "nationality"]'::jsonb
  and (select birth_date is null and cpf = '52998224725' from public.pax_travelers where id = 'f7800000-0000-4000-8000-000000000009'),
  'a date a document says that is no date is left out alone, and the rest it says is written'
);

-- ---------- An abandoned upload, and the readings of a day ----------

insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, expires_at) values
  ('27800000-0000-4000-8000-000000000031', 'b7800000-0000-4000-8000-00000000000a', 'c7800000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7800000-0000-4000-8000-00000000000a/pax_document/27800000-0000-4000-8000-000000000031',
   'abandonado.jpg', 'image/jpeg', 2000, now() - interval '1 minute'),
  ('27800000-0000-4000-8000-000000000032', 'b7800000-0000-4000-8000-00000000000a', null,
   'case_document', 'org/b7800000-0000-4000-8000-00000000000a/case_document/27800000-0000-4000-8000-000000000032',
   'abandonado-do-escritorio.jpg', 'image/jpeg', 2000, now() - interval '1 minute');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('expired', jsonb_build_object('count', public.expire_file_reservations()));
reset role;
select ok(
  (select e.org_id is null from public.audit_events e
   where e.action = 'file.expired' and e.entity_id = '27800000-0000-4000-8000-000000000031')
  and (select e.org_id = 'b7800000-0000-4000-8000-00000000000a' from public.audit_events e
       where e.action = 'file.expired' and e.entity_id = '27800000-0000-4000-8000-000000000032'),
  'an agency''s abandoned upload is no firm''s audit, and a firm''s own still is'
);

-- One reading a day for each partnership: Wanda's document and the first of Rafaela's go, the second waits.
update public.pax_documents set reading = 'done' where reading in ('pending', 'working');
delete from public.pax_reading_days;
update public.platform_settings set value = value || '{"reading_daily": 1}'::jsonb where key = 'partners';
insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status,
                          sha256, bytes, detected_mime, expires_at, confirmed_at)
select x.id, x.org, x.partner, 'pax_document', 'org/' || x.org || '/pax_document/' || x.id, 'doc.pdf', 'application/pdf', 2000,
       'stored', repeat('f', 64), 2000, 'application/pdf', now() + interval '1 hour', now()
from (values
  ('27800000-0000-4000-8000-000000000041'::uuid, 'b7800000-0000-4000-8000-00000000000a'::uuid, 'c7800000-0000-4000-8000-0000000000aa'::uuid),
  ('27800000-0000-4000-8000-000000000042'::uuid, 'b7800000-0000-4000-8000-00000000000a'::uuid, 'c7800000-0000-4000-8000-0000000000aa'::uuid),
  ('27800000-0000-4000-8000-000000000043'::uuid, 'b7800000-0000-4000-8000-00000000000b'::uuid, 'c7800000-0000-4000-8000-0000000000bb'::uuid)
) as x (id, org, partner);
insert into public.pax_documents (id, partner_id, org_id, traveler_id, kind, file_id, source, reading, created_at) values
  ('37800000-0000-4000-8000-000000000041', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000001', 'identity', '27800000-0000-4000-8000-000000000041', 'partner', 'pending', now() - interval '3 minutes'),
  ('37800000-0000-4000-8000-000000000042', 'c7800000-0000-4000-8000-0000000000aa', 'b7800000-0000-4000-8000-00000000000a',
   'f7800000-0000-4000-8000-000000000001', 'address_proof', '27800000-0000-4000-8000-000000000042', 'partner', 'pending', now() - interval '2 minutes'),
  ('37800000-0000-4000-8000-000000000043', 'c7800000-0000-4000-8000-0000000000bb', 'b7800000-0000-4000-8000-00000000000b',
   'f7800000-0000-4000-8000-000000000012', 'identity', '27800000-0000-4000-8000-000000000043', 'partner', 'pending', now() - interval '1 minute');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_one', jsonb_build_object('ids', (select jsonb_agg(c.document_id order by c.document_id)
  from public.claim_pax_document_readings(10) c)));
insert into res values ('read_two', jsonb_build_object('count', (select count(*) from public.claim_pax_document_readings(10))));
reset role;
select ok(
  pg_temp.got('read_one', 'ids')::jsonb = '["37800000-0000-4000-8000-000000000041", "37800000-0000-4000-8000-000000000043"]'::jsonb
  and pg_temp.got('read_two', 'count') = '0'
  and (select reading = 'pending' from public.pax_documents where id = '37800000-0000-4000-8000-000000000042'),
  'the AI reads at most the setting''s documents a day for a partnership, and another partnership goes on'
);

-- ---------- Nobody else reads it ----------

select pg_temp.sign_in('a7800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio_reads', jsonb_build_object(
  'trips', (select count(*) from public.tracked_trips where org_id = 'b7800000-0000-4000-8000-00000000000a')));
reset role;
select pg_temp.sign_in('a7800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('edu_reads', jsonb_build_object(
  'travelers', (select count(*) from public.pax_travelers where partner_id = 'c7800000-0000-4000-8000-0000000000aa')));
reset role;
select ok(
  pg_temp.got('caio_reads', 'trips') = '0'
  and pg_temp.got('edu_reads', 'travelers') = '0',
  'another firm and another agency read none of it'
);

select * from finish();
rollback;
