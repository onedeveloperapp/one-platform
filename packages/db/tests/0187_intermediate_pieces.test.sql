begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The intermediate pieces (0189): a lawsuit the court has has pieces of
-- its own kind, never its petition; a réplica waits for the airline's
-- defence; ONE's recommendation comes from what asked for it; a lawyer
-- decides with the second factor; ONE files what was decided through the
-- test court for a test case, and a real lawsuit with no channel is the
-- lawyer's to file. Two firms: nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1870000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-pecas.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1870000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-pecas.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1870000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-pecas', 'a1870000-0000-4000-8000-000000000001'),
  ('b1870000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-pecas', 'a1870000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1870000-0000-4000-8000-00000000000a', 'a1870000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1870000-0000-4000-8000-00000000000b', 'a1870000-0000-4000-8000-000000000002', 'owner', 'socio');
-- A real case and a test case of firm A, each with a lawsuit the court has.
insert into public.cases (id, org_id, seq, module, incident, status, is_test) values
  ('c1870000-0000-4000-8000-000000000001', 'b1870000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', false),
  ('c1870000-0000-4000-8000-000000000002', 'b1870000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed', true);
insert into public.proceedings (id, org_id, case_id, kind, court, system, status, cnj, filed_at) values
  ('f1870000-0000-4000-8000-000000000001', 'b1870000-0000-4000-8000-00000000000a', 'c1870000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'projudi', 'filed', '10003012720998090100', '2026-09-01'),
  ('f1870000-0000-4000-8000-000000000002', 'b1870000-0000-4000-8000-00000000000a', 'c1870000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'projudi', 'filed', '10003021220998090100', '2026-09-01');
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, head, case_id, proceeding_id, category, triaged_at)
values ('a9870000-0000-4000-8000-000000000001', 'b1870000-0000-4000-8000-00000000000a', 'hash-pecas-0001', 'TJGO',
        '10003012720998090100', current_date, 'Intimação', 'Intime-se a parte autora para apresentar réplica à contestação.',
        'Intime-se a parte autora', 'c1870000-0000-4000-8000-000000000001', 'f1870000-0000-4000-8000-000000000001',
        'prazo', now());
update public.publication_actions set status = 'done', action = 'replica', reason = 'A companhia contestou e a autora deve replicar.',
  firm_summary = 'Prazo para réplica.', done_at = now()
where publication_id = 'a9870000-0000-4000-8000-000000000001';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;

-- Ana asks for the réplica the publication asks; and for a manifestation of the test case.
select pg_temp.sign_in('a1870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('replica', public.request_intermediate_piece('f1870000-0000-4000-8000-000000000001', 'replica',
  'a9870000-0000-4000-8000-000000000001', 'publication:a9870000-0000-4000-8000-000000000001'));
insert into res values ('again', public.request_intermediate_piece('f1870000-0000-4000-8000-000000000001', 'replica',
  'a9870000-0000-4000-8000-000000000001', 'publication:a9870000-0000-4000-8000-000000000001'));
insert into res values ('test_piece', public.request_intermediate_piece('f1870000-0000-4000-8000-000000000002', 'manifestacao', null, null));
reset role;

select ok(
  pg_temp.got('replica', 'code') = 'requested' and pg_temp.got('replica', 'waits_for') = 'defense'
  and pg_temp.got('again', 'code') = 'already'
  and (select status = 'generating' and work is null and piece_kind = 'replica' and recommendation = 'file'
              and recommendation_reason = 'A companhia contestou e a autora deve replicar.' and template_id is null
       from public.case_drafts where id = pg_temp.got('replica', 'draft_id')::uuid),
  'a réplica asked from its publication waits for the defence, recommended to file by what the publication asks, once'
);

-- The firm sends the defence: the réplica is owed its text.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('upload', public.reserve_file('b1870000-0000-4000-8000-00000000000a', 'upload', 'contestacao.pdf', 'application/pdf', 40000));
select public.confirm_file(pg_temp.got('upload', 'file_id')::uuid, repeat('c', 64), 40000, 'application/pdf', 4);
reset role;
select pg_temp.sign_in('a1870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('defense', public.attach_case_defense('c1870000-0000-4000-8000-000000000001', pg_temp.got('upload', 'file_id')::uuid));
reset role;

select ok(
  pg_temp.got('defense', 'code') = 'attached'
  and (select waits_for is null and work = 'generate' from public.case_drafts where id = pg_temp.got('replica', 'draft_id')::uuid),
  'the defence the firm sends lets the réplica be written'
);

-- The test case's manifestation, approved, is kept as a document of its own kind, never the petition.
update public.case_drafts set status = 'approved', work = 'issue', version = 1, approved_version = 1,
  approved_body = 'Texto aprovado da manifestação de teste.', approved_at = now(),
  approved_by = 'a1870000-0000-4000-8000-000000000001', work_claimed_at = now(), work_claims = 1
where id = pg_temp.got('test_piece', 'draft_id')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('pdf', public.reserve_file('b1870000-0000-4000-8000-00000000000a', 'petition', 'Manifestação.pdf', 'application/pdf', 30000));
insert into res values ('issued', public.record_piece_issued(pg_temp.got('test_piece', 'draft_id')::uuid, 1,
  jsonb_build_object('file_id', pg_temp.got('pdf', 'file_id'), 'sha256', repeat('d', 64), 'bytes', 30000, 'pages', 1)));
reset role;

select ok(
  pg_temp.got('issued', 'code') = 'issued'
  and (select kind = 'intermediate_petition' and status = 'accepted' from public.case_documents
       where id = pg_temp.got('issued', 'document_id')::uuid)
  and not exists (select 1 from public.case_documents where case_id = 'c1870000-0000-4000-8000-000000000002' and kind = 'petition'),
  'an intermediate piece approved is a document of its own kind, never the case''s petition'
);

-- Ana decides to file it: with the second factor only.
select pg_temp.sign_in('a1870000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
insert into res values ('decide_aal1', public.decide_intermediate_piece(pg_temp.got('test_piece', 'draft_id')::uuid, 'file', null));
select pg_temp.sign_in('a1870000-0000-4000-8000-000000000001');
insert into res values ('decide', public.decide_intermediate_piece(pg_temp.got('test_piece', 'draft_id')::uuid, 'file', null));
insert into res values ('filings', public.case_piece_filings('c1870000-0000-4000-8000-000000000002'));
reset role;

select ok(
  pg_temp.got('decide_aal1', 'code') = 'second_factor' and pg_temp.got('decide', 'code') = 'decided'
  and (select filing_status = 'owed' and decision = 'file' from public.case_drafts where id = pg_temp.got('test_piece', 'draft_id')::uuid)
  and (select payload -> pg_temp.got('test_piece', 'draft_id') = 'null'::jsonb from res where name = 'filings'),
  'a lawyer decides with the second factor, and nothing keeps ONE from filing a test case''s piece'
);

-- ONE files it in the test court.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('claimed', (select jsonb_build_object('draft', c.draft_id, 'claim', c.claim) from public.claim_piece_filings(5) c));
insert into res values ('to_send', public.piece_filing_to_send(pg_temp.got('test_piece', 'draft_id')::uuid, pg_temp.got('claimed', 'claim')::integer));
insert into res values ('filed', public.record_piece_filing(pg_temp.got('test_piece', 'draft_id')::uuid,
  pg_temp.got('claimed', 'claim')::integer, 'filed', 'TESTE-P-1', 'Juntada.', null));
reset role;

select ok(
  pg_temp.got('to_send', 'cnj') = '10003021220998090100' and pg_temp.got('to_send', 'test') = 'true'
  and pg_temp.got('to_send', 'type_code') = '57' and pg_temp.got('to_send', 'storage_path') is not null
  and pg_temp.got('filed', 'code') = 'filed'
  and (select filed_how = 'one' and filed_protocol = 'TESTE-P-1' from public.case_drafts
       where id = pg_temp.got('test_piece', 'draft_id')::uuid)
  and exists (select 1 from public.case_events e where e.kind = 'piece_filed' and e.actor_type = 'system'),
  'ONE files a test case''s piece in the test court with the lawsuit''s number, and keeps the protocol'
);

-- A real lawsuit with no channel is the lawyer's to file, and says so.
update public.case_drafts set status = 'issued', version = 1, approved_version = 1, approved_body = 'Texto da réplica.',
  approved_at = now(), work = null, work_claimed_at = null, decision = 'file', decided_at = now(),
  decided_by = 'a1870000-0000-4000-8000-000000000001', filing_status = 'owed'
where id = pg_temp.got('replica', 'draft_id')::uuid;
select ok(
  (select public.piece_filing_blocker(pg_temp.got('replica', 'draft_id')::uuid)) = 'not_issued',
  'a piece with no document is filed by nobody'
);
select pg_temp.sign_in('a1870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lawyer_filed', public.record_piece_filed(pg_temp.got('replica', 'draft_id')::uuid, 'PROJ-123',
  (now() at time zone 'America/Sao_Paulo')::date));
reset role;

select ok(
  pg_temp.got('lawyer_filed', 'code') = 'filed'
  and (select filed_how = 'lawyer' and filing_status = 'filed' from public.case_drafts where id = pg_temp.got('replica', 'draft_id')::uuid),
  'a lawyer says they filed a piece in the court''s system'
);

select pg_temp.sign_in('a1870000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (select count(*) from public.case_drafts where piece_kind <> 'inicial') = 0
  and (public.case_piece_filings('c1870000-0000-4000-8000-000000000002')) = '{}'::jsonb
  and (select count(*) from public.piece_kinds) = 9,
  'another firm reads nothing of the pieces, and every firm reads the kinds'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.record_piece_issued(uuid, integer, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_piece_filings(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_piece_filing(uuid, integer, text, text, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.request_intermediate_piece_by_one(uuid, text, uuid, text)', 'EXECUTE'),
  'only the backend writes a piece''s document and its filing'
);

select * from finish();
rollback;
