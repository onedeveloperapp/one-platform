begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- An agreement is given at a WhatsApp, and the agency is told when it no
-- longer covers the passenger's trips (0086). A yes keeps the WhatsApp it
-- was given at; a WhatsApp changed since, or a trip ONE does not follow,
-- is said on the agency's list, count, filter and passenger page and on
-- the passenger's link; the agreed WhatsApp put back is followed again by
-- itself. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-reacordo.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8900000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-reacordo.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8900000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-reacordo.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a8900000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@mar-reacordo.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8900000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-reacordo', 'a8900000-0000-4000-8000-000000000001'),
  ('b8900000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-reacordo', 'a8900000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8900000-0000-4000-8000-00000000000a', 'a8900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8900000-0000-4000-8000-00000000000b', 'a8900000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values
  ('c8900000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c8900000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c8900000-0000-4000-8000-0000000000aa', 'a8900000-0000-4000-8000-000000000003', 'owner'),
  ('c8900000-0000-4000-8000-0000000000bb', 'a8900000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d8900000-0000-4000-8000-00000000000a', 'c8900000-0000-4000-8000-0000000000aa', 'b8900000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d8900000-0000-4000-8000-00000000000b', 'c8900000-0000-4000-8000-0000000000bb', 'b8900000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c8900000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.'),
  ('c8900000-0000-4000-8000-0000000000bb', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');

-- The agency Sol's Rafaela, with a trip ahead, and Bruno, with none yet; the agency Mar's Vera, with a trip ahead.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone) values
  ('f8900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-0000000000aa', 'd8900000-0000-4000-8000-00000000000a',
   'b8900000-0000-4000-8000-00000000000a', 'Rafaela Teste', '1990-04-12', '5562999990001'),
  ('f8900000-0000-4000-8000-000000000002', 'c8900000-0000-4000-8000-0000000000aa', 'd8900000-0000-4000-8000-00000000000a',
   'b8900000-0000-4000-8000-00000000000a', 'Bruno Teste', '1985-01-20', '5562999990002'),
  ('f8900000-0000-4000-8000-000000000003', 'c8900000-0000-4000-8000-0000000000bb', 'd8900000-0000-4000-8000-00000000000b',
   'b8900000-0000-4000-8000-00000000000b', 'Vera Teste', '1970-10-10', '5562999990003');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('18900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-0000000000aa', 'd8900000-0000-4000-8000-00000000000a',
   'b8900000-0000-4000-8000-00000000000a', 'f8900000-0000-4000-8000-000000000001', 'RCD101'),
  ('18900000-0000-4000-8000-000000000003', 'c8900000-0000-4000-8000-0000000000bb', 'd8900000-0000-4000-8000-00000000000b',
   'b8900000-0000-4000-8000-00000000000b', 'f8900000-0000-4000-8000-000000000003', 'RCD301');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('18900000-0000-4000-8000-000000000001', 'f8900000-0000-4000-8000-000000000001'),
  ('18900000-0000-4000-8000-000000000003', 'f8900000-0000-4000-8000-000000000003');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('18900000-0000-4000-8000-000000000001', 1, 'LA3456', 'GRU', 'REC', current_date + 10 + time '08:10', current_date + 10 + time '11:25'),
  ('18900000-0000-4000-8000-000000000003', 1, 'G31450', 'BSB', 'GIG', current_date + 12 + time '14:00', current_date + 12 + time '15:45');
insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, expires_at) values
  ('c8900000-0000-4000-8000-0000000000aa', 'd8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000a',
   'f8900000-0000-4000-8000-000000000001', encode(sha256(convert_to('reacordo-rafaela-00000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days'),
  ('c8900000-0000-4000-8000-0000000000aa', 'd8900000-0000-4000-8000-00000000000a', 'b8900000-0000-4000-8000-00000000000a',
   'f8900000-0000-4000-8000-000000000002', encode(sha256(convert_to('reacordo-bruno-0000000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days'),
  ('c8900000-0000-4000-8000-0000000000bb', 'd8900000-0000-4000-8000-00000000000b', 'b8900000-0000-4000-8000-00000000000b',
   'f8900000-0000-4000-8000-000000000003', encode(sha256(convert_to('reacordo-vera-00000000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.tracked(trip uuid) returns public.tracked_trips language sql as
$$ select t.* from public.tracked_trips t where t.pax_trip_id = trip; $$;

insert into res
select 'w_' || x.name, jsonb_build_object('text', public.pax_consent_wording(x.id))
from (values ('rafaela', 'f8900000-0000-4000-8000-000000000001'::uuid), ('bruno', 'f8900000-0000-4000-8000-000000000002'::uuid),
             ('vera', 'f8900000-0000-4000-8000-000000000003'::uuid)) as x (name, id);

-- ---------- A yes keeps its WhatsApp ----------

select pg_temp.anonymous();
set local role anon;
insert into res values ('rafaela_agreed', public.pax_link_answer('reacordo-rafaela-00000000000000000', 'agreed',
  pg_temp.got('w_rafaela', 'text')));
reset role;

select is(
  (select c.phone from public.pax_consents c where c.traveler_id = 'f8900000-0000-4000-8000-000000000001'
   order by c.created_at desc limit 1),
  '5562999990001',
  'a yes keeps the WhatsApp it was given at'
);
select ok(
  (pg_temp.tracked('18900000-0000-4000-8000-000000000001')).status = 'watching'
  and public.pax_reagree('f8900000-0000-4000-8000-000000000001') is null,
  'and covers the trips ONE follows: nothing to agree to again'
);

-- ---------- The agency writes another WhatsApp ----------

select pg_temp.sign_in('a8900000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('new_phone', public.pax_save_traveler('d8900000-0000-4000-8000-00000000000a',
  'f8900000-0000-4000-8000-000000000001', '{"phone": "62999990099"}'::jsonb, null));
insert into res values ('detail_changed', public.pax_traveler_detail('f8900000-0000-4000-8000-000000000001'));
insert into res values ('page_all', public.pax_travelers_page('d8900000-0000-4000-8000-00000000000a'));
insert into res values ('page_waiting', public.pax_travelers_page('d8900000-0000-4000-8000-00000000000a', null, 'waiting_consent'));
insert into res values ('overview_changed', public.pax_overview('d8900000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('new_phone', 'code') = 'saved'
  and (pg_temp.tracked('18900000-0000-4000-8000-000000000001')).id is null,
  'another WhatsApp of the holder stops what ONE followed, as 0074 wants'
);
select is(public.pax_reagree('f8900000-0000-4000-8000-000000000001'), 'phone_changed',
  'and the agreement is said to cover the trips no more, because the WhatsApp changed');
select is(pg_temp.got('detail_changed', 'reagree'), 'phone_changed', 'the passenger''s page says it');
select is(
  (select r.value ->> 'reagree' from jsonb_array_elements(pg_temp.got('page_all', 'rows')::jsonb) r
   where r.value ->> 'id' = 'f8900000-0000-4000-8000-000000000001'),
  'phone_changed',
  'and so does the list, beside the answer in force'
);
select ok(
  exists (select 1 from jsonb_array_elements(pg_temp.got('page_waiting', 'rows')::jsonb) r
          where r.value ->> 'id' = 'f8900000-0000-4000-8000-000000000001'),
  'the filter of agreements still owed takes her'
);
select is((pg_temp.got('overview_changed', 'adults_waiting'))::integer, 1, 'and so does its count');

select pg_temp.anonymous();
set local role anon;
insert into res values ('link_changed', public.pax_link_open('reacordo-rafaela-00000000000000000'));
reset role;
select is(pg_temp.got('link_changed', 'reagree'), 'phone_changed', 'the passenger''s link says it to her');

-- ---------- The agreed WhatsApp put back ----------

select pg_temp.sign_in('a8900000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('old_phone', public.pax_save_traveler('d8900000-0000-4000-8000-00000000000a',
  'f8900000-0000-4000-8000-000000000001', '{"phone": "62999990001"}'::jsonb, null));
reset role;
select ok(
  pg_temp.got('old_phone', 'code') = 'saved'
  and (pg_temp.tracked('18900000-0000-4000-8000-000000000001')).status = 'watching'
  and (pg_temp.tracked('18900000-0000-4000-8000-000000000001')).phone = '5562999990001',
  'the WhatsApp the yes was given at, put back, is followed again by itself'
);
select ok(public.pax_reagree('f8900000-0000-4000-8000-000000000001') is null, 'with nothing to agree to again');

-- ---------- Another WhatsApp, and the passenger agrees at it ----------

select pg_temp.sign_in('a8900000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('other_phone', public.pax_save_traveler('d8900000-0000-4000-8000-00000000000a',
  'f8900000-0000-4000-8000-000000000001', '{"phone": "62999990077"}'::jsonb, null));
reset role;
select pg_temp.anonymous();
set local role anon;
insert into res values ('rafaela_again', public.pax_link_answer('reacordo-rafaela-00000000000000000', 'agreed',
  pg_temp.got('w_rafaela', 'text')));
reset role;
select ok(
  pg_temp.got('rafaela_again', 'followed') = '1'
  and (pg_temp.tracked('18900000-0000-4000-8000-000000000001')).phone = '5562999990077'
  and public.pax_reagree('f8900000-0000-4000-8000-000000000001') is null,
  'agreeing again at the new WhatsApp follows the trip at it'
);
select is(
  (select c.phone from public.pax_consents c where c.traveler_id = 'f8900000-0000-4000-8000-000000000001'
   order by c.created_at desc limit 1),
  '5562999990077',
  'and the new yes keeps the new WhatsApp'
);

-- ---------- A trip ONE does not follow ----------

select pg_temp.anonymous();
set local role anon;
insert into res values ('bruno_agreed', public.pax_link_answer('reacordo-bruno-0000000000000000000', 'agreed',
  pg_temp.got('w_bruno', 'text')));
reset role;
select ok(
  pg_temp.got('bruno_agreed', 'followed') = '0' and public.pax_reagree('f8900000-0000-4000-8000-000000000002') is null,
  'a yes with no trip yet owes nothing'
);
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('18900000-0000-4000-8000-000000000002', 'c8900000-0000-4000-8000-0000000000aa', 'd8900000-0000-4000-8000-00000000000a',
   'b8900000-0000-4000-8000-00000000000a', 'f8900000-0000-4000-8000-000000000002', 'RCD201');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('18900000-0000-4000-8000-000000000002', 'f8900000-0000-4000-8000-000000000002');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('18900000-0000-4000-8000-000000000002', 1, 'AD4010', 'VCP', 'CNF', current_date + 5 + time '07:00', current_date + 5 + time '08:10');
select is(public.pax_reagree('f8900000-0000-4000-8000-000000000002'), 'trip_waiting',
  'a trip added after the agreement waits for him to agree again, and is said as such');

-- A trip over long ago owes nothing: ONE would not follow it.
update public.pax_trip_legs set scheduled_departure_local = current_date - 30 + time '07:00',
                                scheduled_arrival_local = current_date - 30 + time '08:10'
where trip_id = '18900000-0000-4000-8000-000000000002';
select ok(public.pax_reagree('f8900000-0000-4000-8000-000000000002') is null, 'a trip already over asks for nothing');

-- ---------- Who owes nothing, and who reads nothing ----------

select pg_temp.anonymous();
set local role anon;
insert into res values ('vera_declined', public.pax_link_answer('reacordo-vera-00000000000000000000', 'declined',
  pg_temp.got('w_vera', 'text')));
reset role;
select ok(
  public.pax_reagree('f8900000-0000-4000-8000-000000000003') is null
  and (select c.phone from public.pax_consents c where c.traveler_id = 'f8900000-0000-4000-8000-000000000003') is null,
  'a no is no agreement lost, and keeps no WhatsApp'
);

select pg_temp.sign_in('a8900000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.pax_traveler_detail('f8900000-0000-4000-8000-000000000001') $$,
  '42501', 'not_authorized',
  'another agency reads nothing of it'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.pax_reagree(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pax_reagree(uuid)', 'EXECUTE'),
  'nobody calls the rule by itself: it is read through what each may read'
);

select ok(
  (select count(*) from public.pax_consents c where c.phone is not null and c.answer <> 'agreed') = 0,
  'only a yes keeps a WhatsApp'
);

select * from finish();
rollback;
