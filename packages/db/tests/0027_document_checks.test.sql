begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- What happens to a file once it reaches a case (0024).
--
-- The backend claims each document, keeps what it normalized and the AI's
-- run that checked it, and tries a passing failure again a few times; the
-- suggestion waits for a person of the firm, who decides it in the queue or
-- on the case, and only then does it act on the document and on the legs of
-- the trip. Two firms: nothing of one reaches the other.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ad100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('bd100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ad100000-0000-4000-8000-000000000001'),
  ('bd100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ad100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bd100000-0000-4000-8000-00000000000b', 'ad100000-0000-4000-8000-000000000004', 'owner', 'advogado');
-- Both firms have a person decide each check (0016): what follows is the queue's path. ONE deciding alone is 0045's.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('bd100000-0000-4000-8000-00000000000a', 'document_check', 'approval'),
  ('bd100000-0000-4000-8000-00000000000b', 'document_check', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A file the backend measured and kept (called as the service role).
create function pg_temp.stored(org uuid, purpose text, file_name text, mime text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, purpose, file_name, mime, 4000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat('a', 64), 4000, mime, 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- What the model answers, in the shape of the task's schema.
create function pg_temp.answer(decision text, reason text, legs jsonb default '[]'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('decisao', decision, 'motivo', reason, 'tipo_identificado', 'documento', 'legivel', true,
    'nome_no_documento', 'Maria Teste', 'confere_com_a_pessoa', 'sim', 'observacoes', '', 'trechos', legs);
$$;
-- A run of the check for a document, finished with an answer (as the service role).
create function pg_temp.checked(org uuid, document uuid, output jsonb, attempt text default '1') returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'caso.documento.conferencia', repeat('f', 64), null,
    'case_document', document::text, 'doc:' || document::text || ':' || attempt);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 1200, 300)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- A leg as the model reads it.
create function pg_temp.leg(flight text, origin text, destination text, departure text, booking text default '') returns jsonb
language sql as $$
  select jsonb_build_object('voo', flight, 'origem', origin, 'destino', destination, 'saida_prevista', departure,
    'chegada_prevista', '', 'reserva', booking);
$$;

-- A case of firm A (Maria, Gol) and one of firm B.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('bd100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bd100000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- The files: kept by the backend before anybody attaches them.
select pg_temp.as_backend();
set local role service_role;
insert into res
select name, jsonb_build_object('file_id', pg_temp.stored(org::uuid, 'upload', file_name, mime))
from (values
  ('f_identity', 'bd100000-0000-4000-8000-00000000000a', 'rg.jpg', 'image/jpeg'),
  ('f_ticket', 'bd100000-0000-4000-8000-00000000000a', 'bilhete.pdf', 'application/pdf'),
  ('f_ticket_2', 'bd100000-0000-4000-8000-00000000000a', 'bilhete-volta.pdf', 'application/pdf'),
  ('f_address', 'bd100000-0000-4000-8000-00000000000a', 'conta.pdf', 'application/pdf'),
  ('f_receipt', 'bd100000-0000-4000-8000-00000000000a', 'recibo.pdf', 'application/pdf'),
  ('f_boarding', 'bd100000-0000-4000-8000-00000000000a', 'cartao.pdf', 'application/pdf'),
  ('f_evidence', 'bd100000-0000-4000-8000-00000000000a', 'foto.jpg', 'image/jpeg'),
  ('f_refused', 'bd100000-0000-4000-8000-00000000000a', 'outro.pdf', 'application/pdf'),
  ('f_identity_2', 'bd100000-0000-4000-8000-00000000000a', 'cnh.jpg', 'image/jpeg'),
  ('f_poa', 'bd100000-0000-4000-8000-00000000000a', 'procuracao.pdf', 'application/pdf'),
  ('f_identity_b', 'bd100000-0000-4000-8000-00000000000b', 'rg-b.jpg', 'image/jpeg')
) as files (name, org, file_name, mime);
reset role;

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('identity', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_identity', 'file_id')::uuid, 'identity', pg_temp.got('case', 'party_id')::uuid));
insert into res values ('ticket', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_ticket', 'file_id')::uuid, 'ticket'));
insert into res values ('address', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_address', 'file_id')::uuid, 'address_proof', pg_temp.got('case', 'party_id')::uuid));
insert into res values ('poa', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_poa', 'file_id')::uuid, 'power_of_attorney'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('identity_b', public.attach_case_document(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('f_identity_b', 'file_id')::uuid, 'identity', pg_temp.got('case_b', 'party_id')::uuid));
reset role;

select ok(
  (select processing from public.case_documents where id = pg_temp.got('identity', 'document_id')::uuid) = 'pending'
  and (select processing from public.case_documents where id = pg_temp.got('ticket', 'document_id')::uuid) = 'pending'
  and (select processing from public.case_documents where id = pg_temp.got('poa', 'document_id')::uuid) = 'skipped',
  'what the client or the firm sends waits to be processed; the firm''s own papers do not'
);

-- ---------- The backend claims, works and records ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select count(*) from public.claim_case_documents(10)$$,
  '42501', null,
  'a person of the firm cannot claim documents: only the backend processes them'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res
select 'claim_one', jsonb_build_object('document_id', c.document_id)
from public.claim_case_documents(5, pg_temp.got('identity', 'document_id')::uuid) c;
insert into res
select 'claim_rest', jsonb_build_object('count', count(*), 'ids', jsonb_agg(c.document_id))
from public.claim_case_documents(10) c;
insert into res
select 'details', to_jsonb(d) from public.case_document_to_process(pg_temp.got('identity', 'document_id')::uuid) d;
insert into res values ('details_poa', jsonb_build_object('count',
  (select count(*) from public.case_document_to_process(pg_temp.got('poa', 'document_id')::uuid))));
reset role;

select ok(
  pg_temp.got('claim_one', 'document_id') = pg_temp.got('identity', 'document_id')
  and pg_get_function_result('public.claim_case_documents(integer, uuid)'::regprocedure) = 'TABLE(document_id uuid)'
  and pg_temp.got('claim_rest', 'count') = '3'
  and not ((select payload -> 'ids' from res where name = 'claim_rest') ? pg_temp.got('poa', 'document_id'))
  and pg_temp.got('details', 'person_name') = 'Maria Teste'
  and pg_temp.got('details', 'airline') = 'Gol'
  and pg_temp.got('details', 'detected_mime') = 'image/jpeg'
  and pg_temp.got('details', 'wants_check') = 'true'
  and pg_temp.got('details', 'attempt') = '1'
  and pg_temp.got('details_poa', 'count') = '0',
  'the backend claims each waiting document once, by its id, and reads what the work needs only while it holds it'
);

-- A document claimed and never finished goes back to the line.
update public.case_documents set processing_claimed_at = now() - interval '1 hour'
where id = pg_temp.got('identity_b', 'document_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
select is(
  (select count(*)::integer from public.claim_case_documents(10, pg_temp.got('identity_b', 'document_id')::uuid)),
  1,
  'a document claimed and never finished is claimed again'
);

-- The checks run; a photo is normalized into a PDF the backend keeps.
insert into res values ('run_identity', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('identity', 'document_id')::uuid, pg_temp.answer('aceitar', '')));
insert into res values ('run_ticket', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('ticket', 'document_id')::uuid, pg_temp.answer('aceitar', '', jsonb_build_array(
    jsonb_build_object('voo', 'G3 01234', 'origem', 'gyn', 'destino', 'GRU', 'saida_prevista', '2026-09-20T08:05',
                       'chegada_prevista', '2026-09-20T09:40', 'reserva', 'abc123'),
    pg_temp.leg('G31234', 'GYN', 'GRU', '2026-09-20T08:05'),
    pg_temp.leg('G3 1500', 'ZZZ', 'GRU', '')
  ))));
insert into res values ('run_address', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('address', 'document_id')::uuid, pg_temp.answer('aceitar', '')));
insert into res values ('run_b', pg_temp.checked('bd100000-0000-4000-8000-00000000000b',
  pg_temp.got('identity_b', 'document_id')::uuid, pg_temp.answer('recusar', 'A foto ficou escura.')));
insert into res values ('normalized', jsonb_build_object('file_id',
  pg_temp.stored('bd100000-0000-4000-8000-00000000000a', 'normalized', 'rg.pdf', 'application/pdf')));
insert into res values ('normalized_2', jsonb_build_object('file_id',
  pg_temp.stored('bd100000-0000-4000-8000-00000000000a', 'normalized', 'rg-2.pdf', 'application/pdf')));

insert into res values ('record_other_run', public.record_document_processed(pg_temp.got('identity', 'document_id')::uuid,
  'done', pg_temp.got('run_b', 'run_id')::uuid));
insert into res values ('normalize_wrong_file', public.record_document_normalized(pg_temp.got('identity', 'document_id')::uuid,
  pg_temp.got('f_ticket', 'file_id')::uuid));
insert into res values ('normalize', public.record_document_normalized(pg_temp.got('identity', 'document_id')::uuid,
  pg_temp.got('normalized', 'file_id')::uuid));
insert into res values ('normalize_again', public.record_document_normalized(pg_temp.got('identity', 'document_id')::uuid,
  pg_temp.got('normalized_2', 'file_id')::uuid));
insert into res values ('record_identity', public.record_document_processed(pg_temp.got('identity', 'document_id')::uuid,
  'done', pg_temp.got('run_identity', 'run_id')::uuid));
insert into res values ('record_twice', public.record_document_processed(pg_temp.got('identity', 'document_id')::uuid, 'done'));
insert into res values ('record_failed', public.record_document_processed(pg_temp.got('address', 'document_id')::uuid,
  'failed', null, 'Image Unreadable!'));
reset role;

select ok(
  pg_temp.got('record_other_run', 'code') = 'run_not_found'
  and pg_temp.got('normalize_wrong_file', 'code') = 'file_not_found'
  and pg_temp.got('normalize', 'code') = 'normalized'
  and pg_temp.got('normalize_again', 'code') = 'already_normalized'
  and pg_temp.got('record_identity', 'code') = 'done'
  and pg_temp.got('record_twice', 'code') = 'not_working'
  and (select processing = 'done' and normalized_file_id = pg_temp.got('normalized', 'file_id')::uuid
              and check_run_id = pg_temp.got('run_identity', 'run_id')::uuid
       from public.case_documents where id = pg_temp.got('identity', 'document_id')::uuid)
  and (select processing = 'failed' and processing_error = 'image'
       from public.case_documents where id = pg_temp.got('address', 'document_id')::uuid),
  'what the sweep did is recorded once: one normalized file of the firm, the firm''s own run, and a failure as a short code'
);

-- A passing failure is tried again, until the attempts the setting allows are spent.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('retry_1', public.record_document_processed(pg_temp.got('identity_b', 'document_id')::uuid,
  'retry', null, 'provider_unavailable'));
insert into res values ('retry_state', (select jsonb_build_object('processing', processing, 'attempts', processing_attempts)
  from public.case_documents where id = pg_temp.got('identity_b', 'document_id')::uuid));
select count(*) from public.claim_case_documents(10, pg_temp.got('identity_b', 'document_id')::uuid);
insert into res values ('retry_2', public.record_document_processed(pg_temp.got('identity_b', 'document_id')::uuid,
  'retry', null, 'provider_unavailable'));
reset role;

select ok(
  pg_temp.got('retry_1', 'code') = 'retry'
  and pg_temp.got('retry_state', 'processing') = 'pending' and pg_temp.got('retry_state', 'attempts') = '2'
  and pg_temp.got('retry_2', 'code') = 'failed'
  and (select processing = 'failed' and processing_error = 'provider_unavailable' and processing_attempts = 3
       from public.case_documents where id = pg_temp.got('identity_b', 'document_id')::uuid),
  'a passing failure goes back to the line, and after the last attempt it is final'
);

select ok(
  pg_temp.got('run_identity', 'approval_id') is not null
  and (select status = 'pending' and approver_functions @> array['atendimento']::public.firm_function[]
       from public.approvals where id = pg_temp.got('run_identity', 'approval_id')::uuid)
  and (select status from public.case_documents where id = pg_temp.got('identity', 'document_id')::uuid) = 'received',
  'the check waits in the firm''s queue for anyone who works the case, and the document waits with it'
);

-- ---------- A person decides ----------

-- In the queue: Bia (atendimento) approves the identity as the model read it.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('approve_identity', public.decide_approval(pg_temp.got('run_identity', 'approval_id')::uuid, 'approved'));
reset role;

select ok(
  pg_temp.got('approve_identity', 'code') = 'approved'
  and (select status = 'accepted' and decided_by = 'ad100000-0000-4000-8000-000000000002'
       from public.case_documents where id = pg_temp.got('identity', 'document_id')::uuid)
  and exists (select 1 from public.case_events e
              where e.kind = 'document_accepted' and e.actor_type = 'person'
                and e.data ->> 'approval' = pg_temp.got('run_identity', 'approval_id')),
  'an approved check accepts its document, in the name of the person who approved it'
);

-- On the case, with the second factor: Ana accepts the ticket, which is approving its check, legs included.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('accept_ticket', public.decide_case_document(pg_temp.got('ticket', 'document_id')::uuid, 'accepted'));
reset role;

select ok(
  pg_temp.got('accept_ticket', 'code') = 'accepted'
  and (select status = 'approved' and not edited and decision_note = 'Decidido no caso.'
              and decided_by = 'ad100000-0000-4000-8000-000000000001'
       from public.approvals where id = pg_temp.got('run_ticket', 'approval_id')::uuid)
  and (select status from public.case_documents where id = pg_temp.got('ticket', 'document_id')::uuid) = 'accepted',
  'accepting a document on the case with the second factor approves its waiting check, counted as the model got it right'
);
select ok(
  (select count(*) from public.flight_segments s where s.case_id = pg_temp.got('case', 'case_id')::uuid) = 1
  and (select flight_number = 'G31234' and origin_iata = 'GYN' and destination_iata = 'GRU' and booking_reference = 'ABC123'
              and scheduled_departure_local = timestamp '2026-09-20 08:05' and source = 'firm'
       from public.flight_segments s where s.case_id = pg_temp.got('case', 'case_id')::uuid)
  and (select (data ->> 'count')::integer from public.case_events
       where kind = 'segments_read' and case_id = pg_temp.got('case', 'case_id')::uuid) = 1,
  'the legs read from an accepted ticket join the case once each, and a leg that does not pass the checks of a leg is left out'
);

-- A person decides first: the answer waits for nobody; an accepted document is still normalized, a refused one is not.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('boarding', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_boarding', 'file_id')::uuid, 'boarding_pass'));
insert into res values ('evidence', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_evidence', 'file_id')::uuid, 'evidence'));
insert into res values ('refused', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_refused', 'file_id')::uuid, 'other'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_case_documents(10, pg_temp.got('boarding', 'document_id')::uuid);
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('accept_boarding', public.decide_case_document(pg_temp.got('boarding', 'document_id')::uuid, 'accepted'));
insert into res values ('accept_evidence', public.decide_case_document(pg_temp.got('evidence', 'document_id')::uuid, 'accepted'));
insert into res values ('refuse_refused', public.decide_case_document(pg_temp.got('refused', 'document_id')::uuid, 'rejected',
  'Este arquivo não é do caso.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_boarding', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('boarding', 'document_id')::uuid, pg_temp.answer('recusar', 'Ilegível.')));
insert into res values ('claim_late', jsonb_build_object('ids', (select jsonb_agg(c.document_id) from public.claim_case_documents(10) c)));
insert into res select 'evidence_details', to_jsonb(d)
from public.case_document_to_process(pg_temp.got('evidence', 'document_id')::uuid) d;
reset role;

select ok(
  pg_temp.got('run_boarding', 'approval_id') is null
  and (select status from public.approvals where run_id = pg_temp.got('run_boarding', 'run_id')::uuid) = 'withdrawn'
  and (select status from public.case_documents where id = pg_temp.got('boarding', 'document_id')::uuid) = 'accepted'
  and (select payload -> 'ids' ? pg_temp.got('evidence', 'document_id') from res where name = 'claim_late')
  and pg_temp.got('evidence_details', 'wants_check') = 'false'
  and (select processing from public.case_documents where id = pg_temp.got('refused', 'document_id')::uuid) = 'skipped',
  'a document a person decided first keeps that decision: its check waits for nobody, and it is normalized but never checked'
);

-- ---------- Firm B ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_on_a', public.decide_approval(pg_temp.got('run_ticket', 'approval_id')::uuid, 'approved'));
select throws_ok(
  format('select public.decide_case_document(%L, %L)', pg_temp.got('address', 'document_id'), 'accepted'),
  'P0002', null,
  'a person of another firm cannot decide a document of this one'
);
-- Davi corrects the reason the client will read, then approves.
insert into res values ('approve_b', public.decide_approval(pg_temp.got('run_b', 'approval_id')::uuid, 'approved',
  pg_temp.answer('recusar', 'A foto ficou escura. Envie outra com mais luz.')));
reset role;

select ok(
  pg_temp.got('b_on_a', 'code') = 'not_found'
  and pg_temp.got('approve_b', 'edited') = 'true'
  and (select status = 'rejected' and rejected_reason = 'A foto ficou escura. Envie outra com mais luz.'
       from public.case_documents where id = pg_temp.got('identity_b', 'document_id')::uuid)
  and (select status from public.approvals where id = pg_temp.got('run_ticket', 'approval_id')::uuid) = 'approved',
  'each firm decides only its own checks, and a corrected reason is the one the client reads'
);

-- ---------- Turned down, corrected on the case, withdrawn, unattended ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('receipt', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_receipt', 'file_id')::uuid, 'receipt'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_case_documents(10, pg_temp.got('receipt', 'document_id')::uuid);
insert into res values ('run_receipt', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('receipt', 'document_id')::uuid, pg_temp.answer('recusar', 'Não é um recibo.')));
insert into res values ('unattended_waits', public.apply_unattended_document_check(pg_temp.got('run_receipt', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('turn_down', public.decide_approval(pg_temp.got('run_receipt', 'approval_id')::uuid, 'rejected',
  null, 'É um recibo sim.'));
reset role;

select ok(
  pg_temp.got('unattended_waits', 'code') = 'waits_for_a_person'
  and pg_temp.got('turn_down', 'code') = 'rejected'
  and (select status from public.case_documents where id = pg_temp.got('receipt', 'document_id')::uuid) = 'received',
  'a suggestion turned down changes nothing: the document waits for a person, and the backend never applies a check that waits'
);

-- The address proof, whose check waits (the model would accept it): Ana refuses it on the case.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_address_2', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('address', 'document_id')::uuid, pg_temp.answer('aceitar', ''), '2'));
insert into res values ('unattended_second', public.apply_unattended_document_check(pg_temp.got('run_address_2', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('refuse_short', public.decide_case_document(pg_temp.got('address', 'document_id')::uuid, 'rejected', 'x'));
insert into res values ('refuse_address', public.decide_case_document(pg_temp.got('address', 'document_id')::uuid, 'rejected',
  'A conta está em nome de outra pessoa.'));
reset role;

select ok(
  pg_temp.got('run_address_2', 'approval_id') is null
  and (select status from public.approvals where run_id = pg_temp.got('run_address_2', 'run_id')::uuid) = 'withdrawn'
  and pg_temp.got('unattended_second', 'code') = 'waits_for_a_person'
  and pg_temp.got('refuse_short', 'code') = 'reason_required'
  and (select status = 'approved' and edited and final_output ->> 'decisao' = 'recusar'
              and final_output ->> 'motivo' = 'A conta está em nome de outra pessoa.'
       from public.approvals where id = pg_temp.got('run_address', 'approval_id')::uuid)
  and (select status = 'rejected' and rejected_reason = 'A conta está em nome de outra pessoa.'
       from public.case_documents where id = pg_temp.got('address', 'document_id')::uuid),
  'a second check of a document already waiting stays out of the queue, and refusing on the case approves the first as corrected'
);

-- Without the second factor, deciding on the case decides the document and withdraws its check: no legs, no measure.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ticket_2', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_ticket_2', 'file_id')::uuid, 'ticket'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_ticket_2', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('ticket_2', 'document_id')::uuid,
  pg_temp.answer('aceitar', '', jsonb_build_array(pg_temp.leg('G3 1500', 'GRU', 'GYN', '2026-09-27T18:00')))));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
insert into res values ('accept_ticket_2', public.decide_case_document(pg_temp.got('ticket_2', 'document_id')::uuid, 'accepted'));
reset role;

select ok(
  pg_temp.got('accept_ticket_2', 'code') = 'accepted'
  and (select status = 'withdrawn' and final_output is null and decided_by = 'ad100000-0000-4000-8000-000000000002'
       from public.approvals where id = pg_temp.got('run_ticket_2', 'approval_id')::uuid)
  and (select status from public.case_documents where id = pg_temp.got('ticket_2', 'document_id')::uuid) = 'accepted'
  and not exists (select 1 from public.flight_segments s where s.flight_number = 'G31500')
  and exists (select 1 from public.audit_events where action = 'ai.approval.withdrawn'),
  'without the second factor the document is decided and its check withdrawn: nothing of the AI is applied or measured'
);

-- A check left waiting for a document decided some other way is never approved as if it had acted.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_receipt_2', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('receipt', 'document_id')::uuid, pg_temp.answer('aceitar', ''), '2'));
reset role;
select set_config('request.jwt.claims', '', true);
update public.case_documents set status = 'accepted', decided_at = now() where id = pg_temp.got('receipt', 'document_id')::uuid;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L)', pg_temp.got('run_receipt_2', 'approval_id'), 'approved'),
  'P0001', 'document_already_decided',
  'approving a check whose document was already decided is refused, so nobody believes it acted'
);
reset role;

-- A document whose work never finishes (the worker dies on it every time) is given up after its attempts.
select set_config('request.jwt.claims', '', true);
update public.case_documents set processing = 'working', processing_attempts = 3,
  processing_claimed_at = now() - interval '1 hour'
where id = pg_temp.got('ticket_2', 'document_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_abandoned', jsonb_build_object('count',
  (select count(*) from public.claim_case_documents(10, pg_temp.got('ticket_2', 'document_id')::uuid))));
reset role;
select ok(
  pg_temp.got('claim_abandoned', 'count') = '0'
  and (select processing = 'failed' and processing_error = 'abandoned'
       from public.case_documents where id = pg_temp.got('ticket_2', 'document_id')::uuid),
  'a document claimed and never finished on its last attempt is given up, never claimed for ever'
);

-- The firm lets ONE decide its checks (0016): an answer takes effect with nobody in between, once.
update public.firm_autonomy set mode = 'auto'
where org_id = 'bd100000-0000-4000-8000-00000000000a' and decision = 'document_check';
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('identity_2', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_identity_2', 'file_id')::uuid, 'identity', pg_temp.got('case', 'party_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_identity_2', pg_temp.checked('bd100000-0000-4000-8000-00000000000a',
  pg_temp.got('identity_2', 'document_id')::uuid, pg_temp.answer('aceitar', '')));
reset role;
-- The firm moves back to a person, and the operator holds the task, before the backend applied it: the run did not
-- wait, so it still applies.
update public.firm_autonomy set mode = 'approval'
where org_id = 'bd100000-0000-4000-8000-00000000000a' and decision = 'document_check';
update public.ai_tasks set autonomy = 'approval' where slug = 'caso.documento.conferencia';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('unattended', public.apply_unattended_document_check(pg_temp.got('run_identity_2', 'run_id')::uuid));
insert into res values ('unattended_again', public.apply_unattended_document_check(pg_temp.got('run_identity_2', 'run_id')::uuid));
reset role;

select ok(
  pg_temp.got('run_identity_2', 'approval_id') is null
  and pg_temp.got('unattended', 'code') = 'accepted'
  and pg_temp.got('unattended_again', 'code') = 'already_decided'
  and (select status = 'accepted' and decided_by is null
       from public.case_documents where id = pg_temp.got('identity_2', 'document_id')::uuid)
  and exists (select 1 from public.case_events e
              where e.kind = 'document_accepted' and e.actor_type = 'ai'
                and e.data ->> 'document' = pg_temp.got('identity_2', 'document_id')),
  'a check that did not wait takes effect once, recorded as the AI''s, whatever the task''s autonomy became since'
);

select ok(
  not has_function_privilege('authenticated', 'public.record_document_processed(uuid, text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_document_normalized(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.case_document_to_process(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_unattended_document_check(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_document_check(uuid, jsonb, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_case_documents(integer, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.decide_case_document(uuid, text, text)', 'execute'),
  'only the backend processes a document and applies an unattended check; nobody outside a firm decides one'
);

select * from finish();
rollback;
