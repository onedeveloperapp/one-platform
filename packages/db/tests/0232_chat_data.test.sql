begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The chat's script, its fourth part (0232): the passenger's data of the
-- case a conversation gathers, the check owed once the identity and the
-- proof of address were accepted, started once with its step kept, the
-- client's confirmation clearing what was read, a field written through the
-- link's checks, and the case marked checked. Two firms: nothing of one
-- reaches the other.
--
-- Every person, firm, number and fact here is invented; the CPF is one every
-- manual uses as an example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2320000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-dados.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2320000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-dados.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2320000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-dados', 'a2320000-0000-4000-8000-000000000001'),
  ('b2320000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-dados', 'a2320000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2320000-0000-4000-8000-00000000000a', 'a2320000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2320000-0000-4000-8000-00000000000b', 'a2320000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2320000-0000-4000-8000-00000000000a', 'b2320000-0000-4000-8000-00000000000a', 'whatsapp', 'dados-waba-a', 'Chat de teste',
   'connected', 'a2320000-0000-4000-8000-000000000001', now()),
  ('c2320000-0000-4000-8000-00000000000b', 'b2320000-0000-4000-8000-00000000000b', 'whatsapp', 'dados-waba-b', 'Chat de teste',
   'connected', 'a2320000-0000-4000-8000-000000000004', now());
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
create function pg_temp.person() returns jsonb language sql as $$
  select public.conversation_person(pg_temp.got('nidia', 'conversation')::uuid, pg_temp.got('nidia_claim', 'claim')::integer);
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2320000-0000-4000-8000-00000000000a',
  'c2320000-0000-4000-8000-00000000000a', 'test', 'dados-number-a', 'dados-waba-a', '5500900000321', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2320000-0000-4000-8000-00000000000b',
  'c2320000-0000-4000-8000-00000000000b', 'test', 'dados-number-b', 'dados-waba-b', '5500900000322', 'Rocha Advocacia', 'cloud'));
insert into res values ('nidia', jsonb_build_object('conversation',
  pg_temp.writes('b2320000-0000-4000-8000-00000000000a', '5500988883201', 'meu voo cancelou')));
insert into res values ('nidia_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('nidia', 'conversation')::uuid)));
insert into res values ('nidia_kept', public.record_conversation_intake(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer,
  '{"nome": "Nídia Teste", "problema": "cancellation", "companhia": "AD", "voo": "AD 4040", "data": "2099-10-25", "aviso": "late", "acompanhantes": "nenhum"}'::jsonb));
insert into res values ('opened', public.one_open_case_from_intake(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, repeat('c', 64), 'Pronto, Nídia. O seu caso está aberto. https://one.invalid/c/y'));
insert into res values ('other', jsonb_build_object('conversation',
  pg_temp.writes('b2320000-0000-4000-8000-00000000000b', '5500988883201', 'bom dia')));
insert into res values ('other_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('other', 'conversation')::uuid)));

select is((pg_temp.person()) ->> 'documents_in', 'false', 'with no document accepted, nothing was read to check');

-- Her identity and proof of address are accepted, and ONE read what they say.
reset role;
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e2320000-0000-4000-8000-000000000001', 'b2320000-0000-4000-8000-00000000000a', 'whatsapp', 'org/b2320000-0000-4000-8000-00000000000a/whatsapp/e2320000-0000-4000-8000-000000000001',
   'identidade.jpg', 'image/jpeg', 100, 'stored', repeat('1', 64), 100, 'image/jpeg', now() + interval '1 hour', now()),
  ('e2320000-0000-4000-8000-000000000002', 'b2320000-0000-4000-8000-00000000000a', 'whatsapp', 'org/b2320000-0000-4000-8000-00000000000a/whatsapp/e2320000-0000-4000-8000-000000000002',
   'conta.jpg', 'image/jpeg', 100, 'stored', repeat('2', 64), 100, 'image/jpeg', now() + interval '1 hour', now());
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, decided_at)
select 'b2320000-0000-4000-8000-00000000000a', cp.case_id, cp.id, f.file_id, f.kind, 'whatsapp', 'accepted', now()
from public.case_parties cp
cross join (values ('e2320000-0000-4000-8000-000000000001'::uuid, 'identity'), ('e2320000-0000-4000-8000-000000000002'::uuid, 'address_proof')) as f (file_id, kind)
where cp.case_id = pg_temp.got('opened', 'case_id')::uuid;
update public.people p set cpf = '12345678909', birth_date = '1990-03-14', nationality = 'brasileira',
  read_fields = '{"cpf": {"kind": "identity"}, "birth_date": {"kind": "identity"}}'::jsonb
from public.case_parties cp where cp.case_id = pg_temp.got('opened', 'case_id')::uuid and p.id = cp.person_id;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select ok(
  exists (select 1 from public.chat_data_checks_owed(100) o where o.conversation_id = pg_temp.got('nidia', 'conversation')::uuid),
  'once both were accepted, the check of her data is owed'
);
insert into res values ('started', public.one_start_data_check(pg_temp.got('nidia', 'conversation')::uuid, 'Confira os seus dados, Nídia.'));
select is(pg_temp.got('started', 'code'), 'queued', 'ONE starts it in the chat');
select ok(
  (pg_temp.person()) -> 'step' ->> 'step' = 'dados'
    and not exists (select 1 from public.chat_data_checks_owed(100) o where o.conversation_id = pg_temp.got('nidia', 'conversation')::uuid),
  'and waits for her answer, never starting it twice'
);

insert into res values ('confirmed', public.one_person_fields(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, '{}'::jsonb, true));
select is(
  (select p.read_fields from public.people p join public.case_parties cp on cp.person_id = p.id
   where cp.case_id = pg_temp.got('opened', 'case_id')::uuid),
  '{}'::jsonb,
  'what she confirms is hers: the marks of what was read go'
);

insert into res values ('marital', public.one_person_fields(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, '{"marital_status": "casado"}'::jsonb));
insert into res values ('odd', public.one_person_fields(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, '{"marital_status": "inventado"}'::jsonb));
select ok(
  (pg_temp.got('marital', 'ok'))::boolean and not (pg_temp.got('odd', 'ok'))::boolean
    and (pg_temp.person()) ->> 'marital_status' = 'casado',
  'a field she writes goes through the link''s checks'
);

insert into res values ('done', public.record_chat_step(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, '{}'::jsonb, pg_temp.got('opened', 'case_id')::uuid));
select ok(
  ((pg_temp.person()) ->> 'checked')::boolean and coalesce((pg_temp.person()) -> 'step' ->> 'step', '') = '',
  'the case is marked checked, with no step waiting'
);

select is(
  public.conversation_person(pg_temp.got('other', 'conversation')::uuid, pg_temp.got('other_claim', 'claim')::integer) ->> 'code',
  'no_case',
  'the same number at firm B reads nothing of firm A'
);

reset role;
select set_config('request.jwt.claims', '', true);
select ok(
  not has_function_privilege('authenticated', 'public.one_person_fields(uuid, integer, jsonb, boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.chat_data_checks_owed(integer)', 'EXECUTE'),
  'only the backend writes and reads it'
);

select * from finish();
rollback;
