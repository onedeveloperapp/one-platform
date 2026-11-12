begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The chat's script, its fifth part (0233): the client's words owed before
-- the action goes to court are asked in the chat one at a time, free
-- justice first, then the civil court with its own wording; each answer is
-- kept as on the link, by the client, with the channel it came by. Two
-- firms: nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented; the CPF is one every
-- manual uses as an example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2330000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-perguntas.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2330000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-perguntas.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2330000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-perguntas', 'a2330000-0000-4000-8000-000000000001'),
  ('b2330000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-perguntas', 'a2330000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2330000-0000-4000-8000-00000000000a', 'a2330000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2330000-0000-4000-8000-00000000000b', 'a2330000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2330000-0000-4000-8000-00000000000a', 'b2330000-0000-4000-8000-00000000000a', 'whatsapp', 'perguntas-waba-a', 'Chat de teste',
   'connected', 'a2330000-0000-4000-8000-000000000001', now()),
  ('c2330000-0000-4000-8000-00000000000b', 'b2330000-0000-4000-8000-00000000000b', 'whatsapp', 'perguntas-waba-b', 'Chat de teste',
   'connected', 'a2330000-0000-4000-8000-000000000004', now());

update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

-- Rui's case at firm A goes to the civil court, the lawsuit still planned.
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2330000-0000-4000-8000-000000000001', 'b2330000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting');
insert into public.people (id, org_id, full_name, cpf, birth_date, phone, updated_via) values
  ('d2330000-0000-4000-8000-000000000001', 'b2330000-0000-4000-8000-00000000000a', 'Rui Teste', '52998224725', '1980-01-01',
   '5500988883301', 'firm');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2330000-0000-4000-8000-000000000001', 'b2330000-0000-4000-8000-00000000000a', 'c2330000-0000-4000-8000-000000000001',
   'd2330000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f2330000-0000-4000-8000-000000000001', 'b2330000-0000-4000-8000-00000000000a', 'c2330000-0000-4000-8000-000000000001',
   'comum', 'TJGO', 'planned');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f2330000-0000-4000-8000-000000000001', 'e2330000-0000-4000-8000-000000000001', 'b2330000-0000-4000-8000-00000000000a');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Rui Teste', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;
create function pg_temp.owed(conversation uuid) returns jsonb language sql as $$
  select to_jsonb(o) from public.chat_questions_owed(100) o where o.conversation_id = conversation;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2330000-0000-4000-8000-00000000000a',
  'c2330000-0000-4000-8000-00000000000a', 'test', 'perguntas-number-a', 'perguntas-waba-a', '5500900000331', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2330000-0000-4000-8000-00000000000b',
  'c2330000-0000-4000-8000-00000000000b', 'test', 'perguntas-number-b', 'perguntas-waba-b', '5500900000332', 'Rocha Advocacia', 'cloud'));
insert into res values ('rui', jsonb_build_object('conversation',
  pg_temp.writes('b2330000-0000-4000-8000-00000000000a', '5500988883301', 'oi, alguma novidade?')));
insert into res values ('other', jsonb_build_object('conversation',
  pg_temp.writes('b2330000-0000-4000-8000-00000000000b', '5500988883301', 'oi')));

insert into res values ('rui_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('rui', 'conversation')::uuid)));

select is(
  (pg_temp.owed(pg_temp.got('rui', 'conversation')::uuid)) ->> 'kind', 'free_justice',
  'free justice is asked first'
);
select is(pg_temp.owed(pg_temp.got('other', 'conversation')::uuid), null, 'the same number at firm B is asked nothing');

insert into res values ('asked', public.one_ask_chat_question(pg_temp.got('rui', 'conversation')::uuid, 'free_justice',
  'e2330000-0000-4000-8000-000000000001', 'Você quer pedir a justiça gratuita?'));
select ok(
  pg_temp.got('asked', 'code') = 'queued' and pg_temp.owed(pg_temp.got('rui', 'conversation')::uuid) is null,
  'ONE asks it, and nothing else while it waits'
);

insert into res values ('fj', public.one_answer_chat_question(pg_temp.got('rui', 'conversation')::uuid,
  pg_temp.got('rui_claim', 'claim')::integer, true));
select is(pg_temp.got('fj', 'code'), 'recorded', 'his yes is kept');
select is(
  (select jsonb_build_object('asks', a.asks, 'source', a.source, 'channel', a.evidence ->> 'channel')
   from public.free_justice_answers a where a.party_id = 'e2330000-0000-4000-8000-000000000001' and a.replaced_at is null),
  '{"asks": true, "source": "client", "channel": "whatsapp"}'::jsonb,
  'as on the link, by the client, with the channel it came by'
);

select is(
  (pg_temp.owed(pg_temp.got('rui', 'conversation')::uuid)) ->> 'kind', 'civil_court',
  'then the civil court is owed, with its own wording'
);
insert into res values ('asked_civil', public.one_ask_chat_question(pg_temp.got('rui', 'conversation')::uuid, 'civil_court',
  'e2330000-0000-4000-8000-000000000001', 'A sua ação vai para a vara cível. Você aceita?'));
insert into res values ('civil', public.one_answer_chat_question(pg_temp.got('rui', 'conversation')::uuid,
  pg_temp.got('rui_claim', 'claim')::integer, false));
select is(pg_temp.got('civil', 'code'), 'declined', 'his no to the civil court is kept');
select ok(
  (select not a.accepted and a.wording = public.civil_court_wording('e2330000-0000-4000-8000-000000000001')
   from public.civil_court_answers a where a.party_id = 'e2330000-0000-4000-8000-000000000001' and a.replaced_at is null),
  'with the wording he was shown'
);
select is(
  public.one_answer_chat_question(pg_temp.got('rui', 'conversation')::uuid, pg_temp.got('rui_claim', 'claim')::integer, true) ->> 'code',
  'not_asked',
  'an answer with no question waiting is kept nowhere'
);

select * from finish();
rollback;
