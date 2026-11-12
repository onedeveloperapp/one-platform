begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- A test firm (0220): the operator marks a firm, which gets a link of its
-- own; its cases and the trips ONE follows for it are tests from then on
-- (and as they are written), its flights made to happen by its tools, its
-- link opens the test court, and a test trip pairs with its real number.
-- Two firms: the one not marked keeps everything real, and nothing of one
-- reaches the other.
--
-- Every person, firm, phone and flight here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@teste-firma.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@outra-firma.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a2200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@teste-firma.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a2200000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@plataforma.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a2200000-0000-4000-8000-000000000009';
insert into public.organizations (id, name, slug, created_by) values
  ('b2200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-teste-220', 'a2200000-0000-4000-8000-000000000001'),
  ('b2200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-real-220', 'a2200000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2200000-0000-4000-8000-00000000000a', 'a2200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2200000-0000-4000-8000-00000000000a', 'a2200000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b2200000-0000-4000-8000-00000000000b', 'a2200000-0000-4000-8000-000000000002', 'owner', 'socio');
-- Each firm's real number.
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2200000-0000-4000-8000-00000000000a', 'b2200000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-220-a', 'WhatsApp A', 'connected'),
  ('d2200000-0000-4000-8000-00000000000b', 'b2200000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-220-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2200000-0000-4000-8000-00000000000a', 'b2200000-0000-4000-8000-00000000000a', 'd2200000-0000-4000-8000-00000000000a', 'meta', 'phone-220-a', 'waba-220-a', '5562900002201'),
  ('f2200000-0000-4000-8000-00000000000b', 'b2200000-0000-4000-8000-00000000000b', 'd2200000-0000-4000-8000-00000000000b', 'meta', 'phone-220-b', 'waba-220-b', '5562900002202');
-- A case and a trip ONE follows of each firm, written before any firm is a test firm.
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2200000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake'),
  ('c2200000-0000-4000-8000-000000000002', 'b2200000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'intake');
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel, watch) values
  ('e2200000-0000-4000-8000-00000000000a', 'b2200000-0000-4000-8000-00000000000a', 'Passageira Teste', '5562988880001', 'LA',
   'O passageiro concordou que o escritório acompanhe os voos.', now(), 'firm', 'flightaware'),
  ('e2200000-0000-4000-8000-00000000000b', 'b2200000-0000-4000-8000-00000000000b', 'Passageiro Real', '5562988880002', 'G3',
   'O passageiro concordou que o escritório acompanhe os voos.', now(), 'firm', 'flightaware');
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local) values
  ('b2200000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 1, 'LA3456', 'GRU', 'REC', '2099-01-10 08:10', '2099-01-10 11:25'),
  ('b2200000-0000-4000-8000-00000000000b', 'e2200000-0000-4000-8000-00000000000b', 1, 'G31450', 'BSB', 'GIG', '2099-01-10 14:00', '2099-01-10 15:45');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.mark(who uuid, org uuid, turn_on boolean, note text, token text) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  begin
    answer := public.admin_set_test_firm(org, turn_on, note, token);
  exception when others then
    answer := jsonb_build_object('raised', sqlerrm);
  end;
  reset role;
  return answer;
end;
$$;
create function pg_temp.tools(who uuid, org uuid) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  begin
    answer := public.firm_test_tools(org);
  exception when others then
    answer := jsonb_build_object('raised', sqlerrm);
  end;
  reset role;
  return answer;
end;
$$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true); $$;

-- 1. Only the operator marks a firm.
insert into res values ('by_owner', pg_temp.mark('a2200000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-00000000000a',
  true, 'Escritório de testes do piloto', repeat('t', 43)));
select ok(
  (select payload ->> 'raised' from res where name = 'by_owner') = 'not_authorized'
  and not exists (select 1 from public.test_firms),
  'who manages a firm does not make it a test firm: only the operator does'
);

-- 2. The operator marks firm A: its case and its trip are tests now, the trip simulated, with a label of its own.
insert into res values ('marked', pg_temp.mark('a2200000-0000-4000-8000-000000000009', 'b2200000-0000-4000-8000-00000000000a',
  true, 'Escritório de testes do piloto', repeat('t', 43)));
select ok(
  (select payload ->> 'code' from res where name = 'marked') = 'marked'
  and (select is_test from public.cases where id = 'c2200000-0000-4000-8000-000000000001')
  and (select is_test and watch = 'simulated' and label ~ '^viagem_[a-p]{16}$'
       from public.tracked_trips where id = 'e2200000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.audit_events where action = 'test_firm.marked'
              and org_id = 'b2200000-0000-4000-8000-00000000000a' and actor_id = 'a2200000-0000-4000-8000-000000000009'),
  'the operator marks a firm as a test firm, on the record, and what it has becomes a test'
);

select ok(
  not (select is_test from public.cases where id = 'c2200000-0000-4000-8000-000000000002')
  and (select not is_test and watch = 'flightaware' from public.tracked_trips where id = 'e2200000-0000-4000-8000-00000000000b'),
  'the other firm keeps its case and its trip real'
);

-- 3. What a test firm writes afterwards is a test as it is written; the other firm's is not.
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2200000-0000-4000-8000-000000000003', 'b2200000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'cancellation', 'intake'),
  ('c2200000-0000-4000-8000-000000000004', 'b2200000-0000-4000-8000-00000000000b', 2, 'direito-do-passageiro', 'cancellation', 'intake');
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel, watch) values
  ('e2200000-0000-4000-8000-00000000001a', 'b2200000-0000-4000-8000-00000000000a', 'Outra Passageira', '5562988880003', 'AD',
   'O passageiro concordou que o escritório acompanhe os voos.', now(), 'firm', 'flightaware'),
  ('e2200000-0000-4000-8000-00000000001b', 'b2200000-0000-4000-8000-00000000000b', 'Outro Passageiro', '5562988880004', 'AD',
   'O passageiro concordou que o escritório acompanhe os voos.', now(), 'firm', 'flightaware');
select ok(
  (select is_test from public.cases where id = 'c2200000-0000-4000-8000-000000000003')
  and not (select is_test from public.cases where id = 'c2200000-0000-4000-8000-000000000004')
  and (select is_test and watch = 'simulated' from public.tracked_trips where id = 'e2200000-0000-4000-8000-00000000001a')
  and (select not is_test and watch = 'flightaware' from public.tracked_trips where id = 'e2200000-0000-4000-8000-00000000001b'),
  'a case and a trip written for a test firm are tests from the start; another firm''s are real'
);

-- 4. The firm's link: who manages it reads it; a member reads that it is a test firm; another firm reads nothing.
insert into res values ('tools_owner', pg_temp.tools('a2200000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-00000000000a'));
insert into res values ('tools_member', pg_temp.tools('a2200000-0000-4000-8000-000000000003', 'b2200000-0000-4000-8000-00000000000a'));
insert into res values ('tools_other', pg_temp.tools('a2200000-0000-4000-8000-000000000002', 'b2200000-0000-4000-8000-00000000000a'));
insert into res values ('tools_real', pg_temp.tools('a2200000-0000-4000-8000-000000000002', 'b2200000-0000-4000-8000-00000000000b'));
select ok(
  (select payload ->> 'token' from res where name = 'tools_owner') = repeat('t', 43)
  and (select (payload ->> 'real_number')::boolean from res where name = 'tools_owner')
  and (select (payload ->> 'test')::boolean and payload ->> 'token' is null from res where name = 'tools_member')
  and (select payload ->> 'raised' from res where name = 'tools_other') = 'not_authorized'
  and (select not (payload ->> 'test')::boolean from res where name = 'tools_real'),
  'who manages the test firm reads its link, a member only that it is a test firm, and another firm nothing'
);

-- 5. The link opens the test court of the firm, and the tools see the firm's trips only.
select pg_temp.as_backend();
select ok(
  public.test_court_org(repeat('t', 43)) = 'b2200000-0000-4000-8000-00000000000a'
  and public.test_court_org(repeat('u', 43)) is null,
  'the firm''s link opens its test court, and no other link does'
);
select ok(
  (select jsonb_array_length(public.test_firm_view(repeat('t', 43)) -> 'trips')) = 2
  and not exists (
    select 1 from jsonb_array_elements(public.test_firm_view(repeat('t', 43)) -> 'trips') t
    where (t ->> 'id')::uuid in ('e2200000-0000-4000-8000-00000000000b', 'e2200000-0000-4000-8000-00000000001b')
  )
  and (public.test_firm_view(repeat('t', 43)) -> 'number' ->> 'provider') = 'meta',
  'the firm''s tools list its own test trips and its real number, nothing of the other firm'
);

-- 6. The tools cancel a leg of the firm's trip, and refuse another firm's.
insert into res values ('cancel_a', public.test_firm_set_legs(repeat('t', 43), 'e2200000-0000-4000-8000-00000000000a',
  '[{"position": 1, "status": "cancelled"}]'::jsonb));
insert into res values ('cancel_b', public.test_firm_set_legs(repeat('t', 43), 'e2200000-0000-4000-8000-00000000000b',
  '[{"position": 1, "status": "cancelled"}]'::jsonb));
select ok(
  (select (payload ->> 'ok')::boolean from res where name = 'cancel_a')
  and (select status = 'cancelled' and status_source = 'simulated' from public.tracked_legs
       where trip_id = 'e2200000-0000-4000-8000-00000000000a' and position = 1)
  and (select payload ->> 'code' from res where name = 'cancel_b') = 'trip_not_found'
  and (select status = 'scheduled' from public.tracked_legs where trip_id = 'e2200000-0000-4000-8000-00000000000b'),
  'the firm''s tools make its own trip''s flight cancelled, and never touch another firm''s trip'
);

-- 7. A test trip of a test firm pairs with the conversation of its real number.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id) values
  ('f2210000-0000-4000-8000-00000000000a', 'b2200000-0000-4000-8000-00000000000a', 'f2200000-0000-4000-8000-00000000000a', '5562988880001'),
  ('f2210000-0000-4000-8000-00000000000b', 'b2200000-0000-4000-8000-00000000000b', 'f2200000-0000-4000-8000-00000000000b', '5562988880002');
insert into public.flight_alerts (id, org_id, trip_id, kind, rule_version, status, sent_at) values
  ('e2210000-0000-4000-8000-00000000000a', 'b2200000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'cancelled', 'flight-problem-v1', 'sent', now()),
  ('e2210000-0000-4000-8000-00000000000b', 'b2200000-0000-4000-8000-00000000000b', 'e2200000-0000-4000-8000-00000000000b', 'cancelled', 'flight-problem-v1', 'sent', now());
select ok(
  public.conversation_pending_alert('f2210000-0000-4000-8000-00000000000a') = 'e2210000-0000-4000-8000-00000000000a'
  and public.conversation_pending_alert('f2210000-0000-4000-8000-00000000000b') = 'e2210000-0000-4000-8000-00000000000b',
  'the alert of a test firm''s trip is answered in its real number''s conversation, and a real firm''s as before'
);

-- 8. Unmarked, the link opens nothing more, and what was a test stays a test.
insert into res values ('unmarked', pg_temp.mark('a2200000-0000-4000-8000-000000000009', 'b2200000-0000-4000-8000-00000000000a',
  false, 'Fim dos testes do piloto', null));
select pg_temp.as_backend();
select ok(
  (select payload ->> 'code' from res where name = 'unmarked') = 'unmarked'
  and public.test_court_org(repeat('t', 43)) is null
  and (select is_test from public.cases where id = 'c2200000-0000-4000-8000-000000000001')
  and exists (select 1 from public.audit_events where action = 'test_firm.unmarked'
              and org_id = 'b2200000-0000-4000-8000-00000000000a'),
  'unmarked, the firm''s link opens nothing, on the record, and its test cases stay tests'
);

select * from finish();
rollback;
