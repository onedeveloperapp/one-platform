begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- The handoff of an agency's passenger (0071): the passenger agrees on the
-- agency's link with the test chat's number, so the firm's test chat follows
-- the trip; its flight is cancelled; the passenger says SIM; ONE opens the
-- case with the agency's record handed over: the firm's client found by CPF
-- and name keeps its record and takes what it lacked, a new passenger takes
-- the agency's data, a child goes with who answers for them, the documents
-- become the case's (the firm reads them, the agency no longer), what ONE read
-- stays marked, and the case is the partnership's. A passenger with a real
-- number is followed at FlightAware as before. Two firms.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-repasse.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-repasse.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7500000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-repasse.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b7500000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-repasse', 'a7500000-0000-4000-8000-000000000001'),
  ('b7500000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-repasse', 'a7500000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7500000-0000-4000-8000-00000000000a', 'a7500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7500000-0000-4000-8000-00000000000b', 'a7500000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c7500000-0000-4000-8000-00000000000a', 'b7500000-0000-4000-8000-00000000000a', 'whatsapp', 'handoff-waba-a', 'Chat de teste',
   'connected', 'a7500000-0000-4000-8000-000000000001', now());
insert into public.partners (id, name) values ('c7500000-0000-4000-8000-0000000000aa', 'Viagens Sol');
insert into public.partner_members (partner_id, user_id, role) values
  ('c7500000-0000-4000-8000-0000000000aa', 'a7500000-0000-4000-8000-000000000003', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d7500000-0000-4000-8000-00000000000a', 'c7500000-0000-4000-8000-0000000000aa', 'b7500000-0000-4000-8000-00000000000a',
   'direito-do-passageiro');

-- Firm A already has Rafaela as a client, with no e-mail and no nationality; firm B has a client of Lia's CPF.
insert into public.people (id, org_id, full_name, cpf) values
  ('e7500000-0000-4000-8000-0000000000a1', 'b7500000-0000-4000-8000-00000000000a', 'Rafaela Teste Lima', '52998224725'),
  ('e7500000-0000-4000-8000-0000000000b1', 'b7500000-0000-4000-8000-00000000000b', 'Lia Teste', '11144477735');

-- What the agency has of the trip: Rafaela, who holds it, Bruno, an adult who goes along and never agreed, and
-- Lia, a child Rafaela answers for.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, cpf, birth_date, phone, email,
                                  nationality, postal_code, street, address_number, district, city, uf) values
  ('f7500000-0000-4000-8000-000000000001', 'c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a',
   'b7500000-0000-4000-8000-00000000000a', 'Rafaela Teste Lima', '52998224725', '1990-04-12', '5500988880006',
   'rafaela@teste.invalid', 'brasileira', '74000000', 'Rua Teste', '10', 'Centro', 'Goiânia', 'GO'),
  ('f7500000-0000-4000-8000-000000000002', 'c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a',
   'b7500000-0000-4000-8000-00000000000a', 'Bruno Teste', null, '1985-01-20', null,
   'bruno@teste.invalid', null, null, null, null, null, null, null);
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, cpf, birth_date, guardian_id) values
  ('f7500000-0000-4000-8000-000000000003', 'c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a',
   'b7500000-0000-4000-8000-00000000000a', 'Lia Teste', '11144477735', (current_date - interval '8 years')::date,
   'f7500000-0000-4000-8000-000000000001');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('17500000-0000-4000-8000-00000000000a', 'c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a',
   'b7500000-0000-4000-8000-00000000000a', 'f7500000-0000-4000-8000-000000000001', 'ABC123');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('17500000-0000-4000-8000-00000000000a', 'f7500000-0000-4000-8000-000000000001'),
  ('17500000-0000-4000-8000-00000000000a', 'f7500000-0000-4000-8000-000000000002'),
  ('17500000-0000-4000-8000-00000000000a', 'f7500000-0000-4000-8000-000000000003');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('17500000-0000-4000-8000-00000000000a', 1, 'LA3456', 'GRU', 'REC', current_date + time '08:10', current_date + time '11:25');

-- Rafaela's identity, read; Lia's boarding pass of the trip; and a file of Bruno's still on its way.
insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status,
                          sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('27500000-0000-4000-8000-000000000001', 'b7500000-0000-4000-8000-00000000000a', 'c7500000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7500000-0000-4000-8000-00000000000a/pax_document/27500000-0000-4000-8000-000000000001',
   'rg-rafaela.jpg', 'image/jpeg', 2000, 'stored', repeat('a', 64), 2000, 'image/jpeg', now() + interval '1 hour', now()),
  ('27500000-0000-4000-8000-000000000002', 'b7500000-0000-4000-8000-00000000000a', 'c7500000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7500000-0000-4000-8000-00000000000a/pax_document/27500000-0000-4000-8000-000000000002',
   'cartao-lia.pdf', 'application/pdf', 2000, 'stored', repeat('b', 64), 2000, 'application/pdf', now() + interval '1 hour', now());
insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, expires_at) values
  ('27500000-0000-4000-8000-000000000003', 'b7500000-0000-4000-8000-00000000000a', 'c7500000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7500000-0000-4000-8000-00000000000a/pax_document/27500000-0000-4000-8000-000000000003',
   'rg-bruno.jpg', 'image/jpeg', 2000, now() + interval '1 hour');
insert into public.pax_documents (id, partner_id, org_id, traveler_id, trip_id, kind, file_id, source, reading, read_output) values
  ('37500000-0000-4000-8000-000000000001', 'c7500000-0000-4000-8000-0000000000aa', 'b7500000-0000-4000-8000-00000000000a',
   'f7500000-0000-4000-8000-000000000001', null, 'identity', '27500000-0000-4000-8000-000000000001', 'partner', 'done',
   '{"confere_tipo": "sim", "legivel": true}'),
  ('37500000-0000-4000-8000-000000000002', 'c7500000-0000-4000-8000-0000000000aa', 'b7500000-0000-4000-8000-00000000000a',
   'f7500000-0000-4000-8000-000000000003', '17500000-0000-4000-8000-00000000000a', 'boarding_pass',
   '27500000-0000-4000-8000-000000000002', 'passenger', 'pending', null),
  ('37500000-0000-4000-8000-000000000003', 'c7500000-0000-4000-8000-0000000000aa', 'b7500000-0000-4000-8000-00000000000a',
   'f7500000-0000-4000-8000-000000000002', null, 'identity', '27500000-0000-4000-8000-000000000003', 'partner', 'uploading', null);
-- What ONE read of Rafaela's identity: her nationality.
update public.pax_travelers
set read_fields = '{"nationality": {"document": "37500000-0000-4000-8000-000000000001", "kind": "identity"}}'
where id = 'f7500000-0000-4000-8000-000000000001';

insert into public.pax_consent_terms (partner_id, version, body) values
  ('c7500000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');
insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, expires_at) values
  ('c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a', 'b7500000-0000-4000-8000-00000000000a',
   'f7500000-0000-4000-8000-000000000001', encode(sha256(convert_to('repasse-rafaela-0000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days');

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

insert into res values ('wording', jsonb_build_object('text', public.pax_consent_wording('f7500000-0000-4000-8000-000000000001')));

-- The firm's test chat is on.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number', public.register_wa_number('b7500000-0000-4000-8000-00000000000a',
  'c7500000-0000-4000-8000-00000000000a', 'test', 'handoff-number-a', 'handoff-waba-a', '5500900000075', 'Souza Advogados', 'cloud'));
insert into res values ('chat', public.start_test_chat('b7500000-0000-4000-8000-00000000000a',
  pg_temp.got('number', 'number_id')::uuid, repeat('h', 43), 'a7500000-0000-4000-8000-000000000001'));
reset role;

-- Rafaela agrees on the agency's link.
select pg_temp.anonymous();
set local role anon;
insert into res values ('agreed', public.pax_link_answer('repasse-rafaela-0000000000000000', 'agreed',
  pg_temp.got('wording', 'text'), '{}'::jsonb, null));
reset role;

select ok(
  pg_temp.got('agreed', 'code') = 'agreed'
  and exists (select 1 from public.tracked_trips t
              where t.pax_trip_id = '17500000-0000-4000-8000-00000000000a' and t.is_test and t.label = 'agencia'
                and t.watch = 'simulated' and t.consent_channel = 'agency' and t.phone = '5500988880006'),
  'a passenger who agrees with the test chat''s number is followed by the firm''s test chat'
);

-- Her flight is cancelled, ONE tells her, and she taps SIM.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('alert', jsonb_build_object('id', (public.record_flight_alert(
  (select t.id from public.tracked_trips t where t.pax_trip_id = '17500000-0000-4000-8000-00000000000a'),
  'cancelled', 1, null, 'flight-problem-v1') ->> 'alert_id')));
insert into res values ('alert_claim', jsonb_build_object('claim',
  (public.claim_flight_alerts(1, pg_temp.got('alert', 'id')::uuid) -> 0) ->> 'claim'));
insert into res values ('reserved', public.reserve_flight_alert(pg_temp.got('alert', 'id')::uuid,
  pg_temp.got('alert_claim', 'claim')::integer,
  array['Rafaela', 'Souza Advogados', 'Voo de teste de hoje', 'foi cancelado', 'oferecer outro voo']));
insert into res values ('conversation', jsonb_build_object('id', public.wa_ingest_inbound('b7500000-0000-4000-8000-00000000000a',
  pg_temp.got('number', 'number_id')::uuid, '5500988880006', 'Rafaela', 'test.in.handoff-1', 'button', 'SIM') ->> 'conversation_id'));
insert into res values ('turn', jsonb_build_object('claim',
  (public.claim_conversation_turns(1, pg_temp.got('conversation', 'id')::uuid) -> 0) ->> 'claim'));
insert into res values ('opened', public.one_open_case_from_alert(pg_temp.got('conversation', 'id')::uuid,
  pg_temp.got('turn', 'claim')::integer, pg_temp.got('alert', 'id')::uuid,
  encode(sha256(convert_to('repasse-cliente-rafaela-00000000000000000000', 'UTF8')), 'hex'),
  'Pronto, Rafaela. O escritório abriu o seu caso, número {caso}. Abra o seu link: https://one.invalid/c/token-teste'));
reset role;

create temporary table handed as
select c.id as case_id, c.origin, c.partnership_id from public.cases c where c.id = pg_temp.got('opened', 'case_id')::uuid;
grant select on handed to authenticated, service_role;

select ok(
  pg_temp.got('opened', 'ok')::boolean
  and (select origin = 'agency' and partnership_id = 'd7500000-0000-4000-8000-00000000000a' from handed),
  'the case opens as the partnership''s'
);
select ok(
  exists (select 1 from public.case_parties cp join handed h on h.case_id = cp.case_id
          where cp.person_id = 'e7500000-0000-4000-8000-0000000000a1' and cp.role = 'claimant')
  and (select count(*) from public.people p where p.org_id = 'b7500000-0000-4000-8000-00000000000a' and p.cpf = '52998224725') = 1,
  'the firm''s client the agency''s passenger is takes the case, never a second record of her'
);
select ok(
  (select full_name = 'Rafaela Teste Lima' and email = 'rafaela@teste.invalid' and nationality = 'brasileira'
          and city = 'Goiânia' and phone = '5500988880006' and updated_via = 'partner'
   from public.people where id = 'e7500000-0000-4000-8000-0000000000a1'),
  'she keeps what her record said and takes what it lacked from the agency, with the WhatsApp of the conversation'
);
select ok(
  exists (select 1 from public.people p
          join public.case_parties cp on cp.person_id = p.id
          join handed h on h.case_id = cp.case_id
          where p.org_id = 'b7500000-0000-4000-8000-00000000000a' and p.full_name = 'Lia Teste' and p.cpf = '11144477735'
            and p.birth_date = (current_date - interval '8 years')::date and p.updated_via = 'partner'
            and cp.role = 'claimant' and cp.guardian_id is not null),
  'a passenger new to the firm takes the agency''s record, the CPF a client of another firm has included'
);
select ok(
  not exists (select 1 from public.people p where p.org_id = 'b7500000-0000-4000-8000-00000000000a' and p.full_name = 'Bruno Teste')
  and (select handed_over_at is null and case_id is null from public.pax_travelers where id = 'f7500000-0000-4000-8000-000000000002')
  and (select t.companions from public.tracked_trips t where t.pax_trip_id = '17500000-0000-4000-8000-00000000000a') @>
      '[{"name": "Lia Teste"}]'::jsonb
  and jsonb_array_length((select t.companions from public.tracked_trips t
                          where t.pax_trip_id = '17500000-0000-4000-8000-00000000000a')) = 1,
  'an adult who goes along under nobody''s agreement of their own is neither followed with the trip nor handed to the firm'
);
select ok(
  exists (select 1 from public.people p
          join public.case_parties cp on cp.person_id = p.id
          join handed h on h.case_id = cp.case_id
          join public.case_parties g on g.id = cp.guardian_id
          where p.full_name = 'Lia Teste' and cp.role = 'claimant'
            and g.person_id = 'e7500000-0000-4000-8000-0000000000a1' and g.role = 'guardian'),
  'the child goes with who answers for her'
);
select ok(
  (select count(*) from public.case_documents d join handed h on h.case_id = d.case_id
   where d.source = 'partner' and d.status = 'received' and d.processing = 'pending') = 2
  and exists (select 1 from public.case_documents d
              join public.case_parties cp on cp.id = d.party_id
              where d.file_id = '27500000-0000-4000-8000-000000000001' and d.kind = 'identity'
                and cp.person_id = 'e7500000-0000-4000-8000-0000000000a1')
  and not exists (select 1 from public.case_documents d where d.file_id = '27500000-0000-4000-8000-000000000003'),
  'the documents the agency kept become the case''s, checked as a client''s, and one still on its way does not'
);
select ok(
  (select count(*) from public.files f
   where f.id in ('27500000-0000-4000-8000-000000000001', '27500000-0000-4000-8000-000000000002') and f.partner_id is null) = 2
  and (select count(*) from public.pax_documents d where d.case_document_id is not null) = 2
  and (select partner_id is not null from public.files where id = '27500000-0000-4000-8000-000000000003'),
  'their files are the firm''s now'
);
select ok(
  (select read_fields -> 'nationality' ->> 'document'
   from public.people where id = 'e7500000-0000-4000-8000-0000000000a1')
  = (select d.id::text from public.case_documents d where d.file_id = '27500000-0000-4000-8000-000000000001'),
  'what ONE read of the agency''s document stays marked as read, of the case''s document'
);
select ok(
  (select count(*) from public.pax_travelers t join handed h on h.case_id = t.case_id where t.handed_over_at is not null) = 2
  and public.pax_trip_state('17500000-0000-4000-8000-00000000000a') = 'case_opened',
  'the agency''s passengers are handed over, and the agency reads that the passenger is with the firm'
);
select ok(
  exists (select 1 from public.case_events e join handed h on h.case_id = e.case_id
          where e.kind = 'agency_handoff' and e.actor_type = 'system'
            and (e.data ->> 'people')::integer = 2 and (e.data ->> 'documents')::integer = 2),
  'the case''s timeline tells the handoff'
);

select pg_temp.sign_in('a7500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_reads', jsonb_build_object(
  'files', (select count(*) from public.files where id = '27500000-0000-4000-8000-000000000001'),
  'trip', (select count(*) from public.tracked_trips where pax_trip_id = '17500000-0000-4000-8000-00000000000a')));
reset role;
select pg_temp.sign_in('a7500000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('duda_reads', jsonb_build_object(
  'files', (select count(*) from public.files where id = '27500000-0000-4000-8000-000000000001'),
  'case', (select count(*) from public.cases)));
reset role;
select pg_temp.sign_in('a7500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio_reads', jsonb_build_object(
  'case', (select count(*) from public.cases c join handed h on h.case_id = c.id),
  'documents', (select count(*) from public.case_documents where source = 'partner')));
reset role;

select ok(
  pg_temp.got('ana_reads', 'files') = '1' and pg_temp.got('ana_reads', 'trip') = '1'
  and pg_temp.got('duda_reads', 'files') = '0' and pg_temp.got('duda_reads', 'case') = '0',
  'the firm reads the file and the trip now, and the agency neither the file nor the case'
);
select ok(
  pg_temp.got('caio_reads', 'case') = '0' and pg_temp.got('caio_reads', 'documents') = '0',
  'another firm reads none of it'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('client_agency', public.client_link_agency('repasse-cliente-rafaela-00000000000000000000'));
reset role;
select ok(
  pg_temp.got('opened', 'code') = 'opened' and pg_temp.got('client_agency', 'agency') = 'Viagens Sol'
  and pg_temp.got('client_agency', 'finished') = 'false',
  'the client''s link says which agency the data came from, until the client confirms them'
);

-- A passenger with a real number is followed at FlightAware, as before.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, phone) values
  ('f7500000-0000-4000-8000-000000000004', 'c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a',
   'b7500000-0000-4000-8000-00000000000a', 'Carla Teste', '5562999990007');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id) values
  ('17500000-0000-4000-8000-00000000000b', 'c7500000-0000-4000-8000-0000000000aa', 'd7500000-0000-4000-8000-00000000000a',
   'b7500000-0000-4000-8000-00000000000a', 'f7500000-0000-4000-8000-000000000004');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('17500000-0000-4000-8000-00000000000b', 'f7500000-0000-4000-8000-000000000004');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('17500000-0000-4000-8000-00000000000b', 1, 'G31450', 'BSB', 'GIG', current_date + 3 + time '14:00', current_date + 3 + time '15:45');
insert into res values ('carla', jsonb_build_object('followed',
  public.pax_follow_trip('17500000-0000-4000-8000-00000000000b', pg_temp.got('wording', 'text'))));

select ok(
  pg_temp.got('carla', 'followed') = 'followed'
  and exists (select 1 from public.tracked_trips t
              where t.pax_trip_id = '17500000-0000-4000-8000-00000000000b' and not t.is_test and t.label is null
                and t.watch = 'flightaware' and t.consent_channel = 'agency'),
  'a passenger with a real number is followed at FlightAware'
);

select * from finish();
rollback;
