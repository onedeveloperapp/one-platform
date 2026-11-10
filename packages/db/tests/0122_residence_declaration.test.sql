begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- A declaração de residência (0123). Lima accepts a bill in somebody else's
-- name (the default): ONE's check takes Maria's bill in her mother's name,
-- writes its address, and owes the declaration; Maria says on her link who
-- the holder is; the papers are a queue (her power of attorney, missing data,
-- holds nothing back), the declaration is issued, signed, and the filing no
-- longer waits. Rui's address on record is of another city: it waits for a
-- person, and a lawyer goes on without the declaration. Rocha refuses such
-- bills. Nothing of one firm reaches the other.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1220000-0000-4000-8000-000000000001', 'ana@lima-residencia.invalid', 'Ana Lima'),
  ('a1220000-0000-4000-8000-000000000002', 'caio@lima-residencia.invalid', 'Caio Lima'),
  ('a1220000-0000-4000-8000-000000000003', 'bia@lima-residencia.invalid', 'Bia Lima'),
  ('a1220000-0000-4000-8000-000000000004', 'duda@rocha-residencia.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1220000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-residencia', 'a1220000-0000-4000-8000-000000000001'),
  ('b1220000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-residencia', 'a1220000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1220000-0000-4000-8000-00000000000a', 'a1220000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1220000-0000-4000-8000-00000000000a', 'a1220000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1220000-0000-4000-8000-00000000000a', 'a1220000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1220000-0000-4000-8000-00000000000b', 'a1220000-0000-4000-8000-000000000004', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1220000-0000-4000-8000-000000000001', 'b1220000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents'),
  ('c1220000-0000-4000-8000-000000000002', 'b1220000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'documents'),
  ('c1220000-0000-4000-8000-000000000003', 'b1220000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'documents');
-- Maria has no address on record yet; Rui lives in Anápolis by his record.
insert into public.people (id, org_id, full_name, cpf, birth_date, city, uf) values
  ('d1220000-0000-4000-8000-000000000001', 'b1220000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '1985-04-02', null, null),
  ('d1220000-0000-4000-8000-000000000002', 'b1220000-0000-4000-8000-00000000000a', 'Rui Teste', '12345678909', '1980-01-01', 'Anápolis', 'GO'),
  ('d1220000-0000-4000-8000-000000000003', 'b1220000-0000-4000-8000-00000000000b', 'Paulo Teste', '11144477735', '1979-01-01', null, null);
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1220000-0000-4000-8000-000000000001', 'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000001', 'd1220000-0000-4000-8000-000000000001', 'claimant'),
  ('e1220000-0000-4000-8000-000000000002', 'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002', 'd1220000-0000-4000-8000-000000000002', 'claimant'),
  ('e1220000-0000-4000-8000-000000000003', 'b1220000-0000-4000-8000-00000000000b', 'c1220000-0000-4000-8000-000000000003', 'd1220000-0000-4000-8000-000000000003', 'claimant');
-- Maria's link, on which she said she finished.
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7220000-0000-4000-8000-000000000001', 'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000001',
   'd1220000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-da-maria-teste', 'UTF8')), 'hex'), now() + interval '30 days', now()),
  ('a7220000-0000-4000-8000-000000000002', 'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002',
   'd1220000-0000-4000-8000-000000000002', encode(sha256(convert_to('token-do-rui-teste', 'UTF8')), 'hex'), now() + interval '30 days', now());
-- A planned lawsuit of each case of Lima, its system approved.
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f1220000-0000-4000-8000-000000000001', 'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned'),
  ('f1220000-0000-4000-8000-000000000002', 'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002', 'juizado', 'TJGO', 'planned');
update public.proceedings set system = 'projudi', system_approved_at = now(), system_approved_by = 'a1220000-0000-4000-8000-000000000001'
where case_id in ('c1220000-0000-4000-8000-000000000001', 'c1220000-0000-4000-8000-000000000002');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1220000-0000-4000-8000-000000000001', 'e1220000-0000-4000-8000-000000000001', 'b1220000-0000-4000-8000-00000000000a'),
  ('f1220000-0000-4000-8000-000000000002', 'e1220000-0000-4000-8000-000000000002', 'b1220000-0000-4000-8000-00000000000a');

/** A bill sent for a person of a case, with the run of its check, received and waiting. */
create function pg_temp.bill(id uuid, org uuid, case_id uuid, party uuid) returns uuid language plpgsql as $$
declare
  run uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at)
  values (id, org, 'client', 'org/x/' || id, 'conta.pdf', 'application/pdf', 100, 'stored', repeat('c', 64), 100,
          'application/pdf', 1, now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status)
  values (id, org, case_id, party, id, 'address_proof', 'client', 'received');
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at, subject_type, subject_id)
  values (org, 'caso.documento.conferencia',
          (select v.id from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active),
          'fake', 'fake', repeat('a', 64), 'succeeded', now(), 'case_document', id::text)
  returning ai_runs.id into run;
  return run;
end;
$$;

/** What the check answers of a bill: accepted, in the name given, with its address. */
create function pg_temp.answer(holder text, match text, city text) returns jsonb language sql as $$
  select jsonb_build_object(
    'decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'conta de luz', 'legivel', true,
    'nome_no_documento', holder, 'confere_com_a_pessoa', match,
    'dados_lidos', jsonb_build_object('nome_completo', '', 'cpf', '', 'data_nascimento', '', 'nacionalidade', '',
      'cep', '74000000', 'logradouro', 'RUA DAS FLORES', 'numero', '10', 'complemento', '', 'bairro', 'CENTRO',
      'cidade', city, 'uf', 'GO'),
    'observacoes', '', 'trechos', '[]'::jsonb);
$$;

create function pg_temp.sign_in(person uuid, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

-- ---------- Maria's bill in her mother's name ----------

insert into res values ('maria-run', to_jsonb(pg_temp.bill('a9220000-0000-4000-8000-000000000001',
  'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000001', 'e1220000-0000-4000-8000-000000000001')));
insert into res values ('maria-check', to_jsonb(public.apply_document_check((select (value #>> '{}')::uuid from res where key = 'maria-run'),
  pg_temp.answer('JOANA TESTE', 'nao', 'GOIÂNIA'), 'ai')));

select ok(
  (select value #>> '{}' = 'accepted' from res where key = 'maria-check')
    and (select status = 'open' and holder_name = 'Joana Teste' and holder_read = 'JOANA TESTE' and relation is null
                and bill_city = 'Goiânia'
         from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000001')
    and (select street = 'Rua das Flores' and city = 'Goiânia' and postal_code = '74000000'
         from public.people where id = 'd1220000-0000-4000-8000-000000000001'),
  'a bill in the mother''s name is accepted where the firm accepts such bills, its address written, a declaration owed'
);
select is(
  public.filing_blocker('f1220000-0000-4000-8000-000000000001'),
  'residence_relation_missing',
  'and the filing waits for the client''s word on who the holder is'
);

-- ---------- Maria answers on her link ----------

set local role anon;
insert into res values ('maria-link', public.client_link_residence('token-da-maria-teste'));
insert into res values ('rui-link-of-maria', public.client_link_residence('token-do-rui-teste'));
reset role;
select ok(
  (select value #>> '{items,0,holder}' = 'Joana Teste' and (value #>> '{items,0,issued}')::boolean = false
   from res where key = 'maria-link')
    and (select jsonb_array_length(value -> 'items') = 0 from res where key = 'rui-link-of-maria'),
  'her link asks her about the holder of her bill, and another person''s link asks nothing of it'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('answer-bad', public.client_link_answer_residence('token-da-maria-teste',
  (select id from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000001'), 'outro', '', ''));
insert into res values ('answer', public.client_link_answer_residence('token-da-maria-teste',
  (select id from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000001'), 'mae', null, '',
  '{"ip": "203.0.113.1"}'));
reset role;
select ok(
  (select value ->> 'code' = 'note' from res where key = 'answer-bad')
    and (select value ->> 'ok' = 'true' from res where key = 'answer')
    and (select relation = 'mae' and answered_source = 'client' and answer_evidence ->> 'ip' = '203.0.113.1'
         from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000001')
    and public.filing_blocker('f1220000-0000-4000-8000-000000000001') = 'residence_declaration_unsigned',
  'she says the holder is her mother, with what the server saw; the filing now waits for her signature'
);

-- ---------- The papers, a queue ----------

-- Her power of attorney lacks what it needs (nobody signs for the firm yet): it does not hold the declaration back.
update public.case_advances set claimed_at = now(), claims = claims + 1
where case_id = 'c1220000-0000-4000-8000-000000000001';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('paper', public.advance_paper_to_issue('c1220000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c1220000-0000-4000-8000-000000000001')));
reset role;
select ok(
  (select value ->> 'code' = 'due' and value ->> 'kind' = 'declaracao_residencia'
     and value ->> 'title' = 'Declaração de residência'
     and value ->> 'body' ~ 'está em nome de Joana Teste, que é minha mãe\.'
     and value ->> 'body' ~ 'Lei nº 7\.115' and value ->> 'body' ~ 'Rua das Flores'
     and value ->> 'body' !~ '\[\[|\[COMPLETAR'
   from res where key = 'paper')
    and exists (select 1 from public.case_papers_due('c1220000-0000-4000-8000-000000000001') where kind = 'procuracao'),
  'the declaration is issued from the platform''s model with the holder and who she is, while the incomplete power of attorney waits'
);

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at)
values ('a8220000-0000-4000-8000-0000000000aa', 'b1220000-0000-4000-8000-00000000000a', 'paper', 'org/x/declaracao',
        'declaracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('issued', public.advance_record_paper('c1220000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c1220000-0000-4000-8000-000000000001'),
  'd1220000-0000-4000-8000-000000000001', 'declaracao_residencia', (select value ->> 'template_id' from res where key = 'paper')::uuid,
  jsonb_build_object('file_id', 'a8220000-0000-4000-8000-0000000000aa', 'sha256', repeat('d', 64), 'bytes', '100', 'pages', '1')));
reset role;
select ok(
  (select value ->> 'code' = 'issued' and value ->> 'method' = 'govbr' from res where key = 'issued')
    and (select kind = 'residence_declaration' and status = 'accepted' from public.case_documents
         where id = (select (value ->> 'document_id')::uuid from res where key = 'issued'))
    and exists (select 1 from public.case_papers where person_id = 'd1220000-0000-4000-8000-000000000001' and kind = 'declaracao_residencia')
    and public.filing_blocker('f1220000-0000-4000-8000-000000000001') = 'residence_declaration_unsigned',
  'issued as a document of its own kind and sent to sign by gov.br on her link; the filing still waits'
);

update public.signature_envelopes set status = 'signed',
  signed_document_id = (select (value ->> 'document_id')::uuid from res where key = 'issued')
where id = (select (value ->> 'envelope_id')::uuid from res where key = 'issued');
select ok(
  public.filing_blocker('f1220000-0000-4000-8000-000000000001') is null
    and (select value #> '{package_kinds,person}' ? 'residence_declaration' from public.platform_settings where key = 'case_advance'),
  'signed, the filing no longer waits, and the declaration goes with her papers to the court'
);

-- ---------- Rui: an address of another city ----------

insert into res values ('rui-run', to_jsonb(pg_temp.bill('a9220000-0000-4000-8000-000000000002',
  'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002', 'e1220000-0000-4000-8000-000000000002')));
select public.apply_document_check((select (value #>> '{}')::uuid from res where key = 'rui-run'),
  pg_temp.answer('CARLOS TESTE', 'nao', 'GOIÂNIA'), 'ai');
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('rui-firm', public.record_residence_relation(
  (select id from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000002'), 'outro', 'meu tio', 'Carlos Teste'));
reset role;
select ok(
  (select value ->> 'ok' = 'true' from res where key = 'rui-firm')
    and (select city = 'Anápolis' from public.people where id = 'd1220000-0000-4000-8000-000000000002')
    and public.filing_blocker('f1220000-0000-4000-8000-000000000002') = 'residence_address_conflict'
    and not exists (select 1 from public.case_papers_due('c1220000-0000-4000-8000-000000000002') where kind = 'declaracao_residencia'),
  'the firm records who the holder is; an address on record in another city waits for a person, and no declaration goes'
);

-- The attendance does not go on without it, nor a lawyer with no second factor; a lawyer with it does.
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('waive-attendance', public.waive_residence_declaration(
  (select id from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000002'), 'O cliente mora em Goiânia agora.'));
reset role;
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
insert into res values ('waive-aal1', public.waive_residence_declaration(
  (select id from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000002'), 'O cliente mora em Goiânia agora.'));
reset role;
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('waive', public.waive_residence_declaration(
  (select id from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000002'), 'O cliente mora em Goiânia agora.'));
reset role;
select ok(
  (select value ->> 'code' = 'not_allowed' from res where key = 'waive-attendance')
    and (select value ->> 'code' = 'second_factor' from res where key = 'waive-aal1')
    and (select value ->> 'ok' = 'true' from res where key = 'waive')
    and (select status = 'waived' and ended_reason = 'O cliente mora em Goiânia agora.'
         from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000002')
    and public.filing_blocker('f1220000-0000-4000-8000-000000000002') is null
    and exists (select 1 from public.audit_events where action = 'residence_declaration.waived'),
  'a lawyer goes on without the declaration with the second factor and a reason on the record, and the filing goes'
);

-- ---------- A declaration no longer needed ----------

-- Rui later sends a bill in his own name: had a declaration been open, it would end; here a new one of his mother's,
-- then one of his own.
insert into res values ('rui-run-2', to_jsonb(pg_temp.bill('a9220000-0000-4000-8000-000000000003',
  'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002', 'e1220000-0000-4000-8000-000000000002')));
select public.apply_document_check((select (value #>> '{}')::uuid from res where key = 'rui-run-2'),
  pg_temp.answer('LIA TESTE', 'nao', 'ANÁPOLIS'), 'ai');
insert into res values ('rui-run-3', to_jsonb(pg_temp.bill('a9220000-0000-4000-8000-000000000004',
  'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002', 'e1220000-0000-4000-8000-000000000002')));
select public.apply_document_check((select (value #>> '{}')::uuid from res where key = 'rui-run-3'),
  pg_temp.answer('RUI TESTE', 'sim', 'ANÁPOLIS'), 'ai');
select ok(
  (select count(*) = 2 and count(*) filter (where status = 'open') = 0
     and count(*) filter (where status = 'void' and holder_name = 'Lia Teste') = 1
   from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000002'),
  'a bill in the person''s own name ends the declaration another bill owed'
);

-- Maria's bill refused after all: her declaration ends with it.
update public.case_documents set status = 'rejected', rejected_reason = 'A conta está cortada.'
where id = 'a9220000-0000-4000-8000-000000000001';
select ok(
  (select status = 'void' from public.residence_declarations where person_id = 'd1220000-0000-4000-8000-000000000001'),
  'a bill refused after it was accepted owes no declaration'
);

-- ---------- Rocha refuses such bills ----------

select pg_temp.sign_in('a1220000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('policy-lawyer', public.set_third_party_bill('b1220000-0000-4000-8000-00000000000a', 'refuse'));
reset role;
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('policy', public.set_third_party_bill('b1220000-0000-4000-8000-00000000000b', 'refuse'));
reset role;
insert into res values ('paulo-run', to_jsonb(pg_temp.bill('a9220000-0000-4000-8000-000000000005',
  'b1220000-0000-4000-8000-00000000000b', 'c1220000-0000-4000-8000-000000000003', 'e1220000-0000-4000-8000-000000000003')));
insert into res values ('paulo-check', to_jsonb(public.apply_document_check((select (value #>> '{}')::uuid from res where key = 'paulo-run'),
  pg_temp.answer('ANA TESTE', 'nao', 'GOIÂNIA'), 'ai')));
select ok(
  (select value ->> 'code' = 'not_allowed' from res where key = 'policy-lawyer')
    and (select value ->> 'ok' = 'true' from res where key = 'policy')
    and (select value #>> '{}' = 'rejected' from res where key = 'paulo-check')
    and (select rejected_reason ~ 'no seu nome' from public.case_documents where id = 'a9220000-0000-4000-8000-000000000005')
    and not exists (select 1 from public.residence_declarations where org_id = 'b1220000-0000-4000-8000-00000000000b')
    and exists (select 1 from public.audit_events where action = 'firm.third_party_bill_set'),
  'only who decides for the firm chooses; a firm that refuses such bills has them refused, with the way to send another'
);

-- A bill whose holder could not be read is refused even where such bills are accepted.
insert into res values ('blank-run', to_jsonb(pg_temp.bill('a9220000-0000-4000-8000-000000000006',
  'b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000001', 'e1220000-0000-4000-8000-000000000001')));
select is(
  public.apply_document_check((select (value #>> '{}')::uuid from res where key = 'blank-run'), pg_temp.answer('', 'nao', 'GOIÂNIA'), 'ai'),
  'rejected',
  'a bill in somebody else''s name whose holder could not be read is refused'
);

-- ---------- Who decides reads the month, and nobody of another firm writes ----------

insert into public.filing_packages (org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id, built_at)
values ('b1220000-0000-4000-8000-00000000000a', 'c1220000-0000-4000-8000-000000000002', 'f1220000-0000-4000-8000-000000000002',
        'TJGO', 'projudi', 'juizado', 'ready', 'a9220000-0000-4000-8000-000000000004', now());
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('month', public.firm_third_party_bills('b1220000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('month-lawyer', coalesce(public.firm_third_party_bills('b1220000-0000-4000-8000-00000000000a'), 'null'::jsonb));
reset role;
select ok(
  (select (value ->> 'packages')::int = 1 and (value ->> 'third_party')::int = 1 from res where key = 'month')
    and (select value = 'null'::jsonb from res where key = 'month-lawyer'),
  'who decides reads how many packages of the month carry a bill in somebody else''s name; a lawyer does not'
);

-- The id is read here: through Rocha's own eyes Lima's declarations are not there to name.
insert into res select 'lima-declaration', to_jsonb(id) from public.residence_declarations
where person_id = 'd1220000-0000-4000-8000-000000000002' order by created_at limit 1;
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.record_residence_relation(
       (select (value #>> '{}')::uuid from res where key = 'lima-declaration'), 'mae', null, 'Joana Teste') $$,
  'P0002', 'case_not_found',
  'nobody of another firm says who the holder of a bill is: the case is not there for them'
);
reset role;

-- What the case screen reads: the declarations open or set aside, to members of the firm only.
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('screen-rui', public.case_residence('c1220000-0000-4000-8000-000000000002'));
insert into res values ('screen-maria', public.case_residence('c1220000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('screen-rocha', public.case_residence('c1220000-0000-4000-8000-000000000002'));
reset role;
select ok(
  (select jsonb_array_length(value) = 1 and value #>> '{0,status}' = 'waived' and value #>> '{0,relation}' = 'outro'
     and value #>> '{0,note}' = 'meu tio' and value #>> '{0,holder}' = 'Carlos Teste' and value -> 0 -> 'blocker' = 'null'::jsonb
     and value #>> '{0,ended_reason}' = 'O cliente mora em Goiânia agora.'
   from res where key = 'screen-rui')
    and (select value = '[]'::jsonb from res where key = 'screen-maria')
    and (select value = '[]'::jsonb from res where key = 'screen-rocha'),
  'the case screen reads the declaration set aside with its reason, none once its bill was refused, and nothing of another firm'
);

-- A firm writes its own declaration, which ONE issues in place of the platform's.
select pg_temp.sign_in('a1220000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('own-model', public.save_draft_template('b1220000-0000-4000-8000-00000000000a', null,
  '{"name": "Declaração do escritório", "document_kind": "declaracao_residencia", "is_default": true,
    "body": "Eu, [[NOME]], declaro que moro em [[ENDERECO]], em conta de [[TITULAR]], [[RELACAO]]. [[LOCAL_DATA]]"}'::jsonb));
reset role;
select ok(
  (select value ->> 'ok' = 'true' from res where key = 'own-model')
    and public.paper_template_for('b1220000-0000-4000-8000-00000000000a', 'declaracao_residencia')
        = (select (value ->> 'template_id')::uuid from res where key = 'own-model')
    and public.paper_template_for('b1220000-0000-4000-8000-00000000000b', 'declaracao_residencia')
        = (select id from public.draft_templates where org_id is null and document_kind = 'declaracao_residencia'),
  'a firm writes its own declaration and ONE issues it; a firm with none has the platform''s'
);

select ok(
  public.wait_owner('residence_relation_missing') = 'client' and public.wait_owner('residence_declaration_unsigned') = 'client'
    and public.wait_owner('residence_address_conflict') = 'firm'
    and (select strpos(system_prompt, 'Um comprovante de endereço em nome de outra pessoa') > 0
         from public.prompt_versions where task = 'caso.documento.conferencia' and is_active),
  'whose each wait is, and the check''s instructions in force no longer refuse a bill for the name on it'
);

select * from finish();
rollback;
