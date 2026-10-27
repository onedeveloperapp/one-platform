begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- The court system of a lawsuit is ONE's, and the firm's to approve or not (0066).
--
-- A planned lawsuit has the system the platform's table gives for its court and kind, named by ONE whatever was
-- sent; a partner, a lawyer or the controladoria approves it, on the record as their decision, or does not,
-- saying why; a package waits for that, and one in course is given up when its system is refused or changes; the
-- platform reads what the firms refused, and a row it changes or confirms is had again by the planned lawsuits of
-- that court and kind. A lawsuit ONE created says so. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@sistema.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@sistema.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@sistema.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@sistema.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'olga@sistema.invalid', '', now(), '{}', '{"display_name":"Olga Operadora"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a7000000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b7000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-sistema', 'a7000000-0000-4000-8000-000000000001'),
  ('b7000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-sistema', 'a7000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000003', 'member', 'controladoria'),
  ('b7000000-0000-4000-8000-00000000000b', 'a7000000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated',
  'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.lawsuit(name text) returns public.proceedings language sql as
$$ select * from public.proceedings where id = pg_temp.got(name, 'proceeding_id')::uuid; $$;

-- ---------- The lawsuits ----------

-- TJAC's civil court has no row in the table here: a lawsuit there has no system for ONE to name.
delete from public.court_systems where court = 'TJAC' and proceeding_kind = 'comum';

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b7000000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste"}'::jsonb));
-- Ana sends eproc for a lawsuit of TJGO's small-claims court: the system is the table's, not hers.
insert into res values ('l1', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "eproc"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid]));
insert into res values ('l2', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJAC", "comarca": "Rio Branco", "forum_basis": "domicile", "system": "projudi"}'::jsonb));
-- A lawsuit the court has keeps the system it has.
insert into res values ('l4', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'comum', 'court', 'TJGO', 'comarca', 'Goiânia', 'forum_basis', 'domicile', 'system', 'projudi',
    'status', 'filed', 'cnj', '5000303-76.2099.8.09.0051', 'filed_at', (now() at time zone 'America/Sao_Paulo')::date)));
insert into res values ('case_one', public.create_case('b7000000-0000-4000-8000-00000000000a', 'cancellation', 'LA', null,
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- ONE writes a lawsuit of its own (the backend, for the case its function names).
select pg_temp.as_backend();
set local role service_role;
select set_config('one.system_case', pg_temp.got('case_one', 'case_id'), true);
insert into res values ('l3', public.save_proceeding(pg_temp.got('case_one', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case_one', 'party_id')::uuid]));
select set_config('one.system_case', '', true);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b7000000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Rui Teste"}'::jsonb));
insert into res values ('lb', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb));
reset role;

select ok(
  (select system = 'projudi' and system_by_one and not created_by_one and system_approved_at is null
          and system_refused_at is null from pg_temp.lawsuit('l1'))
  and (select system = (select cs.system from public.court_systems cs where cs.court = 'TJGO' and cs.proceeding_kind = 'juizado')
       from pg_temp.lawsuit('l1'))
  and (select system is null and not system_by_one from pg_temp.lawsuit('l2'))
  and (select system = 'projudi' and not system_by_one and status = 'filed' from pg_temp.lawsuit('l4')),
  'a planned lawsuit has the system the table gives for its court and kind, as ONE''s, whatever was sent; with no row, none; one the court has keeps its own'
);

select ok(
  (select created_by_one and system_by_one from pg_temp.lawsuit('l3'))
  and not (select created_by_one from pg_temp.lawsuit('lb')),
  'a lawsuit ONE wrote says it was ONE''s, and one a person wrote says nothing of the kind'
);

select is(public.filing_blocker(pg_temp.got('l1', 'proceeding_id')::uuid), 'system_unapproved',
  'a lawsuit whose system the firm did not approve yet is not filed');

-- ---------- Who approves ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia', public.decide_court_system(pg_temp.got('l1', 'proceeding_id')::uuid, true));
reset role;
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a7000000-0000-4000-8000-000000000009', 'a7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-00000000000a',
        'Conferindo os sistemas', 'f7000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_court_system(%L, true)', pg_temp.got('l1', 'proceeding_id')),
  '42501', 'not_allowed_in_support_session',
  'a support visit approves no system'
);
reset role;
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.decide_court_system(%L, true)', pg_temp.got('l1', 'proceeding_id')),
  'P0002', 'case_not_found',
  'nobody of another firm approves a system of this one'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio', public.decide_court_system(pg_temp.got('l1', 'proceeding_id')::uuid, true));
insert into res values ('caio_again', public.decide_court_system(pg_temp.got('l1', 'proceeding_id')::uuid, true));
insert into res values ('unknown', public.decide_court_system(pg_temp.got('l2', 'proceeding_id')::uuid, true));
insert into res values ('filed', public.decide_court_system(pg_temp.got('l4', 'proceeding_id')::uuid, true));
reset role;

select ok(
  pg_temp.got('bia', 'code') = 'not_allowed'
  and pg_temp.got('caio', 'code') = 'approved' and pg_temp.got('caio_again', 'code') = 'unchanged'
  and pg_temp.got('unknown', 'code') = 'system_unknown' and pg_temp.got('filed', 'code') = 'proceeding_not_planned'
  and (select system_approved_by = 'a7000000-0000-4000-8000-000000000003' and system_approved_at is not null
       from pg_temp.lawsuit('l1'))
  and public.filing_blocker(pg_temp.got('l1', 'proceeding_id')::uuid) is null,
  'a partner, a lawyer or the controladoria approves the system ONE named, once; the attendance does not, and there is nothing to approve of a lawsuit with no system or one the court has'
);

select ok(
  (select count(*) = 1 from public.case_events e
   where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'court_system_approved' and e.actor_type = 'person'
     and e.actor_id = 'a7000000-0000-4000-8000-000000000003' and e.data ->> 'system' = 'projudi')
  and exists (select 1 from public.audit_events a where a.action = 'case.court_system_approved'
              and a.actor_id = 'a7000000-0000-4000-8000-000000000003'),
  'the approval is told in the case''s timeline as the decision of who approved it, and kept in the audit trail'
);

-- ---------- Not approved ----------

-- A package in course for that lawsuit.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('petition_file', public.reserve_file('b7000000-0000-4000-8000-00000000000a', 'upload', 'inicial.pdf',
  'application/pdf', 300000));
select public.confirm_file(pg_temp.got('petition_file', 'file_id')::uuid, repeat('c', 64), 300000, 'application/pdf', 8);
reset role;
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('petition', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('petition_file', 'file_id')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('petition', 'document_id')::uuid, 'accepted');
reset role;
insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id)
values ('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-00000000000a', pg_temp.got('case', 'case_id')::uuid,
        pg_temp.got('l1', 'proceeding_id')::uuid, 'TJGO', 'projudi', 'juizado', 'requested',
        pg_temp.got('petition', 'document_id')::uuid);

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('refuse_short', public.decide_court_system(pg_temp.got('l1', 'proceeding_id')::uuid, false, 'Não'));
insert into res values ('refuse', public.decide_court_system(pg_temp.got('l1', 'proceeding_id')::uuid, false,
  '  O juizado de Goiânia recebe os processos novos pelo PJe desde o mês passado.  '));
reset role;

select ok(
  pg_temp.got('refuse_short', 'code') = 'reason_required'
  and pg_temp.got('refuse', 'code') = 'refused'
  and (select system_refused_by = 'a7000000-0000-4000-8000-000000000001'
              and system_refused_reason = 'O juizado de Goiânia recebe os processos novos pelo PJe desde o mês passado.'
              and system_approved_at is null and system_approved_by is null and system = 'projudi'
       from pg_temp.lawsuit('l1'))
  and public.filing_blocker(pg_temp.got('l1', 'proceeding_id')::uuid) = 'system_refused',
  'a system the firm does not approve is said why, the approval before it goes, and the lawsuit is not filed'
);

select ok(
  (select status = 'cancelled' and not cancelled_by_person from public.filing_packages
   where id = 'c7000000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'filing_package_cancelled'
                and e.data ->> 'package' = 'c7000000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'court_system_refused'
                and e.actor_type = 'person' and not e.data::text like '%PJe desde%'),
  'what was built for a system the firm refused is given up (for ONE to ask again once one is approved), and the timeline says it by the system, never by the reason'
);

-- ---------- The platform reads it, and answers ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select * from public.admin_court_system_refusals()$$, '42501', 'not_authorized',
  'a partner of a firm reads nothing of what the firms refused');
reset role;
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res select 'refusals', to_jsonb(r) from public.admin_court_system_refusals() r
where r.court = 'TJGO' and r.proceeding_kind = 'juizado';
reset role;

select ok(
  pg_temp.got('refusals', 'system') = 'projudi' and pg_temp.got('refusals', 'refused') = '1'
  and pg_temp.got('refusals', 'waiting') = '2'
  and (select payload -> 'reasons' ->> 0 from res where name = 'refusals')
      = 'O juizado de Goiânia recebe os processos novos pelo PJe desde o mês passado.'
  and not (select payload::text from res where name = 'refusals') like '%Souza%',
  'the operator reads, by court and kind, how many lawsuits refused the system and how many wait, with the reasons and never the firm'
);

-- Davi approves the other firm's lawsuit of the same court and kind; then the platform changes the system of that row.
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi', public.decide_court_system(pg_temp.got('lb', 'proceeding_id')::uuid, true));
reset role;
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('to_pje', public.admin_set_court_system('TJGO', 'juizado', 'pje', null, null,
  'Ato do tribunal conferido pela plataforma', null, false));
reset role;

select ok(
  pg_temp.got('davi', 'code') = 'approved' and pg_temp.got('to_pje', 'code') = 'saved'
  and (select system = 'pje' and system_by_one and system_refused_at is null and system_approved_at is null
       from pg_temp.lawsuit('l1'))
  and (select system = 'pje' and system_approved_at is null from pg_temp.lawsuit('lb'))
  and (select system = 'pje' from pg_temp.lawsuit('l3'))
  and (select system = 'projudi' from pg_temp.lawsuit('l4'))
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'court_system_changed'
                and e.actor_type = 'system' and e.data ->> 'from' = 'projudi' and e.data ->> 'to' = 'pje'),
  'a row the platform changes is had again by every planned lawsuit of that court and kind: a refusal is answered and an approval of the old system goes; a lawsuit the court has keeps its own'
);

-- Ana approves pje; Davi refuses it; then the platform confirms the row as it is.
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_pje', public.decide_court_system(pg_temp.got('l1', 'proceeding_id')::uuid, true));
reset role;
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_refuses', public.decide_court_system(pg_temp.got('lb', 'proceeding_id')::uuid, false,
  'O cartório disse que é o Projudi ainda.'));
reset role;
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('confirm', public.admin_set_court_system('TJGO', 'juizado', 'pje', null, null,
  'Ato do tribunal conferido pela plataforma', null, true));
reset role;

select ok(
  pg_temp.got('ana_pje', 'code') = 'approved' and pg_temp.got('davi_refuses', 'code') = 'refused'
  and pg_temp.got('confirm', 'code') = 'saved'
  and (select system_approved_by = 'a7000000-0000-4000-8000-000000000001' from pg_temp.lawsuit('l1'))
  and (select system_refused_at is null and system_approved_at is null from pg_temp.lawsuit('lb')),
  'a row the platform confirms keeps the approvals of its system and answers what was refused, so that firm is asked again'
);

-- The platform adds the row TJAC's civil court lacked: the lawsuit that had no system has ONE's.
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('tjac', public.admin_set_court_system('TJAC', 'comum', 'eproc', null, null,
  'Ato do tribunal conferido pela plataforma', null, false));
reset role;

select ok(
  pg_temp.got('tjac', 'code') = 'saved'
  and (select system = 'eproc' and system_by_one and system_approved_at is null from pg_temp.lawsuit('l2'))
  and public.filing_blocker(pg_temp.got('l2', 'proceeding_id')::uuid) = 'system_unapproved',
  'a row the platform adds is had by the planned lawsuits that had no system, for the firm to approve'
);

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  not exists (select 1 from public.proceedings where id = pg_temp.got('l1', 'proceeding_id')::uuid)
  and (select system_refused_reason is null from public.proceedings where id = pg_temp.got('lb', 'proceeding_id')::uuid),
  'a firm reads only its own lawsuits and what was decided of their systems'
);
reset role;

select ok(
  has_function_privilege('authenticated', 'public.decide_court_system(uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.decide_court_system(uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.give_up_lawsuit_packages(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.proceedings_court_system()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_court_system_refusals()', 'EXECUTE'),
  'only a member decides a system, through its function; what names and gives up is the database''s own'
);

select * from finish();
rollback;
