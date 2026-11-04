begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- ONE asks what the client's account is missing in their WhatsApp
-- conversation too, and takes their reply there as the answer (0092): once
-- per round, inside the 24 hours, in a conversation ONE holds, never to who
-- asked the firm to stop, and only where the firm lets ONE answer its
-- clients. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the phones are of an area
-- code no carrier has.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@conversa.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9500000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@conversa.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9500000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-conversa', 'a9500000-0000-4000-8000-000000000001'),
  ('b9500000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-conversa', 'a9500000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9500000-0000-4000-8000-00000000000a', 'a9500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9500000-0000-4000-8000-00000000000b', 'a9500000-0000-4000-8000-000000000003', 'owner', 'advogado');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d9500000-0000-4000-8000-00000000000a', 'b9500000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-conversa-a', 'WhatsApp A',
   'connected', 'a9500000-0000-4000-8000-000000000001', now()),
  ('d9500000-0000-4000-8000-00000000000b', 'b9500000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-conversa-b', 'WhatsApp B',
   'connected', 'a9500000-0000-4000-8000-000000000003', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('e9500000-0000-4000-8000-00000000000a', 'b9500000-0000-4000-8000-00000000000a', 'd9500000-0000-4000-8000-00000000000a',
   'simulator', 'sim-conversa-a', 'waba-conversa-a', '5500900000095', 'coexistence'),
  ('e9500000-0000-4000-8000-00000000000b', 'b9500000-0000-4000-8000-00000000000b', 'd9500000-0000-4000-8000-00000000000b',
   'simulator', 'sim-conversa-b', 'waba-conversa-b', '5500900000096', 'coexistence');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- An account of a case, ordered by ONE with what it is missing and the questions to the client.
create function pg_temp.incomplete(who uuid, target_case uuid, party uuid) returns uuid language plpgsql as $$
declare
  added jsonb;
begin
  perform pg_temp.sign_in(who);
  added := public.add_case_statement(target_case, party, null,
    'O voo atrasou seis horas e ninguém da companhia deu informação durante a espera no aeroporto.');
  update public.case_statements
  set chronology = '20/09/2026, 10:00: o voo atrasou seis horas.', chronology_status = 'approved', work = null,
      missing_topics = array['compra', 'gastos'],
      questions = array['Quanto você pagou pela passagem e onde comprou?', 'Você teve algum gasto durante a espera?']
  where id = (added ->> 'statement_id')::uuid;
  return (added ->> 'statement_id')::uuid;
end;
$$;

-- Firm A: Ana talks to ONE, who holds her conversation, inside the 24 hours. Firm B: Davi, whose conversation is
-- two days old.
select pg_temp.sign_in('a9500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9500000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "ANA TESTE DE SOUZA", "birth_date": "1985-04-02", "phone": "5500999995001"}'::jsonb));
reset role;
select pg_temp.sign_in('a9500000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9500000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999995003"}'::jsonb));
reset role;
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('f9500000-0000-4000-8000-00000000000a', 'b9500000-0000-4000-8000-00000000000a', 'e9500000-0000-4000-8000-00000000000a',
   '5500999995001', now() - interval '10 minutes', now() - interval '10 minutes', 'Mandei o áudio', 'in', 1, 'one'),
  ('f9500000-0000-4000-8000-00000000000b', 'b9500000-0000-4000-8000-00000000000b', 'e9500000-0000-4000-8000-00000000000b',
   '5500999995003', now() - interval '2 days', now() - interval '2 days', 'Oi', 'in', 0, 'one');
insert into res select 'statement', jsonb_build_object('id', pg_temp.incomplete('a9500000-0000-4000-8000-000000000001',
  pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id')::uuid));
insert into res select 'statement_b', jsonb_build_object('id', pg_temp.incomplete('a9500000-0000-4000-8000-000000000003',
  pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('case_b', 'party_id')::uuid));

-- ---------- Who reads and writes ----------

select ok(
  not has_function_privilege('authenticated', 'public.account_asks_owed(integer, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_ask_account(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.one_complete_statement(uuid, integer, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.conversation_account_open(uuid, integer)', 'EXECUTE'),
  'only the backend asks and takes an answer in a conversation'
);

-- ---------- ONE asks, once per round ----------

select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed', coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.account_asks_owed(20) a;
insert into res values ('asked', public.one_ask_account(pg_temp.got('statement', 'id')::uuid,
  'Ana, para preparar a sua ação, o escritório precisa saber mais algumas coisas:' || E'\n' || '1. Quanto você pagou?'));
insert into res values ('asked_again', public.one_ask_account(pg_temp.got('statement', 'id')::uuid, 'De novo.'));
insert into res values ('asked_b', public.one_ask_account(pg_temp.got('statement_b', 'id')::uuid, 'Fora da janela.'));
reset role;
select ok(
  (select jsonb_array_length(payload) = 1
          and payload -> 0 ->> 'statement_id' = pg_temp.got('statement', 'id')
          and payload -> 0 ->> 'conversation_id' = 'f9500000-0000-4000-8000-00000000000a'
          and payload -> 0 ->> 'first_name' = 'Ana'
          and payload -> 0 -> 'questions' ->> 1 = 'Você teve algum gasto durante a espera?'
   from res where name = 'owed'),
  'ONE may ask the account of a client it talks to inside the 24 hours, never one whose window closed'
);
select ok(
  pg_temp.got('asked', 'code') = 'queued' and pg_temp.got('asked_again', 'code') = 'not_owed'
  and pg_temp.got('asked_b', 'code') = 'not_owed'
  and (select direction = 'out' and status = 'queued' and body like 'Ana, para preparar%'
       from public.wa_messages where id = pg_temp.got('asked', 'message_id')::uuid)
  and (select asked_round = 0 and asked_at is not null and asked_conversation_id = 'f9500000-0000-4000-8000-00000000000a'
       from public.case_statements where id = pg_temp.got('statement', 'id')::uuid)
  and exists (select 1 from public.case_events where kind = 'account_asked' and actor_type = 'system'),
  'ONE asks once per round, in the conversation, and the case says so'
);

-- ---------- The client's reply is the answer ----------

update public.wa_conversations set one_claimed_at = now(), one_claims = 7 where id = 'f9500000-0000-4000-8000-00000000000a';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('open', public.conversation_account_open('f9500000-0000-4000-8000-00000000000a', 7));
insert into res values ('not_held', public.conversation_account_open('f9500000-0000-4000-8000-00000000000a', 6));
insert into res values ('completed', public.one_complete_statement('f9500000-0000-4000-8000-00000000000a', 7,
  pg_temp.got('statement', 'id')::uuid, 'Paguei R$ 980 no site. Gastei R$ 60 com comida.'));
insert into res values ('closed_now', public.conversation_account_open('f9500000-0000-4000-8000-00000000000a', 7));
reset role;
select ok(
  pg_temp.got('open', 'code') = 'open' and pg_temp.got('open', 'statement_id') = pg_temp.got('statement', 'id')
  and pg_temp.got('open', 'first_name') = 'Ana'
  and pg_temp.got('not_held', 'code') = 'not_working'
  and pg_temp.got('completed', 'code') = 'sent'
  and (select rounds = 1 and work = 'chronology' and chronology_status = 'none' and client_added like 'Paguei R$ 980%'
       from public.case_statements where id = pg_temp.got('statement', 'id')::uuid)
  and exists (select 1 from public.case_events where kind = 'client_statement_completed' and data ->> 'channel' = 'whatsapp')
  and pg_temp.got('closed_now', 'code') = 'none',
  'what the client writes in the conversation after ONE asked joins the account, and ONE orders it again'
);

-- ---------- Who is never asked there ----------

-- Ana's next order still misses a point: a new round, asked again. But Ana asked the firm to stop, so nothing goes.
update public.case_statements
set chronology_status = 'approved', work = null, missing_topics = array['chegada'], questions = array['Quando você chegou?']
where id = pg_temp.got('statement', 'id')::uuid;
insert into public.wa_optouts (org_id, contact_wa_id, source) values ('b9500000-0000-4000-8000-00000000000a', '5500999995001', 'keyword');
select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed_opted_out', coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.account_asks_owed(20) a;
reset role;
delete from public.wa_optouts where org_id = 'b9500000-0000-4000-8000-00000000000a';
-- The firm keeps its answers to clients to a person: ONE asks nothing in the conversation either.
insert into public.firm_autonomy (org_id, decision, mode) values ('b9500000-0000-4000-8000-00000000000a', 'reply_client', 'approval');
select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed_kept', coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.account_asks_owed(20) a;
reset role;
delete from public.firm_autonomy where org_id = 'b9500000-0000-4000-8000-00000000000a' and decision = 'reply_client';
select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed_next', coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.account_asks_owed(20) a;
reset role;
select ok(
  (select payload = '[]'::jsonb from res where name = 'owed_opted_out')
  and (select payload = '[]'::jsonb from res where name = 'owed_kept')
  and (select jsonb_array_length(payload) = 1 and payload -> 0 -> 'questions' ->> 0 = 'Quando você chegou?'
       from res where name = 'owed_next'),
  'a new round is asked again, never to who asked the firm to stop, nor where the firm keeps its answers to a person'
);

-- A person of the firm took the conversation over: ONE asks nothing there.
update public.wa_conversations set agent = 'person' where id = 'f9500000-0000-4000-8000-00000000000a';
select pg_temp.as_backend();
set local role service_role;
select is(
  (select count(*)::integer from public.account_asks_owed(20)),
  0,
  'nor in a conversation a person took over'
);
reset role;

-- ---------- Another firm ----------

select pg_temp.sign_in('a9500000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::integer from public.case_events where org_id = 'b9500000-0000-4000-8000-00000000000a'),
  0,
  'another firm reads nothing of what was asked and answered in a conversation of the firm'
);
reset role;
select pg_temp.as_backend();
set local role service_role;
select is(
  public.one_complete_statement('f9500000-0000-4000-8000-00000000000b', 1, pg_temp.got('statement', 'id')::uuid, 'Resposta.')
    ->> 'code',
  'not_working',
  'and an answer in a conversation of one firm never reaches an account of the other'
);
reset role;

select * from finish();
rollback;
