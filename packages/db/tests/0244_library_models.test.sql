begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- The firm's models by problem and by piece of the process (0244): a
-- petition keeps the problem it was written for and ONE writes a case's
-- petition from the firm's model of the case's problem before its model of
-- the kind of lawsuit; a model of a piece of the process is the firm's
-- before the platform's; a document may be sent as either, or as a
-- declaration, and ONE keeps what the marking said of it. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2440000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-modelos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2440000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-modelos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2440000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-modelos', 'a2440000-0000-4000-8000-000000000001'),
  ('b2440000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-modelos', 'a2440000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2440000-0000-4000-8000-00000000000b', 'a2440000-0000-4000-8000-000000000002', 'owner', 'socio');
-- The other firm keeps the models ONE prepares to a person.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b2440000-0000-4000-8000-00000000000b', 'model_from_document', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.platform(kind text) returns uuid language sql as $$
  select id from public.draft_templates where org_id is null and document_kind = 'piece' and is_default and proceeding_kind = kind;
$$;
-- A model a firm's lawyer saves.
create function pg_temp.save(firm uuid, who uuid, fields jsonb) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.save_draft_template(firm, null, fields);
  reset role;
  return answer;
end;
$$;
-- A Word file a person sent for a model, as the backend kept it.
create function pg_temp.sent(firm uuid, who uuid) returns uuid language plpgsql as $$
declare
  file uuid := gen_random_uuid();
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, uploaded_by, expires_at, confirmed_at)
  values (file, firm, 'model_source', 'org/' || firm || '/model_source/' || file, 'Documento do escritório',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2000, 'stored', repeat('e', 64), 2000,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', who, now() + interval '1 hour', now());
  return file;
end;
$$;
-- What the marking answered about a request, as the executor records a run (called as the service role).
create function pg_temp.ran(firm uuid, import uuid, answer jsonb) returns uuid language plpgsql as $$
declare
  started jsonb := public.start_ai_run(firm, 'biblioteca.modelo.marcacao', md5(answer::text) || md5(import::text), null,
    'template_import', import::text, 'marcacao:' || import::text || ':' || md5(answer::text));
begin
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', answer, 900, 120);
  return (started ->> 'run_id')::uuid;
end;
$$;
create function pg_temp.claim(import uuid) returns integer language sql as $$
  select ((public.claim_template_imports(1, import, true) -> 0) ->> 'claim')::integer;
$$;
create function pg_temp.hash(body text) returns text language sql as $$
  select encode(sha256(convert_to(body, 'UTF8')), 'hex');
$$;
-- A document sent as something, read and marked with an answer: what the record answered.
create function pg_temp.marked(firm uuid, who uuid, expected text, paragraphs jsonb, answer jsonb) returns jsonb
language plpgsql as $$
declare
  file uuid := pg_temp.sent(firm, who);
  asked jsonb;
  import uuid;
  ready jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  asked := public.request_template_import(firm, file, expected);
  reset role;
  import := (asked ->> 'import_id')::uuid;
  perform pg_temp.as_backend();
  set local role service_role;
  perform public.record_template_import(import, pg_temp.claim(import), 'read', paragraphs);
  ready := public.record_template_import(import, pg_temp.claim(import), 'ready', null, pg_temp.ran(firm, import, answer));
  reset role;
  return ready || jsonb_build_object('import_id', import, 'asked', asked ->> 'code');
end;
$$;
-- ONE's save of what it prepared, the very text the backend checked.
create function pg_temp.saved_by_one(import uuid) returns jsonb language plpgsql as $$
declare
  held integer;
  work jsonb;
  answer jsonb;
begin
  perform pg_temp.as_backend();
  set local role service_role;
  held := pg_temp.claim(import);
  work := public.template_import_to_work(import, held);
  answer := public.record_template_import(import, held, 'saved', null, null, null, pg_temp.hash(work ->> 'body'));
  reset role;
  return answer;
end;
$$;
-- An answer of the marking, the parts this file does not look at filled in.
create function pg_temp.answer(fields jsonb) returns jsonb language sql as $$
  select jsonb_build_object('documento', 'peca', 'tipo_de_peca', 'nenhum', 'problema', 'todos', 'o_que_e', 'uma petição',
    'faltas', '[]'::jsonb, 'perguntas', '[]'::jsonb, 'tipo_de_processo', 'juizado', 'nome', '', 'trocas', '[]'::jsonb,
    'paragrafos_do_escritorio', '[]'::jsonb, 'pessoas', '[]'::jsonb, 'observacoes', '[]'::jsonb) || fields;
$$;

-- ---------- What a model writes ----------

insert into res values ('a_cancel', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Inicial do juizado: cancelamento", "document_kind": "piece", "proceeding_kind": "juizado", "problem": "cancellation", "is_default": true, "body": "EXCELENTÍSSIMO SENHOR JUIZ DO [[JUIZO]]. Cancelamento de voo."}'));
insert into res values ('a_any', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Inicial do juizado", "document_kind": "piece", "proceeding_kind": "juizado", "is_default": true, "body": "EXCELENTÍSSIMO SENHOR JUIZ DO [[JUIZO]]. Qualquer problema."}'));
insert into res values ('a_paper', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Procuração do escritório", "document_kind": "procuracao", "problem": "cancellation", "piece_kind": "replica", "body": "PROCURAÇÃO. OUTORGANTE: [[OUTORGANTE]]."}'));
insert into res values ('a_bad_problem', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Inicial estranha", "document_kind": "piece", "problem": "lost_pet", "body": "EXCELENTÍSSIMO SENHOR JUIZ DO [[JUIZO]]."}'));
insert into res values ('a_no_kind', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Peça sem tipo", "document_kind": "peca_processo", "body": "Processo nº [COMPLETAR: número do processo]."}'));
insert into res values ('a_odd_kind', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Agravo", "document_kind": "peca_processo", "piece_kind": "agravo", "body": "Processo nº [COMPLETAR: número do processo]."}'));
insert into res values ('a_manif', pg_temp.save('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  '{"name": "Manifestação do escritório", "document_kind": "peca_processo", "piece_kind": "manifestacao", "proceeding_kind": "juizado", "problem": "delay", "body": "[[JUIZO]]\n\nProcesso nº [COMPLETAR: número do processo]\n\nA parte autora se manifesta como o escritório escreve.\n\n[[ADVOGADOS]]"}'));
insert into res values ('b_cancel', pg_temp.save('b2440000-0000-4000-8000-00000000000b', 'a2440000-0000-4000-8000-000000000002',
  '{"name": "Inicial de cancelamento", "document_kind": "piece", "proceeding_kind": "juizado", "problem": "cancellation", "body": "EXCELENTÍSSIMO SENHOR JUIZ DO [[JUIZO]]. Cancelamento, do outro escritório."}'));

select ok(
  pg_temp.got('a_cancel', 'code') = 'saved' and pg_temp.got('a_any', 'code') = 'saved'
  and (select is_default and problem = 'cancellation' from public.draft_templates where id = pg_temp.got('a_cancel', 'template_id')::uuid)
  and (select is_default and problem is null from public.draft_templates where id = pg_temp.got('a_any', 'template_id')::uuid),
  'a petition keeps the problem it was written for, and the default of a problem is not the default of every problem'
);
select ok(
  (select problem is null and piece_kind is null from public.draft_templates where id = pg_temp.got('a_paper', 'template_id')::uuid)
  and pg_temp.got('a_bad_problem', 'field') = 'problem'
  and pg_temp.got('a_no_kind', 'field') = 'piece_kind' and pg_temp.got('a_odd_kind', 'field') = 'piece_kind',
  'only a petition says a problem, of the kinds a case has, and a piece of the process always names a kind of piece ONE writes'
);
select ok(
  (select document_kind = 'peca_processo' and piece_kind = 'manifestacao' and proceeding_kind = 'juizado' and problem is null
     and is_default is false
   from public.draft_templates where id = pg_temp.got('a_manif', 'template_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'drafts.template_saved'
              and entity_id = pg_temp.got('a_manif', 'template_id') and metadata ->> 'piece_kind' = 'manifestacao'),
  'a model of a piece of the process keeps its kind of piece and its kind of lawsuit, on the record'
);
select throws_ok(
  $$ insert into public.draft_templates (org_id, name, document_kind, piece_kind, body)
     values (null, 'Réplica da plataforma', 'peca_processo', 'replica', 'Um texto qualquer da plataforma.') $$,
  '23514', 'new row for relation "draft_templates" violates check constraint "draft_templates_platform_process_check"',
  'the platform''s pieces of the process are the module''s, never a model of the library'
);

-- ---------- The model ONE writes a petition from ----------

select ok(
  public.draft_template_for('b2440000-0000-4000-8000-00000000000a', 'juizado', 'cancellation') = pg_temp.got('a_cancel', 'template_id')::uuid
  and public.draft_template_for('b2440000-0000-4000-8000-00000000000a', 'juizado', 'delay') = pg_temp.got('a_any', 'template_id')::uuid
  and public.draft_template_for('b2440000-0000-4000-8000-00000000000a', 'juizado') = pg_temp.got('a_any', 'template_id')::uuid,
  'a case of a problem is written from the firm''s petition of the problem first, then from its petition of the kind'
);
select ok(
  public.draft_template_for('b2440000-0000-4000-8000-00000000000a', 'comum', 'cancellation') = pg_temp.platform('comum')
  and public.draft_template_for('b2440000-0000-4000-8000-00000000000b', 'juizado', 'cancellation') = pg_temp.got('b_cancel', 'template_id')::uuid
  and public.draft_template_for('b2440000-0000-4000-8000-00000000000b', 'juizado', 'delay') = pg_temp.platform('juizado'),
  'a petition of another problem or of another kind is never the one ONE writes from: the platform''s is, and each firm''s is its own'
);
select ok(
  (select prosrc like '%draft_template_for(current_case.org_id, lawsuit.kind, current_case.incident)%'
   from pg_proc where proname = 'advance_case_steps')
  and (select prosrc like '%draft_template_for(current_case.org_id, draft.kind, current_case.incident)%'
       from pg_proc where proname = 'advance_redo_pieces'),
  'ONE''s advance of a case and the redo of a piece ask for the model of the case''s problem'
);

-- ---------- A piece of the process ----------

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2440000-0000-4000-8000-000000000001', 'b2440000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2440000-0000-4000-8000-000000000002', 'b2440000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, system, status, cnj, filed_at) values
  ('f2440000-0000-4000-8000-000000000001', 'b2440000-0000-4000-8000-00000000000a', 'c2440000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'projudi', 'filed', '10003012720998090100', '2026-09-01'),
  ('f2440000-0000-4000-8000-000000000002', 'b2440000-0000-4000-8000-00000000000b', 'c2440000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'projudi', 'filed', '10003021220998090100', '2026-09-01');
select pg_temp.sign_in('a2440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_piece', public.request_intermediate_piece('f2440000-0000-4000-8000-000000000001', 'manifestacao', null, null));
reset role;
select pg_temp.sign_in('a2440000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b_piece', public.request_intermediate_piece('f2440000-0000-4000-8000-000000000002', 'manifestacao', null, null));
reset role;

select ok(
  public.piece_template_for('b2440000-0000-4000-8000-00000000000a', 'manifestacao', 'juizado') = pg_temp.got('a_manif', 'template_id')::uuid
  and public.piece_template_for('b2440000-0000-4000-8000-00000000000a', 'manifestacao', 'comum') is null
  and public.piece_template_for('b2440000-0000-4000-8000-00000000000a', 'replica', 'juizado') is null
  and public.piece_template_for('b2440000-0000-4000-8000-00000000000b', 'manifestacao', 'juizado') is null,
  'the firm''s model of a piece serves its kind of piece and of lawsuit, and is never another firm''s'
);
select ok(
  pg_temp.got('a_piece', 'code') = 'requested'
  and (select template_id = pg_temp.got('a_manif', 'template_id')::uuid and template_name = 'Manifestação do escritório'
          and template_body like '%A parte autora se manifesta como o escritório escreve.%'
       from public.case_drafts where id = pg_temp.got('a_piece', 'draft_id')::uuid),
  'a piece of the process is written from the firm''s own model of it'
);
select ok(
  pg_temp.got('b_piece', 'code') = 'requested'
  and (select d.template_id is null and d.template_name = k.name and d.template_body not like '%como o escritório escreve%'
       from public.case_drafts d join public.piece_kinds k on k.slug = d.piece_kind
       where d.id = pg_temp.got('b_piece', 'draft_id')::uuid),
  'a firm with no model of the piece has it written from the platform''s'
);
select throws_ok(
  format($$ update public.case_drafts set template_id = %L where id = %L $$,
    pg_temp.got('a_any', 'template_id'), pg_temp.got('a_piece', 'draft_id')),
  '22023', 'not_a_piece_template',
  'a piece of the process is never written from a petition'
);

-- ---------- A document sent for a model ----------

select ok(
  public.template_import_proposal(pg_temp.answer('{"documento": "peca_do_processo", "tipo_de_peca": "replica", "problema": "delay"}'),
    '["Réplica."]') @> '{"document_kind": "peca_processo", "piece_kind": "replica", "proceeding_kind": "juizado"}'
  and not public.template_import_proposal(pg_temp.answer('{"documento": "peca_do_processo", "tipo_de_peca": "replica", "problema": "delay"}'),
    '["Réplica."]') ? 'problem'
  and public.template_import_proposal(pg_temp.answer('{"documento": "peca_do_processo", "tipo_de_peca": "agravo"}'),
    '["Agravo."]') ->> 'document_kind' = 'outro'
  and public.template_import_proposal(pg_temp.answer('{"problema": "cancellation"}'), '["Inicial."]') ->> 'problem' = 'cancellation'
  and not public.template_import_proposal(pg_temp.answer('{"problema": "todos"}'), '["Inicial."]') ? 'problem'
  and public.template_import_proposal(pg_temp.answer('{"documento": "declaracao_hipossuficiencia", "tipo_de_processo": "ambos"}'),
    '["Declaro."]') ->> 'document_kind' = 'declaracao_hipossuficiencia',
  'the marking says a piece of the process of a kind ONE writes, a declaration, and the problem a petition was written for'
);

insert into res values ('a_embargos', pg_temp.marked('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  'peca_processo', '["Embargos de declaração.", "Processo nº 1000301-27.2099.8.09.0100.", "Os embargos do escritório."]',
  pg_temp.answer('{"documento": "peca_do_processo", "tipo_de_peca": "embargos", "o_que_e": "embargos de declaração", "trocas": [{"de": 2, "ate": 2, "motivo": "o número do processo", "texto": "Processo nº [COMPLETAR: número do processo].", "trechos": []}]}')));
insert into res values ('a_embargos_saved', pg_temp.saved_by_one(pg_temp.got('a_embargos', 'import_id')::uuid));
insert into res values ('a_delay', pg_temp.marked('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  'piece', '["EXCELENTÍSSIMO SENHOR JUIZ.", "Atraso de voo: os argumentos do escritório."]',
  pg_temp.answer('{"problema": "delay", "nome": "Inicial do juizado: atraso", "trocas": [{"de": 1, "ate": 1, "motivo": "o juízo", "texto": "EXCELENTÍSSIMO SENHOR JUIZ DO [[JUIZO]].", "trechos": []}]}')));
insert into res values ('a_delay_saved', pg_temp.saved_by_one(pg_temp.got('a_delay', 'import_id')::uuid));
insert into res values ('a_residence', pg_temp.marked('b2440000-0000-4000-8000-00000000000a', 'a2440000-0000-4000-8000-000000000001',
  'declaracao_residencia', '["Declaração de residência."]', pg_temp.answer('{"documento": "contrato", "tipo_de_processo": "ambos"}')));
insert into res values ('b_delay', pg_temp.marked('b2440000-0000-4000-8000-00000000000b', 'a2440000-0000-4000-8000-000000000002',
  'piece', '["EXCELENTÍSSIMO SENHOR JUIZ.", "Atraso de voo: os argumentos do outro escritório."]',
  pg_temp.answer('{"problema": "delay", "nome": "Inicial de atraso"}')));

select ok(
  pg_temp.got('a_embargos', 'asked') = 'requested' and pg_temp.got('a_embargos', 'code') = 'saving'
  and pg_temp.got('a_embargos_saved', 'code') = 'saved'
  and (select name = 'Embargos de declaração do escritório' and document_kind = 'peca_processo' and piece_kind = 'embargos'
          and proceeding_kind = 'juizado' and is_default and prepared_by_one
          and body like E'%Processo nº [COMPLETAR: número do processo].%'
       from public.draft_templates where id = pg_temp.got('a_embargos_saved', 'template_id')::uuid),
  'a piece of the process sent as one is saved by ONE as the firm''s model of its kind, named by it, the default of its use'
);
select ok(
  pg_temp.got('a_delay_saved', 'code') = 'saved'
  and (select problem = 'delay' and is_default from public.draft_templates where id = pg_temp.got('a_delay_saved', 'template_id')::uuid)
  and (select is_default from public.draft_templates where id = pg_temp.got('a_any', 'template_id')::uuid)
  and public.draft_template_for('b2440000-0000-4000-8000-00000000000a', 'juizado', 'delay') = pg_temp.got('a_delay_saved', 'template_id')::uuid,
  'a petition of a problem the firm had no model of is the default of that problem, and the firm''s other defaults stay'
);
select ok(
  pg_temp.got('a_residence', 'asked') = 'requested' and pg_temp.got('a_residence', 'code') = 'refused'
  and (select expected_kind = 'declaracao_residencia' and refusal ->> 'code' = 'wrong_kind' and refusal ->> 'found' = 'contrato'
       from public.template_imports where id = pg_temp.got('a_residence', 'import_id')::uuid),
  'a document may be sent as a declaration, and one that is another thing is refused saying what it is'
);
select ok(
  pg_temp.got('b_delay', 'code') = 'ready'
  and (select proposal ->> 'problem' = 'delay' and status = 'ready' from public.template_imports
       where id = pg_temp.got('b_delay', 'import_id')::uuid)
  and not exists (select 1 from public.draft_templates where org_id = 'b2440000-0000-4000-8000-00000000000b' and problem = 'delay'),
  'a firm that keeps the models to a person has the problem waiting with what ONE prepared, and nothing saved'
);

-- ---------- The marking and who calls what ----------

select ok(
  (select count(*) = 1 from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and is_active
     and output_schema -> 'properties' ? 'tipo_de_peca' and output_schema -> 'properties' ? 'problema'),
  'the marking in force is the one that says the kind of a piece of the process and the problem of a petition'
);
select ok(
  not has_function_privilege('authenticated', 'public.draft_template_for(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.piece_template_for(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.request_template_import(uuid, uuid, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.request_template_import(uuid, uuid, text, boolean)', 'execute'),
  'which model ONE writes from is the backend''s to ask; a member asks for a model from a document'
);

select * from finish();
rollback;
