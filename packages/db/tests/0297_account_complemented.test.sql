begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ============================================================
-- The firm complements an account, and an account is read with the case's others (0297). Lia told her account in two
-- texts: the first lacked her arrival, which the second tells, and the second lacked the assistance and the
-- consequences, which the first tells, so nothing of her account is missing and nothing is asked. Rui's account lacks
-- his expenses: a person of the firm complements it with what he told on the phone, and ONE orders it again, reading
-- Lia's accounts beside it. An account complemented as many times as the setting allows is refused; firm B
-- complements nothing of firm A's and reads none of its accounts.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2970000-0000-4000-8000-000000000001', 'ana@lima-relato.invalid', 'Ana Lima'),
  ('a2970000-0000-4000-8000-000000000002', 'duda@rocha-relato.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2970000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-relato', 'a2970000-0000-4000-8000-000000000001'),
  ('b2970000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-relato', 'a2970000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2970000-0000-4000-8000-00000000000a', 'a2970000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2970000-0000-4000-8000-00000000000b', 'a2970000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident, status) values
  ('c2970000-0000-4000-8000-000000000001', 'b2970000-0000-4000-8000-00000000000a', 1, 'cancellation', 'documents'),
  ('c2970000-0000-4000-8000-000000000002', 'b2970000-0000-4000-8000-00000000000a', 2, 'cancellation', 'documents');
insert into public.people (id, org_id, full_name) values
  ('d2970000-0000-4000-8000-000000000001', 'b2970000-0000-4000-8000-00000000000a', 'Lia Teste'),
  ('d2970000-0000-4000-8000-000000000002', 'b2970000-0000-4000-8000-00000000000a', 'Rui Exemplo');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2970000-0000-4000-8000-000000000001', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000001',
   'd2970000-0000-4000-8000-000000000001', 'claimant'),
  ('e2970000-0000-4000-8000-000000000002', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000001',
   'd2970000-0000-4000-8000-000000000002', 'claimant'),
  ('e2970000-0000-4000-8000-000000000003', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000002',
   'd2970000-0000-4000-8000-000000000002', 'claimant');

-- Lia's first text, decided: it lacks her arrival.
insert into public.case_statements (id, org_id, case_id, party_id, source, status, transcript, chronology, chronology_status,
                                    missing_topics, questions) values
  ('f2970000-0000-4000-8000-000000000001', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000001',
   'e2970000-0000-4000-8000-000000000001', 'firm', 'received',
   'O voo foi cancelado. Deram só uma caixa de lanche e uma van até o destino. Perdi a preparação da palestra.',
   '20/09/2099: o voo foi cancelado.', 'approved', array['chegada'], array['Em que dia e a que horas você chegou?']);
-- Her second text: it tells her arrival, and lacks what the first told.
insert into public.case_statements (id, org_id, case_id, party_id, source, status, transcript, chronology, chronology_status,
                                    missing_topics, questions) values
  ('f2970000-0000-4000-8000-000000000002', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000001',
   'e2970000-0000-4000-8000-000000000001', 'firm', 'received',
   'Soube no aeroporto. Cheguei com mais de quatro horas de atraso.', '20/09/2099: chegou às 14:40.', 'approved',
   array['assistencia', 'consequencias'], array['A companhia deu alimentação?', 'O que você perdeu?']);
-- Rui's account, decided: it lacks his expenses.
insert into public.case_statements (id, org_id, case_id, party_id, source, status, transcript, chronology, chronology_status,
                                    missing_topics, questions) values
  ('f2970000-0000-4000-8000-000000000003', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000001',
   'e2970000-0000-4000-8000-000000000002', 'firm', 'received', 'Estava com a Lia no mesmo voo.',
   '20/09/2099: o voo foi cancelado.', 'approved', array['gastos'], array['Você teve algum gasto?']);
-- Rui's account in another case, complemented as many times as the setting allows.
insert into public.case_statements (id, org_id, case_id, party_id, source, status, transcript, chronology, chronology_status,
                                    missing_topics, questions, rounds) values
  ('f2970000-0000-4000-8000-000000000004', 'b2970000-0000-4000-8000-00000000000a', 'c2970000-0000-4000-8000-000000000002',
   'e2970000-0000-4000-8000-000000000003', 'firm', 'received', 'Outro voo cancelado.', '01/10/2099: cancelado.',
   'approved', array['gastos'], array['Você teve algum gasto?'], 3);

-- ---------- What is missing of a person's account ----------

select is(
  (select string_agg(id::text || ' ' || cardinality(missing_topics) || ' ' || cardinality(questions), ', ' order by id)
   from public.case_statements where party_id = 'e2970000-0000-4000-8000-000000000001'),
  'f2970000-0000-4000-8000-000000000001 0 0, f2970000-0000-4000-8000-000000000002 0 0',
  'what one of Lia''s texts lacks the other tells: nothing of her account is missing, and nothing is asked');
select is(
  (select array_to_string(missing_topics, ',') || ' ' || cardinality(questions)
   from public.case_statements where id = 'f2970000-0000-4000-8000-000000000003'),
  'gastos 1', 'Rui''s account keeps what it lacks: Lia''s accounts are not his');
select is(public.case_account_state('c2970000-0000-4000-8000-000000000001'), 'ready',
  'the case''s account goes on');

-- ---------- The firm complements an account ----------

select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a2970000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is(public.complete_case_statement('f2970000-0000-4000-8000-000000000003',
            'Você teve algum gasto?' || chr(10) || 'Gastou R$ 50 com lanche no aeroporto.') ->> 'code',
  'sent', 'a person of the firm complements Rui''s account with what he told on the phone');
select is(public.complete_case_statement('f2970000-0000-4000-8000-000000000003', 'De novo.') ->> 'code',
  'nothing_to_answer', 'while ONE orders it again, there is nothing more to answer');
select is(public.complete_case_statement('f2970000-0000-4000-8000-000000000004', 'Gastou R$ 20.') ->> 'code',
  'too_many', 'an account complemented as many times as the setting allows is refused');
reset role;

select is(
  (select strpos(client_added, 'Gastou R$ 50') > 0 and rounds = 1 and work = 'chronology' and chronology_status = 'none'
   from public.case_statements where id = 'f2970000-0000-4000-8000-000000000003'),
  true, 'it joins his account, and ONE orders it again with everything');

-- ONE orders it reading the case's other accounts.
update public.case_statements set work_claimed_at = now(), work_seq = 7 where id = 'f2970000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select jsonb_array_length(d.other_accounts) || ' ' || (d.other_accounts -> 0 ->> 'relato' like 'O voo foi cancelado.%')
   from public.case_statement_to_process('f2970000-0000-4000-8000-000000000003', 7) d),
  '2 true', 'the order of the facts reads the case''s other accounts, oldest first');
reset role;
select ok(
  (select strpos(system_prompt, 'outros relatos do caso, já recebidos') > 0
   from public.prompt_versions where task = 'caso.relato.cronologia' and is_active),
  'and its instructions in force leave out of what is missing what another account told');

-- ---------- Each firm its own ----------

select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a2970000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select throws_ok($$select public.complete_case_statement('f2970000-0000-4000-8000-000000000004', 'Gastou R$ 20.')$$,
  null, null, 'firm B complements nothing of firm A''s');
select throws_ok($$select public.reconcile_account_gaps('c2970000-0000-4000-8000-000000000001', null)$$,
  '42501', null, 'nobody of a firm calls the rule of the gaps directly');
reset role;

select * from finish();
rollback;
