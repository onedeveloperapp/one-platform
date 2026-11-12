begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- O nome que a identidade traz (0236). Lia typed "Lidya" in the chat and
-- sent her identity, which says Nidya Farias de Castro: the identity is
-- accepted and its name, CPF and birth date become hers. A second identity
-- in yet another name is then another person's, refused for it, and so is
-- one in another name than Maria's, whose name the registry found on her
-- CPF. The case opened in the chat needs no link in the firm's own text.
-- Nothing of it reaches the other firm.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2360000-0000-4000-8000-000000000001', 'ana@lima-nome.invalid', 'Ana Lima'),
  ('a2360000-0000-4000-8000-000000000002', 'duda@rocha-nome.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2360000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-nome', 'a2360000-0000-4000-8000-000000000001'),
  ('b2360000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-nome', 'a2360000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2360000-0000-4000-8000-00000000000a', 'a2360000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2360000-0000-4000-8000-00000000000b', 'a2360000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2360000-0000-4000-8000-000000000001', 'b2360000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents');
insert into public.people (id, org_id, full_name) values
  ('d2360000-0000-4000-8000-000000000001', 'b2360000-0000-4000-8000-00000000000a', 'Lidya');
insert into public.people (id, org_id, full_name, cpf, cpf_name_matches) values
  ('d2360000-0000-4000-8000-000000000002', 'b2360000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', true);
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2360000-0000-4000-8000-000000000001', 'b2360000-0000-4000-8000-00000000000a', 'c2360000-0000-4000-8000-000000000001',
   'd2360000-0000-4000-8000-000000000001', 'claimant'),
  ('e2360000-0000-4000-8000-000000000002', 'b2360000-0000-4000-8000-00000000000a', 'c2360000-0000-4000-8000-000000000001',
   'd2360000-0000-4000-8000-000000000002', 'claimant');

/** An identity of a party, checked as the model answers it: legible, whole, in the name given. */
create function pg_temp.identity(id uuid, party uuid, holder text, cpf text, born text) returns text language plpgsql as $$
declare
  run uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at)
  values (id, 'b2360000-0000-4000-8000-00000000000a', 'client', 'org/x/' || id, 'rg.jpg', 'image/jpeg', 100,
          'stored', repeat('c', 64), 100, 'image/jpeg', 1, now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status)
  values (id, 'b2360000-0000-4000-8000-00000000000a', 'c2360000-0000-4000-8000-000000000001', party, id, 'identity',
          'client', 'received');
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at, subject_type, subject_id)
  values ('b2360000-0000-4000-8000-00000000000a', 'caso.documento.conferencia',
          (select v.id from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active),
          'fake', 'fake', repeat('a', 64), 'succeeded', now(), 'case_document', id::text)
  returning ai_runs.id into run;
  return public.apply_document_check(run, jsonb_build_object(
    'decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'RG', 'legivel', true,
    'nome_no_documento', holder, 'confere_com_a_pessoa', 'nao',
    'dados_lidos', jsonb_build_object('nome_completo', holder, 'cpf', cpf, 'data_nascimento', born,
      'nacionalidade', 'brasileira', 'cep', '', 'logradouro', '', 'numero', '', 'complemento', '', 'bairro', '',
      'cidade', '', 'uf', ''),
    'observacoes', '', 'trechos', '[]'::jsonb), 'ai');
end;
$$;

select is(
  pg_temp.identity('a9360000-0000-4000-8000-000000000001', 'e2360000-0000-4000-8000-000000000001',
                   'NIDYA FARIAS DE CASTRO', '12345678909', '1990-05-04'),
  'accepted', 'an identity in another name than the one typed in the chat is accepted');

select ok(
  (select full_name = 'Nidya Farias de Castro' and cpf = '12345678909' and birth_date = '1990-05-04'
          and read_fields ? 'full_name'
   from public.people where id = 'd2360000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events where kind = 'person_named_by_document'
              and data ->> 'document' = 'a9360000-0000-4000-8000-000000000001'),
  'its name, CPF and birth date become the person''s, on the record');

select is(
  pg_temp.identity('a9360000-0000-4000-8000-000000000002', 'e2360000-0000-4000-8000-000000000001',
                   'CARLOS SOUZA', '', ''),
  'rejected', 'once a document settled the name, an identity in another one is refused for it');
select ok(
  (select rejected_reason = 'O nome neste documento não é o de Nidya. Envie o documento de identidade de Nidya.'
       from public.case_documents where id = 'a9360000-0000-4000-8000-000000000002')
  and (select full_name = 'Nidya Farias de Castro' from public.people where id = 'd2360000-0000-4000-8000-000000000001'),
  'the refusal says whose identity to send, and the name stays');

select ok(
  pg_temp.identity('a9360000-0000-4000-8000-000000000003', 'e2360000-0000-4000-8000-000000000002',
                   'JOANA TESTE', '', '') = 'rejected'
  and (select full_name = 'Maria Teste' from public.people where id = 'd2360000-0000-4000-8000-000000000002'),
  'a name the registry found on the CPF is settled too');

select ok(
  (select required = '{}' and 'link' = any (optional) and strpos(example, '{link}') = 0
   from public.one_messages where key = 'link_steps'),
  'the firm''s text of the case opened in the chat needs no link');

select ok(
  (select count(*) = 1 and bool_and(strpos(system_prompt, 'Nunca recuse um documento de identidade pelo nome') > 0)
   from public.prompt_versions where task = 'caso.documento.conferencia' and is_active),
  'the check in force never refuses an identity for its name');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2360000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.people where id = 'd2360000-0000-4000-8000-000000000001')
  + (select count(*)::integer from public.case_events where kind = 'person_named_by_document'),
  0, 'another firm reads neither the person nor the record');
reset role;

select * from finish();
rollback;
