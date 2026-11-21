begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The firm's WhatsApp profile (0262). The backend reads every active number with its own firm's data (its name,
-- where it is, its e-mail, its areas and its hours), never another firm's; records what came of a profile written;
-- refuses a mark or a code that is none; and nobody else calls either function.
--
-- Every person, firm, number and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2620000-0000-4000-8000-000000000001', 'ana@souza-perfil.invalid', 'Ana Souza'),
  ('a2620000-0000-4000-8000-000000000002', 'caio@rocha-perfil.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2620000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-perfil', 'a2620000-0000-4000-8000-000000000001'),
  ('b2620000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-perfil', 'a2620000-0000-4000-8000-000000000002');
update public.organizations set office_street = 'Rua das Flores', office_number = '100', office_city = 'Goiânia',
  office_uf = 'GO', office_postal_code = '74115060', office_email = 'contato@souza.invalid'
where id = 'b2620000-0000-4000-8000-00000000000a';
insert into public.firm_operations (org_id, hours_from, hours_to, saturdays) values
  ('b2620000-0000-4000-8000-00000000000a', '08:00', '18:00', false);
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2620000-0000-4000-8000-00000000000a', 'b2620000-0000-4000-8000-00000000000a', 'whatsapp', 'perfil-a', 'WhatsApp A', 'connected'),
  ('d2620000-0000-4000-8000-00000000000b', 'b2620000-0000-4000-8000-00000000000b', 'whatsapp', 'perfil-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2620000-0000-4000-8000-00000000000a', 'b2620000-0000-4000-8000-00000000000a', 'd2620000-0000-4000-8000-00000000000a', 'openwa', 'perfil-a', 'perfil-a', '5562900002621'),
  ('f2620000-0000-4000-8000-00000000000b', 'b2620000-0000-4000-8000-00000000000b', 'd2620000-0000-4000-8000-00000000000b', 'openwa', 'perfil-b', 'perfil-b', '5562900002622');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

create temp table due as
select value as row from jsonb_array_elements(public.wa_numbers_profile_due(20))
where value ->> 'org_id' in ('b2620000-0000-4000-8000-00000000000a', 'b2620000-0000-4000-8000-00000000000b');

select is((select count(*)::integer from due), 2, 'the backend reads every active number');
select is(
  (select array[row -> 'firm' ->> 'name', row -> 'firm' ->> 'city', row -> 'firm' ->> 'email', row -> 'firm' ->> 'hours_from',
                row -> 'firm' -> 'areas' ->> 0]
   from due where row ->> 'org_id' = 'b2620000-0000-4000-8000-00000000000a'),
  array['Souza Advogados', 'Goiânia', 'contato@souza.invalid', '08:00', 'Direito do Passageiro'],
  'with its own firm''s name, place, e-mail, hours and areas'
);
select is(
  (select array[row -> 'firm' ->> 'name', row -> 'firm' ->> 'city'] from due where row ->> 'org_id' = 'b2620000-0000-4000-8000-00000000000b'),
  array['Rocha Advocacia', null], 'and firm B''s number with firm B''s, never A''s'
);
select is(
  public.record_number_profile('f2620000-0000-4000-8000-00000000000a', repeat('c', 64), 'not_supported') ->> 'code',
  'recorded', 'what came of a profile written is recorded'
);
select is(
  public.record_number_profile('f2620000-0000-4000-8000-00000000000a', 'nada', 'ok') ->> 'code', 'invalid',
  'a mark that is none is refused'
);
reset role;
select is(
  (select array[profile_hash, profile_code] from public.wa_numbers where id = 'f2620000-0000-4000-8000-00000000000a'),
  array[repeat('c', 64), 'not_supported'], 'kept on the number'
);
select ok(
  not has_function_privilege('authenticated', 'public.wa_numbers_profile_due(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_number_profile(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.wa_numbers_profile_due(integer)', 'execute'),
  'nobody but the backend reads or records them'
);

select * from finish();
rollback;
