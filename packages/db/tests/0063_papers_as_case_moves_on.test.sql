begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The papers a client signs, and ONE's word that what they sent arrived,
-- also when the case moves on before the client says they finished (0057):
-- a case that left the gathering owes its power of attorney to each adult
-- whose link is open, and ONE tells them the case has what it needs, in a
-- conversation ONE holds, within the setting's days of the move; one who
-- said they finished is told as before. Two firms: nothing of one reaches
-- the other.
--
-- Every person, firm and number here is invented: the phones of an area code
-- no carrier has.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@adiante.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@adiante.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-adiante', 'a6300000-0000-4000-8000-000000000001'),
  ('b6300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-adiante', 'a6300000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6300000-0000-4000-8000-00000000000a', 'a6300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6300000-0000-4000-8000-00000000000b', 'a6300000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c6300000-0000-4000-8000-00000000000a', 'b6300000-0000-4000-8000-00000000000a', 'whatsapp', 'test-waba-aa', 'Chat de teste',
   'connected', 'a6300000-0000-4000-8000-000000000001', now()),
  ('c6300000-0000-4000-8000-00000000000b', 'b6300000-0000-4000-8000-00000000000b', 'whatsapp', 'test-waba-ab', 'Chat de teste',
   'connected', 'a6300000-0000-4000-8000-000000000004', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- A cancellation of an adult of Goiânia with every fact a paper writes, a phone and a link of the case.
create function pg_temp.full_case(org uuid, name text, cpf text, phone text, token text)
returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'cancellation', 'LA', date '2026-10-24', jsonb_build_object(
    'full_name', name, 'cpf', cpf, 'birth_date', '1990-05-02', 'nationality', 'brasileira', 'phone', phone,
    'marital_status', 'solteiro', 'profession', 'Professora', 'street', 'Rua das Flores', 'address_number', '10',
    'district', 'Centro', 'city', 'Goiânia', 'uf', 'GO', 'postal_code', '74000000'));
begin
  perform public.create_client_link((made ->> 'case_id')::uuid, (made ->> 'person_id')::uuid, pg_temp.hash(token));
  return made;
end;
$$;
create function pg_temp.papers(target uuid) returns text language sql as $$
  select coalesce(string_agg(d.kind, ',' order by d.kind), '') from public.case_papers_due(target) d;
$$;
-- Who ONE would tell, read under a claim of the case that is then given back, as a look of the worker does.
create function pg_temp.received(target uuid) returns jsonb language plpgsql as $$
declare
  claimed jsonb := coalesce((public.claim_case_advances(1, target) -> 'claimed') -> 0, '{}'::jsonb);
  answer jsonb;
begin
  answer := public.advance_received_people(target, (claimed ->> 'claim')::integer);
  perform public.record_case_advance(target, (claimed ->> 'claim')::integer, null, false);
  return answer;
end;
$$;

-- Each firm's test chat, its number and a conversation of its client: ONE holds firm A's, a person firm B's.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b6300000-0000-4000-8000-00000000000a',
  'c6300000-0000-4000-8000-00000000000a', 'test', 'test-number-aa', 'test-waba-aa', '5500900000063', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b6300000-0000-4000-8000-00000000000b',
  'c6300000-0000-4000-8000-00000000000b', 'test', 'test-number-ab', 'test-waba-ab', '5500900000064', 'Rocha Advocacia', 'cloud'));
reset role;

select pg_temp.sign_in('a6300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('mariana', pg_temp.full_case('b6300000-0000-4000-8000-00000000000a', 'Mariana Teste',
  '12345678909', '5500999996301', 'token-de-adiante-mariana-1234567890'));
reset role;
select pg_temp.sign_in('a6300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('pedro', pg_temp.full_case('b6300000-0000-4000-8000-00000000000b', 'Pedro Teste',
  '11144477735', '5500999996304', 'token-de-adiante-pedro-12345678901'));
reset role;
insert into public.wa_conversations (org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('b6300000-0000-4000-8000-00000000000a', pg_temp.got('number_a', 'number_id')::uuid, '5500999996301',
   now() - interval '10 minutes', now() - interval '10 minutes', 'Mandei os documentos', 'in', 1, 'one'),
  ('b6300000-0000-4000-8000-00000000000b', pg_temp.got('number_b', 'number_id')::uuid, '5500999996304',
   now() - interval '10 minutes', now() - interval '10 minutes', 'Mandei', 'in', 1, 'person');

-- ---------- While the case is gathered, nothing before the client says they finished ----------

select is(pg_temp.papers(pg_temp.got('mariana', 'case_id')::uuid), '',
  'a case still gathered owes no paper before its client says they finished');

-- ---------- The case moves on: its lawsuits were created ----------

update public.cases set status = 'drafting', status_changed_at = now()
where id in (pg_temp.got('mariana', 'case_id')::uuid, pg_temp.got('pedro', 'case_id')::uuid);

select is(pg_temp.papers(pg_temp.got('mariana', 'case_id')::uuid), 'procuracao',
  'a case that moved on owes the power of attorney to its adult whose link is open');
select is(pg_temp.papers(pg_temp.got('pedro', 'case_id')::uuid), 'procuracao',
  'in each firm, of its own case');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('told_a', pg_temp.received(pg_temp.got('mariana', 'case_id')::uuid));
insert into res values ('told_b', pg_temp.received(pg_temp.got('pedro', 'case_id')::uuid));
reset role;

select ok(
  (select payload -> 'people' -> 0 ->> 'person_id' from res where name = 'told_a') = pg_temp.got('mariana', 'person_id')
  and (select payload -> 'people' -> 0 ->> 'finished' from res where name = 'told_a') = 'false',
  'ONE tells the client the case has what it needs, saying they did not say they finished'
);
select is((select jsonb_array_length(payload -> 'people') from res where name = 'told_b'), 0,
  'nobody is told in a conversation a person of the firm holds');

-- ---------- Long after the move, and the word of a client who finished ----------

update public.cases set status_changed_at = now() - interval '30 days' where id = pg_temp.got('mariana', 'case_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('told_late', pg_temp.received(pg_temp.got('mariana', 'case_id')::uuid));
reset role;
select is((select jsonb_array_length(payload -> 'people') from res where name = 'told_late'), 0,
  'a case that moved on longer ago than the setting''s days is not told now');

update public.client_links set finished_at = now() where case_id = pg_temp.got('mariana', 'case_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('told_finished', pg_temp.received(pg_temp.got('mariana', 'case_id')::uuid));
reset role;
select is((select payload -> 'people' -> 0 ->> 'finished' from res where name = 'told_finished'), 'true',
  'a client who said they finished is told as before');

select * from finish();
rollback;
