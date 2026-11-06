begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- A passenger whose trip became a case stays the agency's for their next
-- trips (0106): the agency keeps their record up to date and registers a
-- next trip, which is said as an agreement owed again until the passenger
-- agrees to it on a new link; then ONE follows it. The trip that became the
-- case is the firm's: nothing more of it is sent to the agency's record. The
-- record is kept while a later trip is ahead, and forgotten as before once
-- nothing is. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1070000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-retorno.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1070000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-retorno.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a1070000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-retorno.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a1070000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@mar-retorno.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1070000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-retorno', 'a1070000-0000-4000-8000-000000000001'),
  ('b1070000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-retorno', 'a1070000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1070000-0000-4000-8000-00000000000a', 'a1070000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1070000-0000-4000-8000-00000000000b', 'a1070000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values
  ('c1070000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c1070000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c1070000-0000-4000-8000-0000000000aa', 'a1070000-0000-4000-8000-000000000003', 'owner'),
  ('c1070000-0000-4000-8000-0000000000bb', 'a1070000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-0000000000aa', 'b1070000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d1070000-0000-4000-8000-00000000000b', 'c1070000-0000-4000-8000-0000000000bb', 'b1070000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c1070000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.'),
  ('c1070000-0000-4000-8000-0000000000bb', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');

-- The agency Sol's Lara, whose first trip, tomorrow's, was cancelled and became a case two days ago, and Bia, whose
-- trip became one 40 days ago, with nothing since; the agency Mar's Vera.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone, handed_over_at,
                                  created_at, updated_at) values
  ('f1070000-0000-4000-8000-000000000001', 'c1070000-0000-4000-8000-0000000000aa', 'd1070000-0000-4000-8000-00000000000a',
   'b1070000-0000-4000-8000-00000000000a', 'Lara Teste', '1988-02-14', '5562999107001', now() - interval '2 days',
   now() - interval '60 days', now() - interval '2 days'),
  ('f1070000-0000-4000-8000-000000000002', 'c1070000-0000-4000-8000-0000000000aa', 'd1070000-0000-4000-8000-00000000000a',
   'b1070000-0000-4000-8000-00000000000a', 'Bia Teste', '1982-06-03', '5562999107002', now() - interval '40 days',
   now() - interval '60 days', now() - interval '40 days'),
  ('f1070000-0000-4000-8000-000000000003', 'c1070000-0000-4000-8000-0000000000bb', 'd1070000-0000-4000-8000-00000000000b',
   'b1070000-0000-4000-8000-00000000000b', 'Vera Teste', '1970-10-10', '5562999107003', null, now(), now());
-- Lara's yes, given at her WhatsApp when her first trip was registered.
insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, answer, wording, phone, created_at)
values ('c1070000-0000-4000-8000-0000000000aa', 'b1070000-0000-4000-8000-00000000000a',
        'f1070000-0000-4000-8000-000000000001', 'f1070000-0000-4000-8000-000000000001', 'agreed',
        'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.',
        '5562999107001', now() - interval '60 days');
-- Lara's first trip, which became her case, and her next one, registered by the agency: it leaves in three days.
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('11070000-0000-4000-8000-000000000001', 'c1070000-0000-4000-8000-0000000000aa', 'd1070000-0000-4000-8000-00000000000a',
   'b1070000-0000-4000-8000-00000000000a', 'f1070000-0000-4000-8000-000000000001', 'RET101'),
  ('11070000-0000-4000-8000-000000000002', 'c1070000-0000-4000-8000-0000000000aa', 'd1070000-0000-4000-8000-00000000000a',
   'b1070000-0000-4000-8000-00000000000a', 'f1070000-0000-4000-8000-000000000001', 'RET202');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('11070000-0000-4000-8000-000000000001', 'f1070000-0000-4000-8000-000000000001'),
  ('11070000-0000-4000-8000-000000000002', 'f1070000-0000-4000-8000-000000000001');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('11070000-0000-4000-8000-000000000001', 1, 'LA3400', 'GRU', 'GYN', current_date + 1 + time '07:00',
   current_date + 1 + time '08:45'),
  ('11070000-0000-4000-8000-000000000002', 1, 'LA3456', 'GYN', 'GRU', current_date + 3 + time '08:10',
   current_date + 3 + time '09:55');
-- ONE followed the first trip by her yes, told her of its problem, and she said yes: its case opened.
insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, consent_wording, consent_at,
                                  consent_channel, status, pax_trip_id)
values ('b1070000-0000-4000-8000-00000000000a', 'Lara Teste', '5562999107001', 'LA',
        'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.',
        now() - interval '60 days', 'agency', 'case_opened', '11070000-0000-4000-8000-000000000001');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- ---------- A next trip waits for the agreement ----------

select pg_temp.sign_in('a1070000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('page_waiting', public.pax_travelers_page('d1070000-0000-4000-8000-00000000000a', null, 'waiting_consent'));
insert into res values ('overview', public.pax_overview('d1070000-0000-4000-8000-00000000000a'));
insert into res values ('detail', public.pax_traveler_detail('f1070000-0000-4000-8000-000000000001'));
reset role;

select ok(
  public.pax_reagree('f1070000-0000-4000-8000-000000000001') = 'trip_waiting'
  and pg_temp.got('detail', 'reagree') = 'trip_waiting'
  and (select count(*) = 1 from jsonb_array_elements(pg_temp.got('page_waiting', 'rows')::jsonb) r
       where r.value ->> 'id' = 'f1070000-0000-4000-8000-000000000001')
  and (pg_temp.got('overview', 'adults_waiting'))::integer = 1,
  'a next trip of a passenger with the firm is an agreement owed again, on the page, the list and the count'
);

select ok(
  (select (r.value ->> 'next_departure')::timestamp = current_date + 3 + time '08:10'
   from jsonb_array_elements(pg_temp.got('page_waiting', 'rows')::jsonb) r
   where r.value ->> 'id' = 'f1070000-0000-4000-8000-000000000001')
  and (pg_temp.got('overview', 'upcoming'))::integer = 0,
  'the trip that became a case is neither the next departure of the list nor a trip flying soon: the firm has it'
);

select ok(
  exists (select 1 from public.pax_unagreed_departures('d1070000-0000-4000-8000-00000000000a') u
          where u.traveler_id = 'f1070000-0000-4000-8000-000000000001'
            and u.trip_id = '11070000-0000-4000-8000-000000000002'),
  'and the agency is told it flies soon with no agreement'
);

-- ---------- Kept while a later trip is ahead ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('swept', public.pax_retention_sweep());
reset role;
select ok(
  exists (select 1 from public.pax_travelers where id = 'f1070000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.pax_travelers where id = 'f1070000-0000-4000-8000-000000000002'),
  'a passenger with the firm is kept while a later trip is ahead, and forgotten as before once nothing is'
);

-- ---------- The agency keeps the record, and asks the agreement again ----------

select pg_temp.sign_in('a1070000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('saved', public.pax_save_traveler('d1070000-0000-4000-8000-00000000000a',
  'f1070000-0000-4000-8000-000000000001', '{"email": "lara@retorno.invalid"}'::jsonb, null));
insert into res values ('link', public.pax_issue_confirm_link('f1070000-0000-4000-8000-000000000001',
  encode(sha256(convert_to('retorno-lara-0000000000000000000000', 'UTF8')), 'hex')));
insert into res values ('doc_case_trip', public.pax_reserve_document('f1070000-0000-4000-8000-000000000001',
  'boarding_pass', '11070000-0000-4000-8000-000000000001', 'cartao.pdf', 'application/pdf', 2048));
insert into res values ('doc_next_trip', public.pax_reserve_document('f1070000-0000-4000-8000-000000000001',
  'boarding_pass', '11070000-0000-4000-8000-000000000002', 'cartao.pdf', 'application/pdf', 2048));
reset role;
select ok(
  pg_temp.got('saved', 'code') = 'saved'
  and (select email = 'lara@retorno.invalid' from public.pax_travelers where id = 'f1070000-0000-4000-8000-000000000001')
  and pg_temp.got('link', 'ok') = 'true',
  'the agency updates the record of a passenger with the firm and sends a new link'
);
select ok(
  pg_temp.got('doc_next_trip', 'code') = 'reserved' and pg_temp.got('doc_case_trip', 'code') = 'trip_with_firm',
  'the agency sends the documents of the next trip, never of the trip that became a case'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('open_before', public.pax_link_open('retorno-lara-0000000000000000000000'));
insert into res values ('upload_case_trip', public.pax_link_reserve_upload('retorno-lara-0000000000000000000000',
  'f1070000-0000-4000-8000-000000000001', 'ticket', '11070000-0000-4000-8000-000000000001', 'bilhete.pdf',
  'application/pdf', 2048));
reset role;
select is(pg_temp.got('open_before', 'state'), 'open', 'the link asks the agreement to the next trip');
select is(pg_temp.got('upload_case_trip', 'code'), 'trip_with_firm',
  'and the passenger sends there nothing of the trip that became a case');

insert into res select 'wording', jsonb_build_object('text', public.pax_consent_wording('f1070000-0000-4000-8000-000000000001'));
select pg_temp.anonymous();
set local role anon;
insert into res values ('agreed', public.pax_link_answer('retorno-lara-0000000000000000000000', 'agreed',
  pg_temp.got('wording', 'text')));
insert into res values ('open_after', public.pax_link_open('retorno-lara-0000000000000000000000'));
reset role;
select ok(
  pg_temp.got('agreed', 'ok') = 'true'
  and (select t.status = 'watching' from public.tracked_trips t where t.pax_trip_id = '11070000-0000-4000-8000-000000000002')
  and (select t.status = 'case_opened' from public.tracked_trips t where t.pax_trip_id = '11070000-0000-4000-8000-000000000001')
  and public.pax_reagree('f1070000-0000-4000-8000-000000000001') is null,
  'once the passenger agrees, ONE follows the next trip, the case''s stays as it is, and nothing is owed again'
);

select ok(
  pg_temp.got('open_after', 'state') = 'open' and pg_temp.got('open_after', 'consent') = 'agreed'
  and pg_temp.got('open_after', 'reagree') is null
  and not exists (select 1 from public.pax_unagreed_departures('d1070000-0000-4000-8000-00000000000a') u
                  where u.traveler_id = 'f1070000-0000-4000-8000-000000000001'),
  'the link shows the agreement while the next trip is ahead, and the agency is told nothing more'
);

-- The next trip flown: nothing of hers is ahead but the trip with the firm.
update public.pax_trip_legs
set scheduled_departure_local = current_date - 5 + time '08:10', scheduled_arrival_local = current_date - 5 + time '09:55'
where trip_id = '11070000-0000-4000-8000-000000000002';
select pg_temp.anonymous();
set local role anon;
insert into res values ('open_flown', public.pax_link_open('retorno-lara-0000000000000000000000'));
reset role;
select is(pg_temp.got('open_flown', 'state'), 'handed_over',
  'once no trip of hers is ahead, the link says her data went to the firm');

-- ---------- Two agencies ----------

select pg_temp.sign_in('a1070000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.pax_save_traveler('d1070000-0000-4000-8000-00000000000a', 'f1070000-0000-4000-8000-000000000001',
      '{"email": "outra@retorno.invalid"}'::jsonb, null)$$,
  '42501', 'not_authorized',
  'nobody of another agency writes this one''s passenger'
);
reset role;
select is(
  (select email from public.pax_travelers where id = 'f1070000-0000-4000-8000-000000000001'),
  'lara@retorno.invalid',
  'and the record stays as its agency wrote it'
);

select * from finish();
rollback;
