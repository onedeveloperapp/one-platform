begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- What each firm lets ONE decide alone (0016, `autonomy_decisions`,
-- `firm_autonomy`): by default ONE decides (the owner's decision of
-- 2026-10-14), a partner chooses otherwise with the second factor, and the
-- operator may hold a decision for every firm. An AI task's answer waits as
-- the firm chose; ONE confirms a deadline on the day counted and decides to
-- file or to hold from the triage where the firm lets it. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a4500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a4500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a4500000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a4500000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a4500000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b4500000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-autonomia', 'a4500000-0000-4000-8000-000000000001'),
  ('b4500000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-autonomia', 'a4500000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b4500000-0000-4000-8000-00000000000a', 'a4500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b4500000-0000-4000-8000-00000000000a', 'a4500000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b4500000-0000-4000-8000-00000000000b', 'a4500000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A file the backend measured and kept (called as the service role).
create function pg_temp.stored(org uuid, file_name text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', file_name, 'application/pdf', 4000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat('a', 64), 4000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- A run of the check of a document, finished with an answer (as the service role).
create function pg_temp.checked(org uuid, document uuid) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'caso.documento.conferencia', repeat('f', 64), null,
    'case_document', document::text, 'doc:' || document::text);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded',
    jsonb_build_object('decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'documento', 'legivel', true,
      'nome_no_documento', 'Maria Teste', 'confere_com_a_pessoa', 'sim', 'observacoes', '', 'trechos', '[]'::jsonb),
    1200, 300) || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;

-- A case of each firm, each with a lawsuit the court has, and documents to check.
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('b4500000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('lawsuit_a', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "comarca": "Goiânia", "status": "filed", "cnj": "5000123-60.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b4500000-0000-4000-8000-00000000000b', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "Paulo Teste", "birth_date": "1980-01-01"}'::jsonb));
insert into res values ('lawsuit_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "comarca": "Goiânia", "status": "filed", "cnj": "5000123-60.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_b', 'party_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('files', jsonb_build_object(
  'a1', pg_temp.stored('b4500000-0000-4000-8000-00000000000a', 'rg-1.pdf'),
  'a2', pg_temp.stored('b4500000-0000-4000-8000-00000000000a', 'rg-2.pdf'),
  'a3', pg_temp.stored('b4500000-0000-4000-8000-00000000000a', 'rg-3.pdf'),
  'b1', pg_temp.stored('b4500000-0000-4000-8000-00000000000b', 'rg-b.pdf')));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('doc_a1', public.attach_case_document(pg_temp.got('case_a', 'case_id')::uuid, pg_temp.got('files', 'a1')::uuid,
  'identity', pg_temp.got('case_a', 'party_id')::uuid));
insert into res values ('doc_a2', public.attach_case_document(pg_temp.got('case_a', 'case_id')::uuid, pg_temp.got('files', 'a2')::uuid,
  'identity', pg_temp.got('case_a', 'party_id')::uuid));
insert into res values ('doc_a3', public.attach_case_document(pg_temp.got('case_a', 'case_id')::uuid, pg_temp.got('files', 'a3')::uuid,
  'identity', pg_temp.got('case_a', 'party_id')::uuid));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('doc_b1', public.attach_case_document(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('files', 'b1')::uuid,
  'identity', pg_temp.got('case_b', 'party_id')::uuid));
reset role;

-- ---------- The catalog, and what a firm reads of it ----------

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('read_a', jsonb_build_object('items', public.firm_autonomy('b4500000-0000-4000-8000-00000000000a')));
reset role;

select ok(
  (select array_agg(key order by position) from public.autonomy_decisions)
    = array['reply_client', 'open_case_from_chat', 'open_case_from_djen', 'send_client_link', 'send_signature_papers', 'document_check', 'chronology', 'piece_text', 'deadline_confirm', 'file_or_hold',
            'create_lawsuits', 'court_system', 'start_piece', 'request_package', 'sign_package', 'file_lawsuit', 'publication_triage',
            'publication_deadline', 'publication_hearing', 'model_from_document', 'finance_lines',
            'record_outcome', 'close_case', 'client_receipt']
  and (select bool_and(default_mode = 'auto' and not held) from public.autonomy_decisions)
  and (select task from public.autonomy_decisions where key = 'document_check') = 'caso.documento.conferencia'
  and (select task from public.autonomy_decisions where key = 'chronology') = 'caso.relato.cronologia'
  and jsonb_array_length((select payload -> 'items' from res where name = 'read_a')) = 24
  and (select bool_and(item ->> 'mode' = 'auto' and item ->> 'chosen' is null)
       from res, jsonb_array_elements(payload -> 'items') item where name = 'read_a'),
  'ONE decides by default each decision of the catalog, and anybody of the firm reads how the firm has them'
);

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.firm_autonomy('b4500000-0000-4000-8000-00000000000a')$$,
  '42501', null,
  'another firm reads nothing of it'
);
reset role;

-- ---------- A partner chooses, with the second factor ----------

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_sets', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'document_check', 'approval'));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'document_check', 'approval')$$,
  '42501', 'second_factor_required',
  'a partner chooses with the second factor'
);
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bad_mode', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'piece_text', 'sampled'));
insert into res values ('bad_decision', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'everything', 'auto'));
insert into res values ('sampled', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'document_check', 'sampled', 100));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_approval_doc', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000b', 'document_check', 'approval'));
insert into res values ('b_approval_deadline', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000b', 'deadline_confirm', 'approval'));
insert into res values ('b_approval_hold', public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000b', 'file_or_hold', 'approval'));
reset role;

select ok(
  pg_temp.got('bia_sets', 'code') = 'not_a_partner'
  and pg_temp.got('bad_mode', 'code') = 'invalid_mode'
  and pg_temp.got('bad_decision', 'code') = 'decision_not_found'
  and pg_temp.got('sampled', 'code') = 'saved'
  and pg_temp.got('b_approval_doc', 'code') = 'saved'
  and (select mode = 'sampled' and sample_percent = 100 and changed_by = 'a4500000-0000-4000-8000-000000000001'
       from public.firm_autonomy where org_id = 'b4500000-0000-4000-8000-00000000000a' and decision = 'document_check')
  and (select count(*) = 1 from public.audit_events where action = 'autonomy.set'
       and org_id = 'b4500000-0000-4000-8000-00000000000a' and metadata ->> 'from' = 'auto' and metadata ->> 'to' = 'sampled'),
  'only a partner chooses, among the ways the decision has, on the record'
);

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'document_check', 'auto')$$,
  '42501', null,
  'nor does a partner of another firm choose for this one'
);
reset role;

-- Support visits Ana: nothing is chosen for the firm in her name.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a4500000-0000-4000-8000-000000000009', 'a4500000-0000-4000-8000-000000000001', 'b4500000-0000-4000-8000-00000000000a',
        'Conferindo as escolhas', 'f4500000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001', 'aal2', 'f4500000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_autonomy('b4500000-0000-4000-8000-00000000000a', 'document_check', 'auto')$$,
  '42501', 'not_allowed_in_support_session',
  'nor does a support visit'
);
reset role;

-- ---------- An answer of the AI waits as the firm chose ----------

select pg_temp.as_backend();
set local role service_role;
-- Firm A samples every check: it waits.
insert into res values ('run_sampled', pg_temp.checked('b4500000-0000-4000-8000-00000000000a', pg_temp.got('doc_a1', 'document_id')::uuid));
-- Firm B has a person decide each: it waits.
insert into res values ('run_b', pg_temp.checked('b4500000-0000-4000-8000-00000000000b', pg_temp.got('doc_b1', 'document_id')::uuid));
reset role;
-- Firm A lets ONE decide: no answer waits.
update public.firm_autonomy set mode = 'auto' where org_id = 'b4500000-0000-4000-8000-00000000000a' and decision = 'document_check';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_auto', pg_temp.checked('b4500000-0000-4000-8000-00000000000a', pg_temp.got('doc_a2', 'document_id')::uuid));
insert into res values ('applied', public.apply_unattended_document_check(pg_temp.got('run_auto', 'run_id')::uuid));
reset role;
-- The operator holds the decision for every firm: firm A's answers wait again.
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('hold_short', public.admin_set_autonomy_hold('document_check', true, 'curta'));
insert into res values ('hold', public.admin_set_autonomy_hold('document_check', true, 'A medida da conferência caiu nesta semana.'));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('read_held', jsonb_build_object('items', public.firm_autonomy('b4500000-0000-4000-8000-00000000000a')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_held', pg_temp.checked('b4500000-0000-4000-8000-00000000000a', pg_temp.got('doc_a3', 'document_id')::uuid));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('release', public.admin_set_autonomy_hold('document_check', false));
reset role;

select ok(
  pg_temp.got('run_sampled', 'approval_id') is not null
  and pg_temp.got('run_b', 'approval_id') is not null
  and pg_temp.got('run_auto', 'approval_id') is null
  and pg_temp.got('applied', 'code') is not null
  and (select status = 'accepted' from public.case_documents where id = pg_temp.got('doc_a2', 'document_id')::uuid)
  and pg_temp.got('run_held', 'approval_id') is not null,
  'an answer of the AI waits as the firm chose, sampled or decided by a person, and by ONE takes effect alone, unless the operator holds it'
);
select ok(
  pg_temp.got('hold_short', 'code') = 'invalid_value'
  and pg_temp.got('hold', 'code') = 'held' and pg_temp.got('release', 'code') = 'released'
  and (select item ->> 'mode' = 'approval' and (item ->> 'held')::boolean and item ->> 'chosen' = 'auto'
       from res, jsonb_array_elements(payload -> 'items') item where name = 'read_held' and item ->> 'key' = 'document_check')
  and public.firm_autonomy_mode('b4500000-0000-4000-8000-00000000000a', 'document_check') = 'auto'
  and (select count(*) = 2 from public.audit_events where action in ('admin.autonomy.held', 'admin.autonomy.released')),
  'the operator holds a decision for every firm with the reason, on the record, and lets it go: the firm''s choice stays'
);

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_set_autonomy_hold('document_check', true, 'Um sócio não segura nada da plataforma.')$$,
  '42501', null,
  'a partner holds nothing for the platform'
);
reset role;

-- ---------- ONE confirms a deadline on the day counted ----------

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('deadline_a', public.propose_deadline(null, pg_temp.got('lawsuit_a', 'proceeding_id')::uuid,
  'Juntar o comprovante de residência', null, 'day', current_date - 4, 5, 'business'));
reset role;
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('deadline_b', public.propose_deadline(null, pg_temp.got('lawsuit_b', 'proceeding_id')::uuid,
  'Juntar o comprovante de residência', null, 'day', current_date - 4, 5, 'business'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_deadline_counts(10);
insert into res select 'count_' || x.name, public.record_deadline_count(pg_temp.got(x.name, 'id')::uuid, 1, 1, 'counted',
  jsonb_build_object('rule', 'prazo-v1', 'trigger', 'day', 'triggerDay', current_date - 4, 'publishedOn', null,
    'fromDay', current_date - 4, 'startsOn', current_date - 3, 'countedDueOn', current_date + 2, 'dueOn', current_date + 2,
    'days', 5, 'counting', 'business', 'skipped', '[]'::jsonb, 'moved', null, 'assumptions', '[]'::jsonb,
    'place', jsonb_build_object('court', 'TJGO')))
from (values ('deadline_a'), ('deadline_b')) as x (name);
reset role;

select ok(
  pg_temp.got('count_deadline_a', 'code') = 'counted' and pg_temp.got('count_deadline_b', 'code') = 'counted'
  and (select status = 'confirmed' and confirmed_auto and confirmed_by is null and due_on = current_date + 2
              and confirmed_against = current_date + 2 and confirmed_revision = 1 and not corrected
       from public.deadlines where id = pg_temp.got('deadline_a', 'id')::uuid)
  and (select status = 'proposed' and not confirmed_auto from public.deadlines where id = pg_temp.got('deadline_b', 'id')::uuid)
  and exists (select 1 from public.case_events where case_id = pg_temp.got('case_a', 'case_id')::uuid
              and kind = 'deadline_confirmed' and actor_type = 'system' and (data ->> 'auto')::boolean),
  'where the firm lets it, ONE confirms a deadline on the day counted, on the record; where it does not, the deadline waits for a person'
);

-- ---------- ONE decides to file or to hold from the triage ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('triage_high', public.record_suspension_triage(pg_temp.got('case_a', 'case_id')::uuid,
  '{"risk": "high", "grounds": ["alleged_weather"], "rule": "tema-1417-v1"}'::jsonb));
insert into res values ('after_high', (select to_jsonb(c) from public.cases c where c.id = pg_temp.got('case_a', 'case_id')::uuid));
insert into res values ('triage_low', public.record_suspension_triage(pg_temp.got('case_a', 'case_id')::uuid,
  '{"risk": "low", "grounds": ["internal_cause"], "rule": "tema-1417-v1"}'::jsonb));
insert into res values ('after_low', (select to_jsonb(c) from public.cases c where c.id = pg_temp.got('case_a', 'case_id')::uuid));
insert into res values ('triage_b', public.record_suspension_triage(pg_temp.got('case_b', 'case_id')::uuid,
  '{"risk": "low", "grounds": ["internal_cause"], "rule": "tema-1417-v1"}'::jsonb));
reset role;
-- A lawyer decides: ONE no longer decides that case.
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000002');
set local role authenticated;
select public.save_suspension(pg_temp.got('case_a', 'case_id')::uuid, null, 'hold');
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.record_suspension_triage(pg_temp.got('case_a', 'case_id')::uuid,
  '{"risk": "low", "grounds": ["internal_cause"], "rule": "tema-1417-v1"}'::jsonb);
reset role;

select ok(
  pg_temp.got('after_high', 'suspension_decision') = 'hold' and (pg_temp.got('after_high', 'suspension_decided_auto'))::boolean
  and pg_temp.got('after_high', 'suspension_decided_by') is null
  and pg_temp.got('after_low', 'suspension_decision') = 'file'
  and (select suspension_decision = 'hold' and not suspension_decided_auto
              and suspension_decided_by = 'a4500000-0000-4000-8000-000000000002'
       from public.cases where id = pg_temp.got('case_a', 'case_id')::uuid)
  and (select suspension_decision = 'pending' from public.cases where id = pg_temp.got('case_b', 'case_id')::uuid)
  and (select count(*) = 2 from public.case_events where case_id = pg_temp.got('case_a', 'case_id')::uuid
       and kind = 'suspension_saved' and actor_type = 'system'),
  'where the firm lets it, the triage decides to file or to hold, again at each triage, until a person decides'
);

-- ---------- What a firm reads, and the operator's ceiling of a task ----------

-- The operator holds the task of the check through its own autonomy: every firm reads the decision held.
update public.ai_tasks set autonomy = 'approval' where slug = 'caso.documento.conferencia';
select pg_temp.sign_in('a4500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('read_task_held', jsonb_build_object('items', public.firm_autonomy('b4500000-0000-4000-8000-00000000000a')));
reset role;
update public.ai_tasks set autonomy = 'autonomous' where slug = 'caso.documento.conferencia';

select ok(
  (select item ->> 'mode' = 'approval' and (item ->> 'held')::boolean
   from res, jsonb_array_elements(payload -> 'items') item where name = 'read_task_held' and item ->> 'key' = 'document_check')
  and not has_column_privilege('authenticated', 'public.autonomy_decisions', 'held_note', 'SELECT')
  and not has_column_privilege('authenticated', 'public.autonomy_decisions', 'held_by', 'SELECT')
  and has_column_privilege('authenticated', 'public.case_drafts', 'approved_auto', 'SELECT')
  and has_column_privilege('authenticated', 'public.deadlines', 'confirmed_auto', 'SELECT'),
  'a task the operator holds through its autonomy is held for the firm too; a firm reads no reason of a hold, and reads whether ONE decided'
);

-- ---------- ONE approves a piece only as the firm lets it ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('piece_missing', public.approve_case_draft_unattended(gen_random_uuid()));
insert into res values ('pieces_swept', jsonb_build_object('n', public.approve_case_drafts_unattended(10)));
reset role;

select ok(
  pg_temp.got('piece_missing', 'code') = 'draft_not_found'
  and pg_temp.got('pieces_swept', 'n') = '0'
  and not has_function_privilege('authenticated', 'public.approve_case_draft_unattended(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.approve_case_drafts_unattended(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.confirm_deadline_unattended(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.firm_autonomy_mode(uuid, text)', 'EXECUTE'),
  'what ONE approves or confirms alone is the backend''s: no session calls it'
);

select pg_temp.sign_in('a4500000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::integer from public.firm_autonomy where org_id = 'b4500000-0000-4000-8000-00000000000a'),
  0,
  'another firm reads none of the choices'
);
reset role;

select * from finish();
rollback;
