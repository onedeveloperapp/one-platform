begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- An agency's passenger who agrees is the firm's lead (0171): the words say
-- the data go to the firm, a yes in them makes each person it covers a
-- person of the firm (the firm's own record kept, what it lacks taken), a
-- lead in the funnel, read with the agency's trips; an agreement given
-- before, in the words that passed nothing until a problem, passes nothing;
-- taking it back takes back only a person the agreement made; and the firm
-- reads each partnership by its numbers. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-lead.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-lead.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1700000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-lead', 'a1700000-0000-4000-8000-000000000001'),
  ('b1700000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-lead', 'a1700000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1700000-0000-4000-8000-00000000000a', 'a1700000-0000-4000-8000-000000000001', 'owner', 'atendimento'),
  ('b1700000-0000-4000-8000-00000000000b', 'a1700000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values
  ('c1700000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c1700000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d1700000-0000-4000-8000-00000000000a', 'c1700000-0000-4000-8000-0000000000aa', 'b1700000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d1700000-0000-4000-8000-00000000000b', 'c1700000-0000-4000-8000-0000000000bb', 'b1700000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c1700000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.'),
  ('c1700000-0000-4000-8000-0000000000bb', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');

-- The firm Rocha already has Vera, with her e-mail and no WhatsApp.
insert into public.people (id, org_id, full_name, cpf, email) values
  ('e1700000-0000-4000-8000-00000000000b', 'b1700000-0000-4000-8000-00000000000b', 'Vera Teste Lima', '11144477735',
   'vera@escritorio.invalid');

-- The agency Sol's Rafaela, with Lia, a child she answers for, on her trip; and Bruno, who agreed in the old words.
-- The agency Mar's Vera, with a trip ahead.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, cpf, birth_date, phone, email, guardian_id) values
  ('f1700000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-0000000000aa', 'd1700000-0000-4000-8000-00000000000a',
   'b1700000-0000-4000-8000-00000000000a', 'Rafaela Teste', '52998224725', '1990-04-12', '5562999990001', 'rafaela@agencia.invalid', null),
  ('f1700000-0000-4000-8000-000000000003', 'c1700000-0000-4000-8000-0000000000bb', 'd1700000-0000-4000-8000-00000000000b',
   'b1700000-0000-4000-8000-00000000000b', 'Vera Teste Lima', '11144477735', '1970-10-10', '5562999990003', 'vera@agencia.invalid', null),
  ('f1700000-0000-4000-8000-000000000004', 'c1700000-0000-4000-8000-0000000000aa', 'd1700000-0000-4000-8000-00000000000a',
   'b1700000-0000-4000-8000-00000000000a', 'Bruno Teste', null, '1985-01-20', '5562999990002', null, null);
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, guardian_id) values
  ('f1700000-0000-4000-8000-000000000002', 'c1700000-0000-4000-8000-0000000000aa', 'd1700000-0000-4000-8000-00000000000a',
   'b1700000-0000-4000-8000-00000000000a', 'Lia Teste', (current_date - interval '8 years')::date,
   'f1700000-0000-4000-8000-000000000001');
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('11700000-0000-4000-8000-000000000001', 'c1700000-0000-4000-8000-0000000000aa', 'd1700000-0000-4000-8000-00000000000a',
   'b1700000-0000-4000-8000-00000000000a', 'f1700000-0000-4000-8000-000000000001', 'LDA101'),
  ('11700000-0000-4000-8000-000000000003', 'c1700000-0000-4000-8000-0000000000bb', 'd1700000-0000-4000-8000-00000000000b',
   'b1700000-0000-4000-8000-00000000000b', 'f1700000-0000-4000-8000-000000000003', 'LDA301');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('11700000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001'),
  ('11700000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000002'),
  ('11700000-0000-4000-8000-000000000003', 'f1700000-0000-4000-8000-000000000003');
insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                  scheduled_departure_local, scheduled_arrival_local) values
  ('11700000-0000-4000-8000-000000000001', 1, 'LA3456', 'GRU', 'REC', current_date + 10 + time '08:10', current_date + 10 + time '11:25'),
  ('11700000-0000-4000-8000-000000000003', 1, 'G31450', 'BSB', 'GIG', current_date + 12 + time '14:00', current_date + 12 + time '15:45');
insert into public.pax_confirm_links (partner_id, partnership_id, org_id, holder_id, token_hash, expires_at) values
  ('c1700000-0000-4000-8000-0000000000aa', 'd1700000-0000-4000-8000-00000000000a', 'b1700000-0000-4000-8000-00000000000a',
   'f1700000-0000-4000-8000-000000000001', encode(sha256(convert_to('lead-rafaela-000000000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days'),
  ('c1700000-0000-4000-8000-0000000000bb', 'd1700000-0000-4000-8000-00000000000b', 'b1700000-0000-4000-8000-00000000000b',
   'f1700000-0000-4000-8000-000000000003', encode(sha256(convert_to('lead-vera-0000000000000000000000000', 'UTF8')), 'hex'),
   now() + interval '30 days');
-- Bruno's yes, given before 0171 in the words that passed nothing until a problem.
insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, wording, answer) values
  ('c1700000-0000-4000-8000-0000000000aa', 'b1700000-0000-4000-8000-00000000000a', 'f1700000-0000-4000-8000-000000000004',
   'f1700000-0000-4000-8000-000000000004', 'Concordo com as palavras de antes, que passavam os dados só no problema.', 'agreed');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.firm_person(traveler uuid) returns uuid language sql as
$$ select t.firm_person_id from public.pax_travelers t where t.id = traveler; $$;

select ok(
  public.pax_consent_wording('f1700000-0000-4000-8000-000000000001')
    like 'Concordo que Viagens Sol compartilhe com o escritório Souza Advogados os meus dados,%'
  and public.pax_consent_wording('f1700000-0000-4000-8000-000000000001') like '%A partir deste acordo, o escritório cuida desses dados%',
  'the words say the data go to the firm when the passenger agrees'
);

insert into res
select 'w_' || x.name, jsonb_build_object('text', public.pax_consent_wording(x.id))
from (values ('rafaela', 'f1700000-0000-4000-8000-000000000001'::uuid), ('vera', 'f1700000-0000-4000-8000-000000000003'::uuid)) as x (name, id);

select pg_temp.anonymous();
set local role anon;
insert into res values ('rafaela', public.pax_link_answer('lead-rafaela-000000000000000000000', 'agreed', pg_temp.got('w_rafaela', 'text')));
insert into res values ('vera', public.pax_link_answer('lead-vera-0000000000000000000000000', 'agreed', pg_temp.got('w_vera', 'text')));
reset role;

select ok(
  pg_temp.got('rafaela', 'code') = 'agreed'
  and (select bool_and(c.shares_data) from public.pax_consents c
       where c.traveler_id in ('f1700000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000002')),
  'the yes says its words pass the data, for her and the child she answers for'
);

select ok(
  (select p.org_id = 'b1700000-0000-4000-8000-00000000000a' and p.full_name = 'Rafaela Teste' and p.cpf = '52998224725'
          and p.birth_date = '1990-04-12' and p.phone = '5562999990001' and p.email = 'rafaela@agencia.invalid'
   from public.people p where p.id = pg_temp.firm_person('f1700000-0000-4000-8000-000000000001'))
  and (select p.full_name = 'Lia Teste' from public.people p where p.id = pg_temp.firm_person('f1700000-0000-4000-8000-000000000002'))
  and exists (select 1 from public.audit_events a where a.org_id = 'b1700000-0000-4000-8000-00000000000a' and a.action = 'pax.lead'),
  'each person the yes covers becomes a person of the firm with the agency''s record, on the firm''s record'
);

select ok(
  pg_temp.firm_person('f1700000-0000-4000-8000-000000000003') = 'e1700000-0000-4000-8000-00000000000b'
  and (select p.email = 'vera@escritorio.invalid' and p.phone = '5562999990003' and p.birth_date = '1970-10-10'
       from public.people p where p.id = 'e1700000-0000-4000-8000-00000000000b')
  and (select count(*) = 1 from public.people p where p.org_id = 'b1700000-0000-4000-8000-00000000000b'),
  'a person the firm had of that CPF is the one: its record kept, what it lacked taken'
);

select ok(
  pg_temp.firm_person('f1700000-0000-4000-8000-000000000004') is null
  and public.pax_lead_to_firm('f1700000-0000-4000-8000-000000000004') is null,
  'an agreement given in the old words passes nothing'
);

select is(
  (select point from public.people_funnel('b1700000-0000-4000-8000-00000000000a')
   where person_id = pg_temp.firm_person('f1700000-0000-4000-8000-000000000001')),
  'lead',
  'the passenger is a lead of the firm'
);

select is(
  public.pax_client_of('b1700000-0000-4000-8000-00000000000a', 'f1700000-0000-4000-8000-000000000001'),
  pg_temp.firm_person('f1700000-0000-4000-8000-000000000001'),
  'the case a yes to a problem opens is that person''s'
);

-- The agency's record is no firm's to read: the person is taken before signing in.
insert into res values ('rafaela_person', jsonb_build_object('id', pg_temp.firm_person('f1700000-0000-4000-8000-000000000001')));
select pg_temp.sign_in('a1700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('agency_a', public.firm_person_agency(pg_temp.got('rafaela_person', 'id')::uuid));
insert into res values ('facts_a', public.firm_partnership_facts('b1700000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a1700000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('agency_b', public.firm_person_agency(pg_temp.got('rafaela_person', 'id')::uuid));
reset role;

select ok(
  (pg_temp.got('agency_a', 'agencies')::jsonb -> 0 ->> 'agency') = 'Viagens Sol'
  and (select count(*) = 1 from jsonb_array_elements(pg_temp.got('agency_a', 'agencies')::jsonb -> 0 -> 'trips') t
       where t ->> 'status' = 'watching' and t -> 'legs' -> 0 ->> 'flight' = 'LA3456'),
  'the firm reads the agency and the trips ONE follows of its lead'
);

select is(pg_temp.got('agency_b', 'code'), 'not_found', 'another firm reads nothing of the lead');

select is(
  pg_temp.got('facts_a', 'partnerships')::jsonb -> 0 -> 'passengers',
  jsonb_build_object('registered', 3, 'unagreed', 0, 'leads', 2, 'converted', 0),
  'the firm reads the partnership by its numbers: Bruno agreed in the old words, so he is no lead'
);

-- ---------- Taking it back ----------

insert into res values ('w_rafaela2', jsonb_build_object('text', public.pax_consent_wording('f1700000-0000-4000-8000-000000000001')));
insert into res values ('w_vera2', jsonb_build_object('text', public.pax_consent_wording('f1700000-0000-4000-8000-000000000003')));
insert into res values ('lia_person', jsonb_build_object('id', pg_temp.firm_person('f1700000-0000-4000-8000-000000000002')));
select pg_temp.anonymous();
set local role anon;
insert into res values ('rafaela_back', public.pax_link_answer('lead-rafaela-000000000000000000000', 'withdrawn', pg_temp.got('w_rafaela2', 'text')));
insert into res values ('vera_back', public.pax_link_answer('lead-vera-0000000000000000000000000', 'withdrawn', pg_temp.got('w_vera2', 'text')));
reset role;

select ok(
  pg_temp.got('rafaela_back', 'code') = 'withdrawn'
  and pg_temp.firm_person('f1700000-0000-4000-8000-000000000001') is null
  and not exists (select 1 from public.people p where p.id = pg_temp.got('lia_person', 'id')::uuid)
  and not exists (select 1 from public.people p where p.org_id = 'b1700000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.audit_events a where a.org_id = 'b1700000-0000-4000-8000-00000000000a'
              and a.action = 'pax.lead_withdrawn'),
  'taking the agreement back takes back the persons it made'
);

select ok(
  exists (select 1 from public.people p where p.id = 'e1700000-0000-4000-8000-00000000000b')
  and pg_temp.firm_person('f1700000-0000-4000-8000-000000000003') is null,
  'and never a person the firm had'
);

select * from finish();
rollback;
