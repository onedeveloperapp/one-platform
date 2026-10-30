begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- What a firm contracted of ONE's modules and the modules to come (0075):
-- a module to come is in the catalog, sold as a package, and no firm can
-- have it, by founding, by the operator or by a write of its own. The cases
-- that came from an agency are a filter of the firm's list, each naming the
-- agency; and what a firm reads of its partnerships: its own cases from each,
-- and, to who manages it, what each costs it today. Two firms, three
-- agencies (one partnership ended).
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-oferta.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7900000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-oferta.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a7900000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-oferta.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7900000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-oferta.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a7900000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'olga@one-oferta.invalid', '', now(), '{}', '{"display_name":"Olga Operadora"}', now(), now()),
  ('a7900000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eva@nova-oferta.invalid', '', now(), '{}', '{"display_name":"Eva Nunes"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a7900000-0000-4000-8000-000000000005';

insert into public.organizations (id, name, slug, created_by) values
  ('b7900000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-oferta', 'a7900000-0000-4000-8000-000000000001'),
  ('b7900000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-oferta', 'a7900000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7900000-0000-4000-8000-00000000000a', 'a7900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7900000-0000-4000-8000-00000000000a', 'a7900000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b7900000-0000-4000-8000-00000000000b', 'a7900000-0000-4000-8000-000000000003', 'owner', 'socio');

insert into public.partners (id, name) values
  ('c7900000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c7900000-0000-4000-8000-0000000000bb', 'Viagens Mar'),
  ('c7900000-0000-4000-8000-0000000000cc', 'Viagens Lua');
insert into public.partner_members (partner_id, user_id, role) values
  ('c7900000-0000-4000-8000-0000000000aa', 'a7900000-0000-4000-8000-000000000004', 'owner');
-- Sol with firm A, Mar with firm B, and Lua with firm A, ended before Sol began.
insert into public.partner_links (id, partner_id, org_id, module_key, status, started_at, ended_at, end_reason) values
  ('d7900000-0000-4000-8000-00000000000a', 'c7900000-0000-4000-8000-0000000000aa', 'b7900000-0000-4000-8000-00000000000a',
   'direito-do-passageiro', 'active', now() - interval '10 days', null, null),
  ('d7900000-0000-4000-8000-00000000000b', 'c7900000-0000-4000-8000-0000000000bb', 'b7900000-0000-4000-8000-00000000000b',
   'direito-do-passageiro', 'active', now() - interval '10 days', null, null),
  ('d7900000-0000-4000-8000-00000000000c', 'c7900000-0000-4000-8000-0000000000cc', 'b7900000-0000-4000-8000-00000000000a',
   'direito-do-passageiro', 'ended', now() - interval '40 days', now() - interval '20 days', 'Fim do contrato');

-- Firm A: two cases from Sol still going (one waits for its client), one from Sol closed, and one of its own.
insert into public.cases (id, org_id, seq, incident, partnership_id) values
  ('e7900000-0000-4000-8000-000000000001', 'b7900000-0000-4000-8000-00000000000a', 1, 'cancellation',
   'd7900000-0000-4000-8000-00000000000a'),
  ('e7900000-0000-4000-8000-000000000003', 'b7900000-0000-4000-8000-00000000000a', 3, 'delay', null),
  ('e7900000-0000-4000-8000-000000000004', 'b7900000-0000-4000-8000-00000000000a', 4, 'delay',
   'd7900000-0000-4000-8000-00000000000a'),
  -- Firm B: one case from Mar.
  ('e7900000-0000-4000-8000-000000000005', 'b7900000-0000-4000-8000-00000000000b', 1, 'delay',
   'd7900000-0000-4000-8000-00000000000b');
insert into public.cases (id, org_id, seq, incident, partnership_id, status, closed_at) values
  ('e7900000-0000-4000-8000-000000000002', 'b7900000-0000-4000-8000-00000000000a', 2, 'cancellation',
   'd7900000-0000-4000-8000-00000000000a', 'closed', now());
-- Case 1's client said on their link that they finished; case 4's did not (0071, 0077).
insert into public.people (id, org_id, full_name) values
  ('a7900000-0000-4000-8000-0000000000f1', 'b7900000-0000-4000-8000-00000000000a', 'Rafaela Teste');
insert into public.case_parties (case_id, org_id, person_id, role) values
  ('e7900000-0000-4000-8000-000000000001', 'b7900000-0000-4000-8000-00000000000a',
   'a7900000-0000-4000-8000-0000000000f1', 'claimant');
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('b7900000-0000-4000-8000-00000000000a', 'e7900000-0000-4000-8000-000000000001',
   'a7900000-0000-4000-8000-0000000000f1', encode(sha256(convert_to('oferta-link-rafaela-000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days', now());

-- What the AI read for each partnership: Sol today and yesterday, Mar today.
insert into public.pax_reading_days (partnership_id, day, readings) values
  ('d7900000-0000-4000-8000-00000000000a', (now() at time zone 'America/Sao_Paulo')::date, 7),
  ('d7900000-0000-4000-8000-00000000000a', (now() at time zone 'America/Sao_Paulo')::date - 1, 50),
  ('d7900000-0000-4000-8000-00000000000b', (now() at time zone 'America/Sao_Paulo')::date, 3);

-- The flights read today: a trip of Sol's passenger and one of firm A's own; one of A's own yesterday; Mar's.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone) values
  ('f7900000-0000-4000-8000-000000000001', 'c7900000-0000-4000-8000-0000000000aa', 'd7900000-0000-4000-8000-00000000000a',
   'b7900000-0000-4000-8000-00000000000a', 'Rafaela Teste', '1990-04-12', '5562999990001'),
  ('f7900000-0000-4000-8000-000000000002', 'c7900000-0000-4000-8000-0000000000bb', 'd7900000-0000-4000-8000-00000000000b',
   'b7900000-0000-4000-8000-00000000000b', 'Vera Teste', '1970-10-10', '5562999990002');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('17900000-0000-4000-8000-000000000001', 'c7900000-0000-4000-8000-0000000000aa', 'd7900000-0000-4000-8000-00000000000a',
   'b7900000-0000-4000-8000-00000000000a', 'f7900000-0000-4000-8000-000000000001', 'OFE101'),
  ('17900000-0000-4000-8000-000000000002', 'c7900000-0000-4000-8000-0000000000bb', 'd7900000-0000-4000-8000-00000000000b',
   'b7900000-0000-4000-8000-00000000000b', 'f7900000-0000-4000-8000-000000000002', 'OFE102');
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, consent_wording, consent_at, consent_channel,
                                  status, watch, watch_day, watch_reads, pax_trip_id) values
  ('27900000-0000-4000-8000-000000000001', 'b7900000-0000-4000-8000-00000000000a', 'Rafaela Teste', '5562999990001', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching', 'flightaware',
   (now() at time zone 'America/Sao_Paulo')::date, 4, '17900000-0000-4000-8000-000000000001'),
  ('27900000-0000-4000-8000-000000000002', 'b7900000-0000-4000-8000-00000000000a', 'Propria Teste', '5562999990003', 'LA',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware',
   (now() at time zone 'America/Sao_Paulo')::date, 2, null),
  ('27900000-0000-4000-8000-000000000003', 'b7900000-0000-4000-8000-00000000000a', 'Ontem Teste', '5562999990004', 'G3',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'page', 'watching', 'flightaware',
   (now() at time zone 'America/Sao_Paulo')::date - 1, 9, null),
  ('27900000-0000-4000-8000-000000000004', 'b7900000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990002', 'AD',
   'Concordo em receber os avisos dos meus voos pelo escritório.', now(), 'agency', 'watching', 'flightaware',
   (now() at time zone 'America/Sao_Paulo')::date, 5, '17900000-0000-4000-8000-000000000002');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

-- ---------- The catalog ----------

select ok(
  (select count(*) from public.product_modules m
   where m.key in ('direito-previdenciario', 'direito-trabalhista')
     and m.status = 'coming_soon' and m.sold_as = 'package' and not m.is_default and m.description is not null) = 2,
  'the two modules to come are in the catalog, sold as packages, given to no firm by default'
);

select ok(
  exists (
    select 1 from public.product_modules m
    where m.key = 'direito-do-passageiro' and m.status = 'available' and m.sold_as = 'package'
      and m.description is not null and m.sort < (select min(o.sort) from public.product_modules o where o.status = 'coming_soon')
  ),
  'the passenger module is out, sold as a package, with its line, before the modules to come'
);

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000006');
set local role authenticated;
insert into res values ('founded', jsonb_build_object('org', public.create_firm('Nunes Advocacia', 'socio')));
insert into res values ('catalog', jsonb_build_object(
  'to_come', (select count(*) from public.product_modules where status = 'coming_soon'),
  'lines', (select count(*) from public.product_modules where status = 'coming_soon' and description is not null)
));
reset role;

select is(
  (select array_agg(fm.module_key order by fm.module_key) from public.firm_modules fm
   where fm.org_id = (pg_temp.got('founded', array['org', 'org_id']))::uuid
      or fm.org_id = (select o.id from public.organizations o where o.created_by = 'a7900000-0000-4000-8000-000000000006')),
  array['direito-do-passageiro'],
  'a firm founded takes the module that is out, and none to come'
);

select ok(
  pg_temp.got('catalog', array['to_come'])::integer >= 2 and pg_temp.got('catalog', array['lines'])::integer >= 2,
  'anybody signed in reads the modules to come, each with its line'
);

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('give', public.admin_set_firm_module('b7900000-0000-4000-8000-00000000000a',
  'direito-trabalhista', true, 'Um teste do que vem em breve'));
reset role;

select is(pg_temp.got('give', array['code']), 'module_coming_soon', 'the operator gives no firm a module to come');

select throws_ok(
  $$ insert into public.firm_modules (org_id, module_key) values ('b7900000-0000-4000-8000-00000000000a', 'direito-previdenciario') $$,
  '23514', 'module_coming_soon',
  'a module to come is refused in a firm''s modules, however it is written'
);

-- ---------- The cases that came from an agency ----------

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_agency', public.firm_cases('b7900000-0000-4000-8000-00000000000a', 'agencia'));
insert into res values ('a_all', public.firm_cases('b7900000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('a_agency', array['total']) = '2' and pg_temp.got('a_agency', array['counts', 'agencia']) = '2',
  'the filter counts the cases from an agency still going'
);

select is(
  (select array_agg((row ->> 'seq') || ':' || (row ->> 'agency') order by (row ->> 'seq')::integer)
   from res, jsonb_array_elements(payload -> 'rows') row where res.name = 'a_agency'),
  array['1:Viagens Sol', '4:Viagens Sol'],
  'its rows are those cases, each naming the agency it came from'
);

select is(
  (select row ->> 'agency' from res, jsonb_array_elements(payload -> 'rows') row
   where res.name = 'a_all' and row ->> 'seq' = '3'),
  null,
  'a case of the firm''s own names no agency'
);

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('b_agency', public.firm_cases('b7900000-0000-4000-8000-00000000000b', 'agencia'));
reset role;

select ok(
  pg_temp.got('b_agency', array['total']) = '1'
    and pg_temp.got('b_agency', array['rows', '0', 'agency']) = 'Viagens Mar',
  'another firm counts and names its own agency''s cases'
);

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.firm_cases('b7900000-0000-4000-8000-00000000000a', 'agencias') $$,
  '22023', 'invalid_filter',
  'a filter the list does not know is still refused'
);
reset role;

-- ---------- What a firm reads of its partnerships ----------

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_manager', public.firm_partnership_facts('b7900000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a7900000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('a_member', public.firm_partnership_facts('b7900000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a7900000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('b_manager', public.firm_partnership_facts('b7900000-0000-4000-8000-00000000000b'));
reset role;
select pg_temp.sign_in('a7900000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('operator', public.firm_partnership_facts('b7900000-0000-4000-8000-00000000000a'));
reset role;

select is(
  (select array_agg((p.value ->> 'link_id') || ':' || (p.value ->> 'status') order by p.ord)
   from res, jsonb_array_elements(payload -> 'partnerships') with ordinality as p(value, ord) where res.name = 'a_manager'),
  array['d7900000-0000-4000-8000-00000000000a:active', 'd7900000-0000-4000-8000-00000000000c:ended'],
  'the firm reads its partnerships, the active one first, and none of another firm'
);

select ok(
  pg_temp.got('a_manager', array['partnerships', '0', 'cases_going']) = '2'
    and pg_temp.got('a_manager', array['partnerships', '0', 'cases_total']) = '3'
    and pg_temp.got('a_manager', array['partnerships', '0', 'awaiting_client']) = '1',
  'of each, its own cases: going, in all, and the ones still gathered whose client did not say they finished'
);

select ok(
  pg_temp.got('a_manager', array['partnerships', '1', 'cases_total']) = '0'
    and pg_temp.got('a_manager', array['partnerships', '1', 'readings_today']) = '0',
  'a partnership that ended is listed with what it has, nothing'
);

select ok(
  pg_temp.got('a_manager', array['partnerships', '0', 'readings_today']) = '7'
    and pg_temp.got('a_manager', array['readings_daily']) = '300'
    and pg_temp.got('a_manager', array['partnerships', '0', 'flight_reads_today']) = '4'
    and pg_temp.got('a_manager', array['flight_reads_today']) = '6'
    and pg_temp.got('a_manager', array['flight_reads_share']) = '150',
  'who manages the firm reads what each partnership costs today, and the firm''s reads against its share'
);

select ok(
  pg_temp.got('a_member', array['partnerships', '0', 'cases_going']) = '2'
    and pg_temp.got('a_member', array['partnerships', '0', 'readings_today']) is null
    and pg_temp.got('a_member', array['readings_daily']) is null
    and pg_temp.got('a_member', array['flight_reads_today']) is null
    and pg_temp.got('a_member', array['manager']) = 'false',
  'anybody else of the firm reads the cases, never the costs'
);

select ok(
  jsonb_array_length((select payload -> 'partnerships' from res where name = 'b_manager')) = 1
    and pg_temp.got('b_manager', array['partnerships', '0', 'cases_going']) = '1'
    and pg_temp.got('b_manager', array['partnerships', '0', 'readings_today']) = '3'
    and pg_temp.got('b_manager', array['flight_reads_today']) = '5',
  'another firm reads its own partnership and costs only'
);

select ok(
  pg_temp.got('operator', array['manager']) = 'true'
    and jsonb_array_length((select payload -> 'partnerships' from res where name = 'operator')) = 2,
  'the platform operator reads a firm''s partnerships'
);

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.firm_partnership_facts('b7900000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'somebody of another firm reads nothing of a firm''s partnerships'
);
reset role;

select pg_temp.sign_in('a7900000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.firm_partnership_facts('b7900000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'the agency reads nothing of the firm'
);
reset role;

select * from finish();
rollback;
