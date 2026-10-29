begin;
create extension if not exists pgtap;
select plan(36);

-- ============================================================
-- The agency's area of the passenger module (0070): the agency adds its
-- passengers, their trips and documents; the AI reads each document and
-- writes what it says where the record has nothing (a shadow task: the firm
-- never reads its runs); the passenger agrees on a link, in the very words
-- shown, for themself and the children they answer for, which starts ONE
-- following the trips they hold, and a trip an agency sent is the firm's to
-- read only once its case opened. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-agencias.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-agencias.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7400000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-sol.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a7400000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@viagens-sol.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now()),
  ('a7400000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabi@turismo-mar.invalid', '', now(), '{}', '{"display_name":"Fabi Costa"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b7400000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-agencias', 'a7400000-0000-4000-8000-000000000001'),
  ('b7400000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-agencias', 'a7400000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7400000-0000-4000-8000-00000000000a', 'a7400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7400000-0000-4000-8000-00000000000b', 'a7400000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values
  ('c7400000-0000-4000-8000-00000000000a', 'Viagens Sol'),
  ('c7400000-0000-4000-8000-00000000000b', 'Turismo Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c7400000-0000-4000-8000-00000000000a', 'a7400000-0000-4000-8000-000000000003', 'owner'),
  ('c7400000-0000-4000-8000-00000000000a', 'a7400000-0000-4000-8000-000000000004', 'member'),
  ('c7400000-0000-4000-8000-00000000000b', 'a7400000-0000-4000-8000-000000000005', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d7400000-0000-4000-8000-00000000000a', 'c7400000-0000-4000-8000-00000000000a', 'b7400000-0000-4000-8000-00000000000a', 'direito-do-passageiro'),
  ('d7400000-0000-4000-8000-00000000000b', 'c7400000-0000-4000-8000-00000000000b', 'b7400000-0000-4000-8000-00000000000b', 'direito-do-passageiro');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, aal text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', aal)::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- The bytes of a reserved file arrived and the backend measured them.
create function pg_temp.stored(file uuid) returns void language sql as $$
  update public.files set status = 'stored', sha256 = repeat('a', 64), bytes = 2000, detected_mime = declared_mime,
    confirmed_at = now() where id = file;
$$;

-- ---------- The agency adds its passengers ----------

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('mariana', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null,
  '{"full_name": " Mariana   Teste ", "cpf": "111.444.777-35", "birth_date": "1988-03-02", "phone": "(62) 99999-0001"}'));
insert into res values ('lia', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Lia Teste", "birth_date": "2018-05-10"}', pg_temp.got('mariana', 'traveler_id')::uuid));
insert into res values ('child_guardian', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Outra Criança"}', pg_temp.got('lia', 'traveler_id')::uuid));
insert into res values ('same_cpf', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Outra Pessoa", "cpf": "11144477735"}'));
insert into res values ('bad_cpf', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Pessoa Errada", "cpf": "12345678900"}'));
insert into res values ('pedro', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Pedro Teste", "cpf": "529.982.247-25", "birth_date": "1979-11-30", "phone": "62999990002"}'));
reset role;

select ok(
  pg_temp.got('mariana', 'code') = 'added'
  and exists (select 1 from public.pax_travelers t where t.id = pg_temp.got('mariana', 'traveler_id')::uuid
              and t.full_name = 'Mariana Teste' and t.cpf = '11144477735' and t.phone = '5562999990001'
              and t.org_id = 'b7400000-0000-4000-8000-00000000000a'),
  'the agency adds a passenger, each field normalized and checked'
);
select ok(
  pg_temp.got('lia', 'code') = 'added' and pg_temp.got('child_guardian', 'code') = 'invalid_guardian',
  'a child is added with the adult who answers for them, and a child answers for nobody'
);
select ok(
  pg_temp.got('same_cpf', 'code') = 'cpf_in_use' and pg_temp.got('bad_cpf', 'code') = 'invalid_cpf',
  'a CPF is checked and belongs to one passenger of the partnership'
);

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003', 'aal1');
set local role authenticated;
select throws_ok(
  $$ select public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null, '{"full_name": "Sem Fator"}') $$,
  '42501', 'second_factor_required',
  'the agency writes with the second factor'
);
reset role;

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$ select public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null, '{"full_name": "Alheio Teste"}') $$,
  '42501', 'not_authorized',
  'another agency writes nothing in the partnership'
);
insert into res values ('fabi_reads', jsonb_build_object('travelers', (select count(*) from public.pax_travelers)));
reset role;
select pg_temp.sign_in('a7400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_reads', jsonb_build_object('travelers', (select count(*) from public.pax_travelers)));
reset role;
select ok(
  pg_temp.got('fabi_reads', 'travelers') = '0' and pg_temp.got('ana_reads', 'travelers') = '0',
  'nobody of the firm, nor another agency, reads the agency''s passengers'
);

-- ---------- A trip ----------

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('trip', public.pax_save_trip('d7400000-0000-4000-8000-00000000000a', null,
  pg_temp.got('mariana', 'traveler_id')::uuid, array[pg_temp.got('lia', 'traveler_id')::uuid], 'tstm4r',
  '[{"flight_number": "la 3456", "origin_iata": "gru", "destination_iata": "REC",
     "departure": "2099-11-20T08:10", "arrival": "2099-11-20T11:25"}]'));
insert into res values ('trip_bad_airport', public.pax_save_trip('d7400000-0000-4000-8000-00000000000a', null,
  pg_temp.got('mariana', 'traveler_id')::uuid, null, null,
  '[{"flight_number": "LA3456", "origin_iata": "XXX", "destination_iata": "REC",
     "departure": "2099-11-20T08:10", "arrival": "2099-11-20T11:25"}]'));
insert into res values ('trip_minor', public.pax_save_trip('d7400000-0000-4000-8000-00000000000a', null,
  pg_temp.got('lia', 'traveler_id')::uuid, null, null,
  '[{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC",
     "departure": "2099-11-20T08:10", "arrival": "2099-11-20T11:25"}]'));
reset role;

select ok(
  pg_temp.got('trip', 'code') = 'added'
  and exists (select 1 from public.pax_trips t where t.id = pg_temp.got('trip', 'trip_id')::uuid and t.locator = 'TSTM4R')
  and (select count(*) from public.pax_trip_travelers tt where tt.trip_id = pg_temp.got('trip', 'trip_id')::uuid) = 2
  and exists (select 1 from public.pax_trip_legs l where l.trip_id = pg_temp.got('trip', 'trip_id')::uuid
              and l.flight_number = 'LA3456' and l.origin_iata = 'GRU'),
  'the agency adds a trip: its holder, who goes along and its legs'
);
select ok(
  pg_temp.got('trip_bad_airport', 'code') = 'invalid_airport' and pg_temp.got('trip_minor', 'code') = 'holder_is_minor',
  'a leg names airports ONE knows, and a child holds no trip'
);

-- ---------- A document, and what the AI reads in it ----------

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('identity', public.pax_reserve_document(pg_temp.got('mariana', 'traveler_id')::uuid,
  'identity', null, 'rg-mariana.jpg', 'image/jpeg', 200000));
insert into res values ('identity_with_trip', public.pax_reserve_document(pg_temp.got('mariana', 'traveler_id')::uuid,
  'identity', pg_temp.got('trip', 'trip_id')::uuid, 'rg.jpg', 'image/jpeg', 200000));
insert into res values ('duda_file', jsonb_build_object('count', (select count(*) from public.files
  where id = pg_temp.got('identity', 'file_id')::uuid)));
reset role;
select pg_temp.sign_in('a7400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_file', jsonb_build_object('count', (select count(*) from public.files
  where id = pg_temp.got('identity', 'file_id')::uuid)));
reset role;

select ok(
  pg_temp.got('identity', 'code') = 'reserved'
  and exists (select 1 from public.files f where f.id = pg_temp.got('identity', 'file_id')::uuid
              and f.partner_id = 'c7400000-0000-4000-8000-00000000000a' and f.purpose = 'pax_document'
              and f.org_id = 'b7400000-0000-4000-8000-00000000000a')
  and pg_temp.got('identity_with_trip', 'code') = 'invalid_trip',
  'a document is reserved in the firm''s storage under the agency, an identity of nobody''s trip'
);
select ok(
  pg_temp.got('duda_file', 'count') = '1' and pg_temp.got('ana_file', 'count') = '0',
  'the agency reads its file, and the firm does not'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('confirmed', public.confirm_file(pg_temp.got('identity', 'file_id')::uuid, repeat('a', 64), 2000, 'image/jpeg'));
insert into res values ('uploaded', public.pax_document_uploaded(pg_temp.got('identity', 'file_id')::uuid));
insert into res values ('claimed', (select jsonb_build_object('document', c.document_id, 'claim', c.claim)
  from public.claim_pax_document_readings(5) c limit 1));
insert into res values ('to_read', (select to_jsonb(r) from public.pax_document_to_read(
  pg_temp.got('claimed', 'document')::uuid, pg_temp.got('claimed', 'claim')::integer) r));
insert into res values ('run', public.start_ai_run('b7400000-0000-4000-8000-00000000000a', 'parceiro.documento.leitura',
  repeat('b', 64), null, 'pax_document', pg_temp.got('claimed', 'document'), 'pax:' || pg_temp.got('claimed', 'document')));
select public.finish_ai_run((pg_temp.got('run', 'run_id'))::uuid, 'succeeded', '{
  "confere_tipo": "sim", "tipo_identificado": "RG", "legivel": true, "nome_no_documento": "MARIANA TESTE DE OLIVEIRA",
  "dados_lidos": {"nome_completo": "Mariana Teste de Oliveira", "cpf": "11144477735", "data_nascimento": "1988-03-02",
    "nacionalidade": "brasileira", "cep": "", "logradouro": "", "numero": "", "complemento": "", "bairro": "", "cidade": "", "uf": ""},
  "trechos": [], "observacoes": ""}'::jsonb, 900, 150);
insert into res values ('stale', public.record_pax_document_reading(pg_temp.got('claimed', 'document')::uuid, 0,
  pg_temp.got('run', 'run_id')::uuid, 'done'));
insert into res values ('read', public.record_pax_document_reading(pg_temp.got('claimed', 'document')::uuid,
  pg_temp.got('claimed', 'claim')::integer, pg_temp.got('run', 'run_id')::uuid, 'done'));
reset role;

select ok(
  pg_temp.got('confirmed', 'code') = 'stored'
  and exists (select 1 from public.audit_events e where e.entity_id = pg_temp.got('identity', 'file_id') and e.action = 'file.stored')
  and not exists (select 1 from public.audit_events e where e.entity_id = pg_temp.got('identity', 'file_id') and e.org_id is not null),
  'the measure of the agency''s file is on record, and none of it is in the firm''s audit trail'
);
select ok(
  pg_temp.got('uploaded', 'code') = 'pending' and pg_temp.got('claimed', 'document') = pg_temp.got('identity', 'document_id')
  and pg_temp.got('to_read', 'kind') = 'identity' and pg_temp.got('to_read', 'traveler_name') = 'Mariana Teste',
  'a measured file waits for the AI, and the backend reads it under a numbered claim'
);
select ok(pg_temp.got('stale', 'code') = 'not_held', 'an answer under a claim that is not the document''s writes nothing');
select ok(
  pg_temp.got('read', 'code') = 'done'
  and exists (select 1 from public.pax_travelers t where t.id = pg_temp.got('mariana', 'traveler_id')::uuid
              and t.full_name = 'Mariana Teste de Oliveira' and t.nationality = 'brasileira' and t.cpf = '11144477735'
              and t.read_fields ? 'full_name' and t.read_fields ? 'nationality' and not t.read_fields ? 'cpf'),
  'what the identity says is written where the record had nothing, the name completed, each field marked as read'
);

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_runs', jsonb_build_object('count', (select count(*) from public.ai_runs
  where task = 'parceiro.documento.leitura')));
reset role;
select ok(pg_temp.got('ana_runs', 'count') = '0', 'the firm never reads what the AI read for the agency');

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('corrected', public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a',
  pg_temp.got('mariana', 'traveler_id')::uuid, '{"nationality": "portuguesa"}'));
reset role;
select ok(
  exists (select 1 from public.pax_travelers t where t.id = pg_temp.got('mariana', 'traveler_id')::uuid
          and t.nationality = 'portuguesa' and not t.read_fields ? 'nationality' and t.read_fields ? 'full_name'),
  'a field the agency writes is the agency''s, and its mark of being read goes'
);

-- ---------- The clause and the passenger's link ----------

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.pax_save_consent_term('c7400000-0000-4000-8000-00000000000a', repeat('Cláusula de teste. ', 4)) $$,
  '42501', 'not_authorized',
  'a member of the agency does not write its clause'
);
reset role;

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('no_clause_link', public.pax_issue_confirm_link(pg_temp.got('mariana', 'traveler_id')::uuid,
  pg_temp.hash('link-mariana-0123456789')));
insert into res values ('clause', public.pax_save_consent_term('c7400000-0000-4000-8000-00000000000a',
  'O passageiro autoriza a Viagens Sol a compartilhar os seus dados com o escritório parceiro, nos termos deste contrato.'));
insert into res values ('child_link', public.pax_issue_confirm_link(pg_temp.got('lia', 'traveler_id')::uuid,
  pg_temp.hash('link-lia-0123456789abcd')));
insert into res values ('link', public.pax_issue_confirm_link(pg_temp.got('mariana', 'traveler_id')::uuid,
  pg_temp.hash('link-mariana-0123456789')));
reset role;

select ok(
  pg_temp.got('no_clause_link', 'code') = 'no_consent_term' and pg_temp.got('clause', 'version') = '1'
  and pg_temp.got('child_link', 'code') = 'holder_is_minor' and pg_temp.got('link', 'code') = 'issued',
  'a link is issued to an adult, once the agency registered the clause of its contract'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('opened', public.pax_link_open('link-mariana-0123456789'));
insert into res values ('opened_none', public.pax_link_open('link-que-nao-existe-123'));
reset role;

select ok(
  pg_temp.got('opened', 'state') = 'open' and pg_temp.got('opened', 'agency') = 'Viagens Sol'
  and pg_temp.got('opened', 'firm') = 'Souza Advogados'
  and jsonb_array_length(pg_temp.got('opened', 'people')::jsonb) = 2
  and jsonb_array_length(pg_temp.got('opened', 'trips')::jsonb) = 1
  and strpos(pg_temp.got('opened', 'wording'), 'Viagens Sol') > 0
  and strpos(pg_temp.got('opened', 'wording'), 'Lia Teste') > 0
  and strpos(pg_temp.got('opened', 'wording'), 'nos termos deste contrato') > 0
  and pg_temp.got('opened_none', 'found') = 'false',
  'the link shows the agency, the firm, the passenger and the child, the trip and the words to agree to'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('wrong_words', public.pax_link_answer('link-mariana-0123456789', 'agreed', 'Outras palavras quaisquer.'));
insert into res values ('agreed', public.pax_link_answer('link-mariana-0123456789', 'agreed',
  pg_temp.got('opened', 'wording'), '{"user_agent": "teste"}'));
reset role;

select ok(pg_temp.got('wrong_words', 'code') = 'wording_changed', 'an agreement is to the very words the page showed');
select ok(
  pg_temp.got('agreed', 'code') = 'agreed' and pg_temp.got('agreed', 'followed') = '1'
  and (select count(*) from public.pax_consents c where c.given_by = pg_temp.got('mariana', 'traveler_id')::uuid
       and c.answer = 'agreed') = 2,
  'the passenger agrees for themself and the child, each answer kept'
);
select ok(
  exists (select 1 from public.tracked_trips t where t.pax_trip_id = pg_temp.got('trip', 'trip_id')::uuid
          and t.consent_channel = 'agency' and t.status = 'watching' and t.watch = 'flightaware'
          and t.phone = '5562999990001' and t.airline_iata = 'LA'
          and t.companions -> 0 ->> 'name' = 'Lia Teste' and t.companions -> 0 ->> 'birth_date' = '2018-05-10'
          and t.companions -> 0 ->> 'pax_traveler_id' = pg_temp.got('lia', 'traveler_id'))
  and (select count(*) from public.tracked_legs l join public.tracked_trips t on t.id = l.trip_id
       where t.pax_trip_id = pg_temp.got('trip', 'trip_id')::uuid) = 1,
  'an agreement starts ONE following the trip the passenger holds'
);

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_trips', jsonb_build_object('count', (select count(*) from public.tracked_trips
  where consent_channel = 'agency')));
reset role;
select ok(pg_temp.got('ana_trips', 'count') = '0', 'the firm does not read a trip an agency sent while no case opened');

-- A change of the trip reaches the trip ONE follows, while nothing was told of it.
select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('trip_changed', public.pax_save_trip('d7400000-0000-4000-8000-00000000000a',
  pg_temp.got('trip', 'trip_id')::uuid, pg_temp.got('mariana', 'traveler_id')::uuid,
  array[pg_temp.got('lia', 'traveler_id')::uuid], 'TSTM4R',
  '[{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC",
     "departure": "2099-11-21T08:10", "arrival": "2099-11-21T11:25"}]'));
reset role;
select ok(
  pg_temp.got('trip_changed', 'code') = 'saved'
  and (select l.scheduled_departure_local from public.tracked_legs l join public.tracked_trips t on t.id = l.trip_id
       where t.pax_trip_id = pg_temp.got('trip', 'trip_id')::uuid) = timestamp '2099-11-21 08:10',
  'a trip the agency changes is followed as it is now'
);

select pg_temp.anonymous();
set local role anon;
insert into res values ('withdrawn', public.pax_link_answer('link-mariana-0123456789', 'withdrawn', pg_temp.got('opened', 'wording')));
reset role;
insert into res values ('stopped_state', jsonb_build_object('status', (select t.status from public.tracked_trips t
  where t.pax_trip_id = pg_temp.got('trip', 'trip_id')::uuid)));
select pg_temp.anonymous();
set local role anon;
insert into res values ('again', public.pax_link_answer('link-mariana-0123456789', 'agreed', pg_temp.got('opened', 'wording')));
reset role;
select ok(
  pg_temp.got('withdrawn', 'code') = 'withdrawn' and pg_temp.got('stopped_state', 'status') = 'stopped'
  and pg_temp.got('again', 'followed') = '1'
  and (select t.status from public.tracked_trips t where t.pax_trip_id = pg_temp.got('trip', 'trip_id')::uuid) = 'watching',
  'taking the agreement back stops the following, and agreeing again starts it'
);

-- ---------- The passenger sends a document on the link ----------

select pg_temp.anonymous();
set local role anon;
insert into res values ('link_upload', public.pax_link_reserve_upload('link-mariana-0123456789',
  pg_temp.got('mariana', 'traveler_id')::uuid, 'address_proof', null, 'conta.pdf', 'application/pdf', 300000));
insert into res values ('link_upload_other', public.pax_link_reserve_upload('link-mariana-0123456789',
  pg_temp.got('pedro', 'traveler_id')::uuid, 'identity', null, 'rg.pdf', 'application/pdf', 300000));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('finish_right', jsonb_build_object('count', (select count(*) from public.pax_upload_to_finish(
  pg_temp.got('link_upload', 'file_id')::uuid, 'link-mariana-0123456789'))));
insert into res values ('finish_wrong', jsonb_build_object('count', (select count(*) from public.pax_upload_to_finish(
  pg_temp.got('link_upload', 'file_id')::uuid, 'link-que-nao-existe-123'))));
reset role;

select ok(
  pg_temp.got('link_upload', 'code') = 'reserved' and pg_temp.got('link_upload_other', 'code') = 'traveler_not_found'
  and exists (select 1 from public.pax_documents d where d.id = pg_temp.got('link_upload', 'document_id')::uuid
              and d.source = 'passenger')
  and (select uploads from public.pax_confirm_links where token_hash = pg_temp.hash('link-mariana-0123456789')) = 1,
  'the passenger sends a document of their own on the link, never one of somebody else'
);
select ok(
  pg_temp.got('finish_right', 'count') = '1' and pg_temp.got('finish_wrong', 'count') = '0',
  'the backend finishes an upload only for the link that reserved it'
);

-- ---------- What the agency's screens read, and the firm's counts ----------

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('page', public.pax_travelers_page('d7400000-0000-4000-8000-00000000000a'));
insert into res values ('page_search', public.pax_travelers_page('d7400000-0000-4000-8000-00000000000a', 'mariana oliveira'));
insert into res values ('overview', public.pax_overview('d7400000-0000-4000-8000-00000000000a'));
insert into res values ('detail', public.pax_traveler_detail(pg_temp.got('mariana', 'traveler_id')::uuid));
reset role;

select ok(
  (pg_temp.got('page', 'total'))::integer = 3 and (pg_temp.got('page_search', 'total'))::integer = 1
  and pg_temp.got('overview', 'watched') = '1' and pg_temp.got('overview', 'consent_term') = '1',
  'the agency reads its passengers a page at a time, by name, and what its home counts'
);
select ok(
  pg_temp.got('detail', 'consent') = 'agreed'
  and jsonb_array_length(pg_temp.got('detail', 'documents')::jsonb) = 1
  and jsonb_array_length(pg_temp.got('detail', 'children')::jsonb) = 1
  and (pg_temp.got('detail', 'confirm_link')::jsonb ->> 'open')::boolean,
  'one passenger is read whole: documents, children, trips, the answer and the link'
);

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('counts', (select to_jsonb(c) from public.firm_partner_counts('b7400000-0000-4000-8000-00000000000a') c));
reset role;
select ok(
  pg_temp.got('counts', 'travelers') = '3' and pg_temp.got('counts', 'watched') = '1',
  'the firm reads how many passengers and trips its partner has, and nothing else'
);

-- ---------- A spreadsheet ----------

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('imported', public.pax_import_rows('d7400000-0000-4000-8000-00000000000a', '[
  {"line": 2, "nome": "João Planilha", "cpf": "", "nascimento": "1990-01-15", "whatsapp": "62999990003",
   "localizador": "ABC123", "voo": "G3 1234", "origem": "BSB", "destino": "SSA",
   "partida": "2099-12-01T10:00", "chegada": "2099-12-01T12:00"},
  {"line": 3, "nome": "Pedro Teste", "cpf": "52998224725", "nascimento": "", "email": "pedro@teste.invalid",
   "localizador": "ABC123", "voo": "G3 1234", "origem": "BSB", "destino": "SSA",
   "partida": "2099-12-01T10:00", "chegada": "2099-12-01T12:00"},
  {"line": 4, "nome": "Voo Errado", "nascimento": "1985-02-02", "localizador": "XYZ789", "voo": "voo",
   "origem": "BSB", "destino": "SSA", "partida": "2099-12-01T10:00", "chegada": "2099-12-01T12:00"},
  {"line": 5, "nome": "X"}
]'));
reset role;

select ok(
  pg_temp.got('imported', 'added') = '2' and pg_temp.got('imported', 'matched') = '1'
  and pg_temp.got('imported', 'trips_added') = '2' and pg_temp.got('imported', 'legs_added') = '1'
  and jsonb_array_length(pg_temp.got('imported', 'problems')::jsonb) = 2
  and exists (select 1 from public.pax_travelers t where t.cpf = '52998224725' and t.email = 'pedro@teste.invalid')
  and (select count(*) from public.pax_trip_travelers tt join public.pax_trips t on t.id = tt.trip_id
       where t.locator = 'ABC123') = 2,
  'a spreadsheet adds who is new, fills what the record lacks, groups the legs by locator and refuses a bad line alone'
);

-- ---------- What stays put ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('discard', public.discard_file(pg_temp.got('identity', 'file_id')::uuid));
reset role;
select ok(pg_temp.got('discard', 'code') = 'in_use', 'a file a document of the agency names is never forgotten under it');

update public.tracked_trips set status = 'case_opened' where pax_trip_id = pg_temp.got('trip', 'trip_id')::uuid;
select pg_temp.sign_in('a7400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_trips_opened', jsonb_build_object('count', (select count(*) from public.tracked_trips
  where consent_channel = 'agency'), 'legs', (select count(*) from public.tracked_legs l join public.tracked_trips t on t.id = l.trip_id
  where t.consent_channel = 'agency')));
reset role;
select ok(
  pg_temp.got('ana_trips_opened', 'count') = '1' and pg_temp.got('ana_trips_opened', 'legs') = '1',
  'once the case opened, the firm reads the trip'
);

select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('locked', public.pax_save_trip('d7400000-0000-4000-8000-00000000000a',
  pg_temp.got('trip', 'trip_id')::uuid, pg_temp.got('mariana', 'traveler_id')::uuid, null, 'TSTM4R',
  '[{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC",
     "departure": "2099-11-22T08:10", "arrival": "2099-11-22T11:25"}]'));
reset role;
select ok(pg_temp.got('locked', 'code') = 'trip_locked', 'a trip whose passenger is with the firm changes no more');

update public.partner_links set status = 'ended', ended_at = now() where id = 'd7400000-0000-4000-8000-00000000000a';
select pg_temp.sign_in('a7400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.pax_save_traveler('d7400000-0000-4000-8000-00000000000a', null, '{"full_name": "Depois do Fim"}') $$,
  'P0001', 'partnership_ended',
  'an agency adds nothing to a partnership that ended'
);
reset role;
select pg_temp.anonymous();
set local role anon;
insert into res values ('opened_after_end', public.pax_link_open('link-mariana-0123456789'));
reset role;
select ok(pg_temp.got('opened_after_end', 'state') = 'partnership_ended', 'the link of a partnership that ended says so');

select * from finish();
rollback;
