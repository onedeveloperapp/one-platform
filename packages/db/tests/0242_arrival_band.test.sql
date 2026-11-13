begin;
create extension if not exists pgtap;
select plan(3);

-- ============================================================
-- The arrival asked with its options (0242): Lia chose "Mais de quatro
-- horas" in the chat, and her intake keeps the band with the other facts;
-- anything else under that name is not kept. Nothing of it reaches the
-- other firm.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2420000-0000-4000-8000-000000000001', 'ana@lima-faixa.invalid', 'Ana Lima'),
  ('a2420000-0000-4000-8000-000000000002', 'duda@rocha-faixa.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2420000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-faixa', 'a2420000-0000-4000-8000-000000000001'),
  ('b2420000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-faixa', 'a2420000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2420000-0000-4000-8000-00000000000a', 'a2420000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2420000-0000-4000-8000-00000000000b', 'a2420000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2420000-0000-4000-8000-00000000000a', 'b2420000-0000-4000-8000-00000000000a', 'whatsapp', 'faixa-waba-a', 'Chat de teste',
   'connected', 'a2420000-0000-4000-8000-000000000001', now());

update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number', public.register_wa_number('b2420000-0000-4000-8000-00000000000a',
  'c2420000-0000-4000-8000-00000000000a', 'test', 'faixa-number-a', 'faixa-waba-a', '5500900000421', 'Lima Advocacia', 'cloud'));
insert into res values ('lia', jsonb_build_object('conversation',
  (public.wa_ingest_inbound('b2420000-0000-4000-8000-00000000000a',
     (select n.id from public.wa_numbers n where n.org_id = 'b2420000-0000-4000-8000-00000000000a' and n.provider = 'test'),
     '5500988884201', 'Lia Teste', 'test.in.' || gen_random_uuid(), 'text', '2') ->> 'conversation_id')));
insert into res values ('claim', jsonb_build_object('claim',
  ((public.claim_conversation_turns(1, pg_temp.got('lia', 'conversation')::uuid) -> 0) ->> 'claim')::integer));
insert into res values ('kept', public.record_conversation_intake(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('claim', 'claim')::integer,
  '{"problema": "cancellation", "data": "2099-10-22", "aviso": "late", "atraso_faixa": "mais_4"}'::jsonb));
select is(
  (select payload -> 'facts' ->> 'atraso_faixa' from res where name = 'kept'),
  'mais_4', 'the band she chose is kept with the other facts');
reset role;

select is(
  public.intake_facts_clean('{"atraso_faixa": "seis horas"}'::jsonb) ? 'atraso_faixa',
  false, 'anything else under that name is not');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2420000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.wa_conversations where id = pg_temp.got('lia', 'conversation')::uuid),
  0, 'another firm reads not her conversation');
reset role;

select * from finish();
rollback;
