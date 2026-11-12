begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The firm's own words in ONE's messages (0191): who decides for the firm
-- writes a version, checked before it counts (the values it must carry,
-- none it does not know, no dash, no exclamation, no promise), kept as the
-- next version in force; going back to ONE's words and putting an earlier
-- version back. Two firms: nothing of one reaches the other.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1890000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-textos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1890000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-textos.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1890000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-textos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1890000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-textos', 'a1890000-0000-4000-8000-000000000001'),
  ('b1890000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-textos', 'a1890000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1890000-0000-4000-8000-00000000000a', 'a1890000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1890000-0000-4000-8000-00000000000a', 'a1890000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1890000-0000-4000-8000-00000000000b', 'a1890000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated')::text, true); $$;

-- Since 0236 no text needs a value: the link's is required here, inside this test, to see a missing one refused.
update public.one_messages set required = array['link'] where key = 'link_steps';

select pg_temp.sign_in('a1890000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('no_link', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps',
  'Oi, {nome}. O seu caso foi aberto pelo escritório.'));
insert into res values ('unknown', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps',
  'Oi, {cpf}. Abra o seu link: {link}'));
insert into res values ('bang', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps',
  'Oi, {nome}! Abra o seu link: {link}'));
insert into res values ('promise', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps',
  'Oi, {nome}. A sua indenização está garantida. Abra o seu link: {link}'));
insert into res values ('v1', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps',
  'Olá, {nome}. Seu caso {caso} foi aberto pelo escritório. Abra o seu link: {link}'));
insert into res values ('v2', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps',
  'Olá, {nome}. Siga os passos do seu link: {link}'));
reset role;

select ok(
  pg_temp.got('no_link', 'code') = 'missing_value' and pg_temp.got('no_link', 'value') = 'link'
  and pg_temp.got('unknown', 'code') = 'unknown_value' and pg_temp.got('bang', 'code') = 'copy_rules'
  and pg_temp.got('promise', 'code') = 'promise',
  'a text with no link, an unknown value, an exclamation or a promise is refused, saying why'
);

select ok(
  pg_temp.got('v1', 'version') = '1' and pg_temp.got('v2', 'version') = '2'
  and (select count(*) = 1 from public.firm_message_texts
       where org_id = 'b1890000-0000-4000-8000-00000000000a' and key = 'link_steps' and active)
  and (select body like '%Siga os passos%' from public.firm_message_texts
       where org_id = 'b1890000-0000-4000-8000-00000000000a' and key = 'link_steps' and active)
  and exists (select 1 from public.audit_events where action = 'firm_message.saved'),
  'each version is kept, the latest in force, on the record'
);

select pg_temp.sign_in('a1890000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('restored', public.restore_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps', 1));
reset role;
select ok(
  pg_temp.got('restored', 'code') = 'restored'
  and (select version = 1 from public.firm_message_texts
       where org_id = 'b1890000-0000-4000-8000-00000000000a' and key = 'link_steps' and active),
  'an earlier version is put back in force'
);

select pg_temp.sign_in('a1890000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('reset', public.reset_firm_message('b1890000-0000-4000-8000-00000000000a', 'link_steps'));
reset role;
select ok(
  pg_temp.got('reset', 'code') = 'reset'
  and not exists (select 1 from public.firm_message_texts
                  where org_id = 'b1890000-0000-4000-8000-00000000000a' and key = 'link_steps' and active)
  and (select count(*) = 2 from public.firm_message_texts where org_id = 'b1890000-0000-4000-8000-00000000000a'),
  'going back to ONE''s words keeps the versions, none in force'
);

-- Somebody of the attendance cannot change them; another firm reads nothing.
select pg_temp.sign_in('a1890000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('attendance', public.save_firm_message('b1890000-0000-4000-8000-00000000000a', 'declined',
  'Tudo bem, {nome}. Fique à vontade para voltar quando quiser.'));
reset role;
select pg_temp.sign_in('a1890000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  pg_temp.got('attendance', 'code') = 'not_allowed'
  and (select count(*) from public.firm_message_texts) = 0
  and (select count(*) from public.one_messages) >= 5,
  'only who decides for the firm writes them, and another firm reads nothing of them'
);
reset role;

select ok(
  not has_table_privilege('authenticated', 'public.firm_message_texts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.firm_message_texts', 'UPDATE'),
  'a text is written only through its function'
);

select * from finish();
rollback;
