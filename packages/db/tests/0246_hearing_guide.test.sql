begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The guide of a hearing for the lawyer who goes (0246). Lia's lawsuit at
-- firm A has a hearing in two days: the guide reads her two legs with the
-- times and ANAC's record, the weather read, her account in order, the
-- weather's decision and the airline's cause, with no defense in the case.
-- The task that reads it is the passenger module's, published in its new
-- version. Only the backend reads it, and nothing of firm A reaches firm B.
--
-- Every person, firm, name and number here is invented; the lawsuit's
-- number is of a year to come.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2460000-0000-4000-8000-000000000001', 'ana@lima-guia.invalid', 'Ana Lima'),
  ('a2460000-0000-4000-8000-000000000002', 'duda@rocha-guia.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2460000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-guia', 'a2460000-0000-4000-8000-000000000001'),
  ('b2460000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-guia', 'a2460000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2460000-0000-4000-8000-00000000000a', 'a2460000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2460000-0000-4000-8000-00000000000b', 'a2460000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status, airline_iata, airline_stated_cause, suspension_decision) values
  ('c2460000-0000-4000-8000-000000000001', 'b2460000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation',
   'filed', 'AD', 'weather', 'file');
insert into public.people (id, org_id, full_name, birth_date) values
  ('d2460000-0000-4000-8000-000000000001', 'b2460000-0000-4000-8000-00000000000a', 'Lia Teste', '1990-05-04');
insert into public.case_parties (id, org_id, case_id, person_id, role, claim_cents) values
  ('e2460000-0000-4000-8000-000000000001', 'b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001',
   'd2460000-0000-4000-8000-000000000001', 'claimant', 1000000);
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at, unit) values
  ('f2460000-0000-4000-8000-000000000001', 'b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2099-09-01', 'Juizado Especial Cível de Goiânia');
insert into public.proceeding_parties (org_id, proceeding_id, party_id) values
  ('b2460000-0000-4000-8000-00000000000a', 'f2460000-0000-4000-8000-000000000001', 'e2460000-0000-4000-8000-000000000001');
insert into public.flight_segments (org_id, case_id, position, flight_number, origin_iata, destination_iata,
                                    scheduled_departure_local, scheduled_arrival_local, affected, source) values
  ('b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001', 1, 'AD4221', 'GRU', 'VCP',
   '2099-10-25 02:25', '2099-10-25 05:05', false, 'firm'),
  ('b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001', 2, 'AD4702', 'VCP', 'BSB',
   '2099-10-25 07:00', '2099-10-25 08:40', true, 'firm');
insert into public.case_weather (org_id, case_id, icao, observed_at, raw, signs) values
  ('b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001', 'SBKP', '2099-10-25 10:00+00',
   'METAR SBKP 251000Z 12005KT 9999 FEW030 22/15 Q1018=', '{}');
insert into public.case_statements (org_id, case_id, party_id, source, transcript, chronology_status, chronology)
values ('b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001', 'e2460000-0000-4000-8000-000000000001',
        'client', 'O voo de Campinas foi cancelado no portão.', 'confirmed', '1. O voo de Campinas foi cancelado no portão.');
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('a2460000-0000-4000-8000-0000000000a1', 'b2460000-0000-4000-8000-00000000000a', 'c2460000-0000-4000-8000-000000000001',
   'f2460000-0000-4000-8000-000000000001', 'conciliacao', now() + interval '2 days', 'America/Sao_Paulo', 'videoconferencia');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('guide', public.hearing_guide_facts('a2460000-0000-4000-8000-0000000000a1'));
reset role;

select is(
  (select jsonb_agg(jsonb_build_object('flight', l ->> 'flight', 'problem', l -> 'problem_leg'))
   from res, jsonb_array_elements(payload -> 'legs') l where name = 'guide'),
  '[{"flight": "AD4221", "problem": false}, {"flight": "AD4702", "problem": true}]'::jsonb,
  'the guide reads her legs in the order of the trip, with the leg of the problem');
select ok(
  (select payload -> 'weather' -> 0 ->> 'airport' = 'SBKP'
          and payload ->> 'airline_cause' = 'weather' and payload ->> 'suspension' = 'file'
   from res where name = 'guide'),
  'the weather read, the airline''s cause and the Tema 1.417''s decision');
select ok(
  (select payload ->> 'account' like '%cancelado no portão%' and payload -> 'defense_in_case' = 'false'::jsonb
          and payload -> 'claimants' -> 0 ->> 'cents' = '1000000'
   from res where name = 'guide'),
  'her account in order, who asks and how much, and that the defense is not in the case');
select ok(
  (select count(*) = 1 from public.prompt_versions where task = 'audiencia.preparo' and is_active)
  and exists (select 1 from public.ai_tasks where slug = 'audiencia.preparo' and is_active)
  and (select 'audiencia.preparo' = any (version_tasks) from public.product_modules where key = 'direito-do-passageiro'),
  'the task that reads it is a task of the passenger module');
select ok(
  (select (v.manifest #>> '{prompts,audiencia.preparo}')::integer = 1 from public.module_versions v
   where v.module = 'direito-do-passageiro' and v.status = 'published' order by v.version desc limit 1),
  'published in the module''s new version');

select set_config('request.jwt.claims', '{"sub":"a2460000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.hearing_guide_facts('a2460000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'only the backend reads it');
reset role;

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2460000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.hearings where org_id = 'b2460000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.case_statements where case_id = 'c2460000-0000-4000-8000-000000000001'),
  0, 'another firm reads neither the hearing nor the account');
reset role;

select * from finish();
rollback;
