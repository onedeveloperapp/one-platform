begin;
create extension if not exists pgtap;
select plan(17);

-- ============================================================
-- What the rules of the domain need from the database (0025), and the rules
-- checked where a lawsuit is written (save_proceeding, 0022): the minimum
-- wage, what each claimant asks, the forum at the domicile or linked to the
-- flight, no minor in the small-claims court, the Tema 1.417 triage (the
-- cause and the decision a person's, the triage the backend's), the weather
-- kept as evidence, the lawsuits the rules plan and the count of causes per
-- state. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('be100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ae100000-0000-4000-8000-000000000001'),
  ('be100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ae100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('be100000-0000-4000-8000-00000000000b', 'ae100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- Firm A: Maria (an adult of Goiânia), the guardian she is, her son (a minor) and a child whose birth date nobody
-- wrote yet, on a flight from Goiânia to Guarulhos. A second case of another family, with no lawsuit.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('be100000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "city": "Goiânia", "uf": "GO"}'::jsonb));
insert into res values ('guardian', public.save_case_person(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Joao Teste", "birth_date": "2015-03-10"}'::jsonb, 'claimant', pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('undated', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Lia Teste"}'::jsonb, 'claimant', pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('segment', public.save_flight_segment(pg_temp.got('case', 'case_id')::uuid, null,
  '{"flight_number": "G3 1234", "origin_iata": "GYN", "destination_iata": "GRU", "scheduled_departure_local": "2026-09-20T08:00"}'::jsonb));
insert into res values ('case_2', public.create_case('be100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-22',
  '{"full_name": "Carla Teste", "birth_date": "1990-01-15", "city": "Goiânia", "uf": "GO"}'::jsonb));
insert into res values ('guardian_2', public.save_case_person(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('case_2', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor_2', public.save_case_person(pg_temp.got('case_2', 'case_id')::uuid, null,
  '{"full_name": "Nina Teste", "birth_date": "2016-06-01"}'::jsonb, 'claimant', pg_temp.got('guardian_2', 'party_id')::uuid));
reset role;

select ok(
  (select count(*) >= 6 from public.minimum_wages)
  and (select cents from public.minimum_wages where valid_from <= date '2023-04-30' order by valid_from desc limit 1) = 130200
  and (select cents from public.minimum_wages where valid_from <= date '2026-10-09' order by valid_from desc limit 1) = 162100
  and (select (value ->> 'ceiling_minimum_wages')::integer from public.platform_settings where key = 'small_claims') = 40,
  'the minimum wage in force on a day is read from its acts, and the ceiling of the small-claims court is a setting'
);

select ok(
  (select utc_offset_minutes from public.airports where iata = 'GYN') = -180
  and (select utc_offset_minutes from public.airports where iata = 'MAO') = -240
  and (select utc_offset_minutes from public.airports where iata = 'RBR') = -300
  and (select utc_offset_minutes from public.airports where iata = 'TBT') = -240
  and (select utc_offset_minutes from public.airports where iata = 'FEN') = -120
  and (select municipality from public.airports where iata = 'GRU') = 'Guarulhos'
  and (select utc_offset_minutes is null from public.airports where country <> 'BR' limit 1),
  'each Brazilian airport knows the offset of its local time, and the municipality it sits in when it is not the city it serves'
);

-- ---------- What each claimant asks ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('claim', public.set_party_claim(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, 1000000));
insert into res values ('claim_guardian', public.set_party_claim(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('guardian', 'party_id')::uuid, 1000000));
insert into res values ('claim_zero', public.set_party_claim(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, 0));
reset role;

select ok(
  pg_temp.got('claim', 'code') = 'saved'
  and pg_temp.got('claim_guardian', 'code') = 'party_not_found'
  and pg_temp.got('claim_zero', 'code') = 'invalid_amount'
  and (select claim_cents from public.case_parties where id = pg_temp.got('case', 'party_id')::uuid) = 1000000,
  'what a claimant asks is set in centavos, only for a claimant'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.set_party_claim(%L, %L, 500000)', pg_temp.got('case', 'case_id'), pg_temp.got('case', 'party_id')),
  'P0002', null,
  'another firm cannot set what a claimant of this one asks'
);
-- Nor learn, from the answer about a lawsuit of its own case, whether somebody of another firm is a minor.
insert into res values ('case_b', public.create_case('be100000-0000-4000-8000-00000000000b', 'delay', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('probe', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado"}'::jsonb, array[pg_temp.got('minor', 'party_id')::uuid]));
reset role;

-- ---------- The forum and the kind, where a lawsuit is written ----------

-- Both families were split by a lawyer's choice (0025): what follows checks each lawsuit's own court and forum.
-- What happens with the family together, the default, is the test of the civil court (0044).
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'split', 'Os pais pediram ações separadas.');
select public.set_family_choice(pg_temp.got('case_2', 'case_id')::uuid, 'split', 'A mãe pediu ações separadas.');
reset role;

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('minor_juizado', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid, pg_temp.got('minor', 'party_id')::uuid]));
insert into res values ('undated_juizado', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "forum_basis": "domicile"}'::jsonb, array[pg_temp.got('undated', 'party_id')::uuid]));
insert into res values ('forum_away', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJDFT", "forum_basis": "event_place", "forum_city": "Brasília",
    "forum_reason": "Onde a companhia atendeu."}'::jsonb));
insert into res values ('forum_wrong_state', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "forum_basis": "event_place", "forum_city": "Guarulhos",
    "forum_reason": "O voo foi cancelado em Guarulhos."}'::jsonb));
insert into res values ('forum_not_home', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJSP", "comarca": "São Paulo", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid]));
insert into res values ('forum_event', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJSP", "comarca": "Guarulhos", "forum_basis": "event_place", "forum_city": "GUARULHOS",
    "forum_reason": "O voo foi cancelado em Guarulhos."}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid], array['ae100000-0000-4000-8000-000000000001']::uuid[]));
insert into res values ('minor_comum', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('minor', 'party_id')::uuid], array['ae100000-0000-4000-8000-000000000001']::uuid[]));
insert into res values ('turn_minor_juizado', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('minor_comum', 'proceeding_id')::uuid, '{"kind": "juizado", "court": "TJGO", "forum_basis": "domicile"}'::jsonb));
-- A lawsuit the court already has is recorded as it is: the rules say what may be filed, not what was.
insert into res values ('filed_elsewhere', public.save_proceeding(pg_temp.got('case_2', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJSP", "comarca": "São Paulo", "forum_basis": "domicile",
    "cnj": "1000101-46.2099.8.26.0100", "status": "filed", "filed_at": "2026-10-01"}'::jsonb,
  array[pg_temp.got('case_2', 'party_id')::uuid]));
select public.remove_proceeding(pg_temp.got('filed_elsewhere', 'proceeding_id')::uuid);
reset role;
-- The filed one stays (the court has it); taken out here so the second case has no lawsuit for what follows.
delete from public.proceedings where id = pg_temp.got('filed_elsewhere', 'proceeding_id')::uuid;

select ok(
  pg_temp.got('minor_juizado', 'code') = 'minor_in_small_claims'
  and pg_temp.got('undated_juizado', 'code') = 'minor_in_small_claims'
  and pg_temp.got('turn_minor_juizado', 'code') = 'minor_in_small_claims'
  and pg_temp.got('minor_comum', 'code') = 'saved'
  and pg_temp.got('probe', 'code') = 'party_not_found',
  'a minor is never a party in the small-claims court: named now, already in the lawsuit, or with only a guardian to say so'
);
select ok(
  pg_temp.got('forum_away', 'code') = 'forum_not_linked_to_flight'
  and pg_temp.got('forum_wrong_state', 'code') = 'forum_not_linked_to_flight'
  and pg_temp.got('forum_event', 'code') = 'saved'
  and (select forum_city = 'GUARULHOS' and forum_basis = 'event_place'
       from public.proceedings where id = pg_temp.got('forum_event', 'proceeding_id')::uuid),
  'another forum than the domicile is a city of an airport of the trip, in the state of the court'
);
select ok(
  pg_temp.got('forum_not_home', 'code') = 'forum_not_domicile' and pg_temp.got('filed_elsewhere', 'code') = 'saved',
  'a planned lawsuit at the domicile is in the state where its claimant lives; one already filed is recorded as it is'
);

-- ---------- The Tema 1.417 triage ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_decides', public.save_suspension(pg_temp.got('case', 'case_id')::uuid, 'weather', 'file'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_decides', public.save_suspension(pg_temp.got('case', 'case_id')::uuid, 'weather', 'hold'));
insert into res values ('cause_bad', public.save_suspension(pg_temp.got('case', 'case_id')::uuid, 'aliens'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_cause', public.save_suspension(pg_temp.got('case', 'case_id')::uuid, 'maintenance'));
reset role;

select ok(
  pg_temp.got('bia_decides', 'code') = 'not_a_lawyer'
  and pg_temp.got('ana_decides', 'code') = 'saved'
  and pg_temp.got('cause_bad', 'code') = 'invalid_data'
  and pg_temp.got('bia_cause', 'code') = 'saved'
  and (select airline_stated_cause = 'maintenance' and suspension_decision = 'hold'
              and suspension_decided_by = 'ae100000-0000-4000-8000-000000000001' and suspension_triage is null
       from public.cases where id = pg_temp.got('case', 'case_id')::uuid),
  'anybody of the firm writes what the airline said; filing or holding is a lawyer''s, and a decision left out stays as it was'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.record_suspension_triage(%L, '{"risk": "low", "grounds": [], "rule": "tema-1417-v1"}'::jsonb)$$,
    pg_temp.got('case', 'case_id')),
  '42501', null,
  'a person never writes a triage: the backend runs the rule and records its answer'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('triage', public.record_suspension_triage(pg_temp.got('case', 'case_id')::uuid,
  '{"risk": "low", "grounds": ["internal_cause"], "rule": "tema-1417-v1"}'::jsonb));
insert into res values ('triage_bad', public.record_suspension_triage(pg_temp.got('case', 'case_id')::uuid,
  '{"risk": "certain", "grounds": [], "rule": "tema-1417-v1"}'::jsonb));
reset role;

select ok(
  pg_temp.got('triage', 'code') = 'recorded'
  and pg_temp.got('triage_bad', 'code') = 'invalid_data'
  and (select suspension_triage ->> 'risk' = 'low' and suspension_triage ->> 'rule' = 'tema-1417-v1' and suspension_triage ? 'at'
       from public.cases where id = pg_temp.got('case', 'case_id')::uuid),
  'the triage the rule gave is kept with its version and the moment, and only an answer of its shape'
);

-- ---------- The weather, kept as evidence ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.record_case_weather(%L, '[]'::jsonb, '[]'::jsonb)$$, pg_temp.got('case', 'case_id')),
  '42501', null,
  'a person never writes a weather report as evidence: only the backend, from REDEMET'
);
insert into res values ('read_1', public.begin_case_weather_read(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('read_2', public.begin_case_weather_read(pg_temp.got('case', 'case_id')::uuid));
reset role;
-- A read that failed gives the wait back, by the backend only.
select pg_temp.as_backend();
set local role service_role;
select public.release_case_weather_read(pg_temp.got('case', 'case_id')::uuid);
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('read_3', public.begin_case_weather_read(pg_temp.got('case', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('read_1', 'code') = 'started' and pg_temp.got('read_2', 'code') = 'weather_cooldown'
  and pg_temp.got('read_3', 'code') = 'started'
  and not has_function_privilege('authenticated', 'public.release_case_weather_read(uuid)', 'execute'),
  'a case waits a while between two reads of its reports (the key is the platform''s), unless the last one failed'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('weather', public.record_case_weather(pg_temp.got('case', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('icao', 'SBGO', 'observed_at', '2026-09-20T10:00:00Z',
    'raw', 'METAR SBGO 201000Z 00000KT 0800 FG VV002 19/19 Q1017', 'signs', jsonb_build_array('fog', 'low_visibility')),
  jsonb_build_object('icao', 'sbgr', 'observed_at', '2026-09-20T11:00:00Z',
    'raw', 'METAR SBGR 201100Z 15006KT 9999 FEW020 20/14 Q1020', 'signs', '[]'::jsonb)
), '[{"icao": "SBGO", "from": "2026-09-20T08:00:00Z", "to": "2026-09-20T14:00:00Z"}]'::jsonb));
-- Read again after the leg was corrected: what was kept is replaced, and a corrected report of the same minute stands once.
insert into res values ('weather_again', public.record_case_weather(pg_temp.got('case', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('icao', 'SBGO', 'observed_at', '2026-09-21T10:00:00Z',
    'raw', 'METAR SBGO 211000Z 09008KT 9999 SCT030 27/18 Q1016', 'signs', '[]'::jsonb),
  jsonb_build_object('icao', 'SBGO', 'observed_at', '2026-09-21T10:00:00Z',
    'raw', 'METAR COR SBGO 211000Z 09008KT 8000 SCT030 27/18 Q1016', 'signs', '[]'::jsonb)
), '[{"icao": "SBGO", "from": "2026-09-21T08:00:00Z", "to": "2026-09-21T14:00:00Z"}]'::jsonb));
insert into res values ('weather_bad', public.record_case_weather(pg_temp.got('case', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('icao', 'GYN', 'observed_at', 'ontem', 'raw', 'x')
), '[]'::jsonb));
reset role;

select ok(
  pg_temp.got('weather', 'count') = '2'
  and pg_temp.got('weather_again', 'count') = '1'
  and pg_temp.got('weather_bad', 'code') = 'invalid_data'
  and (select count(*) = 1 and bool_and(raw like 'METAR COR SBGO 211000Z%')
       from public.case_weather where case_id = pg_temp.got('case', 'case_id')::uuid)
  and (select weather_read -> 'windows' -> 0 ->> 'from' = '2026-09-21T08:00:00Z' and weather_read ? 'at'
       from public.cases where id = pg_temp.got('case', 'case_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'weather_read' and actor_type = 'system'),
  'the reports read replace what was kept, once each as published, beside what was asked; a refused set leaves the last one'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::integer from public.case_weather),
  0,
  'another firm reads none of them'
);
reset role;

-- ---------- The lawsuits the rules plan ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
-- The second lawsuit is refused (a minor in the small-claims court): the first is not left behind.
insert into res values ('plan_bad', public.create_planned_proceedings(pg_temp.got('case_2', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('fields', '{"kind": "juizado", "court": "TJGO", "forum_basis": "domicile"}'::jsonb,
    'parties', jsonb_build_array(pg_temp.got('case_2', 'party_id'))),
  jsonb_build_object('fields', '{"kind": "juizado", "court": "TJGO", "forum_basis": "domicile"}'::jsonb,
    'parties', jsonb_build_array(pg_temp.got('minor_2', 'party_id')))
)));
insert into res values ('plan_bad_left', jsonb_build_object('count',
  (select count(*) from public.proceedings where case_id = pg_temp.got('case_2', 'case_id')::uuid)));
insert into res values ('plan', public.create_planned_proceedings(pg_temp.got('case_2', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('fields', '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia"}'::jsonb,
    'parties', jsonb_build_array(pg_temp.got('case_2', 'party_id'))),
  jsonb_build_object('fields', '{"kind": "comum", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia"}'::jsonb,
    'parties', jsonb_build_array(pg_temp.got('minor_2', 'party_id')))
)));
insert into res values ('plan_again', public.create_planned_proceedings(pg_temp.got('case_2', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('fields', '{"kind": "juizado", "court": "TJGO"}'::jsonb, 'parties', '[]'::jsonb)
)));
reset role;

select ok(
  pg_temp.got('plan_bad', 'code') = 'minor_in_small_claims'
  and pg_temp.got('plan_bad_left', 'count') = '0'
  and pg_temp.got('plan', 'code') = 'created' and pg_temp.got('plan', 'count') = '2'
  and pg_temp.got('plan_again', 'code') = 'proceedings_exist'
  and (select count(*) = 2 from public.proceedings where case_id = pg_temp.got('case_2', 'case_id')::uuid),
  'the lawsuits the rules plan are created all at once or not at all, each with every check of a lawsuit, and only once'
);

-- ---------- A lawyer's causes per state ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'counts', jsonb_agg(to_jsonb(c) order by c.uf)
from public.firm_causes_by_state('be100000-0000-4000-8000-00000000000a', 2026) c;
-- A case that did not go ahead no longer counts its planned lawsuits.
select public.set_case_status(pg_temp.got('case', 'case_id')::uuid, 'declined', 'O cliente desistiu.');
insert into res select 'counts_after', coalesce(jsonb_agg(to_jsonb(c) order by c.uf), '[]'::jsonb)
from public.firm_causes_by_state('be100000-0000-4000-8000-00000000000a', 2026) c where c.planned > 0;
reset role;

select ok(
  (select payload from res where name = 'counts') @> '[{"uf": "SP", "planned": 1, "filed": 0}, {"uf": "GO", "planned": 1, "filed": 0}]'::jsonb
  and jsonb_array_length((select payload from res where name = 'counts')) = 2
  and (select payload from res where name = 'counts_after') = '[]'::jsonb,
  'the causes each lawyer of the firm signs are counted by the state of their court, while their case goes ahead'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select count(*) from public.firm_causes_by_state('be100000-0000-4000-8000-00000000000a', 2026)$$,
  '42501', null,
  'and nobody of another firm reads them'
);
reset role;

select * from finish();
rollback;
