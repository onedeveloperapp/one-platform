begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- Who goes to a hearing: the team's WhatsApp, and attendees from outside
-- the firm (0251). Firm A has its main number connected. Bia says her
-- WhatsApp; Ana cannot say the firm's number nor Bia's as hers. Ana keeps
-- Rui, an attendee from outside, in the firm's list, and chooses him for a
-- hearing, then Bia; a name and a WhatsApp written on a hearing join the
-- list; an attendee taken out of it is chosen no more. The firm connects no
-- second number. Nothing of firm A reaches firm B.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2510000-0000-4000-8000-000000000001', 'ana@lima-equipe.invalid', 'Ana Lima'),
  ('a2510000-0000-4000-8000-000000000002', 'bia@lima-equipe.invalid', 'Bia Souza'),
  ('a2510000-0000-4000-8000-000000000003', 'duda@rocha-equipe.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2510000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-equipe', 'a2510000-0000-4000-8000-000000000001'),
  ('b2510000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-equipe', 'a2510000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2510000-0000-4000-8000-00000000000a', 'a2510000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2510000-0000-4000-8000-00000000000a', 'a2510000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2510000-0000-4000-8000-00000000000b', 'a2510000-0000-4000-8000-000000000003', 'owner', 'socio');

-- Firm A's main number, connected.
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d2510000-0000-4000-8000-00000000000a', 'b2510000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-lima', 'WhatsApp',
   'connected', 'a2510000-0000-4000-8000-000000000001', now()),
  ('d2510000-0000-4000-8000-00000000000c', 'b2510000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-lima-2', 'WhatsApp',
   'connected', 'a2510000-0000-4000-8000-000000000001', now());
insert into public.wa_numbers (org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('b2510000-0000-4000-8000-00000000000a', 'd2510000-0000-4000-8000-00000000000a', 'meta', 'pn-lima', 'waba-lima', '5562999990000');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2510000-0000-4000-8000-000000000001', 'b2510000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2510000-0000-4000-8000-000000000001', 'b2510000-0000-4000-8000-00000000000a', 'c2510000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2099-09-01');
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('a2510000-0000-4000-8000-0000000000a1', 'b2510000-0000-4000-8000-00000000000a', 'c2510000-0000-4000-8000-000000000001',
   'f2510000-0000-4000-8000-000000000001', 'conciliacao', now() + interval '10 days', 'America/Sao_Paulo', 'presencial'),
  ('a2510000-0000-4000-8000-0000000000a2', 'b2510000-0000-4000-8000-00000000000a', 'c2510000-0000-4000-8000-000000000001',
   'f2510000-0000-4000-8000-000000000001', 'instrucao', now() + interval '20 days', 'America/Sao_Paulo', 'presencial');

create temp table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(key text, field text) returns text language sql as $$
  select payload ->> field from res where name = key
$$;

-- Bia says her WhatsApp; Ana tries the firm's number, then Bia's.
select set_config('request.jwt.claims', '{"sub":"a2510000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into res values ('bia', public.set_my_whatsapp('(62) 98888-0001'));
reset role;
select set_config('request.jwt.claims', '{"sub":"a2510000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into res values ('ana_firm', public.set_my_whatsapp('62 99999-0000'));
insert into res values ('ana_bia', public.set_my_whatsapp('5562988880001'));
-- Ana keeps Rui in the firm's list, and is refused the firm's number, Bia's and a name of one letter.
insert into res values ('rui', public.save_hearing_contact('b2510000-0000-4000-8000-00000000000a', ' Rui  Audientista ', '62 97777-0001'));
insert into res values ('contact_bia', public.save_hearing_contact('b2510000-0000-4000-8000-00000000000a', 'Bia', '62988880001'));
insert into res values ('contact_firm', public.save_hearing_contact('b2510000-0000-4000-8000-00000000000a', 'Firma', '5562999990000'));
insert into res values ('contact_short', public.save_hearing_contact('b2510000-0000-4000-8000-00000000000a', 'R', '62 97777-0002'));
-- She chooses Rui for the conciliation.
insert into res values ('chose_rui', public.set_hearing_attendee('a2510000-0000-4000-8000-0000000000a1', null, pg_temp.got('rui', 'id')::uuid));
reset role;

select is(
  (select whatsapp from public.profiles where id = 'a2510000-0000-4000-8000-000000000002')
  || ' ' || pg_temp.got('ana_firm', 'code') || ' ' || pg_temp.got('ana_bia', 'code'),
  '5562988880001 firm_number member_number',
  'each person says their own WhatsApp, never the firm''s number nor a colleague''s');
select is(
  (select name || ' ' || phone from public.hearing_contacts where id = pg_temp.got('rui', 'id')::uuid),
  'Rui Audientista 5562977770001', 'an attendee from outside is kept in the firm''s list with their WhatsApp');
select is(
  pg_temp.got('contact_bia', 'code') || ' ' || pg_temp.got('contact_firm', 'code') || ' ' || pg_temp.got('contact_short', 'field'),
  'member_number firm_number name', 'never a colleague, the firm''s number nor a name of one letter');
select ok(
  (select attendee_name = 'Rui Audientista' and attendee_phone = '5562977770001' and attendee_user_id is null
          and attendee_contact_id = pg_temp.got('rui', 'id')::uuid
   from public.hearings where id = 'a2510000-0000-4000-8000-0000000000a1')
  and exists (select 1 from public.case_events where kind = 'hearing_attendee_set'
              and data ->> 'contact' = pg_temp.got('rui', 'id') and actor_type = 'person'),
  'chosen for a hearing, ONE writes to his WhatsApp and knows his report by it, on the case''s record');

-- Then Bia goes instead; the instruction is written with somebody from outside, by name and WhatsApp.
select set_config('request.jwt.claims', '{"sub":"a2510000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into res values ('chose_bia', public.set_hearing_attendee('a2510000-0000-4000-8000-0000000000a1', 'a2510000-0000-4000-8000-000000000002', null));
insert into res values ('chose_bia_again', public.set_hearing_attendee('a2510000-0000-4000-8000-0000000000a1', 'a2510000-0000-4000-8000-000000000002', null));
reset role;
update public.hearings set attendee_user_id = null, attendee_name = 'Sol Correspondente', attendee_phone = '5562966660001'
where id = 'a2510000-0000-4000-8000-0000000000a2';

select ok(
  (select attendee_user_id = 'a2510000-0000-4000-8000-000000000002' and attendee_contact_id is null
          and attendee_name is null and attendee_phone is null
   from public.hearings where id = 'a2510000-0000-4000-8000-0000000000a1')
  and pg_temp.got('chose_bia_again', 'code') = 'unchanged',
  'a colleague chosen instead takes the attendee from outside off the hearing');
select ok(
  (select h.attendee_contact_id = c.id and c.name = 'Sol Correspondente'
   from public.hearings h join public.hearing_contacts c on c.phone = '5562966660001' and c.org_id = h.org_id
   where h.id = 'a2510000-0000-4000-8000-0000000000a2'),
  'a name and a WhatsApp written on a hearing join the firm''s list');

-- Rui leaves the list: chosen no more.
select set_config('request.jwt.claims', '{"sub":"a2510000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into res values ('archived', public.archive_hearing_contact(pg_temp.got('rui', 'id')::uuid));
insert into res values ('chose_archived', public.set_hearing_attendee('a2510000-0000-4000-8000-0000000000a1', null, pg_temp.got('rui', 'id')::uuid));
reset role;
select is(
  pg_temp.got('archived', 'code') || ' ' || pg_temp.got('chose_archived', 'code'),
  'archived not_found', 'an attendee taken out of the list is chosen no more');

-- Bia becomes the WhatsApp an attendee had: the attendee leaves the list, it is a person of the firm now.
select set_config('request.jwt.claims', '{"sub":"a2510000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into res values ('bia_sol', public.set_my_whatsapp('62 96666-0001'));
reset role;
select ok(
  pg_temp.got('bia_sol', 'code') = 'saved'
  and (select archived_at is not null from public.hearing_contacts where phone = '5562966660001'),
  'the attendee whose WhatsApp a person of the firm takes leaves the list');

-- The firm connects no second number; the one it has is connected again.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('second', public.register_wa_number('b2510000-0000-4000-8000-00000000000a',
  'd2510000-0000-4000-8000-00000000000c', 'meta', 'pn-lima-2', 'waba-lima-2', '5562999991111'));
insert into res values ('again', public.register_wa_number('b2510000-0000-4000-8000-00000000000a',
  'd2510000-0000-4000-8000-00000000000a', 'meta', 'pn-lima', 'waba-lima', '5562999990000'));
reset role;
select is(
  pg_temp.got('second', 'code') || ' ' || pg_temp.got('again', 'code'),
  'firm_has_number registered', 'the firm has one WhatsApp: a second number is refused, its own connected again');

-- Nothing of firm A reaches firm B.
select set_config('request.jwt.claims', '{"sub":"a2510000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::integer from public.hearing_contacts), 0, 'another firm reads none of the firm''s attendees');
insert into res values ('b_contact', public.save_hearing_contact('b2510000-0000-4000-8000-00000000000a', 'Zeca', '62 95555-0001'));
insert into res values ('b_attendee', public.set_hearing_attendee('a2510000-0000-4000-8000-0000000000a2', 'a2510000-0000-4000-8000-000000000003', null));
reset role;
select is(
  pg_temp.got('b_contact', 'code') || ' ' || pg_temp.got('b_attendee', 'code'),
  'not_found not_found', 'nor keeps one in its list, nor chooses who goes to its hearing');
select ok(
  not has_table_privilege('authenticated', 'public.hearing_contacts', 'INSERT')
  and not has_function_privilege('anon', 'public.save_hearing_contact(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.register_wa_number(uuid, uuid, text, text, text, text, text, text)', 'EXECUTE'),
  'the list is written only through its functions');

select * from finish();
rollback;
