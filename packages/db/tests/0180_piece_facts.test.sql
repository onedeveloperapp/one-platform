begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The client checks the facts of the initial (0182): a ready piece of a
-- case with somebody to ask owes a check; ONE writes the facts from the
-- piece with every identifier under a mark, put back by the database; the
-- client confirms or says what is wrong; a correction sends a piece no
-- lawyer approved back to the AI; ONE approves alone only what the client
-- confirmed; the filing waits for the confirmation; a lawyer goes on without
-- it saying why. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-fatos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-fatos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-fatos', 'a1800000-0000-4000-8000-000000000001'),
  ('b1800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-fatos', 'a1800000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1800000-0000-4000-8000-00000000000a', 'a1800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1800000-0000-4000-8000-00000000000b', 'a1800000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.people (id, org_id, full_name, birth_date) values
  ('d1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-00000000000a', 'Maria Teste', date '1990-04-02'),
  ('d1800000-0000-4000-8000-000000000002', 'b1800000-0000-4000-8000-00000000000a', 'Rui Teste', date '1985-01-15'),
  ('d1800000-0000-4000-8000-000000000003', 'b1800000-0000-4000-8000-00000000000b', 'Lia Teste', date '1980-06-20');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting'),
  ('c1800000-0000-4000-8000-000000000002', 'b1800000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'drafting'),
  ('c1800000-0000-4000-8000-000000000003', 'b1800000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'drafting');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001', 'claimant'),
  ('e1800000-0000-4000-8000-000000000002', 'b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000002', 'd1800000-0000-4000-8000-000000000002', 'claimant'),
  ('e1800000-0000-4000-8000-000000000003', 'b1800000-0000-4000-8000-00000000000b', 'c1800000-0000-4000-8000-000000000003', 'd1800000-0000-4000-8000-000000000003', 'claimant');
-- Firm B's case has no link: nobody to ask.
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000001', 'd1800000-0000-4000-8000-000000000001',
   encode(sha256(convert_to('token-dos-fatos', 'UTF8')), 'hex'), now() + interval '30 days'),
  ('b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000002', 'd1800000-0000-4000-8000-000000000002',
   encode(sha256(convert_to('token-dos-fatos-2', 'UTF8')), 'hex'), now() + interval '30 days');
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned'),
  ('f1800000-0000-4000-8000-000000000002', 'b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000002', 'juizado', 'TJGO', 'planned'),
  ('f1800000-0000-4000-8000-000000000003', 'b1800000-0000-4000-8000-00000000000b', 'c1800000-0000-4000-8000-000000000003', 'juizado', 'TJGO', 'planned');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1800000-0000-4000-8000-000000000001', 'e1800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-00000000000a'),
  ('f1800000-0000-4000-8000-000000000002', 'e1800000-0000-4000-8000-000000000002', 'b1800000-0000-4000-8000-00000000000a'),
  ('f1800000-0000-4000-8000-000000000003', 'e1800000-0000-4000-8000-000000000003', 'b1800000-0000-4000-8000-00000000000b');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version, checked_version, auto_approval_owed) values
  ('ac800000-0000-4000-8000-000000000001', 'b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000001',
   'f1800000-0000-4000-8000-000000000001', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'proposed', 1, 1, true),
  ('ac800000-0000-4000-8000-000000000002', 'b1800000-0000-4000-8000-00000000000a', 'c1800000-0000-4000-8000-000000000002',
   'f1800000-0000-4000-8000-000000000002', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'proposed', 1, 1, false),
  ('ac800000-0000-4000-8000-000000000003', 'b1800000-0000-4000-8000-00000000000b', 'c1800000-0000-4000-8000-000000000003',
   'f1800000-0000-4000-8000-000000000003', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'proposed', 1, 1, false);
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b1800000-0000-4000-8000-00000000000a', 'ac800000-0000-4000-8000-000000000001', 1, 'ai',
   'DOS FATOS. Maria Teste comprou a passagem e o voo atrasou oito horas.'),
  ('b1800000-0000-4000-8000-00000000000a', 'ac800000-0000-4000-8000-000000000002', 1, 'ai',
   'DOS FATOS. Rui Teste comprou a passagem e o voo foi cancelado.'),
  ('b1800000-0000-4000-8000-00000000000b', 'ac800000-0000-4000-8000-000000000003', 1, 'ai',
   'DOS FATOS. Lia Teste comprou a passagem e o voo atrasou.');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A run of the task that wrote the facts, as the executor records it.
create function pg_temp.run(org uuid, answer text) returns uuid language plpgsql as $$
declare
  made uuid := gen_random_uuid();
begin
  insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
  select made, org, 'caso.peca.fatos_cliente', v.id, 'fake', 'fake', repeat('a', 64), 'succeeded', jsonb_build_object('fatos', answer), now()
  from public.prompt_versions v where v.task = 'caso.peca.fatos_cliente' and v.is_active;
  return made;
end;
$$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('approve', public.approve_case_draft_unattended('ac800000-0000-4000-8000-000000000001'));
insert into res select 'claim-' || row_number() over (), jsonb_build_object('id', c.check_id, 'claim', c.claim)
from public.claim_piece_fact_checks(10) c;
reset role;

select ok(
  pg_temp.got('approve', 'code') = 'facts_unconfirmed'
  and (select d.auto_approval_owed and d.status = 'proposed' from public.case_drafts d where d.id = 'ac800000-0000-4000-8000-000000000001')
  and (select count(*) = 2 from public.piece_fact_checks f where f.status = 'writing')
  and not exists (select 1 from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000003')
  and public.lawsuit_facts_blocker('f1800000-0000-4000-8000-000000000001') = 'facts_unconfirmed',
  'a ready piece owes the client''s check, ONE does not approve it alone meanwhile, and a case with nobody to ask owes none'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('to-write', public.piece_fact_check_to_write(
  (select f.id from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001'),
  (select f.claims from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001')));
reset role;
insert into res values ('run', jsonb_build_object('id', pg_temp.run('b1800000-0000-4000-8000-00000000000a',
  (select regexp_replace(payload ->> 'text', '^.*?(\[[^\]]+\]).*$', 'Você, \1, comprou a passagem e o seu voo atrasou oito horas.')
   from res where name = 'to-write'))));
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('recorded', public.record_piece_fact_check(
  (select f.id from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001'),
  (select f.claims from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001'),
  'done', pg_temp.got('run', 'id')::uuid));
insert into res values ('link', public.client_link_piece_facts('token-dos-fatos'));
reset role;

select ok(
  strpos(pg_temp.got('to-write', 'text'), 'Maria Teste') = 0
  and pg_temp.got('recorded', 'code') = 'done'
  and (select f.status = 'asked' and strpos(f.facts, 'Maria Teste') > 0 and f.keys is null
       from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001')
  and jsonb_array_length((select payload -> 'items' from res where name = 'link')) = 1,
  'the model is handed the piece with no name, and the facts the client reads have their names back'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('short', public.client_link_answer_facts('token-dos-fatos',
  (select f.id from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001'), false, 'errado'));
insert into res values ('corrected', public.client_link_answer_facts('token-dos-fatos',
  (select f.id from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001'), false,
  'O voo atrasou seis horas, e não oito.'));
reset role;

select ok(
  pg_temp.got('short', 'code') = 'note_required' and pg_temp.got('corrected', 'code') = 'corrected'
  and (pg_temp.got('corrected', 'sent_back'))::boolean
  and (select d.work = 'revise' and strpos(d.revision_note, 'seis horas') > 0 and d.revisions = 1 and not d.auto_approval_owed
       from public.case_drafts d where d.id = 'ac800000-0000-4000-8000-000000000001')
  and public.lawsuit_facts_blocker('f1800000-0000-4000-8000-000000000001') = 'facts_unconfirmed',
  'a correction sends the piece back to the AI with the client''s words, and the filing still waits'
);

-- The AI wrote the piece again: its new version is asked, and the client confirms it.
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b1800000-0000-4000-8000-00000000000a', 'ac800000-0000-4000-8000-000000000001', 2, 'ai',
   'DOS FATOS. Maria Teste comprou a passagem e o voo atrasou seis horas.');
update public.case_drafts set version = 2, checked_version = 2, work = null, revision_note = null
where id = 'ac800000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res select 'claim2-' || row_number() over (), jsonb_build_object('id', c.check_id, 'claim', c.claim)
from public.claim_piece_fact_checks(10) c;
reset role;
insert into res values ('run2', jsonb_build_object('id', pg_temp.run('b1800000-0000-4000-8000-00000000000a',
  'Você comprou a passagem e o seu voo atrasou seis horas.')));
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('recorded2', public.record_piece_fact_check(
  (select f.id from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001' and f.version = 2),
  (select f.claims from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001' and f.version = 2),
  'done', pg_temp.got('run2', 'id')::uuid));
insert into res values ('confirmed', public.client_link_answer_facts('token-dos-fatos',
  (select f.id from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001' and f.version = 2), true, null));
reset role;

select ok(
  pg_temp.got('recorded2', 'code') = 'done' and pg_temp.got('confirmed', 'code') = 'confirmed'
  and not public.piece_facts_pending('ac800000-0000-4000-8000-000000000001')
  and public.lawsuit_facts_blocker('f1800000-0000-4000-8000-000000000001') is null
  and exists (select 1 from public.case_events e where e.case_id = 'c1800000-0000-4000-8000-000000000001'
              and e.kind = 'facts_confirmed' and e.actor_type = 'client'),
  'the new version is asked again; once the client confirms it, the filing waits no more'
);

-- A partner goes on without the client's word on another case, saying why.
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1800000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('no-reason', public.waive_piece_facts('ac800000-0000-4000-8000-000000000002', 'curto'));
insert into res values ('waived', public.waive_piece_facts('ac800000-0000-4000-8000-000000000002',
  'O cliente confirmou os fatos por telefone com a advogada.'));
insert into res values ('read', public.case_piece_facts('c1800000-0000-4000-8000-000000000002'));
reset role;

select ok(
  pg_temp.got('no-reason', 'code') = 'reason' and pg_temp.got('waived', 'code') = 'waived'
  and not public.piece_facts_pending('ac800000-0000-4000-8000-000000000002')
  and public.lawsuit_facts_blocker('f1800000-0000-4000-8000-000000000002') is null
  and (select payload #>> '{items,0,status}' from res where name = 'read') = 'waived'
  and exists (select 1 from public.audit_events e where e.action = 'piece_facts.waived'),
  'a partner goes on without the confirmation, saying why, on the record'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1800000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('other', public.case_piece_facts('c1800000-0000-4000-8000-000000000001'));
select throws_ok(
  $$select public.waive_piece_facts('ac800000-0000-4000-8000-000000000001', 'Outro escritório tentando.')$$,
  'P0002', 'case_not_found',
  'another firm cannot go on without the client''s word on a piece that is not theirs'
);
reset role;

select ok(
  pg_temp.got('other', 'code') = 'not_found'
  and not has_function_privilege('anon', 'public.client_link_answer_facts(text, uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_piece_fact_checks(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_piece_fact_check(uuid, integer, text, uuid)', 'EXECUTE')
  and not has_column_privilege('authenticated', 'public.piece_fact_checks', 'keys', 'SELECT'),
  'another firm reads and waives nothing of it, and only the backend writes the facts and the client''s word'
);

select is(
  (select f.status from public.piece_fact_checks f where f.draft_id = 'ac800000-0000-4000-8000-000000000001' and f.version = 2),
  'confirmed',
  'the other firm''s try left the confirmation as it was'
);

select * from finish();
rollback;
