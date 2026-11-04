begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- What kept a case still, and the agency's reminder before a flight (0094):
-- a person of the firm confirms what ONE read of a person in their
-- documents, and the marks go; a partner or a lawyer decides the case goes
-- on without what the client did not answer of their account, and the
-- account is ready for ONE; the agency reads, and its bell is owed, the
-- passengers who fly in the next days with no agreement, never who said no.
-- Two firms, two agencies: nothing of one reaches the other.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@confere.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@confere.invalid', '', now(), '{}', '{"display_name":"Bia Souto"}', now(), now()),
  ('a9700000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@confere.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now()),
  ('a9700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-confere.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a9700000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eli@sol-confere.invalid', '', now(), '{}', '{"display_name":"Eli Matos"}', now(), now()),
  ('a9700000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabi@mar-confere.invalid', '', now(), '{}', '{"display_name":"Fabi Reis"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9700000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-confere', 'a9700000-0000-4000-8000-000000000001'),
  ('b9700000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-confere', 'a9700000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9700000-0000-4000-8000-00000000000a', 'a9700000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9700000-0000-4000-8000-00000000000a', 'a9700000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b9700000-0000-4000-8000-00000000000b', 'a9700000-0000-4000-8000-000000000003', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- Firm A: Ana's case, whose CPF and birth date ONE read from her identity. Firm B: a case of its own.
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9700000-0000-4000-8000-00000000000a', 'cancellation', 'LA', date '2026-09-20',
  '{"full_name": "Ana Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "phone": "5500999997001"}'::jsonb));
reset role;
update public.people set read_fields = jsonb_build_object(
    'cpf', jsonb_build_object('document', 'e9700000-0000-4000-8000-000000000001', 'kind', 'identity'),
    'birth_date', jsonb_build_object('document', 'e9700000-0000-4000-8000-000000000001', 'kind', 'identity')),
  updated_via = 'document'
where id = pg_temp.got('case', 'person_id')::uuid;
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9700000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999997003"}'::jsonb));
reset role;

select ok(
  has_function_privilege('authenticated', 'public.confirm_person_read_fields(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.confirm_person_read_fields(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.close_account_gaps(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.close_account_gaps(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.pax_departing_unagreed(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pax_unagreed_departures(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pax_unagreed_notices_owed(integer)', 'EXECUTE'),
  'the firm confirms and decides through its functions; what the backend reads across agencies is not a member''s'
);

-- ---------- 1. What ONE read, confirmed by a person ----------

-- Saving the person as they are keeps every mark: that is why the card asked forever.
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_case_person(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  '{"cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb);
reset role;
select ok(
  (select read_fields ? 'cpf' and read_fields ? 'birth_date' from public.people where id = pg_temp.got('case', 'person_id')::uuid),
  'saving a person without changing a field keeps what ONE read marked as read'
);

-- Firm B never confirms firm A's person.
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.confirm_person_read_fields(%L, %L)', pg_temp.got('case', 'case_id'), pg_temp.got('case', 'person_id')),
  'P0002', 'case_not_found',
  'another firm cannot confirm the data of a case that is not its own'
);
-- Nor a person of its own case through firm A's person.
select is(
  public.confirm_person_read_fields(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid) ->> 'code',
  'person_not_found',
  'nor reaches a person of another firm through a case of its own'
);
reset role;

select pg_temp.sign_in('a9700000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('confirmed', public.confirm_person_read_fields(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid));
insert into res values ('again', public.confirm_person_read_fields(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid));
reset role;
select ok(
  pg_temp.got('confirmed', 'code') = 'confirmed'
  and (select payload -> 'fields' = '["birth_date", "cpf"]'::jsonb from res where name = 'confirmed')
  and (select read_fields = '{}'::jsonb and cpf = '12345678909' from public.people where id = pg_temp.got('case', 'person_id')::uuid),
  'anybody of the firm confirms what ONE read: the marks go, the data stay'
);
select ok(
  exists (select 1 from public.case_events e
          where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'person_read_confirmed'
            and e.actor_type = 'person' and e.data -> 'fields' = '["birth_date", "cpf"]'::jsonb)
  and pg_temp.got('again', 'code') = 'nothing',
  'the timeline says which fields were confirmed, and confirming again finds nothing to confirm'
);

-- ---------- 2. The case goes on without what the client did not answer ----------

-- Ana's account, ordered by ONE, still lacks the purchase and the expenses, asked of her.
insert into public.case_statements (id, org_id, case_id, source, status, transcript, chronology, chronology_status,
                                    missing_topics, questions)
values ('c9700000-0000-4000-8000-0000000000a1', 'b9700000-0000-4000-8000-00000000000a', pg_temp.got('case', 'case_id')::uuid,
        'firm', 'received', 'O voo das 21h30 para Recife foi cancelado quando eu já estava no aeroporto.',
        '20/09/2026, 21:30: o voo foi cancelado.', 'approved', array['compra', 'gastos'],
        array['Quanto você pagou pela passagem?', 'Você teve algum gasto?']);
select is(public.case_account_state(pg_temp.got('case', 'case_id')::uuid), 'incomplete',
  'an account that still lacks what the client was asked is incomplete, and ONE waits for it');

-- Who attends the clients does not decide it; another firm never reaches it.
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format('select public.close_account_gaps(%L, %L)', pg_temp.got('case', 'case_id'), 'c9700000-0000-4000-8000-0000000000a1'),
  '42501', 'not_authorized',
  'going on without the client''s answers is a partner''s or a lawyer''s decision'
);
reset role;
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.close_account_gaps(%L, %L)', pg_temp.got('case', 'case_id'), 'c9700000-0000-4000-8000-0000000000a1'),
  'P0002', 'case_not_found',
  'and another firm''s lawyer never decides it'
);
reset role;

update public.case_advances set after = 'tomorrow', woken_at = null where case_id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.sign_in('a9700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('closed', public.close_account_gaps(pg_temp.got('case', 'case_id')::uuid, 'c9700000-0000-4000-8000-0000000000a1'));
insert into res values ('closed_again', public.close_account_gaps(pg_temp.got('case', 'case_id')::uuid, 'c9700000-0000-4000-8000-0000000000a1'));
reset role;
select ok(
  pg_temp.got('closed', 'code') = 'closed'
  and (select missing_topics = '{}' and questions = '{}' and gaps_closed_topics = array['compra', 'gastos']
              and gaps_closed_by = 'a9700000-0000-4000-8000-000000000001' and gaps_closed_at is not null
       from public.case_statements where id = 'c9700000-0000-4000-8000-0000000000a1')
  and public.case_account_state(pg_temp.got('case', 'case_id')::uuid) = 'ready',
  'a partner decides the case goes on without them: the questions go, what was missing is kept, and the account is ready'
);
select ok(
  (select after is null and woken_at is not null from public.case_advances where case_id = pg_temp.got('case', 'case_id')::uuid)
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('case', 'case_id')::uuid and e.kind = 'account_gaps_closed'
                and e.data -> 'topics' = '["compra", "gastos"]'::jsonb)
  and pg_temp.got('closed_again', 'code') = 'nothing_owed',
  'the case is woken for ONE, the timeline says what the firm went on without, and there is nothing to close twice'
);

-- ---------- 3. The agency's passengers who fly soon with no agreement ----------

insert into public.partners (id, name) values
  ('d9700000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('d9700000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('d9700000-0000-4000-8000-0000000000aa', 'a9700000-0000-4000-8000-000000000004', 'owner'),
  ('d9700000-0000-4000-8000-0000000000aa', 'a9700000-0000-4000-8000-000000000005', 'member'),
  ('d9700000-0000-4000-8000-0000000000bb', 'a9700000-0000-4000-8000-000000000006', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('97000000-0000-4000-8000-00000000000a', 'd9700000-0000-4000-8000-0000000000aa', 'b9700000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('97000000-0000-4000-8000-00000000000b', 'd9700000-0000-4000-8000-0000000000bb', 'b9700000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');

-- Sol: Lara never answered and flies in two days; Tomás said no and flies tomorrow; Vera agreed, and a trip added
-- after it waits for her agreement again, in three days; Iara never answered and flies in a month; a draft flies
-- tomorrow. Mar: Rui never answered and flies in two days. Eli registered Lara.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone, draft, created_by)
values
  ('f9700000-0000-4000-8000-000000000001', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'Lara Teste', '1988-02-14', '5562999997101', false, 'a9700000-0000-4000-8000-000000000005'),
  ('f9700000-0000-4000-8000-000000000002', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'Tomas Teste', '1979-09-30', '5562999997102', false, null),
  ('f9700000-0000-4000-8000-000000000003', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'Vera Teste', '1970-10-10', '5562999997103', false, null),
  ('f9700000-0000-4000-8000-000000000004', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'Iara Teste', '1990-01-01', '5562999997104', false, null),
  ('f9700000-0000-4000-8000-000000000005', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'Passageiro em cadastro', '1991-01-01', '5562999997105', true, null),
  ('f9700000-0000-4000-8000-000000000006', 'd9700000-0000-4000-8000-0000000000bb', '97000000-0000-4000-8000-00000000000b',
   'b9700000-0000-4000-8000-00000000000b', 'Rui Teste', '1982-03-03', '5562999997106', false, null);
insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, wording, answer, phone) values
  ('d9700000-0000-4000-8000-0000000000aa', 'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000002',
   'f9700000-0000-4000-8000-000000000002', 'Concordo que a agência compartilhe os voos desta viagem.', 'declined', null),
  ('d9700000-0000-4000-8000-0000000000aa', 'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000003',
   'f9700000-0000-4000-8000-000000000003', 'Concordo que a agência compartilhe os voos desta viagem.', 'agreed', '5562999997103');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('19700000-0000-4000-8000-000000000001', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000001', 'SOL101'),
  ('19700000-0000-4000-8000-000000000002', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000002', 'SOL102'),
  ('19700000-0000-4000-8000-000000000003', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000003', 'SOL103'),
  ('19700000-0000-4000-8000-000000000004', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000004', 'SOL104'),
  ('19700000-0000-4000-8000-000000000005', 'd9700000-0000-4000-8000-0000000000aa', '97000000-0000-4000-8000-00000000000a',
   'b9700000-0000-4000-8000-00000000000a', 'f9700000-0000-4000-8000-000000000005', 'SOL105'),
  ('19700000-0000-4000-8000-000000000006', 'd9700000-0000-4000-8000-0000000000bb', '97000000-0000-4000-8000-00000000000b',
   'b9700000-0000-4000-8000-00000000000b', 'f9700000-0000-4000-8000-000000000006', 'MAR106');
insert into public.pax_trip_travelers (trip_id, traveler_id)
select t.id, t.holder_id from public.pax_trips t where t.id::text like '19700000-%';
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local)
select t.id, 1, 'LA' || (3000 + row_number() over (order by t.id))::text, 'GYN', 'GRU',
       date_trunc('minute', (now() at time zone 'America/Sao_Paulo')) + d.ahead,
       date_trunc('minute', (now() at time zone 'America/Sao_Paulo')) + d.ahead + interval '2 hours'
from public.pax_trips t
join (values ('19700000-0000-4000-8000-000000000001'::uuid, interval '2 days'),
             ('19700000-0000-4000-8000-000000000002'::uuid, interval '1 day'),
             ('19700000-0000-4000-8000-000000000003'::uuid, interval '3 days'),
             ('19700000-0000-4000-8000-000000000004'::uuid, interval '30 days'),
             ('19700000-0000-4000-8000-000000000005'::uuid, interval '1 day'),
             ('19700000-0000-4000-8000-000000000006'::uuid, interval '2 days')) as d (trip, ahead) on d.trip = t.id;

select pg_temp.sign_in('a9700000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('sol', public.pax_departing_unagreed('97000000-0000-4000-8000-00000000000a'));
reset role;
select is(
  (select jsonb_agg(e ->> 'full_name' order by ord) from res, jsonb_array_elements(res.payload -> 'travelers') with ordinality as x (e, ord)
   where res.name = 'sol'),
  '["Lara Teste", "Vera Teste"]'::jsonb,
  'the agency reads who flies in the next days with no agreement, the soonest first: never who said no, a far flight or a draft'
);
select ok(
  pg_temp.got('sol', 'days')::integer = 7
  and (select bool_and((e ->> 'reagree') is not distinct from (case e ->> 'full_name' when 'Vera Teste' then 'trip_waiting' end))
       from res, jsonb_array_elements(res.payload -> 'travelers') e where res.name = 'sol')
  and (select bool_and(e ->> 'link_until' is null) from res, jsonb_array_elements(res.payload -> 'travelers') e where res.name = 'sol'),
  'each with why the agreement is owed, and no link open yet'
);

select pg_temp.sign_in('a9700000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok(
  $$ select public.pax_departing_unagreed('97000000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'another agency never reads the first one''s passengers'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res select 'owed', jsonb_agg(jsonb_build_object('name', o.full_name, 'trip', o.trip_id, 'recipients', to_jsonb(o.recipients))
                                         order by o.departure, o.full_name)
from public.pax_unagreed_notices_owed(50) o where o.full_name in ('Lara Teste', 'Vera Teste', 'Rui Teste', 'Tomas Teste');
reset role;
select ok(
  (select payload @> '[{"name": "Lara Teste", "trip": "19700000-0000-4000-8000-000000000001",
                        "recipients": ["a9700000-0000-4000-8000-000000000004", "a9700000-0000-4000-8000-000000000005"]}]'::jsonb
          and payload @> '[{"name": "Vera Teste", "recipients": ["a9700000-0000-4000-8000-000000000004"]}]'::jsonb
          and payload @> '[{"name": "Rui Teste", "recipients": ["a9700000-0000-4000-8000-000000000006"]}]'::jsonb
          and not payload @> '[{"name": "Tomas Teste"}]'::jsonb
   from res where name = 'owed'),
  'the bell is owed once per trip to who manages each agency and who registered the passenger, never across agencies'
);

-- A partnership that ended tells nothing more.
update public.partner_links set status = 'ended', ended_at = now() where id = '97000000-0000-4000-8000-00000000000a';
select pg_temp.as_backend();
set local role service_role;
select ok(
  not exists (select 1 from public.pax_unagreed_notices_owed(50) o where o.full_name in ('Lara Teste', 'Vera Teste'))
  and exists (select 1 from public.pax_unagreed_notices_owed(50) o where o.full_name = 'Rui Teste'),
  'a partnership that ended is owed no reminder, and the other agency''s still is'
);
reset role;

select * from finish();
rollback;
