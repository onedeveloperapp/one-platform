begin;
create extension if not exists pgtap;
select plan(23);

-- ============================================================
-- ONE sends the client's link by itself (0046): each adult of a case being
-- gathered who never had a link of it is sent one in the conversation they
-- have with the firm's WhatsApp, inside the 24 hours, as the firm lets it;
-- what ONE cannot send is said with why. Never twice, never to who asked
-- to stop, never through another firm's conversation. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a5300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b5300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-link', 'a5300000-0000-4000-8000-000000000001'),
  ('b5300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-link', 'a5300000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5300000-0000-4000-8000-00000000000a', 'a5300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5300000-0000-4000-8000-00000000000a', 'a5300000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b5300000-0000-4000-8000-00000000000b', 'a5300000-0000-4000-8000-000000000004', 'owner', 'socio');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c5300000-0000-4000-8000-00000000000a', 'b5300000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-link-a', 'WhatsApp A',
   'connected', 'a5300000-0000-4000-8000-000000000001', now()),
  ('c5300000-0000-4000-8000-00000000000b', 'b5300000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-link-b', 'WhatsApp B',
   'connected', 'a5300000-0000-4000-8000-000000000004', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('e5300000-0000-4000-8000-00000000000a', 'b5300000-0000-4000-8000-00000000000a', 'c5300000-0000-4000-8000-00000000000a',
   'simulator', 'sim-link-a', 'waba-link-a', '5500900000031', 'coexistence'),
  ('e5300000-0000-4000-8000-00000000000b', 'b5300000-0000-4000-8000-00000000000b', 'c5300000-0000-4000-8000-00000000000b',
   'simulator', 'sim-link-b', 'waba-link-b', '5500900000032', 'coexistence');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.case_of(name text) returns uuid language sql as
$$ select pg_temp.got(case_of.name, 'case_id')::uuid; $$;
-- What a worker holds of a case, claimed by name.
create function pg_temp.claim(target uuid) returns jsonb language sql as $$
  select coalesce((public.claim_case_advances(1, target) -> 'claimed') -> 0, '{}'::jsonb);
$$;
-- Who of a firm is owed a link, by name, and why ONE has not sent it ("now" when it can).
create function pg_temp.reach(firm uuid) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(r.full_name, coalesce(r.reason, 'now')), '{}'::jsonb)
  from public.client_link_reach(firm) r;
$$;

-- Firm A: five cases being gathered. Maria's has a child of hers among the claimants.
select pg_temp.sign_in('a5300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('maria', public.create_case('b5300000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "Maria Teste", "birth_date": "1985-04-02", "phone": "5500999998888"}'::jsonb));
insert into res values ('kid', public.save_case_person(pg_temp.case_of('maria'), null,
  '{"full_name": "Lucas Teste", "birth_date": "2018-05-05"}'::jsonb, 'claimant'));
insert into res values ('joao', public.create_case('b5300000-0000-4000-8000-00000000000a', 'cancellation', 'AD',
  date '2026-02-01', '{"full_name": "João Teste", "phone": "5500999997777"}'::jsonb));
insert into res values ('lia', public.create_case('b5300000-0000-4000-8000-00000000000a', 'delay', 'LA', date '2026-02-02',
  '{"full_name": "Lia Teste"}'::jsonb));
insert into res values ('rui', public.create_case('b5300000-0000-4000-8000-00000000000a', 'delay', 'LA', date '2026-02-03',
  '{"full_name": "Rui Teste", "phone": "5500999996666"}'::jsonb));
insert into res values ('teo', public.create_case('b5300000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-02-04',
  '{"full_name": "Teo Teste", "phone": "5500999995555"}'::jsonb));
reset role;
-- Firm B: Paulo, whose mobile is Maria's (a family shares one), who never wrote to firm B.
select pg_temp.sign_in('a5300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('paulo', public.create_case('b5300000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-01-20',
  '{"full_name": "Paulo Teste", "phone": "5500999998888"}'::jsonb));
reset role;

-- Maria wrote to firm A an hour ago (two messages nobody answered), João thirty hours ago, Teo an hour ago and then
-- asked to stop.
insert into public.wa_conversations (org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count) values
  ('b5300000-0000-4000-8000-00000000000a', 'e5300000-0000-4000-8000-00000000000a', '5500999998888',
   now() - interval '1 hour', now() - interval '1 hour', 'Oi, meu voo atrasou', 'in', 2),
  ('b5300000-0000-4000-8000-00000000000a', 'e5300000-0000-4000-8000-00000000000a', '5500999997777',
   now() - interval '30 hours', now() - interval '30 hours', 'Bom dia', 'in', 1),
  ('b5300000-0000-4000-8000-00000000000a', 'e5300000-0000-4000-8000-00000000000a', '5500999995555',
   now() - interval '1 hour', now() - interval '1 hour', 'SAIR', 'in', 1);
insert into public.wa_optouts (org_id, contact_wa_id, source) values
  ('b5300000-0000-4000-8000-00000000000a', '5500999995555', 'keyword');

-- ---------- The decision, and who may call what ----------

select ok(
  (select modes = array['auto', 'approval'] and default_mode = 'auto' and position = 5
   from public.autonomy_decisions where key = 'send_client_link'),
  'sending the client''s link is a decision of the catalog, ONE''s by default'
);

select ok(
  not has_function_privilege('authenticated', 'public.client_link_reach(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.advance_send_client_link(uuid, integer, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.advance_client_links(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.case_advance_link_due(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.case_links_owed(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.case_links_owed(uuid)', 'execute'),
  'only the backend sends a link as ONE; anybody of a firm reads who is owed one'
);

-- ---------- Who is owed a link, and why ONE cannot send it ----------

select is(
  pg_temp.reach('b5300000-0000-4000-8000-00000000000a'),
  '{"Maria Teste": "now", "João Teste": "window_closed", "Lia Teste": "no_phone", "Rui Teste": "no_conversation",
    "Teo Teste": "opted_out"}'::jsonb,
  'each adult of a case being gathered who never had a link: Maria now, the others with why, and never the child'
);

select is(
  pg_temp.reach('b5300000-0000-4000-8000-00000000000b'),
  '{"Paulo Teste": "no_conversation"}'::jsonb,
  'a conversation of another firm with the same mobile never carries a firm''s link'
);

-- ---------- ONE sends Maria's ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_maria', pg_temp.claim(pg_temp.case_of('maria')));
insert into res values ('claim_joao', pg_temp.claim(pg_temp.case_of('joao')));
insert into res values ('people', public.advance_client_links(pg_temp.case_of('maria'),
  pg_temp.got('claim_maria', 'claim')::integer));
insert into res values ('wrong_claim', public.advance_send_client_link(pg_temp.case_of('maria'),
  pg_temp.got('claim_maria', 'claim')::integer + 1, pg_temp.got('maria', 'person_id')::uuid, repeat('a', 64),
  'Olá, Maria. Este é o link: https://one.invalid/c/token-um'));
insert into res values ('joao_send', public.advance_send_client_link(pg_temp.case_of('maria'),
  pg_temp.got('claim_maria', 'claim')::integer, pg_temp.got('joao', 'person_id')::uuid, repeat('b', 64),
  'Olá, João. Este é o link: https://one.invalid/c/token-dois'));
insert into res values ('sent', public.advance_send_client_link(pg_temp.case_of('maria'),
  pg_temp.got('claim_maria', 'claim')::integer, pg_temp.got('maria', 'person_id')::uuid, repeat('c', 64),
  'Olá, Maria. Este é o link: https://one.invalid/c/token-tres'));
insert into res values ('again', public.advance_send_client_link(pg_temp.case_of('maria'),
  pg_temp.got('claim_maria', 'claim')::integer, pg_temp.got('maria', 'person_id')::uuid, repeat('d', 64),
  'Olá, Maria. Este é o link: https://one.invalid/c/token-quatro'));
reset role;

select ok(
  pg_temp.got('claim_maria', 'link_due')::boolean
  and coalesce(pg_temp.got('claim_joao', 'link_due')::boolean, false) = false,
  'the sweep takes a case whose link ONE can send now, and not one it cannot'
);

select is(
  (select payload from res where name = 'people'),
  jsonb_build_object('ok', true, 'firm', 'Souza Advogados', 'people', jsonb_build_array(
    jsonb_build_object('person_id', pg_temp.got('maria', 'person_id'), 'full_name', 'Maria Teste'))),
  'the worker is handed who it can send a link now, with the firm''s name for the message'
);

select ok(
  pg_temp.got('wrong_claim', 'code') = 'not_working' and pg_temp.got('joao_send', 'code') = 'not_owed',
  'a worker that does not hold the case sends nothing, nor a link for somebody of another case'
);

select ok(
  (pg_temp.got('sent', 'ok'))::boolean and pg_temp.got('sent', 'code') = 'queued'
  and exists (
    select 1 from public.client_links l
    where l.id = pg_temp.got('sent', 'link_id')::uuid and l.person_id = pg_temp.got('maria', 'person_id')::uuid
      and l.token_hash = repeat('c', 64) and l.created_by is null and l.revoked_at is null
  ),
  'ONE makes Maria''s link, as nobody of the firm'
);

select ok(
  exists (
    select 1 from public.wa_messages m
    join public.wa_conversations c on c.id = m.conversation_id
    where m.id = pg_temp.got('sent', 'message_id')::uuid and c.contact_wa_id = '5500999998888'
      and c.org_id = 'b5300000-0000-4000-8000-00000000000a'
      and m.direction = 'out' and m.origin = 'cloud' and m.kind = 'text' and m.status = 'queued' and m.sent_by is null
      and m.body = 'Olá, Maria. Este é o link: https://one.invalid/c/token-tres'
  ),
  'its message waits in the outbox, in the conversation she wrote in, written by no person'
);

select ok(
  (select last_message_direction = 'in' and unread_count = 2 and last_message_preview = 'Oi, meu voo atrasou'
   from public.wa_conversations where contact_wa_id = '5500999998888'
     and org_id = 'b5300000-0000-4000-8000-00000000000a'),
  'what Maria wrote still waits for the firm''s answer: ONE''s message answers nothing of it'
);

select ok(
  exists (
    select 1 from public.case_events e
    where e.case_id = pg_temp.case_of('maria') and e.kind = 'client_link_created' and e.actor_type = 'system'
      and e.actor_id is null and e.data ->> 'person' = pg_temp.got('maria', 'person_id')
  ),
  'the timeline says ONE sent the link'
);

select ok(
  pg_temp.got('again', 'code') = 'not_owed'
  and (select count(*) = 1 from public.client_links where case_id = pg_temp.case_of('maria')),
  'ONE never sends a second link to a person of a case'
);

-- A person ends Maria's link: ONE does not send another.
select pg_temp.sign_in('a5300000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ended', public.revoke_client_link(pg_temp.got('sent', 'link_id')::uuid));
reset role;

select ok(
  pg_temp.got('ended', 'code') = 'revoked'
  and not (pg_temp.reach('b5300000-0000-4000-8000-00000000000a') ? 'Maria Teste'),
  'a link a person ended stays ended: ONE does not send another'
);

-- ---------- A client who writes again ----------

update public.case_advances set after = now() + interval '6 hours', woken_at = null
where case_id = pg_temp.case_of('joao');
update public.wa_conversations
set last_inbound_at = now() - interval '5 minutes', last_message_at = now() - interval '5 minutes'
where org_id = 'b5300000-0000-4000-8000-00000000000a' and contact_wa_id = '5500999997777';

select ok(
  (select a.after is null and a.woken_at is not null from public.case_advances a where a.case_id = pg_temp.case_of('joao'))
  and pg_temp.reach('b5300000-0000-4000-8000-00000000000a') ->> 'João Teste' = 'now',
  'João writes again: his case is looked at at once, and ONE can send his link'
);

select ok(
  public.wa_contact_link_cases('b5300000-0000-4000-8000-00000000000a', '5500999997777') = array[pg_temp.case_of('joao')]
  and public.wa_contact_link_cases('b5300000-0000-4000-8000-00000000000b', '5500999997777') = '{}'::uuid[]
  and public.wa_contact_link_cases('b5300000-0000-4000-8000-00000000000a', '5500999998888') = '{}'::uuid[]
  and not has_function_privilege('authenticated', 'public.wa_contact_link_cases(uuid, text)', 'execute'),
  'the app is told which case to look at when a client writes: of that firm, and never one whose link went'
);

-- ---------- A firm that sends its links itself ----------

select pg_temp.sign_in('a5300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('by_person', public.set_firm_autonomy('b5300000-0000-4000-8000-00000000000a', 'send_client_link',
  'approval'));
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_by_person', pg_temp.claim(pg_temp.case_of('joao')));
reset role;

select ok(
  (pg_temp.got('by_person', 'ok'))::boolean
  and pg_temp.reach('b5300000-0000-4000-8000-00000000000a') ->> 'João Teste' = 'by_person'
  and coalesce(pg_temp.got('claim_by_person', 'link_due')::boolean, false) = false,
  'a firm that sends its links itself: ONE sends none, and says so'
);

-- ---------- What the firm reads ----------

select pg_temp.sign_in('a5300000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('owed_joao', public.case_links_owed(pg_temp.case_of('joao')));
insert into res values ('pending_a', public.firm_pending('b5300000-0000-4000-8000-00000000000a'));
reset role;

select is(
  (select payload from res where name = 'owed_joao'),
  jsonb_build_array(jsonb_build_object('person_id', pg_temp.got('joao', 'person_id'), 'reason', 'by_person')),
  'the case says who is owed a link and why'
);

select is(
  (select jsonb_object_agg(item ->> 'client', item ->> 'reason')
   from jsonb_array_elements((select payload -> 'links_owed' from res where name = 'pending_a')) item),
  '{"João Teste": "by_person", "Lia Teste": "by_person", "Rui Teste": "by_person", "Teo Teste": "by_person"}'::jsonb,
  'the firm''s center of what waits lists every link nobody sent: the firm sends them itself'
);

select ok(
  (pg_temp.got('pending_a', 'links_owed_total'))::integer = 4
  and (select bool_and((item ->> 'case_id')::uuid in (
         pg_temp.case_of('joao'), pg_temp.case_of('lia'), pg_temp.case_of('rui'), pg_temp.case_of('teo')))
       from jsonb_array_elements((select payload -> 'links_owed' from res where name = 'pending_a')) item),
  'each with its case, and counted'
);

-- Back to ONE: João can be sent his now, so he is not waited for, until it is late.
select pg_temp.sign_in('a5300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('by_one', public.set_firm_autonomy('b5300000-0000-4000-8000-00000000000a', 'send_client_link',
  'auto'));
insert into res values ('pending_sending', public.firm_pending('b5300000-0000-4000-8000-00000000000a'));
insert into res values ('owed_sending', public.case_links_owed(pg_temp.case_of('joao')));
reset role;
update public.case_parties set created_at = now() - interval '2 hours' where case_id = pg_temp.case_of('joao');
select pg_temp.sign_in('a5300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('pending_late', public.firm_pending('b5300000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  (pg_temp.got('pending_sending', 'links_owed_total'))::integer = 3
  and (select payload -> 0 ->> 'reason' from res where name = 'owed_sending') = 'sending'
  and (pg_temp.got('pending_late', 'links_owed_total'))::integer = 4
  and (select jsonb_object_agg(item ->> 'client', item ->> 'reason')
       from jsonb_array_elements((select payload -> 'links_owed' from res where name = 'pending_late')) item)
      = '{"João Teste": "late", "Lia Teste": "no_phone", "Rui Teste": "no_conversation", "Teo Teste": "opted_out"}'::jsonb,
  'with ONE sending again, each link it cannot send is said with why, and one it can only once it should have gone'
);

-- ---------- Another firm ----------

select pg_temp.sign_in('a5300000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.case_links_owed(%L)', pg_temp.case_of('joao')),
  'P0002', 'case_not_found',
  'another firm reads nothing of a case that is not its own'
);
insert into res values ('pending_b', public.firm_pending('b5300000-0000-4000-8000-00000000000b'));
reset role;

select is(
  (select jsonb_agg(item ->> 'client') from jsonb_array_elements((select payload -> 'links_owed' from res
                                                                   where name = 'pending_b')) item),
  '["Paulo Teste"]'::jsonb,
  'and its center lists only its own clients'
);

-- ---------- A case past gathering, and a link a person makes ----------

select pg_temp.sign_in('a5300000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('drafting', public.set_case_status(pg_temp.case_of('lia'), 'drafting'));
insert into res values ('by_hand', public.create_client_link(pg_temp.case_of('rui'), pg_temp.got('rui', 'person_id')::uuid,
  repeat('e', 64)));
reset role;

select ok(
  not (pg_temp.reach('b5300000-0000-4000-8000-00000000000a') ? 'Lia Teste')
  and not (pg_temp.reach('b5300000-0000-4000-8000-00000000000a') ? 'Rui Teste')
  and exists (
    select 1 from public.case_events e
    where e.case_id = pg_temp.case_of('rui') and e.kind = 'client_link_created' and e.actor_type = 'person'
      and e.actor_id = 'a5300000-0000-4000-8000-000000000002'
  ),
  'a case past gathering is owed nothing, and a link a person made says so in the timeline'
);

select * from finish();
rollback;
