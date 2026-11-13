begin;
create extension if not exists pgtap;
select plan(15);

-- ============================================================
-- The proof of address in the chat (0237). Lia's bill of July, sent in
-- November, is refused for its date, saying the month it is of. Her bill in
-- her mother's name, of October, is accepted at a firm that takes one, and
-- ONE asks in the chat who the holder is to her: her answer is kept as on
-- her link, by the client, with the channel it came by. A bill in her own
-- name ends the declaration and the question that waited for it. A paper
-- signed by gov.br is told with a new link of her case, and what she
-- writes in the chat wakes her case. Nothing of it reaches the other firm.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2370000-0000-4000-8000-000000000001', 'ana@lima-conta.invalid', 'Ana Lima'),
  ('a2370000-0000-4000-8000-000000000002', 'duda@rocha-conta.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2370000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-conta', 'a2370000-0000-4000-8000-000000000001'),
  ('b2370000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-conta', 'a2370000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2370000-0000-4000-8000-00000000000a', 'a2370000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2370000-0000-4000-8000-00000000000b', 'a2370000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2370000-0000-4000-8000-00000000000a', 'b2370000-0000-4000-8000-00000000000a', 'whatsapp', 'conta-waba-a', 'Chat de teste',
   'connected', 'a2370000-0000-4000-8000-000000000001', now()),
  ('c2370000-0000-4000-8000-00000000000b', 'b2370000-0000-4000-8000-00000000000b', 'whatsapp', 'conta-waba-b', 'Chat de teste',
   'connected', 'a2370000-0000-4000-8000-000000000002', now());

update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2370000-0000-4000-8000-000000000001', 'b2370000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents');
insert into public.people (id, org_id, full_name, cpf, birth_date, phone, updated_via) values
  ('d2370000-0000-4000-8000-000000000001', 'b2370000-0000-4000-8000-00000000000a', 'Lia Teste', '52998224725', '1990-05-04',
   '5500988883701', 'firm');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2370000-0000-4000-8000-000000000001', 'b2370000-0000-4000-8000-00000000000a', 'c2370000-0000-4000-8000-000000000001',
   'd2370000-0000-4000-8000-000000000001', 'claimant');

/** A bill of Lia's case that arrived on 2099-11-13, checked as the model answers it: in a name, of a day. */
create function pg_temp.bill(id uuid, holder text, matches text, day text) returns text language plpgsql as $$
declare
  run uuid;
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at)
  values (id, 'b2370000-0000-4000-8000-00000000000a', 'client', 'org/x/' || id, 'conta.jpg', 'image/jpeg', 100,
          'stored', repeat('c', 64), 100, 'image/jpeg', 1, now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, created_at)
  values (id, 'b2370000-0000-4000-8000-00000000000a', 'c2370000-0000-4000-8000-000000000001',
          'e2370000-0000-4000-8000-000000000001', id, 'address_proof', 'client', 'received', '2099-11-13 15:00:00+00');
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at, subject_type, subject_id)
  values ('b2370000-0000-4000-8000-00000000000a', 'caso.documento.conferencia',
          (select v.id from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active),
          'fake', 'fake', repeat('a', 64), 'succeeded', now(), 'case_document', id::text)
  returning ai_runs.id into run;
  return public.apply_document_check(run, jsonb_build_object(
    'decisao', 'aceitar', 'motivo', '', 'tipo_identificado', 'conta de luz', 'legivel', true,
    'nome_no_documento', holder, 'confere_com_a_pessoa', matches,
    'dados_lidos', jsonb_build_object('nome_completo', '', 'cpf', '', 'data_nascimento', '', 'nacionalidade', '',
      'cep', '74000000', 'logradouro', 'Rua das Flores', 'numero', '10', 'complemento', '', 'bairro', 'Centro',
      'cidade', 'Goiânia', 'uf', 'GO', 'data_referencia', day),
    'observacoes', '', 'trechos', '[]'::jsonb), 'ai');
end;
$$;

-- ---------- The date of a bill ----------

select is(
  pg_temp.bill('a9370000-0000-4000-8000-000000000001', 'LIA TESTE', 'sim', '2099-07-28'),
  'rejected', 'a bill of July, sent in November, is older than the last three months');
select is(
  (select rejected_reason from public.case_documents where id = 'a9370000-0000-4000-8000-000000000001'),
  'Esta conta é de julho de 2099. Envie um comprovante de endereço no seu nome dos últimos 3 meses.',
  'the refusal says the month it is of and what to send');

-- ---------- A bill in her mother's name, and the question in the chat ----------

select is(
  pg_temp.bill('a9370000-0000-4000-8000-000000000002', 'MARIA DE SOUZA TESTE', 'nao', '2099-08-03'),
  'accepted', 'a bill of August, in somebody else''s name, is accepted where the firm takes one');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Lia Teste', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.owed(conversation uuid) returns jsonb language sql as $$
  select to_jsonb(o) from public.chat_questions_owed(100) o where o.conversation_id = conversation;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2370000-0000-4000-8000-00000000000a',
  'c2370000-0000-4000-8000-00000000000a', 'test', 'conta-number-a', 'conta-waba-a', '5500900000371', 'Lima Advocacia', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2370000-0000-4000-8000-00000000000b',
  'c2370000-0000-4000-8000-00000000000b', 'test', 'conta-number-b', 'conta-waba-b', '5500900000372', 'Rocha Advogados', 'cloud'));
insert into res values ('lia', jsonb_build_object('conversation',
  pg_temp.writes('b2370000-0000-4000-8000-00000000000a', '5500988883701', 'mandei a conta')));
insert into res values ('other', jsonb_build_object('conversation',
  pg_temp.writes('b2370000-0000-4000-8000-00000000000b', '5500988883701', 'oi')));
insert into res values ('lia_claim', jsonb_build_object('claim',
  ((public.claim_conversation_turns(1, pg_temp.got('lia', 'conversation')::uuid) -> 0) ->> 'claim')::integer));

select is(
  (select jsonb_build_object('kind', o ->> 'kind', 'wording', o ->> 'wording', 'party', o ->> 'party_id')
   from pg_temp.owed(pg_temp.got('lia', 'conversation')::uuid) o),
  jsonb_build_object('kind', 'residence', 'wording', 'Maria de Souza Teste', 'party', 'e2370000-0000-4000-8000-000000000001'),
  'who the holder is to her is owed first, with the holder''s name'
);
select is(pg_temp.owed(pg_temp.got('other', 'conversation')::uuid), null, 'the same number at the other firm is asked nothing');

insert into res values ('asked', public.one_ask_chat_question(pg_temp.got('lia', 'conversation')::uuid, 'residence',
  'e2370000-0000-4000-8000-000000000001', 'A conta está em nome de Maria de Souza Teste. Quem é Maria para você?'));
select ok(
  pg_temp.got('asked', 'code') = 'queued' and pg_temp.owed(pg_temp.got('lia', 'conversation')::uuid) is null,
  'ONE asks it, and nothing else while it waits'
);

insert into res values ('answer', public.one_answer_residence(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer, 'mae', null));
select is(pg_temp.got('answer', 'code'), 'recorded', 'her answer is kept');
select is(
  (select jsonb_build_object('relation', d.relation, 'source', d.answered_source, 'channel', d.answer_evidence ->> 'channel')
   from public.residence_declarations d where d.person_id = 'd2370000-0000-4000-8000-000000000001' and d.status = 'open'),
  '{"relation": "mae", "source": "client", "channel": "whatsapp"}'::jsonb,
  'as on her link, by the client, with the channel it came by'
);
select is(
  public.one_answer_residence(pg_temp.got('lia', 'conversation')::uuid, pg_temp.got('lia_claim', 'claim')::integer,
    'pai', null) ->> 'code',
  'not_asked', 'an answer with no question waiting is kept nowhere');

-- ---------- What she writes in the chat wakes her case ----------

reset role;
update public.case_advances set after = now() + interval '6 hours' where case_id = 'c2370000-0000-4000-8000-000000000001';
set local role service_role;
insert into res values ('fields', public.one_person_fields(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer, '{"profession": "Professora"}'::jsonb));
select is(
  pg_temp.got('fields', 'code') || ':' || coalesce((select (after is null)::text from public.case_advances
                                                    where case_id = 'c2370000-0000-4000-8000-000000000001'), 'none'),
  'kept:true',
  'her profession written in the chat wakes her case at once, as on her link');

-- ---------- A bill in her own name ends the declaration, and the question with it ----------

reset role;
update public.residence_declarations set relation = null, relation_note = null, answered_source = null,
       answered_at = null, answer_evidence = null
where person_id = 'd2370000-0000-4000-8000-000000000001';
update public.wa_conversations
set chat_step = jsonb_build_object('step', 'residence', 'party', 'e2370000-0000-4000-8000-000000000001',
                                   'case', 'c2370000-0000-4000-8000-000000000001')
where id = pg_temp.got('lia', 'conversation')::uuid;
select is(
  pg_temp.bill('a9370000-0000-4000-8000-000000000003', 'LIA TESTE', 'sim', '2099-11-02'),
  'accepted', 'a bill of November in her own name is accepted');
select ok(
  (select status = 'void' from public.residence_declarations where person_id = 'd2370000-0000-4000-8000-000000000001')
  and (select coalesce(chat_step ->> 'step', '') = '' from public.wa_conversations
       where id = pg_temp.got('lia', 'conversation')::uuid),
  'it ends the declaration, and the question that waited for it');

-- ---------- A paper signed by gov.br, told with a new link ----------

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('f2370000-0000-4000-8000-00000000000a', 'b2370000-0000-4000-8000-00000000000a', 'paper',
   'org/b2370000-0000-4000-8000-00000000000a/paper/f2370000-0000-4000-8000-00000000000a',
   'procuracao.pdf', 'application/pdf', 100, 'stored', repeat('a', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at) values
  ('a2370000-0000-4000-8000-0000000000da', 'b2370000-0000-4000-8000-00000000000a', 'c2370000-0000-4000-8000-000000000001',
   'f2370000-0000-4000-8000-00000000000a', 'power_of_attorney', 'firm', 'accepted', now());
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers, provider_id) values
  ('a2370000-0000-4000-8000-0000000000ea', 'b2370000-0000-4000-8000-00000000000a', 'c2370000-0000-4000-8000-000000000001',
   'a2370000-0000-4000-8000-0000000000da', 'govbr', 'pending',
   '[{"position": 1, "person_id": "d2370000-0000-4000-8000-000000000001", "name": "Lia Teste", "signed_at": null}]',
   'conta-envelope-a');
insert into public.case_papers (id, org_id, case_id, person_id, kind, document_id, envelope_id) values
  ('a2370000-0000-4000-8000-0000000000fa', 'b2370000-0000-4000-8000-00000000000a', 'c2370000-0000-4000-8000-000000000001',
   'd2370000-0000-4000-8000-000000000001', 'procuracao', 'a2370000-0000-4000-8000-0000000000da',
   'a2370000-0000-4000-8000-0000000000ea');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('told', public.one_tell_signature_links(pg_temp.got('lia', 'conversation')::uuid,
  array['a2370000-0000-4000-8000-0000000000fa'::uuid], 'Falta só assinar, Lia. O documento está neste link.',
  repeat('e', 64)));
select is(pg_temp.got('told', 'code'), 'queued', 'ONE tells the paper signed by gov.br');
reset role;
select ok(
  exists (select 1 from public.client_links l
          where l.case_id = 'c2370000-0000-4000-8000-000000000001' and l.person_id = 'd2370000-0000-4000-8000-000000000001'
            and l.token_hash = repeat('e', 64) and l.revoked_at is null),
  'with a new link of her case, made in the same step');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2370000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.residence_declarations)
  + (select count(*)::integer from public.case_documents where case_id = 'c2370000-0000-4000-8000-000000000001'),
  0, 'another firm reads neither the declaration nor the bills');
reset role;

select * from finish();
rollback;
