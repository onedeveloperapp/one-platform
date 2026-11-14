begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- Who goes to a hearing, and who reports it (0247). Ana signs Lia's
-- lawsuit at firm A: a hearing written with nobody to go has Ana as who
-- goes, ONE's choice on the record. Ana writes from the WhatsApp of her
-- profile and reports her hearing and the one nobody goes to (ONE asks
-- which); Bruno, of the same firm, reports the one nobody goes to, but not
-- Ana's. Nothing of firm A
-- reaches firm B.
--
-- Every person, firm, name and number here is invented; the lawsuit's
-- number is of a year to come.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2470000-0000-4000-8000-000000000001', 'ana@lima-vai.invalid', 'Ana Lima'),
  ('a2470000-0000-4000-8000-000000000003', 'bruno@lima-vai.invalid', 'Bruno Lima'),
  ('a2470000-0000-4000-8000-000000000002', 'duda@rocha-vai.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2470000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-vai', 'a2470000-0000-4000-8000-000000000001'),
  ('b2470000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-vai', 'a2470000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2470000-0000-4000-8000-00000000000a', 'a2470000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2470000-0000-4000-8000-00000000000a', 'a2470000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('b2470000-0000-4000-8000-00000000000b', 'a2470000-0000-4000-8000-000000000002', 'owner', 'socio');
update public.profiles set whatsapp = '5500988884701' where id = 'a2470000-0000-4000-8000-000000000001';
update public.profiles set whatsapp = '5500988884703' where id = 'a2470000-0000-4000-8000-000000000003';
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2470000-0000-4000-8000-00000000000a', 'b2470000-0000-4000-8000-00000000000a', 'whatsapp', 'vai-waba-a', 'Chat de teste',
   'connected', 'a2470000-0000-4000-8000-000000000001', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2470000-0000-4000-8000-000000000001', 'b2470000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2470000-0000-4000-8000-000000000001', 'b2470000-0000-4000-8000-00000000000a', 'c2470000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2099-09-01');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('f2470000-0000-4000-8000-000000000001', 'a2470000-0000-4000-8000-000000000001', 'b2470000-0000-4000-8000-00000000000a');
-- Ana's hearing, written with nobody to go; and one of a lawsuit nobody signs, which nobody goes to.
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2470000-0000-4000-8000-000000000002', 'b2470000-0000-4000-8000-00000000000a', 'c2470000-0000-4000-8000-000000000001',
   'comum', 'TJGO', 'filed', '10003021220998090100', '2099-09-01');
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('a2470000-0000-4000-8000-0000000000a1', 'b2470000-0000-4000-8000-00000000000a', 'c2470000-0000-4000-8000-000000000001',
   'f2470000-0000-4000-8000-000000000001', 'conciliacao', now() - interval '20 minutes', 'America/Sao_Paulo', 'presencial'),
  ('a2470000-0000-4000-8000-0000000000a2', 'b2470000-0000-4000-8000-00000000000a', 'c2470000-0000-4000-8000-000000000001',
   'f2470000-0000-4000-8000-000000000002', 'conciliacao', now() - interval '30 minutes', 'America/Sao_Paulo', 'presencial');

select is((select attendee_user_id from public.hearings where id = 'a2470000-0000-4000-8000-0000000000a1'),
  'a2470000-0000-4000-8000-000000000001'::uuid, 'a hearing with nobody to go has the lawsuit''s lawyer');
select ok(
  exists (select 1 from public.case_events where case_id = 'c2470000-0000-4000-8000-000000000001'
          and kind = 'hearing_attendee_by_one' and data ->> 'hearing' = 'a2470000-0000-4000-8000-0000000000a1'),
  'as ONE''s choice, on the record');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.report(phone text) returns jsonb language plpgsql as $$
declare
  conversation uuid;
  claim integer;
begin
  conversation := (public.wa_ingest_inbound('b2470000-0000-4000-8000-00000000000a',
     (select n.id from public.wa_numbers n where n.org_id = 'b2470000-0000-4000-8000-00000000000a' and n.provider = 'test'),
     phone, 'Advogada', 'test.in.' || gen_random_uuid(), 'text', 'Não teve acordo, vai para a sentença') ->> 'conversation_id')::uuid;
  claim := ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
  return public.conversation_hearing_report(conversation, claim);
end;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number', public.register_wa_number('b2470000-0000-4000-8000-00000000000a',
  'c2470000-0000-4000-8000-00000000000a', 'test', 'vai-number-a', 'vai-waba-a', '5500900000471', 'Lima Advocacia', 'cloud'));
insert into res values ('ana', pg_temp.report('5500988884701'));
insert into res values ('bruno', pg_temp.report('5500988884703'));
insert into res values ('stranger', pg_temp.report('5500988884799'));
reset role;

select is(
  (select jsonb_build_object('code', payload ->> 'code', 'hearing', payload -> 'hearings' -> 0 ->> 'hearing_id')
   from res where name = 'ana'),
  '{"code": "many", "hearing": "a2470000-0000-4000-8000-0000000000a1"}'::jsonb,
  'Ana reports the hearing she goes to, the closest first, and the one nobody goes to, from the WhatsApp of her profile');
select is(
  (select jsonb_build_object('code', payload ->> 'code', 'hearing', payload -> 'hearings' -> 0 ->> 'hearing_id')
   from res where name = 'bruno'),
  '{"code": "one", "hearing": "a2470000-0000-4000-8000-0000000000a2"}'::jsonb,
  'Bruno reports the hearing nobody goes to, never Ana''s');
select is((select payload ->> 'code' from res where name = 'stranger'), 'none',
  'a number of nobody of the firm reports nothing');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2470000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::integer from public.hearings where org_id = 'b2470000-0000-4000-8000-00000000000a'), 0,
  'another firm reads none of its hearings');
reset role;

select * from finish();
rollback;
