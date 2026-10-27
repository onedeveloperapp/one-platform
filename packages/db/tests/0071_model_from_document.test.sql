begin;
create extension if not exists pgtap;
select plan(27);

-- ============================================================
-- A model of the library made from a document the firm already uses
-- (0067): a partner or a lawyer sends a Word file or a PDF and asks for the
-- model; the backend reads its text (a Word file by itself, a PDF through
-- the transcription, whose answer the database reads from its run) and
-- forgets the file, then the marking says which paragraphs change, kept only
-- when every change names paragraphs that exist, in order and apart; what
-- ONE prepared waits for a person, who saves it as a model of the firm or
-- gives it up. Who reads and who writes; a day's ceiling; the upkeep. Two
-- firms.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-modelos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-modelos.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a7100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@souza-modelos.invalid', '', now(), '{}', '{"display_name":"Duda Reis"}', now(), now()),
  ('a7100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-modelos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b7100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-modelos', 'a7100000-0000-4000-8000-000000000001'),
  ('b7100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-modelos', 'a7100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7100000-0000-4000-8000-00000000000a', 'a7100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7100000-0000-4000-8000-00000000000a', 'a7100000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b7100000-0000-4000-8000-00000000000a', 'a7100000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b7100000-0000-4000-8000-00000000000b', 'a7100000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A document a person sent for a model, as the backend kept it.
create function pg_temp.sent(firm uuid, who uuid, mime text, pages integer default null) returns uuid language plpgsql as $$
declare
  file uuid := gen_random_uuid();
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, uploaded_by, expires_at, confirmed_at)
  values (file, firm, 'model_source', 'org/' || firm || '/model_source/' || file, 'Inicial padrão', mime, 2000, 'stored',
          repeat('d', 64), 2000, mime, pages, who, now() + interval '1 hour', now());
  return file;
end;
$$;
-- What a task answered about a request, as the executor records a run (called as the service role).
create function pg_temp.ran(firm uuid, task text, import uuid, answer jsonb) returns uuid language plpgsql as $$
declare
  started jsonb := public.start_ai_run(firm, task, md5(answer::text) || md5(import::text), null,
    'template_import', import::text, task || ':' || import::text || ':' || md5(answer::text));
begin
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', answer, 900, 120);
  return (started ->> 'run_id')::uuid;
end;
$$;
create function pg_temp.claim(import uuid) returns integer language sql as $$
  select ((public.claim_template_imports(1, import) -> 0) ->> 'claim')::integer;
$$;

insert into res values ('docx', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000002', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')));
insert into res values ('ana_docx', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000001', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')));
insert into res values ('pdf_blank', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000002', 'application/pdf', 2)));
insert into res values ('pdf_doc', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000002', 'application/pdf', 3)));
insert into res values ('pdf_locked', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000002', 'application/pdf', null)));
insert into res values ('pdf_long', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000002', 'application/pdf', 31)));
insert into res values ('one_more', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000a',
  'a7100000-0000-4000-8000-000000000002', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')));
insert into res values ('caio_docx', jsonb_build_object('id', pg_temp.sent('b7100000-0000-4000-8000-00000000000b',
  'a7100000-0000-4000-8000-000000000004', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')));

-- ---------- Sending and asking ----------

select pg_temp.sign_in('a7100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('reserve_word', public.reserve_file_upload('b7100000-0000-4000-8000-00000000000a', 'model_source',
  'Inicial.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 50000));
insert into res values ('reserve_photo', public.reserve_file_upload('b7100000-0000-4000-8000-00000000000a', 'model_source',
  'foto.jpg', 'image/jpeg', 50000));
insert into res values ('asked', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('docx', 'id')::uuid));
insert into res values ('asked_again', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('docx', 'id')::uuid));
insert into res values ('asked_other', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('ana_docx', 'id')::uuid));
insert into res values ('asked_locked', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('pdf_locked', 'id')::uuid));
insert into res values ('asked_long', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('pdf_long', 'id')::uuid));
insert into res values ('asked_blank', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('pdf_blank', 'id')::uuid));
insert into res values ('asked_pdf', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('pdf_doc', 'id')::uuid));
insert into res values ('bia_reads', jsonb_build_object('count',
  (select count(*) from public.template_imports where org_id = 'b7100000-0000-4000-8000-00000000000a')));
reset role;

select ok(
  pg_temp.got('reserve_word', 'code') = 'reserved' and pg_temp.got('reserve_photo', 'code') = 'type_not_allowed',
  'a Word file or a PDF may be sent for a model, and nothing else'
);
select ok(
  pg_temp.got('asked', 'code') = 'requested'
  and (select status = 'reading' and source = 'docx' and file_name = 'Inicial padrão'
       from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid),
  'a lawyer asks for the model of the Word file they sent, and its text is owed'
);
select ok(
  pg_temp.got('asked_again', 'code') = 'file_not_found' and pg_temp.got('asked_other', 'code') = 'file_not_found',
  'a document is asked for once, and only by who sent it'
);
select ok(
  pg_temp.got('asked_locked', 'code') = 'unreadable' and pg_temp.got('asked_long', 'code') = 'too_many_pages'
  and pg_temp.got('asked_long', 'most') = '30',
  'a PDF whose pages could not be counted, or longer than the setting, is refused at once'
);

select pg_temp.sign_in('a7100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('duda_asks', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('docx', 'id')::uuid));
insert into res values ('duda_reads', jsonb_build_object('count', (select count(*) from public.template_imports)));
reset role;
select ok(
  pg_temp.got('duda_asks', 'code') = 'not_allowed' and pg_temp.got('duda_reads', 'count') = '0'
  and pg_temp.got('bia_reads', 'count') = '3',
  'who does not write the firm''s models neither asks for one nor reads what ONE prepares'
);

select pg_temp.sign_in('a7100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.request_template_import('b7100000-0000-4000-8000-00000000000a', (select id from public.files limit 1))$$,
  '42501', 'not_authorized',
  'nobody of another firm asks for a firm''s model'
);
insert into res values ('caio_reads', jsonb_build_object('count', (select count(*) from public.template_imports)));
reset role;
select is(pg_temp.got('caio_reads', 'count'), '0', 'nor reads what ONE prepares for it');

-- ---------- The text of a Word file ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked', 'import_id')::uuid)));
insert into res values ('to_read', public.template_import_to_work(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('read_claim', 'claim')::integer));
insert into res values ('stale', public.record_template_import(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('read_claim', 'claim')::integer + 1, 'read', '["Texto"]'::jsonb));
insert into res values ('read', public.record_template_import(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('read_claim', 'claim')::integer, 'read',
  jsonb_build_array('  EXCELENTÍSSIMO SENHOR JUIZ  ', '', E'MARIA TESTE, brasileira,\r\n  em face de AÉREA EXEMPLO S.A.',
    E'Em 3 de maio a autora\u0007 esperou dez horas.', E'Dá-se à causa o valor de R$ 10.000,00.\n\n\nTermos em que pede deferimento.',
    E'Fulano de Tal\nOAB/XX 00.000')));
reset role;

select ok(
  pg_temp.got('to_read', 'work') = 'reading' and pg_temp.got('to_read', 'source') = 'docx'
  and pg_temp.got('to_read', 'storage_path') like 'org/b7100000-0000-4000-8000-00000000000a/model_source/%'
  and pg_temp.got('stale', 'code') = 'not_held',
  'the backend reads the document it holds the claim of, and a claim that is not the one held records nothing'
);
select ok(
  pg_temp.got('read', 'code') = 'read'
  and pg_temp.got('read', 'storage_path') = pg_temp.got('to_read', 'storage_path')
  and not exists (select 1 from public.files where id = pg_temp.got('docx', 'id')::uuid)
  and (select status = 'marking' and file_id is null and attempts = 0 and paragraphs = jsonb_build_array(
         'EXCELENTÍSSIMO SENHOR JUIZ', E'MARIA TESTE, brasileira,\nem face de AÉREA EXEMPLO S.A.',
         'Em 3 de maio a autora esperou dez horas.', E'Dá-se à causa o valor de R$ 10.000,00.\nTermos em que pede deferimento.',
         E'Fulano de Tal\nOAB/XX 00.000')
       from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid),
  'its text is kept clean, a paragraph per item, and the file is forgotten: the marking is owed'
);

-- ---------- The marking ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('mark_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked', 'import_id')::uuid)));
insert into res values ('to_mark', public.template_import_to_work(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('mark_claim', 'claim')::integer));
-- An answer of another task, or about another request, is no answer of this marking.
insert into res values ('foreign', public.record_template_import(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('mark_claim', 'claim')::integer, 'ready', null,
  pg_temp.ran('b7100000-0000-4000-8000-00000000000a', 'biblioteca.modelo.marcacao',
    pg_temp.got('asked_pdf', 'import_id')::uuid, '{"documento": "peca", "trocas": []}')));
-- Two changes over the same paragraph would leave the original case where nobody looks.
insert into res values ('overlap', public.record_template_import(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('mark_claim', 'claim')::integer, 'ready', null,
  pg_temp.ran('b7100000-0000-4000-8000-00000000000a', 'biblioteca.modelo.marcacao', pg_temp.got('asked', 'import_id')::uuid,
    '{"documento": "peca", "tipo_de_processo": "juizado", "nome": "x", "pessoas": [], "observacoes": [],
      "trocas": [{"de": 2, "ate": 3, "motivo": "a", "texto": "[[PARTES]]"}, {"de": 3, "ate": 3, "motivo": "b", "texto": ""}]}')));
insert into res values ('after_overlap', public.template_import_to_work(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('mark_claim', 'claim')::integer));
reset role;
insert into res select 'overlap_row', jsonb_build_object('status', status, 'run_round', run_round)
from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('mark_again', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked', 'import_id')::uuid)));
insert into res values ('ready', public.record_template_import(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('mark_again', 'claim')::integer, 'ready', null,
  pg_temp.ran('b7100000-0000-4000-8000-00000000000a', 'biblioteca.modelo.marcacao', pg_temp.got('asked', 'import_id')::uuid,
    jsonb_build_object('documento', 'peca', 'tipo_de_processo', 'juizado', 'nome', E'Inicial do juizado:\tatraso',
      'pessoas', jsonb_build_array('MARIA TESTE', 'Maria', 7),
      'observacoes', jsonb_build_array('Confira o rol de documentos.', ''),
      'trocas', jsonb_build_array(
        jsonb_build_object('de', 2, 'ate', 2, 'motivo', 'a qualificação das partes', 'texto', '[[PARTES]], em face de [[RE]]'),
        jsonb_build_object('de', 3, 'ate', 3, 'motivo', 'os fatos do caso', 'texto', E'[COMPLETAR: narrar os fatos]\n\n\n\nmais'),
        jsonb_build_object('de', 5, 'ate', 5, 'motivo', 'quem assina', 'texto', '[[ADVOGADOS]]'))))));
reset role;

select ok(
  pg_temp.got('to_mark', 'work') = 'marking'
  and pg_temp.got('to_mark', 'storage_path') is null
  and pg_temp.got('to_mark', 'run_key') = 'library-import:' || pg_temp.got('asked', 'import_id') || ':marking:0'
  and (select payload -> 'paragraphs' from res where name = 'to_mark') ->> 0 = 'EXCELENTÍSSIMO SENHOR JUIZ',
  'the marking reads the paragraphs, and never the file'
);
select is(pg_temp.got('foreign', 'code'), 'run_not_found', 'an answer about another request is not read as this one''s');
select ok(
  pg_temp.got('overlap', 'code') = 'retry'
  and pg_temp.got('after_overlap', 'code') = 'not_held'
  and pg_temp.got('overlap_row', 'status') = 'marking' and pg_temp.got('overlap_row', 'run_round') = '1',
  'an answer whose changes overlap is not kept: another run is asked, under another key'
);
select ok(
  pg_temp.got('ready', 'code') = 'ready'
  and (select status = 'ready' and ready_at is not null and run_id is not null
         and proposal -> 'changes' = jsonb_build_array(
           jsonb_build_object('from', 2, 'to', 2, 'text', '[[PARTES]], em face de [[RE]]', 'reason', 'a qualificação das partes'),
           jsonb_build_object('from', 3, 'to', 3, 'text', E'[COMPLETAR: narrar os fatos]\n\nmais', 'reason', 'os fatos do caso'),
           jsonb_build_object('from', 5, 'to', 5, 'text', '[[ADVOGADOS]]', 'reason', 'quem assina'))
       from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid),
  'an answer that names paragraphs that exist, in order and apart, is kept as the changes of the model'
);
select ok(
  (select proposal ->> 'document_kind' = 'piece' and proposal ->> 'proceeding_kind' = 'juizado'
     and proposal ->> 'name' = 'Inicial do juizado: atraso'
     and proposal -> 'people' = '["MARIA TESTE", "Maria"]'::jsonb
     and proposal -> 'notes' = '["Confira o rol de documentos."]'::jsonb
   from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid),
  'with what the document is, the name proposed, the people of the original case and what to check'
);

-- ---------- A PDF ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('blank_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_blank', 'import_id')::uuid)));
insert into res values ('blank', public.record_template_import(pg_temp.got('asked_blank', 'import_id')::uuid,
  pg_temp.got('blank_claim', 'claim')::integer, 'read', null,
  pg_temp.ran('b7100000-0000-4000-8000-00000000000a', 'biblioteca.modelo.transcricao', pg_temp.got('asked_blank', 'import_id')::uuid,
    '{"legivel": false, "paragrafos": []}')));
insert into res values ('pdf_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_pdf', 'import_id')::uuid)));
insert into res values ('pdf_read', public.record_template_import(pg_temp.got('asked_pdf', 'import_id')::uuid,
  pg_temp.got('pdf_claim', 'claim')::integer, 'read', '["what the worker says is not read"]'::jsonb,
  pg_temp.ran('b7100000-0000-4000-8000-00000000000a', 'biblioteca.modelo.transcricao', pg_temp.got('asked_pdf', 'import_id')::uuid,
    '{"legivel": true, "paragrafos": ["CONTESTAÇÃO", "A ré contesta."]}')));
reset role;
insert into res select 'pdf_text', jsonb_build_object('paragraphs', paragraphs)
from public.template_imports where id = pg_temp.got('asked_pdf', 'import_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('pdf_mark_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked_pdf', 'import_id')::uuid)));
insert into res values ('pdf_marked', public.record_template_import(pg_temp.got('asked_pdf', 'import_id')::uuid,
  pg_temp.got('pdf_mark_claim', 'claim')::integer, 'ready', null,
  pg_temp.ran('b7100000-0000-4000-8000-00000000000a', 'biblioteca.modelo.marcacao', pg_temp.got('asked_pdf', 'import_id')::uuid,
    '{"documento": "outro", "tipo_de_processo": "ambos", "nome": "Contestação", "trocas": [], "pessoas": [], "observacoes": []}')));
reset role;

select ok(
  pg_temp.got('blank', 'failure') = 'unreadable'
  and (select status = 'failed' and failure = 'unreadable' and paragraphs is null and file_id is null
       from public.template_imports where id = pg_temp.got('asked_blank', 'import_id')::uuid)
  and not exists (select 1 from public.files where id = pg_temp.got('pdf_blank', 'id')::uuid),
  'a PDF the transcription found no text in is said unreadable, and its file is forgotten'
);
select ok(
  pg_temp.got('pdf_read', 'code') = 'read'
  and (select payload -> 'paragraphs' from res where name = 'pdf_text') = '["CONTESTAÇÃO", "A ré contesta."]'::jsonb,
  'the text of a PDF is what its transcription answered, read from the run and never from the worker'
);
select ok(
  pg_temp.got('pdf_marked', 'failure') = 'not_a_model'
  and (select status = 'failed' and paragraphs is null and proposal is null from public.template_imports
       where id = pg_temp.got('asked_pdf', 'import_id')::uuid),
  'a document that is no model ONE uses is said so, and what was read of it goes'
);

-- ---------- Saving ----------

select pg_temp.sign_in('a7100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('caio_saves', public.save_imported_template(pg_temp.got('asked', 'import_id')::uuid,
  '{"name": "Modelo alheio", "document_kind": "piece", "body": "Um texto qualquer com mais de vinte letras."}'));
insert into res values ('caio_dismisses', public.dismiss_template_import(pg_temp.got('asked', 'import_id')::uuid));
reset role;
select pg_temp.sign_in('a7100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('duda_saves', public.save_imported_template(pg_temp.got('asked', 'import_id')::uuid,
  '{"name": "Modelo da Duda", "document_kind": "piece", "body": "Um texto qualquer com mais de vinte letras."}'));
reset role;
select ok(
  pg_temp.got('caio_saves', 'code') = 'not_found' and pg_temp.got('caio_dismisses', 'code') = 'not_found'
  and pg_temp.got('duda_saves', 'code') = 'not_allowed'
  and exists (select 1 from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid and status = 'ready'),
  'nobody of another firm saves or gives up what ONE prepared, and who does not write models saves nothing'
);

select pg_temp.sign_in('a7100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('saved', public.save_imported_template(pg_temp.got('asked', 'import_id')::uuid,
  jsonb_build_object('name', 'Inicial do juizado: atraso', 'document_kind', 'piece', 'proceeding_kind', 'juizado',
    'is_default', false, 'body', E'EXCELENTÍSSIMO SENHOR JUIZ\n\n[[PARTES]], em face de [[RE]]\n\n[COMPLETAR: narrar os fatos]')));
insert into res values ('saved_twice', public.save_imported_template(pg_temp.got('asked', 'import_id')::uuid,
  '{"name": "Outra vez", "document_kind": "piece", "body": "Um texto qualquer com mais de vinte letras."}'));
insert into res values ('dismissed', public.dismiss_template_import(pg_temp.got('asked_pdf', 'import_id')::uuid));
reset role;

select ok(
  pg_temp.got('saved', 'code') = 'saved'
  and (select name = 'Inicial do juizado: atraso' and proceeding_kind = 'juizado' and document_kind = 'piece'
         and body like '%[[PARTES]], em face de [[RE]]%' and created_by = 'a7100000-0000-4000-8000-000000000002'
       from public.draft_templates where id = pg_temp.got('saved', 'template_id')::uuid)
  and not exists (select 1 from public.template_imports where id = pg_temp.got('asked', 'import_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'library.import_saved'
              and entity_id = pg_temp.got('asked', 'import_id')),
  'a lawyer saves what ONE prepared, as they read it, as a model of the firm, and the request goes with what was read'
);
select ok(
  pg_temp.got('saved_twice', 'code') = 'not_found' and pg_temp.got('dismissed', 'code') = 'dismissed'
  and not exists (select 1 from public.template_imports where id = pg_temp.got('asked_pdf', 'import_id')::uuid),
  'a request saved is saved once, and one given up goes'
);

-- ---------- What a day holds, and the upkeep ----------

update public.platform_settings set value = value || '{"per_day": 3}'::jsonb where key = 'template_imports';
select pg_temp.sign_in('a7100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('fourth', public.request_template_import('b7100000-0000-4000-8000-00000000000a',
  pg_temp.got('one_more', 'id')::uuid));
reset role;
select pg_temp.sign_in('a7100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('caio_asks', public.request_template_import('b7100000-0000-4000-8000-00000000000b',
  pg_temp.got('caio_docx', 'id')::uuid));
reset role;
select ok(
  pg_temp.got('fourth', 'code') = 'too_many_today' and pg_temp.got('fourth', 'most') = '3'
  and pg_temp.got('caio_asks', 'code') = 'requested',
  'a firm asks the setting''s requests in a day, counted on the record even of the ones that went; another firm its own'
);

-- A work whose tries ran out, its last claim long gone, is given up by the next claim.
update public.template_imports set attempts = 3, claimed_at = now() - interval '1 hour', claims = 3
where id = pg_temp.got('caio_asks', 'import_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('sweep_claims', jsonb_build_object('items', public.claim_template_imports(5)));
reset role;
select ok(
  (select status = 'failed' and failure = 'gave_up' and file_id is null from public.template_imports
   where id = pg_temp.got('caio_asks', 'import_id')::uuid)
  and not exists (select 1 from public.files where id = pg_temp.got('caio_docx', 'id')::uuid),
  'a work tried the setting''s times and never recorded is given up, its file forgotten'
);

update public.template_imports set created_at = now() - interval '8 days'
where id = pg_temp.got('caio_asks', 'import_id')::uuid;
update public.files set created_at = now() - interval '2 days' where id = pg_temp.got('one_more', 'id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('expired', jsonb_build_object('count', public.expire_template_imports()));
reset role;
select ok(
  pg_temp.got('expired', 'count')::integer >= 1
  and not exists (select 1 from public.template_imports where id = pg_temp.got('caio_asks', 'import_id')::uuid)
  and not exists (select 1 from public.files where id = pg_temp.got('one_more', 'id')::uuid),
  'what waited longer than the setting''s days goes, and so does a document no request names'
);

-- ---------- Who may call the backend's functions ----------

select pg_temp.sign_in('a7100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.claim_template_imports(1, null)$$, '42501', null,
  'a person cannot claim the backend''s work');
select throws_ok(
  $$select public.record_template_import(gen_random_uuid(), 1, 'failed', null, null, 'gave_up')$$, '42501', null,
  'nor record what came of it');
select throws_ok($$select public.expire_template_imports()$$, '42501', null, 'nor run its upkeep');
reset role;

select ok(
  (select count(*) = 2 from public.ai_tasks
   where slug in ('biblioteca.modelo.transcricao', 'biblioteca.modelo.marcacao') and autonomy = 'autonomous' and not shadow)
  and (select count(*) = 2 from public.prompt_versions
       where task in ('biblioteca.modelo.transcricao', 'biblioteca.modelo.marcacao') and is_active),
  'the two tasks decide nothing and have their instructions in force'
);

select * from finish();
rollback;
