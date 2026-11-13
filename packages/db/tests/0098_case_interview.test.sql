begin;
create extension if not exists pgtap;
select plan(21);

-- The interview of a case's start is off since 0239 (the client tells their account instead): on here, to test it.
update public.platform_settings set value = value || '{"start": true}'::jsonb where key = 'interview';

-- ============================================================
-- The passenger's interview, one question at a time (0095): opened for a
-- case of a flight's problem still being gathered, it is the case's account
-- (open, ONE waits for it; done or closed, ready); ONE asks in the
-- conversation it holds, inside the 24 hours, one question while none waits,
-- again or as a reminder only as the setting says; an answer is kept once
-- (a person of the firm may write over it); the link answers one question
-- per screen; a lawyer may go on without the rest; outside the 24 hours the
-- firm's template asks to go on; the piece reads it. Two firms: nothing of
-- one reaches the other.
--
-- Every person, firm and number here is invented: the phones are of an area
-- code no carrier has.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@entrevista.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@entrevista.invalid', '', now(), '{}', '{"display_name":"Bia Souto"}', now(), now()),
  ('a9800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@entrevista.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9800000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-entrevista', 'a9800000-0000-4000-8000-000000000001'),
  ('b9800000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-entrevista', 'a9800000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9800000-0000-4000-8000-00000000000a', 'a9800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9800000-0000-4000-8000-00000000000a', 'a9800000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b9800000-0000-4000-8000-00000000000b', 'a9800000-0000-4000-8000-000000000003', 'owner', 'advogado');
-- The papers are kept to a person here, so the interview is owed right away (0181: where ONE sends them, it waits
-- for the signature; pgTAP 0179).
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b9800000-0000-4000-8000-00000000000a', 'send_signature_papers', 'approval'),
  ('b9800000-0000-4000-8000-00000000000b', 'send_signature_papers', 'approval');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d9800000-0000-4000-8000-00000000000a', 'b9800000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-entrevista-a', 'WhatsApp A',
   'connected', 'a9800000-0000-4000-8000-000000000001', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('e9800000-0000-4000-8000-00000000000a', 'b9800000-0000-4000-8000-00000000000a', 'd9800000-0000-4000-8000-00000000000a',
   'simulator', 'sim-entrevista-a', 'waba-entrevista-a', '5500900000098', 'coexistence');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- Firm A: Ana's cancellation, its affected leg, her link, and her conversation with ONE inside the 24 hours.
-- Firm B: a case of its own.
select pg_temp.sign_in('a9800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9800000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-20',
  '{"full_name": "Ana Teste de Souza", "birth_date": "1985-04-02", "phone": "5500999998001"}'::jsonb));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, encode(sha256(convert_to('token-da-entrevista-0095-aaaaaaaaaaa', 'UTF8')), 'hex')));
reset role;
insert into public.flight_segments (id, org_id, case_id, position, flight_number, origin_iata, destination_iata,
                                    scheduled_departure_local, scheduled_arrival_local, affected) values
  ('c9800000-0000-4000-8000-0000000000f1', 'b9800000-0000-4000-8000-00000000000a', pg_temp.got('case', 'case_id')::uuid, 1,
   'G31739', 'GIG', 'FOR', '2026-09-20 21:30', '2026-09-21 00:45', true);
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('f9800000-0000-4000-8000-00000000000a', 'b9800000-0000-4000-8000-00000000000a', 'e9800000-0000-4000-8000-00000000000a',
   '5500999998001', now() - interval '10 minutes', now() - interval '10 minutes', 'Sim', 'in', 1, 'one');
select pg_temp.sign_in('a9800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9800000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999998003"}'::jsonb));
reset role;

-- ---------- Who reads and writes ----------

select ok(
  not has_function_privilege('authenticated', 'public.interview_start(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.interview_ask(uuid, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.interview_answer(uuid, text, text, text, text, jsonb, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.interview_resume(uuid, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_interview_for_piece(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.case_interview_view(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.answer_case_interview(uuid, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.close_case_interview(uuid)', 'EXECUTE')
  and has_function_privilege('anon', 'public.client_link_interview(text)', 'EXECUTE')
  and has_function_privilege('anon', 'public.client_link_interview_answer(text, text, boolean, text, text, text)', 'EXECUTE')
  and (select is_active from public.prompt_versions where task = 'atendimento.entrevista.resposta' and version = 1),
  'the backend asks and records; the firm reads, answers and closes; the link answers'
);

-- ---------- Opened, it is the case's account ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('started', public.interview_start(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('started_again', public.interview_start(pg_temp.got('case', 'case_id')::uuid));
insert into res select 'to_start', coalesce(jsonb_agg(c), '[]') from public.interviews_to_start(20) c;
reset role;
select ok(
  pg_temp.got('started', 'code') = 'started' and pg_temp.got('started_again', 'code') = 'already'
  and pg_temp.got('started_again', 'interview_id') = pg_temp.got('started', 'interview_id')
  and public.case_account_state(pg_temp.got('case', 'case_id')::uuid) = 'incomplete'
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'interview_started')
  and not (select payload @> to_jsonb(array[pg_temp.got('case', 'case_id')]) from res where name = 'to_start'),
  'a case of a flight''s problem being gathered is interviewed once, and ONE waits for it before the lawsuits'
);

-- A free account told meanwhile keeps no gap to ask: the interview asks.
select pg_temp.sign_in('a9800000-0000-4000-8000-000000000001');
insert into res values ('statement', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, null,
  'O voo das 21h30 para Fortaleza foi cancelado quando eu já estava no aeroporto e ninguém deu informação.'));
update public.case_statements set missing_topics = array['compra'], questions = array['Quanto você pagou?']
where id = pg_temp.got('statement', 'statement_id')::uuid;
select ok(
  (select missing_topics = '{}' and questions = '{}' from public.case_statements
   where id = pg_temp.got('statement', 'statement_id')::uuid),
  'the order of a free account keeps no gap to ask, where the case has an interview'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('facts', public.interview_for_work(pg_temp.got('started', 'interview_id')::uuid));
reset role;
select ok(
  pg_temp.got('facts', 'incident') = 'cancellation'
  and pg_temp.got('facts', 'scheduled_departure') = '2026-09-20T21:30'
  and pg_temp.got('facts', 'scheduled_arrival') = '2026-09-21T00:45'
  and pg_temp.got('facts', 'actual_arrival') is null
  and pg_temp.got('facts', 'companions_known') = 'false'
  and pg_temp.got('facts', 'in_chat') = 'true'
  and pg_temp.got('facts', 'first_name') = 'Ana'
  and pg_temp.got('facts', 'answers') = '{}',
  'the interview reads its case''s problem, its affected leg, who travelled and where ONE may ask'
);

-- ---------- ONE asks, one question while none waits ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('asked', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'Ana, quando você soube do cancelamento, já estava no aeroporto?', 'ask'));
insert into res values ('asked_twice', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'motivo',
  'A companhia disse o motivo?', 'ask'));
insert into res values ('reminded_early', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'Ana, você já estava no aeroporto?', 'remind'));
insert into res values ('again', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'Não entendi. Responda sim ou não: você já estava no aeroporto?', 'again'));
insert into res values ('again_twice', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'De novo.', 'again'));
reset role;
select ok(
  pg_temp.got('asked', 'code') = 'queued'
  and (select body = 'Ana, quando você soube do cancelamento, já estava no aeroporto?' and direction = 'out'
       from public.wa_messages where id = pg_temp.got('asked', 'message_id')::uuid)
  and pg_temp.got('asked_twice', 'code') = 'already_asked',
  'ONE asks in the conversation it holds, and never a second question while one waits'
);
select ok(
  pg_temp.got('reminded_early', 'code') = 'not_due'
  and pg_temp.got('again', 'code') = 'queued' and pg_temp.got('again_twice', 'code') = 'asked_enough'
  and (select current_question = 'aviso_local' and asks = 2 from public.case_interviews
       where id = pg_temp.got('started', 'interview_id')::uuid),
  'a question is asked again only as many times as the setting says, and reminded only after its hours'
);

-- The reminder, once the setting's hours passed; and once only.
update public.case_interviews set asked_at = now() - interval '5 hours' where id = pg_temp.got('started', 'interview_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('reminded', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'Ana, você já estava no aeroporto quando soube?', 'remind'));
insert into res values ('reminded_twice', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'Outra vez.', 'remind'));
reset role;
select ok(
  pg_temp.got('reminded', 'code') = 'queued' and pg_temp.got('reminded_twice', 'code') = 'not_due',
  'a question not answered is reminded once, after the setting''s hours'
);

-- ---------- An answer is kept once ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('answered', public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'answered', 'Já estava no aeroporto quando soube.', 'Sim, já estava lá', '{"sim_nao": "sim", "outro": "x"}'::jsonb));
insert into res values ('answered_twice', public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'aviso_local',
  'answered', 'Outra coisa.'));
insert into res values ('skip_no_reason', public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'aviso_quando',
  'skipped'));
insert into res values ('skipped', public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'aviso_quando',
  'skipped', null, null, '{}'::jsonb, 'at_airport'));
insert into res values ('purchase', public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'compra',
  'answered', 'Pagou R$ 2.000.'));
reset role;
select ok(
  pg_temp.got('answered', 'code') = 'recorded' and pg_temp.got('answered_twice', 'code') = 'already'
  and (select answer = 'Já estava no aeroporto quando soube.' and words = 'Sim, já estava lá'
              and facts = '{"sim_nao": "sim"}'::jsonb and source = 'chat'
       from public.case_interview_answers
       where interview_id = pg_temp.got('started', 'interview_id')::uuid and question = 'aviso_local')
  and (select current_question is null and asks = 0 from public.case_interviews
       where id = pg_temp.got('started', 'interview_id')::uuid),
  'an answer is kept once, with only what a rule reads of it, and the question waits no more'
);
select ok(
  pg_temp.got('skip_no_reason', 'code') = 'invalid_reason' and pg_temp.got('skipped', 'code') = 'recorded'
  and (select source = 'one' and reason = 'at_airport' and answer is null from public.case_interview_answers
       where interview_id = pg_temp.got('started', 'interview_id')::uuid and question = 'aviso_quando')
  and pg_temp.got('purchase', 'code') = 'invalid_question',
  'a question left out says why, and the purchase is no question of the interview'
);

-- ---------- The link, one question per screen ----------

select pg_temp.as_client();
set local role anon;
insert into res values ('link_read', public.client_link_interview('token-da-entrevista-0095-aaaaaaaaaaa'));
insert into res values ('link_arrival', public.client_link_interview_answer('token-da-entrevista-0095-aaaaaaaaaaa',
  'chegada', false, 'Cheguei de manhã.', null, '2026-09-21T09:40'));
insert into res values ('link_reason', public.client_link_interview_answer('token-da-entrevista-0095-aaaaaaaaaaa',
  'motivo', true, null, null, null));
insert into res values ('link_empty', public.client_link_interview_answer('token-da-entrevista-0095-aaaaaaaaaaa',
  'solucao', false, '   ', null, null));
insert into res values ('link_wrong', public.client_link_interview_answer('token-nenhum-0095-aaaaaaaaaaaaaaaaaa',
  'solucao', false, 'Outro voo no dia seguinte.', null, null));
reset role;
select ok(
  (select payload -> 'interview' ->> 'status' = 'open' and not (payload -> 'interview') ? 'in_chat'
          and payload -> 'interview' -> 'answers' ? 'aviso_local'
   from res where name = 'link_read')
  and pg_temp.got('link_arrival', 'code') = 'recorded'
  and (select answer = '21/09/2026 às 09:40. Cheguei de manhã.' and facts ->> 'quando' = '2026-09-21T09:40' and source = 'link'
       from public.case_interview_answers
       where interview_id = pg_temp.got('started', 'interview_id')::uuid and question = 'chegada'),
  'the link reads the interview and answers a moment with its words'
);
select ok(
  pg_temp.got('link_reason', 'code') = 'recorded'
  and (select status = 'unknown' and answer is null from public.case_interview_answers
       where interview_id = pg_temp.got('started', 'interview_id')::uuid and question = 'motivo')
  and pg_temp.got('link_empty', 'code') = 'answer_required'
  and pg_temp.got('link_wrong', 'ok') = 'false',
  '"I do not remember" is an answer; an empty one is not; a link that is not one answers nothing'
);

-- ---------- The firm ----------

select pg_temp.sign_in('a9800000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.case_interview_view(%L)', pg_temp.got('case', 'case_id')),
  'P0002', 'case_not_found',
  'another firm never reads the interview'
);
select throws_ok(
  format('select public.answer_case_interview(%L, %L, %L)', pg_temp.got('case', 'case_id'), 'solucao', 'Outro voo.'),
  'P0002', 'case_not_found',
  'nor answers it'
);
reset role;

select pg_temp.sign_in('a9800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('firm_answer', public.answer_case_interview(pg_temp.got('case', 'case_id')::uuid, 'solucao',
  'Ofereceram outro voo no dia seguinte, e ela aceitou.'));
insert into res values ('firm_over', public.answer_case_interview(pg_temp.got('case', 'case_id')::uuid, 'chegada',
  'Chegou no dia 21 às 10h.'));
insert into res values ('view', public.case_interview_view(pg_temp.got('case', 'case_id')::uuid));
select throws_ok(
  format('select public.close_case_interview(%L)', pg_temp.got('case', 'case_id')),
  '42501', 'not_authorized',
  'who attends the clients answers for them, and never closes the interview'
);
reset role;
select ok(
  pg_temp.got('firm_answer', 'code') = 'saved'
  and (select source = 'firm' and answered_by = 'a9800000-0000-4000-8000-000000000002' and answer = 'Chegou no dia 21 às 10h.'
              and facts = '{}'::jsonb
       from public.case_interview_answers
       where interview_id = pg_temp.got('started', 'interview_id')::uuid and question = 'chegada')
  and (select payload -> 'answers' -> 'solucao' ->> 'source' = 'firm' from res where name = 'view'),
  'a person of the firm answers for the passenger, or writes over an answer, as the firm''s'
);

-- ---------- The piece reads it, with what identifies a person taken out ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('piece', public.case_interview_for_piece(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  (select payload ->> 'situacao' = 'open'
          and jsonb_array_length(payload -> 'respostas') = 5
          and payload -> 'respostas' -> 0 ->> 'pergunta' = 'aviso_local'
          and payload -> 'respostas' -> 1 ->> 'situacao' = 'pulada'
          and payload -> 'respostas' -> 1 ->> 'por_que_pulada' = 'at_airport'
          and payload -> 'respostas' -> 2 ->> 'situacao' = 'nao_sabe'
   from res where name = 'piece'),
  'the piece reads each answer in the order of the questions, and why one was left out'
);

-- ---------- Outside the 24 hours, the firm's template asks to go on ----------

insert into public.wa_templates (id, org_id, waba_id, name, language, category, status, body, footer_text, param_count)
values ('99800000-0000-4000-8000-0000000000aa', 'b9800000-0000-4000-8000-00000000000a', 'waba-entrevista-a',
        'one_perguntas_do_caso_1', 'pt_BR', 'utility', 'approved',
        (select body from public.notice_kinds where kind = 'case_questions'), 'Para não receber estes avisos, responda SAIR.', 3);
insert into public.firm_notice_kinds (org_id, kind, template_id, body, enabled, submitted_at, changed_at)
values ('b9800000-0000-4000-8000-00000000000a', 'case_questions', '99800000-0000-4000-8000-0000000000aa',
        (select body from public.notice_kinds where kind = 'case_questions'), true, now(), now());

select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed_inside', coalesce(jsonb_agg(o.interview_id), '[]') from public.interview_resumes_owed(20) o;
reset role;
update public.wa_conversations set last_inbound_at = now() - interval '30 hours' where id = 'f9800000-0000-4000-8000-00000000000a';
select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed_outside', coalesce(jsonb_agg(jsonb_build_object('id', o.interview_id, 'name', o.first_name)), '[]')
from public.interview_resumes_owed(20) o;
insert into res values ('resumed', public.interview_resume(pg_temp.got('started', 'interview_id')::uuid,
  array['Ana', 'Lima Advogados', 'algumas respostas']));
insert into res values ('resumed_twice', public.interview_resume(pg_temp.got('started', 'interview_id')::uuid,
  array['Ana', 'Lima Advogados', 'algumas respostas']));
insert into res values ('asked_outside', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'assistencia',
  'A companhia deu alimentação?', 'ask'));
reset role;
select ok(
  (select payload = '[]'::jsonb from res where name = 'owed_inside')
  and (select payload @> jsonb_build_array(jsonb_build_object('id', pg_temp.got('started', 'interview_id'), 'name', 'Ana'))
       from res where name = 'owed_outside')
  and pg_temp.got('resumed', 'code') = 'queued' and pg_temp.got('resumed_twice', 'code') = 'not_owed'
  and (select kind = 'template' and body like 'Olá, Ana. O escritório Lima Advogados ainda precisa de algumas respostas%'
       from public.wa_messages where id = pg_temp.got('resumed', 'message_id')::uuid)
  and pg_temp.got('asked_outside', 'code') = 'unreachable',
  'outside the 24 hours ONE asks nothing, and the firm''s template asks to go on, once in the setting''s hours'
);

-- ---------- A lawyer goes on without the rest; or every question settled, it is done ----------

update public.case_advances set after = 'tomorrow', woken_at = null where case_id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.sign_in('a9800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('closed', public.close_case_interview(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('closed_again', public.close_case_interview(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('closed', 'code') = 'closed' and pg_temp.got('closed_again', 'code') = 'nothing_owed'
  and public.case_account_state(pg_temp.got('case', 'case_id')::uuid) = 'ready'
  and (select after is null and woken_at is not null from public.case_advances where case_id = pg_temp.got('case', 'case_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'interview_closed'),
  'a partner goes on without the rest: the account is ready, and the case is woken for ONE'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('asked_closed', public.interview_ask(pg_temp.got('started', 'interview_id')::uuid, 'gastos', 'Teve gastos?', 'ask'));
insert into res values ('started_b', public.interview_start(pg_temp.got('case_b', 'case_id')::uuid));
insert into res values ('done_b', public.interview_finish(pg_temp.got('started_b', 'interview_id')::uuid));
insert into res values ('done_b_twice', public.interview_finish(pg_temp.got('started_b', 'interview_id')::uuid));
reset role;
select ok(
  pg_temp.got('asked_closed', 'code') = 'not_open'
  and pg_temp.got('done_b', 'code') = 'done' and pg_temp.got('done_b_twice', 'code') = 'not_open'
  and public.case_account_state(pg_temp.got('case_b', 'case_id')::uuid) = 'ready'
  and (select status = 'done' and finished_at is not null from public.case_interviews
       where id = pg_temp.got('started_b', 'interview_id')::uuid),
  'a closed interview asks nothing; one with every question settled is done, and the account is ready'
);

-- A case of a bag, or one with a lawsuit, is owed no interview.
select pg_temp.sign_in('a9800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bag', public.create_case('b9800000-0000-4000-8000-00000000000a', 'baggage_lost', 'G3', date '2026-09-20',
  '{"full_name": "Rui Teste", "phone": "5500999998004"}'::jsonb));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('bag_start', public.interview_start(pg_temp.got('bag', 'case_id')::uuid));
reset role;
select is(pg_temp.got('bag_start', 'code'), 'not_owed', 'a bag''s problem has its own questions, not these');

-- The case's timeline names each step.
select ok(
  (select count(*) = 4 from public.case_events e
   where e.case_id = pg_temp.got('case', 'case_id')::uuid
     and e.kind in ('interview_started', 'interview_answered', 'interview_closed')),
  'the timeline says the interview started, a person answered for the passenger, and a lawyer closed it'
);

select * from finish();
rollback;
