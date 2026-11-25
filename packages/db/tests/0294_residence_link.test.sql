begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- A proof of address in somebody else's name, and the document of the client's link to its holder (0294). Lia's bill
-- is in her mother's name, so she owes a residence declaration. A birth certificate that names Lia and nobody else is
-- refused, saying whose name it lacks; one that names Lia and her mother settles the declaration, and the filing no
-- longer waits for it. A person of the firm refuses it after: the declaration is owed again. A person accepts another:
-- it settles it, whatever ONE read; the bill refused after, the declaration ends with it. In Rui's case the marriage
-- certificate came first, and the bill in his wife's name is settled as soon as it is accepted. Nothing of it reaches
-- the other firm, and nobody calls the rule directly.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2940000-0000-4000-8000-000000000001', 'ana@lima-vinculo.invalid', 'Ana Lima'),
  ('a2940000-0000-4000-8000-000000000002', 'duda@rocha-vinculo.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2940000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-vinculo', 'a2940000-0000-4000-8000-000000000001'),
  ('b2940000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-vinculo', 'a2940000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2940000-0000-4000-8000-00000000000a', 'a2940000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2940000-0000-4000-8000-00000000000b', 'a2940000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2940000-0000-4000-8000-000000000001', 'b2940000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents'),
  ('c2940000-0000-4000-8000-000000000002', 'b2940000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'documents'),
  ('c2940000-0000-4000-8000-00000000000b', 'b2940000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'documents');
insert into public.people (id, org_id, full_name, cpf, updated_via) values
  ('d2940000-0000-4000-8000-000000000001', 'b2940000-0000-4000-8000-00000000000a', 'Lia Teste', '52998224725', 'firm'),
  ('d2940000-0000-4000-8000-000000000002', 'b2940000-0000-4000-8000-00000000000a', 'Rui Exemplo Prado', '11144477735', 'firm'),
  ('d2940000-0000-4000-8000-00000000000b', 'b2940000-0000-4000-8000-00000000000b', 'Bia Torres', '12345678909', 'firm');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2940000-0000-4000-8000-000000000001', 'b2940000-0000-4000-8000-00000000000a', 'c2940000-0000-4000-8000-000000000001',
   'd2940000-0000-4000-8000-000000000001', 'claimant'),
  ('e2940000-0000-4000-8000-000000000002', 'b2940000-0000-4000-8000-00000000000a', 'c2940000-0000-4000-8000-000000000002',
   'd2940000-0000-4000-8000-000000000002', 'claimant'),
  ('e2940000-0000-4000-8000-00000000000b', 'b2940000-0000-4000-8000-00000000000b', 'c2940000-0000-4000-8000-00000000000b',
   'd2940000-0000-4000-8000-00000000000b', 'claimant');

/** A document of a case of firm A, sent by the client: its file, the document and ONE's run of its check. */
create function pg_temp.sent(id uuid, target_case uuid, party uuid, kind text) returns uuid language plpgsql as $$
declare
  run uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at)
  values (id, 'b2940000-0000-4000-8000-00000000000a', 'client', 'org/x/' || id, 'documento.jpg', 'image/jpeg', 100,
          'stored', repeat('c', 64), 100, 'image/jpeg', 1, now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status)
  values (id, 'b2940000-0000-4000-8000-00000000000a', target_case, party, id, kind, 'client', 'received');
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at, subject_type, subject_id)
  values ('b2940000-0000-4000-8000-00000000000a', 'caso.documento.conferencia',
          (select v.id from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active),
          'fake', 'fake', repeat('a', 64), 'succeeded', now(), 'case_document', id::text)
  returning ai_runs.id into run;
  return run;
end;
$$;

/** ONE's answer on a bill: in a name, of this month, in Goiânia. */
create function pg_temp.bill(id uuid, target_case uuid, party uuid, holder text) returns text language plpgsql as $$
begin
  return public.apply_document_check(pg_temp.sent(id, target_case, party, 'address_proof'), jsonb_build_object(
    'decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'conta de luz', 'legivel', true,
    'nome_no_documento', holder, 'confere_com_a_pessoa', 'nao',
    'dados_lidos', jsonb_build_object('nome_completo', '', 'cpf', '', 'data_nascimento', '', 'nacionalidade', '',
      'cep', '74000000', 'logradouro', 'Rua das Flores', 'numero', '10', 'complemento', '', 'bairro', 'Centro',
      'cidade', 'Goiânia', 'uf', 'GO', 'data_referencia', to_char(current_date, 'YYYY-MM-DD')),
    'nomes_no_documento', '[]'::jsonb, 'observacoes', '', 'trechos', '[]'::jsonb), 'ai');
end;
$$;

/** ONE's answer on a document of the link: the names written on it. The run is kept on the document, as the backend does. */
create function pg_temp.link(doc uuid, target_case uuid, party uuid, names jsonb) returns text language plpgsql as $$
declare
  run uuid := pg_temp.sent(doc, target_case, party, 'residence_link');
  answer jsonb := jsonb_build_object(
    'decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'certidão', 'legivel', true,
    'nome_no_documento', '', 'confere_com_a_pessoa', 'sim',
    'dados_lidos', jsonb_build_object('nome_completo', '', 'cpf', '', 'data_nascimento', '', 'nacionalidade', '',
      'cep', '', 'logradouro', '', 'numero', '', 'complemento', '', 'bairro', '', 'cidade', '', 'uf', '', 'data_referencia', ''),
    'nomes_no_documento', names, 'observacoes', '', 'trechos', '[]'::jsonb);
begin
  update public.ai_runs set output = answer where ai_runs.id = run;
  update public.case_documents set check_run_id = run where case_documents.id = doc;
  return public.apply_document_check(run, answer, 'ai');
end;
$$;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

-- ---------- The rule of the names, and what the check reads ----------

select ok(
  public.residence_link_names_fit('["LIA TESTE", "Maria de Souza Teste"]', 'Lia Teste', 'Maria Souza Teste')
  and not public.residence_link_names_fit('["Lia Teste"]', 'Lia Teste', 'Maria Souza Teste')
  and not public.residence_link_names_fit(null, 'Lia Teste', 'Maria Souza Teste'),
  'a document of the link fits when it names the person and the holder, each by the names'' rule');
select ok(
  (select (v.output_schema -> 'required') ? 'nomes_no_documento' and strpos(v.system_prompt, 'nomes_no_documento') > 0
   from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active)
  and (select (value -> 'check_kinds') ? 'residence_link' from public.platform_settings where key = 'document_checks')
  and (select (value #> '{package_kinds,person}') ? 'residence_link' from public.platform_settings where key = 'case_advance'),
  'ONE checks it, reads the names on it, and the filing package takes it as a paper of the person');

-- ---------- Lia: her bill in her mother's name ----------

select is(pg_temp.bill('f2940000-0000-4000-8000-000000000001', 'c2940000-0000-4000-8000-000000000001',
                       'e2940000-0000-4000-8000-000000000001', 'MARIA SOUZA TESTE'),
  'accepted', 'a bill in her mother''s name is accepted');
select is((select status from public.residence_declarations where person_id = 'd2940000-0000-4000-8000-000000000001'),
  'open', 'and she owes a residence declaration');

select is(pg_temp.link('f2940000-0000-4000-8000-000000000002', 'c2940000-0000-4000-8000-000000000001',
                       'e2940000-0000-4000-8000-000000000001', '["Lia Teste"]'),
  'rejected', 'a certificate that names only her is refused');
select ok(
  (select strpos(rejected_reason, 'Maria Souza Teste') > 0 and strpos(rejected_reason, 'declaração de residência') > 0
   from public.case_documents where id = 'f2940000-0000-4000-8000-000000000002'),
  'saying whose name it lacks, and that she may sign the declaration instead');

select is(pg_temp.link('f2940000-0000-4000-8000-000000000003', 'c2940000-0000-4000-8000-000000000001',
                       'e2940000-0000-4000-8000-000000000001', '["LIA TESTE", "MARIA SOUZA TESTE"]'),
  'accepted', 'her birth certificate, naming her and her mother, is accepted');
select is(
  (select status || ' ' || link_document_id::text from public.residence_declarations
   where person_id = 'd2940000-0000-4000-8000-000000000001'),
  'linked f2940000-0000-4000-8000-000000000003', 'and settles the declaration');
select is(public.residence_declaration_blocker('c2940000-0000-4000-8000-000000000001', 'd2940000-0000-4000-8000-000000000001'),
  null, 'the filing no longer waits for it');

-- A person of the firm refuses the certificate after: the declaration is owed again.
select pg_temp.sign_in('a2940000-0000-4000-8000-000000000001');
set local role authenticated;
select public.decide_case_document('f2940000-0000-4000-8000-000000000003', 'rejected', 'A certidão está cortada.');
reset role;
select is(
  (select status || ' ' || coalesce(link_document_id::text, 'sem documento') from public.residence_declarations
   where person_id = 'd2940000-0000-4000-8000-000000000001'),
  'open sem documento', 'the certificate refused after, the declaration is owed again');

-- A person accepts another one: it settles it, whatever ONE read; the bill refused after, the declaration ends.
select pg_temp.sent('f2940000-0000-4000-8000-000000000004', 'c2940000-0000-4000-8000-000000000001',
                    'e2940000-0000-4000-8000-000000000001', 'residence_link');
set local role authenticated;
select public.decide_case_document('f2940000-0000-4000-8000-000000000004', 'accepted');
reset role;
select is((select status from public.residence_declarations where person_id = 'd2940000-0000-4000-8000-000000000001'),
  'linked', 'a document of the link a person accepts settles it');
set local role authenticated;
select public.decide_case_document('f2940000-0000-4000-8000-000000000001', 'rejected', 'A conta é de outro endereço.');
reset role;
select is((select status from public.residence_declarations where person_id = 'd2940000-0000-4000-8000-000000000001'),
  'void', 'the bill refused, the declaration the link settled ends');

-- ---------- Rui: the marriage certificate came first ----------

select is(pg_temp.link('f2940000-0000-4000-8000-000000000005', 'c2940000-0000-4000-8000-000000000002',
                       'e2940000-0000-4000-8000-000000000002', '["Rui Exemplo Prado", "Clara Lopes Prado"]'),
  'accepted', 'a marriage certificate with no declaration owed yet is accepted and kept');
select pg_temp.bill('f2940000-0000-4000-8000-000000000006', 'c2940000-0000-4000-8000-000000000002',
                    'e2940000-0000-4000-8000-000000000002', 'CLARA LOPES PRADO');
select is(
  (select status || ' ' || link_document_id::text from public.residence_declarations
   where person_id = 'd2940000-0000-4000-8000-000000000002'),
  'linked f2940000-0000-4000-8000-000000000005', 'his bill in his wife''s name is settled as soon as it is accepted');

-- ---------- Each firm its own, and the backend's alone ----------

select pg_temp.sign_in('a2940000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.case_residence('c2940000-0000-4000-8000-000000000002'), '[]'::jsonb,
  'firm B reads nothing of firm A''s declarations');
select throws_ok($$select public.settle_residence_by_link('c2940000-0000-4000-8000-000000000002',
  'd2940000-0000-4000-8000-000000000002', 'person')$$, '42501', null, 'nobody of a firm calls the rule directly');
reset role;

select * from finish();
rollback;
