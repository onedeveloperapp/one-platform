begin;
create extension if not exists pgtap;
select plan(31);

-- ============================================================
-- The firm's test chat and the trips ONE follows (0047): a third kind of
-- number, turned on by who manages the firm or a partner with four trips
-- ready; its page reads and acts only by its link's secret; a problem made
-- to happen is one alert per trip and fact, told once as the firm's
-- template, never to who asked to stop; turning the chat off, or the firm's
-- first real number, ends it. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a5400000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b5400000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-teste-chat', 'a5400000-0000-4000-8000-000000000001'),
  ('b5400000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-teste-chat', 'a5400000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5400000-0000-4000-8000-00000000000a', 'a5400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5400000-0000-4000-8000-00000000000a', 'a5400000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b5400000-0000-4000-8000-00000000000b', 'a5400000-0000-4000-8000-000000000004', 'owner', 'socio');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c5400000-0000-4000-8000-00000000000a', 'b5400000-0000-4000-8000-00000000000a', 'whatsapp', 'test-waba-a', 'Chat de teste',
   'connected', 'a5400000-0000-4000-8000-000000000001', now()),
  ('c5400000-0000-4000-8000-00000000000b', 'b5400000-0000-4000-8000-00000000000b', 'whatsapp', 'test-waba-b', 'Chat de teste',
   'connected', 'a5400000-0000-4000-8000-000000000004', now()),
  ('c5400000-0000-4000-8000-0000000000bb', 'b5400000-0000-4000-8000-00000000000b', 'whatsapp', 'meta-waba-b', 'WhatsApp',
   'connected', 'a5400000-0000-4000-8000-000000000004', now());

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

-- The backend connects each firm's test number, as the app does after sealing its token.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b5400000-0000-4000-8000-00000000000a',
  'c5400000-0000-4000-8000-00000000000a', 'test', 'test-number-a', 'test-waba-a', '5500900000041', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b5400000-0000-4000-8000-00000000000b',
  'c5400000-0000-4000-8000-00000000000b', 'test', 'test-number-b', 'test-waba-b', '5500900000042', 'Rocha Advocacia', 'cloud'));
insert into res values ('not_keeper', public.start_test_chat('b5400000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('a', 43), 'a5400000-0000-4000-8000-000000000002'));
insert into res values ('started_a', public.start_test_chat('b5400000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('a', 43), 'a5400000-0000-4000-8000-000000000001'));
insert into res values ('again_a', public.start_test_chat('b5400000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('c', 43), 'a5400000-0000-4000-8000-000000000001'));
insert into res values ('started_b', public.start_test_chat('b5400000-0000-4000-8000-00000000000b',
  pg_temp.got('number_b', 'number_id')::uuid, repeat('b', 43), 'a5400000-0000-4000-8000-000000000004'));
reset role;

-- A test chat brings no passenger of its own since 0087; the ready trips are this test's scenes, made here.
insert into res values ('brought', jsonb_build_object('trips',
  (select count(*) from public.tracked_trips t where t.org_id in ('b5400000-0000-4000-8000-00000000000a',
                                                                  'b5400000-0000-4000-8000-00000000000b'))));
insert into res values ('seed_a', to_jsonb(public.seed_test_trips('b5400000-0000-4000-8000-00000000000a')));
insert into res values ('seed_b', to_jsonb(public.seed_test_trips('b5400000-0000-4000-8000-00000000000b')));

-- ---------- The kind of number, the template, who may call what ----------

select ok(
  (pg_temp.got('number_a', 'ok'))::boolean
  and exists (select 1 from public.wa_numbers n where n.id = pg_temp.got('number_a', 'number_id')::uuid and n.provider = 'test')
  and (select params = array['first_name', 'firm', 'flight', 'what', 'assistance'] from public.notice_kinds where kind = 'flight_problem'),
  'a test number is a third kind of number, and ONE''s first word is a kind of notice with its five values'
);

select ok(
  not has_function_privilege('authenticated', 'public.start_test_chat(uuid, uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.test_chat_by_token(text)', 'execute')
  and not has_function_privilege('anon', 'public.test_chat_view(text)', 'execute')
  and not has_function_privilege('anon', 'public.test_chat_thread(text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.test_chat_set_legs(text, uuid, jsonb, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.reserve_flight_alert(uuid, integer, text[])', 'execute')
  and has_function_privilege('authenticated', 'public.end_test_chat(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.test_chat_link(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.test_chat_link(uuid)', 'execute')
  and not has_column_privilege('authenticated', 'public.test_chats', 'token', 'select')
  and has_column_privilege('authenticated', 'public.test_chats', 'status', 'select'),
  'the page acts only through the backend by the link''s secret, and no member reads the secret off the table'
);

select ok(
  pg_temp.got('not_keeper', 'code') = 'not_authorized' and pg_temp.got('started_a', 'code') = 'started'
  and pg_temp.got('again_a', 'code') = 'already_on',
  'who manages the firm or a partner turns it on, once'
);

select is((pg_temp.got('brought', 'trips'))::integer, 0, 'a test chat turned on brings no passenger of its own (0087)');

select is(
  (select array_agg(t.label || ':' || t.passenger_name || ':' || (select count(*) from public.tracked_legs l where l.trip_id = t.id)
                    order by t.label)
   from public.tracked_trips t where t.org_id = 'b5400000-0000-4000-8000-00000000000a'),
  array['cancelamento:Mariana Teste:1', 'conexao:Lúcia Teste:2', 'familia:Rafael Teste:1', 'internacional:Pedro Teste:1'],
  'the ready trips a test makes are a cancellation, a connection, a family and an international flight'
);

select ok(
  (select bool_and(t.is_test and t.consent_channel = 'test' and t.phone like '5500%' and t.consent_wording like '%Souza Advogados%')
   from public.tracked_trips t where t.org_id = 'b5400000-0000-4000-8000-00000000000a')
  and (select (t.companions -> 0 ->> 'name') = 'Laura Teste'
              and (t.companions -> 0 ->> 'birth_date')::date > current_date - interval '8 years'
       from public.tracked_trips t where t.id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'familia')),
  'each invented passenger agreed in the words a real one reads, and the family travels with a child'
);

select ok(
  exists (
    select 1 from public.firm_notice_kinds k
    join public.wa_templates t on t.id = k.template_id
    where k.org_id = 'b5400000-0000-4000-8000-00000000000a' and k.kind = 'flight_problem' and k.enabled
      and t.status = 'approved' and t.category = 'utility' and t.waba_id = 'test-waba-a'
  ),
  'the template of ONE''s first word is approved on the test chat''s account, as the test chat approves everything'
);

-- ---------- Who reads the link ----------

select pg_temp.sign_in('a5400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('link_ana', public.test_chat_link('b5400000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a5400000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('link_bia', public.test_chat_link('b5400000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a5400000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.test_chat_link('b5400000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'another firm reads nothing of a firm''s test chat'
);
reset role;

select ok(
  pg_temp.got('link_ana', 'token') = repeat('a', 43) and (pg_temp.got('link_ana', 'keeper'))::boolean
  and (pg_temp.got('link_bia', 'on'))::boolean and not (pg_temp.got('link_bia', 'keeper'))::boolean
  and pg_temp.got('link_bia', 'token') is null,
  'who may hand the link out reads it; anybody else of the firm reads only that the chat is on'
);

-- ---------- The page, by the link's secret ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('wrong', public.test_chat_by_token(repeat('z', 43)));
insert into res values ('view_a', public.test_chat_view(repeat('a', 43)));
insert into res values ('foreign_trip', public.test_chat_thread(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000b', 'cancelamento')));
insert into res values ('bad_legs', public.test_chat_set_legs(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'), '[{"position": 9, "status": "cancelled"}]'::jsonb));
insert into res values ('cancel', public.test_chat_set_legs(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'), '[{"position": 1, "status": "cancelled"}]'::jsonb));
insert into res values ('late', public.test_chat_set_legs(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'familia'),
  '[{"position": 1, "status": "delayed", "late_minutes": 360}]'::jsonb));
insert into res values ('room', jsonb_build_object('room', public.test_chat_room(repeat('a', 43))));
reset role;

select ok(
  not (pg_temp.got('wrong', 'found'))::boolean and (pg_temp.got('view_a', 'found'))::boolean
  and pg_temp.got('view_a', 'firm') = 'Souza Advogados'
  and jsonb_array_length((select payload -> 'trips' from res where name = 'view_a')) = 4
  and (select (payload -> 'trips') @> '[{"label": "conexao", "legs": [{"position": 1}, {"position": 2}]}]'::jsonb
       from res where name = 'view_a'),
  'a secret that opens nothing reads nothing; the firm''s own reads its four trips with their legs'
);

select ok(
  pg_temp.got('foreign_trip', 'code') = 'trip_not_found' and pg_temp.got('bad_legs', 'code') = 'invalid_legs',
  'a test chat reaches no trip of another firm, and a leg it does not have changes nothing'
);

select ok(
  (select payload -> 'legs' -> 0 ->> 'status' from res where name = 'cancel') = 'cancelled'
  and (select ((payload -> 'legs' -> 0 ->> 'estimated_arrival')::timestamp - (payload -> 'legs' -> 0 ->> 'arrival')::timestamp)
       from res where name = 'late') = interval '6 hours'
  and (select l.status_source = 'simulated' from public.tracked_legs l
       where l.trip_id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'familia'))
  and (pg_temp.got('room', 'room'))::boolean,
  'the tools make the problem happen as a source would say it, and the rule reads the legs back'
);

-- ---------- The alerts ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('alert', public.record_flight_alert(pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'),
  'cancelled', 1, null, 'flight-problem-v1'));
insert into res values ('alert_again', public.record_flight_alert(pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'),
  'cancelled', 1, null, 'flight-problem-v1'));
insert into res values ('claimed', jsonb_build_object('items', public.claim_flight_alerts(10, null)));
insert into res values ('claimed_again', jsonb_build_object('items', public.claim_flight_alerts(10, null)));
insert into res values ('wrong_claim', public.reserve_flight_alert(pg_temp.got('alert', 'alert_id')::uuid,
  ((select payload -> 'items' -> 0 ->> 'claim' from res where name = 'claimed'))::integer + 1,
  array['Mariana', 'Souza Advogados', 'LA 3456', 'foi cancelado', 'oferecer outro voo']));
insert into res values ('sent', public.reserve_flight_alert(pg_temp.got('alert', 'alert_id')::uuid,
  ((select payload -> 'items' -> 0 ->> 'claim' from res where name = 'claimed'))::integer,
  array['Mariana', 'Souza Advogados', 'LA 3456 de São Paulo (GRU) para Recife (REC), de hoje', 'foi cancelado',
        'oferecer outro voo, o reembolso ou outro meio de transporte']));
reset role;

select ok(
  pg_temp.got('alert', 'code') = 'recorded' and pg_temp.got('alert_again', 'code') = 'already_known',
  'what the rule found is one alert per trip and fact'
);

select ok(
  jsonb_array_length((select payload -> 'items' from res where name = 'claimed')) = 1
  and (select payload -> 'items' -> 0 from res where name = 'claimed')
      @> '{"passenger_name": "Mariana Teste", "firm": "Souza Advogados", "kind": "cancelled", "international": false}'::jsonb
  and (select payload -> 'items' -> 0 -> 'legs' -> 0 ->> 'origin' from res where name = 'claimed') = 'GRU'
  and jsonb_array_length((select payload -> 'items' from res where name = 'claimed_again')) = 0,
  'the sweep claims it once, with what its message says of the trip'
);

select ok(
  pg_temp.got('wrong_claim', 'code') = 'not_working' and pg_temp.got('sent', 'code') = 'queued'
  and exists (
    select 1 from public.wa_messages m
    join public.wa_conversations c on c.id = m.conversation_id
    where m.id = pg_temp.got('sent', 'message_id')::uuid and m.kind = 'template' and m.status = 'queued'
      and m.number_id = pg_temp.got('number_a', 'number_id')::uuid and c.contact_wa_id = '5500988880001'
      and m.body like 'Olá, Mariana. Aqui é o assistente automático do escritório Souza Advogados.%'
      and m.body like '%Responda SIM para seguir ou NÃO se não quiser.' and m.sent_by is null
  ),
  'it goes once, as the firm''s template, in a conversation opened with the passenger on the test number'
);

select ok(
  (select a.status = 'sent' and a.sent_at is not null from public.flight_alerts a where a.id = pg_temp.got('alert', 'alert_id')::uuid)
  and (select t.status from public.tracked_trips t where t.id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'))
      = 'alerted'
  and exists (select 1 from public.audit_events e where e.action = 'flight_alert.sent'
              and e.entity_id = pg_temp.got('alert', 'alert_id') and e.actor_type = 'system'),
  'the alert says it went, the trip that it was told, and the record that ONE sent it'
);

-- Rafael asked the firm to stop: his alert is never sent.
insert into public.wa_optouts (org_id, contact_wa_id, source) values
  ('b5400000-0000-4000-8000-00000000000a', '5500988880002', 'keyword');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('family_alert', public.record_flight_alert(pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'familia'),
  'delayed', 1, 360, 'flight-problem-v1'));
insert into res values ('family_claim', jsonb_build_object('items',
  public.claim_flight_alerts(1, pg_temp.got('family_alert', 'alert_id')::uuid)));
insert into res values ('family_sent', public.reserve_flight_alert(pg_temp.got('family_alert', 'alert_id')::uuid,
  ((select payload -> 'items' -> 0 ->> 'claim' from res where name = 'family_claim'))::integer,
  array['Rafael', 'Souza Advogados', 'G3 1450 de Brasília (BSB) para Rio de Janeiro (GIG), de hoje',
        'está previsto para chegar com 6 horas de atraso', 'dar comunicação e alimentação']));
reset role;

select ok(
  pg_temp.got('family_sent', 'reason') = 'opted_out'
  and (select a.status = 'skipped' and a.reason = 'opted_out' and a.message_id is null
       from public.flight_alerts a where a.id = pg_temp.got('family_alert', 'alert_id')::uuid)
  and not exists (select 1 from public.wa_conversations c where c.contact_wa_id = '5500988880002'),
  'who asked to stop is told nothing, and the alert says why'
);

-- Pedro's values are not what the template takes: nothing goes, and the alert says so.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('pedro_alert', public.record_flight_alert(pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'internacional'),
  'delayed', 1, 540, 'flight-problem-v1'));
insert into res values ('pedro_claim', jsonb_build_object('items',
  public.claim_flight_alerts(1, pg_temp.got('pedro_alert', 'alert_id')::uuid)));
insert into res values ('pedro_sent', public.reserve_flight_alert(pg_temp.got('pedro_alert', 'alert_id')::uuid,
  ((select payload -> 'items' -> 0 ->> 'claim' from res where name = 'pedro_claim'))::integer,
  array['Pedro', 'Souza Advogados', 'LA 8084']));
reset role;

select ok(
  pg_temp.got('pedro_sent', 'reason') = 'invalid_values'
  and (select payload -> 'items' -> 0 ->> 'international' from res where name = 'pedro_claim') = 'true',
  'values that are not the template''s send nothing; an international trip is said as one'
);

-- ---------- The thread the page draws ----------

update public.wa_messages set status = 'delivered' where id = pg_temp.got('sent', 'message_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('thread', public.test_chat_thread(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento')));
insert into res values ('thread_after', public.test_chat_thread(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'), now() + interval '1 minute'));
reset role;

select ok(
  jsonb_array_length((select payload -> 'messages' from res where name = 'thread')) = 1
  and (select payload -> 'messages' -> 0 ->> 'kind' from res where name = 'thread') = 'template'
  and jsonb_array_length((select payload -> 'messages' from res where name = 'thread_after')) = 0
  and (select m.status from public.wa_messages m where m.id = pg_temp.got('sent', 'message_id')::uuid) = 'read',
  'the page draws the conversation and only what is new, and what it drew the firm reads as read'
);

-- ---------- Starting over ----------

-- The conversation of the trip was with a person ONE called (0048).
update public.wa_conversations c set agent = 'person', called_reason = 'A passageira quer falar com um advogado.',
  called_at = now(), last_inbound_at = now() - interval '1 minute'
from public.wa_messages m
where m.id = pg_temp.got('sent', 'message_id')::uuid and c.id = m.conversation_id;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('reset', public.test_chat_set_legs(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'), null, true));
reset role;

select ok(
  (pg_temp.got('reset', 'ok'))::boolean
  and not exists (select 1 from public.flight_alerts a
                  where a.trip_id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'))
  and (select t.status from public.tracked_trips t where t.id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'))
      = 'watching'
  and (select l.status = 'scheduled' and l.estimated_arrival_local is null from public.tracked_legs l
       where l.trip_id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'cancelamento'))
  and exists (select 1 from public.wa_messages m where m.id = pg_temp.got('sent', 'message_id')::uuid),
  'starting a trip over forgets its alerts, so the same problem can be told again; the messages stay'
);

select ok(
  (select c.agent = 'one' and c.called_reason is null and c.called_at is null and c.one_through >= c.last_inbound_at
   from public.wa_conversations c join public.wa_messages m on m.conversation_id = c.id
   where m.id = pg_temp.got('sent', 'message_id')::uuid)
  and exists (select 1 from public.wa_conversation_events e join public.wa_messages m on m.conversation_id = e.conversation_id
              where m.id = pg_temp.got('sent', 'message_id')::uuid and e.kind = 'returned_to_one' and e.actor_type = 'system'),
  'and its conversation starts over with ONE, with nothing said before answered again'
);

-- A trip of a day gone moves to today when the tools are used.
update public.tracked_legs set scheduled_departure_local = scheduled_departure_local - interval '3 days',
                               scheduled_arrival_local = scheduled_arrival_local - interval '3 days'
where trip_id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'conexao');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('moved', public.test_chat_set_legs(repeat('a', 43),
  pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'conexao'),
  '[{"position": 1, "status": "delayed", "late_minutes": 180}, {"position": 2, "status": "delayed", "late_minutes": 420}]'::jsonb));
reset role;

select ok(
  (select bool_and(l.scheduled_departure_local::date = (now() at time zone 'America/Sao_Paulo')::date)
   from public.tracked_legs l where l.trip_id = pg_temp.trip('b5400000-0000-4000-8000-00000000000a', 'conexao'))
  and (select payload -> 'legs' -> 1 ->> 'status' from res where name = 'moved') = 'delayed',
  'the flights of a test trip are of the day the tools are used'
);

-- ---------- Another firm ----------

select ok(
  pg_temp.got('started_b', 'code') = 'started'
  and (select count(*) = 4 from public.tracked_trips t where t.org_id = 'b5400000-0000-4000-8000-00000000000b')
  and (select count(*) = 0 from public.flight_alerts a where a.org_id = 'b5400000-0000-4000-8000-00000000000b'),
  'another firm has its own chat and its own four trips, untouched by the first'
);

select pg_temp.sign_in('a5400000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::int from public.tracked_trips),
  4,
  'and reads only its own trips'
);
reset role;

-- ---------- Turning it off ----------

select pg_temp.sign_in('a5400000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.end_test_chat('b5400000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'somebody who does not manage the firm and is no partner cannot turn it off'
);
reset role;
select pg_temp.sign_in('a5400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ended', public.end_test_chat('b5400000-0000-4000-8000-00000000000a'));
insert into res values ('link_off', public.test_chat_link('b5400000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('after_end', public.test_chat_by_token(repeat('a', 43)));
reset role;

select ok(
  pg_temp.got('ended', 'code') = 'ended' and not (pg_temp.got('link_off', 'on'))::boolean
  and not (pg_temp.got('after_end', 'found'))::boolean
  and (select n.status = 'disconnected' and n.disconnect_reason = 'test_chat_ended' from public.wa_numbers n
       where n.id = pg_temp.got('number_a', 'number_id')::uuid)
  and (select count(*) = 4 from public.tracked_trips t where t.org_id = 'b5400000-0000-4000-8000-00000000000a'),
  'turned off, its link opens nothing and its number is disconnected; its trips stay'
);

-- Turned on again on the same number: the trips are the ones it had.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a2', public.register_wa_number('b5400000-0000-4000-8000-00000000000a',
  'c5400000-0000-4000-8000-00000000000a', 'test', 'test-number-a', 'test-waba-a', '5500900000041', 'Souza Advogados', 'cloud'));
insert into res values ('restarted', public.start_test_chat('b5400000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a2', 'number_id')::uuid, repeat('d', 43), 'a5400000-0000-4000-8000-000000000001'));
insert into res values ('renewed', public.renew_test_chat('b5400000-0000-4000-8000-00000000000a', repeat('e', 43),
  'a5400000-0000-4000-8000-000000000001'));
insert into res values ('old_link', public.test_chat_by_token(repeat('d', 43)));
insert into res values ('new_link', public.test_chat_by_token(repeat('e', 43)));
reset role;

select ok(
  pg_temp.got('restarted', 'code') = 'started'
  and pg_temp.got('number_a2', 'number_id') = pg_temp.got('number_a', 'number_id')
  and (select count(*) = 4 from public.tracked_trips t where t.org_id = 'b5400000-0000-4000-8000-00000000000a')
  and (select count(*) = 2 from public.audit_events e
       where e.action = 'test_chat.started' and e.org_id = 'b5400000-0000-4000-8000-00000000000a'
         and e.metadata ->> 'trips_made' = '0'),
  'turned on again, the number and the trips are the ones it had'
);

select ok(
  pg_temp.got('renewed', 'code') = 'renewed' and not (pg_temp.got('old_link', 'found'))::boolean
  and (pg_temp.got('new_link', 'found'))::boolean,
  'a new link stops the one before from opening anything'
);

-- ---------- A real number ends it ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('meta_b', public.register_wa_number('b5400000-0000-4000-8000-00000000000b',
  'c5400000-0000-4000-8000-0000000000bb', 'meta', '123456789012345', 'meta-waba-b', '5500900000044', 'Rocha Advocacia', 'cloud'));
insert into res values ('test_after_meta', public.register_wa_number('b5400000-0000-4000-8000-00000000000b',
  'c5400000-0000-4000-8000-00000000000b', 'test', 'test-number-b2', 'test-waba-b', '5500900000043', 'Rocha Advocacia', 'cloud'));
reset role;

select ok(
  (pg_temp.got('meta_b', 'ok'))::boolean
  and (select n.status = 'disconnected' and n.disconnect_reason = 'replaced_by_real_number' from public.wa_numbers n
       where n.id = pg_temp.got('number_b', 'number_id')::uuid)
  and (select c.status = 'ended' and c.ended_reason = 'replaced_by_real_number' from public.test_chats c
       where c.org_id = 'b5400000-0000-4000-8000-00000000000b'),
  'the firm''s first real number ends its test chat'
);

select is(
  pg_temp.got('test_after_meta', 'code'),
  'test_chat_not_allowed',
  'and a test chat is never turned on beside a real number'
);

select pg_temp.sign_in('a5400000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('link_b', public.test_chat_link('b5400000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  not (pg_temp.got('link_b', 'on'))::boolean and (pg_temp.got('link_b', 'real_number'))::boolean
  and pg_temp.got('link_b', 'ended_reason') = 'replaced_by_real_number',
  'the connections screen says why the test chat ended'
);

select * from finish();
rollback;
