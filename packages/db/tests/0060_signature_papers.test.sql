begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- The papers ONE sends a client to sign once they finished on their link
-- (0054): a model says what it writes (a piece, a power of attorney or a
-- contract); the platform proposes a power of attorney and never a contract;
-- ONE issues each paper the firm has a model for, with the person's facts
-- written in, and sends it by the firm's ZapSign or by gov.br on the link;
-- never twice; a signed paper is its signer's document; and a power of
-- attorney sent and not signed keeps the lawsuit from being filed. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a6000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a6000000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b6000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-papeis', 'a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-papeis', 'a6000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6000000-0000-4000-8000-00000000000b', 'a6000000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a6000000-0000-4000-8000-000000000001', 'GO', '60001', 'principal'),
  ('a6000000-0000-4000-8000-000000000004', 'GO', '60004', 'principal');
insert into public.firm_signers (org_id, user_id, added_by) values
  ('b6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-00000000000b', 'a6000000-0000-4000-8000-000000000004', 'a6000000-0000-4000-8000-000000000004');
-- Firm B signs by its own ZapSign account.
insert into public.connections (org_id, provider, label, status, connected_at, metadata)
values ('b6000000-0000-4000-8000-00000000000b', 'zapsign', 'ZapSign', 'connected', now(), '{}'::jsonb);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- A cancellation of an adult of Goiânia with every fact a paper writes, a leg of the trip and a link.
create function pg_temp.full_case(org uuid, name text, cpf text, token text, profession text default 'Professora')
returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'cancellation', 'LA', date '2026-10-24', jsonb_build_object(
    'full_name', name, 'cpf', cpf, 'birth_date', '1990-05-02', 'nationality', 'brasileira',
    'marital_status', 'solteiro', 'profession', profession, 'street', 'Rua das Flores', 'address_number', '10',
    'district', 'Centro', 'city', 'Goiânia', 'uf', 'GO', 'postal_code', '74000000'));
begin
  perform public.save_flight_segment((made ->> 'case_id')::uuid, null,
    '{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC", "affected": true}'::jsonb);
  perform public.create_client_link((made ->> 'case_id')::uuid, (made ->> 'person_id')::uuid, pg_temp.hash(token));
  return made;
end;
$$;
create function pg_temp.claim(target uuid) returns jsonb language sql as $$
  select coalesce((public.claim_case_advances(1, target) -> 'claimed') -> 0, '{}'::jsonb);
$$;
-- A PDF the backend rendered and put in storage, reserved under the purpose of papers.
create function pg_temp.paper_file(org uuid) returns jsonb language sql as $$
  select public.reserve_file(org, 'paper', 'procuracao.pdf', 'application/pdf', 4000);
$$;

-- ---------- What a model writes ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('poa_model', public.save_draft_template('b6000000-0000-4000-8000-00000000000a', null,
  '{"name": "Procuração do escritório", "document_kind": "procuracao", "proceeding_kind": "juizado", "is_default": true, "body": "PROCURAÇÃO. [[OUTORGANTE]] nomeia [[OUTORGADOS]], do escritório [[ESCRITORIO]], para propor ação contra [[RE]] em razão de [[OBJETO]]. [[LOCAL_DATA]]. [[NOME]]"}'::jsonb));
insert into res values ('contract_model', public.save_draft_template('b6000000-0000-4000-8000-00000000000a', null,
  '{"name": "Contrato do escritório", "document_kind": "contrato", "body": "CONTRATO. [[CONTRATANTE]] contrata [[ESCRITORIO]] para a ação contra [[RE]]. [[LOCAL_DATA]]. [[NOME]]"}'::jsonb));
insert into res values ('odd_model', public.save_draft_template('b6000000-0000-4000-8000-00000000000a', null,
  '{"name": "Outra coisa", "document_kind": "recibo", "body": "Um texto qualquer com mais de vinte letras."}'::jsonb));
insert into res values ('case_1', pg_temp.full_case('b6000000-0000-4000-8000-00000000000a', 'Mariana Teste',
  '12345678909', 'token-de-papeis-mariana-1234567890'));
insert into res values ('case_2', pg_temp.full_case('b6000000-0000-4000-8000-00000000000a', 'Rafael Teste',
  '52998224725', 'token-de-papeis-rafael-12345678901', ''));
reset role;
select pg_temp.sign_in('a6000000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('platform_contract', public.admin_save_platform_template(null,
  '{"name": "Contrato da plataforma", "document_kind": "contrato", "body": "CONTRATO com honorários de trinta por cento."}'::jsonb));
reset role;
select pg_temp.sign_in('a6000000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', pg_temp.full_case('b6000000-0000-4000-8000-00000000000b', 'Pedro Teste',
  '11144477735', 'token-de-papeis-pedro-123456789012'));
reset role;

select ok(
  pg_temp.got('poa_model', 'code') = 'saved' and pg_temp.got('contract_model', 'code') = 'saved'
  and (select document_kind = 'procuracao' and proceeding_kind is null and is_default
       from public.draft_templates where id = pg_temp.got('poa_model', 'template_id')::uuid)
  and pg_temp.got('odd_model', 'field') = 'document_kind'
  and pg_temp.got('platform_contract', 'field') = 'document_kind'
  and not exists (select 1 from public.draft_templates where org_id is null and document_kind = 'contrato'),
  'a firm writes models of a power of attorney and of a contract, which name no kind of lawsuit; the platform never writes a contract'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('piece_for_a', jsonb_build_object('id', public.draft_template_for('b6000000-0000-4000-8000-00000000000a', 'juizado')));
insert into res values ('poa_for_a', jsonb_build_object('id', public.paper_template_for('b6000000-0000-4000-8000-00000000000a', 'procuracao')));
insert into res values ('poa_for_b', jsonb_build_object('id', public.paper_template_for('b6000000-0000-4000-8000-00000000000b', 'procuracao')));
insert into res values ('contract_for_b', jsonb_build_object('id', public.paper_template_for('b6000000-0000-4000-8000-00000000000b', 'contrato')));
reset role;

select ok(
  (select document_kind = 'piece' and org_id is null from public.draft_templates
   where id = pg_temp.got('piece_for_a', 'id')::uuid)
  and pg_temp.got('poa_for_a', 'id') = pg_temp.got('poa_model', 'template_id')
  and (select org_id is null and document_kind = 'procuracao' and provisional from public.draft_templates
       where id = pg_temp.got('poa_for_b', 'id')::uuid)
  and pg_temp.got('contract_for_b', 'id') is null,
  'a piece is never written from a paper; a firm''s own power of attorney is the one ONE writes from, else the platform''s; a contract only from the firm''s own'
);

select throws_ok(
  format($$insert into public.case_drafts (org_id, case_id, proceeding_id, template_id, template_name, template_body, status)
    select 'b6000000-0000-4000-8000-00000000000a', %L::uuid, null, %L::uuid, 'x', 'x', 'requested'$$,
    pg_temp.got('case_1', 'case_id'), pg_temp.got('poa_model', 'template_id')),
  '22023', 'not_a_piece_template',
  'nothing writes a piece from a model of a power of attorney'
);

-- ---------- Owed once the client finished ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('due_before', (select coalesce(jsonb_agg(d.kind), '[]') from public.case_papers_due(pg_temp.got('case_1', 'case_id')::uuid) d));
reset role;
update public.case_advances set after = now() + interval '6 hours', woken_at = null
where case_id = pg_temp.got('case_1', 'case_id')::uuid;
select pg_temp.as_client();
set local role anon;
insert into res values ('finished_1', public.client_link_finish('token-de-papeis-mariana-1234567890'));
insert into res values ('finished_2', public.client_link_finish('token-de-papeis-rafael-12345678901'));
insert into res values ('finished_b', public.client_link_finish('token-de-papeis-pedro-123456789012'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('due_after', (select coalesce(jsonb_agg(d.kind), '[]') from public.case_papers_due(pg_temp.got('case_1', 'case_id')::uuid) d));
reset role;

select ok(
  (select payload = '[]'::jsonb from res where name = 'due_before')
  and pg_temp.got('finished_1', 'code') = 'finished'
  and (select payload = '["procuracao", "contrato"]'::jsonb from res where name = 'due_after')
  and (select after is null and woken_at is not null from public.case_advances
       where case_id = pg_temp.got('case_1', 'case_id')::uuid),
  'once the client says they finished, the case owes them the power of attorney and then the contract, and is looked at again'
);

-- Firm B keeps the papers to a person: nothing is owed by ONE.
select pg_temp.sign_in('a6000000-0000-4000-8000-000000000004');
set local role authenticated;
select public.set_firm_autonomy('b6000000-0000-4000-8000-00000000000b', 'send_signature_papers', 'approval');
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('due_b_person', (select coalesce(jsonb_agg(d.kind), '[]') from public.case_papers_due(pg_temp.got('case_b', 'case_id')::uuid) d));
reset role;
select ok(
  (select payload = '[]'::jsonb from res where name = 'due_b_person'),
  'a firm that keeps the papers to a person is owed none by ONE'
);

-- ---------- What ONE issues ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_1', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('to_issue_1', public.advance_paper_to_issue(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer));
insert into res values ('claim_2', pg_temp.claim(pg_temp.got('case_2', 'case_id')::uuid));
insert into res values ('to_issue_2', public.advance_paper_to_issue(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('claim_2', 'claim')::integer));
reset role;

select ok(
  (pg_temp.got('claim_1', 'papers_due'))::boolean
  and pg_temp.got('to_issue_1', 'code') = 'due' and pg_temp.got('to_issue_1', 'kind') = 'procuracao'
  and pg_temp.got('to_issue_1', 'body') like 'PROCURAÇÃO. MARIANA TESTE, nacionalidade brasileira, pessoa solteira, profissão Professora, CPF nº 123.456.789-09, com endereço em Rua das Flores, nº 10, Centro, Goiânia/GO, CEP 74000-000 nomeia %'
  and pg_temp.got('to_issue_1', 'body') like '%Ana Souza, OAB/GO nº 60001, do escritório Souza Advogados%'
  and pg_temp.got('to_issue_1', 'body') like '%contra a companhia aérea LATAM em razão de o cancelamento do voo LA 3456 de GRU para REC, de 24/10/2026.%'
  and pg_temp.got('to_issue_1', 'body') like '%Goiânia, % de % de %. Mariana Teste',
  'the sweep takes a case owed a paper, and the paper says who grants it, to whom, against whom, why, where and when, as the case has it'
);

select ok(
  pg_temp.got('to_issue_2', 'code') = 'incomplete'
  and (select payload -> 'missing' ? 'profissão de Rafael Teste' from res where name = 'to_issue_2'),
  'a paper with a fact not on record is not issued, and says what is missing'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('file_1', pg_temp.paper_file('b6000000-0000-4000-8000-00000000000a'));
insert into res values ('wrong_file', public.advance_record_paper(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.got('case_1', 'person_id')::uuid, 'procuracao',
  pg_temp.got('poa_model', 'template_id')::uuid,
  jsonb_build_object('file_id', gen_random_uuid(), 'sha256', repeat('c', 64), 'bytes', 4000, 'pages', 1)));
insert into res values ('issued_1', public.advance_record_paper(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.got('case_1', 'person_id')::uuid, 'procuracao',
  pg_temp.got('poa_model', 'template_id')::uuid,
  jsonb_build_object('file_id', pg_temp.got('file_1', 'file_id'), 'sha256', repeat('c', 64), 'bytes', 4000, 'pages', 1)));
insert into res values ('again_1', public.advance_record_paper(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.got('case_1', 'person_id')::uuid, 'procuracao',
  pg_temp.got('poa_model', 'template_id')::uuid,
  jsonb_build_object('file_id', pg_temp.got('file_1', 'file_id'), 'sha256', repeat('c', 64), 'bytes', 4000, 'pages', 1)));
reset role;

select ok(
  pg_temp.got('wrong_file', 'code') = 'file_not_found'
  and pg_temp.got('issued_1', 'code') = 'issued' and pg_temp.got('issued_1', 'method') = 'govbr'
  and (select kind = 'power_of_attorney' and source = 'firm' and status = 'accepted' and party_id is null
       from public.case_documents where id = pg_temp.got('issued_1', 'document_id')::uuid)
  and (select status = 'pending' and method = 'govbr' and created_by is null
              and signers -> 0 ->> 'person_id' = pg_temp.got('case_1', 'person_id')
       from public.signature_envelopes where id = pg_temp.got('issued_1', 'envelope_id')::uuid)
  and (select status = 'stored' from public.files where id = pg_temp.got('file_1', 'file_id')::uuid),
  'ONE issues the paper as a document of the case nobody owns yet, and sends it to the client to sign by gov.br on their link'
);

select ok(
  pg_temp.got('again_1', 'code') = 'not_due'
  and (select count(*) = 1 from public.case_papers where case_id = pg_temp.got('case_1', 'case_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'paper_issued' and e.actor_type = 'system' and e.data ->> 'kind' = 'procuracao')
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'signature_requested' and e.actor_type = 'system'),
  'never twice, and the timeline says ONE issued it and sent it to be signed'
);

-- Firm B lets ONE send them again: by its ZapSign account, opened by the backend.
select pg_temp.sign_in('a6000000-0000-4000-8000-000000000004');
set local role authenticated;
select public.set_firm_autonomy('b6000000-0000-4000-8000-00000000000b', 'send_signature_papers', 'auto');
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_b', pg_temp.claim(pg_temp.got('case_b', 'case_id')::uuid));
insert into res values ('file_b', pg_temp.paper_file('b6000000-0000-4000-8000-00000000000b'));
insert into res values ('issued_b', public.advance_record_paper(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('claim_b', 'claim')::integer, pg_temp.got('case_b', 'person_id')::uuid, 'procuracao',
  pg_temp.got('poa_for_b', 'id')::uuid,
  jsonb_build_object('file_id', pg_temp.got('file_b', 'file_id'), 'sha256', repeat('d', 64), 'bytes', 4000, 'pages', 1)));
reset role;
select ok(
  pg_temp.got('issued_b', 'method') = 'zapsign'
  and (select status = 'reserved' and connection_id is not null from public.signature_envelopes
       where id = pg_temp.got('issued_b', 'envelope_id')::uuid),
  'a firm with its ZapSign account connected has the paper sent through it'
);

-- ---------- Not filed without it, and the signed one is the signer's ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lawsuit_1', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case_1', 'party_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('blocked', jsonb_build_object('code', public.filing_blocker(pg_temp.got('lawsuit_1', 'proceeding_id')::uuid)));
reset role;

select pg_temp.as_client();
set local role anon;
insert into res values ('signed_back', public.client_link_reserve_signed('token-de-papeis-mariana-1234567890',
  pg_temp.got('issued_1', 'envelope_id')::uuid, 'procuracao-assinada.pdf', 'application/pdf', 6000));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('signed_back', 'file_id')::uuid, repeat('e', 64), 6000, 'application/pdf', 1);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('signed_done', public.client_link_finish_upload('token-de-papeis-mariana-1234567890',
  pg_temp.got('signed_back', 'document_id')::uuid));
reset role;
select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('confirmed', public.confirm_signature(pg_temp.got('issued_1', 'envelope_id')::uuid,
  pg_temp.got('signed_back', 'document_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('unblocked', jsonb_build_object('code', public.filing_blocker(pg_temp.got('lawsuit_1', 'proceeding_id')::uuid)));
reset role;

select ok(
  pg_temp.got('blocked', 'code') = 'power_of_attorney_unsigned',
  'a lawsuit of who was sent a power of attorney is not filed while it is not signed'
);

select ok(
  pg_temp.got('confirmed', 'code') = 'signed'
  and (select status = 'accepted' and kind = 'power_of_attorney' and party_id = pg_temp.got('case_1', 'party_id')::uuid
       from public.case_documents where id = pg_temp.got('signed_back', 'document_id')::uuid)
  and pg_temp.got('unblocked', 'code') is null,
  'the signed power of attorney is the signer''s document of the case, and the lawsuit may be filed'
);

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 1 from public.case_papers)
  and (select bool_and(org_id = 'b6000000-0000-4000-8000-00000000000b') from public.case_papers)
  and not exists (select 1 from public.draft_templates where name = 'Procuração do escritório'),
  'a firm reads only its own papers and models'
);
reset role;

select * from finish();
rollback;
