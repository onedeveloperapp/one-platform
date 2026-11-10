begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The firm registers its own passengers (0170): a person with no case, a trip
-- ONE follows of them with the agreement the firm recorded, the documents
-- kept with the trip, the person a lead while the trip is followed, and the
-- trip stopped by the firm. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1690000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@pasone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1690000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@pasone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1690000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-pasone', 'a1690000-0000-4000-8000-000000000001'),
  ('b1690000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-pasone', 'a1690000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1690000-0000-4000-8000-00000000000a', 'a1690000-0000-4000-8000-000000000001', 'owner', 'atendimento'),
  ('b1690000-0000-4000-8000-00000000000b', 'a1690000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

create function pg_temp.as_person(who uuid, call text) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  execute 'set local role authenticated';
  execute call into answer;
  execute 'reset role';
  return answer;
end;
$$;

create function pg_temp.legs(days integer) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'flight_number', 'LA 3456', 'origin_iata', 'GYN', 'destination_iata', 'GRU',
    'scheduled_departure_local', to_char((now() at time zone 'America/Sao_Paulo')::date + days, 'YYYY-MM-DD') || 'T08:00',
    'scheduled_arrival_local', to_char((now() at time zone 'America/Sao_Paulo')::date + days, 'YYYY-MM-DD') || 'T09:45'));
$$;

-- A file Ana sent, and one somebody else of the firm did.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
  detected_mime, expires_at, confirmed_at, uploaded_by)
values
  ('e1690000-0000-4000-8000-000000000001', 'b1690000-0000-4000-8000-00000000000a', 'upload',
   'org/b1690000-0000-4000-8000-00000000000a/upload/e1690000-0000-4000-8000-000000000001', 'rg.jpg', 'image/jpeg',
   100, 'stored', repeat('a', 64), 100, 'image/jpeg', now() + interval '1 hour', now(), 'a1690000-0000-4000-8000-000000000001'),
  ('e1690000-0000-4000-8000-000000000002', 'b1690000-0000-4000-8000-00000000000a', 'upload',
   'org/b1690000-0000-4000-8000-00000000000a/upload/e1690000-0000-4000-8000-000000000002', 'bilhete.pdf', 'application/pdf',
   100, 'stored', repeat('b', 64), 100, 'application/pdf', now() + interval '1 hour', now(), null);

insert into res values ('mariana', pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
  'select public.firm_save_person(%L, %L)', 'b1690000-0000-4000-8000-00000000000a',
  '{"full_name": "Mariana Teste", "cpf": "52998224725", "phone": "5562999990001", "birth_date": "1990-03-04"}')));
insert into res values ('sem-fone', pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
  'select public.firm_save_person(%L, %L)', 'b1690000-0000-4000-8000-00000000000a', '{"full_name": "Rui Teste"}')));

select ok(
  has_function_privilege('authenticated', 'public.firm_save_person(uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.firm_follow_trip(uuid, jsonb, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.firm_follow_trip(uuid, jsonb, text, jsonb)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.tracked_trip_documents', 'INSERT'),
  'a person of the firm registers and follows; only the database writes a trip''s documents'
);

select ok(
  pg_temp.got('mariana', 'code') = 'created'
  and (select phone = '5562999990001' and cpf = '52998224725' from public.people where id = pg_temp.got('mariana', 'person_id')::uuid)
  and pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
    'select public.firm_save_person(%L, %L)', 'b1690000-0000-4000-8000-00000000000a',
    '{"full_name": "Outra Pessoa", "cpf": "529.982.247-25"}')) = jsonb_build_object('ok', false, 'code', 'cpf_taken',
      'person_id', pg_temp.got('mariana', 'person_id')),
  'the firm writes a person with no case, and a CPF it has is that person''s'
);

select ok(
  pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
    'select public.firm_follow_trip(%L, %L, %L)', pg_temp.got('sem-fone', 'person_id'), pg_temp.legs(3), 'telefone')) ->> 'code' = 'no_phone'
  and pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
    'select public.firm_follow_trip(%L, %L, %L)', pg_temp.got('mariana', 'person_id'), pg_temp.legs(3), 'pombo')) ->> 'field' = 'how'
  and pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
    'select public.firm_follow_trip(%L, %L, %L)', pg_temp.got('mariana', 'person_id'), pg_temp.legs(-5), 'telefone')) ->> 'code' = 'trip_past'
  and pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
    'select public.firm_follow_trip(%L, %L, %L)', pg_temp.got('mariana', 'person_id'),
    '[{"flight_number": "LA3456", "origin_iata": "GYN", "destination_iata": "GYN", "scheduled_departure_local": "2099-01-01T08:00", "scheduled_arrival_local": "2099-01-01T09:00"}]',
    'telefone')) ->> 'field' = 'legs',
  'a trip asks a WhatsApp, a way the passenger agreed, legs that are flights, and a time still to come'
);

insert into res values ('trip', pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
  'select public.firm_follow_trip(%L, %L, %L, %L)', pg_temp.got('mariana', 'person_id'), pg_temp.legs(3), 'whatsapp',
  '[{"file_id": "e1690000-0000-4000-8000-000000000001", "kind": "identity"},
    {"file_id": "e1690000-0000-4000-8000-000000000002", "kind": "ticket"}]')));
select ok(
  pg_temp.got('trip', 'code') = 'followed'
  and (select person_id = pg_temp.got('mariana', 'person_id')::uuid and consent_channel = 'firm' and status = 'watching'
              and watch = 'flightaware' and not is_test and airline_iata = 'LA' and consent_wording like '%Registrado pelo escritório: whatsapp.'
       from public.tracked_trips where id = pg_temp.got('trip', 'trip_id')::uuid)
  and (select count(*) = 1 and min(flight_number) = 'LA3456' from public.tracked_legs where trip_id = pg_temp.got('trip', 'trip_id')::uuid),
  'ONE follows the trip, with the agreement the firm recorded and the legs as given'
);

select ok(
  (select array_agg(kind) = array['identity'] from public.tracked_trip_documents where trip_id = pg_temp.got('trip', 'trip_id')::uuid),
  'the document the person sent stays with the trip; one somebody else sent is not taken'
);

select ok(
  (select point = 'lead' from public.people_funnel('b1690000-0000-4000-8000-00000000000a')
   where person_id = pg_temp.got('mariana', 'person_id')::uuid),
  'a passenger the firm follows, with no case, is a lead'
);

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  insert into res values ('discard', public.discard_file('e1690000-0000-4000-8000-000000000001'));
  execute 'reset role';
end;
$$;
select ok(
  pg_temp.got('discard', 'code') = 'in_use'
  and exists (select 1 from public.files where id = 'e1690000-0000-4000-8000-000000000001'),
  'a document kept with a trip is never forgotten under it'
);

select ok(
  pg_temp.as_person('a1690000-0000-4000-8000-000000000002', format(
    'select public.firm_follow_trip(%L, %L, %L)', pg_temp.got('mariana', 'person_id'), pg_temp.legs(3), 'telefone')) ->> 'code' = 'not_found'
  and pg_temp.as_person('a1690000-0000-4000-8000-000000000002', format(
    'select public.firm_stop_trip(%L)', pg_temp.got('trip', 'trip_id'))) ->> 'code' = 'not_found',
  'firm B neither follows nor stops a trip of firm A''s person'
);

insert into res values ('stop', pg_temp.as_person('a1690000-0000-4000-8000-000000000001', format(
  'select public.firm_stop_trip(%L)', pg_temp.got('trip', 'trip_id'))));
select ok(
  pg_temp.got('stop', 'code') = 'stopped'
  and (select status = 'stopped' from public.tracked_trips where id = pg_temp.got('trip', 'trip_id')::uuid)
  and (select point = 'contato' from public.people_funnel('b1690000-0000-4000-8000-00000000000a')
       where person_id = pg_temp.got('mariana', 'person_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'trip.stopped' and org_id = 'b1690000-0000-4000-8000-00000000000a'),
  'the firm stops following it, on the record, and the person is a contact again'
);

select * from finish();
rollback;
