begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The passenger's welcome (0174): owed once a passenger agreed, once per
-- WhatsApp and firm; a real passenger waits for the platform's release and
-- stays owed meanwhile; what the passenger or the firm decided (a stop, no
-- template) is kept for good. Two firms: nothing of one reaches the other.
--
-- Every person, firm, flight and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1730000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-boasvindas.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1730000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-boasvindas.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1730000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-boasvindas', 'a1730000-0000-4000-8000-000000000001'),
  ('b1730000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-boasvindas', 'a1730000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1730000-0000-4000-8000-00000000000a', 'a1730000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1730000-0000-4000-8000-00000000000b', 'a1730000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Firm A's passenger agreed today, on two trips; firm B's agreed a month ago.
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, consent_wording, consent_at,
                                  consent_channel, watch) values
  ('e1730000-0000-4000-8000-00000000000a', 'b1730000-0000-4000-8000-00000000000a', 'Mariana Teste', '5562999990001', 'LA',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware'),
  ('e1730000-0000-4000-8000-00000000000c', 'b1730000-0000-4000-8000-00000000000a', 'Mariana Teste', '5562999990001', 'LA',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now(), 'firm', 'flightaware'),
  ('e1730000-0000-4000-8000-00000000000b', 'b1730000-0000-4000-8000-00000000000b', 'Vera Teste', '5562999990003', 'G3',
   false, 'O passageiro concordou que o escritório acompanhe os voos desta viagem.', now() - interval '30 days', 'firm', 'flightaware');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.backend(name text, call text) returns void language plpgsql as $$
declare
  answer jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  execute call into answer;
  execute 'reset role';
  insert into res values (name, answer);
end;
$$;

select pg_temp.backend('owed', $$select public.welcomes_owed(50)$$);
select ok(
  (select count(*) = 2 from jsonb_array_elements((select payload from res where name = 'owed')) w
   where w ->> 'trip_id' in ('e1730000-0000-4000-8000-00000000000a', 'e1730000-0000-4000-8000-00000000000c'))
  and not exists (select 1 from jsonb_array_elements((select payload from res where name = 'owed')) w
                  where w ->> 'trip_id' = 'e1730000-0000-4000-8000-00000000000b'),
  'a passenger who agreed in the last days is owed the welcome; one who agreed long ago is not'
);

select pg_temp.backend('real', $$select public.reserve_passenger_welcome('e1730000-0000-4000-8000-00000000000a',
  array['Mariana', 'Souza Advogados'])$$);
select ok(
  pg_temp.got('real', 'reason') = 'not_released'
  and not exists (select 1 from public.passenger_welcomes where org_id = 'b1730000-0000-4000-8000-00000000000a'),
  'a real passenger is welcomed only once the platform released its alerts, and stays owed meanwhile'
);

insert into public.platform_settings (key, value) values ('flight_alerts', '{"released": true}'::jsonb)
on conflict (key) do update set value = public.platform_settings.value || '{"released": true}'::jsonb;
select pg_temp.backend('released', $$select public.reserve_passenger_welcome('e1730000-0000-4000-8000-00000000000a',
  array['Mariana', 'Souza Advogados'])$$);
select pg_temp.backend('other_trip', $$select public.reserve_passenger_welcome('e1730000-0000-4000-8000-00000000000c',
  array['Mariana', 'Souza Advogados'])$$);
select ok(
  pg_temp.got('released', 'reason') = 'no_template' and pg_temp.got('other_trip', 'code') = 'already'
  and (select count(*) = 1 from public.passenger_welcomes where org_id = 'b1730000-0000-4000-8000-00000000000a'),
  'a firm with no welcome of its own is kept so, once per WhatsApp, whatever trips follow'
);

select pg_temp.backend('owed_after', $$select public.welcomes_owed(50)$$);
select ok(
  not exists (select 1 from jsonb_array_elements((select payload from res where name = 'owed_after')) w
              where w ->> 'trip_id' in ('e1730000-0000-4000-8000-00000000000a', 'e1730000-0000-4000-8000-00000000000c')),
  'and is owed nothing more'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1730000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.passenger_welcomes), 0, 'firm B reads nothing of firm A''s welcomes');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.reserve_passenger_welcome(uuid, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.welcomes_owed(integer, uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.passenger_welcomes', 'INSERT'),
  'only the backend writes a welcome'
);

select * from finish();
rollback;
