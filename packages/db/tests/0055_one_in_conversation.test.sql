begin;
create extension if not exists pgtap;
select plan(23);

-- ============================================================
-- ONE in the conversation (0048): it takes a turn of a conversation it
-- answers, under a number; the passenger's choice to the alert is the
-- database's (a yes opens the case with the trip's flight, who travelled
-- along and the link with its next steps; a no ends it; a stop stops every
-- message); ONE's answer goes as its own; a person who writes takes the
-- conversation over, and gives it back; ONE calls a person; an answer the
-- firm keeps to a person goes once a person approves it. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a5500000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b5500000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-conversa', 'a5500000-0000-4000-8000-000000000001'),
  ('b5500000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-conversa', 'a5500000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5500000-0000-4000-8000-00000000000a', 'a5500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5500000-0000-4000-8000-00000000000a', 'a5500000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b5500000-0000-4000-8000-00000000000b', 'a5500000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c5500000-0000-4000-8000-00000000000a', 'b5500000-0000-4000-8000-00000000000a', 'whatsapp', 'conv-waba-a', 'Chat de teste',
   'connected', 'a5500000-0000-4000-8000-000000000001', now()),
  ('c5500000-0000-4000-8000-00000000000b', 'b5500000-0000-4000-8000-00000000000b', 'whatsapp', 'conv-waba-b', 'Chat de teste',
   'connected', 'a5500000-0000-4000-8000-000000000004', now());

-- ONE answers at once here: a test is one transaction, and every message in it is of the same moment.
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.trip(firm uuid, label text) returns uuid language sql as
$$ select t.id from public.tracked_trips t where t.org_id = trip.firm and t.label = trip.label; $$;
-- A trip's problem told by ONE, as the alerts' sweep tells it: kept, claimed and sent.
create function pg_temp.told(firm uuid, label text, kind text, delay integer) returns uuid language plpgsql as $$
declare
  alert uuid;
  claim integer;
begin
  alert := (public.record_flight_alert(pg_temp.trip(firm, label), kind, 1, delay, 'flight-problem-v1') ->> 'alert_id')::uuid;
  claim := ((public.claim_flight_alerts(1, alert) -> 0) ->> 'claim')::integer;
  perform public.reserve_flight_alert(alert, claim,
    array['Nome', 'Escritório', 'Voo de teste de hoje', 'teve um problema', 'oferecer outro voo']);
  return alert;
end;
$$;
-- The passenger writes from their mobile to the firm's test number, as the inbox takes it.
create function pg_temp.writes(firm uuid, phone text, kind text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Passageiro', 'test.in.' || gen_random_uuid(), kind, body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b5500000-0000-4000-8000-00000000000a',
  'c5500000-0000-4000-8000-00000000000a', 'test', 'conv-number-a', 'conv-waba-a', '5500900000051', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b5500000-0000-4000-8000-00000000000b',
  'c5500000-0000-4000-8000-00000000000b', 'test', 'conv-number-b', 'conv-waba-b', '5500900000052', 'Rocha Advocacia', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b5500000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('a', 43), 'a5500000-0000-4000-8000-000000000001'));
insert into res values ('chat_b', public.start_test_chat('b5500000-0000-4000-8000-00000000000b',
  pg_temp.got('number_b', 'number_id')::uuid, repeat('b', 43), 'a5500000-0000-4000-8000-000000000004'));
-- A test chat brings no passenger of its own since 0087: the ready trips this test acts on are made here.
reset role;
insert into res values ('seed_a', to_jsonb(public.seed_test_trips('b5500000-0000-4000-8000-00000000000a')));
insert into res values ('seed_b', to_jsonb(public.seed_test_trips('b5500000-0000-4000-8000-00000000000b')));
set local role service_role;
-- Mariana's flight is cancelled and she taps SIM.
insert into res values ('mariana_alert', jsonb_build_object('id', pg_temp.told('b5500000-0000-4000-8000-00000000000a', 'cancelamento', 'cancelled', null)));
insert into res values ('mariana', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000a', '5500988880001', 'button', 'SIM')));
insert into res values ('mariana_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('mariana', 'conversation')::uuid)));
insert into res values ('mariana_again', jsonb_build_object('items',
  public.claim_conversation_turns(1, pg_temp.got('mariana', 'conversation')::uuid)));
insert into res values ('mariana_context', public.conversation_turn_context(pg_temp.got('mariana', 'conversation')::uuid,
  pg_temp.got('mariana_claim', 'claim')::integer));
insert into res values ('wrong_claim', public.conversation_turn_context(pg_temp.got('mariana', 'conversation')::uuid,
  pg_temp.got('mariana_claim', 'claim')::integer + 1));
insert into res values ('mariana_case', public.one_open_case_from_alert(pg_temp.got('mariana', 'conversation')::uuid,
  pg_temp.got('mariana_claim', 'claim')::integer, pg_temp.got('mariana_alert', 'id')::uuid, repeat('c', 64),
  'Pronto, Mariana. O escritório abriu o seu caso, número {caso}. Abra o seu link: https://one.invalid/c/token-um'));
insert into res values ('mariana_twice', public.one_open_case_from_alert(pg_temp.got('mariana', 'conversation')::uuid,
  pg_temp.got('mariana_claim', 'claim')::integer, pg_temp.got('mariana_alert', 'id')::uuid, repeat('d', 64), 'De novo {caso}'));
insert into res values ('mariana_done', public.record_conversation_turn(pg_temp.got('mariana', 'conversation')::uuid,
  pg_temp.got('mariana_claim', 'claim')::integer, now()));
reset role;

-- ---------- The task, the decisions, who may call what ----------

select ok(
  exists (select 1 from public.prompt_versions v where v.task = 'atendimento.conversa' and v.is_active
          and v.model = 'claude-sonnet-5-5' and v.output_schema -> 'required' ? 'chamar_pessoa')
  and (select modes = array['auto', 'sampled', 'approval'] and task = 'atendimento.conversa'
       from public.autonomy_decisions where key = 'reply_client')
  and (select modes = array['auto', 'approval'] and default_mode = 'auto' from public.autonomy_decisions where key = 'open_case_from_chat'),
  'a task answers the passenger, and the firm says how much ONE answers and whether it opens the case'
);

select ok(
  not has_function_privilege('authenticated', 'public.claim_conversation_turns(integer, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.conversation_turn_context(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.one_reply(uuid, integer, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.one_open_case_from_alert(uuid, integer, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.call_person(uuid, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.one_send_approved_reply(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.set_conversation_agent(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_conversation_agent(uuid, text)', 'execute'),
  'only the backend takes ONE''s turns; anybody of the firm takes a conversation over or gives it back'
);

-- ---------- A turn of ONE ----------

select ok(
  pg_temp.got('mariana_claim', 'claim') is not null
  and jsonb_array_length((select payload -> 'items' from res where name = 'mariana_again')) = 0
  and pg_temp.got('wrong_claim', 'code') = 'not_working',
  'a turn is claimed once, under a number, and read only by who holds it'
);

select ok(
  (select payload -> 'alert' @> '{"kind": "cancelled", "passenger_name": "Mariana Teste"}'::jsonb
   from res where name = 'mariana_context')
  and pg_temp.got('mariana_context', 'firm') = 'Souza Advogados'
  and (select payload -> 'modes' from res where name = 'mariana_context')
      = '{"reply_client": "auto", "open_case_from_chat": "auto", "send_client_link": "auto"}'::jsonb
  and (select payload -> 'messages' from res where name = 'mariana_context')
      @> '[{"author": "one", "kind": "template"}, {"author": "cliente", "kind": "button", "text": "SIM"}]'::jsonb,
  'ONE reads the alert that waits for the choice, what the firm lets it do, and who wrote each message'
);

-- ---------- A yes opens the case ----------

select ok(
  pg_temp.got('mariana_case', 'code') = 'opened'
  and (select k.incident = 'cancellation' and k.airline_iata = 'LA' and k.created_by is null
       and k.flight_date = (now() at time zone 'America/Sao_Paulo')::date
       from public.cases k where k.id = pg_temp.got('mariana_case', 'case_id')::uuid)
  and (select p.full_name = 'Mariana Teste' and p.phone = '5500988880001'
       from public.case_parties cp join public.people p on p.id = cp.person_id
       where cp.case_id = pg_temp.got('mariana_case', 'case_id')::uuid and cp.role = 'claimant'),
  'a yes opens the case at once: the problem, the airline, the day and the passenger with the mobile of the conversation'
);

select ok(
  (select count(*) = 1 and bool_and(s.affected and s.origin_iata = 'GRU' and s.destination_iata = 'REC')
   from public.flight_segments s where s.case_id = pg_temp.got('mariana_case', 'case_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('mariana_case', 'case_id')::uuid
              and e.kind = 'created' and e.actor_type = 'system' and e.data ->> 'from' = 'conversation'),
  'with the trip''s flight, the problem''s leg marked, told in the timeline as ONE''s'
);

select ok(
  exists (select 1 from public.client_links l where l.case_id = pg_temp.got('mariana_case', 'case_id')::uuid
          and l.token_hash = repeat('c', 64) and l.created_by is null)
  and exists (
    select 1 from public.wa_messages m where m.id = pg_temp.got('mariana_case', 'message_id')::uuid
      and m.body = 'Pronto, Mariana. O escritório abriu o seu caso, número ' || pg_temp.got('mariana_case', 'seq')
                   || '. Abra o seu link: https://one.invalid/c/token-um'
      and m.sent_by is null and m.ai_run_id is null and m.status = 'queued' and m.by_one
  ),
  'and the client''s link goes in the same conversation, with the case''s number in its words'
);

select ok(
  (select t.status = 'case_opened' and t.case_id = pg_temp.got('mariana_case', 'case_id')::uuid
   from public.tracked_trips t where t.id = pg_temp.trip('b5500000-0000-4000-8000-00000000000a', 'cancelamento'))
  and (select a.answer = 'yes' from public.flight_alerts a where a.id = pg_temp.got('mariana_alert', 'id')::uuid)
  and (select array_agg(e.kind order by e.kind) from public.wa_conversation_events e
       where e.conversation_id = pg_temp.got('mariana', 'conversation')::uuid) = array['case_opened', 'link_sent']
  and pg_temp.got('mariana_twice', 'code') = 'already_opened'
  and (select c.one_through is not null and c.one_claimed_at is null from public.wa_conversations c
       where c.id = pg_temp.got('mariana', 'conversation')::uuid),
  'the trip, the alert and the conversation say what happened, a second yes opens nothing, and the turn is done'
);

-- ---------- A family with a child ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('rafael_alert', jsonb_build_object('id', pg_temp.told('b5500000-0000-4000-8000-00000000000a', 'familia', 'delayed', 360)));
update public.tracked_legs set status = 'delayed', estimated_arrival_local = scheduled_arrival_local + interval '6 hours'
where trip_id = pg_temp.trip('b5500000-0000-4000-8000-00000000000a', 'familia');
insert into res values ('rafael', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000a', '5500988880002', 'text', 'sim, quero')));
insert into res values ('rafael_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('rafael', 'conversation')::uuid)));
insert into res values ('rafael_case', public.one_open_case_from_alert(pg_temp.got('rafael', 'conversation')::uuid,
  pg_temp.got('rafael_claim', 'claim')::integer, pg_temp.got('rafael_alert', 'id')::uuid, repeat('e', 64),
  'Pronto, Rafael. Caso {caso}. Link: https://one.invalid/c/token-dois'));
reset role;

select ok(
  pg_temp.got('rafael_case', 'code') = 'opened'
  and (select k.incident = 'delay' from public.cases k where k.id = pg_temp.got('rafael_case', 'case_id')::uuid)
  and (select array_agg(p.full_name || ':' || cp.role || ':' || (cp.guardian_id is not null) order by p.full_name, cp.role)
       from public.case_parties cp join public.people p on p.id = cp.person_id
       where cp.case_id = pg_temp.got('rafael_case', 'case_id')::uuid)
      = array['Laura Teste:claimant:true', 'Rafael Teste:claimant:false', 'Rafael Teste:guardian:false']
  and (select s.actual_arrival_local - s.scheduled_arrival_local = interval '6 hours'
       from public.flight_segments s where s.case_id = pg_temp.got('rafael_case', 'case_id')::uuid),
  'a family''s case has the child as a claimant with who answers for her, and the arrival the source gave'
);

-- ---------- A no, and a stop ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('pedro_alert', jsonb_build_object('id', pg_temp.told('b5500000-0000-4000-8000-00000000000a', 'internacional', 'delayed', 540)));
insert into res values ('pedro', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000a', '5500988880004', 'button', 'NÃO')));
insert into res values ('pedro_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('pedro', 'conversation')::uuid)));
insert into res values ('pedro_no', public.answer_flight_alert(pg_temp.got('pedro', 'conversation')::uuid,
  pg_temp.got('pedro_claim', 'claim')::integer, 'no'));
insert into res values ('pedro_bye', public.one_say(pg_temp.got('pedro', 'conversation')::uuid,
  pg_temp.got('pedro_claim', 'claim')::integer, 'Tudo bem, Pedro. O escritório não vai seguir com este caso.'));
insert into res values ('lucia_alert', jsonb_build_object('id', pg_temp.told('b5500000-0000-4000-8000-00000000000a', 'conexao', 'delayed', 420)));
insert into res values ('lucia', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000a', '5500988880003', 'button', 'SAIR')));
insert into res values ('lucia_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('lucia', 'conversation')::uuid)));
insert into res values ('lucia_stop', public.answer_flight_alert(pg_temp.got('lucia', 'conversation')::uuid,
  pg_temp.got('lucia_claim', 'claim')::integer, 'stop'));
insert into res values ('lucia_say', public.one_say(pg_temp.got('lucia', 'conversation')::uuid,
  pg_temp.got('lucia_claim', 'claim')::integer, 'Mais uma mensagem'));
insert into res values ('lucia_done', public.record_conversation_turn(pg_temp.got('lucia', 'conversation')::uuid,
  pg_temp.got('lucia_claim', 'claim')::integer, now()));
-- Lúcia writes again: ONE says nothing to who asked to stop.
update public.wa_conversations set last_inbound_at = now() + interval '1 second', one_through = now()
where id = pg_temp.got('lucia', 'conversation')::uuid;
insert into res values ('lucia_later', jsonb_build_object('items',
  public.claim_conversation_turns(1, pg_temp.got('lucia', 'conversation')::uuid)));
reset role;

select ok(
  pg_temp.got('pedro_no', 'code') = 'answered' and pg_temp.got('pedro_bye', 'code') = 'queued'
  and (select t.status from public.tracked_trips t where t.id = pg_temp.trip('b5500000-0000-4000-8000-00000000000a', 'internacional'))
      = 'declined'
  and exists (select 1 from public.wa_conversation_events e
              where e.conversation_id = pg_temp.got('pedro', 'conversation')::uuid and e.kind = 'declined'),
  'a no ends the trip''s alerts kindly, and the conversation says so'
);

select ok(
  pg_temp.got('lucia_stop', 'code') = 'answered'
  and exists (select 1 from public.wa_optouts o where o.org_id = 'b5500000-0000-4000-8000-00000000000a'
              and o.contact_wa_id = '5500988880003')
  and (select t.status from public.tracked_trips t where t.id = pg_temp.trip('b5500000-0000-4000-8000-00000000000a', 'conexao'))
      = 'stopped'
  and pg_temp.got('lucia_say', 'code') = 'opted_out'
  and jsonb_array_length((select payload -> 'items' from res where name = 'lucia_later')) = 0,
  'a stop stops every message: ONE says nothing more and takes no turn there'
);

-- ---------- ONE's own answer ----------

-- Mariana asks a question: a run of the task answers it. (A test is one moment: what ONE answered is set back.)
select pg_temp.as_backend();
set local role service_role;
update public.wa_conversations set one_through = now() - interval '10 seconds'
where id = pg_temp.got('mariana', 'conversation')::uuid;
insert into res values ('question', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000a', '5500988880001', 'text', 'Quanto tempo demora?')));
insert into res values ('question_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('question', 'conversation')::uuid)));
insert into res values ('run', public.start_ai_run('b5500000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('f', 64),
  null, 'wa_conversation', pg_temp.got('question', 'conversation'), null));
insert into res values ('run_done', public.finish_ai_run(pg_temp.got('run', 'run_id')::uuid, 'succeeded',
  '{"intencao": "pergunta", "resposta": "O escritório vai avaliar o seu caso e te escreve por aqui.", "chamar_pessoa": null}'::jsonb,
  1000, 60, 'claude-sonnet-5-5'));
insert into res values ('unknown_run', public.one_reply(pg_temp.got('question', 'conversation')::uuid,
  pg_temp.got('question_claim', 'claim')::integer, gen_random_uuid(), 'Oi'));
insert into res values ('reply', public.one_reply(pg_temp.got('question', 'conversation')::uuid,
  pg_temp.got('question_claim', 'claim')::integer, pg_temp.got('run', 'run_id')::uuid,
  'O escritório vai avaliar o seu caso e te escreve por aqui.'));
insert into res values ('question_done', public.record_conversation_turn(pg_temp.got('question', 'conversation')::uuid,
  pg_temp.got('question_claim', 'claim')::integer, now() + interval '1 second'));
reset role;

select ok(
  pg_temp.got('unknown_run', 'code') = 'run_not_found' and pg_temp.got('reply', 'code') = 'queued'
  and pg_temp.got('run_done', 'approval_id') is null
  and exists (select 1 from public.wa_messages m where m.id = pg_temp.got('reply', 'message_id')::uuid
              and m.ai_run_id = pg_temp.got('run', 'run_id')::uuid and m.sent_by is null and m.by_one)
  and (select c.agent = 'one' and c.last_message_direction = 'out' from public.wa_conversations c
       where c.id = pg_temp.got('question', 'conversation')::uuid),
  'ONE answers with its run''s own answer, which says what it cost, and only with one of this conversation'
);

-- ---------- A person takes over, and gives it back ----------

update public.wa_conversations set last_inbound_at = now() - interval '1 minute'
where id = pg_temp.got('question', 'conversation')::uuid;
select pg_temp.sign_in('a5500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_writes', public.reserve_wa_send(pg_temp.got('question', 'conversation')::uuid, 'text',
  'Oi, Mariana, aqui é a Bia do escritório.'));
reset role;

select ok(
  pg_temp.got('bia_writes', 'code') = 'queued'
  and (select not m.by_one and m.sent_by = 'a5500000-0000-4000-8000-000000000002' from public.wa_messages m
       where m.id = pg_temp.got('bia_writes', 'message_id')::uuid)
  and (select c.agent = 'person' and c.agent_changed_by = 'a5500000-0000-4000-8000-000000000002'
       from public.wa_conversations c where c.id = pg_temp.got('question', 'conversation')::uuid)
  and exists (select 1 from public.wa_conversation_events e
              where e.conversation_id = pg_temp.got('question', 'conversation')::uuid and e.kind = 'taken_over'
                and e.actor_id = 'a5500000-0000-4000-8000-000000000002'),
  'a person who writes takes the conversation over: ONE stops there'
);

-- Mariana writes while Bia has it: ONE takes no turn.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('while_person', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000a', '5500988880001', 'text', 'Obrigada')));
update public.wa_conversations set one_through = now() - interval '10 seconds'
where id = pg_temp.got('question', 'conversation')::uuid;
insert into res values ('while_person_claim', jsonb_build_object('items',
  public.claim_conversation_turns(1, pg_temp.got('question', 'conversation')::uuid)));
reset role;

select pg_temp.sign_in('a5500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('given_back', public.set_conversation_agent(pg_temp.got('question', 'conversation')::uuid, 'one'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('after_back', jsonb_build_object('items',
  public.claim_conversation_turns(1, pg_temp.got('question', 'conversation')::uuid)));
reset role;

select ok(
  jsonb_array_length((select payload -> 'items' from res where name = 'while_person_claim')) = 0
  and pg_temp.got('given_back', 'code') = 'changed'
  and jsonb_array_length((select payload -> 'items' from res where name = 'after_back')) = 1
  and exists (select 1 from public.wa_conversation_events e
              where e.conversation_id = pg_temp.got('question', 'conversation')::uuid and e.kind = 'returned_to_one'),
  'ONE takes no turn while a person has it; given back, it answers what the passenger wrote last'
);

-- ---------- ONE calls a person ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('called', public.call_person(pg_temp.got('question', 'conversation')::uuid,
  ((select payload -> 'items' -> 0 ->> 'claim' from res where name = 'after_back'))::integer,
  'A passageira quer falar com um advogado.'));
reset role;
select pg_temp.sign_in('a5500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('pending_a', public.firm_pending('b5500000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a5500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('pending_b', public.firm_pending('b5500000-0000-4000-8000-00000000000b'));
insert into res values ('b_takes', public.set_conversation_agent(pg_temp.got('question', 'conversation')::uuid, 'person'));
select is(
  (select count(*)::int from public.wa_conversation_events),
  0,
  'another firm reads nothing of a firm''s conversations'
);
reset role;

select ok(
  pg_temp.got('called', 'code') = 'called'
  and (select c.agent = 'person' and c.called_reason = 'A passageira quer falar com um advogado.'
       from public.wa_conversations c where c.id = pg_temp.got('question', 'conversation')::uuid)
  and (pg_temp.got('pending_a', 'conversations_called_total'))::integer = 1
  and (select (payload -> 'conversations_called' -> 0 ->> 'late')::boolean = false from res where name = 'pending_a')
  and (select payload -> 'conversations_called' -> 0 ->> 'reason' from res where name = 'pending_a')
      = 'A passageira quer falar com um advogado.'
  and (pg_temp.got('pending_b', 'conversations_called_total'))::integer = 0,
  'a conversation ONE called a person to waits in the firm''s center of what waits, with why, and in no other firm''s'
);

select is(pg_temp.got('b_takes', 'code'), 'not_found', 'another firm cannot take a firm''s conversation over');

-- ---------- An answer the firm keeps to a person ----------

select pg_temp.sign_in('a5500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approval_mode', public.set_firm_autonomy('b5500000-0000-4000-8000-00000000000a', 'reply_client', 'approval'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run2', public.start_ai_run('b5500000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('9', 64),
  null, 'wa_conversation', pg_temp.got('mariana', 'conversation'), null));
insert into res values ('run2_done', public.finish_ai_run(pg_temp.got('run2', 'run_id')::uuid, 'succeeded',
  '{"intencao": "documentos", "resposta": "O link do seu caso está aqui na conversa.", "chamar_pessoa": null}'::jsonb,
  1000, 60, 'claude-sonnet-5-5'));
insert into res values ('not_yet', public.one_send_approved_reply(pg_temp.got('run2_done', 'approval_id')::uuid));
reset role;
select pg_temp.sign_in('a5500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('approved', public.decide_approval(pg_temp.got('run2_done', 'approval_id')::uuid, 'approved',
  '{"intencao": "documentos", "resposta": "O link do seu caso está aqui na conversa, Mariana.", "chamar_pessoa": null}'::jsonb));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('sent_after', public.one_send_approved_reply(pg_temp.got('run2_done', 'approval_id')::uuid));
insert into res values ('sent_twice', public.one_send_approved_reply(pg_temp.got('run2_done', 'approval_id')::uuid));
reset role;

select ok(
  pg_temp.got('run2_done', 'approval_id') is not null and pg_temp.got('not_yet', 'code') = 'not_approved'
  and pg_temp.got('sent_after', 'code') = 'queued' and pg_temp.got('sent_twice', 'code') = 'already_sent'
  and exists (select 1 from public.wa_messages m where m.id = pg_temp.got('sent_after', 'message_id')::uuid
              and m.body = 'O link do seu caso está aqui na conversa, Mariana.'
              and m.ai_run_id = pg_temp.got('run2', 'run_id')::uuid and m.sent_by = 'a5500000-0000-4000-8000-000000000002'
              and m.by_one)
  and (select count(*) = 1 from public.wa_conversation_events e
       where e.conversation_id = pg_temp.got('mariana', 'conversation')::uuid and e.kind = 'taken_over'),
  'an answer the firm keeps to a person waits, goes once as approved, and is still ONE''s: it takes nothing over'
);

-- ---------- Answers that wait give way ----------

select pg_temp.sign_in('a5500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('back_to_one', public.set_conversation_agent(pg_temp.got('mariana', 'conversation')::uuid, 'one'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run3', public.start_ai_run('b5500000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('7', 64),
  null, 'wa_conversation', pg_temp.got('mariana', 'conversation'), null));
insert into res values ('run3_done', public.finish_ai_run(pg_temp.got('run3', 'run_id')::uuid, 'succeeded',
  '{"intencao": "pergunta", "resposta": "O escritório vai avaliar o seu caso.", "chamar_pessoa": null}'::jsonb,
  900, 40, 'claude-sonnet-5-5'));
insert into res values ('run4', public.start_ai_run('b5500000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('6', 64),
  null, 'wa_conversation', pg_temp.got('mariana', 'conversation'), null));
insert into res values ('run4_done', public.finish_ai_run(pg_temp.got('run4', 'run_id')::uuid, 'succeeded',
  '{"intencao": "documentos", "resposta": "Pode enviar tudo pelo link do caso.", "chamar_pessoa": null}'::jsonb,
  900, 40, 'claude-sonnet-5-5'));
reset role;
create temp table waits_after_newer as
  select a.id, a.status, a.decision_note from public.approvals a
  where a.id in (pg_temp.got('run3_done', 'approval_id')::uuid, pg_temp.got('run4_done', 'approval_id')::uuid);
select pg_temp.sign_in('a5500000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_takes', public.set_conversation_agent(pg_temp.got('mariana', 'conversation')::uuid, 'person'));
reset role;

select ok(
  pg_temp.got('back_to_one', 'code') = 'changed' and pg_temp.got('bia_takes', 'code') = 'changed'
  and (select w.status = 'withdrawn' and w.decision_note = 'Uma resposta mais nova do ONE espera no lugar desta.'
       from waits_after_newer w where w.id = pg_temp.got('run3_done', 'approval_id')::uuid)
  and (select w.status = 'pending' from waits_after_newer w where w.id = pg_temp.got('run4_done', 'approval_id')::uuid)
  and (select a.status = 'withdrawn' and a.decision_note = 'Uma pessoa do escritório assumiu a conversa.'
       from public.approvals a where a.id = pg_temp.got('run4_done', 'approval_id')::uuid),
  'one answer of ONE waits per conversation, and none once a person takes the conversation over'
);

-- ---------- A firm that keeps opening the case to a person ----------

select pg_temp.sign_in('a5500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_mode', public.set_firm_autonomy('b5500000-0000-4000-8000-00000000000b', 'open_case_from_chat', 'approval'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_alert', jsonb_build_object('id', pg_temp.told('b5500000-0000-4000-8000-00000000000b', 'cancelamento', 'cancelled', null)));
insert into res values ('b_conv', jsonb_build_object('conversation',
  pg_temp.writes('b5500000-0000-4000-8000-00000000000b', '5500988880001', 'button', 'SIM')));
insert into res values ('b_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('b_conv', 'conversation')::uuid)));
insert into res values ('b_open', public.one_open_case_from_alert(pg_temp.got('b_conv', 'conversation')::uuid,
  pg_temp.got('b_claim', 'claim')::integer, pg_temp.got('b_alert', 'id')::uuid, repeat('a', 64), 'Caso {caso}'));
insert into res values ('b_cross', public.one_open_case_from_alert(pg_temp.got('b_conv', 'conversation')::uuid,
  pg_temp.got('b_claim', 'claim')::integer, pg_temp.got('mariana_alert', 'id')::uuid, repeat('a', 64), 'Caso {caso}'));
reset role;

select ok(
  pg_temp.got('b_open', 'code') = 'by_person'
  and not exists (select 1 from public.cases k where k.org_id = 'b5500000-0000-4000-8000-00000000000b')
  and (select a.answer = 'yes' from public.flight_alerts a where a.id = pg_temp.got('b_alert', 'id')::uuid),
  'a firm that keeps it to a person has the yes kept and no case opened by ONE'
);

select is(pg_temp.got('b_cross', 'code'), 'no_alert', 'and an alert of another firm opens nothing in its conversation');

select ok(
  (select count(*) = 2 from public.cases k where k.org_id = 'b5500000-0000-4000-8000-00000000000a')
  and (select bool_and(k.seq in (1, 2)) from public.cases k where k.org_id = 'b5500000-0000-4000-8000-00000000000a'),
  'each case ONE opens takes the firm''s next number'
);

-- The third version (0063) keeps the second's words and names the documents first among the next steps.
select ok(
  (select array_agg(v.version::text || ':' || v.is_active::text order by v.version) from public.prompt_versions v
   where v.task = 'atendimento.conversa') = array['1:false', '2:false', '3:true']
  and (select v.system_prompt like '%Responda você mesmo o caminho do caso, sem chamar ninguém%'
              and v.system_prompt like '%os próximos passos (abrir o link, enviar os documentos, conferir os dados%'
       from public.prompt_versions v where v.task = 'atendimento.conversa' and v.is_active),
  'the instructions in force have ONE answer the course of a case itself, documents first, and call a person when it cannot go on'
);

select * from finish();
rollback;
