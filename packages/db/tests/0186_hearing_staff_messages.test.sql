begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The hearing on WhatsApp, for who goes (0188): once a hearing passed its
-- time with nothing said of it, ONE asks who went for the result, as the
-- firm's template, once; the brief is told the same way; somebody with no
-- WhatsApp is skipped with why and never tried again. Two firms: nothing of
-- one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1860000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-equipe.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1860000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-equipe.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1860000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-equipe', 'a1860000-0000-4000-8000-000000000001'),
  ('b1860000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-equipe', 'a1860000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1860000-0000-4000-8000-00000000000a', 'a1860000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1860000-0000-4000-8000-00000000000b', 'a1860000-0000-4000-8000-000000000002', 'owner', 'socio');
update public.profiles set whatsapp = '5500988880009' where id = 'a1860000-0000-4000-8000-000000000001';
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c1860000-0000-4000-8000-00000000000a', 'b1860000-0000-4000-8000-00000000000a', 'whatsapp', 'staff-waba-a', 'Chat de teste',
   'connected', 'a1860000-0000-4000-8000-000000000001', now());
insert into public.cases (id, org_id, seq, module, incident, status, is_test) values
  ('c1860000-0000-4000-8000-000000000001', 'b1860000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', true);
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1860000-0000-4000-8000-000000000001', 'b1860000-0000-4000-8000-00000000000a', 'c1860000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
-- Ana went to one hearing two hours ago; somebody from outside, with no WhatsApp on record, to another.
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, attendee_user_id, attendee_name) values
  ('a7860000-0000-4000-8000-000000000001', 'b1860000-0000-4000-8000-00000000000a', 'c1860000-0000-4000-8000-000000000001',
   'f1860000-0000-4000-8000-000000000001', 'conciliacao', now() - interval '2 hours', 'America/Sao_Paulo', 'videoconferencia',
   'a1860000-0000-4000-8000-000000000001', null),
  ('a7860000-0000-4000-8000-000000000002', 'b1860000-0000-4000-8000-00000000000a', 'c1860000-0000-4000-8000-000000000001',
   'f1860000-0000-4000-8000-000000000001', 'instrucao', now() - interval '3 hours', 'America/Sao_Paulo', 'videoconferencia',
   null, 'Rui Fora');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b1860000-0000-4000-8000-00000000000a',
  'c1860000-0000-4000-8000-00000000000a', 'test', 'staff-number-a', 'staff-waba-a', '5500900000091', 'Souza Advogados', 'cloud'));
insert into res values ('chat', public.start_test_chat('b1860000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('e', 43), 'a1860000-0000-4000-8000-000000000001'));
insert into res values ('owed', jsonb_build_object('list', public.hearing_results_owed(10)));
insert into res values ('asked', public.reserve_hearing_staff_message('a7860000-0000-4000-8000-000000000001', 'hearing_result',
  array['Ana', 'audiência de conciliação do caso 1', 'hoje, às 14:00']));
insert into res values ('again', public.reserve_hearing_staff_message('a7860000-0000-4000-8000-000000000001', 'hearing_result',
  array['Ana', 'audiência de conciliação do caso 1', 'hoje, às 14:00']));
insert into res values ('outsider', public.reserve_hearing_staff_message('a7860000-0000-4000-8000-000000000002', 'hearing_brief',
  array['Rui', 'audiência de instrução e julgamento do caso 1', 'hoje, às 13:00']));
insert into res values ('owed_after', jsonb_build_object('list', public.hearing_results_owed(10)));
reset role;

select ok(
  (select jsonb_array_length(payload -> 'list') = 1
          and payload #>> '{list,0,hearing_id}' = 'a7860000-0000-4000-8000-000000000001'
   from res where name = 'owed'),
  'the result is owed of a hearing past its time whose attendee has a WhatsApp'
);

select ok(
  pg_temp.got('asked', 'code') = 'queued' and pg_temp.got('again', 'code') = 'already'
  and (select body like 'Olá, Ana. Como foi a audiência de conciliação do caso 1%' and status = 'queued' and kind = 'template'
       from public.wa_messages where id = pg_temp.got('asked', 'message_id')::uuid)
  and (select contact_wa_id = '5500988880009' from public.wa_conversations
       where id = pg_temp.got('asked', 'conversation_id')::uuid)
  and (select jsonb_array_length(payload -> 'list') = 0 from res where name = 'owed_after')
  and exists (select 1 from public.case_events e where e.kind = 'hearing_result_asked' and e.actor_type = 'system'),
  'ONE asks once, as the firm''s template, at the WhatsApp of the attendee''s profile'
);

select ok(
  pg_temp.got('outsider', 'code') = 'skipped' and pg_temp.got('outsider', 'reason') = 'no_phone'
  and (select status = 'skipped' and reason = 'no_phone' from public.hearing_staff_messages
       where hearing_id = 'a7860000-0000-4000-8000-000000000002' and kind = 'hearing_brief'),
  'somebody with no WhatsApp is skipped with why, for good'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1860000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.hearing_staff_messages), 0, 'another firm reads nothing of it');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.reserve_hearing_staff_message(uuid, text, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.hearing_results_owed(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.hearing_staff_phone(uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.hearing_staff_messages', 'INSERT'),
  'only the backend writes to who goes'
);

select * from finish();
rollback;
