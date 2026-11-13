begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- What ONE decides without the firm or the client (0240). At firm A, which
-- leaves the court system to ONE, a lawsuit planned at TJGO has its system
-- approved at once by ONE; at firm B, which keeps it with a person, it waits
-- for them. ONE marks the client's link finished at its look of the case,
-- only while it holds that look. On which of her two legs the problem was
-- is asked of Lia in the chat, and her answer marks it as a person's.
-- Nothing of firm A reaches firm B.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2400000-0000-4000-8000-000000000001', 'ana@lima-decide.invalid', 'Ana Lima'),
  ('a2400000-0000-4000-8000-000000000002', 'duda@rocha-decide.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2400000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-decide', 'a2400000-0000-4000-8000-000000000001'),
  ('b2400000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-decide', 'a2400000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2400000-0000-4000-8000-00000000000a', 'a2400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2400000-0000-4000-8000-00000000000b', 'a2400000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b2400000-0000-4000-8000-00000000000b', 'court_system', 'approval');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2400000-0000-4000-8000-00000000000a', 'b2400000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'documents'),
  ('c2400000-0000-4000-8000-00000000000b', 'b2400000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'cancellation', 'documents');
insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('d2400000-0000-4000-8000-00000000000a', 'b2400000-0000-4000-8000-00000000000a', 'Lia Teste', '52998224725', '1990-05-04'),
  ('d2400000-0000-4000-8000-00000000000b', 'b2400000-0000-4000-8000-00000000000b', 'Rui Teste', '12345678909', '1985-01-01');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2400000-0000-4000-8000-00000000000a', 'b2400000-0000-4000-8000-00000000000a', 'c2400000-0000-4000-8000-00000000000a',
   'd2400000-0000-4000-8000-00000000000a', 'claimant'),
  ('e2400000-0000-4000-8000-00000000000b', 'b2400000-0000-4000-8000-00000000000b', 'c2400000-0000-4000-8000-00000000000b',
   'd2400000-0000-4000-8000-00000000000b', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f2400000-0000-4000-8000-00000000000a', 'b2400000-0000-4000-8000-00000000000a', 'c2400000-0000-4000-8000-00000000000a',
   'juizado', 'TJGO', 'planned'),
  ('f2400000-0000-4000-8000-00000000000b', 'b2400000-0000-4000-8000-00000000000b', 'c2400000-0000-4000-8000-00000000000b',
   'juizado', 'TJGO', 'planned');

select ok(
  (select default_mode = 'auto' and modes = array['auto', 'approval'] from public.autonomy_decisions where key = 'court_system'),
  'the court system is a decision of each firm, ONE''s by default');
select ok(
  (select system = 'projudi' and system_approved_at is not null and system_approved_by is null
   from public.proceedings where id = 'f2400000-0000-4000-8000-00000000000a'),
  'where the firm leaves it to ONE, the system ONE names is approved at once, by ONE');
select ok(
  (select system = 'projudi' and system_approved_at is null from public.proceedings where id = 'f2400000-0000-4000-8000-00000000000b'),
  'where the firm keeps it with a person, it waits for them');

-- The client's link, finished by ONE at its look of the case.
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b2400000-0000-4000-8000-00000000000a', 'c2400000-0000-4000-8000-00000000000a', 'd2400000-0000-4000-8000-00000000000a',
   repeat('d', 64), now() + interval '30 days');
update public.case_advances set claimed_at = now(), claims = 7 where case_id = 'c2400000-0000-4000-8000-00000000000a';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.one_finish_client_links('c2400000-0000-4000-8000-00000000000a', 6) ->> 'code', 'not_working',
  'only while ONE holds its look of the case');
select is((public.one_finish_client_links('c2400000-0000-4000-8000-00000000000a', 7) ->> 'finished')::integer, 1,
  'ONE marks the client''s link finished');
reset role;
select ok(
  (select finished_at is not null from public.client_links where case_id = 'c2400000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.case_events where case_id = 'c2400000-0000-4000-8000-00000000000a'
              and kind = 'client_finished' and actor_type = 'system' and data ->> 'by' = 'one'),
  'on the record as ONE''s');

-- On which leg the problem was, asked of the client in the chat.
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2400000-0000-4000-8000-0000000000ca', 'b2400000-0000-4000-8000-00000000000a', 'whatsapp', 'trecho-waba-a', 'Chat de teste',
   'connected', 'a2400000-0000-4000-8000-000000000001', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';
update public.people set phone = '5500988884001', updated_via = 'firm' where id = 'd2400000-0000-4000-8000-00000000000a';
-- Her account is in already: the leg is what ONE asks next.
insert into public.case_statements (org_id, case_id, party_id, source, transcript, chronology_status, chronology)
values ('b2400000-0000-4000-8000-00000000000a', 'c2400000-0000-4000-8000-00000000000a', 'e2400000-0000-4000-8000-00000000000a',
        'client', 'O voo foi cancelado no aeroporto e ninguém ajudou.', 'confirmed', '1. O voo foi cancelado.');
insert into public.flight_segments (org_id, case_id, position, flight_number, origin_iata, destination_iata, source) values
  ('b2400000-0000-4000-8000-00000000000a', 'c2400000-0000-4000-8000-00000000000a', 1, 'AD4221', 'GRU', 'VCP', 'firm'),
  ('b2400000-0000-4000-8000-00000000000a', 'c2400000-0000-4000-8000-00000000000a', 2, 'AD4702', 'VCP', 'BSB', 'firm');
create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number', public.register_wa_number('b2400000-0000-4000-8000-00000000000a',
  'c2400000-0000-4000-8000-0000000000ca', 'test', 'trecho-number-a', 'trecho-waba-a', '5500900000401', 'Lima Advocacia', 'cloud'));
insert into res values ('lia', jsonb_build_object('conversation',
  (public.wa_ingest_inbound('b2400000-0000-4000-8000-00000000000a',
     (select n.id from public.wa_numbers n where n.org_id = 'b2400000-0000-4000-8000-00000000000a' and n.provider = 'test'),
     '5500988884001', 'Lia Teste', 'test.in.' || gen_random_uuid(), 'text', 'oi') ->> 'conversation_id')));
insert into res values ('claim', jsonb_build_object('claim',
  ((public.claim_conversation_turns(1, pg_temp.got('lia', 'conversation')::uuid) -> 0) ->> 'claim')::integer));
insert into res values ('owed', (select to_jsonb(o) from public.chat_questions_owed(100) o
                                 where o.conversation_id = pg_temp.got('lia', 'conversation')::uuid));
select is(pg_temp.got('owed', 'kind') || ': ' || pg_temp.got('owed', 'wording'),
  'leg: AD4221, de ' || coalesce((select city from public.airports where iata = 'GRU'), 'GRU') || ' para '
    || coalesce((select city from public.airports where iata = 'VCP'), 'VCP') || chr(10) || 'AD4702, de '
    || coalesce((select city from public.airports where iata = 'VCP'), 'VCP') || ' para '
    || coalesce((select city from public.airports where iata = 'BSB'), 'BSB'),
  'on which of her legs the problem was is asked of her, each leg by its flight and cities');
insert into res values ('asked', public.one_ask_chat_question(pg_temp.got('lia', 'conversation')::uuid, 'leg',
  'e2400000-0000-4000-8000-00000000000a', 'Em qual destes voos aconteceu o problema?'));
insert into res values ('answer', public.one_answer_problem_leg(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('claim', 'claim')::integer, 2));
select is(pg_temp.got('answer', 'code') || ' ' || pg_temp.got('answer', 'flight'), 'marked AD4702', 'her answer is kept');
reset role;
select ok(
  (select affected and affected_by = 'person' from public.flight_segments
   where case_id = 'c2400000-0000-4000-8000-00000000000a' and position = 2)
  and exists (select 1 from public.case_events where case_id = 'c2400000-0000-4000-8000-00000000000a' and kind = 'leg_told_by_client'),
  'it marks that leg as a person''s, on the record');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok(
  not exists (select 1 from public.chat_questions_owed(100) o
              where o.conversation_id = pg_temp.got('lia', 'conversation')::uuid and o.kind = 'leg'),
  'and it is asked no more');
reset role;

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2400000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.proceedings where org_id = 'b2400000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.case_events where case_id = 'c2400000-0000-4000-8000-00000000000a'),
  0, 'another firm reads neither the lawsuit nor the record');
reset role;

select * from finish();
rollback;
