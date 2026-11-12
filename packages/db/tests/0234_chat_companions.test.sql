begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The chat's script, its sixth part (0234): a child the passenger named in
-- the intake joins the case as a claimant the passenger answers for, and the
-- case asks the child's paper as a child's. Two firms: nothing of one
-- reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2340000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-filhos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2340000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-filhos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2340000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-filhos', 'a2340000-0000-4000-8000-000000000001'),
  ('b2340000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-filhos', 'a2340000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2340000-0000-4000-8000-00000000000a', 'a2340000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2340000-0000-4000-8000-00000000000b', 'a2340000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2340000-0000-4000-8000-00000000000a', 'b2340000-0000-4000-8000-00000000000a', 'whatsapp', 'filhos-waba-a', 'Chat de teste',
   'connected', 'a2340000-0000-4000-8000-000000000001', now()),
  ('c2340000-0000-4000-8000-00000000000b', 'b2340000-0000-4000-8000-00000000000b', 'whatsapp', 'filhos-waba-b', 'Chat de teste',
   'connected', 'a2340000-0000-4000-8000-000000000004', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Nídia Teste', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;
create function pg_temp.owed() returns jsonb language sql as $$
  select public.conversation_papers_owed(pg_temp.got('nidia', 'conversation')::uuid, pg_temp.got('nidia_claim', 'claim')::integer);
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2340000-0000-4000-8000-00000000000a',
  'c2340000-0000-4000-8000-00000000000a', 'test', 'filhos-number-a', 'filhos-waba-a', '5500900000341', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2340000-0000-4000-8000-00000000000b',
  'c2340000-0000-4000-8000-00000000000b', 'test', 'filhos-number-b', 'filhos-waba-b', '5500900000342', 'Rocha Advocacia', 'cloud'));

-- Nídia's case opens in firm A from her intake; she writes to firm B too.
insert into res values ('nidia', jsonb_build_object('conversation',
  pg_temp.writes('b2340000-0000-4000-8000-00000000000a', '5500988883401', 'meu voo cancelou')));
insert into res values ('nidia_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('nidia', 'conversation')::uuid)));
insert into res values ('nidia_kept', public.record_conversation_intake(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer,
  '{"nome": "Nídia Teste", "problema": "cancellation", "companhia": "AD", "voo": "AD 4040", "data": "2099-10-25", "aviso": "late", "acompanhantes": "nenhum"}'::jsonb));
insert into res values ('opened', public.one_open_case_from_intake(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, repeat('b', 64), 'Pronto, Nídia. O seu caso está aberto. https://one.invalid/c/x',
  '[{"name": "Pedro Teste", "age": 8}, {"name": "x", "age": 5}]'::jsonb));
insert into res values ('other', jsonb_build_object('conversation',
  pg_temp.writes('b2340000-0000-4000-8000-00000000000b', '5500988883401', 'bom dia')));
insert into res values ('other_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('other', 'conversation')::uuid)));

select is(pg_temp.got('opened', 'code'), 'opened', 'the case opens with the child named');
select is(
  (select jsonb_agg(jsonb_build_object('name', p.full_name, 'role', cp.role, 'answered', cp.guardian_id is not null)
                    order by cp.role, p.full_name)
   from public.case_parties cp join public.people p on p.id = cp.person_id
   where cp.case_id = pg_temp.got('opened', 'case_id')::uuid),
  '[{"name": "Nídia Teste", "role": "claimant", "answered": false},
    {"name": "Pedro Teste", "role": "claimant", "answered": true},
    {"name": "Nídia Teste", "role": "guardian", "answered": false}]'::jsonb,
  'the child is a claimant she answers for, and a name that is no name is left out'
);
insert into res values ('owed', pg_temp.owed());
select ok(
  (select bool_and((o ->> 'minor')::boolean and not (o ->> 'own')::boolean)
   from jsonb_array_elements(pg_temp.got('owed', 'owed')::jsonb) o where o ->> 'name' = 'Pedro Teste'),
  'his paper is asked as a child''s, before his birth date is read'
);
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.got('owed', 'owed')::jsonb) o where o ->> 'kind' = 'identity'),
  2,
  'an identity is owed of each claimant'
);
select is(
  (select count(*)::int from public.cases where org_id = 'b2340000-0000-4000-8000-00000000000b'), 0,
  'nothing reaches firm B'
);

select * from finish();
rollback;
