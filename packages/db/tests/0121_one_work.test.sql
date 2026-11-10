begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- O trabalho do ONE (0120 to 0122): every kind of ONE's work counted once, by month
-- of Brasília, from the records ONE keeps; what a person approved after
-- reading apart, the test cases apart; nothing undone, failed or turned down;
-- nothing of another firm; the firm's own minutes and the cost of an hour
-- only to who decides for the firm. Two firms: Lima has one act of each kind
-- in October of 2026 (and its undone twins), Rocha a few of its own.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1210000-0000-4000-8000-000000000001', 'ana@lima-trabalho.invalid', 'Ana Lima'),
  ('a1210000-0000-4000-8000-000000000002', 'caio@lima-trabalho.invalid', 'Caio Lima'),
  ('a1210000-0000-4000-8000-000000000003', 'duda@rocha-trabalho.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1210000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-trabalho', 'a1210000-0000-4000-8000-000000000001'),
  ('b1210000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-trabalho', 'a1210000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1210000-0000-4000-8000-00000000000a', 'a1210000-0000-4000-8000-000000000001', 'member', 'socio'),
  ('b1210000-0000-4000-8000-00000000000a', 'a1210000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1210000-0000-4000-8000-00000000000b', 'a1210000-0000-4000-8000-000000000003', 'owner', 'socio');

-- Lima: a real case (#1) and a test case (#2). Rocha: one case.
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1210000-0000-4000-8000-000000000003', 'b1210000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
update public.cases set is_test = true where id = 'c1210000-0000-4000-8000-000000000002';
insert into public.people (id, org_id, full_name) values
  ('d1210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'Maria Teste'),
  ('d1210000-0000-4000-8000-000000000003', 'b1210000-0000-4000-8000-00000000000b', 'Rui Teste');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'd1210000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'comum', 'TJSP', 'filed', '10003015320998260100', '2026-10-01'),
  ('f1210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000002',
   'comum', 'TJSP', 'filed', '10003023820998260100', '2026-10-01'),
  ('f1210000-0000-4000-8000-000000000003', 'b1210000-0000-4000-8000-00000000000b', 'c1210000-0000-4000-8000-000000000003',
   'comum', 'TJSP', 'filed', '10003032320998260100', '2026-10-01');
-- The lawsuits ONE created: one of the real case, one of the test case, one of Rocha's.
update public.proceedings set created_by_one = true, created_at = '2026-10-15 15:00+00';

-- A run of a task of the AI, finished in October.
create function pg_temp.run(task text, org uuid default 'b1210000-0000-4000-8000-00000000000a') returns uuid language sql as $$
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, finished_at)
  values (org, task, (select v.id from public.prompt_versions v where v.task = run.task order by v.version desc limit 1),
          'fake', 'fake', repeat('a', 64), 'succeeded', '2026-10-15 15:00+00')
  returning id;
$$;
-- A person of Lima approved the answer of a run, after reading it.
create function pg_temp.approved(run uuid, task text) returns void language sql as $$
  insert into public.approvals (org_id, run_id, task, approver_functions, status, final_output, decided_by, decided_at)
  values ('b1210000-0000-4000-8000-00000000000a', run, task, array['socio']::public.firm_function[], 'approved', '{}',
          'a1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00');
$$;
-- A stored file of Lima.
create function pg_temp.file(id uuid, purpose text default 'client') returns uuid language sql as $$
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, pages, expires_at, confirmed_at, created_at)
  values (id, 'b1210000-0000-4000-8000-00000000000a', purpose, 'org/x/' || id, 'arquivo.pdf', 'application/pdf', 100,
          'stored', repeat('b', 64), 100, 'application/pdf', 1, now() + interval '1 hour', now(), '2026-10-15 15:00+00')
  returning id;
$$;
-- A message that went out of Lima's conversation, with the status given.
create function pg_temp.out_message(id uuid, status text, run uuid default null, number uuid default 'a5210000-0000-4000-8000-000000000001')
returns uuid language sql as $$
  insert into public.wa_messages (id, org_id, conversation_id, number_id, direction, origin, kind, body, status, ai_run_id, created_at)
  values (id, 'b1210000-0000-4000-8000-00000000000a',
          (select c.id from public.wa_conversations c where c.number_id = out_message.number limit 1), number,
          'out', 'cloud', 'text', 'Mensagem', status, run, '2026-10-15 15:00+00')
  returning id;
$$;

-- ---------- The conversation ----------

insert into public.wa_numbers (id, org_id, provider, phone_number_id, waba_id, display_phone_number, status, disconnected_at) values
  ('a5210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'meta', 'pn-lima', 'waba-lima', '5562999990001', 'disconnected', now()),
  ('a5210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'test', 'pn-teste', 'waba-teste', '5500988880006', 'disconnected', now());
insert into public.wa_conversations (org_id, number_id, contact_wa_id) values
  ('b1210000-0000-4000-8000-00000000000a', 'a5210000-0000-4000-8000-000000000001', '5562988880001'),
  ('b1210000-0000-4000-8000-00000000000a', 'a5210000-0000-4000-8000-000000000002', '5500988880001');

-- A case ONE opened at the passenger's yes, on the 15th and at the last minutes of October in Brasília (already the
-- 1st of November by Greenwich), and one at the first minutes of November; and one of Rocha's.
insert into public.case_events (org_id, case_id, at, kind, actor_type, data) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00', 'created', 'system', '{"from": "conversation"}'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-31 23:30-03', 'created', 'system', '{"from": "conversation"}'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-11-01 00:30-03', 'created', 'system', '{"from": "conversation"}'),
  ('b1210000-0000-4000-8000-00000000000b', 'c1210000-0000-4000-8000-000000000003', '2026-10-15 15:00+00', 'created', 'system', '{"from": "conversation"}'),
  -- A case a person opened is no work of ONE's.
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00', 'created', 'person', '{}');

-- ONE's answers: one alone, one a person approved, one in the test chat, one that never went out.
select pg_temp.out_message('a6210000-0000-4000-8000-000000000001', 'sent', pg_temp.run('atendimento.conversa'));
select pg_temp.out_message('a6210000-0000-4000-8000-000000000002', 'delivered', pg_temp.run('atendimento.conversa'));
select pg_temp.approved((select ai_run_id from public.wa_messages where id = 'a6210000-0000-4000-8000-000000000002'), 'atendimento.conversa');
select pg_temp.out_message('a6210000-0000-4000-8000-000000000003', 'sent', pg_temp.run('atendimento.conversa'),
  'a5210000-0000-4000-8000-000000000002');
select pg_temp.out_message('a6210000-0000-4000-8000-000000000004', 'failed', pg_temp.run('atendimento.conversa'));

-- The client's link ONE sent, and one a person replaced.
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, created_at, revoked_at, revoked_by) values
  ('a7210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'd1210000-0000-4000-8000-000000000001', repeat('1', 64), now() + interval '30 days', '2026-10-15 15:00+00', null, null),
  ('a7210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'd1210000-0000-4000-8000-000000000001', repeat('2', 64), now() + interval '30 days', '2026-10-15 15:00+00', now(),
   'a1210000-0000-4000-8000-000000000001');
insert into public.case_events (org_id, case_id, at, kind, actor_type, data)
select 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00',
       'client_link_created', 'system', jsonb_build_object('link', id)
from public.client_links where org_id = 'b1210000-0000-4000-8000-00000000000a';

-- A file of the conversation ONE joined to the case, and one joined and then removed.
select pg_temp.file('a8210000-0000-4000-8000-000000000001');
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('a9210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a8210000-0000-4000-8000-000000000001', 'ticket', 'whatsapp', 'received');
insert into public.case_events (org_id, case_id, at, kind, actor_type, data) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00', 'document_added', 'system',
   '{"source": "whatsapp", "document": "a9210000-0000-4000-8000-000000000001"}'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00', 'document_added', 'system',
   '{"source": "whatsapp", "document": "a9210000-0000-4000-8000-0000000000ff"}');

-- An answer of the interview read in the conversation, and one the firm wrote.
insert into public.case_interviews (id, org_id, case_id) values
  ('aa210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001');
insert into public.case_interview_answers (org_id, interview_id, case_id, question, status, answer, source, answered_at) values
  ('b1210000-0000-4000-8000-00000000000a', 'aa210000-0000-4000-8000-000000000001', 'c1210000-0000-4000-8000-000000000001',
   'motivo', 'answered', 'Manutenção', 'chat', '2026-10-15 15:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'aa210000-0000-4000-8000-000000000001', 'c1210000-0000-4000-8000-000000000001',
   'chegada', 'answered', 'De madrugada', 'firm', '2026-10-15 15:00+00');

-- ---------- The papers ----------

-- Checked by ONE alone; by a person who approved the check; and decided by a person over a check withdrawn.
select pg_temp.file('a8210000-0000-4000-8000-000000000002');
select pg_temp.file('a8210000-0000-4000-8000-000000000003');
select pg_temp.file('a8210000-0000-4000-8000-000000000004');
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_by, decided_at, check_run_id) values
  ('a9210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a8210000-0000-4000-8000-000000000002', 'identity', 'client', 'accepted', null, '2026-10-15 15:00+00',
   pg_temp.run('caso.documento.conferencia')),
  ('a9210000-0000-4000-8000-000000000003', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a8210000-0000-4000-8000-000000000003', 'address_proof', 'client', 'accepted', 'a1210000-0000-4000-8000-000000000001',
   '2026-10-15 15:00+00', pg_temp.run('caso.documento.conferencia')),
  ('a9210000-0000-4000-8000-000000000004', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a8210000-0000-4000-8000-000000000004', 'boarding_pass', 'client', 'accepted', 'a1210000-0000-4000-8000-000000000002',
   '2026-10-15 15:00+00', pg_temp.run('caso.documento.conferencia'));
select pg_temp.approved((select check_run_id from public.case_documents where id = 'a9210000-0000-4000-8000-000000000003'),
  'caso.documento.conferencia');

-- What ONE read of Maria's identity, still marked; and a reading somebody wrote over since.
update public.people set read_fields = '{"birth_date": {"document": "a9210000-0000-4000-8000-000000000002", "kind": "identity"}}'
where id = 'd1210000-0000-4000-8000-000000000001';
insert into public.case_events (org_id, case_id, at, kind, actor_type, data) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00', 'person_read', 'ai',
   '{"person": "d1210000-0000-4000-8000-000000000001", "fields": ["birth_date"]}'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00', 'person_read', 'ai',
   '{"person": "d1210000-0000-4000-8000-000000000001", "fields": ["cpf"]}');

-- A photo made a PDF.
select pg_temp.file('a8210000-0000-4000-8000-000000000005', 'normalized');
update public.case_documents set normalized_file_id = 'a8210000-0000-4000-8000-000000000005'
where id = 'a9210000-0000-4000-8000-000000000002';

-- ---------- What the client told ----------

select pg_temp.file('a8210000-0000-4000-8000-000000000006');
insert into public.case_statements (org_id, case_id, source, audio_file_id, transcript, transcript_run_id) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'client',
   'a8210000-0000-4000-8000-000000000006', 'O voo atrasou.', pg_temp.run('caso.relato.transcricao'));
insert into public.case_statements (org_id, case_id, source, chronology, chronology_status, chronology_run_id) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'firm', '1. Atraso.', 'confirmed',
   pg_temp.run('caso.relato.cronologia')),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'firm', '1. Atraso.', 'approved',
   pg_temp.run('caso.relato.cronologia')),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'firm', '1. Atraso.', 'dismissed',
   pg_temp.run('caso.relato.cronologia'));
select pg_temp.approved(s.chronology_run_id, 'caso.relato.cronologia')
from public.case_statements s where s.chronology_status = 'approved' and s.org_id = 'b1210000-0000-4000-8000-00000000000a';

-- ---------- The lawsuits ----------

update public.proceedings set system_by_one = true, system = 'esaj', system_approved_by = 'a1210000-0000-4000-8000-000000000001',
  system_approved_at = '2026-10-15 15:00+00'
where id = 'f1210000-0000-4000-8000-000000000001';
insert into public.flight_segments (id, org_id, case_id) values
  ('ab210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001');
-- The leg owes its check of the record (0030), which ONE made.
update public.flight_checks set status = 'not_found', checked_at = '2026-10-15 15:00+00'
where segment_id = 'ab210000-0000-4000-8000-000000000001' and source = 'vra';
update public.cases set weather_read = '{"at": "2026-10-15T15:00:00Z", "windows": []}',
  suspension_decision = 'file', suspension_decided_auto = true, suspension_decided_at = '2026-10-15 15:00+00'
where id = 'c1210000-0000-4000-8000-000000000001';

-- ---------- The pieces ----------

-- Four pieces of four lawsuits of the real case: waiting for a lawyer, approved by one, approved by ONE, turned down.
insert into public.proceedings (id, org_id, case_id, kind, court, status)
select ('f1210000-0000-4000-8000-00000000001' || n)::uuid, 'b1210000-0000-4000-8000-00000000000a',
       'c1210000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned'
from generate_series(1, 4) n;
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                approved_version, approved_body, approved_by, approved_at, approved_auto) values
  ('ac210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'f1210000-0000-4000-8000-000000000011', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'proposed', 1, null, null, null, null, false),
  ('ac210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'f1210000-0000-4000-8000-000000000012', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'approved', 1, 1, 'Texto.',
   'a1210000-0000-4000-8000-000000000002', '2026-10-15 15:00+00', false),
  ('ac210000-0000-4000-8000-000000000003', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'f1210000-0000-4000-8000-000000000013', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'issued', 1, 1, 'Texto.',
   null, '2026-10-15 15:00+00', true),
  ('ac210000-0000-4000-8000-000000000004', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'f1210000-0000-4000-8000-000000000014', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'rejected', 1, null, null, null, null, false);
insert into public.case_draft_versions (org_id, draft_id, version, author, body, created_at)
select 'b1210000-0000-4000-8000-00000000000a', d.id, 1, 'ai', 'Texto da peça.', '2026-10-15 15:00+00'
from public.case_drafts d where d.org_id = 'b1210000-0000-4000-8000-00000000000a';

-- A power of attorney sent to sign, and one whose signature the firm ended.
select pg_temp.file('a8210000-0000-4000-8000-000000000007');
select pg_temp.file('a8210000-0000-4000-8000-000000000008');
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('a9210000-0000-4000-8000-000000000007', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a8210000-0000-4000-8000-000000000007', 'power_of_attorney', 'firm', 'accepted'),
  ('a9210000-0000-4000-8000-000000000008', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a8210000-0000-4000-8000-000000000008', 'petition', 'firm', 'accepted');
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers) values
  ('ad210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'a9210000-0000-4000-8000-000000000007', 'govbr', 'cancelled', '[{"name": "Maria Teste"}]');
insert into public.case_papers (org_id, case_id, person_id, kind, document_id, envelope_id, created_at) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'd1210000-0000-4000-8000-000000000001',
   'procuracao', 'a9210000-0000-4000-8000-000000000007', null, '2026-10-15 15:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'd1210000-0000-4000-8000-000000000001',
   'contrato', 'a9210000-0000-4000-8000-000000000007', 'ad210000-0000-4000-8000-000000000001', '2026-10-15 15:00+00');
insert into public.dossiers (org_id, case_id, status, issued_at) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'issued', '2026-10-15 15:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'failed', null);

-- ---------- The filing ----------

insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id,
                                    built_at, signature_status, signed_at) values
  ('ae210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'f1210000-0000-4000-8000-000000000001', 'TJSP', 'esaj', 'comum', 'filed', 'a9210000-0000-4000-8000-000000000008',
   '2026-10-15 15:00+00', 'signed', '2026-10-15 15:00+00'),
  ('ae210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001',
   'f1210000-0000-4000-8000-000000000001', 'TJSP', 'esaj', 'comum', 'cancelled', 'a9210000-0000-4000-8000-000000000008',
   '2026-10-15 15:00+00', 'signed', '2026-10-15 15:00+00');
insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel, status, filed_at) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'ae210000-0000-4000-8000-000000000001', 'mni', 'filed', '2026-10-15 15:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'ae210000-0000-4000-8000-000000000002', 'mni', 'refused', null);

-- ---------- The court and the gazette ----------

-- Read in October; and three read in September and triaged in October: by ONE, kept by a person, changed by a person.
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, captured_at, case_id,
                                 category, triaged_at, triaged_by, ai_category, ai_applied) values
  ('b1210000-0000-4000-8000-00000000000a', 'hash-lima-0001', 'TJSP', '10003015320998260100', '2026-10-14', 'Intimação', 'Texto.',
   '2026-10-15 15:00+00', 'c1210000-0000-4000-8000-000000000001', null, null, null, null, false),
  ('b1210000-0000-4000-8000-00000000000a', 'hash-lima-0002', 'TJSP', '10003015320998260100', '2026-09-09', 'Intimação', 'Texto.',
   '2026-09-10 15:00+00', 'c1210000-0000-4000-8000-000000000001', 'ciencia', '2026-10-15 15:00+00', null, 'ciencia', true),
  ('b1210000-0000-4000-8000-00000000000a', 'hash-lima-0003', 'TJSP', '10003015320998260100', '2026-09-09', 'Intimação', 'Texto.',
   '2026-09-10 15:00+00', 'c1210000-0000-4000-8000-000000000001', 'outro', '2026-10-15 15:00+00',
   'a1210000-0000-4000-8000-000000000001', 'outro', true),
  ('b1210000-0000-4000-8000-00000000000a', 'hash-lima-0004', 'TJSP', '10003015320998260100', '2026-09-09', 'Intimação', 'Texto.',
   '2026-09-10 15:00+00', 'c1210000-0000-4000-8000-000000000001', 'outro', '2026-10-15 15:00+00',
   'a1210000-0000-4000-8000-000000000001', 'ciencia', true);

-- A deadline ONE read and counted; one ONE confirmed; one ONE read and a person dismissed.
insert into public.deadlines (org_id, cnj, court, case_id, title, trigger, trigger_on, days, counting, status,
                              proposed_auto, created_at, computed_revision, computed_due_on, computed_at,
                              due_on, confirmed_auto, confirmed_at, dismissed_at, dismiss_reason) values
  ('b1210000-0000-4000-8000-00000000000a', '10003015320998260100', 'TJSP', 'c1210000-0000-4000-8000-000000000001',
   'Réplica', 'day', '2026-10-10', 15, 'business', 'proposed', true, '2026-10-15 15:00+00', 1, '2026-10-30',
   '2026-10-15 15:00+00', null, false, null, null, null),
  ('b1210000-0000-4000-8000-00000000000a', '10003015320998260100', 'TJSP', 'c1210000-0000-4000-8000-000000000001',
   'Recurso', 'day', '2026-09-10', 10, 'business', 'confirmed', false, '2026-09-10 15:00+00', null, null,
   null, '2026-09-24', true, '2026-10-15 15:00+00', null, null),
  ('b1210000-0000-4000-8000-00000000000a', '10003015320998260100', 'TJSP', 'c1210000-0000-4000-8000-000000000001',
   'Manifestação', 'day', '2026-10-10', 5, 'business', 'dismissed', true, '2026-10-15 15:00+00', null, null,
   null, null, false, null, now(), 'Lida por engano.');

-- A hearing ONE read and wrote to the calendar; one ONE read and a person cancelled.
insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, place, status, outcome_note,
                             created_auto, created_at, synced_revision, synced_calendar, synced_at) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'conciliacao', '2026-11-20 17:00+00', 'America/Sao_Paulo', 'presencial', 'Fórum', 'scheduled', null, true,
   '2026-10-15 15:00+00', 1, 'agenda-lima', '2026-10-15 15:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'una', '2026-11-21 17:00+00', 'America/Sao_Paulo', 'presencial', 'Fórum', 'cancelled', 'Registrada por engano.', true,
   '2026-10-15 15:00+00', null, null, null);

-- The history the first reading brought in September, and a movement learned in October.
insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title, learned_at) values
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'aggregator', 'm-1', '2026-09-01 12:00+00', 'Distribuído', '2026-09-02 12:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'aggregator', 'm-2', '2026-09-01 13:00+00', 'Citação', '2026-09-02 12:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'f1210000-0000-4000-8000-000000000001',
   'aggregator', 'm-3', '2026-10-14 12:00+00', 'Contestação juntada', '2026-10-15 15:00+00');

-- ---------- What the client is told ----------

insert into public.client_notices (org_id, case_id, person_id, phone, kind, occurrence, params, message_id)
select 'b1210000-0000-4000-8000-00000000000a', 'c1210000-0000-4000-8000-000000000001', 'd1210000-0000-4000-8000-000000000001',
       '5562988880001', k.kind, 'ocorrencia-' || k.n, '[]', pg_temp.out_message(k.message::uuid, k.status)
from (values
  (1, 'hearing_reminder', 'a6210000-0000-4000-8000-000000000011', 'sent'),
  (2, 'lawsuit_update', 'a6210000-0000-4000-8000-000000000012', 'read'),
  (3, 'payment_alert', 'a6210000-0000-4000-8000-000000000013', 'sent'),
  (4, 'document_refused', 'a6210000-0000-4000-8000-000000000014', 'delivered'),
  -- An alert of a flight is no work for the firm; a notice that did not go out is none either.
  (5, 'flight_problem', 'a6210000-0000-4000-8000-000000000015', 'sent'),
  (6, 'hearing_change', 'a6210000-0000-4000-8000-000000000016', 'failed')
) as k (n, kind, message, status);

-- ---------- The library ----------

insert into public.draft_templates (id, org_id, name, body, document_kind, prepared_by_one) values
  ('af210000-0000-4000-8000-000000000001', 'b1210000-0000-4000-8000-00000000000a', 'Procuração do escritório',
   'Texto da procuração do escritório.', 'procuracao', true),
  ('af210000-0000-4000-8000-000000000002', 'b1210000-0000-4000-8000-00000000000a', 'Contrato do escritório',
   'Texto do contrato do escritório.', 'contrato', false);
insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata, created_at) values
  ('b1210000-0000-4000-8000-00000000000a', null, 'library.import_saved_by_one', 'template_import', 'i-1',
   '{"template_id": "af210000-0000-4000-8000-000000000001"}', '2026-10-15 15:00+00'),
  ('b1210000-0000-4000-8000-00000000000a', 'a1210000-0000-4000-8000-000000000001', 'library.import_saved', 'template_import', 'i-2',
   '{"template_id": "af210000-0000-4000-8000-000000000002"}', '2026-10-15 15:00+00'),
  -- A model saved and then removed.
  ('b1210000-0000-4000-8000-00000000000a', null, 'library.import_saved_by_one', 'template_import', 'i-3',
   '{"template_id": "af210000-0000-4000-8000-0000000000ff"}', '2026-10-15 15:00+00');

-- ---------- The reading ----------

create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;

select pg_temp.sign_in('a1210000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio', public.firm_one_work('b1210000-0000-4000-8000-00000000000a', '2026-10-01', '2026-11-01'));
reset role;

/** The October rows of a reading, as (kind, alone, assisted, test). */
create function pg_temp.october(which text) returns table (kind text, alone int, assisted int, test int) language sql as $$
  select r ->> 'kind', (r ->> 'alone')::int, (r ->> 'assisted')::int, (r ->> 'test')::int
  from res, jsonb_array_elements(res.value -> 'rows') r
  where res.key = which and r ->> 'month' = '2026-10';
$$;

select set_eq(
  $$ select * from pg_temp.october('caio') $$,
  $$ values
    ('caso_aberto_conversa', 2, 0, 0), ('resposta_conversa', 1, 1, 1), ('link_cliente', 1, 0, 0),
    ('arquivo_conversa', 1, 0, 0), ('resposta_entrevista', 1, 0, 0), ('documento_conferido', 1, 1, 0),
    ('dados_lidos', 1, 0, 0), ('foto_pdf', 1, 0, 0), ('audio_transcrito', 1, 0, 0), ('ordem_dos_fatos', 1, 1, 0),
    ('acoes_criadas', 1, 0, 1), ('sistema_tribunal', 0, 1, 0), ('voo_conferido', 1, 0, 0), ('clima_lido', 1, 0, 0),
    ('tema_1417', 1, 0, 0), ('texto_peca', 2, 1, 0), ('peca_aprovada', 1, 0, 0), ('papel_cliente', 1, 0, 0),
    ('dossie', 1, 0, 0), ('pacote_protocolo', 1, 0, 0), ('arquivos_assinados', 1, 0, 0), ('acao_protocolada', 1, 0, 0),
    ('publicacao_capturada', 1, 0, 0), ('publicacao_triada', 1, 1, 0), ('prazo_lido', 1, 0, 0), ('andamento_lido', 1, 0, 0),
    ('prazo_contado', 1, 0, 0), ('prazo_confirmado', 1, 0, 0), ('audiencia_lida', 1, 0, 0), ('audiencia_agenda', 1, 0, 0),
    ('aviso_audiencia', 1, 0, 0), ('aviso_andamento', 1, 0, 0), ('aviso_golpe', 1, 0, 0), ('pedido_documento', 1, 0, 0),
    ('modelo_documento', 1, 1, 0) $$,
  'each kind of ONE''s work is counted once, what a person approved and the test cases apart, and nothing undone'
);
-- The books' own work (0128) is said only to who reads the books, which Caio does not: 0127 counts it.
select is(
  (select count(*)::int from public.one_work_kinds k
   where k.family <> 'financeiro' and not exists (select 1 from pg_temp.october('caio') o where o.kind = k.key)),
  0,
  'and the fixture holds an act of every kind of the catalog'
);
select ok(
  (select (r ->> 'alone')::int = 1 from res, jsonb_array_elements(value -> 'rows') r
   where key = 'caio' and r ->> 'month' = '2026-11' and r ->> 'kind' = 'caso_aberto_conversa'),
  'the month turns in Brasília: the last minutes of October are October''s, the first of November November''s'
);
select ok(
  (select (r ->> 'minutes')::int = (2 + 1) * 30 and (r ->> 'test_minutes')::int = 0
   from res, jsonb_array_elements(value -> 'rows') r
   where key = 'caio' and r ->> 'month' = '2026-10' and r ->> 'kind' = 'texto_peca')
  and (select (r ->> 'minutes')::int = 1 * 10 and (r ->> 'test_minutes')::int = 10
       from res, jsonb_array_elements(value -> 'rows') r
       where key = 'caio' and r ->> 'month' = '2026-10' and r ->> 'kind' = 'acoes_criadas'),
  'the minutes are ONE''s where the firm set none, the test cases'' apart'
);
select ok(
  (select value -> 'hour_cents' is null and value ->> 'decides' = 'false'
     and not exists (select 1 from jsonb_array_elements(value -> 'kinds') k where k ? 'minutes')
   from res where key = 'caio'),
  'a lawyer who does not decide for the firm reads no cost of an hour nor the firm''s minutes'
);

-- ---------- The firm's estimates ----------

select pg_temp.sign_in('a1210000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio-sets', public.set_one_work_estimates('b1210000-0000-4000-8000-00000000000a', '{"texto_peca": 45}'));
reset role;
select pg_temp.sign_in('a1210000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bad-kind', public.set_one_work_estimates('b1210000-0000-4000-8000-00000000000a', '{"senha": 5}'));
insert into res values ('bad-minutes', public.set_one_work_estimates('b1210000-0000-4000-8000-00000000000a', '{"texto_peca": 900}'));
insert into res values ('ana-sets', public.set_one_work_estimates('b1210000-0000-4000-8000-00000000000a',
  '{"texto_peca": 45, "foto_pdf": 2}', true, 15000));
insert into res values ('ana-back', public.set_one_work_estimates('b1210000-0000-4000-8000-00000000000a', '{"foto_pdf": null}'));
insert into res values ('ana', public.firm_one_work('b1210000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-31'));
reset role;

select ok(
  (select value ->> 'code' = 'not_allowed' from res where key = 'caio-sets')
    and (select value ->> 'code' = 'kind' from res where key = 'bad-kind')
    and (select value ->> 'code' = 'minutes' from res where key = 'bad-minutes'),
  'only who decides for the firm sets its estimates, of kinds the catalog has, within the minutes a task takes'
);
select ok(
  (select (value ->> 'hour_cents')::int = 15000 and value ->> 'decides' = 'true' from res where key = 'ana')
    and (select (k ->> 'minutes')::int = 45 and (k ->> 'own')::boolean
         from res, jsonb_array_elements(value -> 'kinds') k where key = 'ana' and k ->> 'key' = 'texto_peca')
    and (select (k ->> 'minutes')::int = 1 and not (k ->> 'own')::boolean
         from res, jsonb_array_elements(value -> 'kinds') k where key = 'ana' and k ->> 'key' = 'foto_pdf'),
  'who decides reads the cost of an hour and the firm''s minutes, one back at ONE''s'
);
select ok(
  (select (r ->> 'minutes')::int = 3 * 45 from res, jsonb_array_elements(value -> 'rows') r
   where key = 'ana' and r ->> 'kind' = 'texto_peca'),
  'and the hours follow the firm''s minutes'
);
-- Both changes are of one transaction and share their moment: each is told apart by what it says, never by its order.
select ok(
  (select count(*) = 2 and bool_and(metadata::text !~ '15000')
   from public.audit_events where action = 'one_work.estimates_changed' and actor_id = 'a1210000-0000-4000-8000-000000000001')
  and exists (
    select 1 from public.audit_events
    where action = 'one_work.estimates_changed' and actor_id = 'a1210000-0000-4000-8000-000000000001'
      and metadata -> 'minutes' = '{"texto_peca": 45, "foto_pdf": 2}'::jsonb and (metadata ->> 'cost_changed')::boolean
  )
  and exists (
    select 1 from public.audit_events
    where action = 'one_work.estimates_changed' and actor_id = 'a1210000-0000-4000-8000-000000000001'
      and metadata -> 'minutes' = '{"foto_pdf": null}'::jsonb and not metadata ? 'cost_changed'
  ),
  'each change is on the record, never with the cost of an hour'
);

-- ---------- A module, the other firm, and the period ----------

select pg_temp.sign_in('a1210000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('module', public.firm_one_work('b1210000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-01',
  'direito-do-passageiro'));
reset role;
select ok(
  not exists (select 1 from pg_temp.october('module') where kind in ('resposta_conversa', 'modelo_documento'))
    and exists (select 1 from pg_temp.october('module') where kind = 'acoes_criadas' and alone = 1),
  'a module counts the acts of its cases, and what is of no case only with every module'
);

select pg_temp.sign_in('a1210000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('rocha', public.firm_one_work('b1210000-0000-4000-8000-00000000000b', '2026-10-01', '2026-10-01'));
reset role;
select set_eq(
  $$ select kind, alone from pg_temp.october('rocha') $$,
  $$ values ('caso_aberto_conversa', 1), ('acoes_criadas', 1) $$,
  'the other firm reads its own work alone'
);

select pg_temp.sign_in('a1210000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.firm_one_work('b1210000-0000-4000-8000-00000000000a', '2026-10-01', '2026-10-01') $$,
  '42501', 'not_authorized',
  'and nobody of another firm reads a firm''s work'
);
select throws_ok(
  $$ select public.firm_one_work('b1210000-0000-4000-8000-00000000000b', '2024-01-01', '2026-10-01') $$,
  '22023', 'invalid_period',
  'a reading spans two years at most'
);
reset role;

-- ---------- The catalog is whole ----------

select is_empty(
  $$ select d.key from public.autonomy_decisions d
     where not exists (select 1 from public.one_work_kinds k where k.decision = d.key) $$,
  'every decision ONE takes alone has its kind of work, so the count stays whole as decisions are added'
);

select * from finish();
rollback;
