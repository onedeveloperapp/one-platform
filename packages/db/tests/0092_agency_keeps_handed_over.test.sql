begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- A passenger whose case the firm opened stays among the agency's
-- passengers (0089): the count of the partnership's passengers is the
-- list's, handed over or not, never a draft; the counts of what the agency
-- still does leave out who went to the firm. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-entregue.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a9200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-entregue.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a9200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-entregue.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a9200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@mar-entregue.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-entregue', 'a9200000-0000-4000-8000-000000000001'),
  ('b9200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-entregue', 'a9200000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9200000-0000-4000-8000-00000000000a', 'a9200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9200000-0000-4000-8000-00000000000b', 'a9200000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values
  ('c9200000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c9200000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c9200000-0000-4000-8000-0000000000aa', 'a9200000-0000-4000-8000-000000000003', 'owner'),
  ('c9200000-0000-4000-8000-0000000000bb', 'a9200000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d9200000-0000-4000-8000-00000000000a', 'c9200000-0000-4000-8000-0000000000aa', 'b9200000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d9200000-0000-4000-8000-00000000000b', 'c9200000-0000-4000-8000-0000000000bb', 'b9200000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');

-- The agency Sol's Lara, whose case the firm opened, and Tomás, still with the agency, each holding a trip, and a
-- draft nobody confirmed; the agency Mar's Vera, whose case its firm opened.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone, handed_over_at, draft)
values
  ('f9200000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-0000000000aa', 'd9200000-0000-4000-8000-00000000000a',
   'b9200000-0000-4000-8000-00000000000a', 'Lara Teste', '1988-02-14', '5562999991001', now(), false),
  ('f9200000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-0000000000aa', 'd9200000-0000-4000-8000-00000000000a',
   'b9200000-0000-4000-8000-00000000000a', 'Tomas Teste', '1979-09-30', '5562999991002', null, false),
  ('f9200000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-0000000000aa', 'd9200000-0000-4000-8000-00000000000a',
   'b9200000-0000-4000-8000-00000000000a', 'Passageiro em cadastro', null, null, null, true),
  ('f9200000-0000-4000-8000-000000000004', 'c9200000-0000-4000-8000-0000000000bb', 'd9200000-0000-4000-8000-00000000000b',
   'b9200000-0000-4000-8000-00000000000b', 'Vera Teste', '1970-10-10', '5562999991004', now(), false);
insert into public.pax_trips (id, partner_id, partnership_id, org_id, holder_id, locator) values
  ('19200000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-0000000000aa', 'd9200000-0000-4000-8000-00000000000a',
   'b9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-000000000001', 'ENT101'),
  ('19200000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-0000000000aa', 'd9200000-0000-4000-8000-00000000000a',
   'b9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-000000000002', 'ENT102');
insert into public.pax_trip_travelers (trip_id, traveler_id) values
  ('19200000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001'),
  ('19200000-0000-4000-8000-000000000002', 'f9200000-0000-4000-8000-000000000002');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select pg_temp.sign_in('a9200000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('overview_sol', public.pax_overview('d9200000-0000-4000-8000-00000000000a'));
insert into res values ('page_sol', public.pax_travelers_page('d9200000-0000-4000-8000-00000000000a'));
reset role;

select is(pg_temp.got('overview_sol', 'travelers')::integer, 2,
  'the agency''s passengers are all of the partnership''s, the one whose case the firm opened included, never a draft');
select ok(
  (pg_temp.got('page_sol', 'total'))::integer = 2
  and exists (select 1 from jsonb_array_elements(pg_temp.got('page_sol', 'rows')::jsonb) r
              where r.value ->> 'id' = 'f9200000-0000-4000-8000-000000000001' and r.value ->> 'handed_over_at' is not null),
  'and the count is the list''s, which keeps the passenger with the firm'
);
select is(pg_temp.got('overview_sol', 'missing_identity')::integer, 1,
  'what the agency still does leaves out who went to the firm: an identity owed by Tomás alone');
select is(pg_temp.got('overview_sol', 'adults_waiting')::integer, 1,
  'and an agreement owed by Tomás alone');

select pg_temp.sign_in('a9200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('overview_mar', public.pax_overview('d9200000-0000-4000-8000-00000000000b'));
reset role;
select is(pg_temp.got('overview_mar', 'travelers')::integer, 1,
  'another agency counts its own passenger with its firm, and none of the first''s');

select pg_temp.sign_in('a9200000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.pax_overview('d9200000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'and never reads the first agency''s counts'
);
reset role;

select * from finish();
rollback;
