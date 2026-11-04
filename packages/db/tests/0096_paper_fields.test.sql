begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- The firm's own power of attorney and contract keep what the firm wrote
-- (0093): a model names the client's data field by field and ONE fills each
-- when it issues the paper, with a line for the minors the client represents
-- that goes when there are none; a change of the marking replaces only some
-- words of a paragraph, each found in it; the firm's own data stay as the firm
-- wrote them once it answered, and the check of a model ONE saves is handed
-- those paragraphs; and a lawyer who signs a lawsuit and is not named in the
-- client's power of attorney is said on the case. Two firms.
--
-- Every person, firm, registration and fact here is invented; the CPFs are the
-- ones every manual uses as examples, and so is the CNPJ.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-campos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a9600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-campos.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a9600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-campos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-campos', 'a9600000-0000-4000-8000-000000000001'),
  ('b9600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-campos', 'a9600000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9600000-0000-4000-8000-00000000000a', 'a9600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9600000-0000-4000-8000-00000000000a', 'a9600000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b9600000-0000-4000-8000-00000000000b', 'a9600000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a9600000-0000-4000-8000-000000000001', 'RJ', '123456'),
  ('a9600000-0000-4000-8000-000000000002', 'GO', '54321');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- Today on the platform's calendar, as a paper is dated.
create function pg_temp.today_written() returns text language sql as $$
  select extract(day from d)::integer || ' de ' || (array['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'])[extract(month from d)::integer]
    || ' de ' || extract(year from d)::integer
  from (select (now() at time zone 'America/Sao_Paulo')::date as d) today;
$$;
-- A Word file a person sent for a model, as the backend kept it.
create function pg_temp.sent(firm uuid, who uuid) returns uuid language plpgsql as $$
declare
  file uuid := gen_random_uuid();
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, uploaded_by, expires_at, confirmed_at)
  values (file, firm, 'model_source', 'org/' || firm || '/model_source/' || file, 'Procuração do escritório',
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
create function pg_temp.read(import uuid, paragraphs jsonb) returns text language sql as $$
  select public.record_template_import(import, pg_temp.claim(import), 'read', paragraphs) ->> 'code';
$$;
create function pg_temp.mark(firm uuid, import uuid, answer jsonb) returns jsonb language sql as $$
  select public.record_template_import(import, pg_temp.claim(import), 'ready', null, pg_temp.ran(firm, import, answer));
$$;
-- An answer of the marking's third version, the parts this file does not look at filled in.
create function pg_temp.answer(fields jsonb) returns jsonb language sql as $$
  select jsonb_build_object('documento', 'procuracao', 'o_que_e', 'uma procuração', 'faltas', '[]'::jsonb,
    'perguntas', '[]'::jsonb, 'tipo_de_processo', 'ambos', 'nome', 'Procuração do escritório', 'trocas', '[]'::jsonb,
    'paragrafos_do_escritorio', '[]'::jsonb, 'pessoas', '[]'::jsonb, 'observacoes', '[]'::jsonb) || fields;
$$;
-- A paper of a case issued from a model: its PDF, its document and its record (as ONE keeps them).
create function pg_temp.issued(firm uuid, the_case uuid, person uuid, template uuid) returns void language plpgsql as $$
declare
  file uuid := gen_random_uuid();
  document uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, expires_at, confirmed_at)
  values (file, firm, 'paper', 'org/' || firm || '/paper/' || file, 'Procuração', 'application/pdf', 1000, 'stored',
          repeat('a', 64), 1000, 'application/pdf', now() + interval '1 hour', now());
  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at)
  values (firm, the_case, file, 'power_of_attorney', 'firm', 'accepted', now())
  returning id into document;
  insert into public.case_papers (org_id, case_id, person_id, kind, template_id, document_id)
  values (firm, the_case, person, 'procuracao', template, document);
end;
$$;

-- ---------- The client's data, field by field ----------

select pg_temp.sign_in('a9600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('mariana', public.create_case('b9600000-0000-4000-8000-00000000000a', 'cancellation', 'LA',
  date '2026-10-24', '{"full_name": "Mariana Teste", "cpf": "12345678909"}'::jsonb));
reset role;
select pg_temp.sign_in('a9600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('pedro', public.create_case('b9600000-0000-4000-8000-00000000000b', 'delay', 'AD',
  date '2026-10-24', '{"full_name": "Pedro Teste", "cpf": "11144477735"}'::jsonb));
reset role;

update public.people
set nationality = 'brasileira', marital_status = 'casado', profession = 'analista', birth_date = date '1990-05-10',
    street = 'Rua das Flores', address_number = '10', complement = 'apto 2', district = 'Centro', city = 'Goiânia',
    uf = 'GO', postal_code = '74000000', email = 'mariana@teste.invalid', phone = '5562999990000'
where id = pg_temp.got('mariana', 'person_id')::uuid;
-- Her daughter, a claimant of the case she answers for.
insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('c9600000-0000-4000-8000-0000000000a1', 'b9600000-0000-4000-8000-00000000000a', 'Lia Teste', '52998224725', date '2015-03-01');
insert into public.case_parties (org_id, case_id, person_id, role, guardian_id)
select 'b9600000-0000-4000-8000-00000000000a', pg_temp.got('mariana', 'case_id')::uuid,
       'c9600000-0000-4000-8000-0000000000a1', 'claimant', g.id
from public.case_parties g
where g.case_id = pg_temp.got('mariana', 'case_id')::uuid and g.person_id = pg_temp.got('mariana', 'person_id')::uuid;

insert into res values ('form', jsonb_build_object('body',
  E'Nome: [[NOME]]\nNacionalidade: [[NACIONALIDADE]]\nEstado civil: [[ESTADO_CIVIL]]\nProfissão: [[PROFISSAO]]\nCPF: [[CPF]]\nNascimento: [[NASCIMENTO]]\nEndereço: [[ENDERECO]]\nCEP: [[CEP]]\nE-mail: [[EMAIL]]\nTelefone: [[TELEFONE]]\n\n[[REPRESENTADOS]]\n\nGoiânia, [[DATA]].'));

select is(
  public.case_paper_filled(pg_temp.got('mariana', 'case_id')::uuid, pg_temp.got('mariana', 'person_id')::uuid,
    pg_temp.got('form', 'body')),
  E'Nome: Mariana Teste\nNacionalidade: brasileira\nEstado civil: casado(a)\nProfissão: analista\nCPF: 123.456.789-09\nNascimento: 10/05/1990\nEndereço: Rua das Flores, nº 10, apto 2, Centro, Goiânia/GO\nCEP: 74000-000\nE-mail: mariana@teste.invalid\nTelefone: (62) 99999-0000\n\nNeste ato, como representante legal de LIA TESTE, menor, com nascimento em 01/03/2015, CPF nº 529.982.247-25.\n\nGoiânia, ' || pg_temp.today_written() || '.',
  'a model that writes the client''s data field by field has each filled, the minor she represents said on its line, and today written out'
);
select is(
  public.case_paper_filled(pg_temp.got('pedro', 'case_id')::uuid, pg_temp.got('pedro', 'person_id')::uuid,
    E'Nome: [[NOME]]\nNacionalidade: [[NACIONALIDADE]]\nE-mail: [[EMAIL]]\nTelefone: [[TELEFONE]]\n\n[[REPRESENTADOS]]\n\nAssinatura'),
  E'Nome: Pedro Teste\nNacionalidade: [COMPLETAR: nacionalidade de Pedro Teste]\nE-mail: não informado\nTelefone: não informado\n\nAssinatura',
  'in the other firm, what is not on record keeps the paper from being issued, an e-mail or a telephone is said as not given, and the line of the minors goes with no minor'
);

-- ---------- A change of some words of a paragraph ----------

insert into res values ('paragraphs', jsonb_build_object('list', jsonb_build_array(
  'PROCURAÇÃO',
  'Nome: {{NOME COMPLETO}}',
  'CPF: {{CPF}}',
  'Pelo presente instrumento, nomeia a sociedade SOUZA ADVOGADOS, CNPJ 11.222.333/0001-81, e a advogada ANA SOUZA, OAB/RJ 123.456, com escritório na Rua A, CEP 74000-000, contra {{EMPRESA}}.',
  'Goiânia, {{DIA}} de {{MÊS}} de {{ANO}}.')));
insert into res values ('v3', pg_temp.answer(jsonb_build_object(
  'trocas', jsonb_build_array(
    jsonb_build_object('de', 2, 'ate', 2, 'motivo', 'o nome do cliente', 'texto', '',
      'trechos', jsonb_build_array(jsonb_build_object('antes', '{{NOME COMPLETO}}', 'depois', '[[NOME]]'))),
    jsonb_build_object('de', 3, 'ate', 3, 'motivo', 'o CPF do cliente', 'texto', '',
      'trechos', jsonb_build_array(jsonb_build_object('antes', '{{CPF}}', 'depois', E'[[CPF]]\n\n[[REPRESENTADOS]]'))),
    jsonb_build_object('de', 4, 'ate', 4, 'motivo', 'a companhia', 'texto', '',
      'trechos', jsonb_build_array(jsonb_build_object('antes', '{{EMPRESA}}', 'depois', '[[RE]]'))),
    jsonb_build_object('de', 5, 'ate', 5, 'motivo', 'a data', 'texto', '',
      'trechos', jsonb_build_array(jsonb_build_object('antes', '{{DIA}} de {{MÊS}} de {{ANO}}', 'depois', '[[DATA]]')))),
  'paragrafos_do_escritorio', jsonb_build_array(4, 9))));
insert into res values ('kept', public.template_import_proposal((select payload from res where name = 'v3'),
  (select payload -> 'list' from res where name = 'paragraphs')));

select ok(
  (select payload -> 'firm_paragraphs' from res where name = 'kept') = '[4]'::jsonb
  and (select payload -> 'changes' -> 2 -> 'pieces' from res where name = 'kept')
      = '[{"before": "{{EMPRESA}}", "after": "[[RE]]"}]'::jsonb
  and public.template_import_body((select payload -> 'list' from res where name = 'paragraphs'),
        (select payload -> 'changes' from res where name = 'kept'))
      = E'PROCURAÇÃO\n\nNome: [[NOME]]\n\nCPF: [[CPF]]\n\n[[REPRESENTADOS]]\n\nPelo presente instrumento, nomeia a sociedade SOUZA ADVOGADOS, CNPJ 11.222.333/0001-81, e a advogada ANA SOUZA, OAB/RJ 123.456, com escritório na Rua A, CEP 74000-000, contra [[RE]].\n\nGoiânia, [[DATA]].',
  'a change of some words replaces only them: the firm''s data in the same paragraph stay as written, and the firm''s paragraphs are the ones the text has'
);
select ok(
  public.template_import_proposal(pg_temp.answer(jsonb_build_object('trocas', jsonb_build_array(
      jsonb_build_object('de', 2, 'ate', 2, 'motivo', 'o nome', 'texto', '',
        'trechos', jsonb_build_array(jsonb_build_object('antes', '{{NOME}}', 'depois', '[[NOME]]')))))),
    (select payload -> 'list' from res where name = 'paragraphs')) is null
  and public.template_import_proposal(pg_temp.answer(jsonb_build_object('trocas', jsonb_build_array(
      jsonb_build_object('de', 2, 'ate', 3, 'motivo', 'o cliente', 'texto', '',
        'trechos', jsonb_build_array(jsonb_build_object('antes', '{{CPF}}', 'depois', '[[CPF]]')))))),
    (select payload -> 'list' from res where name = 'paragraphs')) is null,
  'a piece whose words the paragraph does not have, or one over two paragraphs, makes the answer unusable'
);
select ok(
  public.template_import_proposal(pg_temp.answer(jsonb_build_object('trocas', jsonb_build_array(
      jsonb_build_object('de', 4, 'ate', 4, 'motivo', 'o escritório', 'texto', '',
        'trechos', jsonb_build_array(jsonb_build_object('antes', 'CEP 74000-000', 'depois', 'CEP [CEP]')))))),
    (select payload -> 'list' from res where name = 'paragraphs')) is null
  and public.template_import_proposal(pg_temp.answer(jsonb_build_object('trocas', jsonb_build_array(
      jsonb_build_object('de', 3, 'ate', 3, 'motivo', 'o CPF', 'texto', 'CPF: [CPF]', 'trechos', '[]'::jsonb)))),
    (select payload -> 'list' from res where name = 'paragraphs')) is null,
  'what the reading took out of somebody''s data never goes into the model, as a piece or as a whole paragraph'
);
select ok(
  public.template_import_firm_texts((select payload -> 'list' from res where name = 'paragraphs'),
    (select payload from res where name = 'kept'), '[]'::jsonb) = '[]'::jsonb
  and public.template_import_firm_texts((select payload -> 'list' from res where name = 'paragraphs'),
    (select payload from res where name = 'kept'),
    '[{"questions": [{"question": "São do escritório?", "why": "O documento nomeia advogados."}], "answers": [""]}]'::jsonb) = '[]'::jsonb
  and public.template_import_firm_texts((select payload -> 'list' from res where name = 'paragraphs'),
    (select payload from res where name = 'kept'),
    '[{"questions": [{"question": "São do escritório?", "why": "O documento nomeia advogados."}], "answers": ["Sim"]}]'::jsonb)
    = jsonb_build_array((select payload -> 'list' ->> 3 from res where name = 'paragraphs')),
  'the firm''s own paragraphs count only once the firm answered a round of questions'
);

-- ---------- From the firm's document to the model ONE saves ----------

insert into res values ('asked_file', jsonb_build_object('id', pg_temp.sent('b9600000-0000-4000-8000-00000000000a', 'a9600000-0000-4000-8000-000000000002')));
insert into res values ('unasked_file', jsonb_build_object('id', pg_temp.sent('b9600000-0000-4000-8000-00000000000a', 'a9600000-0000-4000-8000-000000000002')));
select pg_temp.sign_in('a9600000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked', public.request_template_import('b9600000-0000-4000-8000-00000000000a',
  pg_temp.got('asked_file', 'id')::uuid, 'procuracao', true));
insert into res values ('unasked', public.request_template_import('b9600000-0000-4000-8000-00000000000a',
  pg_temp.got('unasked_file', 'id')::uuid, 'procuracao', false));
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('asked_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('asked', 'import_id')::uuid,
  (select payload -> 'list' from res where name = 'paragraphs'))));
insert into res values ('asked_asking', pg_temp.mark('b9600000-0000-4000-8000-00000000000a', pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.answer(jsonb_build_object('perguntas', jsonb_build_array(jsonb_build_object(
    'pergunta', 'A sociedade e a advogada nomeadas são as do escritório em todos os casos novos?',
    'motivo', 'O documento nomeia a sociedade e a advogada.'))))));
insert into res values ('unasked_read', jsonb_build_object('code', pg_temp.read(pg_temp.got('unasked', 'import_id')::uuid,
  (select payload -> 'list' from res where name = 'paragraphs'))));
insert into res values ('unasked_ready', pg_temp.mark('b9600000-0000-4000-8000-00000000000a', pg_temp.got('unasked', 'import_id')::uuid,
  (select payload from res where name = 'v3')));
reset role;

select pg_temp.sign_in('a9600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('answered', public.answer_template_import(pg_temp.got('asked', 'import_id')::uuid, '["Sim"]'));
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('asked_ready', pg_temp.mark('b9600000-0000-4000-8000-00000000000a', pg_temp.got('asked', 'import_id')::uuid,
  (select payload from res where name = 'v3')));
insert into res values ('asked_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('asked', 'import_id')::uuid)));
insert into res values ('asked_work', public.template_import_to_work(pg_temp.got('asked', 'import_id')::uuid,
  pg_temp.got('asked_claim', 'claim')::integer));
insert into res values ('unasked_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('unasked', 'import_id')::uuid)));
insert into res values ('unasked_work', public.template_import_to_work(pg_temp.got('unasked', 'import_id')::uuid,
  pg_temp.got('unasked_claim', 'claim')::integer));
reset role;

select ok(
  pg_temp.got('asked_asking', 'code') = 'asking' and pg_temp.got('answered', 'code') = 'answered'
  and pg_temp.got('asked_ready', 'code') = 'saving'
  and pg_temp.got('asked_work', 'work') = 'saving'
  and pg_temp.got('asked_work', 'body') = public.template_import_body((select payload -> 'list' from res where name = 'paragraphs'),
        (select payload -> 'changes' from res where name = 'kept'))
  and (select payload -> 'firm_texts' from res where name = 'asked_work')
      = jsonb_build_array((select payload -> 'list' ->> 3 from res where name = 'paragraphs')),
  'once the firm said the society and the lawyer are its own, the save is handed the model with its data as written, and those paragraphs to tell them from the original case''s'
);
select ok(
  pg_temp.got('unasked_ready', 'code') = 'saving'
  and (select payload -> 'firm_texts' from res where name = 'unasked_work') = '[]'::jsonb,
  'a marking that kept the firm''s data without asking hands the save no paragraph of the firm''s: every identifier is for a person to look at'
);

-- ---------- The lawyers the client's power of attorney names ----------

insert into public.draft_templates (id, org_id, name, document_kind, body)
values ('d9600000-0000-4000-8000-0000000000a1', 'b9600000-0000-4000-8000-00000000000a', 'Procuração do escritório', 'procuracao',
  E'PROCURAÇÃO\n\nNome: [[NOME]]\n\nOUTORGADOS: a advogada ANA SOUZA, inscrita na OAB/RJ sob o nº 123.456, com escritório em Goiânia.\n\nGoiânia, [[DATA]].'),
  ('d9600000-0000-4000-8000-0000000000b1', 'b9600000-0000-4000-8000-00000000000b', 'Procuração da Rocha', 'procuracao',
  E'PROCURAÇÃO\n\n[[OUTORGANTE]]\n\nOUTORGADOS: [[OUTORGADOS]].\n\n[[LOCAL_DATA]].');
select pg_temp.issued('b9600000-0000-4000-8000-00000000000a', pg_temp.got('mariana', 'case_id')::uuid,
  pg_temp.got('mariana', 'person_id')::uuid, 'd9600000-0000-4000-8000-0000000000a1');
select pg_temp.issued('b9600000-0000-4000-8000-00000000000b', pg_temp.got('pedro', 'case_id')::uuid,
  pg_temp.got('pedro', 'person_id')::uuid, 'd9600000-0000-4000-8000-0000000000b1');
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('e9600000-0000-4000-8000-0000000000a1', 'b9600000-0000-4000-8000-00000000000a', pg_temp.got('mariana', 'case_id')::uuid,
   'comum', 'TJGO', 'planned'),
  ('e9600000-0000-4000-8000-0000000000b1', 'b9600000-0000-4000-8000-00000000000b', pg_temp.got('pedro', 'case_id')::uuid,
   'juizado', 'TJGO', 'planned');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('e9600000-0000-4000-8000-0000000000a1', 'a9600000-0000-4000-8000-000000000001', 'b9600000-0000-4000-8000-00000000000a'),
  ('e9600000-0000-4000-8000-0000000000a1', 'a9600000-0000-4000-8000-000000000002', 'b9600000-0000-4000-8000-00000000000a'),
  ('e9600000-0000-4000-8000-0000000000b1', 'a9600000-0000-4000-8000-000000000004', 'b9600000-0000-4000-8000-00000000000b');

select pg_temp.sign_in('a9600000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'souza_missing', coalesce(jsonb_agg(jsonb_build_object('proceeding', m.proceeding_id, 'user', m.user_id,
  'lawyer', m.lawyer)), '[]'::jsonb)
from public.case_power_signers_missing(pg_temp.got('mariana', 'case_id')::uuid) m;
reset role;
select pg_temp.sign_in('a9600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res select 'rocha_reads_souza', jsonb_build_object('rows',
  (select count(*) from public.case_power_signers_missing(pg_temp.got('mariana', 'case_id')::uuid)));
insert into res select 'rocha_missing', jsonb_build_object('rows',
  (select count(*) from public.case_power_signers_missing(pg_temp.got('pedro', 'case_id')::uuid)));
reset role;

select is(
  (select payload from res where name = 'souza_missing'),
  jsonb_build_array(jsonb_build_object('proceeding', 'e9600000-0000-4000-8000-0000000000a1',
    'user', 'a9600000-0000-4000-8000-000000000002', 'lawyer', 'Bia Lima')),
  'a lawyer who signs a lawsuit and whose registration the firm''s own power of attorney does not write is said; the one it writes, however the number is dotted, is not'
);
select ok(
  pg_temp.got('rocha_reads_souza', 'rows') = '0' and pg_temp.got('rocha_missing', 'rows') = '0',
  'nobody of another firm reads it, and a power of attorney that names the firm''s signers by its mark misses nobody'
);

update public.proceedings set status = 'filed', cnj = '00000018820998090001', filed_at = date '2099-01-10'
where id = 'e9600000-0000-4000-8000-0000000000a1';
select pg_temp.sign_in('a9600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'after_filing', jsonb_build_object('rows',
  (select count(*) from public.case_power_signers_missing(pg_temp.got('mariana', 'case_id')::uuid)));
reset role;
select is(pg_temp.got('after_filing', 'rows'), '0', 'a lawsuit already filed is no longer said');

-- ---------- The marking in force, and who calls what ----------

select ok(
  (select output_schema -> 'required' ? 'paragrafos_do_escritorio'
     and output_schema #> '{properties,trocas,items,required}' ? 'trechos'
     and system_prompt like '%[[REPRESENTADOS]]%' and system_prompt like '%[[DATA]]%'
   from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and is_active)
  and (select count(*) = 1 from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and is_active),
  'the marking in force writes the client''s data field by field, keeps the firm''s own data and changes some words of a paragraph'
);
select ok(
  has_function_privilege('authenticated', 'public.case_power_signers_missing(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.case_power_signers_missing(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.template_import_proposal(jsonb, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.template_import_firm_texts(jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.case_paper_filled(uuid, uuid, text)', 'execute'),
  'anybody of a firm reads who its client''s power of attorney leaves out; the rest is the backend''s'
);

select * from finish();
rollback;
