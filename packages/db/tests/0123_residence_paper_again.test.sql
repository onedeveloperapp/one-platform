begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- A declaração que deixou de ser necessária (0124). Maria's bill in her
-- mother's name owes a declaration; ONE issued it and she signed it; then the
-- bill is refused after all: the paper goes with the declaration, its PDFs go
-- to no court, and a new bill in her aunt's name owes a new declaration, which
-- ONE issues again and whose signature the old one never stands for. Nothing
-- of it reaches the other firm.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1230000-0000-4000-8000-000000000001', 'ana@lima-papel.invalid', 'Ana Lima'),
  ('a1230000-0000-4000-8000-000000000002', 'duda@rocha-papel.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1230000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-papel', 'a1230000-0000-4000-8000-000000000001'),
  ('b1230000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-papel', 'a1230000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1230000-0000-4000-8000-00000000000a', 'a1230000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1230000-0000-4000-8000-00000000000b', 'a1230000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents');
insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('d1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '1985-04-02');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001',
   'd1230000-0000-4000-8000-000000000001', 'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001',
   'd1230000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-da-maria-papel', 'UTF8')), 'hex'),
   now() + interval '30 days', now());
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'planned');
update public.proceedings set system = 'projudi', system_approved_at = now(), system_approved_by = 'a1230000-0000-4000-8000-000000000001'
where id = 'f1230000-0000-4000-8000-000000000001';
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1230000-0000-4000-8000-000000000001', 'e1230000-0000-4000-8000-000000000001', 'b1230000-0000-4000-8000-00000000000a');

/** A bill of Maria's, checked as the model answers it: accepted, in the name given. */
create function pg_temp.bill(id uuid, holder text) returns text language plpgsql as $$
declare
  run uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at)
  values (id, 'b1230000-0000-4000-8000-00000000000a', 'client', 'org/x/' || id, 'conta.pdf', 'application/pdf', 100,
          'stored', repeat('c', 64), 100, 'application/pdf', 1, now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status)
  values (id, 'b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001',
          'e1230000-0000-4000-8000-000000000001', id, 'address_proof', 'client', 'received');
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at, subject_type, subject_id)
  values ('b1230000-0000-4000-8000-00000000000a', 'caso.documento.conferencia',
          (select v.id from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active),
          'fake', 'fake', repeat('a', 64), 'succeeded', now(), 'case_document', id::text)
  returning ai_runs.id into run;
  return public.apply_document_check(run, jsonb_build_object(
    'decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'conta de luz', 'legivel', true,
    'nome_no_documento', holder, 'confere_com_a_pessoa', 'nao',
    'dados_lidos', jsonb_build_object('nome_completo', '', 'cpf', '', 'data_nascimento', '', 'nacionalidade', '',
      'cep', '74000000', 'logradouro', 'RUA DAS FLORES', 'numero', '10', 'complemento', '', 'bairro', 'CENTRO',
      'cidade', 'GOIÂNIA', 'uf', 'GO'),
    'observacoes', '', 'trechos', '[]'::jsonb), 'ai');
end;
$$;

/** The paper ONE issued for Maria's declaration, sent by gov.br and, when said, signed with a copy of its own. */
create function pg_temp.paper(issued uuid, signed uuid) returns void language plpgsql as $$
declare
  envelope uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at)
  select f, 'b1230000-0000-4000-8000-00000000000a', 'paper', 'org/x/' || f, 'declaracao.pdf', 'application/pdf', 100,
         'stored', repeat('d', 64), 100, 'application/pdf', 1, now() + interval '1 hour', now()
  from unnest(array_remove(array[issued, signed], null)) f;
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
  select f, 'b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001', f, 'residence_declaration',
         'firm', 'accepted', now()
  from unnest(array_remove(array[issued, signed], null)) f;
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, signed_document_id)
  values ('b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001', issued, 'govbr',
          case when signed is null then 'pending' else 'signed' end,
          jsonb_build_array(jsonb_build_object('position', 1, 'person_id', 'd1230000-0000-4000-8000-000000000001',
            'name', 'Maria Teste', 'sign_url', null, 'signed_at', null)), signed)
  returning id into envelope;
  insert into public.case_papers (org_id, case_id, person_id, kind, document_id, envelope_id)
  values ('b1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000001',
          'd1230000-0000-4000-8000-000000000001', 'declaracao_residencia', issued, envelope);
end;
$$;

-- Her mother's bill, answered, issued and signed.
select pg_temp.bill('a9230000-0000-4000-8000-000000000001', 'JOANA TESTE');
update public.residence_declarations set relation = 'mae', answered_source = 'client', answered_at = now()
where person_id = 'd1230000-0000-4000-8000-000000000001';
select pg_temp.paper('a8230000-0000-4000-8000-000000000001', 'a8230000-0000-4000-8000-000000000002');
select is(public.filing_blocker('f1230000-0000-4000-8000-000000000001'), null,
  'signed, the declaration lets the filing go');

-- The bill is refused after all.
update public.case_documents set status = 'rejected', rejected_reason = 'A conta está cortada.'
where id = 'a9230000-0000-4000-8000-000000000001';
select ok(
  not exists (select 1 from public.case_papers where person_id = 'd1230000-0000-4000-8000-000000000001')
    and (select count(*) = 2 and bool_and(status = 'rejected' and rejected_reason ~ 'deixou de ser necessária')
         from public.case_documents where kind = 'residence_declaration'),
  'its paper goes with the declaration, and the PDF issued and the copy signed go to no court'
);

-- A bill in her aunt's name owes a new declaration, issued again once she answers.
select pg_temp.bill('a9230000-0000-4000-8000-000000000003', 'LIA TESTE');
update public.residence_declarations set relation = 'outro', relation_note = 'minha tia', answered_source = 'client',
  answered_at = now()
where person_id = 'd1230000-0000-4000-8000-000000000001' and status = 'open';
select ok(
  exists (select 1 from public.case_papers_due('c1230000-0000-4000-8000-000000000001') where kind = 'declaracao_residencia')
    and public.filing_blocker('f1230000-0000-4000-8000-000000000001') = 'residence_declaration_unsigned',
  'a declaration owed again is due again, and the filing waits for its own signature'
);

-- A paper of an older declaration left behind is no signature of the new one.
select pg_temp.paper('a8230000-0000-4000-8000-000000000003', 'a8230000-0000-4000-8000-000000000004');
update public.case_papers set created_at = now() - interval '1 day'
where document_id = 'a8230000-0000-4000-8000-000000000003';
select is(public.filing_blocker('f1230000-0000-4000-8000-000000000001'), 'residence_declaration_unsigned',
  'a signed paper issued before the declaration was owed stands for nothing');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a1230000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.case_residence('c1230000-0000-4000-8000-000000000001'), '[]'::jsonb,
  'another firm reads nothing of the case''s declarations');
reset role;

select * from finish();
rollback;
