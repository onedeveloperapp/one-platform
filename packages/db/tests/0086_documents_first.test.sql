begin;
create extension if not exists pgtap;
select plan(25);

-- ============================================================
-- Registration from documents (0083): an agency starts a passenger as a
-- draft, ONE reads the identity into it (the name whole, the CPF, and whose
-- the CPF already is, the draft's CPF kept apart from the partnership's
-- until it is confirmed), the agency confirms it; drafts stay out of the lists,
-- the counts and the links, and go after the setting's hours; a trip's
-- document waits for its trip with the legs read on it, then joins it; the
-- reading's instructions take a screenshot or a photo of a print as a
-- ticket. Two firms and two agencies.
--
-- Every person, firm, agency, name and fact here is invented; the CPFs are
-- the ones every manual uses as an example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-docs.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-docs.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8600000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-sol-docs.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a8600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@viagens-sol-docs.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now()),
  ('a8600000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabi@turismo-mar-docs.invalid', '', now(), '{}', '{"display_name":"Fabi Costa"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-docs', 'a8600000-0000-4000-8000-000000000001'),
  ('b8600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-docs', 'a8600000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8600000-0000-4000-8000-00000000000a', 'a8600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8600000-0000-4000-8000-00000000000b', 'a8600000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.partners (id, name) values
  ('c8600000-0000-4000-8000-00000000000a', 'Viagens Sol'),
  ('c8600000-0000-4000-8000-00000000000b', 'Turismo Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c8600000-0000-4000-8000-00000000000a', 'a8600000-0000-4000-8000-000000000003', 'owner'),
  ('c8600000-0000-4000-8000-00000000000a', 'a8600000-0000-4000-8000-000000000004', 'member'),
  ('c8600000-0000-4000-8000-00000000000b', 'a8600000-0000-4000-8000-000000000005', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d8600000-0000-4000-8000-00000000000a', 'c8600000-0000-4000-8000-00000000000a', 'b8600000-0000-4000-8000-00000000000a', 'direito-do-passageiro'),
  ('d8600000-0000-4000-8000-00000000000b', 'c8600000-0000-4000-8000-00000000000b', 'b8600000-0000-4000-8000-00000000000b', 'direito-do-passageiro');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c8600000-0000-4000-8000-00000000000a', 1, 'O cliente autoriza que a agência compartilhe com o escritório os seus dados desta viagem.');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A confirmed passenger of the agency, whose CPF a later identity carries.
select pg_temp.sign_in('a8600000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('known', public.pax_save_traveler('d8600000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Paulo Teste", "cpf": "11144477735"}'::jsonb));
reset role;

-- ---------- The draft ----------

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('first', public.pax_start_traveler('d8600000-0000-4000-8000-00000000000a'));
insert into res values ('draft', public.pax_start_traveler('d8600000-0000-4000-8000-00000000000a'));
insert into res values ('page', public.pax_travelers_page('d8600000-0000-4000-8000-00000000000a'));
insert into res values ('overview', public.pax_overview('d8600000-0000-4000-8000-00000000000a'));
insert into res values ('draft_link', public.pax_issue_confirm_link(pg_temp.got('draft', 'traveler_id')::uuid,
  encode(sha256('link-do-rascunho'::bytea), 'hex')));
-- An identity and a ticket of the draft, the ticket with no trip yet.
insert into res values ('identity', public.pax_reserve_document(pg_temp.got('draft', 'traveler_id')::uuid, 'identity', null,
  'rg.jpg', 'image/jpeg', 120000));
insert into res values ('ticket', public.pax_reserve_document(pg_temp.got('draft', 'traveler_id')::uuid, 'ticket', null,
  'print-da-reserva.png', 'image/png', 90000));
insert into res values ('address_with_trip', public.pax_reserve_document(pg_temp.got('draft', 'traveler_id')::uuid,
  'address_proof', 'd8600000-0000-4000-8000-00000000000a', 'conta.pdf', 'application/pdf', 50000));
reset role;

select ok(
  (select draft and full_name = 'Passageiro em cadastro' from public.pax_travelers
   where id = pg_temp.got('draft', 'traveler_id')::uuid),
  'somebody of the agency starts a passenger as a draft, under a name of no person'
);
select ok(
  not exists (select 1 from public.pax_travelers where id = pg_temp.got('first', 'traveler_id')::uuid),
  'starting another draft lets the writer''s earlier one go'
);
select ok(
  (select payload -> 'total' from res where name = 'page') = '1'::jsonb
  and (select payload ->> 'travelers' from res where name = 'overview') = '1',
  'a draft is in no list and no count of the agency'
);
select ok(
  pg_temp.got('draft_link', 'code') = 'draft',
  'a draft has no link for the passenger to agree on'
);
select ok(
  pg_temp.got('ticket', 'code') = 'reserved' and pg_temp.got('address_with_trip', 'code') = 'invalid_trip',
  'a ticket may wait for its trip; a person''s document never goes to a trip'
);

-- ---------- The reading ----------

update public.pax_documents set reading = 'working', reading_claims = 1
where id = pg_temp.got('identity', 'document_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
select is(
  (select traveler_name from public.pax_document_to_read(pg_temp.got('identity', 'document_id')::uuid, 1)),
  null,
  'a draft''s document is read with no name of a person beside it'
);
reset role;

update public.pax_documents set reading = 'done', read_output = '{"confere_tipo": "sim", "legivel": true,
  "dados_lidos": {"nome_completo": "Mariana Teste de Oliveira", "cpf": "52998224725", "data_nascimento": "1988-03-02",
                  "nacionalidade": "brasileira"}, "trechos": []}'::jsonb
where id = pg_temp.got('identity', 'document_id')::uuid;
select public.pax_apply_reading(pg_temp.got('identity', 'document_id')::uuid,
  (select read_output from public.pax_documents where id = pg_temp.got('identity', 'document_id')::uuid));

select ok(
  (select full_name = 'Mariana Teste de Oliveira' and cpf is null and draft_cpf = '52998224725'
          and birth_date = date '1988-03-02' and read_fields ? 'full_name' and read_fields ? 'cpf'
   from public.pax_travelers where id = pg_temp.got('draft', 'traveler_id')::uuid),
  'the identity names the draft whole, with its CPF (kept apart until confirmed) and birth date, each marked as read'
);

-- A second draft whose identity carries the confirmed passenger's CPF.
select pg_temp.sign_in('a8600000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('twin', public.pax_start_traveler('d8600000-0000-4000-8000-00000000000a'));
insert into res values ('twin_identity', public.pax_reserve_document(pg_temp.got('twin', 'traveler_id')::uuid, 'identity',
  null, 'rg-paulo.jpg', 'image/jpeg', 120000));
reset role;
update public.pax_documents set reading = 'done', read_output = '{"confere_tipo": "sim", "legivel": true,
  "dados_lidos": {"nome_completo": "Paulo Teste", "cpf": "111.444.777-35"}, "trechos": []}'::jsonb
where id = pg_temp.got('twin_identity', 'document_id')::uuid;
select public.pax_apply_reading(pg_temp.got('twin_identity', 'document_id')::uuid,
  (select read_output from public.pax_documents where id = pg_temp.got('twin_identity', 'document_id')::uuid));

select ok(
  (select cpf is null and duplicate_of = pg_temp.got('known', 'traveler_id')::uuid
   from public.pax_travelers where id = pg_temp.got('twin', 'traveler_id')::uuid),
  'a draft whose identity carries a registered passenger''s CPF learns whose it is, and takes no CPF'
);

-- ---------- The confirmation ----------

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('no_name', public.pax_confirm_traveler(pg_temp.got('draft', 'traveler_id')::uuid,
  '{"full_name": "Passageiro em cadastro"}'::jsonb));
insert into res values ('taken', public.pax_confirm_traveler(pg_temp.got('twin', 'traveler_id')::uuid,
  '{"full_name": "Paulo Teste", "cpf": "11144477735"}'::jsonb));
insert into res values ('confirmed', public.pax_confirm_traveler(pg_temp.got('draft', 'traveler_id')::uuid,
  '{"full_name": "Mariana Teste de Oliveira", "cpf": "52998224725", "birth_date": "1988-03-02", "phone": "5500988880006"}'::jsonb));
insert into res values ('again', public.pax_confirm_traveler(pg_temp.got('draft', 'traveler_id')::uuid,
  '{"full_name": "Mariana Teste de Oliveira"}'::jsonb));
insert into res values ('page_after', public.pax_travelers_page('d8600000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('no_name', 'code') = 'invalid_name',
  'a draft is never confirmed under the name of no person'
);
select ok(
  pg_temp.got('taken', 'code') = 'cpf_in_use' and pg_temp.got('taken', 'traveler_id') = pg_temp.got('known', 'traveler_id'),
  'a CPF a registered passenger has is refused, naming them'
);
select ok(
  pg_temp.got('confirmed', 'code') = 'confirmed'
  and (select not draft and cpf = '52998224725' and draft_cpf is null and phone = '5500988880006'
              and read_fields ? 'full_name' and read_fields ? 'cpf'
       from public.pax_travelers where id = pg_temp.got('draft', 'traveler_id')::uuid)
  and (select payload -> 'total' from res where name = 'page_after') = '2'::jsonb,
  'the agency confirms the draft: in the list, the WhatsApp it added, the read marks of what it kept as read'
);
select ok(
  pg_temp.got('again', 'code') = 'not_draft',
  'a passenger confirmed is changed as any other, never confirmed again'
);
select ok(
  exists (select 1 from public.audit_events where action = 'pax.traveler.added' and org_id is null
          and entity_id = pg_temp.got('draft', 'traveler_id') and metadata ->> 'from_documents' = 'true'),
  'the passenger added from documents is on the platform''s record'
);

-- ---------- A draft never holds a CPF against the others ----------

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('held', public.pax_start_traveler('d8600000-0000-4000-8000-00000000000a'));
insert into res values ('held_identity', public.pax_reserve_document(pg_temp.got('held', 'traveler_id')::uuid, 'identity',
  null, 'rg-joao.jpg', 'image/jpeg', 120000));
reset role;
update public.pax_documents set reading = 'done', read_output = '{"confere_tipo": "sim", "legivel": true,
  "dados_lidos": {"nome_completo": "Joao Teste", "cpf": "123.456.789-09"}, "trechos": []}'::jsonb
where id = pg_temp.got('held_identity', 'document_id')::uuid;
select public.pax_apply_reading(pg_temp.got('held_identity', 'document_id')::uuid,
  (select read_output from public.pax_documents where id = pg_temp.got('held_identity', 'document_id')::uuid));
select pg_temp.sign_in('a8600000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('typed', public.pax_save_traveler('d8600000-0000-4000-8000-00000000000a', null,
  '{"full_name": "Joao Teste", "cpf": "12345678909"}'::jsonb));
insert into res values ('held_confirm', public.pax_confirm_traveler(pg_temp.got('held', 'traveler_id')::uuid,
  '{"full_name": "Joao Teste"}'::jsonb));
reset role;

select ok(
  pg_temp.got('typed', 'code') = 'added',
  'a CPF a draft was given never keeps a passenger from being registered with it'
);
select ok(
  pg_temp.got('held_confirm', 'code') = 'cpf_in_use'
  and pg_temp.got('held_confirm', 'traveler_id') = pg_temp.got('typed', 'traveler_id')
  and (select draft from public.pax_travelers where id = pg_temp.got('held', 'traveler_id')::uuid),
  'the CPF the identity gave a draft is checked when it is confirmed, naming who has it'
);

-- ---------- A trip's document that waited for its trip ----------

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('legs_reading', public.pax_document_legs(pg_temp.got('ticket', 'document_id')::uuid));
reset role;

update public.pax_documents set reading = 'done', read_output = '{"confere_tipo": "sim", "legivel": true,
  "dados_lidos": {}, "trechos": [{"voo": "LA 3456", "origem": "gru", "destino": "REC",
  "saida_prevista": "2099-05-10T08:10", "chegada_prevista": "2099-05-10T11:25", "reserva": "tstm4r"}]}'::jsonb
where id = pg_temp.got('ticket', 'document_id')::uuid;
select public.pax_apply_reading(pg_temp.got('ticket', 'document_id')::uuid,
  (select read_output from public.pax_documents where id = pg_temp.got('ticket', 'document_id')::uuid));

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('legs', public.pax_document_legs(pg_temp.got('ticket', 'document_id')::uuid));
reset role;

select ok(
  pg_temp.got('legs_reading', 'code') = 'reading',
  'while ONE reads the ticket, its legs are said to be on their way'
);
select ok(
  pg_temp.got('legs', 'ok') = 'true' and pg_temp.got('legs', 'locator') = 'TSTM4R'
  and (select payload -> 'legs' -> 0 ->> 'flight_number' = 'LA3456' and payload -> 'legs' -> 0 ->> 'origin_iata' = 'GRU'
       from res where name = 'legs')
  and not exists (select 1 from public.pax_trip_legs l join public.pax_trips t on t.id = l.trip_id
                  where t.partner_id = 'c8600000-0000-4000-8000-00000000000a'),
  'the ticket''s legs and locator are read for the trip''s form, and no trip is written by the reading'
);

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  format('select public.pax_document_legs(%L)', pg_temp.got('ticket', 'document_id')),
  '42501', 'not_authorized',
  'nobody of another agency reads them'
);
select throws_ok(
  $$ select public.pax_start_traveler('d8600000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of another agency starts a passenger in this partnership'
);
reset role;

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('trip', public.pax_save_trip('d8600000-0000-4000-8000-00000000000a', null,
  pg_temp.got('draft', 'traveler_id')::uuid, array[pg_temp.got('draft', 'traveler_id')::uuid], pg_temp.got('legs', 'locator'),
  (select payload -> 'legs' from res where name = 'legs')));
insert into res values ('other_trip', public.pax_save_trip('d8600000-0000-4000-8000-00000000000a', null,
  pg_temp.got('known', 'traveler_id')::uuid, array[pg_temp.got('known', 'traveler_id')::uuid], 'OUTRA1',
  (select payload -> 'legs' from res where name = 'legs')));
insert into res values ('misplaced', public.pax_attach_trip_documents(pg_temp.got('other_trip', 'trip_id')::uuid,
  array[pg_temp.got('ticket', 'document_id')::uuid]));
insert into res values ('attached', public.pax_attach_trip_documents(pg_temp.got('trip', 'trip_id')::uuid,
  array[pg_temp.got('ticket', 'document_id')::uuid]));
reset role;

select ok(
  pg_temp.got('misplaced', 'attached') = '0',
  'a document joins only a trip of its own passenger'
);
select ok(
  pg_temp.got('attached', 'attached') = '1'
  and (select trip_id = pg_temp.got('trip', 'trip_id')::uuid from public.pax_documents
       where id = pg_temp.got('ticket', 'document_id')::uuid)
  and (select locator = 'TSTM4R' from public.pax_trips where id = pg_temp.got('trip', 'trip_id')::uuid),
  'the trip confirmed from its ticket keeps the locator read, and the ticket joins it'
);

-- ---------- Drafts nobody confirmed ----------

select pg_temp.sign_in('a8600000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('fresh', public.pax_start_traveler('d8600000-0000-4000-8000-00000000000b'));
select throws_ok(
  $$ select public.pax_forget_drafts() $$,
  '42501', null,
  'only the backend sweeps the drafts'
);
reset role;
update public.pax_travelers set created_at = now() - interval '2 days'
where id = pg_temp.got('twin', 'traveler_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('swept', jsonb_build_object('n', public.pax_forget_drafts()));
reset role;

select ok(
  pg_temp.got('swept', 'n') = '1'
  and not exists (select 1 from public.pax_travelers where id = pg_temp.got('twin', 'traveler_id')::uuid)
  and not exists (select 1 from public.pax_documents where id = pg_temp.got('twin_identity', 'document_id')::uuid),
  'a draft nobody confirmed within the setting''s hours goes, with its documents'
);
select ok(
  exists (select 1 from public.pax_travelers where id = pg_temp.got('fresh', 'traveler_id')::uuid and draft),
  'a draft of today stays, whatever agency it is'
);

-- ---------- The reading's instructions ----------

select ok(
  (select version = 2 and system_prompt like '%print de tela da reserva%' and system_prompt like '%itinerário impresso%'
   from public.prompt_versions where task = 'parceiro.documento.leitura' and is_active)
  and (select not is_active from public.prompt_versions where task = 'parceiro.documento.leitura' and version = 1),
  'the reading in force takes a screenshot of the booking or a photo of a print as a ticket'
);

select * from finish();
rollback;
