begin;
create extension if not exists pgtap;
select plan(19);

-- ============================================================
-- The firm's conversations in the screen pattern (0109): `firm_inbox`
-- reads a view over every conversation of the firm (of one module, or
-- every one), searched by a name or a number, in the order asked, with the
-- total of the list and the count of every view. Two firms: A with a
-- conversation in each state, one of them older than any short page; B
-- with a conversation of the same person's number.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-inbox.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@lima-inbox.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-inbox.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1100000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-inbox', 'a1100000-0000-4000-8000-000000000001'),
  ('b1100000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-inbox', 'a1100000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1100000-0000-4000-8000-00000000000a', 'a1100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1100000-0000-4000-8000-00000000000a', 'a1100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1100000-0000-4000-8000-00000000000b', 'a1100000-0000-4000-8000-000000000003', 'owner', 'socio');

-- A's client of a passenger case, whose number the conversation has without its ninth digit.
insert into public.cases (id, org_id, seq, module, incident) values
  ('c1100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay');
insert into public.people (id, org_id, full_name, phone) values
  ('d1100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-00000000000a', 'Paula Teste', '5562999998101');
insert into public.case_parties (case_id, org_id, person_id, role) values
  ('c1100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-00000000000a', 'd1100000-0000-4000-8000-000000000001', 'claimant');

insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('f1100000-0000-4000-8000-00000000000a', 'b1100000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-inbox-a', 'WhatsApp A', 'connected'),
  ('f1100000-0000-4000-8000-00000000000b', 'b1100000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-inbox-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('11100000-0000-4000-8000-00000000000a', 'b1100000-0000-4000-8000-00000000000a', 'f1100000-0000-4000-8000-00000000000a',
   'simulator', 'sim-inbox-a', 'waba-inbox-a', '5562900001101'),
  ('11100000-0000-4000-8000-00000000000b', 'b1100000-0000-4000-8000-00000000000b', 'f1100000-0000-4000-8000-00000000000b',
   'simulator', 'sim-inbox-b', 'waba-inbox-b', '5562900001102');

-- A's conversations:
--   1 Paula: she wrote an hour ago, two messages nobody read (her case's client);
--   2 Rui: he wrote 21 hours ago, so his 24 hours close in 3;
--   3 Sara: ONE called a person, who answers it now;
--   4 Teo: an answer of ONE waits for "Enviar";
--   5 Tadeu: asked the firm to stop;
--   6 Vera: a message to her did not go out;
--   7 João: he wrote 30 days ago and nobody answered.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, saved_name, contact_name, last_message_at, last_inbound_at, last_message_direction, unread_count, agent, called_reason, called_at) values
  ('21100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '556299998101', 'Paula Souza', null, now() - interval '1 hour', now() - interval '1 hour', 'in', 2, 'one', null, null),
  ('21100000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '5562999998102', null, 'Rui', now() - interval '21 hours', now() - interval '21 hours', 'in', 0, 'one', null, null),
  ('21100000-0000-4000-8000-000000000003', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '5562999998103', null, 'Sara', now() - interval '2 hours', now() - interval '3 hours', 'out', 0, 'person', 'Pediu para falar com um advogado.', now() - interval '2 hours'),
  ('21100000-0000-4000-8000-000000000004', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '5562999998104', null, 'Teo', now() - interval '4 hours', now() - interval '5 hours', 'out', 0, 'one', null, null),
  ('21100000-0000-4000-8000-000000000005', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '5562999998105', null, 'Tadeu', now() - interval '5 hours', now() - interval '6 hours', 'out', 0, 'one', null, null),
  ('21100000-0000-4000-8000-000000000006', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '5562999998106', null, 'Vera', now() - interval '6 hours', now() - interval '7 hours', 'out', 0, 'one', null, null),
  ('21100000-0000-4000-8000-000000000007', 'b1100000-0000-4000-8000-00000000000a', '11100000-0000-4000-8000-00000000000a',
   '5562999998107', 'João Lima', null, now() - interval '30 days', now() - interval '30 days', 'in', 0, 'one', null, null),
  -- B: Paula's number, in another firm.
  ('21100000-0000-4000-8000-000000000008', 'b1100000-0000-4000-8000-00000000000b', '11100000-0000-4000-8000-00000000000b',
   '556299998101', 'Paula Souza', null, now() - interval '1 hour', now() - interval '1 hour', 'in', 1, 'one', null, null);

insert into public.wa_optouts (org_id, contact_wa_id, source) values
  ('b1100000-0000-4000-8000-00000000000a', '5562999998105', 'keyword');
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status, error_code, created_at) values
  ('b1100000-0000-4000-8000-00000000000a', '21100000-0000-4000-8000-000000000006', '11100000-0000-4000-8000-00000000000a',
   'out', 'text', 'Recebemos o seu documento.', 'failed', '131047', now() - interval '6 hours');
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, subject_type, subject_id, status, output, finished_at)
select '31100000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-00000000000a', v.task, v.id, v.provider, v.model,
       repeat('a', 64), 'wa_conversation', '21100000-0000-4000-8000-000000000004', 'succeeded',
       '{"resposta": "Olá, Teo. O seu caso segue."}'::jsonb, now()
from public.prompt_versions v where v.task = 'atendimento.conversa' and v.is_active;
insert into public.approvals (org_id, run_id, task, approver_functions) values
  ('b1100000-0000-4000-8000-00000000000a', '31100000-0000-4000-8000-000000000001', 'atendimento.conversa',
   array['socio', 'atendimento']::public.firm_function[]);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal1')::text, true); $$;
create function pg_temp.ids(name text) returns jsonb language sql as
$$ select payload -> 'ids' from res where res.name = ids.name; $$;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

select pg_temp.sign_in('a1100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('all', public.firm_inbox('b1100000-0000-4000-8000-00000000000a'));
insert into res values ('waiting', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'esperando'));
insert into res values ('waiting_oldest', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'esperando', null, null, 'oldest'));
insert into res values ('waiting_short', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'esperando', null, null, null, 2));
insert into res values ('closing', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'fechando'));
insert into res values ('called', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'chamou'));
insert into res values ('reply', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'resposta'));
insert into res values ('person', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'com-pessoa'));
insert into res values ('unread', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'nao-lidas'));
insert into res values ('failed', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'falhou'));
insert into res values ('stopped', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'pararam'));
insert into res values ('by_name', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, 'paula'));
insert into res values ('by_record', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, 'Teste PAULA'));
insert into res values ('by_accent', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, 'joao'));
insert into res values ('by_digits', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, '(62) 9999-8101'));
insert into res values ('by_marks', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, ' - '));
insert into res values ('waiting_named', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'esperando', 'rui'));
insert into res values ('module', public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, null, 'direito-do-passageiro'));
reset role;

select ok(
  pg_temp.got('all', '{counts}')::jsonb = '{"todas": 7, "esperando": 3, "fechando": 1, "chamou": 1, "resposta": 1,
    "com-pessoa": 1, "nao-lidas": 1, "falhou": 1, "pararam": 1}'::jsonb
    and pg_temp.got('all', '{total}')::int = 7,
  'every view of the firm is counted over all its conversations, none of another firm''s'
);
select is(
  pg_temp.ids('all'),
  '["21100000-0000-4000-8000-000000000001", "21100000-0000-4000-8000-000000000003", "21100000-0000-4000-8000-000000000004",
    "21100000-0000-4000-8000-000000000005", "21100000-0000-4000-8000-000000000006", "21100000-0000-4000-8000-000000000002",
    "21100000-0000-4000-8000-000000000007"]'::jsonb,
  'the list is the latest message first'
);
select is(
  pg_temp.ids('waiting'),
  '["21100000-0000-4000-8000-000000000001", "21100000-0000-4000-8000-000000000002", "21100000-0000-4000-8000-000000000007"]'::jsonb,
  'who wrote last and was not answered, the one of a month ago included'
);
select is(
  pg_temp.ids('waiting_oldest'),
  '["21100000-0000-4000-8000-000000000007", "21100000-0000-4000-8000-000000000002", "21100000-0000-4000-8000-000000000001"]'::jsonb,
  'the oldest first puts who waits the longest at the top'
);
select ok(
  jsonb_array_length(pg_temp.ids('waiting_short')) = 2 and pg_temp.got('waiting_short', '{total}')::int = 3,
  'a short page holds its size and still says how many the view has'
);
select is(pg_temp.ids('closing'), '["21100000-0000-4000-8000-000000000002"]'::jsonb,
  'the window that closes within the setting''s hours');
select ok(
  pg_temp.ids('called') = '["21100000-0000-4000-8000-000000000003"]'::jsonb
    and pg_temp.ids('person') = '["21100000-0000-4000-8000-000000000003"]'::jsonb,
  'where ONE called a person, and where a person answers'
);
select is(pg_temp.ids('reply'), '["21100000-0000-4000-8000-000000000004"]'::jsonb,
  'where an answer of ONE waits for "Enviar"');
select ok(
  pg_temp.ids('unread') = '["21100000-0000-4000-8000-000000000001"]'::jsonb
    and pg_temp.ids('failed') = '["21100000-0000-4000-8000-000000000006"]'::jsonb
    and pg_temp.ids('stopped') = '["21100000-0000-4000-8000-000000000005"]'::jsonb,
  'what nobody read, what did not go out and who asked to stop'
);
select ok(
  pg_temp.ids('by_name') = '["21100000-0000-4000-8000-000000000001"]'::jsonb
    and pg_temp.got('by_name', '{total}')::int = 1
    and pg_temp.got('by_name', '{counts,todas}')::int = 7,
  'a name finds its conversation, and the counts stay the views'''
);
select is(pg_temp.ids('by_record'), '["21100000-0000-4000-8000-000000000001"]'::jsonb,
  'a name the firm has for the person of that number finds it too, the words in any order');
select is(pg_temp.ids('by_accent'), '["21100000-0000-4000-8000-000000000007"]'::jsonb,
  'a name is found without its accent');
select is(pg_temp.ids('by_digits'), '["21100000-0000-4000-8000-000000000001"]'::jsonb,
  'a number is found by its digits, however it is written');
select is(pg_temp.got('by_marks', '{total}')::int, 7, 'what holds neither a word nor a digit searches nothing');
select is(pg_temp.ids('waiting_named'), '["21100000-0000-4000-8000-000000000002"]'::jsonb,
  'a search narrows the view it is made in');
select ok(
  pg_temp.ids('module') = '["21100000-0000-4000-8000-000000000001"]'::jsonb
    and pg_temp.got('module', '{counts,todas}')::int = 1,
  'a module''s inbox has the conversations of its cases'' people, and counts them alone'
);

select pg_temp.sign_in('a1100000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.firm_inbox('b1100000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'nobody of another firm reads a firm''s conversations'
);
reset role;

select pg_temp.sign_in('a1100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_inbox('b1100000-0000-4000-8000-00000000000a', 'outra') $$,
  '22023', 'invalid_view',
  'a view the inbox does not have is refused, never read as every conversation'
);
select throws_ok(
  $$ select public.firm_inbox('b1100000-0000-4000-8000-00000000000a', null, null, null, 'nome') $$,
  '22023', 'invalid_sort',
  'and so is an order it does not have'
);
reset role;

select * from finish();
rollback;
