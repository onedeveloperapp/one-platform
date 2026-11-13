begin;
create extension if not exists pgtap;
select plan(21);

-- ============================================================
-- The team's rooms in the panel of attendance (0238). In firm A, Ana (owner,
-- partner) and Duda (administrator, lawyer) manage the rooms; Bia and Edu are
-- members who manage none. Firm B has Caio. A room is read only by its people
-- and by who manages the firm's rooms; its name is unique among the rooms in
-- use; its people are of the firm; archiving needs a reason; a change marks it
-- for the panel, and the backend claims each once, after the firm's account is
-- ready. A person who enters the panel, or leaves the firm, marks their rooms.
--
-- Every person, firm and phone here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2380000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@salas-a.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2380000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@salas-a.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a2380000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@salas-a.invalid', '', now(), '{}', '{"display_name":"Duda Reis"}', now(), now()),
  ('a2380000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@salas-a.invalid', '', now(), '{}', '{"display_name":"Edu Melo"}', now(), now()),
  ('a2380000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@salas-b.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2380000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-salas-238', 'a2380000-0000-4000-8000-000000000001'),
  ('b2380000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-salas-238', 'a2380000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2380000-0000-4000-8000-00000000000a', 'a2380000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2380000-0000-4000-8000-00000000000a', 'a2380000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b2380000-0000-4000-8000-00000000000a', 'a2380000-0000-4000-8000-000000000003', 'admin', 'advogado'),
  ('b2380000-0000-4000-8000-00000000000a', 'a2380000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b2380000-0000-4000-8000-00000000000b', 'a2380000-0000-4000-8000-000000000005', 'owner', 'socio');

create function pg_temp.sign_in(person uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, to_jsonb(%s))', name, call);
  reset role;
end;
$$;
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  execute format('insert into res values (%L, to_jsonb(%s))', name, call);
end;
$$;

-- 1. Written only through the functions; the backend's functions are the backend's.
select ok(
  not has_table_privilege('authenticated', 'public.chatwoot_rooms', 'insert')
  and not has_table_privilege('authenticated', 'public.chatwoot_rooms', 'update')
  and not has_table_privilege('authenticated', 'public.chatwoot_room_members', 'insert')
  and not has_table_privilege('authenticated', 'public.chatwoot_room_members', 'delete')
  and not has_table_privilege('anon', 'public.chatwoot_rooms', 'select')
  and not has_function_privilege('authenticated', 'public.chatwoot_claim_rooms(integer, uuid, uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_room_work(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_keep_room(uuid, integer, integer, integer, text, integer[], boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_finish_room(uuid, timestamptz, boolean)', 'execute'),
  'nobody writes a room but through its functions, and the panel''s work is the backend''s'
);

-- 2. A member who manages nothing makes no room.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000002', 'bia-makes',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, 'Comercial',
    array['a2380000-0000-4000-8000-000000000002']::uuid[])$$);
select is(pg_temp.got('bia-makes', '{code}'), 'forbidden', 'a member who is neither partner nor administrator makes no room');

-- 3. The partner makes one, with a colleague.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'made',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, '  Comercial   da  equipe ',
    array['a2380000-0000-4000-8000-000000000001', 'a2380000-0000-4000-8000-000000000002', 'a2380000-0000-4000-8000-000000000002']::uuid[])$$);
select ok(
  pg_temp.got('made', '{ok}') = 'true'
  and (select name from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid) = 'Comercial da equipe'
  and (select count(*) from public.chatwoot_room_members where room_id = pg_temp.got('made', '{id}')::uuid) = 2
  and (select chatwoot_dirty_at is not null from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid),
  'the partner makes a room with its name tidied and each person once, marked for the panel'
);

-- 4. What is refused.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000003', 'taken',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, 'COMERCIAL DA EQUIPE',
    array['a2380000-0000-4000-8000-000000000003']::uuid[])$$);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'stranger',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, 'Prazos',
    array['a2380000-0000-4000-8000-000000000005']::uuid[])$$);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'nobody',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, 'Prazos', array[]::uuid[])$$);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'blank',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, '   ',
    array['a2380000-0000-4000-8000-000000000001']::uuid[])$$);
select ok(
  pg_temp.got('taken', '{code}') = 'name_taken' and pg_temp.got('stranger', '{code}') = 'not_a_member'
  and pg_temp.got('nobody', '{code}') = 'no_members' and pg_temp.got('blank', '{code}') = 'invalid_name',
  'a name in use, a person of another firm, nobody and a blank name are refused'
);

-- 5. The administrator who is not in it manages it all the same.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000003', 'duda-reads',
  $$public.firm_rooms('b2380000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('duda-reads', '{manages}') = 'true' and pg_temp.got('duda-reads', '{rooms,0,mine}') = 'false'
  and pg_temp.got('duda-reads', '{rooms,0,name}') = 'Comercial da equipe',
  'who administers the firm sees and manages a room they are not in'
);

-- 6. A member of the room reads it and its people.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000002', 'bia-reads',
  $$public.firm_rooms('b2380000-0000-4000-8000-00000000000a')$$);
select pg_temp.sign_in('a2380000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  pg_temp.got('bia-reads', '{manages}') = 'false' and pg_temp.got('bia-reads', '{rooms,0,mine}') = 'true'
  and jsonb_array_length((select value -> 'rooms' -> 0 -> 'members' from res where key = 'bia-reads')) = 2
  and pg_temp.got('bia-reads', '{rooms,0,members,0,in_panel}') = 'false'
  and (select count(*) from public.chatwoot_rooms) = 1
  and (select count(*) from public.chatwoot_room_members) = 2,
  'a member of the room reads it and who is in it, none of them in the panel yet'
);
reset role;

-- 7. A colleague outside the room does not know of it.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000004', 'edu-reads',
  $$public.firm_rooms('b2380000-0000-4000-8000-00000000000a')$$);
select pg_temp.sign_in('a2380000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select value -> 'rooms' from res where key = 'edu-reads') = '[]'::jsonb
  and (select count(*) from public.chatwoot_rooms) = 0
  and (select count(*) from public.chatwoot_room_members) = 0,
  'a colleague outside the room reads nothing of it'
);
reset role;

-- 8. Another firm reads nothing, and asks nothing of this one.
select pg_temp.sign_in('a2380000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.chatwoot_rooms), 0, 'another firm reads no room of this one');
select throws_ok(
  $$select public.firm_rooms('b2380000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'and cannot ask for its rooms'
);
select throws_ok(
  $$select public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, 'Invasão',
    array['a2380000-0000-4000-8000-000000000005']::uuid[])$$,
  '42501', 'not_authorized',
  'nor make one there'
);
reset role;

-- 9. The panel is not ready: nothing is claimed. Once it is, the room is claimed once.
select pg_temp.as_backend('claim0', $$(select count(*) from public.chatwoot_claim_rooms())$$);
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
select public.chatwoot_claim_account('b2380000-0000-4000-8000-00000000000a');
select public.chatwoot_keep_account('b2380000-0000-4000-8000-00000000000a', 9201, 9202);
select public.chatwoot_keep_account('b2380000-0000-4000-8000-00000000000a', target_phone_user => 9203, target_inbox => 9204, target_ready => true);
select pg_temp.as_backend('claim1', $$(select jsonb_agg(c) from public.chatwoot_claim_rooms() c)$$);
select pg_temp.as_backend('claim2', $$(select count(*) from public.chatwoot_claim_rooms())$$);
select ok(
  pg_temp.got('claim0', '{}') = '0'
  and jsonb_array_length((select value from res where key = 'claim1')) = 1
  and pg_temp.got('claim1', '{0,room_id}') = pg_temp.got('made', '{id}')
  and pg_temp.got('claim2', '{}') = '0',
  'a room waits for the firm''s account, then is claimed by one server'
);

-- 10. Nobody of the room has entered the panel: the work names nobody. Bia enters, and she is named.
select pg_temp.as_backend('work0', format($$public.chatwoot_room_work(%L)$$, pg_temp.got('made', '{id}')));
select public.chatwoot_keep_room(pg_temp.got('made', '{id}')::uuid, 31, 32, 7, 'Comercial da equipe', '{}');
select public.chatwoot_finish_room(pg_temp.got('made', '{id}')::uuid, (select dirty_at from (select (value -> 0 ->> 'dirty_at')::timestamptz as dirty_at from res where key = 'claim1') x), true);
select ok(
  pg_temp.got('work0', '{members}') = '[]' and pg_temp.got('work0', '{archived}') = 'false'
  and (select chatwoot_synced_at >= chatwoot_dirty_at and chatwoot_conversation_id = 7
       from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid),
  'the work names who entered the panel, and a room done is up to date'
);
insert into public.chatwoot_staff (org_id, user_id, chatwoot_user_id)
values ('b2380000-0000-4000-8000-00000000000a', 'a2380000-0000-4000-8000-000000000002', 501);
select pg_temp.as_backend('work1', format($$public.chatwoot_room_work(%L)$$, pg_temp.got('made', '{id}')));
select ok(
  pg_temp.got('work1', '{members}') = '[501]'
  and (select chatwoot_dirty_at > chatwoot_synced_at from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid),
  'a person of the room who enters the panel marks it, and the work names them by the panel''s number'
);

-- 11. The partner changes who is in it: Bia leaves, and reads it no more.
select public.chatwoot_finish_room(pg_temp.got('made', '{id}')::uuid, now(), true);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'changed',
  format($$public.save_team_room('b2380000-0000-4000-8000-00000000000a', %L, 'Comercial',
    array['a2380000-0000-4000-8000-000000000001', 'a2380000-0000-4000-8000-000000000004']::uuid[])$$,
    pg_temp.got('made', '{id}')));
select pg_temp.sign_in('a2380000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  pg_temp.got('changed', '{ok}') = 'true' and (select count(*) from public.chatwoot_rooms) = 0,
  'who leaves the room reads it no more'
);
reset role;
select ok(
  (select name = 'Comercial' and chatwoot_dirty_at > chatwoot_synced_at
   from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid)
  and (select array_agg(user_id order by user_id) from public.chatwoot_room_members
       where room_id = pg_temp.got('made', '{id}')::uuid)
      = array['a2380000-0000-4000-8000-000000000001', 'a2380000-0000-4000-8000-000000000004']::uuid[],
  'the room takes its new name and people, and is marked for the panel'
);

-- 12. Archived with a reason; a room of the same name made meanwhile keeps it from coming back.
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'short',
  format($$public.archive_team_room('b2380000-0000-4000-8000-00000000000a', %L, 'ok')$$, pg_temp.got('made', '{id}')));
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'archived',
  format($$public.archive_team_room('b2380000-0000-4000-8000-00000000000a', %L, 'Equipe comercial desfeita')$$,
    pg_temp.got('made', '{id}')));
select pg_temp.as_backend('work2', format($$public.chatwoot_room_work(%L)$$, pg_temp.got('made', '{id}')));
select ok(
  pg_temp.got('short', '{code}') = 'invalid_reason' and pg_temp.got('archived', '{ok}') = 'true'
  and pg_temp.got('work2', '{archived}') = 'true',
  'a room is archived with a reason of a few words, and the backend reads it archived'
);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000003', 'again',
  $$public.save_team_room('b2380000-0000-4000-8000-00000000000a', null, 'comercial',
    array['a2380000-0000-4000-8000-000000000003']::uuid[])$$);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'restore-taken',
  format($$public.archive_team_room('b2380000-0000-4000-8000-00000000000a', %L, null)$$, pg_temp.got('made', '{id}')));
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'edit-archived',
  format($$public.save_team_room('b2380000-0000-4000-8000-00000000000a', %L, 'Outro nome',
    array['a2380000-0000-4000-8000-000000000001']::uuid[])$$, pg_temp.got('made', '{id}')));
select ok(
  pg_temp.got('again', '{ok}') = 'true' and pg_temp.got('restore-taken', '{code}') = 'name_taken'
  and pg_temp.got('edit-archived', '{code}') = 'archived',
  'the name of an archived room is free, so it cannot come back while another room has it, nor be changed archived'
);
select pg_temp.as_person('a2380000-0000-4000-8000-000000000003', 'archive-other',
  format($$public.archive_team_room('b2380000-0000-4000-8000-00000000000a', %L, 'Feita por engano')$$,
    pg_temp.got('again', '{id}')));
select pg_temp.as_person('a2380000-0000-4000-8000-000000000001', 'restored',
  format($$public.archive_team_room('b2380000-0000-4000-8000-00000000000a', %L, null)$$, pg_temp.got('made', '{id}')));
select ok(
  pg_temp.got('restored', '{ok}') = 'true'
  and (select archived_at is null and archive_reason is null from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid),
  'and comes back, with its people, once the name is free'
);

-- 13. Who leaves the firm leaves its rooms, and the room is marked.
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
select public.chatwoot_finish_room(pg_temp.got('made', '{id}')::uuid, now(), true);
delete from public.memberships
where org_id = 'b2380000-0000-4000-8000-00000000000a' and user_id = 'a2380000-0000-4000-8000-000000000004';
select ok(
  (select array_agg(user_id) from public.chatwoot_room_members where room_id = pg_temp.got('made', '{id}')::uuid)
    = array['a2380000-0000-4000-8000-000000000001']::uuid[]
  and (select chatwoot_dirty_at > chatwoot_synced_at from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid),
  'who leaves the firm leaves the room, and the room is marked for the panel'
);

-- 14. Everything is on the record.
select is(
  (select array_agg(action order by action) from public.audit_events
   where org_id = 'b2380000-0000-4000-8000-00000000000a' and entity_type = 'chatwoot_room'),
  array['atendimento.room_archived', 'atendimento.room_archived', 'atendimento.room_changed',
        'atendimento.room_created', 'atendimento.room_created', 'atendimento.room_restored'],
  'each room made, changed, archived and brought back is on the record'
);

-- 15. The panel lost a room: forgotten, it is made there again.
select public.chatwoot_keep_room(pg_temp.got('made', '{id}')::uuid, target_forget => true);
select ok(
  (select chatwoot_inbox_id is null and chatwoot_conversation_id is null and chatwoot_members = '{}'
   from public.chatwoot_rooms where id = pg_temp.got('made', '{id}')::uuid),
  'a room the panel lost is forgotten, to be made there again'
);

select * from finish();
rollback;
