begin;
create extension if not exists pgtap;
select plan(30);

-- ============================================================
-- ONE makes the firm's own model from the document the firm already uses
-- (0079): a document sent as a paper that is another thing, or that lacks
-- what its kind must hold, is refused with why; what only the firm knows is
-- asked of a partner or a lawyer, the setting's rounds at most; and where the
-- firm lets ONE, ONE saves the very text the backend checked as the firm's
-- model, the default of its paper when it was sent for one. A firm that keeps
-- it to a person has it wait, as before. Two firms.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-firma.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-firma.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@souza-firma.invalid', '', now(), '{}', '{"display_name":"Duda Reis"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-firma.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-firma-doc', 'a8200000-0000-4000-8000-000000000001'),
  ('b8200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-firma-doc', 'a8200000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b8200000-0000-4000-8000-00000000000b', 'a8200000-0000-4000-8000-000000000004', 'owner', 'socio');
-- The other firm keeps the models ONE prepares to a person.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b8200000-0000-4000-8000-00000000000b', 'model_from_document', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
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
-- The worker that saves claims a request.
create function pg_temp.claim(import uuid) returns integer language sql as $$
  select ((public.claim_template_imports(1, import, true) -> 0) ->> 'claim')::integer;
$$;
-- A request read: its paragraphs kept, the marking owed.
create function pg_temp.read(import uuid, paragraphs jsonb) returns text language sql as $$
  select public.record_template_import(import, pg_temp.claim(import), 'read', paragraphs) ->> 'code';
$$;
-- The marking recorded with an answer.
create function pg_temp.mark(firm uuid, import uuid, answer jsonb) returns jsonb language sql as $$
  select public.record_template_import(import, pg_temp.claim(import), 'ready', null, pg_temp.ran(firm, import, answer));
$$;
create function pg_temp.hash(body text) returns text language sql as $$
  select encode(sha256(convert_to(body, 'UTF8')), 'hex');
$$;
-- An answer of the marking, the parts this file does not look at filled in.
create function pg_temp.answer(fields jsonb) returns jsonb language sql as $$
  select jsonb_build_object('documento', 'procuracao', 'o_que_e', 'uma procuração', 'faltas', '[]'::jsonb,
    'perguntas', '[]'::jsonb, 'tipo_de_processo', 'ambos', 'nome', '', 'trocas', '[]'::jsonb, 'pessoas', '[]'::jsonb,
    'observacoes', '[]'::jsonb) || fields;
$$;

insert into res values ('procuracao', jsonb_build_object('paragraphs', jsonb_build_array(
  'PROCURAÇÃO', 'OUTORGANTE: MARIA TESTE, brasileira.', 'OUTORGADOS: os advogados do escritório.',
  'PODERES: os da cláusula ad judicia et extra.', 'Goiânia, 10 de maio de 2099.')));
insert into res values ('contrato', jsonb_build_object('paragraphs', jsonb_build_array(
  'CONTRATO DE HONORÁRIOS', 'CONTRATANTE: MARIA TESTE.', 'CONTRATADO: Souza Advogados.',
  'HONORÁRIOS: ____% do proveito econômico.', 'Goiânia, 10 de maio de 2099.')));
insert into res values ('proc_answer', pg_temp.answer(jsonb_build_object('nome', 'Procuração do escritório',
  'pessoas', jsonb_build_array('MARIA TESTE'),
  'trocas', jsonb_build_array(
    jsonb_build_object('de', 2, 'ate', 2, 'motivo', 'o cliente', 'texto', 'OUTORGANTE: [[OUTORGANTE]].'),
    jsonb_build_object('de', 5, 'ate', 5, 'motivo', 'o local e a data', 'texto', '[[LOCAL_DATA]].')))));

-- ---------- What the database writes of a model ----------

select is(
  public.template_import_body('["A", "B", "C", "D", "E"]'::jsonb,
    '[{"from": 2, "to": 3, "text": "X"}, {"from": 3, "to": 3, "text": "Y"}, {"from": 4, "to": 4, "text": "  "}, {"from": 6, "to": 6, "text": "Z"}]'::jsonb),
  E'A\n\nX\n\nE',
  'the model is each change in the place of its paragraphs, a change that only removes them, and nothing over a paragraph already written or past the last'
);
select is(
  public.template_import_words(E'Qual é o percentual — dos honorários!!\n', 300),
  'Qual é o percentual, dos honorários.',
  'what the marking writes for a person is said in the copy rules: a comma for a dash, a full stop for an exclamation'
);

-- ---------- Sending a document as a paper ----------

insert into res values ('proc_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
insert into res values ('free_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
insert into res values ('odd_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked_proc', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('proc_file', 'id')::uuid, 'procuracao', true));
insert into res values ('asked_free', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('free_file', 'id')::uuid, null, true));
insert into res values ('asked_odd', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('odd_file', 'id')::uuid, 'peticao'));
reset role;

select ok(
  pg_temp.got('asked_proc', 'code') = 'requested'
  and (select expected_kind = 'procuracao' and make_default from public.template_imports
       where id = pg_temp.got('asked_proc', 'import_id')::uuid)
  and (select expected_kind is null and not make_default from public.template_imports
       where id = pg_temp.got('asked_free', 'import_id')::uuid)
  and pg_temp.got('asked_odd', 'code') = 'invalid_data',
  'a document is sent as a paper the model of which takes the place of the default, and a default is asked only of a paper named'
);

-- ---------- Refused, with why ----------

insert into res values ('wrong_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
insert into res values ('lacking_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked_wrong', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('wrong_file', 'id')::uuid, 'procuracao'));
insert into res values ('asked_lacking', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('lacking_file', 'id')::uuid, 'procuracao'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('wrong_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked_wrong', 'import_id')::uuid,
  (select payload -> 'paragraphs' from res where name = 'contrato'))));
insert into res values ('wrong', pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_wrong', 'import_id')::uuid,
  pg_temp.answer('{"documento": "contrato", "o_que_e": "um contrato de honorários"}')));
insert into res values ('lacking_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked_lacking', 'import_id')::uuid,
  (select payload -> 'paragraphs' from res where name = 'procuracao'))));
insert into res values ('lacking', pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_lacking', 'import_id')::uuid,
  pg_temp.answer('{"faltas": ["poderes", "honorarios", "poderes"]}')));
reset role;

select ok(
  pg_temp.got('wrong_read', 'code') = 'read' and pg_temp.got('wrong', 'code') = 'refused'
  and (select status = 'refused' and paragraphs is null and proposal is null
         and refusal = '{"code": "wrong_kind", "found": "contrato", "what": "um contrato de honorários"}'::jsonb
       from public.template_imports where id = pg_temp.got('asked_wrong', 'import_id')::uuid),
  'a contract sent as the power of attorney is refused, saying what it is, and what was read of it goes'
);
select ok(
  pg_temp.got('lacking', 'code') = 'refused'
  and (select refusal -> 'missing' = '["poderes"]'::jsonb and refusal ->> 'code' = 'missing'
       from public.template_imports where id = pg_temp.got('asked_lacking', 'import_id')::uuid),
  'a power of attorney with no powers is refused, naming only what a power of attorney must hold, once'
);
select ok(
  exists (select 1 from public.audit_events where action = 'library.import_refused'
          and entity_id = pg_temp.got('asked_wrong', 'import_id') and metadata ->> 'expected' = 'procuracao'),
  'a refusal is on the record'
);

-- ---------- What only the firm knows ----------

insert into res values ('fee_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked_fee', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('fee_file', 'id')::uuid, 'contrato', true));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('fee_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked_fee', 'import_id')::uuid,
  (select payload -> 'paragraphs' from res where name = 'contrato'))));
insert into res values ('fee_asks', pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.answer(jsonb_build_object('documento', 'contrato', 'perguntas', jsonb_build_array(
    jsonb_build_object('pergunta', E'Qual é o percentual — dos honorários!', 'motivo', 'O contrato deixa o percentual em branco.'),
    jsonb_build_object('pergunta', 'Ok', 'motivo', 'curta demais'))))));
reset role;

select ok(
  pg_temp.got('fee_asks', 'code') = 'asking'
  and (select status = 'asking' and rounds = 1 and proposal is null and paragraphs is not null
         and questions = '[{"question": "Qual é o percentual, dos honorários.", "why": "O contrato deixa o percentual em branco."}]'::jsonb
       from public.template_imports where id = pg_temp.got('asked_fee', 'import_id')::uuid),
  'a blank of the firm is asked of the firm, in the copy rules, and a question too short to be one is left out'
);

select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('caio_answers', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid, '["30%"]'));
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('duda_answers', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid, '["30%"]'));
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_counts', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid, '["30%", "a mais"]'));
insert into res values ('ana_blank', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid, '["   "]'));
insert into res values ('ana_long', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid,
  jsonb_build_array(repeat('a', 1001))));
insert into res values ('ana_answers', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid,
  '["30% do proveito econômico"]'));
insert into res values ('ana_again', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid, '["40%"]'));
reset role;

select ok(
  pg_temp.got('caio_answers', 'code') = 'not_found' and pg_temp.got('duda_answers', 'code') = 'not_allowed'
  and pg_temp.got('ana_counts', 'code') = 'invalid_data' and pg_temp.got('ana_blank', 'code') = 'no_answer'
  and pg_temp.got('ana_long', 'code') = 'too_long',
  'nobody of another firm answers, nor who does not write models; an answer per question, at least one said, within the setting'
);
select ok(
  pg_temp.got('ana_answers', 'code') = 'answered' and pg_temp.got('ana_again', 'code') = 'not_asking'
  and (select status = 'marking' and questions is null and run_round = 1 and attempts = 0
         and jsonb_array_length(exchanges) = 1
         and exchanges -> 0 -> 'answers' = '["30% do proveito econômico"]'::jsonb
         and exchanges -> 0 ->> 'by' = 'a8200000-0000-4000-8000-000000000001'
       from public.template_imports where id = pg_temp.got('asked_fee', 'import_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'library.import_answered'
              and entity_id = pg_temp.got('asked_fee', 'import_id')),
  'a partner answers once: the marking is owed again, under a new key, with what was asked and answered, on the record'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('fee_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_fee', 'import_id')::uuid)));
insert into res values ('fee_work', public.template_import_to_work(pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.got('fee_claim', 'claim')::integer));
insert into res values ('fee_asks_again', public.record_template_import(pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.got('fee_claim', 'claim')::integer, 'ready', null,
  pg_temp.ran('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_fee', 'import_id')::uuid,
    pg_temp.answer(jsonb_build_object('documento', 'contrato', 'perguntas', jsonb_build_array(
      jsonb_build_object('pergunta', 'Em quantos dias os honorários são pagos?', 'motivo', 'O prazo está em branco.')))))));
reset role;

select ok(
  pg_temp.got('fee_work', 'work') = 'marking' and pg_temp.got('fee_work', 'expected_kind') = 'contrato'
  and pg_temp.got('fee_work', 'last_round') = 'false'
  and pg_temp.got('fee_work', 'run_key') = 'library-import:' || pg_temp.got('asked_fee', 'import_id') || ':marking:1'
  and (select payload -> 'exchanges' from res where name = 'fee_work')
      = '[{"questions": [{"question": "Qual é o percentual, dos honorários.", "why": "O contrato deixa o percentual em branco."}], "answers": ["30% do proveito econômico"]}]'::jsonb,
  'the marking reads what the document was sent as and every round asked and answered, never who answered'
);
select ok(
  pg_temp.got('fee_asks_again', 'code') = 'asking'
  and (select rounds = 2 from public.template_imports where id = pg_temp.got('asked_fee', 'import_id')::uuid),
  'a second round may ask again'
);

select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_answers', public.answer_template_import(pg_temp.got('asked_fee', 'import_id')::uuid, '["10 dias"]'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('fee_last_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_fee', 'import_id')::uuid)));
insert into res values ('fee_last_work', public.template_import_to_work(pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.got('fee_last_claim', 'claim')::integer));
insert into res values ('fee_ready', public.record_template_import(pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.got('fee_last_claim', 'claim')::integer, 'ready', null,
  pg_temp.ran('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_fee', 'import_id')::uuid,
    pg_temp.answer(jsonb_build_object('documento', 'contrato', 'nome', 'Contrato de honorários do escritório',
      'perguntas', jsonb_build_array(jsonb_build_object('pergunta', 'Qual é a cidade do foro do contrato?', 'motivo', 'Em branco.')),
      'pessoas', jsonb_build_array('MARIA TESTE'),
      'trocas', jsonb_build_array(
        jsonb_build_object('de', 2, 'ate', 2, 'motivo', 'o cliente', 'texto', 'CONTRATANTE: [[CONTRATANTE]].'),
        jsonb_build_object('de', 4, 'ate', 4, 'motivo', 'o percentual dos honorários, como o escritório respondeu',
          'texto', 'HONORÁRIOS: 30% do proveito econômico, pagos em 10 dias.'),
        jsonb_build_object('de', 5, 'ate', 5, 'motivo', 'o local e a data', 'texto', '[[LOCAL_DATA]].')))))));
reset role;
insert into res select 'fee_ready_row', jsonb_build_object('status', status, 'rounds', rounds, 'notes', proposal -> 'notes')
from public.template_imports where id = pg_temp.got('asked_fee', 'import_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('fee_save_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_fee', 'import_id')::uuid)));
insert into res values ('fee_save_work', public.template_import_to_work(pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.got('fee_save_claim', 'claim')::integer));
insert into res values ('fee_review', public.record_template_import(pg_temp.got('asked_fee', 'import_id')::uuid,
  pg_temp.got('fee_save_claim', 'claim')::integer, 'review', null, null, 'notes'));
reset role;

select ok(
  pg_temp.got('fee_last_work', 'last_round') = 'true'
  and jsonb_array_length((select payload -> 'exchanges' from res where name = 'fee_last_work')) = 2
  and pg_temp.got('fee_ready', 'code') = 'saving'
  and pg_temp.got('fee_ready_row', 'status') = 'saving' and pg_temp.got('fee_ready_row', 'rounds') = '2'
  and (select payload -> 'notes' from res where name = 'fee_ready_row') = '["Qual é a cidade do foro do contrato?"]'::jsonb,
  'the last round asks nothing more: a question still open is said among what to check, and ONE owes the save'
);
select ok(
  pg_temp.got('fee_save_work', 'work') = 'saving'
  and pg_temp.got('fee_save_work', 'body') = E'CONTRATO DE HONORÁRIOS\n\nCONTRATANTE: [[CONTRATANTE]].\n\nCONTRATADO: Souza Advogados.\n\nHONORÁRIOS: 30% do proveito econômico, pagos em 10 dias.\n\n[[LOCAL_DATA]].'
  and (select payload -> 'notes' from res where name = 'fee_save_work') = '["Qual é a cidade do foro do contrato?"]'::jsonb
  and pg_temp.got('fee_review', 'code') = 'ready'
  and (select status = 'ready' and held_reason = 'notes' from public.template_imports
       where id = pg_temp.got('asked_fee', 'import_id')::uuid),
  'the save is handed the text the database writes and what to check; something to check keeps it for a person'
);

-- ---------- ONE saves the firm's model ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('proc_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked_proc', 'import_id')::uuid,
  (select payload -> 'paragraphs' from res where name = 'procuracao'))));
insert into res values ('proc_ready', pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_proc', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer')));
-- The worker before 0079 claims with two arguments: it never takes a save.
insert into res values ('old_claim', jsonb_build_object('claims', public.claim_template_imports(1, pg_temp.got('asked_proc', 'import_id')::uuid)));
insert into res values ('proc_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_proc', 'import_id')::uuid)));
insert into res values ('proc_work', public.template_import_to_work(pg_temp.got('asked_proc', 'import_id')::uuid,
  pg_temp.got('proc_claim', 'claim')::integer));
insert into res values ('proc_other_text', public.record_template_import(pg_temp.got('asked_proc', 'import_id')::uuid,
  pg_temp.got('proc_claim', 'claim')::integer, 'saved', null, null, null, pg_temp.hash('outro texto qualquer')));
insert into res values ('proc_saved', public.record_template_import(pg_temp.got('asked_proc', 'import_id')::uuid,
  pg_temp.got('proc_claim', 'claim')::integer, 'saved', null, null, null, pg_temp.hash(pg_temp.got('proc_work', 'body'))));
reset role;

select ok(
  pg_temp.got('proc_ready', 'code') = 'saving'
  and (select payload -> 'claims' from res where name = 'old_claim') = '[]'::jsonb,
  'where the firm lets ONE, what it prepared is ONE''s to save, which the worker before this one never claims'
);
select ok(
  pg_temp.got('proc_other_text', 'code') = 'body_changed'
  and pg_temp.got('proc_saved', 'code') = 'saved',
  'ONE saves only the very text the backend checked'
);
select ok(
  (select t.name = 'Procuração do escritório' and t.document_kind = 'procuracao' and t.is_default and t.prepared_by_one
     and t.created_by = 'a8200000-0000-4000-8000-000000000002' and t.updated_by is null
     and t.body = E'PROCURAÇÃO\n\nOUTORGANTE: [[OUTORGANTE]].\n\nOUTORGADOS: os advogados do escritório.\n\nPODERES: os da cláusula ad judicia et extra.\n\n[[LOCAL_DATA]].'
   from public.draft_templates t where t.id = pg_temp.got('proc_saved', 'template_id')::uuid
     and t.org_id = 'b8200000-0000-4000-8000-00000000000a'),
  'the model is the firm''s, said as prepared by ONE, the default of its paper, made from what the lawyer sent'
);
select ok(
  (select status = 'saved' and saved_template_id = pg_temp.got('proc_saved', 'template_id')::uuid and saved_at is not null
     and paragraphs is not null and proposal is not null and claimed_at is null
   from public.template_imports where id = pg_temp.got('asked_proc', 'import_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'library.import_saved_by_one'
              and entity_id = pg_temp.got('asked_proc', 'import_id'))
  and exists (select 1 from public.audit_events where action = 'drafts.template_saved'
              and entity_id = pg_temp.got('proc_saved', 'template_id') and actor_id is null
              and metadata ->> 'by_one' = 'true'),
  'the request keeps what ONE changed for a person to read, and the save is on the record as ONE''s'
);

-- A second power of attorney under the same name takes the next one, and the place of the default.
insert into res values ('proc2_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked_proc2', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('proc2_file', 'id')::uuid, 'procuracao', true));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('proc2_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked_proc2', 'import_id')::uuid,
  (select payload -> 'paragraphs' from res where name = 'procuracao'))));
insert into res values ('proc2_ready', pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_proc2', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer') || '{"pessoas": ["MARIA TESTE", "x"]}'));
insert into res values ('proc2_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_proc2', 'import_id')::uuid)));
insert into res values ('proc2_work', public.template_import_to_work(pg_temp.got('asked_proc2', 'import_id')::uuid,
  pg_temp.got('proc2_claim', 'claim')::integer));
insert into res values ('proc2_saved', public.record_template_import(pg_temp.got('asked_proc2', 'import_id')::uuid,
  pg_temp.got('proc2_claim', 'claim')::integer, 'saved', null, null, null, pg_temp.hash(pg_temp.got('proc2_work', 'body'))));
reset role;

select ok(
  pg_temp.got('proc2_saved', 'code') = 'saved'
  and (select name = 'Procuração do escritório (2)' and is_default from public.draft_templates
       where id = pg_temp.got('proc2_saved', 'template_id')::uuid)
  and (select not is_default from public.draft_templates where id = pg_temp.got('proc_saved', 'template_id')::uuid),
  'a name the firm already has is taken as the next one, and the new power of attorney is the one ONE sends'
);

-- A person saves the model ONE prepared: it is then the person's.
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_saves', public.save_draft_template('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('proc2_saved', 'template_id')::uuid,
  jsonb_build_object('name', 'Procuração do escritório (2)', 'document_kind', 'procuracao', 'is_default', true,
    'body', E'PROCURAÇÃO\n\nOUTORGANTE: [[OUTORGANTE]], conferida pela Ana.')));
reset role;
select ok(
  pg_temp.got('ana_saves', 'code') = 'saved'
  and (select not prepared_by_one and updated_by = 'a8200000-0000-4000-8000-000000000001'
       from public.draft_templates where id = pg_temp.got('proc2_saved', 'template_id')::uuid),
  'a model a person saved is the person''s, no longer said as prepared by ONE'
);

-- ---------- Sent with no paper named ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('free_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked_free', 'import_id')::uuid,
  (select payload -> 'paragraphs' from res where name = 'procuracao'))));
insert into res values ('free_ready', pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_free', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer') || '{"nome": "Procuração geral"}'));
insert into res values ('free_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_free', 'import_id')::uuid)));
insert into res values ('free_work', public.template_import_to_work(pg_temp.got('asked_free', 'import_id')::uuid,
  pg_temp.got('free_claim', 'claim')::integer));
insert into res values ('free_saved', public.record_template_import(pg_temp.got('asked_free', 'import_id')::uuid,
  pg_temp.got('free_claim', 'claim')::integer, 'saved', null, null, null, pg_temp.hash(pg_temp.got('free_work', 'body'))));
reset role;
select ok(
  pg_temp.got('free_saved', 'code') = 'saved'
  and (select not is_default and prepared_by_one from public.draft_templates
       where id = pg_temp.got('free_saved', 'template_id')::uuid),
  'a document sent with no paper named becomes a model of the firm, never the default over the one the firm has'
);

-- ---------- The firm changed its mind, the library is full ----------

insert into res values ('mind_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
insert into res values ('full_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked_mind', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('mind_file', 'id')::uuid, 'procuracao'));
insert into res values ('asked_full', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('full_file', 'id')::uuid, 'procuracao'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.read(pg_temp.got('asked_mind', 'import_id')::uuid, (select payload -> 'paragraphs' from res where name = 'procuracao'));
select pg_temp.read(pg_temp.got('asked_full', 'import_id')::uuid, (select payload -> 'paragraphs' from res where name = 'procuracao'));
select pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_mind', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer'));
select pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_full', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer'));
insert into res values ('mind_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_mind', 'import_id')::uuid)));
insert into res values ('mind_work', public.template_import_to_work(pg_temp.got('asked_mind', 'import_id')::uuid,
  pg_temp.got('mind_claim', 'claim')::integer));
insert into res values ('full_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_full', 'import_id')::uuid)));
insert into res values ('full_work', public.template_import_to_work(pg_temp.got('asked_full', 'import_id')::uuid,
  pg_temp.got('full_claim', 'claim')::integer));
reset role;
-- Meanwhile a partner keeps the models to a person, and the library is set to the models the firm has.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b8200000-0000-4000-8000-00000000000a', 'model_from_document', 'approval');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('mind_saved', public.record_template_import(pg_temp.got('asked_mind', 'import_id')::uuid,
  pg_temp.got('mind_claim', 'claim')::integer, 'saved', null, null, null, pg_temp.hash(pg_temp.got('mind_work', 'body'))));
reset role;
delete from public.firm_autonomy where org_id = 'b8200000-0000-4000-8000-00000000000a';
update public.platform_settings
set value = value || jsonb_build_object('max_templates',
  (select count(*) from public.draft_templates where org_id = 'b8200000-0000-4000-8000-00000000000a'))
where key = 'drafts';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('full_saved', public.record_template_import(pg_temp.got('asked_full', 'import_id')::uuid,
  pg_temp.got('full_claim', 'claim')::integer, 'saved', null, null, null, pg_temp.hash(pg_temp.got('full_work', 'body'))));
reset role;

select ok(
  pg_temp.got('mind_saved', 'code') = 'ready'
  and (select status = 'ready' and held_reason = 'autonomy' from public.template_imports
       where id = pg_temp.got('asked_mind', 'import_id')::uuid),
  'a firm that keeps the models to a person since the marking has the model wait for one'
);
select ok(
  pg_temp.got('full_saved', 'code') = 'ready'
  and (select status = 'ready' and held_reason = 'library_full' and saved_template_id is null
       from public.template_imports where id = pg_temp.got('asked_full', 'import_id')::uuid),
  'a full library has the model wait for a person, with why'
);

-- ---------- A save that keeps failing ----------

insert into res values ('stuck_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked_stuck', public.request_template_import('b8200000-0000-4000-8000-00000000000a',
  pg_temp.got('stuck_file', 'id')::uuid, 'procuracao'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.read(pg_temp.got('asked_stuck', 'import_id')::uuid, (select payload -> 'paragraphs' from res where name = 'procuracao'));
select pg_temp.mark('b8200000-0000-4000-8000-00000000000a', pg_temp.got('asked_stuck', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer'));
reset role;
update public.template_imports set attempts = 3, claimed_at = now() - interval '1 hour'
where id = pg_temp.got('asked_stuck', 'import_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stuck_old', jsonb_build_object('claims', public.claim_template_imports(1, null)));
reset role;
insert into res select 'stuck_after_old', jsonb_build_object('status', status)
from public.template_imports where id = pg_temp.got('asked_stuck', 'import_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stuck_new', jsonb_build_object('claims', public.claim_template_imports(1, null, true)));
reset role;

select ok(
  pg_temp.got('stuck_after_old', 'status') = 'saving'
  and (select status = 'ready' and held_reason = 'not_saved' and proposal is not null
       from public.template_imports where id = pg_temp.got('asked_stuck', 'import_id')::uuid),
  'a save whose tries ran out waits for a person with what ONE prepared, and only the worker that saves says so'
);

-- ---------- A firm that keeps it to a person ----------

insert into res values ('caio_file', jsonb_build_object('id', pg_temp.sent('b8200000-0000-4000-8000-00000000000b', 'a8200000-0000-4000-8000-000000000004')));
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('asked_caio', public.request_template_import('b8200000-0000-4000-8000-00000000000b',
  pg_temp.got('caio_file', 'id')::uuid, 'procuracao', true));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.read(pg_temp.got('asked_caio', 'import_id')::uuid, (select payload -> 'paragraphs' from res where name = 'procuracao'));
insert into res values ('caio_ready', pg_temp.mark('b8200000-0000-4000-8000-00000000000b', pg_temp.got('asked_caio', 'import_id')::uuid,
  (select payload from res where name = 'proc_answer')));
reset role;
select ok(
  pg_temp.got('caio_ready', 'code') = 'ready'
  and (select status = 'ready' and held_reason = 'autonomy' from public.template_imports
       where id = pg_temp.got('asked_caio', 'import_id')::uuid)
  and not exists (select 1 from public.draft_templates where org_id = 'b8200000-0000-4000-8000-00000000000b'),
  'a firm that keeps the models to a person has what ONE prepared wait for one, and nothing saved'
);

-- ---------- Who reads it ----------

select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
select is_empty(
  $$select id from public.template_imports where org_id = 'b8200000-0000-4000-8000-00000000000a'$$,
  'another firm reads nothing of what ONE asks, refuses or saves for this one'
);
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000003');
set local role authenticated;
select is_empty(
  $$select id from public.template_imports where org_id = 'b8200000-0000-4000-8000-00000000000a'$$,
  'who does not write the firm''s models reads none of it'
);
select ok(
  (select prepared_by_one from public.draft_templates where id = pg_temp.got('free_saved', 'template_id')::uuid),
  'anybody of the firm reads that a model was prepared by ONE'
);
reset role;

-- ---------- The catalog ----------

select ok(
  (select modes = array['auto', 'approval'] and default_mode = 'auto' and task is null
   from public.autonomy_decisions where key = 'model_from_document')
  and public.firm_autonomy_mode('b8200000-0000-4000-8000-00000000000a', 'model_from_document') = 'auto'
  and public.firm_autonomy_mode('b8200000-0000-4000-8000-00000000000b', 'model_from_document') = 'approval',
  'ONE saves the models by default, and each firm may keep them to a person'
);
select ok(
  (select is_active and output_schema -> 'required' ->> 0 = 'documento'
     and output_schema -> 'properties' ? 'faltas' and output_schema -> 'properties' ? 'perguntas'
   from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and version = 2)
  and (select count(*) = 1 from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and is_active),
  'the marking in force checks the document first, and asks'
);
select ok(
  not has_function_privilege('authenticated', 'public.draft_template_write(uuid, uuid, uuid, jsonb, boolean, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.template_import_save_as_one(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_template_import(uuid, integer, text, jsonb, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.answer_template_import(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.answer_template_import(uuid, jsonb)', 'execute'),
  'only a person''s answer and request are a member''s to call; ONE''s save is the backend''s'
);

select * from finish();
rollback;
