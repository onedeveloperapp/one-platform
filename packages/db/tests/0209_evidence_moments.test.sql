begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The evidence kit (0209). Lima's case has a leg from Goiânia to São Paulo,
-- ONE's word about its delay, a photo of the board the client sent (whose
-- camera wrote when it was taken), a receipt and an identity; a refused
-- photo stays out. The kit gives the leg's moments as instants, the word and
-- the two proofs in the order they arrived; the backend keeps a photo's
-- moment once, and only of a proof. Rocha reads nothing of Lima's.
--
-- Every person, firm, number and text here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2090000-0000-4000-8000-000000000001', 'ana@lima-kit.invalid', 'Ana Lima'),
  ('a2090000-0000-4000-8000-000000000003', 'edu@rocha-kit.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2090000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-kit', 'a2090000-0000-4000-8000-000000000001'),
  ('b2090000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-kit', 'a2090000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2090000-0000-4000-8000-00000000000a', 'a2090000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2090000-0000-4000-8000-00000000000b', 'a2090000-0000-4000-8000-000000000003', 'owner', 'socio');
insert into public.people (id, org_id, full_name, cpf) values
  ('d2090000-0000-4000-8000-000000000001', 'b2090000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2090000-0000-4000-8000-000000000001', 'b2090000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2090000-0000-4000-8000-000000000001', 'b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001',
   'd2090000-0000-4000-8000-000000000001', 'claimant');
insert into public.flight_segments (org_id, case_id, position, flight_number, origin_iata, destination_iata,
                                    scheduled_departure_local, scheduled_arrival_local, affected) values
  ('b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001', 1, 'LA3456', 'GYN', 'GRU',
   '2099-10-22 08:10', '2099-10-22 09:55', true);
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, consent_wording, consent_at,
                                  consent_channel, watch) values
  ('f2090000-0000-4000-8000-00000000000a', 'b2090000-0000-4000-8000-00000000000a', 'Maria Teste', '5562999990001', 'LA',
   false, 'A passageira concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware');
insert into public.flight_alerts (org_id, trip_id, kind, rule_version, status, sent_at, journey, legs, case_id, delay_minutes) values
  ('b2090000-0000-4000-8000-00000000000a', 'f2090000-0000-4000-8000-00000000000a', 'delayed', 'flight-problem-v4', 'sent',
   '2099-10-22 11:40+00', 1, array[1], 'c2090000-0000-4000-8000-000000000001', 240);
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                          detected_mime, expires_at, confirmed_at)
select id::uuid, 'b2090000-0000-4000-8000-00000000000a', 'upload', 'org/b2090000-0000-4000-8000-00000000000a/upload/' || id,
  name, 'image/jpeg', 100, 'stored', repeat(hash, 64), 100, 'image/jpeg', now(), at::timestamptz
from (values
  ('f2090000-0000-4000-8000-000000000001', 'painel.jpg', 'a', '2099-10-22 12:05+00'),
  ('f2090000-0000-4000-8000-000000000002', 'recibo.jpg', 'b', '2099-10-22 15:30+00'),
  ('f2090000-0000-4000-8000-000000000003', 'identidade.jpg', 'c', '2099-10-22 12:00+00'),
  ('f2090000-0000-4000-8000-000000000004', 'borrada.jpg', 'd', '2099-10-22 12:01+00')
) as f (id, name, hash, at);
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, rejected_reason) values
  ('a2090000-0000-4000-8000-0000000000d1', 'b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001',
   'e2090000-0000-4000-8000-000000000001', 'f2090000-0000-4000-8000-000000000001', 'evidence', 'client', 'received', null),
  ('a2090000-0000-4000-8000-0000000000d2', 'b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001',
   'e2090000-0000-4000-8000-000000000001', 'f2090000-0000-4000-8000-000000000002', 'receipt', 'whatsapp', 'accepted', null),
  ('a2090000-0000-4000-8000-0000000000d3', 'b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001',
   'e2090000-0000-4000-8000-000000000001', 'f2090000-0000-4000-8000-000000000003', 'identity', 'client', 'accepted', null),
  ('a2090000-0000-4000-8000-0000000000d4', 'b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001',
   'e2090000-0000-4000-8000-000000000001', 'f2090000-0000-4000-8000-000000000004', 'evidence', 'client', 'rejected',
   'A foto ficou tremida.');

-- The backend keeps a photo's moment once, and only of a proof.
select ok(public.keep_document_taken('a2090000-0000-4000-8000-0000000000d1', '2099-10-22 09:03:10', '-03:00'),
  'the moment a proof says it was taken is kept');
select ok(not public.keep_document_taken('a2090000-0000-4000-8000-0000000000d1', '2099-10-23 10:00:00', null),
  'a moment on record is never written over');
select ok(not public.keep_document_taken('a2090000-0000-4000-8000-0000000000d3', '2099-10-22 09:00:00', null),
  'an identity takes no moment');
select throws_ok(
  $$update public.case_documents set taken_offset = 'Brasília' where id = 'a2090000-0000-4000-8000-0000000000d2'$$,
  '23514', null, 'an offset is only an offset, and only with a moment');

-- Lima reads its kit.
select set_config('request.jwt.claims', '{"sub":"a2090000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
create temp table kit on commit drop as
select public.case_evidence_moments('b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001') as v;
select is((select (v -> 'legs' -> 0 ->> 'departure_at')::timestamptz from kit), '2099-10-22 11:10+00'::timestamptz,
  'a leg leaves at an instant, by its airport''s offset');
select is((select v -> 'alerts' -> 0 ->> 'kind' from kit), 'delayed', 'the kit holds what ONE told the passenger of the flight');
select is((select jsonb_agg(p ->> 'kind') from kit, jsonb_array_elements(v -> 'proofs') p), '["evidence", "receipt"]'::jsonb,
  'the proofs in the order they arrived, never an identity nor a refused one');
select is((select v -> 'proofs' -> 0 ->> 'taken_local' from kit), '2099-10-22T09:03:10',
  'a proof says when it was taken, as the device wrote it');
reset role;

-- Rocha reads nothing of Lima's.
select set_config('request.jwt.claims', '{"sub":"a2090000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.case_evidence_moments('b2090000-0000-4000-8000-00000000000a', 'c2090000-0000-4000-8000-000000000001')$$,
  '42501', null, 'another firm reads nothing of the kit');
reset role;

select * from finish();
rollback;
