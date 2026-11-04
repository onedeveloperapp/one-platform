begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The test chat is the agency's passenger's only (0087): turned on, it
-- brings no passenger of its own; the passenger an agency registers at the
-- test WhatsApp, once they agree, is its passenger. Two firms: one firm's
-- agency passenger is no passenger of the other's test chat.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-chatagencia.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-chatagencia.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-chatagencia', 'a9000000-0000-4000-8000-000000000001'),
  ('b9000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-chatagencia', 'a9000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9000000-0000-4000-8000-00000000000b', 'a9000000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c9000000-0000-4000-8000-00000000000a', 'b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'chatagencia-waba-a',
   'Chat de teste', 'connected', 'a9000000-0000-4000-8000-000000000001', now()),
  ('c9000000-0000-4000-8000-00000000000b', 'b9000000-0000-4000-8000-00000000000b', 'whatsapp', 'chatagencia-waba-b',
   'Chat de teste', 'connected', 'a9000000-0000-4000-8000-000000000002', now());

-- Firm A's agency, with its clause, and its passenger at the test WhatsApp with a trip ahead.
insert into public.partners (id, name) values ('c9000000-0000-4000-8000-0000000000aa', 'Viagens Sol');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d9000000-0000-4000-8000-00000000000a', 'c9000000-0000-4000-8000-0000000000aa', 'b9000000-0000-4000-8000-00000000000a',
   'direito-do-passageiro');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c9000000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone) values
  ('f9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-0000000000aa', 'd9000000-0000-4000-8000-00000000000a',
   'b9000000-0000-4000-8000-00000000000a', 'Marta Teste', '1979-07-07', '5500988880006');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('19000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-0000000000aa', 'd9000000-0000-4000-8000-00000000000a',
   'b9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-000000000001', 'CHT101');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('19000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('19000000-0000-4000-8000-000000000001', 1, 'LA3456', 'GRU', 'REC', current_date + 2 + time '08:10', current_date + 2 + time '11:25');
insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, expires_at) values
  ('c9000000-0000-4000-8000-0000000000aa', 'd9000000-0000-4000-8000-00000000000a', 'b9000000-0000-4000-8000-00000000000a',
   'f9000000-0000-4000-8000-000000000001', encode(sha256(convert_to('chatagencia-marta-0000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- Both firms turn their test chats on.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b9000000-0000-4000-8000-00000000000a',
  'c9000000-0000-4000-8000-00000000000a', 'test', 'chatagencia-number-a', 'chatagencia-waba-a', '5500900000091',
  'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b9000000-0000-4000-8000-00000000000b',
  'c9000000-0000-4000-8000-00000000000b', 'test', 'chatagencia-number-b', 'chatagencia-waba-b', '5500900000092',
  'Rocha Advocacia', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b9000000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('m', 43), 'a9000000-0000-4000-8000-000000000001'));
insert into res values ('chat_b', public.start_test_chat('b9000000-0000-4000-8000-00000000000b',
  pg_temp.got('number_b', 'number_id')::uuid, repeat('n', 43), 'a9000000-0000-4000-8000-000000000002'));
insert into res values ('view_before', public.test_chat_view(repeat('m', 43)));
reset role;

select ok(
  pg_temp.got('chat_a', 'code') = 'started'
  and not exists (select 1 from public.tracked_trips t where t.org_id = 'b9000000-0000-4000-8000-00000000000a'),
  'a test chat turned on brings no passenger of its own'
);
select is(jsonb_array_length((pg_temp.got('view_before', 'trips'))::jsonb), 0,
  'and its page has no passenger until the agency''s agrees');
select is(
  (select e.metadata ->> 'trips_made' from public.audit_events e
   where e.action = 'test_chat.started' and e.org_id = 'b9000000-0000-4000-8000-00000000000a'),
  '0',
  'its record says it made none'
);

-- The agency's passenger at the test WhatsApp agrees on the agency's link, in the words it shows.
insert into res values ('wording', jsonb_build_object('text', public.pax_consent_wording('f9000000-0000-4000-8000-000000000001')));
select pg_temp.anonymous();
set local role anon;
insert into res values ('marta_agreed', public.pax_link_answer('chatagencia-marta-0000000000000000', 'agreed',
  pg_temp.got('wording', 'text')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('view_after', public.test_chat_view(repeat('m', 43)));
insert into res values ('view_other', public.test_chat_view(repeat('n', 43)));
reset role;

select ok(
  pg_temp.got('marta_agreed', 'followed') = '1'
  and (select t.is_test and t.label = 'agencia' and t.watch = 'simulated' from public.tracked_trips t
       where t.pax_trip_id = '19000000-0000-4000-8000-000000000001'),
  'the passenger an agency registers at the test WhatsApp is followed in the test chat once they agree'
);
select is(
  (select jsonb_agg(trip ->> 'label') from jsonb_array_elements((pg_temp.got('view_after', 'trips'))::jsonb) trip),
  '["agencia"]'::jsonb,
  'and is the test chat''s only passenger'
);
select is(jsonb_array_length((pg_temp.got('view_other', 'trips'))::jsonb), 0,
  'another firm''s test chat has none of it');

select * from finish();
rollback;
