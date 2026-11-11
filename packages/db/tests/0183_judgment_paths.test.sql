begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The judgment: its options, the appeal and its costs (0185): each judgment
-- has its paths; the client says on their link they know what an appeal
-- costs; a partner or a lawyer decides, with the second factor, and
-- accepting the judgment takes back the deadlines ONE proposed from it. Two
-- firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1830000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-caminho.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1830000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-caminho.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a1830000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-caminho.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1830000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-caminho', 'a1830000-0000-4000-8000-000000000001'),
  ('b1830000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-caminho', 'a1830000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1830000-0000-4000-8000-00000000000a', 'a1830000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1830000-0000-4000-8000-00000000000a', 'a1830000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1830000-0000-4000-8000-00000000000b', 'a1830000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.people (id, org_id, full_name) values
  ('d1830000-0000-4000-8000-000000000001', 'b1830000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1830000-0000-4000-8000-000000000001', 'b1830000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1830000-0000-4000-8000-000000000001', 'b1830000-0000-4000-8000-00000000000a', 'c1830000-0000-4000-8000-000000000001', 'd1830000-0000-4000-8000-000000000001', 'claimant');
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b1830000-0000-4000-8000-00000000000a', 'c1830000-0000-4000-8000-000000000001', 'd1830000-0000-4000-8000-000000000001',
   encode(sha256(convert_to('token-do-caminho', 'UTF8')), 'hex'), now() + interval '30 days');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1830000-0000-4000-8000-000000000001', 'b1830000-0000-4000-8000-00000000000a', 'c1830000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2025-08-01');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1830000-0000-4000-8000-000000000001', 'e1830000-0000-4000-8000-000000000001', 'b1830000-0000-4000-8000-00000000000a');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b1830000-0000-4000-8000-00000000000a', 'c1830000-0000-4000-8000-000000000001', 'f1830000-0000-4000-8000-000000000001',
   'sentenca', 'parcial', 200000, current_date - 3, 'person');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select ok(
  (select count(*) = 1 from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'),
  'a judgment has its paths'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('link', public.client_link_judgment_paths('token-do-caminho'));
insert into res values ('agreed', public.client_link_answer_judgment_path('token-do-caminho',
  (select id from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'), true));
reset role;

select ok(
  (select payload #>> '{items,0,kind}' = 'juizado' and payload #>> '{items,0,result}' = 'parcial'
          and payload #>> '{items,0,cents}' = '200000' from res where name = 'link')
  and pg_temp.got('agreed', 'code') = 'recorded'
  and (select client_agrees and client_via = 'link' from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'),
  'the client reads the judgment on their link and says they know what an appeal costs'
);

-- Somebody of the attendance cannot decide; a partner decides with the second factor.
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1830000-0000-4000-8000-000000000003', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('attendance', public.decide_judgment_path(
  (select id from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'), 'aceitar', null));
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1830000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
insert into res values ('no-factor', public.decide_judgment_path(
  (select id from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'), 'recurso_inominado', null));
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1830000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('wrong', public.decide_judgment_path(
  (select id from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'), 'apelacao', null));
insert into res values ('decided', public.decide_judgment_path(
  (select id from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'), 'recurso_inominado',
  'O cliente concordou com os custos do recurso.'));
reset role;

select ok(
  pg_temp.got('attendance', 'code') = 'not_allowed' and pg_temp.got('no-factor', 'code') = 'second_factor'
  and pg_temp.got('wrong', 'code') = 'invalid_decision' and pg_temp.got('decided', 'code') = 'decided'
  and (select decision = 'recurso_inominado' and decided_by = 'a1830000-0000-4000-8000-000000000001'
       from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001')
  and exists (select 1 from public.audit_events e where e.action = 'judgment_path.decided'),
  'a partner decides with the second factor, among the options of the lawsuit''s kind, on the record'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('late', public.client_link_answer_judgment_path('token-do-caminho',
  (select id from public.judgment_paths where case_id = 'c1830000-0000-4000-8000-000000000001'), false));
reset role;
select ok(pg_temp.got('late', 'code') = 'decided', 'once decided, the client''s word no longer changes it');

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1830000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  (select count(*) = 0 from public.judgment_paths)
  and not has_function_privilege('anon', 'public.client_link_answer_judgment_path(text, uuid, boolean)', 'EXECUTE'),
  'another firm reads nothing of it, and only the backend writes the client''s word'
);
reset role;

select * from finish();
rollback;
