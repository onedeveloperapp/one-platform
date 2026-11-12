begin;
create extension if not exists pgtap;
select plan(22);

-- ============================================================
-- The firms' panel of attendance (0223). Firm A has its account in the panel;
-- firm B has none. What changes in A's conversations marks them for the panel
-- and nothing of B's; the backend claims each once; what a person of A writes
-- in the panel is reserved as theirs under ONE's rules and hands them the
-- conversation, once; a status set in the panel says who answers; and what is
-- taken out of ONE is queued to be taken out of the panel. Every table and
-- function here is the backend's alone.
--
-- Every person, firm and phone here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2230000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@painel-a.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2230000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@painel-b.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a2230000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@painel-a.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2230000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-painel-223', 'a2230000-0000-4000-8000-000000000001'),
  ('b2230000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-painel-223', 'a2230000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2230000-0000-4000-8000-00000000000a', 'a2230000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2230000-0000-4000-8000-00000000000a', 'a2230000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b2230000-0000-4000-8000-00000000000b', 'a2230000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2230000-0000-4000-8000-00000000000a', 'b2230000-0000-4000-8000-00000000000a', 'whatsapp', 'sessao-223-a', 'WhatsApp A', 'connected'),
  ('d2230000-0000-4000-8000-00000000000b', 'b2230000-0000-4000-8000-00000000000b', 'whatsapp', 'sessao-223-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2230000-0000-4000-8000-00000000000a', 'b2230000-0000-4000-8000-00000000000a', 'd2230000-0000-4000-8000-00000000000a', 'openwa', 'sessao-223-a', 'sessao-223-a', '5562900002231'),
  ('f2230000-0000-4000-8000-00000000000b', 'b2230000-0000-4000-8000-00000000000b', 'd2230000-0000-4000-8000-00000000000b', 'openwa', 'sessao-223-b', 'sessao-223-b', '5562900002232');
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, contact_name, last_inbound_at, last_message_at, last_message_direction) values
  ('c2230000-0000-4000-8000-00000000000a', 'b2230000-0000-4000-8000-00000000000a', 'f2230000-0000-4000-8000-00000000000a', '5562999992231', 'Cliente A', now(), now(), 'in'),
  ('c2230000-0000-4000-8000-00000000000b', 'b2230000-0000-4000-8000-00000000000b', 'f2230000-0000-4000-8000-00000000000b', '5562999992232', 'Cliente B', now(), now(), 'in');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- 1. The backend's alone.
select ok(
  not has_table_privilege('authenticated', 'public.chatwoot_accounts', 'select')
  and not has_table_privilege('authenticated', 'public.chatwoot_staff', 'select')
  and not has_table_privilege('authenticated', 'public.chatwoot_deletions', 'select')
  and not has_table_privilege('anon', 'public.chatwoot_accounts', 'select')
  and not has_function_privilege('authenticated', 'public.chatwoot_person_writes(uuid, integer, integer, bigint, text, text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_panel_status(uuid, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_claim_conversations(integer, uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_claim_account(uuid, integer)', 'execute'),
  'no session reads the panel''s tables or runs its functions'
);

-- 2. A's account is claimed once while it is made.
insert into res values ('account1', public.chatwoot_claim_account('b2230000-0000-4000-8000-00000000000a'));
insert into res values ('account2', public.chatwoot_claim_account('b2230000-0000-4000-8000-00000000000a'));
select ok(
  (select payload ->> 'status' = 'provisioning' and payload ->> 'claimed_at' is not null from res where name = 'account1')
  and (select payload is null from res where name = 'account2'),
  'the account being made is claimed by one server, and the next finds it held'
);

-- 3. Not ready yet: a message marks nothing.
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status)
values ('b2230000-0000-4000-8000-00000000000a', 'c2230000-0000-4000-8000-00000000000a', 'f2230000-0000-4000-8000-00000000000a', 'in', 'text', 'Meu voo foi cancelado', 'received');
select is(
  (select chatwoot_dirty_at from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a'),
  null,
  'while the firm''s account is not ready, a message marks nothing'
);

-- 4. Ready: A's conversations of the last days go to the panel, B's do not.
select public.chatwoot_keep_account('b2230000-0000-4000-8000-00000000000a', 9101, 9102);
select public.chatwoot_keep_account('b2230000-0000-4000-8000-00000000000a', target_phone_user => 9103, target_inbox => 9104, target_ready => true);
select ok(
  (select chatwoot_dirty_at is not null from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a')
  and (select chatwoot_dirty_at is null from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000b'),
  'the account ready, the firm''s recent conversations are marked for the panel, and no other firm''s'
);

-- 5. Claimed once, and up to date once done.
insert into res values ('claim', (select jsonb_agg(to_jsonb(c)) from public.chatwoot_claim_conversations(10) c));
select ok(
  (select jsonb_array_length(payload) = 1 and payload -> 0 ->> 'conversation_id' = 'c2230000-0000-4000-8000-00000000000a'
   from res where name = 'claim')
  and (select count(*) = 0 from public.chatwoot_claim_conversations(10)),
  'the backend claims the firm''s conversation once, and never another firm''s'
);
select public.chatwoot_finish_conversation(
  'c2230000-0000-4000-8000-00000000000a',
  ((select payload -> 0 ->> 'dirty_at' from res where name = 'claim'))::timestamptz,
  true
);
select ok(
  (select chatwoot_synced_at = chatwoot_dirty_at and chatwoot_claimed_at is null
   from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.chatwoot_claim_conversations(10)),
  'done, the conversation is up to date and nothing is left to claim'
);

-- 6. A new message of A marks it again; one of B marks nothing.
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status) values
  ('b2230000-0000-4000-8000-00000000000a', 'c2230000-0000-4000-8000-00000000000a', 'f2230000-0000-4000-8000-00000000000a', 'in', 'text', 'Era o voo 1234', 'received'),
  ('b2230000-0000-4000-8000-00000000000b', 'c2230000-0000-4000-8000-00000000000b', 'f2230000-0000-4000-8000-00000000000b', 'in', 'text', 'Oi', 'received');
select ok(
  (select chatwoot_dirty_at > chatwoot_synced_at from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a')
  and (select chatwoot_dirty_at is null from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000b'),
  'a new message marks the firm''s conversation again, and nothing of a firm with no panel'
);

-- 7. A failed round waits before the next.
insert into res values ('claim2', (select jsonb_agg(to_jsonb(c)) from public.chatwoot_claim_conversations(10) c));
select public.chatwoot_finish_conversation('c2230000-0000-4000-8000-00000000000a',
  ((select payload -> 0 ->> 'dirty_at' from res where name = 'claim2'))::timestamptz, false);
select ok(
  (select chatwoot_failures = 1 and chatwoot_retry_at > now() from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.chatwoot_claim_conversations(10)),
  'a round that failed waits a while before the conversation is claimed again'
);

-- 8. Ana writes in the panel: reserved as hers, and the conversation is hers.
select public.chatwoot_keep_conversation('c2230000-0000-4000-8000-00000000000a', 7, 70, 'one');
select public.chatwoot_keep_person('b2230000-0000-4000-8000-00000000000a', 'a2230000-0000-4000-8000-000000000001', 501);
select public.chatwoot_keep_person('b2230000-0000-4000-8000-00000000000a', 'a2230000-0000-4000-8000-000000000003', 502);
select public.chatwoot_keep_person('b2230000-0000-4000-8000-00000000000b', 'a2230000-0000-4000-8000-000000000002', 601);
insert into res values ('wrote', public.chatwoot_person_writes('b2230000-0000-4000-8000-00000000000a', 7, 501, 880001, '  Bom dia, pode mandar o cartao de embarque?  '));
select ok(
  (select payload ->> 'code' = 'queued' from res where name = 'wrote')
  and exists (
    select 1 from public.wa_messages m
    where m.id = ((select payload ->> 'message_id' from res where name = 'wrote'))::uuid
      and m.direction = 'out' and m.status = 'queued' and m.kind = 'text'
      and m.body = 'Bom dia, pode mandar o cartao de embarque?'
      and m.sent_by = 'a2230000-0000-4000-8000-000000000001' and m.chatwoot_message_id = 880001
  ),
  'what a person wrote in the panel is reserved in the outbox as theirs, with the panel''s message'
);
select is(
  (select agent from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a'),
  'person',
  'a person wrote: ONE stops answering the conversation'
);

-- 9. The same message of the panel is taken once.
insert into res values ('again', public.chatwoot_person_writes('b2230000-0000-4000-8000-00000000000a', 7, 501, 880001, 'Bom dia'));
select ok(
  (select payload ->> 'code' = 'duplicate' and payload ->> 'message_id' = (select payload ->> 'message_id' from res where name = 'wrote')
   from res where name = 'again')
  and (select count(*) = 1 from public.wa_messages where chatwoot_message_id = 880001),
  'a delivery that comes again reserves nothing more'
);

-- 10. Nobody of another firm, and no conversation of another firm.
select ok(
  (public.chatwoot_person_writes('b2230000-0000-4000-8000-00000000000a', 7, 601, 880002, 'Oi') ->> 'code') = 'person_unknown'
  and (public.chatwoot_person_writes('b2230000-0000-4000-8000-00000000000b', 7, 601, 880003, 'Oi') ->> 'code') = 'not_found',
  'a person of another firm writes nothing, and no firm reaches another''s conversation'
);

-- 11. Past the 24-hour window, nothing goes.
update public.wa_conversations set last_inbound_at = now() - interval '2 days' where id = 'c2230000-0000-4000-8000-00000000000a';
select is(
  public.chatwoot_person_writes('b2230000-0000-4000-8000-00000000000a', 7, 502, 880004, 'Oi') ->> 'code',
  'window_closed',
  'past the 24-hour window, what the panel wrote does not go'
);
update public.wa_conversations set last_inbound_at = now() where id = 'c2230000-0000-4000-8000-00000000000a';

-- 11b. A flagged text is held, and the same text again within ten minutes goes; another firm reaches nothing.
insert into res values ('flag1', public.chatwoot_flagged_again('b2230000-0000-4000-8000-00000000000a', 7, repeat('a', 64)));
insert into res values ('flag2', public.chatwoot_flagged_again('b2230000-0000-4000-8000-00000000000a', 7, repeat('a', 64)));
insert into res values ('flag3', public.chatwoot_flagged_again('b2230000-0000-4000-8000-00000000000b', 7, repeat('a', 64)));
select ok(
  (select payload ->> 'again' = 'false' from res where name = 'flag1')
  and (select payload ->> 'again' = 'true' from res where name = 'flag2')
  and (select payload ->> 'code' = 'not_found' from res where name = 'flag3'),
  'a flagged text is held, and the same text written again within ten minutes goes'
);

-- 12. Resolved in the panel: ONE answers again, and the panel is turned to pending (a resolved conversation would
-- reopen as open at the client's next message, which reads as a person's).
insert into res values ('resolved', public.chatwoot_panel_status('b2230000-0000-4000-8000-00000000000a', 7, 'resolved'));
select ok(
  (select payload ->> 'code' = 'changed' from res where name = 'resolved')
  and (select agent = 'one' and chatwoot_agent is null and chatwoot_dirty_at > chatwoot_synced_at
       from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.wa_conversation_events e
              where e.conversation_id = 'c2230000-0000-4000-8000-00000000000a' and e.kind = 'returned_to_one'
                and e.data ->> 'from_panel' = 'true'),
  'resolved in the panel, the conversation is ONE''s again, on the record, and the panel is to show it pending'
);

-- 13. Opened in the panel: a person's.
insert into res values ('opened', public.chatwoot_panel_status('b2230000-0000-4000-8000-00000000000a', 7, 'open'));
insert into res values ('snoozed', public.chatwoot_panel_status('b2230000-0000-4000-8000-00000000000a', 7, 'snoozed'));
select ok(
  (select payload ->> 'code' = 'changed' from res where name = 'opened')
  and (select agent = 'person' and chatwoot_agent = 'person' from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a')
  and (select payload ->> 'code' = 'unchanged' from res where name = 'snoozed'),
  'opened in the panel, a person answers; put aside, it stays a person''s'
);

-- 14. Firm B cannot move A's conversation.
select is(
  public.chatwoot_panel_status('b2230000-0000-4000-8000-00000000000b', 7, 'resolved') ->> 'code',
  'not_found',
  'a status of another firm''s panel reaches nothing of this firm'
);

-- 15. A person who leaves the firm leaves its panel.
delete from public.memberships where org_id = 'b2230000-0000-4000-8000-00000000000a' and user_id = 'a2230000-0000-4000-8000-000000000003';
select ok(
  not exists (select 1 from public.chatwoot_staff where chatwoot_user_id = 502)
  and exists (select 1 from public.chatwoot_deletions where kind = 'person' and account_id = 9101 and target_id = 502),
  'a person who left the firm is queued to leave the firm''s panel'
);

-- 16. A conversation taken out of ONE is taken out of the panel, its contact with it.
delete from public.wa_conversations where id = 'c2230000-0000-4000-8000-00000000000a';
select ok(
  exists (select 1 from public.chatwoot_deletions where kind = 'contact' and account_id = 9101 and target_id = 70),
  'a conversation taken out of ONE queues its contact to be taken out of the panel'
);

-- 17. The firm's account taken out queues the account.
delete from public.chatwoot_accounts where org_id = 'b2230000-0000-4000-8000-00000000000a';
select ok(
  exists (select 1 from public.chatwoot_deletions where kind = 'account' and account_id = 9101 and target_id = 9101),
  'the firm''s account taken out of ONE is queued to be taken out of the panel'
);

-- 18. The queue is claimed once.
insert into res values ('deletions1', (select to_jsonb(count(*)) from public.chatwoot_claim_deletions(10)));
insert into res values ('deletions2', (select to_jsonb(count(*)) from public.chatwoot_claim_deletions(10)));
select ok(
  -- The person, the conversation and its contact (0229 queues the conversation too), and the account.
  (select payload::int = 4 from res where name = 'deletions1')
  and (select payload::int = 0 from res where name = 'deletions2'),
  'what is to be taken out of the panel is claimed once'
);

-- 19. Entering the panel: a member, in their own session, of their firm.
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2230000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('entry', public.chatwoot_panel_entry());
reset role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
select ok(
  (select payload ->> 'ok' = 'true' and payload ->> 'org_id' = 'b2230000-0000-4000-8000-00000000000b'
     and payload ->> 'person_id' = 'a2230000-0000-4000-8000-000000000002' and payload ->> 'name' = 'Caio Rocha'
   from res where name = 'entry'),
  'a member enters the panel of their own firm, in their own session'
);

select * from finish();
rollback;
