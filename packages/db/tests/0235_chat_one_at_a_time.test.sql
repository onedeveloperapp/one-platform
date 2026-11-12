begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- One thing at a time in the chat (0235): the account's questions wait for
-- a step of the chat to end, and once asked, the check of data and the
-- client's words before court wait for their answers. Two firms: nothing of
-- one reaches the other.
--
-- Every person, firm and number here is invented: the phones are of an area
-- code no carrier has.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2350000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@uma-vez.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a2350000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@uma-vez.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b2350000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-uma-vez', 'a2350000-0000-4000-8000-000000000001'),
  ('b2350000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-uma-vez', 'a2350000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2350000-0000-4000-8000-00000000000a', 'a2350000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2350000-0000-4000-8000-00000000000b', 'a2350000-0000-4000-8000-000000000003', 'owner', 'advogado');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d2350000-0000-4000-8000-00000000000a', 'b2350000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-uma-vez-a', 'WhatsApp A',
   'connected', 'a2350000-0000-4000-8000-000000000001', now()),
  ('d2350000-0000-4000-8000-00000000000b', 'b2350000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-uma-vez-b', 'WhatsApp B',
   'connected', 'a2350000-0000-4000-8000-000000000003', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('e2350000-0000-4000-8000-00000000000a', 'b2350000-0000-4000-8000-00000000000a', 'd2350000-0000-4000-8000-00000000000a',
   'simulator', 'sim-uma-vez-a', 'waba-uma-vez-a', '5500900002351', 'coexistence'),
  ('e2350000-0000-4000-8000-00000000000b', 'b2350000-0000-4000-8000-00000000000b', 'd2350000-0000-4000-8000-00000000000b',
   'simulator', 'sim-uma-vez-b', 'waba-uma-vez-b', '5500900002352', 'coexistence');

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
select pg_temp.sign_in('a2350000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b2350000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "ANA TESTE DE SOUZA", "birth_date": "1985-04-02", "phone": "5500999992351"}'::jsonb));
reset role;
select pg_temp.sign_in('a2350000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b2350000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999992353"}'::jsonb));
reset role;
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('f2350000-0000-4000-8000-00000000000a', 'b2350000-0000-4000-8000-00000000000a', 'e2350000-0000-4000-8000-00000000000a',
   '5500999992351', now() - interval '10 minutes', now() - interval '10 minutes', 'Mandei o áudio', 'in', 1, 'one'),
  ('f2350000-0000-4000-8000-00000000000b', 'b2350000-0000-4000-8000-00000000000b', 'e2350000-0000-4000-8000-00000000000b',
   '5500999992353', now() - interval '2 days', now() - interval '2 days', 'Oi', 'in', 0, 'one');
insert into res select 'statement', jsonb_build_object('id', pg_temp.incomplete('a2350000-0000-4000-8000-000000000001',
  pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id')::uuid));
insert into res select 'statement_b', jsonb_build_object('id', pg_temp.incomplete('a2350000-0000-4000-8000-000000000003',
  pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('case_b', 'party_id')::uuid));

select pg_temp.as_backend();
set local role service_role;

-- A step of the chat waits for Ana's answer: the account's questions wait for it.
update public.wa_conversations set chat_step = '{"step": "dados"}' where id = 'f2350000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from public.account_asks_owed(20) a where a.statement_id = pg_temp.got('statement', 'id')::uuid),
  0, 'the account is not asked over a step of the chat that waits'
);
update public.wa_conversations set chat_step = '{}' where id = 'f2350000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from public.account_asks_owed(20) a where a.statement_id = pg_temp.got('statement', 'id')::uuid),
  1, 'once the step ended, it is owed'
);

insert into res values ('asked', public.one_ask_account(pg_temp.got('statement', 'id')::uuid,
  'Ana, para preparar a sua ação, o escritório precisa saber mais algumas coisas. Vou perguntar uma de cada vez.' || E'
'
  || 'Pergunta 1 de 2: Quanto você pagou pela passagem e onde comprou?'));
select is(pg_temp.got('asked', 'code'), 'queued', 'ONE asks its first question');
select ok(
  public.conversation_account_waits((select w from public.wa_conversations w where w.id = 'f2350000-0000-4000-8000-00000000000a'))
    and not public.conversation_account_waits((select w from public.wa_conversations w where w.id = 'f2350000-0000-4000-8000-00000000000b')),
  'her conversation waits for the answers, firm B''s does not'
);
select is(
  (select count(*)::int from public.chat_data_checks_owed(100) o where o.conversation_id = 'f2350000-0000-4000-8000-00000000000a')
  + (select count(*)::int from public.chat_questions_owed(100) o where o.conversation_id = 'f2350000-0000-4000-8000-00000000000a'),
  0, 'and nothing else starts over them'
);
reset role;

select * from finish();
rollback;
