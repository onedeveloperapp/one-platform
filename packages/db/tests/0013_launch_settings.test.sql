begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- ============================================================
-- The launch stage and the operating company (0015): public settings the
-- anonymous site reads, written only by a superadmin.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('af000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'member@teste.invalid', '', '{}', '{"display_name":"Member"}', now(), now()),
  ('af000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@teste.invalid', '', '{}', '{"display_name":"Operator"}', now(), now());

update public.profiles set is_superadmin = true where id = 'af000000-0000-4000-8000-000000000002';

select is(
  (select value ->> 'stage' from public.platform_settings where key = 'launch'),
  'waitlist',
  'the site ships in the waitlist stage'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select ok(
  exists (select 1 from public.platform_settings where key = 'launch')
  and exists (select 1 from public.platform_settings where key = 'legal_entity'),
  'a visitor reads the launch stage and the company line'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
update public.platform_settings set value = '{"stage": "open"}' where key = 'launch';
update public.platform_settings set value = '{"name": "Impostor"}' where key = 'legal_entity';
reset role;

select is(
  (select value ->> 'stage' from public.platform_settings where key = 'launch'),
  'waitlist',
  'a person cannot open the site'
);
select is(
  (select value from public.platform_settings where key = 'legal_entity'),
  '{}'::jsonb,
  'a person cannot rename the operating company'
);

select set_config('request.jwt.claims', '{"sub":"af000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
update public.platform_settings set value = '{"stage": "open"}' where key = 'launch';
reset role;

select is(
  (select value ->> 'stage' from public.platform_settings where key = 'launch'),
  'open',
  'a superadmin opens the site'
);

select * from finish();
rollback;
