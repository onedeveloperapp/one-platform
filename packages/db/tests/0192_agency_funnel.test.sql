begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The agency's people by the funnel (0194). The agency Sol has Lara, whose
-- trip became a case (Com o escritório), Tomás, who agreed to be followed
-- (Lead), Rui, registered and nothing more (Contato), and a draft nobody
-- confirmed. The counts and the list say each stage; a yes that no longer
-- covers Tomás's trips (his WhatsApp changed) puts him back among the
-- contacts. Another agency reads nothing of Sol's. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1920000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-funil.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1920000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-funil.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a1920000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-funil.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a1920000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@mar-funil.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1920000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-funil', 'a1920000-0000-4000-8000-000000000001'),
  ('b1920000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-funil', 'a1920000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1920000-0000-4000-8000-00000000000a', 'a1920000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1920000-0000-4000-8000-00000000000b', 'a1920000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values
  ('c1920000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c1920000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c1920000-0000-4000-8000-0000000000aa', 'a1920000-0000-4000-8000-000000000003', 'owner'),
  ('c1920000-0000-4000-8000-0000000000bb', 'a1920000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d1920000-0000-4000-8000-00000000000a', 'c1920000-0000-4000-8000-0000000000aa', 'b1920000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d1920000-0000-4000-8000-00000000000b', 'c1920000-0000-4000-8000-0000000000bb', 'b1920000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');

insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone, handed_over_at, draft)
values
  ('f1920000-0000-4000-8000-000000000001', 'c1920000-0000-4000-8000-0000000000aa', 'd1920000-0000-4000-8000-00000000000a',
   'b1920000-0000-4000-8000-00000000000a', 'Lara Teste', '1988-02-14', '5562999992001', now(), false),
  ('f1920000-0000-4000-8000-000000000002', 'c1920000-0000-4000-8000-0000000000aa', 'd1920000-0000-4000-8000-00000000000a',
   'b1920000-0000-4000-8000-00000000000a', 'Tomas Teste', '1979-09-30', '5562999992002', null, false),
  ('f1920000-0000-4000-8000-000000000003', 'c1920000-0000-4000-8000-0000000000aa', 'd1920000-0000-4000-8000-00000000000a',
   'b1920000-0000-4000-8000-00000000000a', 'Rui Teste', '1990-05-05', '5562999992003', null, false),
  ('f1920000-0000-4000-8000-000000000004', 'c1920000-0000-4000-8000-0000000000aa', 'd1920000-0000-4000-8000-00000000000a',
   'b1920000-0000-4000-8000-00000000000a', 'Passageiro em cadastro', null, null, null, true),
  ('f1920000-0000-4000-8000-000000000005', 'c1920000-0000-4000-8000-0000000000bb', 'd1920000-0000-4000-8000-00000000000b',
   'b1920000-0000-4000-8000-00000000000b', 'Vera Teste', '1970-10-10', '5562999992005', null, false);
insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, wording, answer, phone) values
  ('c1920000-0000-4000-8000-0000000000aa', 'b1920000-0000-4000-8000-00000000000a', 'f1920000-0000-4000-8000-000000000002',
   'f1920000-0000-4000-8000-000000000002', 'Concordo que o ONE acompanhe os meus voos e me avise de um problema.',
   'agreed', '5562999992002');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.ids(name text) returns text[] language sql as
$$ select coalesce(array_agg(r.value ->> 'full_name' || ':' || (r.value ->> 'stage') order by r.value ->> 'full_name'), '{}')
   from res, jsonb_array_elements(res.payload -> 'rows') r where res.name = ids.name; $$;

select pg_temp.sign_in('a1920000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('overview', public.pax_overview('d1920000-0000-4000-8000-00000000000a'));
insert into res values ('all', public.pax_travelers_page('d1920000-0000-4000-8000-00000000000a'));
insert into res values ('contacts', public.pax_travelers_page('d1920000-0000-4000-8000-00000000000a', null, 'contact'));
insert into res values ('leads', public.pax_travelers_page('d1920000-0000-4000-8000-00000000000a', null, 'lead'));
insert into res values ('firm', public.pax_travelers_page('d1920000-0000-4000-8000-00000000000a', null, 'firm'));
reset role;

select ok(
  pg_temp.got('overview', 'contacts')::integer = 1 and pg_temp.got('overview', 'leads')::integer = 1
    and pg_temp.got('overview', 'with_firm')::integer = 1 and pg_temp.got('overview', 'travelers')::integer = 3,
  'the agency counts each stage of the funnel, never a draft'
);
select is(pg_temp.ids('all'), array['Lara Teste:firm', 'Rui Teste:contact', 'Tomas Teste:lead'],
  'each row of the list says its stage');
select ok(
  pg_temp.ids('contacts') = array['Rui Teste:contact'] and pg_temp.ids('leads') = array['Tomas Teste:lead']
    and pg_temp.ids('firm') = array['Lara Teste:firm'],
  'the list filters by each stage'
);

-- Tomás's WhatsApp changes: the yes no longer covers his trips, and he is a contact again until he agrees again.
update public.pax_travelers set phone = '5562999992099' where id = 'f1920000-0000-4000-8000-000000000002';
select pg_temp.sign_in('a1920000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('overview-after', public.pax_overview('d1920000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('overview-after', 'contacts')::integer = 2 and pg_temp.got('overview-after', 'leads')::integer = 0,
  'a yes that no longer covers the passenger''s trips puts them back among the contacts'
);

select pg_temp.sign_in('a1920000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('overview-mar', public.pax_overview('d1920000-0000-4000-8000-00000000000b'));
reset role;
select ok(
  pg_temp.got('overview-mar', 'contacts')::integer = 1 and pg_temp.got('overview-mar', 'leads')::integer = 0,
  'another agency counts its own people'
);
select pg_temp.sign_in('a1920000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.pax_travelers_page('d1920000-0000-4000-8000-00000000000a', null, 'lead') $$,
  '42501', 'not_authorized',
  'and never reads the first agency''s list'
);
reset role;

select * from finish();
rollback;
