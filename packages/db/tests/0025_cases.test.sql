begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ============================================================
-- The core of the domain and the client's folder (0021, 0022).
--
-- A case is a firm's: opened, written and read by its people only, never from
-- a support visit. Its client reaches it through a link by token, which the
-- database knows only by its hash, and which writes only the client's own
-- data, the minors they answer for, the legs of the trip and the files they
-- send. Two firms: nothing of one reaches the other.
--
-- Every person, firm, CPF and case number here is invented (the numbers are
-- made by the rule itself).
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ab100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ab100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('ab100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ab100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'ab100000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia) and Bruno (atendimento). Firm B: Davi (owner, advogado).
insert into public.organizations (id, name, slug, created_by) values
  ('bb100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ab100000-0000-4000-8000-000000000001'),
  ('bb100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ab100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bb100000-0000-4000-8000-00000000000a', 'ab100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bb100000-0000-4000-8000-00000000000a', 'ab100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bb100000-0000-4000-8000-00000000000b', 'ab100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session text default null) returns void language sql as
$$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true);
$$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;

-- ---------- What every firm reads ----------

select ok(
  (select count(*) = 27 from public.courts where justice = 'estadual')
  and (select cnj_code = '09' and cnj_segment = '8' from public.courts where acronym = 'TJGO')
  and (select cnj_code = '26' from public.courts where acronym = 'TJSP')
  and (select count(*) > 3000 from public.airports)
  and (select uf = 'GO' and icao = 'SBGO' from public.airports where iata = 'GYN')
  and (select count(*) >= 40 from public.court_systems)
  and (select system = 'projudi' and not confirmed from public.court_systems where court = 'TJGO' and proceeding_kind = 'juizado'),
  'the 27 state courts with their code in the case number, the airports and the systems sampled from the DJEN, unconfirmed'
);
select ok(
  public.cnj_is_valid('50001010220998090051') and public.cnj_is_valid('10001014620998260100')
  and not public.cnj_is_valid('50001010120998090051') and not public.cnj_is_valid('5000101592026809005')
  and public.cpf_is_valid('12345678909') and not public.cpf_is_valid('12345678900') and not public.cpf_is_valid('11111111111'),
  'a case number and a CPF are checked by their own digits, the same rule as the app''s'
);

-- ---------- A case is opened ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('case_1', public.create_case('bb100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-10-06',
  '{"full_name": "  Maria   Teste ", "phone": "(62) 99999-0001", "cpf": "123.456.789-09"}'::jsonb, 'agency', 'Atraso de cinco horas.'));
insert into res values ('case_2', public.create_case('bb100000-0000-4000-8000-00000000000a', 'cancellation', null, null,
  '{"full_name": "Maria Teste", "cpf": "12345678909"}'::jsonb));
insert into res values ('case_bad_cpf', public.create_case('bb100000-0000-4000-8000-00000000000a', 'delay', 'G3', null,
  '{"full_name": "Pedro Teste", "cpf": "12345678900"}'::jsonb));
insert into res values ('case_bad_kind', public.create_case('bb100000-0000-4000-8000-00000000000a', 'atraso', 'G3', null,
  '{"full_name": "Pedro Teste"}'::jsonb));
insert into res values ('case_bad_airline', public.create_case('bb100000-0000-4000-8000-00000000000a', 'delay', 'ZZ', null,
  '{"full_name": "Pedro Teste"}'::jsonb));
select throws_ok(
  $$select public.create_case('bb100000-0000-4000-8000-00000000000b', 'delay', 'G3', null, '{"full_name": "Pedro Teste"}'::jsonb)$$,
  '42501', 'not_authorized',
  'nobody opens a case in another firm'
);
reset role;

select ok(
  pg_temp.got('case_1', 'seq') = '1' and pg_temp.got('case_2', 'seq') = '2'
  and (select full_name = 'Maria Teste' and phone = '5562999990001' and cpf = '12345678909' and updated_via = 'firm'
       from public.people where id = pg_temp.got('case_1', 'person_id')::uuid)
  and (select status = 'intake' and incident = 'delay' and airline_iata = 'G3' and origin = 'agency'
       from public.cases where id = pg_temp.got('case_1', 'case_id')::uuid),
  'a case gets the next number of the firm, and its client the data in the form the firm keeps (digits, the country in the phone)'
);
select is(
  pg_temp.got('case_2', 'person_id'), pg_temp.got('case_1', 'person_id'),
  'a client the firm already has, by CPF, is the same person in the next case'
);
select ok(
  pg_temp.got('case_bad_cpf', 'code') = 'invalid_cpf' and pg_temp.got('case_bad_cpf', 'field') = 'cpf'
  and pg_temp.got('case_bad_kind', 'code') = 'invalid_incident'
  and pg_temp.got('case_bad_airline', 'code') = 'unknown_airline'
  and (select count(*) = 2 from public.cases where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.people where full_name = 'Pedro Teste'),
  'a refused case leaves nothing behind, and says which field was wrong'
);
select ok(
  exists (select 1 from public.case_events where case_id = pg_temp.got('case_1', 'case_id')::uuid and kind = 'created' and actor_type = 'person')
  and exists (select 1 from public.audit_events where action = 'case.created' and entity_id = pg_temp.got('case_1', 'case_id')),
  'the opening is in the case''s timeline and in the audit trail'
);

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ab100000-0000-4000-8000-000000000009', 'ab100000-0000-4000-8000-000000000002', 'bb100000-0000-4000-8000-00000000000a',
        'Conferindo os casos', 'fb100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.create_case('bb100000-0000-4000-8000-00000000000a', 'delay', 'G3', null, '{"full_name": "Do Suporte"}'::jsonb)$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit opens no case'
);
select throws_ok(
  format($$select public.update_case(%L, '{"summary": "Do suporte."}'::jsonb)$$, pg_temp.got('case_1', 'case_id')),
  '42501', 'not_allowed_in_support_session',
  'nor writes to one'
);
reset role;

-- ---------- Firm B never reaches it ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.cases), 0, 'a person of firm B reads no case of firm A');
select is((select count(*)::int from public.people), 0, 'nor its clients');
select throws_ok(
  format($$select public.update_case(%L, '{"summary": "Da firma B."}'::jsonb)$$, pg_temp.got('case_1', 'case_id')),
  'P0002', 'case_not_found',
  'and a case of firm A is, for firm B, a case that does not exist'
);
reset role;

-- ---------- The firm writes the case ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('upd', public.update_case(pg_temp.got('case_1', 'case_id')::uuid,
  '{"cause": "internal", "responsible_id": "ab100000-0000-4000-8000-000000000002"}'::jsonb));
insert into res values ('upd_outsider', public.update_case(pg_temp.got('case_1', 'case_id')::uuid,
  '{"responsible_id": "ab100000-0000-4000-8000-000000000004"}'::jsonb));
insert into res values ('status_docs', public.set_case_status(pg_temp.got('case_1', 'case_id')::uuid, 'documents'));
insert into res values ('decline_short', public.set_case_status(pg_temp.got('case_2', 'case_id')::uuid, 'declined', 'curto'));

-- A family: Maria answers for her son, who flew with her.
insert into res values ('guardian', public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('case_1', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor', public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"full_name": "Joao Teste", "birth_date": "2015-03-10", "cpf": "98765432100"}'::jsonb, 'claimant',
  pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('bad_date', public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('minor', 'person_id')::uuid, '{"birth_date": "2015-02-30"}'::jsonb));
insert into res values ('cpf_twice', public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('minor', 'person_id')::uuid, '{"cpf": "12345678909"}'::jsonb));
insert into res values ('stray_field', public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('minor', 'person_id')::uuid, '{"is_superadmin": "true"}'::jsonb));
reset role;

select ok(
  pg_temp.got('upd', 'code') = 'saved' and pg_temp.got('upd_outsider', 'code') = 'not_a_member'
  and (select cause = 'internal' and responsible_id = 'ab100000-0000-4000-8000-000000000002' and status = 'documents'
       from public.cases where id = pg_temp.got('case_1', 'case_id')::uuid)
  and pg_temp.got('decline_short', 'code') = 'reason_required',
  'the firm changes what a case is about and where it stands; declining it takes a reason, and only a colleague is made responsible'
);
select ok(
  (select role = 'claimant' and guardian_id = pg_temp.got('guardian', 'party_id')::uuid
   from public.case_parties where id = pg_temp.got('minor', 'party_id')::uuid)
  and pg_temp.got('bad_date', 'code') = 'invalid_birth_date'
  and pg_temp.got('cpf_twice', 'code') = 'cpf_in_use'
  and pg_temp.got('stray_field', 'code') = 'unknown_field',
  'a minor claimant has the guardian who answers for them, and a field that is not a person''s field is refused'
);

-- ---------- The legs of the trip ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('leg_1', public.save_flight_segment(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"flight_number": "g3 01234", "origin_iata": "gyn", "destination_iata": "GRU",
    "scheduled_arrival_local": "2026-10-06T14:30", "actual_arrival_local": "2026-10-06 19:05",
    "booking_reference": "abc 123", "affected": true}'::jsonb));
insert into res values ('leg_unknown', public.save_flight_segment(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"origin_iata": "XQZ"}'::jsonb));
insert into res values ('leg_same', public.save_flight_segment(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('leg_1', 'segment_id')::uuid, '{"destination_iata": "GYN"}'::jsonb));
insert into res values ('leg_flight', public.save_flight_segment(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('leg_1', 'segment_id')::uuid, '{"flight_number": "22 123"}'::jsonb));
reset role;

select ok(
  (select flight_number = 'G31234' and origin_iata = 'GYN' and destination_iata = 'GRU'
          and scheduled_arrival_local = timestamp '2026-10-06 14:30' and actual_arrival_local = timestamp '2026-10-06 19:05'
          and booking_reference = 'ABC123' and affected and source = 'firm'
   from public.flight_segments where id = pg_temp.got('leg_1', 'segment_id')::uuid)
  and pg_temp.got('leg_unknown', 'code') = 'unknown_airport'
  and pg_temp.got('leg_same', 'code') = 'same_airport'
  and pg_temp.got('leg_flight', 'code') = 'invalid_flight_number'
  and (select count(*) = 1 from public.flight_segments where case_id = pg_temp.got('case_1', 'case_id')::uuid),
  'a leg is kept as the ticket prints it, in local time, with the flight and the codes normalized; one that cannot exist is refused'
);

-- ---------- The lawsuits ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('proc_bad_cnj', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "cnj": "5000101-01.2099.8.09.0051"}'::jsonb));
insert into res values ('proc_other_court', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "cnj": "1000101-46.2099.8.26.0100"}'::jsonb));
insert into res values ('proc_no_reason', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "forum_basis": "event_place", "forum_reason": "voo"}'::jsonb));
insert into res values ('proc_not_lawyer', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO"}'::jsonb, null, array['ab100000-0000-4000-8000-000000000002']::uuid[]));
insert into res values ('proc_minor_parties', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO"}'::jsonb, array[pg_temp.got('guardian', 'party_id')::uuid]));
insert into res values ('proc_adult', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile",
    "cnj": "5000101-02.2099.8.09.0051", "status": "filed", "filed_at": "2026-10-08", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case_1', 'party_id')::uuid], array['ab100000-0000-4000-8000-000000000001']::uuid[]));
insert into res values ('proc_minor', public.save_proceeding(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "forum_basis": "domicile"}'::jsonb, array[pg_temp.got('minor', 'party_id')::uuid]));
insert into res values ('proc_same_number', public.save_proceeding(pg_temp.got('case_2', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "cnj": "50001010220998090051", "status": "filed"}'::jsonb));
insert into res values ('remove_filed', public.remove_proceeding(pg_temp.got('proc_adult', 'proceeding_id')::uuid));
insert into res values ('remove_planned', public.remove_proceeding(pg_temp.got('proc_minor', 'proceeding_id')::uuid));
reset role;

select ok(
  pg_temp.got('proc_bad_cnj', 'code') = 'invalid_cnj'
  and pg_temp.got('proc_other_court', 'code') = 'cnj_of_another_court'
  and pg_temp.got('proc_no_reason', 'code') = 'forum_reason_required'
  and pg_temp.got('proc_not_lawyer', 'code') = 'not_a_lawyer'
  and pg_temp.got('proc_minor_parties', 'code') = 'party_not_found'
  and pg_temp.got('proc_same_number', 'code') = 'cnj_in_use',
  'a lawsuit''s number must be right and of its court; another forum than the domicile takes a reason; its lawyers sign and its parties claim'
);
select ok(
  (select cnj = '50001010220998090051' and status = 'filed' and kind = 'juizado' and system = 'projudi'
   from public.proceedings where id = pg_temp.got('proc_adult', 'proceeding_id')::uuid)
  and (select count(*) = 1 from public.proceeding_lawyers where proceeding_id = pg_temp.got('proc_adult', 'proceeding_id')::uuid)
  and pg_temp.got('remove_filed', 'code') = 'already_filed'
  and pg_temp.got('remove_planned', 'code') = 'removed',
  'one case, two lawsuits: the adults in the small-claims court, the minor in the civil one; only a planned one is removed'
);

-- ---------- The client's link ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('link_minor', public.create_client_link(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('minor', 'person_id')::uuid, pg_temp.hash('token-do-menor-1234567890')));
insert into res values ('link_old', public.create_client_link(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('case_1', 'person_id')::uuid, pg_temp.hash('token-antigo-da-maria-1234567890')));
insert into res values ('link', public.create_client_link(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('case_1', 'person_id')::uuid, pg_temp.hash('token-da-maria-1234567890')));
reset role;

select ok(
  pg_temp.got('link_minor', 'code') = 'minor_cannot_receive'
  and (select revoked_at is not null from public.client_links where id = pg_temp.got('link_old', 'link_id')::uuid)
  and (select revoked_at is null and expires_at > now() + interval '29 days' and token_hash = pg_temp.hash('token-da-maria-1234567890')
       from public.client_links where id = pg_temp.got('link', 'link_id')::uuid),
  'a link is for the adult who answers, its token is kept only as its hash, and a new one ends the one before'
);

select pg_temp.as_client();
set local role anon;
insert into res values ('open_wrong', public.client_link_open('token-que-nao-existe'));
insert into res values ('open_old', public.client_link_open('token-antigo-da-maria-1234567890'));
insert into res values ('open', public.client_link_open('token-da-maria-1234567890'));
-- Read again right away (the page does after each save): the same visit.
insert into res values ('open_twice', public.client_link_open('token-da-maria-1234567890'));
select throws_ok(
  $$select count(*) from public.cases$$,
  '42501', null,
  'the client reads nothing directly: only what their link answers'
);
reset role;

select ok(
  (select payload = '{"found": false}'::jsonb from res where name = 'open_wrong')
  and (select payload ->> 'status' = 'revoked' and payload ->> 'firm' = 'Souza Advogados' and not payload ? 'people'
       from res where name = 'open_old'),
  'a token that opens nothing says so and nothing else, and an ended link shows only whose it was'
);
select ok(
  (select payload ->> 'status' = 'open' and payload ->> 'firm' = 'Souza Advogados'
          and payload -> 'case' ->> 'seq' = '1' and payload -> 'case' -> 'airline' ->> 'name' = 'Gol'
          and (payload -> 'case' ->> 'editable')::boolean
          and jsonb_array_length(payload -> 'people') = 2
          and payload -> 'people' -> 0 ->> 'full_name' = 'Maria Teste'
          and payload -> 'people' -> 0 -> 'roles' = '["claimant", "guardian"]'::jsonb
          and (payload -> 'people' -> 0 ->> 'is_holder')::boolean
          and payload -> 'people' -> 1 ->> 'full_name' = 'Joao Teste'
          and jsonb_array_length(payload -> 'segments') = 1
          and jsonb_array_length(payload -> 'required_documents') = 3
   from res where name = 'open')
  and (select opened_count = 1 from public.client_links where id = pg_temp.got('link', 'link_id')::uuid),
  'an open link shows the firm, the case, the client and the minor they answer for, the trip and what is needed, and two readings in a row are one visit'
);

-- The client writes.
select pg_temp.as_client();
set local role anon;
insert into res values ('client_saves', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('case_1', 'person_id')::uuid,
  '{"marital_status": "casado", "profession": "Professora", "postal_code": "74000-000", "street": "Rua Teste",
    "address_number": "10", "district": "Centro", "city": "Goiânia", "uf": "go", "nationality": "brasileira"}'::jsonb));
insert into res values ('client_child', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('minor', 'person_id')::uuid, '{"full_name": "Joao Teste Filho"}'::jsonb));
insert into res values ('client_stranger', public.client_link_save_person('token-da-maria-1234567890',
  'ab900000-0000-4000-8000-000000000001'::uuid, '{"full_name": "Outro"}'::jsonb));
insert into res values ('client_adds', public.client_link_add_dependent('token-da-maria-1234567890',
  '{"full_name": "Ana Teste Filha", "birth_date": "2018-07-01"}'::jsonb));
insert into res values ('client_leg', public.client_link_save_segment('token-da-maria-1234567890', null,
  '{"flight_number": "G3 1300", "origin_iata": "GRU", "destination_iata": "REC"}'::jsonb));
insert into res values ('client_edits_firm_leg', public.client_link_save_segment('token-da-maria-1234567890',
  pg_temp.got('leg_1', 'segment_id')::uuid, '{"affected": false}'::jsonb));
insert into res values ('client_removes_firm_leg', public.client_link_remove_segment('token-da-maria-1234567890',
  pg_temp.got('leg_1', 'segment_id')::uuid));
insert into res values ('client_old_link', public.client_link_save_person('token-antigo-da-maria-1234567890',
  pg_temp.got('case_1', 'person_id')::uuid, '{"profession": "Outra"}'::jsonb));
reset role;

select ok(
  pg_temp.got('client_saves', 'code') = 'saved'
  and (select marital_status = 'casado' and postal_code = '74000000' and uf = 'GO' and updated_via = 'client'
       from public.people where id = pg_temp.got('case_1', 'person_id')::uuid)
  and pg_temp.got('client_child', 'code') = 'saved'
  and pg_temp.got('client_stranger', 'code') = 'person_not_found'
  and pg_temp.got('client_old_link', 'code') = 'link_not_open',
  'the client writes their own data and their child''s, nobody else''s, and never through an ended link'
);
select ok(
  pg_temp.got('client_adds', 'code') = 'added'
  and (select cp.role = 'claimant' and g.person_id = pg_temp.got('case_1', 'person_id')::uuid
       from public.case_parties cp join public.case_parties g on g.id = cp.guardian_id
       where cp.id = pg_temp.got('client_adds', 'party_id')::uuid)
  and pg_temp.got('client_leg', 'code') = 'saved'
  and (select source = 'client' and flight_number = 'G31300' from public.flight_segments
       where id = pg_temp.got('client_leg', 'segment_id')::uuid)
  and pg_temp.got('client_removes_firm_leg', 'code') = 'segment_not_found',
  'the client adds the other child who flew with them and the leg they know, and cannot remove what the firm wrote'
);
select ok(
  pg_temp.got('client_edits_firm_leg', 'code') = 'saved'
  and (select source = 'firm' and not affected from public.flight_segments where id = pg_temp.got('leg_1', 'segment_id')::uuid),
  'a leg the firm wrote stays the firm''s when the client corrects it, so the client cannot remove it after'
);

-- A link tries only so many CPFs: one already in the firm is refused, and the refusal counts.
update public.platform_settings set value = jsonb_set(value, '{client_link_cpf_attempts}', '2') where key = 'cases';
select pg_temp.as_client();
set local role anon;
insert into res values ('cpf_try_new', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('minor', 'person_id')::uuid, '{"cpf": "714.602.380-01"}'::jsonb));
-- Refused for another field: the CPF was not written, and it does not count.
insert into res values ('cpf_try_bad_email', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('client_adds', 'person_id')::uuid, '{"cpf": "853.513.468-93", "email": "sem-arroba"}'::jsonb));
insert into res values ('cpf_try_taken', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('client_adds', 'person_id')::uuid, '{"cpf": "123.456.789-09"}'::jsonb));
insert into res values ('cpf_try_more', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('client_adds', 'person_id')::uuid, '{"cpf": "853.513.468-93"}'::jsonb));
insert into res values ('cpf_try_same', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('minor', 'person_id')::uuid, '{"cpf": "71460238001", "full_name": "Joao Teste Filho"}'::jsonb));
reset role;
update public.platform_settings set value = jsonb_set(value, '{client_link_cpf_attempts}', '12') where key = 'cases';
select ok(
  pg_temp.got('cpf_try_new', 'code') = 'saved'
  and pg_temp.got('cpf_try_bad_email', 'code') = 'invalid_email'
  and pg_temp.got('cpf_try_taken', 'code') = 'cpf_in_use'
  and pg_temp.got('cpf_try_more', 'code') = 'too_many_attempts' and pg_temp.got('cpf_try_more', 'field') = 'cpf'
  and pg_temp.got('cpf_try_same', 'code') = 'saved'
  and (select cpf_attempts = 2 from public.client_links where id = pg_temp.got('link', 'link_id')::uuid)
  and (select cpf is null from public.people where id = pg_temp.got('client_adds', 'person_id')::uuid),
  'a link writes only as many CPFs as the setting allows, counting those written and those refused as another client''s, so it cannot test who the firm''s clients are'
);
select ok(
  exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
          and e.kind = 'client_person_saved' and e.actor_type = 'client' and e.data -> 'fields' ? 'profession'
          and not e.data::text like '%Professora%')
  and exists (select 1 from public.audit_events a where a.action = 'case.client_person_saved' and a.actor_type = 'client'),
  'what the client wrote is in the timeline as theirs, by the names of the fields, never by what they typed'
);

-- The client sends a file.
select pg_temp.as_client();
set local role anon;
insert into res values ('reserve', public.client_link_reserve_upload('token-da-maria-1234567890', 'identity',
  pg_temp.got('case_1', 'party_id')::uuid, 'rg-maria.pdf', 'application/pdf', 120000));
insert into res values ('reserve_exe', public.client_link_reserve_upload('token-da-maria-1234567890', 'identity',
  null, 'programa.exe', 'application/x-msdownload', 1000));
insert into res values ('reserve_contract', public.client_link_reserve_upload('token-da-maria-1234567890', 'contract',
  null, 'contrato.pdf', 'application/pdf', 1000));
insert into res values ('reserve_late', public.client_link_reserve_upload('token-da-maria-1234567890', 'ticket',
  null, 'bilhete.pdf', 'application/pdf', 5000));
insert into res values ('finish_early', public.client_link_finish_upload('token-da-maria-1234567890',
  pg_temp.got('reserve', 'document_id')::uuid));
reset role;

select ok(
  pg_temp.got('reserve', 'code') = 'reserved'
  and (select purpose = 'client' and status = 'reserved' and storage_path like 'org/bb100000-0000-4000-8000-00000000000a/client/%'
       from public.files where id = pg_temp.got('reserve', 'file_id')::uuid)
  and (select status = 'uploading' and source = 'client' from public.case_documents where id = pg_temp.got('reserve', 'document_id')::uuid)
  and pg_temp.got('reserve_exe', 'code') = 'type_not_allowed'
  and pg_temp.got('reserve_contract', 'code') = 'invalid_kind'
  and pg_temp.got('finish_early', 'code') = 'not_uploaded',
  'a file the client sends is reserved in the firm''s files, of a type the purpose takes, and counts only once it arrived'
);

-- The backend measured it: kept.
select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('reserve', 'file_id')::uuid, repeat('e', 64), 120000, 'application/pdf', 2);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('finish', public.client_link_finish_upload('token-da-maria-1234567890',
  pg_temp.got('reserve', 'document_id')::uuid));
insert into res values ('done', public.client_link_finish('token-da-maria-1234567890'));
reset role;

select ok(
  pg_temp.got('finish', 'code') = 'received'
  and (select status = 'received' from public.case_documents where id = pg_temp.got('reserve', 'document_id')::uuid)
  and (select upload_count = 2 and finished_at is not null from public.client_links where id = pg_temp.got('link', 'link_id')::uuid),
  'what the backend kept becomes a document the firm receives; every reservation counts against the link''s ceiling'
);

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today', public.firm_today('bb100000-0000-4000-8000-00000000000a'));
insert into res values ('reject_short', public.decide_case_document(pg_temp.got('reserve', 'document_id')::uuid, 'rejected', 'x'));
insert into res values ('reject', public.decide_case_document(pg_temp.got('reserve', 'document_id')::uuid, 'rejected', 'Ilegível'));
reset role;

select ok(
  pg_temp.got('today', 'documents_to_review') = '1' and pg_temp.got('today', 'clients_finished') = '1'
  and pg_temp.got('reject_short', 'code') = 'reason_required'
  and pg_temp.got('reject', 'code') = 'rejected',
  'the home counts the document to review and the client who finished; refusing a document takes a reason'
);

-- The firm adds its own papers to the whole case.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('firm_file', public.reserve_file('bb100000-0000-4000-8000-00000000000a', 'upload', 'contrato-assinado.pdf',
  'application/pdf', 4000, 'ab100000-0000-4000-8000-000000000001'));
select public.confirm_file(pg_temp.got('firm_file', 'file_id')::uuid, repeat('f', 64), 4000, 'application/pdf', 1);
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm_contract', public.attach_case_document(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('firm_file', 'file_id')::uuid, 'contract'));
reset role;

select pg_temp.as_client();
set local role anon;
insert into res values ('open_again', public.client_link_open('token-da-maria-1234567890'));
reset role;
select ok(
  (select payload -> 'documents' -> 0 ->> 'status' = 'rejected' and payload -> 'documents' -> 0 ->> 'rejected_reason' = 'Ilegível'
          and payload -> 'documents' -> 0 ->> 'name' = 'rg-maria.pdf'
   from res where name = 'open_again'),
  'the client reads what the firm said of their file, and can send it again'
);
select ok(
  pg_temp.got('firm_contract', 'code') = 'attached'
  and (select jsonb_array_length(payload -> 'documents') = 1 from res where name = 'open_again'),
  'the firm''s own papers of the case never reach the client''s page'
);

-- A case that moved on takes nothing more from the client; one that is closed gives no new link.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_case_status(pg_temp.got('case_1', 'case_id')::uuid, 'drafting');
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('after_drafting', public.client_link_save_person('token-da-maria-1234567890',
  pg_temp.got('case_1', 'person_id')::uuid, '{"profession": "Outra"}'::jsonb));
insert into res values ('open_drafting', public.client_link_open('token-da-maria-1234567890'));
reset role;
select ok(
  pg_temp.got('after_drafting', 'code') = 'case_not_editable'
  and (select not (payload -> 'case' ->> 'editable')::boolean from res where name = 'open_drafting'),
  'once the firm is preparing the case, the link still shows it and takes nothing more'
);

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('declined', public.set_case_status(pg_temp.got('case_2', 'case_id')::uuid, 'declined', 'Sem direito a indenização.'));
insert into res values ('link_closed', public.create_client_link(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('case_2', 'person_id')::uuid, pg_temp.hash('token-de-caso-encerrado-1234567890')));
insert into res values ('revoke', public.revoke_client_link(pg_temp.got('link', 'link_id')::uuid));
reset role;
select ok(
  pg_temp.got('declined', 'code') = 'saved'
  and (select closed_at is not null and close_reason = 'Sem direito a indenização.' from public.cases where id = pg_temp.got('case_2', 'case_id')::uuid)
  and pg_temp.got('link_closed', 'code') = 'case_closed'
  and pg_temp.got('revoke', 'code') = 'revoked',
  'a declined case keeps its reason and gives no new link; the firm ends a link when it wants'
);

select pg_temp.as_client();
set local role anon;
insert into res values ('open_revoked', public.client_link_open('token-da-maria-1234567890'));
reset role;
update public.client_links set revoked_at = null, expires_at = now() - interval '1 minute'
where id = pg_temp.got('link', 'link_id')::uuid;
select pg_temp.as_client();
set local role anon;
insert into res values ('open_expired', public.client_link_open('token-da-maria-1234567890'));
reset role;
select ok(
  pg_temp.got('open_revoked', 'status') = 'revoked' and pg_temp.got('open_expired', 'status') = 'expired',
  'a link ended by the firm, or by its time, says so'
);

select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('reserve_late', 'file_id')::uuid, repeat('d', 64), 5000, 'application/pdf', 1);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('finish_late', public.client_link_finish_upload('token-da-maria-1234567890',
  pg_temp.got('reserve_late', 'document_id')::uuid));
reset role;

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('pedro', public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid, null,
  '{"full_name": "Pedro Teste", "birth_date": "1979-05-05"}'::jsonb, 'claimant'));
insert into res values ('pedro_link', public.create_client_link(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('pedro', 'person_id')::uuid, pg_temp.hash('token-do-pedro-1234567890')));
reset role;
-- Pedro had sent his identity through his link.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('pedro_file', public.reserve_file('bb100000-0000-4000-8000-00000000000a', 'client', 'rg-pedro.pdf',
  'application/pdf', 3000, null));
select public.confirm_file(pg_temp.got('pedro_file', 'file_id')::uuid, repeat('c', 64), 3000, 'application/pdf', 1);
reset role;
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, link_id, status)
values ('bb100000-0000-4000-8000-00000000000a', pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('pedro', 'party_id')::uuid,
        pg_temp.got('pedro_file', 'file_id')::uuid, 'identity', 'client', pg_temp.got('pedro_link', 'link_id')::uuid, 'received');
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('pedro_out', public.remove_case_party(pg_temp.got('pedro', 'party_id')::uuid));
insert into res values ('maria_new_link', public.create_client_link(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('case_1', 'person_id')::uuid, pg_temp.hash('token-novo-da-maria-1234567890')));
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('pedro_open', public.client_link_open('token-do-pedro-1234567890'));
insert into res values ('maria_new_open', public.client_link_open('token-novo-da-maria-1234567890'));
reset role;

select ok(
  pg_temp.got('finish_late', 'code') = 'received'
  and (select status = 'received' from public.case_documents where id = pg_temp.got('reserve_late', 'document_id')::uuid),
  'a file reserved while the link was open is finished after it ended, so the firm sees it'
);
select ok(
  pg_temp.got('pedro_out', 'code') = 'removed'
  and (select revoked_at is not null from public.client_links where id = pg_temp.got('pedro_link', 'link_id')::uuid)
  and pg_temp.got('pedro_open', 'status') = 'revoked'
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'client_link_revoked' and e.data ->> 'why' = 'party_removed'),
  'a person taken out of the case loses their link with it, and the timeline says so'
);
select ok(
  (select payload ->> 'status' = 'open'
          and not payload::text like '%rg-pedro.pdf%'
          and payload::text like '%bilhete.pdf%'
   from res where name = 'maria_new_open'),
  'what a person taken out of the case had sent reaches no other link; the trip''s papers are everybody''s in it'
);

-- ---------- The CPF lookup ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cpf_no_birth', public.begin_cpf_check(pg_temp.got('case_1', 'person_id')::uuid));
select public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('case_1', 'person_id')::uuid,
  '{"birth_date": "1980-01-01"}'::jsonb);
insert into res values ('cpf_begin', public.begin_cpf_check(pg_temp.got('case_1', 'person_id')::uuid));
insert into res values ('cpf_no_cpf', public.begin_cpf_check(pg_temp.got('client_adds', 'person_id')::uuid));
insert into res values ('cpf_minor', public.begin_cpf_check(pg_temp.got('minor', 'person_id')::uuid));
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('cpf_other_firm', public.begin_cpf_check(pg_temp.got('case_1', 'person_id')::uuid));
reset role;

select ok(
  pg_temp.got('cpf_no_birth', 'code') = 'birth_date_missing'
  and pg_temp.got('cpf_begin', 'cpf') = '12345678909' and pg_temp.got('cpf_begin', 'birth_date') = '1980-01-01'
  and pg_temp.got('cpf_no_cpf', 'code') = 'cpf_missing' and pg_temp.got('cpf_minor', 'code') = 'minor'
  and pg_temp.got('cpf_other_firm', 'code') = 'not_found',
  'a lookup is asked by somebody of the client''s firm, for an adult with a CPF and a birth date: the registry answers for the pair'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('cpf_recorded', public.record_cpf_check('bb100000-0000-4000-8000-00000000000a',
  pg_temp.got('case_1', 'person_id')::uuid, '12345678909', date '1980-01-01', 'found', 'MARIA TESTE', 'Regular', true));
insert into res values ('cpf_stale', public.record_cpf_check('bb100000-0000-4000-8000-00000000000a',
  pg_temp.got('case_1', 'person_id')::uuid, '98765432100', date '1980-01-01', 'found', 'OUTRA PESSOA', 'Regular', true));
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.record_cpf_check('bb100000-0000-4000-8000-00000000000a', %L, '12345678909', date '1980-01-01', 'found')$$, pg_temp.got('case_1', 'person_id')),
  '42501', null,
  'only the backend records what the registry answered'
);
reset role;

select ok(
  (select cpf_registry_regular and cpf_name_matches and cpf_registry_situation = 'Regular' and cpf_checked_at is not null
          and cpf_registry_result = 'found'
   from public.people where id = pg_temp.got('case_1', 'person_id')::uuid)
  and pg_temp.got('cpf_stale', 'code') = 'data_changed'
  and (select metadata = '{"result": "found", "regular": true, "name_matches": true}'::jsonb
       from public.audit_events where action = 'identity.cpf_checked' limit 1),
  'the answer is kept with the person, compared with the name the firm has, and the trail holds no CPF and no name'
);

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('case_1', 'person_id')::uuid,
  '{"full_name": "Maria Teste Souza"}'::jsonb);
insert into res values ('after_name', (select to_jsonb(p) from public.people p where p.id = pg_temp.got('case_1', 'person_id')::uuid));
select public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('case_1', 'person_id')::uuid,
  '{"birth_date": "1980-01-02"}'::jsonb);
insert into res values ('after_birth', (select to_jsonb(p) from public.people p where p.id = pg_temp.got('case_1', 'person_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('cpf_mismatch', public.record_cpf_check('bb100000-0000-4000-8000-00000000000a',
  pg_temp.got('case_1', 'person_id')::uuid, '12345678909', date '1980-01-02', 'birth_date_mismatch'));
reset role;
select ok(
  pg_temp.got('after_name', 'cpf_registry_result') = 'found' and pg_temp.got('after_name', 'cpf_name_matches') = 'false'
  and pg_temp.got('after_birth', 'cpf_registry_result') is null and pg_temp.got('after_birth', 'cpf_checked_at') is null
  and pg_temp.got('cpf_mismatch', 'result') = 'birth_date_mismatch'
  and (select cpf_registry_result = 'birth_date_mismatch' and cpf_registry_situation is null and cpf_registry_regular is null
       from public.people where id = pg_temp.got('case_1', 'person_id')::uuid),
  'a new name is compared again with the registry''s, a new birth date wipes the answer, and a refusal is kept as what it is'
);

-- A new CPF wipes what the registry said of the old one.
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_case_person(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('case_1', 'person_id')::uuid,
  '{"cpf": "111.222.333-96"}'::jsonb);
reset role;
select ok(
  (select cpf = '11122233396' and cpf_checked_at is null and cpf_registry_name is null and cpf_name_matches is null
          and cpf_registry_result is null
   from public.people where id = pg_temp.got('case_1', 'person_id')::uuid),
  'what the registry said of an old CPF says nothing of a new one'
);

update public.platform_settings set value = jsonb_set(value, '{cpf_checks_per_day}', '1') where key = 'cases';
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  public.begin_cpf_check(pg_temp.got('case_1', 'person_id')::uuid) ->> 'code', 'daily_limit',
  'and a firm makes only as many lookups a day as the setting allows'
);
reset role;

-- ---------- What only the operator changes ----------

select pg_temp.sign_in('ab100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_set_court_system('TJGO', 'juizado', 'eproc', null, null, 'tentativa de uma firma', null, true)$$,
  '42501', 'not_authorized',
  'a firm does not change which system a court uses'
);
reset role;
select pg_temp.sign_in('ab100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('admin_system', public.admin_set_court_system('TJGO', 'juizado', 'projudi', date '2008-01-01', 6291456,
  'Teste do posto de protocolo em 2026-10-09', 'Arquivos de 30 páginas ou mais: até 6 MB.', true));
insert into res values ('admin_airline', public.admin_set_airline('G3', 'Gol', 'BR', 'Empresa Teste de Aviação', '11222333000181', true));
insert into res values ('admin_no_source', public.admin_set_court_system('TJGO', 'comum', 'projudi', null, null, 'curto', null, true));
reset role;
select ok(
  pg_temp.got('admin_system', 'code') = 'saved'
  and (select confirmed and max_file_bytes = 6291456 and updated_by = 'ab100000-0000-4000-8000-000000000009'
       from public.court_systems where court = 'TJGO' and proceeding_kind = 'juizado')
  and (select legal_name = 'Empresa Teste de Aviação' and cnpj = '11222333000181' from public.airlines where iata = 'G3')
  and pg_temp.got('admin_no_source', 'code') = 'source_required',
  'the operator confirms a court''s system with its source, and names an airline''s legal entity'
);

-- ---------- The firm that goes takes its cases ----------

select set_config('request.jwt.claims', '', true);
delete from public.organizations where id = 'bb100000-0000-4000-8000-00000000000a';
select ok(
  not exists (select 1 from public.cases where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.people where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.client_links where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.case_documents where org_id = 'bb100000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.airlines where iata = 'G3'),
  'deleting a firm removes its clients, cases, links and documents, and none of the reference data'
);

select * from finish();
rollback;
