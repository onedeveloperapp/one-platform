begin;
create extension if not exists pgtap;
select plan(17);

-- ============================================================
-- How long an agency's passengers are kept, and their rights (0072): the
-- daily sweep forgets who never became the firm's client after the setting's
-- days (more after a problem that did not become a case), the agency's copy
-- of who went to the firm, and the passengers of a partnership that ended;
-- forgetting deletes the record, the trips ONE followed (but a case's), and
-- the files the agency held, whose bytes the backend removes after; nothing
-- of a person stays in the audit trail. The agency and the passenger take
-- what is kept and delete it on request. A partnership that ends stops its
-- trips. Each firm reads the flights within its own share of the day. Two
-- firms, one agency.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-retencao.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-retencao.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7600000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-retencao.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a7600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@viagens-retencao.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now()),
  ('a7600000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one-retencao.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a7600000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b7600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-retencao', 'a7600000-0000-4000-8000-000000000001'),
  ('b7600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-retencao', 'a7600000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7600000-0000-4000-8000-00000000000a', 'a7600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7600000-0000-4000-8000-00000000000b', 'a7600000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values ('c7600000-0000-4000-8000-0000000000aa', 'Viagens Sol');
insert into public.partner_members (partner_id, user_id, role) values
  ('c7600000-0000-4000-8000-0000000000aa', 'a7600000-0000-4000-8000-000000000003', 'owner'),
  ('c7600000-0000-4000-8000-0000000000aa', 'a7600000-0000-4000-8000-000000000004', 'member');
-- With firm A the partnership goes on; with firm B it ended forty days ago.
insert into public.partner_links (id, partner_id, org_id, module_key, status, ended_at, end_reason) values
  ('d7600000-0000-4000-8000-00000000000a', 'c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000a',
   'direito-do-passageiro', 'active', null, null),
  ('d7600000-0000-4000-8000-00000000000b', 'c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000b',
   'direito-do-passageiro', 'ended', now() - interval '40 days', 'Fim do contrato de teste');

-- The passengers, by what became of them.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, created_at, updated_at, handed_over_at) values
  -- A trip forty days gone, with no problem.
  ('f7600000-0000-4000-8000-000000000001', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Quieta Teste', now() - interval '60 days', now() - interval '60 days', null),
  -- A trip forty days gone, with a problem told and not answered.
  ('f7600000-0000-4000-8000-000000000002', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Problema Teste', now() - interval '60 days', now() - interval '60 days', null),
  -- A trip two hundred days gone, whose problem the passenger answered no to.
  ('f7600000-0000-4000-8000-000000000003', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Antiga Teste', now() - interval '220 days', now() - interval '220 days', null),
  -- A trip ten days ahead.
  ('f7600000-0000-4000-8000-000000000004', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Futura Teste', now() - interval '60 days', now() - interval '60 days', null),
  -- Went to the firm forty days ago.
  ('f7600000-0000-4000-8000-000000000005', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Repassada Teste', now() - interval '60 days', now() - interval '60 days',
   now() - interval '40 days'),
  -- No trip, last changed forty days ago.
  ('f7600000-0000-4000-8000-000000000006', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Sem Viagem Teste', now() - interval '40 days', now() - interval '40 days', null),
  -- Of the partnership that ended.
  ('f7600000-0000-4000-8000-000000000007', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000b',
   'b7600000-0000-4000-8000-00000000000b', 'Encerrada Teste', now() - interval '60 days', now() - interval '60 days', null),
  -- A passenger who asks for their data on the link, and a child they answer for.
  ('f7600000-0000-4000-8000-000000000008', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Pedido Teste', now(), now(), null);
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, guardian_id) values
  ('f7600000-0000-4000-8000-000000000009', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a',
   'b7600000-0000-4000-8000-00000000000a', 'Filha Pedido Teste', (current_date - interval '6 years')::date,
   'f7600000-0000-4000-8000-000000000008');

insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id) values
  ('17600000-0000-4000-8000-000000000001', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000001'),
  ('17600000-0000-4000-8000-000000000002', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000002'),
  ('17600000-0000-4000-8000-000000000003', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000003'),
  ('17600000-0000-4000-8000-000000000004', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000004'),
  ('17600000-0000-4000-8000-000000000008', 'c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000008');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('17600000-0000-4000-8000-000000000001', 'f7600000-0000-4000-8000-000000000001'),
  ('17600000-0000-4000-8000-000000000002', 'f7600000-0000-4000-8000-000000000002'),
  ('17600000-0000-4000-8000-000000000003', 'f7600000-0000-4000-8000-000000000003'),
  ('17600000-0000-4000-8000-000000000004', 'f7600000-0000-4000-8000-000000000004'),
  ('17600000-0000-4000-8000-000000000008', 'f7600000-0000-4000-8000-000000000008'),
  ('17600000-0000-4000-8000-000000000008', 'f7600000-0000-4000-8000-000000000009');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('17600000-0000-4000-8000-000000000001', 1, 'LA3456', 'GRU', 'REC', (current_date - 40) + time '08:10', (current_date - 40) + time '11:25'),
  ('17600000-0000-4000-8000-000000000002', 1, 'LA3456', 'GRU', 'REC', (current_date - 40) + time '08:10', (current_date - 40) + time '11:25'),
  ('17600000-0000-4000-8000-000000000003', 1, 'LA3456', 'GRU', 'REC', (current_date - 200) + time '08:10', (current_date - 200) + time '11:25'),
  ('17600000-0000-4000-8000-000000000004', 1, 'LA3456', 'GRU', 'REC', (current_date + 10) + time '08:10', (current_date + 10) + time '11:25'),
  ('17600000-0000-4000-8000-000000000008', 1, 'G31450', 'BSB', 'GIG', current_date + time '14:00', current_date + time '15:45');

-- The trips ONE followed of them.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel,
                                  status, watch, pax_trip_id) values
  ('27600000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-00000000000a', 'Quieta Teste', '5562999990001', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching', 'flightaware', '17600000-0000-4000-8000-000000000001'),
  ('27600000-0000-4000-8000-000000000002', 'b7600000-0000-4000-8000-00000000000a', 'Problema Teste', '5562999990002', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'alerted', 'flightaware', '17600000-0000-4000-8000-000000000002'),
  ('27600000-0000-4000-8000-000000000003', 'b7600000-0000-4000-8000-00000000000a', 'Antiga Teste', '5562999990003', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'declined', 'flightaware', '17600000-0000-4000-8000-000000000003'),
  ('27600000-0000-4000-8000-000000000008', 'b7600000-0000-4000-8000-00000000000a', 'Pedido Teste', '5562999990008', 'G3',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching', 'flightaware', '17600000-0000-4000-8000-000000000008');

-- Files the agency holds, and one that went to the firm with its passenger.
insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status,
                          sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('37600000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-00000000000a', 'c7600000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7600000-0000-4000-8000-00000000000a/pax_document/37600000-0000-4000-8000-000000000001',
   'rg-quieta.pdf', 'application/pdf', 2000, 'stored', repeat('a', 64), 2000, 'application/pdf', now() + interval '1 hour', now()),
  ('37600000-0000-4000-8000-000000000002', 'b7600000-0000-4000-8000-00000000000a', 'c7600000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7600000-0000-4000-8000-00000000000a/pax_document/37600000-0000-4000-8000-000000000002',
   'rg-problema.pdf', 'application/pdf', 2000, 'stored', repeat('b', 64), 2000, 'application/pdf', now() + interval '1 hour', now()),
  ('37600000-0000-4000-8000-000000000005', 'b7600000-0000-4000-8000-00000000000a', null,
   'pax_document', 'org/b7600000-0000-4000-8000-00000000000a/pax_document/37600000-0000-4000-8000-000000000005',
   'rg-repassada.pdf', 'application/pdf', 2000, 'stored', repeat('c', 64), 2000, 'application/pdf', now() + interval '1 hour', now()),
  ('37600000-0000-4000-8000-000000000008', 'b7600000-0000-4000-8000-00000000000a', 'c7600000-0000-4000-8000-0000000000aa',
   'pax_document', 'org/b7600000-0000-4000-8000-00000000000a/pax_document/37600000-0000-4000-8000-000000000008',
   'rg-pedido.pdf', 'application/pdf', 2000, 'stored', repeat('d', 64), 2000, 'application/pdf', now() + interval '1 hour', now());
insert into public.pax_documents (partner_id, org_id, traveler_id, kind, file_id, source, reading, case_document_id) values
  ('c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000001', 'identity',
   '37600000-0000-4000-8000-000000000001', 'partner', 'done', null),
  ('c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000002', 'identity',
   '37600000-0000-4000-8000-000000000002', 'partner', 'done', null),
  ('c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000005', 'identity',
   '37600000-0000-4000-8000-000000000005', 'partner', 'done', gen_random_uuid()),
  ('c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000008', 'identity',
   '37600000-0000-4000-8000-000000000008', 'partner', 'done', null);
insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, wording, answer) values
  ('c7600000-0000-4000-8000-0000000000aa', 'b7600000-0000-4000-8000-00000000000a', 'f7600000-0000-4000-8000-000000000008',
   'f7600000-0000-4000-8000-000000000008', 'Concordo em receber os avisos dos meus voos pelo escritório.', 'agreed');
insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, expires_at) values
  ('c7600000-0000-4000-8000-0000000000aa', 'd7600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a',
   'f7600000-0000-4000-8000-000000000008', encode(sha256(convert_to('retencao-pedido-000000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days');

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

-- ---------- What the agency and the passenger take, and delete ----------

select pg_temp.sign_in('a7600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('edu_export', public.pax_export_traveler('f7600000-0000-4000-8000-000000000002'));
reset role;
select pg_temp.sign_in('a7600000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.pax_export_traveler('f7600000-0000-4000-8000-000000000002')$$,
  '42501', 'not_authorized',
  'the firm takes nothing of the agency''s passengers'
);
reset role;
select ok(
  pg_temp.got('edu_export', 'code') = 'exported'
  and (select payload -> 'data' -> 'pessoa' ->> 'nome' from res where name = 'edu_export') = 'Problema Teste'
  and (select payload -> 'data' -> 'viagens' -> 0 ->> 'acompanhamento' from res where name = 'edu_export') = 'alerted'
  and exists (select 1 from public.audit_events where action = 'pax.traveler.exported'
              and entity_id = 'f7600000-0000-4000-8000-000000000002'),
  'somebody of the agency takes what is kept of a passenger, on the record'
);

select pg_temp.sign_in('a7600000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.pax_forget_traveler('f7600000-0000-4000-8000-000000000004')$$,
  '42501', 'not_authorized',
  'a member of the agency who does not manage it deletes no passenger'
);
reset role;
select pg_temp.sign_in('a7600000-0000-4000-8000-000000000003', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.pax_forget_traveler('f7600000-0000-4000-8000-000000000004')$$,
  '42501', 'second_factor_required',
  'and who manages it, with the second factor'
);
reset role;

select pg_temp.anonymous();
set local role anon;
insert into res values ('link_export', public.pax_link_export('retencao-pedido-000000000000000000'));
select throws_ok(
  $$select public.pax_link_forget('retencao-pedido-000000000000000000', '{}'::jsonb)$$,
  '42501', null,
  'the link''s deletion goes through the backend, which reads the token from the request'
);
reset role;
select ok(
  jsonb_array_length((select payload -> 'data' from res where name = 'link_export')) = 2
  and (select payload -> 'data' -> 0 -> 'pessoa' ->> 'nome' from res where name = 'link_export') = 'Pedido Teste'
  and (select payload -> 'data' -> 0 -> 'respostas' -> 0 ->> 'resposta' from res where name = 'link_export') = 'agreed',
  'the passenger takes on the link what is kept of them and of the child they answer for'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('link_forget', public.pax_link_forget('retencao-pedido-000000000000000000',
  '{"user_agent": "Navegador de teste"}'::jsonb));
reset role;
select ok(
  pg_temp.got('link_forget', 'people') = '2'
  and not exists (select 1 from public.pax_travelers where id in ('f7600000-0000-4000-8000-000000000008', 'f7600000-0000-4000-8000-000000000009'))
  and not exists (select 1 from public.tracked_trips where id = '27600000-0000-4000-8000-000000000008')
  and not exists (select 1 from public.files where id = '37600000-0000-4000-8000-000000000008')
  and exists (select 1 from public.pax_file_removals
              where storage_path = 'org/b7600000-0000-4000-8000-00000000000a/pax_document/37600000-0000-4000-8000-000000000008')
  and not exists (select 1 from public.pax_confirm_links where holder_id = 'f7600000-0000-4000-8000-000000000008'),
  'the passenger''s request deletes them and the child, the trip ONE followed and the file, whose bytes the backend removes'
);

-- ---------- The sweep ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('sweep', public.pax_retention_sweep());
reset role;

select ok(
  pg_temp.got('sweep', 'forgotten') = '5'
  and not exists (select 1 from public.pax_travelers where id in (
    'f7600000-0000-4000-8000-000000000001', 'f7600000-0000-4000-8000-000000000003', 'f7600000-0000-4000-8000-000000000005',
    'f7600000-0000-4000-8000-000000000006', 'f7600000-0000-4000-8000-000000000007'))
  and (select count(*) from public.pax_travelers where id in (
    'f7600000-0000-4000-8000-000000000002', 'f7600000-0000-4000-8000-000000000004')) = 2,
  'the sweep forgets who is kept no longer, and keeps a problem''s passenger and a trip to come'
);
select ok(
  not exists (select 1 from public.tracked_trips where id in ('27600000-0000-4000-8000-000000000001', '27600000-0000-4000-8000-000000000003'))
  and exists (select 1 from public.tracked_trips where id = '27600000-0000-4000-8000-000000000002'),
  'the trips ONE followed of them go with them'
);
select ok(
  not exists (select 1 from public.files where id = '37600000-0000-4000-8000-000000000001')
  and exists (select 1 from public.files where id = '37600000-0000-4000-8000-000000000005')
  and not exists (select 1 from public.pax_file_removals where storage_path like '%37600000-0000-4000-8000-000000000005'),
  'a file the agency held goes, and one the firm received with its passenger stays the firm''s'
);
select ok(
  (select count(*) from public.audit_events where action = 'pax.traveler.forgotten') = 7
  and not exists (select 1 from public.audit_events where action = 'pax.traveler.forgotten'
                  and (metadata::text like '%Teste%' or metadata - array['reason', 'files', 'trips', 'handed_over'] <> '{}'::jsonb)),
  'the audit trail keeps why and how much, never a person'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('due', jsonb_build_object('paths', (select jsonb_agg(storage_path) from public.pax_file_removals_due(100))));
insert into res values ('done', jsonb_build_object('count', public.pax_file_removals_done(
  array(select storage_path from public.pax_file_removals_due(100)))));
reset role;
select ok(
  jsonb_array_length((select payload -> 'paths' from res where name = 'due')) = 2
  and pg_temp.got('done', 'count') = '2' and not exists (select 1 from public.pax_file_removals),
  'the backend removes the bytes it owes, and its list empties'
);

-- ---------- A partnership that ends ----------

select pg_temp.sign_in('a7600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ended', public.end_partner_link('d7600000-0000-4000-8000-00000000000a', 'Fim do contrato de teste'));
reset role;
select ok(
  pg_temp.got('ended', 'code') = 'ended'
  and (select status from public.tracked_trips where id = '27600000-0000-4000-8000-000000000002') = 'stopped',
  'a partnership that ends stops the trips ONE followed for it'
);

-- ---------- Each firm's share of the flight reads ----------

update public.platform_settings set value = value || '{"watch_firm_daily_reads": 3}'::jsonb where key = 'flight_alerts';
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel,
                                  status, watch) values
  ('47600000-0000-4000-8000-00000000000a', 'b7600000-0000-4000-8000-00000000000a', 'Leitura Um', '5562999990011', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware'),
  ('47600000-0000-4000-8000-00000000000b', 'b7600000-0000-4000-8000-00000000000a', 'Leitura Dois', '5562999990012', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware'),
  ('47600000-0000-4000-8000-00000000000c', 'b7600000-0000-4000-8000-00000000000b', 'Leitura Tres', '5562999990013', 'G3',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware');
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                 scheduled_departure_local, scheduled_arrival_local)
select t.org_id, t.id, p.position, 'LA3456', 'GRU', 'REC',
       (now() at time zone 'America/Sao_Paulo') - interval '1 hour', (now() at time zone 'America/Sao_Paulo') + interval '2 hours'
from public.tracked_trips t
cross join (values (1), (2)) as p (position)
where t.id in ('47600000-0000-4000-8000-00000000000a', '47600000-0000-4000-8000-00000000000b')
union all
select t.org_id, t.id, 1, 'G31450', 'BSB', 'GIG',
       (now() at time zone 'America/Sao_Paulo') - interval '1 hour', (now() at time zone 'America/Sao_Paulo') + interval '2 hours'
from public.tracked_trips t where t.id = '47600000-0000-4000-8000-00000000000c';

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', jsonb_build_object('trips', public.claim_trip_watch(10)));
reset role;
select ok(
  (select count(*) from jsonb_array_elements((select payload -> 'trips' from res where name = 'claimed')) x
   where x.value ->> 'org_id' = 'b7600000-0000-4000-8000-00000000000a') = 1
  and (select count(*) from jsonb_array_elements((select payload -> 'trips' from res where name = 'claimed')) x
       where x.value ->> 'org_id' = 'b7600000-0000-4000-8000-00000000000b') = 1,
  'a firm reads the flights within its share of the day, and another firm goes on'
);

select pg_temp.sign_in('a7600000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('watch', public.admin_flight_watch_status());
insert into res values ('partners', jsonb_build_object('list', public.admin_partner_overview()));
insert into res values ('no_firm', public.admin_people_without_firm());
reset role;
select ok(
  (select payload -> 'firms_today' -> 0 ->> 'firm' from res where name = 'watch') = 'Souza Advogados'
  and pg_temp.got('watch', 'firm_daily_reads') = '3'
  and jsonb_array_length((select payload -> 'list' from res where name = 'partners')) = 2
  and (select x.value ->> 'agency' from jsonb_array_elements((select payload -> 'list' from res where name = 'partners')) x limit 1)
      = 'Viagens Sol',
  'the operator reads each firm''s reads of the day, and each partnership in counts'
);

select ok(
  not exists (select 1 from jsonb_array_elements((select payload -> 'people' from res where name = 'no_firm')) x
              where x.value ->> 'userId' in ('a7600000-0000-4000-8000-000000000003', 'a7600000-0000-4000-8000-000000000004'))
  and (select (x.value ->> 'members')::integer
       from jsonb_array_elements((select payload -> 'list' from res where name = 'partners')) x limit 1) = 2,
  'the people of an agency are read with their partnership, never among the accounts waiting to found a firm'
);

select pg_temp.sign_in('a7600000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_partner_overview()$$,
  '42501', 'not_authorized',
  'a firm does not read the operator''s list of partnerships'
);
reset role;

select * from finish();
rollback;
