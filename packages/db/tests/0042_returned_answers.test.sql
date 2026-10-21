begin;
create extension if not exists pgtap;
select plan(52);

-- ============================================================
-- An answer of the AI sent back with what to change in it (0016, 0026,
-- 0029). The firm's queue has a third decision, for the tasks that read the
-- note: a chronology sent back is proposed again from the proposal and the
-- firm's words, and the text of a piece is rewritten by the AI as a lawyer
-- asked, where it is read, with what identifies a person never handed over
-- and put back in what the AI writes. What comes of it waits for a person
-- like the first answer did. Two firms: nothing of one reaches the other.
--
-- Every person, firm, company, CPF, CNPJ and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('af100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('af100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('af100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@souza.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('af100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('af100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operacao@one.invalid', '', now(), '{}', '{"display_name":"Operação"}', now(), now());
update public.profiles set is_superadmin = true where id = 'af100000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('bf100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'af100000-0000-4000-8000-000000000001'),
  ('bf100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'af100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('bf100000-0000-4000-8000-00000000000b', 'af100000-0000-4000-8000-000000000004', 'owner', 'advogado');
-- Both firms have a person decide each chronology and each piece (0016): an answer is sent back only from the queue.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('bf100000-0000-4000-8000-00000000000a', 'chronology', 'approval'),
  ('bf100000-0000-4000-8000-00000000000a', 'piece_text', 'approval'),
  ('bf100000-0000-4000-8000-00000000000b', 'chronology', 'approval'),
  ('bf100000-0000-4000-8000-00000000000b', 'piece_text', 'approval');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('af100000-0000-4000-8000-000000000001', 'GO', '12345', 'principal'),
  ('af100000-0000-4000-8000-000000000004', 'GO', '99999', 'principal');
update public.airlines set legal_name = 'Companhia Aérea Exemplo S.A.', cnpj = '11222333000181' where iata = 'G3';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A run of the chronology of a statement, finished with an answer (as the service role). Each claim is its own run.
create function pg_temp.ran_statement(org uuid, statement uuid, output jsonb, claim integer) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'caso.relato.cronologia', repeat('f', 64), null, 'case_statement', statement::text,
    'cronologia:' || statement::text || ':' || claim::text);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 900, 400)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- The backend claims one statement.
create function pg_temp.claim_statement(statement uuid) returns integer language plpgsql as $$
declare
  claimed integer;
begin
  update public.case_statements set work_after = null where id = statement;
  select c.claim into claimed from public.claim_case_statements(1, statement) c;
  return claimed;
end;
$$;
-- A run of the task about a draft, under the key the database gave its work, finished with an answer.
create function pg_temp.ran_draft(org uuid, draft uuid, key text, output jsonb) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'caso.peca.minuta', repeat('f', 64), null, 'case_draft', draft::text, key);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 3000, 2000)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- The backend claims one draft.
create function pg_temp.claim_draft(draft uuid) returns integer language plpgsql as $$
declare
  claimed integer;
begin
  update public.case_drafts set work_after = null where id = draft;
  select c.claim into claimed from public.claim_case_drafts(1, draft) c;
  return claimed;
end;
$$;
-- The backend reads what the latest text of a draft cites: one article of the consumer code, which the firm verified.
create function pg_temp.read_draft(draft uuid) returns jsonb language plpgsql as $$
declare
  claimed integer := pg_temp.claim_draft(draft);
  latest integer := (select d.version from public.case_drafts d where d.id = draft);
begin
  return public.record_draft_work(draft, claimed, 'checked', null, null, jsonb_build_object(
    'version', latest,
    'citations', '[{"kind": "lei", "issuer": "", "number": "8078", "article": "14", "raw": "art. 14 da Lei nº 8.078"}]'::jsonb,
    'signature', (select jsonb_agg(g order by g) from generate_series(1, 128) g)));
end;
$$;
-- The latest text of a draft, and a lawyer's approval of what the preview showed.
create function pg_temp.body(draft uuid) returns text language sql as
$$ select v.body from public.case_draft_versions v join public.case_drafts d on d.id = v.draft_id and d.version = v.version where d.id = draft; $$;
create function pg_temp.approve(draft uuid) returns jsonb language plpgsql as $$
declare
  seen jsonb := public.preview_case_draft(draft);
begin
  return public.approve_case_draft(draft, (seen ->> 'version')::integer, seen ->> 'hash');
end;
$$;

create temporary table texts (name text primary key, body text);
grant select on texts to anon, authenticated, service_role;
insert into texts values
  ('first', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  -- What a lawyer wrote on it, with what identifies the client typed in.
  ('edited', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou. Maria Teste, CPF 123.456.789-09, avisou a companhia pelo e-mail maria@exemplo.invalid. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  -- What the AI answered of it: the marks it was shown, kept, and one it made up.
  ('rewritten_odd', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou e [nome 1], CPF [CPF 1], perdeu a conexão em Brasília, como confirma [nome 9]. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  ('restored_odd', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou e Maria Teste, CPF 123.456.789-09, perdeu a conexão em Brasília, como confirma [nome 9]. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  -- And an answer that kept every mark it was shown.
  ('rewritten', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou mais de quatro horas. [nome 1], CPF [CPF 1], avisou a companhia pelo e-mail [e-mail 1]. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  ('restored', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou mais de quatro horas. Maria Teste, CPF 123.456.789-09, avisou a companhia pelo e-mail maria@exemplo.invalid. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]');
insert into texts
select made.name, replace(first.body, 'O voo atrasou.', made.facts)
from texts first,
  (values
    -- What a lawyer wrote, naming the client and somebody who is not of the case yet.
    ('edited2', 'O voo foi cancelado. João Teste, CPF 111.444.777-35, viajava com Rita Lago.'),
    ('rewritten2', 'O voo foi cancelado e [nome 1], CPF [CPF 1], que viajava com [nome 2], perdeu o casamento de um parente.'),
    ('restored2', 'O voo foi cancelado e João Teste, CPF 111.444.777-35, que viajava com Rita Lago, perdeu o casamento de um parente.'),
    ('edited_after2', 'O voo foi cancelado e João Teste, CPF 111.444.777-35, que viajava com Rita Lago, perdeu o casamento de um parente em Recife.'),
    ('rewritten3', 'O voo atrasou mais de quatro horas.'),
    ('written3', 'O voo atrasou e a companhia nada informou.'),
    -- The other firm's piece: what the AI answered, and what the database made of it.
    ('rewritten_b', 'O voo atrasou e [nome 1] esperou seis horas no aeroporto.'),
    ('restored_b', 'O voo atrasou e Paulo esperou seis horas no aeroporto.'),
    ('rewritten_b2', 'O voo atrasou e [nome 2] esperou seis horas.'),
    ('restored_b2', 'O voo atrasou e Paulo Teste esperou seis horas.')
  ) as made (name, facts)
where first.name = 'first';
create function pg_temp.text_of(name text) returns text language sql as
$$ select body from texts where texts.name = text_of.name; $$;

-- A case of firm A with a lawsuit not filed yet and everything its piece names on record; a case of firm B.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('p', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid], array['af100000-0000-4000-8000-000000000001'::uuid]));
select public.save_case_person(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  '{"nationality": "brasileira", "marital_status": "casado", "profession": "professora", "postal_code": "74000000", "street": "Rua das Flores", "address_number": "10", "district": "Centro", "city": "Goiânia", "uf": "GO"}'::jsonb);
select public.set_party_claim(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id')::uuid, 1000000);
insert into res values ('source', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "lei", "number": "8078", "article": "14", "title": "Responsabilidade do fornecedor de serviços", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"}'::jsonb));
insert into res values ('template', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', 'Petição inicial', 'proceeding_kind', 'juizado', 'body', pg_temp.text_of('first'))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bf100000-0000-4000-8000-00000000000b', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- ---------- The queue: sent back only where the task reads the note ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('check_run', public.start_ai_run('bf100000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('a', 64)));
insert into res values ('check_done', public.finish_ai_run(pg_temp.got('check_run', 'run_id')::uuid, 'succeeded',
  '{"resposta": "Recebido.", "tarefa": "verificação"}'::jsonb, 100, 20));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('return_no_note', public.decide_approval(pg_temp.got('check_done', 'approval_id')::uuid, 'returned', null, '   '));
insert into res values ('return_not_revisable', public.decide_approval(pg_temp.got('check_done', 'approval_id')::uuid, 'returned', null,
  'Responda de outro jeito, por favor.'));
select throws_ok(
  format('select public.decide_approval(%L, %L)', pg_temp.got('check_done', 'approval_id'), 'talvez'),
  '22023', 'invalid_decision', 'the queue takes three decisions and no other'
);
reset role;
select ok(
  pg_temp.got('return_no_note', 'code') = 'note_required'
  and pg_temp.got('return_not_revisable', 'code') = 'not_revisable'
  and (select status = 'pending' from public.approvals where id = pg_temp.got('check_done', 'approval_id')::uuid)
  and (select revisable from public.ai_tasks where slug = 'caso.relato.cronologia')
  and (select revisable from public.ai_tasks where slug = 'caso.peca.minuta')
  and not (select revisable from public.ai_tasks where slug = 'caso.relato.transcricao')
  and not (select revisable from public.ai_tasks where slug = 'caso.documento.conferencia'),
  'an answer is sent back only with what to change, and only where the task reads it: a chronology and the text of a piece, never a transcription nor the check of a document'
);

-- ---------- A chronology sent back ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('statement', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id')::uuid,
  null, 'O voo de Goiânia para Recife atrasou cinco horas e eu perdi a conexão em Brasília.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('s_claim1', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('statement', 'statement_id')::uuid)));
insert into res values ('s_run1', pg_temp.ran_statement('bf100000-0000-4000-8000-00000000000a', pg_temp.got('statement', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026: o voo atrasou cinco horas.", "perguntas": ""}'::jsonb, 1));
insert into res values ('s_proposed1', public.record_statement_work(pg_temp.got('statement', 'statement_id')::uuid, 1, 'proposed',
  pg_temp.got('s_run1', 'run_id')::uuid));
reset role;

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('s_return_attendant', public.decide_approval(pg_temp.got('s_run1', 'approval_id')::uuid, 'returned', null,
  'A data certa é 21/09/2026.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('s_return_other_firm', public.decide_approval(pg_temp.got('s_run1', 'approval_id')::uuid, 'returned', null,
  'A data certa é 21/09/2026.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L, null, %L)', pg_temp.got('s_run1', 'approval_id'), 'returned', 'A data certa é 21/09/2026.'),
  '42501', 'second_factor_required', 'sending an answer back is a decision of the queue: it takes the second factor'
);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('s_return', public.decide_approval(pg_temp.got('s_run1', 'approval_id')::uuid, 'returned', null,
  '  A data certa é 21/09/2026, conferi no bilhete.  '));
insert into res values ('s_return_again', public.decide_approval(pg_temp.got('s_run1', 'approval_id')::uuid, 'returned', null,
  'Mais uma coisa.'));
reset role;
select ok(
  pg_temp.got('s_proposed1', 'code') = 'proposed'
  and pg_temp.got('s_return_attendant', 'code') = 'not_an_approver' and pg_temp.got('s_return_other_firm', 'code') = 'not_found'
  and pg_temp.got('s_return', 'code') = 'returned' and pg_temp.got('s_return_again', 'code') = 'already_decided'
  and (select status = 'returned' and final_output is null and not edited
              and decision_note = 'A data certa é 21/09/2026, conferi no bilhete.'
              and decided_by = 'af100000-0000-4000-8000-000000000001'
       from public.approvals where id = pg_temp.got('s_run1', 'approval_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'ai.approval.returned'
       and entity_id = pg_temp.got('s_run1', 'approval_id')),
  'who may decide an answer sends it back with what to change, once: it takes no effect, and the note is kept with the decision'
);
select ok(
  (select chronology_status = 'none' and chronology is null and work = 'chronology' and work_claimed_at is null
          and returned_note = 'A data certa é 21/09/2026, conferi no bilhete.'
          and returned_run_id = pg_temp.got('s_run1', 'run_id')::uuid and returns = 1
   from public.case_statements where id = pg_temp.got('statement', 'statement_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'chronology_returned' and actor_type = 'person'
       and case_id = pg_temp.got('case', 'case_id')::uuid),
  'a chronology sent back is asked again at once, and the statement keeps what the firm asked and the proposal it is about'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('s_claim2', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('statement', 'statement_id')::uuid)));
insert into res values ('s_work2', (select to_jsonb(w) from public.case_statement_to_process(pg_temp.got('statement', 'statement_id')::uuid, 2) w));
insert into res values ('s_run2', pg_temp.ran_statement('bf100000-0000-4000-8000-00000000000a', pg_temp.got('statement', 'statement_id')::uuid,
  '{"cronologia": "21/09/2026: o voo atrasou cinco horas.", "perguntas": ""}'::jsonb, 2));
insert into res values ('s_proposed2', public.record_statement_work(pg_temp.got('statement', 'statement_id')::uuid, 2, 'proposed',
  pg_temp.got('s_run2', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('s_waiting', jsonb_build_object('n', (select count(*) from public.approvals a
  join public.ai_runs r on r.id = a.run_id
  where a.status = 'pending' and r.subject_id = pg_temp.got('statement', 'statement_id'))));
insert into res values ('s_approve2', public.decide_approval(pg_temp.got('s_run2', 'approval_id')::uuid, 'approved'));
reset role;
select ok(
  pg_temp.got('s_claim2', 'claim') = '2'
  and pg_temp.got('s_work2', 'returned_proposal') = '20/09/2026: o voo atrasou cinco horas.'
  and pg_temp.got('s_work2', 'firm_note') = 'A data certa é 21/09/2026, conferi no bilhete.'
  and pg_temp.got('s_work2', 'previous_chronology') is null
  and pg_temp.got('s_proposed2', 'code') = 'proposed' and pg_temp.got('s_waiting', 'n') = '1'
  and pg_temp.got('s_approve2', 'code') = 'approved'
  and (select chronology_status = 'approved' and chronology = '21/09/2026: o voo atrasou cinco horas.'
              and returned_note is null and returned_run_id is null and returns = 1
       from public.case_statements where id = pg_temp.got('statement', 'statement_id')::uuid),
  'the next proposal reads the one sent back and the firm''s words, waits in the queue like the first, and once it is decided the request is answered'
);

-- As many times as the setting allows, and no more.
update public.platform_settings set value = jsonb_set(value, '{max_returns}', '1') where key = 'statements';
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('s_ask_again', public.request_statement_chronology(pg_temp.got('statement', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('s_claim3', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('statement', 'statement_id')::uuid)));
insert into res values ('s_run3', pg_temp.ran_statement('bf100000-0000-4000-8000-00000000000a', pg_temp.got('statement', 'statement_id')::uuid,
  '{"cronologia": "21/09/2026: o voo atrasou cinco horas e a conexão foi perdida.", "perguntas": ""}'::jsonb, 3));
insert into res values ('s_proposed3', public.record_statement_work(pg_temp.got('statement', 'statement_id')::uuid, 3, 'proposed',
  pg_temp.got('s_run3', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L, null, %L)', pg_temp.got('s_run3', 'approval_id'), 'returned', 'Tire a parte da conexão.'),
  'P0001', 'too_many_returns', 'the proposals of one statement are sent back as many times as the setting allows'
);
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_returns}', '5') where key = 'statements';
select ok(
  pg_temp.got('s_ask_again', 'code') = 'requested' and pg_temp.got('s_proposed3', 'code') = 'proposed'
  and (select status = 'pending' from public.approvals where id = pg_temp.got('s_run3', 'approval_id')::uuid)
  and (select chronology_status = 'proposed' and returns = 1 and returned_note is null
       from public.case_statements where id = pg_temp.got('statement', 'statement_id')::uuid),
  'and one more is refused whole: the proposal goes on waiting for a decision'
);

-- ---------- What identifies a person, under numbered marks ----------

select ok(
  (select k ->> 'text' = 'Falei com [nome 1] ([nome 2]), CPF [CPF 1], no [telefone 1] e em [e-mail 1]. [nome 1] mora no CEP [CEP 1].'
          and k -> 'keys' = '{"[nome 1]": "Maria Teste", "[nome 2]": "MARIA", "[CPF 1]": "123.456.789-09", "[telefone 1]": "(62) 99999-0001", "[e-mail 1]": "maria@exemplo.invalid", "[CEP 1]": "74000-000"}'::jsonb
          and public.case_text_restored(k ->> 'text', k -> 'keys')
              = 'Falei com Maria Teste (MARIA), CPF 123.456.789-09, no (62) 99999-0001 e em maria@exemplo.invalid. Maria Teste mora no CEP 74000-000.'
   from (select public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid,
     'Falei com Maria Teste (MARIA), CPF 123.456.789-09, no (62) 99999-0001 e em maria@exemplo.invalid. Maria Teste mora no CEP 74000-000.') as k) read)
  and public.case_text_for_ai(pg_temp.got('case', 'case_id')::uuid,
        'Falei com Maria Teste (MARIA), CPF 123.456.789-09, no (62) 99999-0001 e em maria@exemplo.invalid.')
      = 'Falei com [nome] ([nome]), CPF [CPF], no [telefone] e em [e-mail].',
  'a text the AI is to give back has each thing that identifies a person under a numbered mark, the same words under the same mark, and gets every word back; one it only reads has plain marks'
);
select ok(
  (select second ->> 'text' = 'Diga que [nome 1] ligou para [telefone 1].' and second -> 'keys' ->> '[telefone 1]' = '62 3333-4444'
          and second -> 'keys' ->> '[nome 1]' = 'Maria Teste'
   from (select public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid, 'Diga que Maria Teste ligou para 62 3333-4444.',
     public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid, 'A autora é Maria Teste.') -> 'keys') as second) read)
  -- A mark the AI changed or made up is in no list: it stays, and a piece is never approved with one.
  and public.case_text_restored('Aqui [nome 1], ali [Nome 1] e [nome 7].', '{"[nome 1]": "Maria Teste"}'::jsonb)
      = 'Aqui Maria Teste, ali [Nome 1] e [nome 7].'
  and public.case_draft_text_blocker('A autora [nome 7] embarcou.') = 'placeholder_left'
  and public.case_draft_text_blocker('A autora [Nome 1] embarcou.') is not distinct from 'placeholder_left'
  and public.case_draft_text_blocker('CPF [CPF] e [e-mail 2].') = 'placeholder_left'
  and public.case_draft_text_blocker('Conforme o item [3] do bilhete e a nota [sic].') is null,
  'a second text read under the marks of the first names the same person by the same mark; a mark left in a piece keeps it from being approved'
);
select ok(
  public.has_person_mark('[nome_1]') and public.has_person_mark('[NOME-1]') and public.has_person_mark('[nome nº 1]')
  and public.has_person_mark('[name 1]') and public.has_person_mark('[ telefone 3 ]') and public.has_person_mark('[e-mail]')
  and public.has_person_mark('como disse [nome 1 ao embarcar') and public.has_person_mark('(nome 1)')
  and public.has_person_mark('{CPF 2}') and public.has_person_mark('[nome 1/2]') and public.has_person_mark('[nomes 1 e 2]')
  and public.has_person_mark('disse nome 1] que embarcou')
  -- Whichever space or hyphen it came back with, and whatever has no width inside it: as its document writes it.
  and public.has_person_mark('[nome' || U&'\00A0' || '1]') and public.has_person_mark('[nome' || U&'\202F' || '1]')
  and public.has_person_mark('[e' || U&'\2011' || 'mail 1]') and public.has_person_mark('[no' || U&'\200B' || 'me' || U&'\FEFF' || ' 1]')
  and public.has_person_mark(E'[nome\n1]')
  and not public.has_person_mark('o perito [nomeado às fls. 20] concluiu')
  and not public.has_person_mark('[CPF 123.456.789-09]') and not public.has_person_mark('[nome completo da autora]')
  and not public.has_person_mark('(telefone 190)') and not public.has_person_mark('(CEP 74000-000)')
  and not public.has_person_mark('[[NOMES_DAS_PARTES]] e [COMPLETAR: nome do hotel]')
  and not public.has_person_mark('O sobrenome 1] não é marca, nem o renome 2].')
  and not public.has_person_mark('Conforme o item [3] do bilhete e a nota [sic].'),
  'a mark is seen however the AI wrote it back (another separator, another space, another language, a bracket lost or changed), and what a lawyer writes in brackets is left alone'
);
select is(
  public.person_marks('Disse (nome 2) e [E-mail 1 da companhia, e de novo (nome 2). Aqui [nome 7] e ali [CPF 123.456.789-09].'),
  array['(nome 2)', '[E-mail 1', '[nome 7]'],
  'the marks a text holds are said as they are written in it, each once, for the lawyer to find them'
);

-- A case whose people have names joined by a hyphen and by an apostrophe, and two of them a name in common.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case4', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-23',
  '{"full_name": "Ana Souza-Lima"}'::jsonb));
insert into res values ('c4_julio', public.save_case_person(pg_temp.got('case4', 'case_id')::uuid, null, '{"full_name": "Júlio D''Ávila"}'::jsonb, 'claimant'));
insert into res values ('c4_bia', public.save_case_person(pg_temp.got('case4', 'case_id')::uuid, null, '{"full_name": "Bia Lima"}'::jsonb, 'claimant'));
insert into res values ('c4_maria', public.save_case_person(pg_temp.got('case4', 'case_id')::uuid, null, '{"full_name": "Maria Nascimento Dias"}'::jsonb, 'claimant'));
insert into res values ('c4_li', public.save_case_person(pg_temp.got('case4', 'case_id')::uuid, null, '{"full_name": "Li Wu"}'::jsonb, 'claimant'));
reset role;
select ok(
  pg_temp.got('c4_julio', 'ok') = 'true' and pg_temp.got('c4_bia', 'ok') = 'true'
  and (select k ->> 'text' = 'A Sra. [nome 6]-[nome 5] viajou com [nome 5] e com D’[nome 2]. [nome 1] e [nome 4] [nome 3] assinam.'
          and k -> 'keys' = '{"[nome 1]": "ANA SOUZA LIMA", "[nome 2]": "Ávila", "[nome 3]": "Davila", "[nome 4]": "Julio", "[nome 5]": "Lima", "[nome 6]": "Souza"}'::jsonb
          and public.case_text_restored(k ->> 'text', k -> 'keys')
              = 'A Sra. Souza-Lima viajou com Lima e com D’Ávila. ANA SOUZA LIMA e Julio Davila assinam.'
          -- The marks that are one person, by the marks alone; a name two people share names neither.
          and public.case_marks_same_name(pg_temp.got('case4', 'case_id')::uuid, k -> 'keys')
              = '[["[nome 1]", "[nome 6]"], ["[nome 2]", "[nome 3]", "[nome 4]"]]'::jsonb
   from (select public.case_text_keyed(pg_temp.got('case4', 'case_id')::uuid,
     'A Sra. Souza-Lima viajou com Lima e com D’Ávila. ANA SOUZA LIMA e Julio Davila assinam.') as k) read)
  and pg_temp.got('c4_maria', 'ok') = 'true' and pg_temp.got('c4_li', 'ok') = 'true'
  -- A word of a text that is also somebody's surname is under a mark and comes back as it was, and it is
  -- told to be that person's name only where it is written as a name, with its capital.
  and (select k ->> 'text' = '[nome 1] juntou a certidão de [nome 4] em 15 [nome 2], e [nome 3] assinou.'
          and k -> 'keys' = '{"[nome 1]": "Maria Nascimento Dias", "[nome 2]": "dias", "[nome 3]": "Dias", "[nome 4]": "nascimento"}'::jsonb
          and public.case_text_restored(k ->> 'text', k -> 'keys')
              = 'Maria Nascimento Dias juntou a certidão de nascimento em 15 dias, e Dias assinou.'
          and public.case_marks_same_name(pg_temp.got('case4', 'case_id')::uuid, k -> 'keys') = '[["[nome 1]", "[nome 3]"]]'::jsonb
   from (select public.case_text_keyed(pg_temp.got('case4', 'case_id')::uuid,
     'Maria Nascimento Dias juntou a certidão de nascimento em 15 dias, e Dias assinou.') as k) read)
  -- A short name of two words is found whole, and only whole: "li" stays a word.
  and public.case_text_keyed(pg_temp.got('case4', 'case_id')::uuid, 'Li Wu embarcou, e eu li o bilhete.') ->> 'text'
      = '[nome 1] embarcou, e eu li o bilhete.'
  -- A whole name is never found inside a longer word, nor across what does not join the names of a person.
  and public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid, 'Maria Testemunha depôs.') ->> 'text' = '[nome 1] Testemunha depôs.'
  and public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid, 'Falou Maria, Teste de conexão feito.') ->> 'text'
      = 'Falou [nome 1], [nome 2] de conexão feito.'
  -- A CPF and a CEP are found whatever is written against them.
  and public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid, 'CPF nº123.456.789-09 e CEP74000-000.') ->> 'text'
      = 'CPF nº[CPF 1] e CEP[CEP 1].'
  -- A name typed with each accent apart from its letter is the same name, and comes back as one character.
  and (select k ->> 'text' = '[nome 1] embarcou.' and k -> 'keys' ->> '[nome 1]' = 'María Teste'
       from (select public.case_text_keyed(pg_temp.got('case', 'case_id')::uuid, E'Mari\u0301a Teste embarcou.') as k) read),
  'a name is found however it is written: each of the names a hyphen or an apostrophe joins, the whole name with no accent or in capitals, never as a part of a longer word'
);

-- ---------- The text of a piece sent back to the AI ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d', public.request_case_draft(pg_temp.got('p', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_claim1', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d', 'draft_id')::uuid)));
insert into res values ('d_work1', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d', 'draft_id')::uuid, 1) w));
insert into res values ('d_run1', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d', 'draft_id')::uuid,
  pg_temp.got('d_work1', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('first'), 'observacoes', '["Confira o valor da causa."]'::jsonb)));
insert into res values ('d_generated', public.record_draft_work(pg_temp.got('d', 'draft_id')::uuid, 1, 'generated', pg_temp.got('d_run1', 'run_id')::uuid));
insert into res values ('d_read1', pg_temp.read_draft(pg_temp.got('d', 'draft_id')::uuid));
reset role;

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d_return_attendant', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 1, 'Troque o segundo parágrafo, por favor.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('d_return_other_firm', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 1, 'Troque o segundo parágrafo, por favor.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_return_short', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 1, 'Melhore.'));
insert into res values ('d_return_old', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 7, 'Troque o segundo parágrafo, por favor.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003', 'aal1');
set local role authenticated;
select throws_ok(
  format('select public.return_case_draft(%L, 1, %L)', pg_temp.got('d', 'draft_id'), 'Troque o segundo parágrafo, por favor.'),
  '42501', 'second_factor_required', 'a lawyer sends a text back with the second factor'
);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L, null, %L)', pg_temp.got('d_run1', 'approval_id'), 'returned', 'Troque o segundo parágrafo, por favor.'),
  'P0001', 'return_on_case', 'the text of a piece is sent back where it is read, never from the queue'
);
reset role;
select ok(
  pg_temp.got('d_generated', 'code') = 'generated' and pg_temp.got('d_read1', 'code') = 'checked'
  and pg_temp.got('d_work1', 'run_key') = 'draft:' || pg_temp.got('d', 'draft_id') || ':0'
  and pg_temp.got('d_return_attendant', 'code') = 'not_allowed' and pg_temp.got('d_return_other_firm', 'code') = 'draft_not_found'
  and pg_temp.got('d_return_short', 'code') = 'note_required' and pg_temp.got('d_return_old', 'code') = 'draft_changed'
  and (select status = 'pending' from public.approvals where id = pg_temp.got('d_run1', 'approval_id')::uuid)
  and (select work is null and revision_note is null and revisions = 0 and version = 1
       from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid)
  and (select run_id = pg_temp.got('d_run1', 'run_id')::uuid and based_on is null and note is null
       from public.case_draft_versions where draft_id = pg_temp.got('d', 'draft_id')::uuid and version = 1),
  'a partner or a lawyer of the firm sends back the version they read, with what to change in words enough to be a request'
);

-- A lawyer writes on the text, with what identifies the client typed in, and then sends it back.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_edit', public.save_draft_version(pg_temp.got('d', 'draft_id')::uuid, pg_temp.text_of('edited'), 1));
insert into res values ('d_return_unread', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 2,
  'Diga que a autora perdeu a conexão em Brasília.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_read2', pg_temp.read_draft(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_return', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 2,
  'Diga que Maria Teste perdeu a conexão em Brasília e tire a menção ao e-mail.'));
insert into res values ('d_edit_meanwhile', public.save_draft_version(pg_temp.got('d', 'draft_id')::uuid, pg_temp.text_of('first'), 2));
insert into res values ('d_return_meanwhile', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 2, 'Outra coisa, por favor.'));
insert into res values ('d_preview_meanwhile', public.preview_case_draft(pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_approve_meanwhile', pg_temp.approve(pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_today_meanwhile', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('d_edit', 'code') = 'saved' and pg_temp.got('d_read2', 'code') = 'checked'
  -- Not before what the text cites was read: it is sent back from a state it could be approved from.
  and pg_temp.got('d_return_unread', 'code') = 'citations_not_checked'
  and pg_temp.got('d_return', 'code') = 'returned' and pg_temp.got('d_return', 'version') = '2'
  and (select status = 'returned' and decided_by = 'af100000-0000-4000-8000-000000000003'
              and decision_note = 'Diga que Maria Teste perdeu a conexão em Brasília e tire a menção ao e-mail.'
       from public.approvals where id = pg_temp.got('d_run1', 'approval_id')::uuid)
  and (select status = 'proposed' and work = 'revise' and version = 2 and revisions = 1
              and revision_note = 'Diga que Maria Teste perdeu a conexão em Brasília e tire a menção ao e-mail.'
              and revision_by = 'af100000-0000-4000-8000-000000000003' and revision_at is not null and revision_keys is null
       from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid)
  and (select based_on = 1 and author = 'person' from public.case_draft_versions
       where draft_id = pg_temp.got('d', 'draft_id')::uuid and version = 2)
  and (select count(*) = 1 from public.case_events where kind = 'draft_returned' and case_id = pg_temp.got('case', 'case_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'draft.returned' and entity_id = pg_temp.got('d', 'draft_id')),
  'sent back, the AI''s own text is decided as such in the queue, and the draft owes its rewriting, with what was asked and by whom'
);
select ok(
  pg_temp.got('d_edit_meanwhile', 'code') = 'revision_in_course' and pg_temp.got('d_return_meanwhile', 'code') = 'revision_in_course'
  and pg_temp.got('d_preview_meanwhile', 'blocker') = 'revision_in_course'
  and pg_temp.got('d_approve_meanwhile', 'code') = 'revision_in_course'
  and pg_temp.got('d_today_meanwhile', 'drafts_waiting') = '0' and pg_temp.got('d_today_meanwhile', 'approvals_waiting') = '2',
  'while the AI rewrites it the text is nobody''s to edit, to send back again or to approve, and it waits for no lawyer'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_claim4', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d', 'draft_id')::uuid)));
insert into res values ('d_work4', (select to_jsonb(w) - 'library' from public.case_draft_to_work(pg_temp.got('d', 'draft_id')::uuid,
  (pg_temp.got('d_claim4', 'claim'))::integer) w));
insert into res values ('d_keys', (select revision_keys from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid));
-- The answer of a rewriting nobody waits for (another's key), arriving while this one is in course.
insert into res values ('d_stale', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d', 'draft_id')::uuid,
  'draft:' || pg_temp.got('d', 'draft_id') || ':r7:0', jsonb_build_object('texto', pg_temp.text_of('first'), 'observacoes', '[]'::jsonb)));
insert into res values ('d_stale_said', public.record_draft_work(pg_temp.got('d', 'draft_id')::uuid, (pg_temp.got('d_claim4', 'claim'))::integer,
  'revised', pg_temp.got('d_stale', 'run_id')::uuid));
reset role;
select ok(
  pg_temp.got('d_work4', 'work') = 'revise' and pg_temp.got('d_work4', 'template') is null
  and pg_temp.got('d_work4', 'run_key') = 'draft:' || pg_temp.got('d', 'draft_id') || ':r1:0'
  and pg_temp.got('d_work4', 'requested_by') = 'af100000-0000-4000-8000-000000000003'
  and pg_temp.got('d_work4', 'body') like '%O voo atrasou. [nome 1], CPF [CPF 1], avisou a companhia pelo e-mail [e-mail 1].%'
  and pg_temp.got('d_work4', 'body') not like '%Maria%' and pg_temp.got('d_work4', 'body') not like '%123.456%'
  and pg_temp.got('d_work4', 'body') not like '%exemplo.invalid%'
  and pg_temp.got('d_work4', 'body') like '%[[PARTES]]%'
  and pg_temp.got('d_work4', 'note') = 'Diga que [nome 1] perdeu a conexão em Brasília e tire a menção ao e-mail.'
  and (select payload -> 'facts' ->> 'ocorrencia' = 'delay' from res where name = 'd_work4')
  and (select payload = '{"[nome 1]": "Maria Teste", "[CPF 1]": "123.456.789-09", "[e-mail 1]": "maria@exemplo.invalid"}'::jsonb
       from res where name = 'd_keys')
  -- One mark for one person: nothing to tell the AI about marks that are the same person.
  and (select payload -> 'same' = '[]'::jsonb from res where name = 'd_work4'),
  'the worker is handed the text and the request with what identifies a person under numbered marks, the same in both, and the list of them is kept on the draft'
);
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  'select revision_keys from public.case_drafts',
  '42501', 'permission denied for table case_drafts', 'the list of the marks is the backend''s alone: no member reads it'
);
insert into res values ('d_member_reads', (select jsonb_build_object('note', revision_note, 'work', work) from public.case_drafts
  where id = pg_temp.got('d', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d_member_reads', 'work') = 'revise' and pg_temp.got('d_member_reads', 'note') is not null
  and not has_column_privilege('authenticated', 'public.case_drafts', 'revision_keys', 'SELECT')
  and has_column_privilege('authenticated', 'public.case_drafts', 'revision_note', 'SELECT')
  and not has_function_privilege('authenticated', 'public.case_text_keyed(uuid, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_text_restored(text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.text_keyed_pass(text, jsonb, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_names(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_marks_same_name(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_text_for_ai(uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.has_person_mark(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_awaits_run(public.case_drafts, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.draft_run_at(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_draft_to_work(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_draft_work(uuid, integer, text, uuid, text, jsonb)', 'EXECUTE'),
  'a member reads the request and never the marks; what keys and restores a text, and what the worker reads, is called by no member'
);
select ok(
  pg_temp.got('d_stale', 'approval_id') is null
  and (select a.status = 'withdrawn' from public.approvals a where a.run_id = pg_temp.got('d_stale', 'run_id')::uuid)
  and pg_temp.got('d_stale_said', 'code') = 'run_not_found'
  and (select work = 'revise' and version = 2 from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid),
  'the answer of a rewriting the draft does not wait for is nobody''s: it enters the queue withdrawn and is never taken for the one asked last'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_run2', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d', 'draft_id')::uuid,
  pg_temp.got('d_work4', 'run_key'),
  jsonb_build_object('texto', replace(pg_temp.text_of('rewritten_odd'), E'\n', E'\r\n'), 'observacoes', '["Acrescentei a perda da conexão."]'::jsonb)));
insert into res values ('d_revised', public.record_draft_work(pg_temp.got('d', 'draft_id')::uuid, (pg_temp.got('d_claim4', 'claim'))::integer,
  'revised', pg_temp.got('d_run2', 'run_id')::uuid));
insert into res values ('d_read3', pg_temp.read_draft(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d_run2', 'approval_id') is not null and pg_temp.got('d_revised', 'code') = 'revised'
  and pg_temp.got('d_revised', 'waits') = 'true'
  and (select author = 'ai' and author_id is null and based_on = 2 and not restored
              and note = 'Diga que Maria Teste perdeu a conexão em Brasília e tire a menção ao e-mail.'
              and asked_by = 'af100000-0000-4000-8000-000000000003' and run_id = pg_temp.got('d_run2', 'run_id')::uuid
              and body = pg_temp.text_of('restored_odd')
              -- A mark the answer has fewer times than the text had is said first, by the words it stands for.
              and notes = array['Conferir: "maria@exemplo.invalid" aparecia 1 vez no texto anterior e não aparece neste.',
                                'Acrescentei a perda da conexão.']
       from public.case_draft_versions where draft_id = pg_temp.got('d', 'draft_id')::uuid and version = 3)
  and (select body = pg_temp.text_of('edited') from public.case_draft_versions
       where draft_id = pg_temp.got('d', 'draft_id')::uuid and version = 2)
  and (select status = 'proposed' and version = 3 and run_id = pg_temp.got('d_run2', 'run_id')::uuid
              and revision_note is null and revision_by is null and revision_at is null and revision_keys is null and revisions = 1
       from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_revised' and actor_type = 'ai'
       and case_id = pg_temp.got('case', 'case_id')::uuid),
  'what the AI rewrote is the next version, read from its run with the words each mark stood for put back, beside what was asked and by whom; the version before stays as it was'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d_preview3', public.preview_case_draft(pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_approve3', pg_temp.approve(pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_return_marked', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 3,
  'Diga também que Maria esperou seis horas.'));
insert into res values ('d_reject_unread', public.reject_case_draft(pg_temp.got('d', 'draft_id')::uuid, 'Não serve.', 2));
insert into res values ('d_reject3', public.reject_case_draft(pg_temp.got('d', 'draft_id')::uuid, 'O ajuste trouxe um nome que não existe.', 3));
reset role;
select ok(
  pg_temp.got('d_read3', 'code') = 'checked'
  and pg_temp.got('d_preview3', 'blocker') = 'placeholder_left' and pg_temp.got('d_approve3', 'code') = 'placeholder_left'
  -- The preview says which mark holds the piece, as it is written.
  and (select payload -> 'marks' = '["[nome 9]"]'::jsonb from res where name = 'd_preview3')
  -- Nor is it sent back as it is: the mark would be read as one of the next list, and get somebody else's words.
  and pg_temp.got('d_return_marked', 'code') = 'placeholder_left' and pg_temp.got('d_return_marked', 'field') is null
  -- Turned down as the version that was read: never one that arrived since.
  and pg_temp.got('d_reject_unread', 'code') = 'draft_changed'
  and pg_temp.got('d_reject3', 'code') = 'rejected'
  and (select status = 'rejected' from public.approvals where id = pg_temp.got('d_run2', 'approval_id')::uuid)
  and (select status = 'proposed' and version = 4 and work = 'check' and revision_note is null
       from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid)
  and (select author = 'person' and author_id = 'af100000-0000-4000-8000-000000000001' and restored and based_on = 2
              and body = pg_temp.text_of('edited')
       from public.case_draft_versions where draft_id = pg_temp.got('d', 'draft_id')::uuid and version = 4)
  and (select count(*) = 4 from public.case_draft_versions where draft_id = pg_temp.got('d', 'draft_id')::uuid)
  -- The text put back is a lawyer's edit of the AI's first text: that answer is the draft's again, and what
  -- the AI said of it is what the screens show, as they did before the rewriting.
  and (select d.run_id = pg_temp.got('d_run1', 'run_id')::uuid and v.version = 1 and v.notes = array['Confira o valor da causa.']
       from public.case_drafts d
       join public.case_draft_versions v on v.draft_id = d.id and v.run_id = d.run_id
       where d.id = pg_temp.got('d', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_rejected' and case_id = pg_temp.got('case', 'case_id')::uuid),
  'a mark the AI made up keeps the piece from being approved; a rewriting turned down leaves the draft with the text there was before it, put back as the next version'
);

-- What is sent back is a text a lawyer could approve as far as its reading goes, as many times as the setting allows.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_read4', pg_temp.read_draft(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_return_note_marked', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 4,
  'Troque [nome 1] por a autora, por favor.'));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_revision_chars}', '200') where key = 'drafts';
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_return_long', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 4,
  'Conte os fatos na ordem em que aconteceram.'));
reset role;
update public.platform_settings
set value = jsonb_set(jsonb_set(value, '{max_revision_chars}', '24000'), '{max_revisions}', '1') where key = 'drafts';
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_return_capped', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 4,
  'Conte os fatos na ordem em que aconteceram.'));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_revisions}', '8') where key = 'drafts';
select ok(
  pg_temp.got('d_read4', 'code') = 'checked'
  and pg_temp.got('d_return_note_marked', 'code') = 'placeholder_left' and pg_temp.got('d_return_note_marked', 'field') = 'note'
  and pg_temp.got('d_return_long', 'code') = 'too_long_to_rewrite'
  and pg_temp.got('d_return_capped', 'code') = 'too_many_returns'
  and (select work is null and revision_note is null and revisions = 1 and version = 4
       from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid),
  'a text is not sent back with a mark of a person written in the request, when it is longer than the AI gives back whole, nor more times than the setting allows'
);

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('af100000-0000-4000-8000-000000000009', 'af100000-0000-4000-8000-000000000001', 'bf100000-0000-4000-8000-00000000000a',
        'Conferindo as peças', 'ff100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001', 'aal2', 'ff100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.return_case_draft(%L, 4, %L)', pg_temp.got('d', 'draft_id'), 'Conte os fatos na ordem em que aconteceram.'),
  '42501', 'not_allowed_in_support_session', 'a support visit sends no text back to the AI'
);
select throws_ok(
  format('select public.withdraw_draft_revision(%L)', pg_temp.got('d', 'draft_id')),
  '42501', 'not_allowed_in_support_session', 'gives up no rewriting'
);
select throws_ok(
  format('select public.decide_approval(%L, %L, null, %L)', pg_temp.got('s_run3', 'approval_id'), 'returned', 'Tire a parte da conexão.'),
  '42501', 'not_allowed_in_support_session', 'and sends no answer of the queue back'
);
reset role;

-- Sent back, given up before the AI answers, and sent back again: the answer of the one given up is nobody's.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_return2', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 4, 'Conte os fatos na ordem em que aconteceram.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d_withdraw_attendant', public.withdraw_draft_revision(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_withdraw', public.withdraw_draft_revision(pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_withdraw_again', public.withdraw_draft_revision(pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_after_withdraw', (select jsonb_build_object('status', status, 'work', work, 'note', revision_note, 'revisions', revisions)
  from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid));
insert into res values ('d_edit_after', public.save_draft_version(pg_temp.got('d', 'draft_id')::uuid, pg_temp.text_of('edited'), 4));
insert into res values ('d_return3', public.return_case_draft(pg_temp.got('d', 'draft_id')::uuid, 4, 'Diga que o atraso passou de quatro horas.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_claim_fail', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d', 'draft_id')::uuid)));
-- The answer of the rewriting that was given up, arriving while the next one is in course.
insert into res values ('d_late', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d', 'draft_id')::uuid,
  'draft:' || pg_temp.got('d', 'draft_id') || ':r2:0', jsonb_build_object('texto', pg_temp.text_of('first'), 'observacoes', '[]'::jsonb)));
insert into res values ('d_late_said', public.record_draft_work(pg_temp.got('d', 'draft_id')::uuid, (pg_temp.got('d_claim_fail', 'claim'))::integer,
  'revised', pg_temp.got('d_late', 'run_id')::uuid));
reset role;
select ok(
  pg_temp.got('d_return2', 'code') = 'returned'
  and pg_temp.got('d_withdraw_attendant', 'code') = 'not_allowed'
  and pg_temp.got('d_withdraw', 'code') = 'withdrawn' and pg_temp.got('d_withdraw_again', 'code') = 'nothing_to_withdraw'
  and pg_temp.got('d_after_withdraw', 'status') = 'proposed' and pg_temp.got('d_after_withdraw', 'work') is null
  and pg_temp.got('d_after_withdraw', 'note') is null and pg_temp.got('d_after_withdraw', 'revisions') = '2'
  -- The text is theirs again: an edit is taken (this one changes nothing).
  and pg_temp.got('d_edit_after', 'code') = 'unchanged'
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_withdrawn' and case_id = pg_temp.got('case', 'case_id')::uuid),
  'who may ask for a rewriting gives it up while it is not a version, and the text is theirs again'
);
select ok(
  pg_temp.got('d_return3', 'code') = 'returned'
  and pg_temp.got('d_late', 'approval_id') is null
  and (select a.status = 'withdrawn' from public.approvals a where a.run_id = pg_temp.got('d_late', 'run_id')::uuid)
  and pg_temp.got('d_late_said', 'code') = 'run_not_found'
  and (select work = 'revise' and version = 4 and revisions = 3 from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid),
  'the answer of a rewriting given up, arriving while the next is in course, is never taken for it'
);

-- A rewriting that could not be made, put back to work, and then approved as the AI wrote it.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_failed', public.record_draft_work(pg_temp.got('d', 'draft_id')::uuid, (pg_temp.got('d_claim_fail', 'claim'))::integer,
  'failed', null, 'provider_refused'));
insert into res values ('d_after_fail', (select jsonb_build_object('status', status, 'work', work, 'note', revision_note, 'error', work_error)
  from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d_resume_attendant', public.resume_case_draft_work(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d_today_failed', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
insert into res values ('d_resume', public.resume_case_draft_work(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d_failed', 'code') = 'failed'
  and pg_temp.got('d_after_fail', 'status') = 'proposed' and pg_temp.got('d_after_fail', 'work') is null
  and pg_temp.got('d_after_fail', 'note') = 'Diga que o atraso passou de quatro horas.'
  and pg_temp.got('d_after_fail', 'error') = 'provider_refused'
  and pg_temp.got('d_today_failed', 'drafts_waiting') = '1'
  -- By who may ask for one: while it is made the text is nobody's to edit.
  and pg_temp.got('d_resume_attendant', 'code') = 'not_allowed'
  and pg_temp.got('d_resume', 'code') = 'resumed' and pg_temp.got('d_resume', 'work') = 'revise'
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_failed' and actor_type = 'system'
       and case_id = pg_temp.got('case', 'case_id')::uuid),
  'a rewriting that could not be made leaves the text as it was and the request for a person, who puts it back to work'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_claim5', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d', 'draft_id')::uuid)));
insert into res values ('d_work5', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d', 'draft_id')::uuid,
  (pg_temp.got('d_claim5', 'claim'))::integer) w));
insert into res values ('d_run3', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d', 'draft_id')::uuid,
  pg_temp.got('d_work5', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten'), 'observacoes', '[]'::jsonb)));
-- The worker's word got lost: whatever the next one says, the answer that waits is the rewriting.
insert into res values ('d_revised2', public.record_draft_work(pg_temp.got('d', 'draft_id')::uuid, (pg_temp.got('d_claim5', 'claim'))::integer,
  'failed', null, 'provider_unavailable'));
insert into res values ('d_read5', pg_temp.read_draft(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d_approve', pg_temp.approve(pg_temp.got('d', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d_work5', 'run_key') = 'draft:' || pg_temp.got('d', 'draft_id') || ':r3:0'
  and pg_temp.got('d_revised2', 'code') = 'revised' and pg_temp.got('d_read5', 'code') = 'checked'
  and (select body = pg_temp.text_of('restored') and based_on = 4 and author = 'ai'
       from public.case_draft_versions where draft_id = pg_temp.got('d', 'draft_id')::uuid and version = 5)
  and pg_temp.got('d_approve', 'code') = 'approved'
  -- Approved as the AI wrote it: the answer is kept as it came, marks and all, and is no correction.
  and (select status = 'approved' and not edited and final_output ->> 'texto' = pg_temp.text_of('rewritten')
       from public.approvals where id = pg_temp.got('d_run3', 'approval_id')::uuid)
  and (select status = 'approved' and approved_version = 5 and approved_body like '%Maria Teste, CPF 123.456.789-09, avisou%'
              and approved_body not like '%[nome%'
       from public.case_drafts where id = pg_temp.got('d', 'draft_id')::uuid),
  'the rewriting that waits is the draft''s whatever its worker said; approved as the AI wrote it, it counts as such, and the piece says the person''s own words'
);

-- ---------- A second look, an answer that is no piece, and a rewriting a lawyer wrote on from ----------

-- Another case of firm A, its piece started from the model as it is: nothing of the AI waits for anybody.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case2', public.create_case('bf100000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-21',
  '{"full_name": "João Teste", "cpf": "98765432100", "birth_date": "1990-01-15"}'::jsonb));
insert into res values ('p2', public.save_proceeding(pg_temp.got('case2', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case2', 'party_id')::uuid], array['af100000-0000-4000-8000-000000000001'::uuid]));
select public.save_case_person(pg_temp.got('case2', 'case_id')::uuid, pg_temp.got('case2', 'person_id')::uuid,
  '{"nationality": "brasileira", "marital_status": "solteiro", "profession": "engenheiro", "postal_code": "74000000", "street": "Avenida Central", "address_number": "20", "district": "Centro", "city": "Goiânia", "uf": "GO"}'::jsonb);
select public.set_party_claim(pg_temp.got('case2', 'case_id')::uuid, pg_temp.got('case2', 'party_id')::uuid, 1000000);
insert into res values ('d2', public.request_case_draft(pg_temp.got('p2', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'blank'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_read1', pg_temp.read_draft(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d2_edit', public.save_draft_version(pg_temp.got('d2', 'draft_id')::uuid, pg_temp.text_of('edited2'), 1));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_read2', pg_temp.read_draft(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d2_return', public.return_case_draft(pg_temp.got('d2', 'draft_id')::uuid, 2,
  'Diga que João Teste e Rita Lago perderam o casamento de um parente.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_claim1', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d2', 'draft_id')::uuid)));
insert into res values ('d2_look1', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d2', 'draft_id')::uuid,
  (pg_temp.got('d2_claim1', 'claim'))::integer) w));
insert into res values ('d2_keys1', (select revision_keys from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid));
reset role;
-- Somebody joins the case while the text is with the worker.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d2_rita', public.save_case_person(pg_temp.got('case2', 'case_id')::uuid, null, '{"full_name": "Rita Lago"}'::jsonb, 'claimant'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_look2', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d2', 'draft_id')::uuid,
  (pg_temp.got('d2_claim1', 'claim'))::integer) w));
insert into res values ('d2_keys2', (select revision_keys from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid));
-- The AI answers what is no piece.
insert into res values ('d2_run1', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d2', 'draft_id')::uuid,
  pg_temp.got('d2_look2', 'run_key'), jsonb_build_object('texto', 'Não sei.', 'observacoes', '[]'::jsonb)));
insert into res values ('d2_no_piece', public.record_draft_work(pg_temp.got('d2', 'draft_id')::uuid, (pg_temp.got('d2_claim1', 'claim'))::integer,
  'revised', pg_temp.got('d2_run1', 'run_id')::uuid));
insert into res values ('d2_after_no_piece', (select jsonb_build_object('status', status, 'work', work, 'note', revision_note,
  'error', work_error, 'unusable', unusable_runs, 'version', version) from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d2_read1', 'code') = 'checked' and pg_temp.got('d2_edit', 'code') = 'saved' and pg_temp.got('d2_read2', 'code') = 'checked'
  -- Sent back with nothing of the AI waiting: a request, and no decision of the queue.
  and pg_temp.got('d2_return', 'code') = 'returned'
  and pg_temp.got('d2_look1', 'body') like '%O voo foi cancelado. [nome 1], CPF [CPF 1], viajava com Rita Lago.%'
  and pg_temp.got('d2_look1', 'note') = 'Diga que [nome 1] e Rita Lago perderam o casamento de um parente.'
  and (select payload = '{"[nome 1]": "João Teste", "[CPF 1]": "111.444.777-35"}'::jsonb from res where name = 'd2_keys1')
  and pg_temp.got('d2_rita', 'ok') = 'true'
  and pg_temp.got('d2_look2', 'body') like '%O voo foi cancelado. [nome 1], CPF [CPF 1], viajava com [nome 2].%'
  and pg_temp.got('d2_look2', 'note') = 'Diga que [nome 1] e [nome 2] perderam o casamento de um parente.'
  and (select payload = '{"[nome 1]": "João Teste", "[CPF 1]": "111.444.777-35", "[nome 2]": "Rita Lago"}'::jsonb
       from res where name = 'd2_keys2')
  and pg_temp.got('d2_look1', 'run_key') = pg_temp.got('d2_look2', 'run_key'),
  'a second look at the same work reads under the marks of the first: somebody who joined the case meanwhile gets a mark of their own, and nobody else''s changes'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d2_cancel_attendant', public.cancel_case_draft(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d2_resume', public.resume_case_draft_work(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_claim2', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d2', 'draft_id')::uuid)));
insert into res values ('d2_look3', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d2', 'draft_id')::uuid,
  (pg_temp.got('d2_claim2', 'claim'))::integer) w));
insert into res values ('d2_run2', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d2', 'draft_id')::uuid,
  pg_temp.got('d2_look3', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten2'),
    'observacoes', '["Acrescentei que [nome 1] e [nome 2] perderam o casamento.", "   ", 7]'::jsonb)));
insert into res values ('d2_revised', public.record_draft_work(pg_temp.got('d2', 'draft_id')::uuid, (pg_temp.got('d2_claim2', 'claim'))::integer,
  'revised', pg_temp.got('d2_run2', 'run_id')::uuid));
insert into res values ('d2_read3', pg_temp.read_draft(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d2_run1', 'approval_id') is not null and pg_temp.got('d2_no_piece', 'code') = 'failed'
  and (select a.status = 'withdrawn' from public.approvals a where a.run_id = pg_temp.got('d2_run1', 'run_id')::uuid)
  and pg_temp.got('d2_after_no_piece', 'status') = 'proposed' and pg_temp.got('d2_after_no_piece', 'work') is null
  and pg_temp.got('d2_after_no_piece', 'note') is not null and pg_temp.got('d2_after_no_piece', 'error') = 'invalid_answer'
  and pg_temp.got('d2_after_no_piece', 'unusable') = '1' and pg_temp.got('d2_after_no_piece', 'version') = '2'
  -- A text a lawyer sent back is their work: who only attends does not give it up.
  and pg_temp.got('d2_cancel_attendant', 'code') = 'not_allowed'
  and pg_temp.got('d2_resume', 'code') = 'resumed' and pg_temp.got('d2_resume', 'work') = 'revise'
  and pg_temp.got('d2_look3', 'run_key') = 'draft:' || pg_temp.got('d2', 'draft_id') || ':r1:1',
  'an answer that is no piece is nobody''s to decide: it leaves the queue, the request stays for a person, and the next try is another run'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d2_edit2', public.save_draft_version(pg_temp.got('d2', 'draft_id')::uuid, pg_temp.text_of('edited_after2'), 3));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_read4', pg_temp.read_draft(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d2_approve', pg_temp.approve(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d2_revised', 'code') = 'revised' and pg_temp.got('d2_read3', 'code') = 'checked'
  and (select body = pg_temp.text_of('restored2') and based_on = 2
              and notes = array['Acrescentei que João Teste e Rita Lago perderam o casamento.']
       from public.case_draft_versions where draft_id = pg_temp.got('d2', 'draft_id')::uuid and version = 3)
  and pg_temp.got('d2_edit2', 'code') = 'saved' and pg_temp.got('d2_read4', 'code') = 'checked'
  and pg_temp.got('d2_approve', 'code') = 'approved'
  and (select status = 'approved' and edited and final_output ->> 'texto' = pg_temp.text_of('edited_after2')
       from public.approvals where id = pg_temp.got('d2_run2', 'approval_id')::uuid)
  and (select status = 'approved' and approved_version = 4 from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid),
  'what the AI said of its rewriting is kept with the words put back; a rewriting a lawyer wrote on from is approved as corrected, and counts as such'
);

-- ---------- A rewriting turned down in the queue, one nobody could make, and a draft given up ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case3', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-22',
  '{"full_name": "Lia Teste"}'::jsonb));
insert into res values ('p3', public.save_proceeding(pg_temp.got('case3', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb, array[pg_temp.got('case3', 'party_id')::uuid]));
insert into res values ('d3', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'blank'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_read1', pg_temp.read_draft(pg_temp.got('d3', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_return1', public.return_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 1, 'Conte os fatos na ordem em que aconteceram.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_claim1', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d3', 'draft_id')::uuid)));
insert into res values ('d3_look1', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d3', 'draft_id')::uuid,
  (pg_temp.got('d3_claim1', 'claim'))::integer) w));
insert into res values ('d3_run1', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d3', 'draft_id')::uuid,
  pg_temp.got('d3_look1', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten3'), 'observacoes', '[]'::jsonb)));
reset role;
-- Turned down in the queue before its worker said it was there.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d3_queue_reject', public.decide_approval(pg_temp.got('d3_run1', 'approval_id')::uuid, 'rejected', null,
  'Não era isso que foi pedido.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_after_reject', (select jsonb_build_object('status', status, 'work', work, 'note', revision_note, 'version', version)
  from public.case_drafts where id = pg_temp.got('d3', 'draft_id')::uuid));
insert into res values ('d3_late_word', public.record_draft_work(pg_temp.got('d3', 'draft_id')::uuid, (pg_temp.got('d3_claim1', 'claim'))::integer,
  'revised', pg_temp.got('d3_run1', 'run_id')::uuid));
reset role;
select ok(
  pg_temp.got('d3_read1', 'code') = 'checked' and pg_temp.got('d3_return1', 'code') = 'returned'
  and pg_temp.got('d3_run1', 'approval_id') is not null and pg_temp.got('d3_queue_reject', 'code') = 'rejected'
  and pg_temp.got('d3_after_reject', 'status') = 'proposed' and pg_temp.got('d3_after_reject', 'work') is null
  and pg_temp.got('d3_after_reject', 'note') is null and pg_temp.got('d3_after_reject', 'version') = '1'
  and pg_temp.got('d3_late_word', 'code') = 'not_working'
  and (select count(*) = 1 from public.case_draft_versions where draft_id = pg_temp.got('d3', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_rejected' and case_id = pg_temp.got('case3', 'case_id')::uuid),
  'a rewriting turned down before it was a version never becomes one: the text stays, and its worker''s late word finds its claim over'
);

-- A rewriting a lawyer already wrote on from: turning it down changes nothing of the text.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_return2', public.return_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 1, 'Diga que o atraso passou de quatro horas.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_claim2', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d3', 'draft_id')::uuid)));
insert into res values ('d3_look2', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d3', 'draft_id')::uuid,
  (pg_temp.got('d3_claim2', 'claim'))::integer) w));
insert into res values ('d3_run2', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d3', 'draft_id')::uuid,
  pg_temp.got('d3_look2', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten3'), 'observacoes', '[]'::jsonb)));
insert into res values ('d3_revised', public.record_draft_work(pg_temp.got('d3', 'draft_id')::uuid, (pg_temp.got('d3_claim2', 'claim'))::integer,
  'revised', pg_temp.got('d3_run2', 'run_id')::uuid));
insert into res values ('d3_read2', pg_temp.read_draft(pg_temp.got('d3', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_edit', public.save_draft_version(pg_temp.got('d3', 'draft_id')::uuid, pg_temp.text_of('written3'), 2));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_read3', pg_temp.read_draft(pg_temp.got('d3', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d3_queue_reject2', public.decide_approval(pg_temp.got('d3_run2', 'approval_id')::uuid, 'rejected', null,
  'O advogado já escreveu por cima.'));
reset role;
select ok(
  pg_temp.got('d3_return2', 'code') = 'returned'
  and pg_temp.got('d3_look2', 'run_key') = 'draft:' || pg_temp.got('d3', 'draft_id') || ':r2:0'
  and pg_temp.got('d3_revised', 'code') = 'revised' and pg_temp.got('d3_edit', 'code') = 'saved'
  and pg_temp.got('d3_read3', 'code') = 'checked' and pg_temp.got('d3_queue_reject2', 'code') = 'rejected'
  and (select status = 'proposed' and version = 3 and work is null and checked_version = 3
       from public.case_drafts where id = pg_temp.got('d3', 'draft_id')::uuid)
  and (select count(*) = 3 and count(*) filter (where restored) = 0 from public.case_draft_versions
       where draft_id = pg_temp.got('d3', 'draft_id')::uuid)
  and (select body = pg_temp.text_of('written3') from public.case_draft_versions
       where draft_id = pg_temp.got('d3', 'draft_id')::uuid and version = 3)
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_rejected' and case_id = pg_temp.got('case3', 'case_id')::uuid),
  'a rewriting a lawyer already wrote on from is turned down with no effect on the text: the lawyer''s version stays the latest'
);

-- A rewriting nobody could make: given up by the sweep after its attempts, with its answer left in the queue.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_return3', public.return_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 3, 'Acrescente que Lia Teste não teve assistência.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_claim3', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('d3', 'draft_id')::uuid)));
insert into res values ('d3_look3', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('d3', 'draft_id')::uuid,
  (pg_temp.got('d3_claim3', 'claim'))::integer) w));
-- Its run finished and waits, and no worker ever said so.
insert into res values ('d3_run3', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d3', 'draft_id')::uuid,
  pg_temp.got('d3_look3', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten3'), 'observacoes', '[]'::jsonb)));
reset role;
update public.case_drafts set work_attempts = 3, work_claimed_at = now() - interval '1 hour' where id = pg_temp.got('d3', 'draft_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_sweep1', jsonb_build_object('claimed', (select count(*) from public.claim_case_drafts(1, pg_temp.got('d3', 'draft_id')::uuid))));
insert into res values ('d3_after_sweep1', (select jsonb_build_object('status', d.status, 'work', d.work, 'error', d.work_error, 'note', d.revision_note,
  'keys', d.revision_keys,
  'answer', (select a.status from public.approvals a where a.run_id = pg_temp.got('d3_run3', 'run_id')::uuid))
  from public.case_drafts d where d.id = pg_temp.got('d3', 'draft_id')::uuid));
insert into res values ('d3_sweep2', jsonb_build_object('claimed', (select count(*) from public.claim_case_drafts(1, pg_temp.got('d3', 'draft_id')::uuid))));
insert into res values ('d3_after_sweep2', (select jsonb_build_object('answer', a.status) from public.approvals a
  where a.run_id = pg_temp.got('d3_run3', 'run_id')::uuid));
reset role;
select ok(
  pg_temp.got('d3_return3', 'code') = 'returned' and pg_temp.got('d3_run3', 'approval_id') is not null
  and pg_temp.got('d3_sweep1', 'claimed') = '0'
  and pg_temp.got('d3_after_sweep1', 'status') = 'proposed' and pg_temp.got('d3_after_sweep1', 'work') is null
  and pg_temp.got('d3_after_sweep1', 'error') = 'abandoned'
  and pg_temp.got('d3_after_sweep1', 'note') = 'Acrescente que Lia Teste não teve assistência.'
  -- The marks its text was handed over under stay with the request, for the next look at the same work.
  and (select payload -> 'keys' = '{"[nome 1]": "Lia Teste"}'::jsonb from res where name = 'd3_after_sweep1')
  -- Its answer was still waited for when this sweep looked, and is nobody's at the next.
  and pg_temp.got('d3_after_sweep1', 'answer') = 'pending'
  and pg_temp.got('d3_sweep2', 'claimed') = '0' and pg_temp.got('d3_after_sweep2', 'answer') = 'withdrawn'
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_failed' and actor_type = 'system'
       and case_id = pg_temp.got('case3', 'case_id')::uuid),
  'a rewriting no worker finished is given up after its attempts: the text stays with the request for a person, and its answer leaves the queue'
);

-- Asked again over the one that failed, and then given up with the draft.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_return4', public.return_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 3, 'Outro pedido: conte os fatos em ordem.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d3_cancel_attendant', public.cancel_case_draft(pg_temp.got('d3', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
reset role;
insert into res values ('d3_before_cancel', (select jsonb_build_object('work', work, 'note', revision_note, 'revisions', revisions,
  'keys', revision_keys) from public.case_drafts where id = pg_temp.got('d3', 'draft_id')::uuid));
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_cancel', public.cancel_case_draft(pg_temp.got('d3', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d3_return4', 'code') = 'returned'
  and pg_temp.got('d3_before_cancel', 'work') = 'revise' and pg_temp.got('d3_before_cancel', 'revisions') = '4'
  and pg_temp.got('d3_before_cancel', 'note') = 'Outro pedido: conte os fatos em ordem.'
  -- Another request is another list of marks: the one of the request that failed is not read under.
  and pg_temp.got('d3_before_cancel', 'keys') is null
  and pg_temp.got('d3_cancel_attendant', 'code') = 'not_allowed' and pg_temp.got('d3_cancel', 'code') = 'cancelled'
  and (select status = 'cancelled' and work is null and revision_note is null and revision_by is null
              and revision_at is null and revision_keys is null and revisions = 4
       from public.case_drafts where id = pg_temp.got('d3', 'draft_id')::uuid),
  'a new request takes the place of one that failed; a draft given up while the AI rewrites it keeps no request, and only who signs gives it up'
);

-- ---------- A chronology sent back while its worker still held it ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('statement2', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id')::uuid,
  null, 'Cheguei ao aeroporto às seis da manhã e o voo só saiu depois do meio-dia.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('s2_claim1', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('statement2', 'statement_id')::uuid)));
-- The run finished and waits; its worker has not said so yet.
insert into res values ('s2_run1', pg_temp.ran_statement('bf100000-0000-4000-8000-00000000000a', pg_temp.got('statement2', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 06:00: chegou ao aeroporto.", "perguntas": ""}'::jsonb, 1));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('s2_return', public.decide_approval(pg_temp.got('s2_run1', 'approval_id')::uuid, 'returned', null,
  'Diga também a hora em que o voo saiu.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('s2_late', public.record_statement_work(pg_temp.got('statement2', 'statement_id')::uuid, 1, 'proposed',
  pg_temp.got('s2_run1', 'run_id')::uuid));
insert into res values ('s2_claim2', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('statement2', 'statement_id')::uuid)));
insert into res values ('s2_failed', public.record_statement_work(pg_temp.got('statement2', 'statement_id')::uuid, 2, 'failed', null, 'provider_refused'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('s2_ask', public.request_statement_chronology(pg_temp.got('statement2', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('s2_claim3', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('statement2', 'statement_id')::uuid)));
insert into res values ('s2_work3', (select to_jsonb(w) from public.case_statement_to_process(pg_temp.got('statement2', 'statement_id')::uuid, 3) w));
reset role;
select ok(
  pg_temp.got('s2_run1', 'approval_id') is not null and pg_temp.got('s2_return', 'code') = 'returned'
  -- The worker that held the statement when it was sent back finds its claim over.
  and pg_temp.got('s2_late', 'code') = 'not_working'
  and pg_temp.got('s2_claim2', 'claim') = '2' and pg_temp.got('s2_failed', 'code') = 'failed'
  -- The request outlives a failure and a plain asking again: no proposal answered it yet.
  and pg_temp.got('s2_ask', 'code') = 'requested' and pg_temp.got('s2_claim3', 'claim') = '3'
  and pg_temp.got('s2_work3', 'firm_note') = 'Diga também a hora em que o voo saiu.'
  and pg_temp.got('s2_work3', 'returned_proposal') = '20/09/2026, 06:00: chegou ao aeroporto.',
  'a chronology sent back while its worker still held it is asked again as its own work, and what the firm asked outlives a failure of it'
);

-- A firm that lets ONE decide gets the request answered by itself: what it writes is the chronology, and the request is answered.
-- The firm lets ONE send the order of the facts to the client by itself (0016).
update public.firm_autonomy set mode = 'auto'
where org_id = 'bf100000-0000-4000-8000-00000000000a' and decision = 'chronology';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('s2_run3', pg_temp.ran_statement('bf100000-0000-4000-8000-00000000000a', pg_temp.got('statement2', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 06:00: chegou ao aeroporto. 12:10: o voo saiu.", "perguntas": ""}'::jsonb, 3));
insert into res values ('s2_alone', public.record_statement_work(pg_temp.got('statement2', 'statement_id')::uuid, 3, 'proposed',
  pg_temp.got('s2_run3', 'run_id')::uuid));
reset role;
update public.firm_autonomy set mode = 'approval'
where org_id = 'bf100000-0000-4000-8000-00000000000a' and decision = 'chronology';
select ok(
  pg_temp.got('s2_run3', 'approval_id') is null and pg_temp.got('s2_alone', 'code') = 'proposed'
  and (select chronology_status = 'approved' and chronology = '20/09/2026, 06:00: chegou ao aeroporto. 12:10: o voo saiu.'
              and returned_note is null and returned_run_id is null and returns = 1
       from public.case_statements where id = pg_temp.got('statement2', 'statement_id')::uuid),
  'the proposal of a task that acts by itself answers the request too, and the statement keeps no request'
);

-- ---------- The other firm's piece: a rewriting of the AI's own text, turned down, given up and dispensed with ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('pb', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb, array[pg_temp.got('case_b', 'party_id')::uuid]));
insert into res values ('template_b', public.save_draft_template('bf100000-0000-4000-8000-00000000000b', null,
  jsonb_build_object('name', 'Petição inicial', 'proceeding_kind', 'juizado', 'body', pg_temp.text_of('first'))));
insert into res values ('db', public.request_case_draft(pg_temp.got('pb', 'proceeding_id')::uuid, pg_temp.got('template_b', 'template_id')::uuid, 'ai'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_claim1', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('db', 'draft_id')::uuid)));
insert into res values ('db_work1', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('db', 'draft_id')::uuid,
  (pg_temp.got('db_claim1', 'claim'))::integer) w));
insert into res values ('db_run1', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000b', pg_temp.got('db', 'draft_id')::uuid,
  pg_temp.got('db_work1', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('first'), 'observacoes', '[]'::jsonb)));
insert into res values ('db_generated', public.record_draft_work(pg_temp.got('db', 'draft_id')::uuid, (pg_temp.got('db_claim1', 'claim'))::integer,
  'generated', pg_temp.got('db_run1', 'run_id')::uuid));
insert into res values ('db_read1', pg_temp.read_draft(pg_temp.got('db', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('db_return1', public.return_case_draft(pg_temp.got('db', 'draft_id')::uuid, 1, 'Diga que Paulo esperou seis horas no aeroporto.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_claim2', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('db', 'draft_id')::uuid)));
insert into res values ('db_work2', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('db', 'draft_id')::uuid,
  (pg_temp.got('db_claim2', 'claim'))::integer) w));
-- Its run finished and waits; its worker has not said so yet.
insert into res values ('db_run2', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000b', pg_temp.got('db', 'draft_id')::uuid,
  pg_temp.got('db_work2', 'run_key'),
  jsonb_build_object('texto', pg_temp.text_of('rewritten_b'), 'observacoes', '["Acrescentei a espera de [nome 1]."]'::jsonb)));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L, null, null)', pg_temp.got('db_run2', 'approval_id'), 'approved'),
  'P0001', 'not_proposed', 'the answer of a rewriting that is not the text of its piece yet is not approved from the queue'
);
select throws_ok(
  format('select public.decide_approval(%L, %L, null, %L)', pg_temp.got('db_run2', 'approval_id'), 'returned', 'Mude outra coisa também.'),
  'P0001', 'not_proposed', 'nor sent back from it'
);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_revised', public.record_draft_work(pg_temp.got('db', 'draft_id')::uuid, (pg_temp.got('db_claim2', 'claim'))::integer,
  'revised', pg_temp.got('db_run2', 'run_id')::uuid));
insert into res values ('db_read2', pg_temp.read_draft(pg_temp.got('db', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L, null, null)', pg_temp.got('db_run2', 'approval_id'), 'approved'),
  'P0001', 'approve_on_case', 'a rewriting is approved on its case, as a first text is, never from the queue'
);
-- Sent back again: the text is the AI's own, and the request names by the whole name who the text names by the first.
insert into res values ('db_return2', public.return_case_draft(pg_temp.got('db', 'draft_id')::uuid, 2,
  'Diga que Paulo Teste foi quem esperou, e tire a menção ao aeroporto.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_claim3', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('db', 'draft_id')::uuid)));
insert into res values ('db_work3', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('db', 'draft_id')::uuid,
  (pg_temp.got('db_claim3', 'claim'))::integer) w));
insert into res values ('db_run3', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000b', pg_temp.got('db', 'draft_id')::uuid,
  pg_temp.got('db_work3', 'run_key'),
  jsonb_build_object('texto', pg_temp.text_of('rewritten_b2'), 'observacoes', '["Tirei a menção ao aeroporto."]'::jsonb)));
insert into res values ('db_revised2', public.record_draft_work(pg_temp.got('db', 'draft_id')::uuid, (pg_temp.got('db_claim3', 'claim'))::integer,
  'revised', pg_temp.got('db_run3', 'run_id')::uuid));
insert into res values ('db_read3', pg_temp.read_draft(pg_temp.got('db', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('db_reject', public.reject_case_draft(pg_temp.got('db', 'draft_id')::uuid, 'Ficou pior do que estava.', 3));
reset role;
select ok(
  pg_temp.got('db_generated', 'code') = 'generated' and pg_temp.got('db_return1', 'code') = 'returned'
  and pg_temp.got('db_work2', 'note') = 'Diga que [nome 1] esperou seis horas no aeroporto.'
  and (select payload -> 'same' = '[]'::jsonb from res where name = 'db_work2')
  and pg_temp.got('db_revised', 'code') = 'revised' and pg_temp.got('db_read2', 'code') = 'checked'
  and (select body = pg_temp.text_of('restored_b') and based_on = 1 and run_id = pg_temp.got('db_run2', 'run_id')::uuid
              -- A name the text did not have and the answer has is said too: it is what was asked, and the lawyer reads it so.
              and notes = array['Conferir: "Paulo" não aparecia no texto anterior e aparece 1 vez neste.', 'Acrescentei a espera de Paulo.']
       from public.case_draft_versions where draft_id = pg_temp.got('db', 'draft_id')::uuid and version = 2)
  and pg_temp.got('db_return2', 'code') = 'returned'
  and (select status = 'returned' from public.approvals where id = pg_temp.got('db_run2', 'approval_id')::uuid)
  -- The text names him by the first name and the request by the whole name: two marks, and the worker is told they are one person.
  and pg_temp.got('db_work3', 'body') like '%O voo atrasou e [nome 1] esperou seis horas no aeroporto.%'
  and pg_temp.got('db_work3', 'note') = 'Diga que [nome 2] foi quem esperou, e tire a menção ao aeroporto.'
  and (select payload -> 'same' = '[["[nome 2]", "[nome 1]"]]'::jsonb from res where name = 'db_work3')
  and pg_temp.got('db_revised2', 'code') = 'revised' and pg_temp.got('db_read3', 'code') = 'checked'
  and (select body = pg_temp.text_of('restored_b2') and based_on = 2
              -- The words are counted where they are written: "Paulo" is still there, inside the whole name.
              and notes = array['Conferir: "Paulo Teste" não aparecia no texto anterior e aparece 1 vez neste.',
                                'Tirei a menção ao aeroporto.']
       from public.case_draft_versions where draft_id = pg_temp.got('db', 'draft_id')::uuid and version = 3),
  'a name written in more than one way has a mark for each and the AI is told they are one name; what it writes is the next version, with the words that appear more or fewer times said first'
);
select ok(
  pg_temp.got('db_reject', 'code') = 'rejected'
  and (select restored and based_on = 2 and run_id is null and body = pg_temp.text_of('restored_b')
       from public.case_draft_versions where draft_id = pg_temp.got('db', 'draft_id')::uuid and version = 4)
  -- The text put back is the AI's own rewriting of before: that answer is the draft's again, with what the AI said of it.
  and (select d.version = 4 and d.run_id = pg_temp.got('db_run2', 'run_id')::uuid and v.version = 2
              and v.notes[2] = 'Acrescentei a espera de Paulo.'
       from public.case_drafts d
       join public.case_draft_versions v on v.draft_id = d.id and v.run_id = d.run_id
       where d.id = pg_temp.got('db', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_rejected' and case_id = pg_temp.got('case_b', 'case_id')::uuid),
  'a rewriting of the AI''s own text, turned down, puts that text back with the answer it came from and what the AI said of it'
);

-- A rewriting whose work was given up while its answer waited, turned down in the queue: the request is over.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_read4', pg_temp.read_draft(pg_temp.got('db', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('db_return3', public.return_case_draft(pg_temp.got('db', 'draft_id')::uuid, 4, 'Diga que a companhia não deu assistência.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_claim4', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('db', 'draft_id')::uuid)));
insert into res values ('db_work4', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('db', 'draft_id')::uuid,
  (pg_temp.got('db_claim4', 'claim'))::integer) w));
insert into res values ('db_run4', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000b', pg_temp.got('db', 'draft_id')::uuid,
  pg_temp.got('db_work4', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten_b'), 'observacoes', '[]'::jsonb)));
reset role;
update public.case_drafts set work_attempts = 3, work_claimed_at = now() - interval '1 hour' where id = pg_temp.got('db', 'draft_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_sweep', jsonb_build_object('claimed', (select count(*) from public.claim_case_drafts(1, pg_temp.got('db', 'draft_id')::uuid))));
insert into res values ('db_after_sweep', (select jsonb_build_object('work', d.work, 'error', d.work_error, 'note', d.revision_note,
  'answer', (select a.status from public.approvals a where a.run_id = pg_temp.got('db_run4', 'run_id')::uuid))
  from public.case_drafts d where d.id = pg_temp.got('db', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('db_queue_reject', public.decide_approval(pg_temp.got('db_run4', 'approval_id')::uuid, 'rejected', null, 'Não era isso que foi pedido.'));
insert into res values ('db_after_queue_reject', (select jsonb_build_object('work', work, 'note', revision_note, 'version', version, 'revisions', revisions)
  from public.case_drafts where id = pg_temp.got('db', 'draft_id')::uuid));
insert into res values ('db_resume', public.resume_case_draft_work(pg_temp.got('db', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('db_read4', 'code') = 'checked' and pg_temp.got('db_return3', 'code') = 'returned'
  and pg_temp.got('db_work4', 'run_key') = 'draft:' || pg_temp.got('db', 'draft_id') || ':r3:0'
  and pg_temp.got('db_sweep', 'claimed') = '0'
  and pg_temp.got('db_after_sweep', 'work') is null and pg_temp.got('db_after_sweep', 'error') = 'abandoned'
  and pg_temp.got('db_after_sweep', 'note') = 'Diga que a companhia não deu assistência.'
  and pg_temp.got('db_after_sweep', 'answer') = 'pending'
  and pg_temp.got('db_queue_reject', 'code') = 'rejected'
  -- A person's word on the request: it is over, and a try again would only find this answer, turned down.
  and pg_temp.got('db_after_queue_reject', 'note') is null and pg_temp.got('db_after_queue_reject', 'work') is null
  and pg_temp.got('db_after_queue_reject', 'version') = '4' and pg_temp.got('db_after_queue_reject', 'revisions') = '3'
  and pg_temp.got('db_resume', 'code') = 'nothing_to_resume'
  and (select count(*) = 2 from public.case_events where kind = 'draft_revision_rejected' and case_id = pg_temp.got('case_b', 'case_id')::uuid),
  'the answer of a rewriting whose work was given up, turned down in the queue, ends the request and is told in the case: nothing is left to put back to work'
);

-- A rewriting dispensed with after its answer was already waiting: the answer leaves the queue with it.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('db_return4', public.return_case_draft(pg_temp.got('db', 'draft_id')::uuid, 4, 'Diga que a companhia não deu assistência.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_claim5', jsonb_build_object('claim', pg_temp.claim_draft(pg_temp.got('db', 'draft_id')::uuid)));
insert into res values ('db_work5', (select to_jsonb(w) - 'facts' - 'library' from public.case_draft_to_work(pg_temp.got('db', 'draft_id')::uuid,
  (pg_temp.got('db_claim5', 'claim'))::integer) w));
insert into res values ('db_run5', pg_temp.ran_draft('bf100000-0000-4000-8000-00000000000b', pg_temp.got('db', 'draft_id')::uuid,
  pg_temp.got('db_work5', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('rewritten_b'), 'observacoes', '[]'::jsonb)));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('db_withdraw', public.withdraw_draft_revision(pg_temp.got('db', 'draft_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('db_late_word', public.record_draft_work(pg_temp.got('db', 'draft_id')::uuid, (pg_temp.got('db_claim5', 'claim'))::integer,
  'revised', pg_temp.got('db_run5', 'run_id')::uuid));
reset role;
select ok(
  pg_temp.got('db_return4', 'code') = 'returned'
  and pg_temp.got('db_work5', 'run_key') = 'draft:' || pg_temp.got('db', 'draft_id') || ':r4:0'
  and pg_temp.got('db_run5', 'approval_id') is not null and pg_temp.got('db_withdraw', 'code') = 'withdrawn'
  and (select status = 'withdrawn' and decision_note = 'O ajuste pedido foi dispensado.'
              and decided_by = 'af100000-0000-4000-8000-000000000004'
       from public.approvals where id = pg_temp.got('db_run5', 'approval_id')::uuid)
  and pg_temp.got('db_late_word', 'code') = 'not_working'
  and (select status = 'proposed' and version = 4 and work is null and revision_note is null and revision_keys is null
              and run_id = pg_temp.got('db_run2', 'run_id')::uuid
       from public.case_drafts where id = pg_temp.got('db', 'draft_id')::uuid)
  and (select count(*) = 4 from public.case_draft_versions where draft_id = pg_temp.got('db', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_revision_withdrawn' and case_id = pg_temp.got('case_b', 'case_id')::uuid),
  'a rewriting dispensed with after its answer was waiting takes the answer out of the queue: the text is the lawyer''s again, and the late word of its worker finds nothing to do'
);

-- ---------- The other firm, and the measure ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_statement', public.add_case_statement(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('case_b', 'party_id')::uuid,
  null, 'Meu voo foi cancelado e só embarquei no dia seguinte, sem assistência da companhia.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_claim', jsonb_build_object('claim', pg_temp.claim_statement(pg_temp.got('b_statement', 'statement_id')::uuid)));
insert into res values ('b_run', pg_temp.ran_statement('bf100000-0000-4000-8000-00000000000b', pg_temp.got('b_statement', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026: o voo foi cancelado.", "perguntas": ""}'::jsonb, 1));
insert into res values ('b_proposed', public.record_statement_work(pg_temp.got('b_statement', 'statement_id')::uuid, 1, 'proposed',
  pg_temp.got('b_run', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('b_return_by_a', public.decide_approval(pg_temp.got('b_run', 'approval_id')::uuid, 'returned', null,
  'Mude a data desta cronologia.'));
insert into res values ('seen_by_a', jsonb_build_object(
  'statements', (select count(*) from public.case_statements where org_id = 'bf100000-0000-4000-8000-00000000000b'),
  'drafts', (select count(*) from public.case_drafts where org_id = 'bf100000-0000-4000-8000-00000000000b'),
  'versions', (select count(*) from public.case_draft_versions where org_id = 'bf100000-0000-4000-8000-00000000000b'),
  'approvals', (select count(*) from public.approvals where org_id = 'bf100000-0000-4000-8000-00000000000b')));
insert into res values ('b_draft_by_a', public.return_case_draft(pg_temp.got('db', 'draft_id')::uuid, 4, 'Mude o segundo parágrafo, por favor.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_return', public.decide_approval(pg_temp.got('b_run', 'approval_id')::uuid, 'returned', null,
  'Diga também que não houve assistência.'));
insert into res values ('seen_by_b', jsonb_build_object(
  'drafts', (select count(*) from public.case_drafts),
  'versions', (select count(*) from public.case_draft_versions),
  'returned', (select count(*) from public.approvals where status = 'returned')));
select throws_ok(
  format('select public.withdraw_draft_revision(%L)', pg_temp.got('d', 'draft_id')),
  'P0002', 'case_not_found', 'nobody gives up a rewriting of another firm''s piece'
);
reset role;
select ok(
  pg_temp.got('b_proposed', 'code') = 'proposed'
  and pg_temp.got('b_return_by_a', 'code') = 'not_found'
  and pg_temp.got('seen_by_a', 'statements') = '0' and pg_temp.got('seen_by_a', 'approvals') = '0'
  and pg_temp.got('seen_by_a', 'drafts') = '0' and pg_temp.got('seen_by_a', 'versions') = '0'
  and pg_temp.got('b_draft_by_a', 'code') = 'draft_not_found'
  and pg_temp.got('b_return', 'code') = 'returned'
  -- Its own piece and the four texts of it, and the three answers it sent back: nothing of the other firm's.
  and pg_temp.got('seen_by_b', 'drafts') = '1' and pg_temp.got('seen_by_b', 'versions') = '4' and pg_temp.got('seen_by_b', 'returned') = '3'
  and (select returns = 1 and returned_note = 'Diga também que não houve assistência.' and work = 'chronology'
       from public.case_statements where id = pg_temp.got('b_statement', 'statement_id')::uuid),
  'each firm sends back its own answers and reads its own: nothing of one reaches the other'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('measure', public.admin_ai_task_accuracy(90));
reset role;
select ok(
  (select t ->> 'returned' = '3' and (t ->> 'revisable')::boolean and t ->> 'approved' = '1'
   from res, jsonb_array_elements(res.payload -> 'tasks') t where res.name = 'measure' and t ->> 'task' = 'caso.relato.cronologia')
  and (select t ->> 'returned' = '3' and t ->> 'rejected' = '5' and t ->> 'approved' = '1' and t ->> 'approvedEdited' = '1'
              and (t ->> 'revisable')::boolean
       from res, jsonb_array_elements(res.payload -> 'tasks') t where res.name = 'measure' and t ->> 'task' = 'caso.peca.minuta')
  and (select t ->> 'returned' = '0' and not (t ->> 'revisable')::boolean
       from res, jsonb_array_elements(res.payload -> 'tasks') t where res.name = 'measure' and t ->> 'task' = 'plataforma.verificacao'),
  'the operator''s measure counts the answers sent back beside the ones approved, corrected and turned down'
);
select ok(
  (select count(*) > 10 and count(*) filter (where data ? 'final_output' or data ? 'decision_note') = 0
          and count(*) filter (where data -> 'withheld' = '["final_output", "decision_note"]'::jsonb) = count(*)
          and count(*) filter (where data ->> 'status' = 'returned' and data ->> 'decided_by' is not null) >= 4
   from public.record_versions where table_name = 'approvals'),
  'the versions of an answer keep who decided it, how and when, and never the answer or the words of the decision: what a lawyer asked to change is not the operator''s to read'
);

select * from finish();
rollback;
