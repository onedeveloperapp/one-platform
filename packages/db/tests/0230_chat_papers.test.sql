begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The chat's script, its second part (0230): the case a conversation
-- gathers says what it still owes of its documents, by whose each is, the
-- refused one marked, and the client's "Não tenho" to the dispensable ones
-- is kept as on their link. Two firms: nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-papeis.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-papeis.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-papeis', 'a2300000-0000-4000-8000-000000000001'),
  ('b2300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-papeis', 'a2300000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2300000-0000-4000-8000-00000000000a', 'a2300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2300000-0000-4000-8000-00000000000b', 'a2300000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2300000-0000-4000-8000-00000000000a', 'b2300000-0000-4000-8000-00000000000a', 'whatsapp', 'papeis-waba-a', 'Chat de teste',
   'connected', 'a2300000-0000-4000-8000-000000000001', now()),
  ('c2300000-0000-4000-8000-00000000000b', 'b2300000-0000-4000-8000-00000000000b', 'whatsapp', 'papeis-waba-b', 'Chat de teste',
   'connected', 'a2300000-0000-4000-8000-000000000004', now());
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
insert into res values ('number_a', public.register_wa_number('b2300000-0000-4000-8000-00000000000a',
  'c2300000-0000-4000-8000-00000000000a', 'test', 'papeis-number-a', 'papeis-waba-a', '5500900000301', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2300000-0000-4000-8000-00000000000b',
  'c2300000-0000-4000-8000-00000000000b', 'test', 'papeis-number-b', 'papeis-waba-b', '5500900000302', 'Rocha Advocacia', 'cloud'));

-- Nídia's case opens in firm A from her intake; she writes to firm B too.
insert into res values ('nidia', jsonb_build_object('conversation',
  pg_temp.writes('b2300000-0000-4000-8000-00000000000a', '5500988882301', 'meu voo cancelou')));
insert into res values ('nidia_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('nidia', 'conversation')::uuid)));
insert into res values ('nidia_kept', public.record_conversation_intake(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer,
  '{"nome": "Nídia Teste", "problema": "cancellation", "companhia": "AD", "voo": "AD 4040", "data": "2099-10-25", "aviso": "late", "acompanhantes": "nenhum"}'::jsonb));
insert into res values ('opened', public.one_open_case_from_intake(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer, repeat('b', 64), 'Pronto, Nídia. O seu caso está aberto. https://one.invalid/c/x'));
insert into res values ('other', jsonb_build_object('conversation',
  pg_temp.writes('b2300000-0000-4000-8000-00000000000b', '5500988882301', 'bom dia')));
insert into res values ('other_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('other', 'conversation')::uuid)));

insert into res values ('first', pg_temp.owed());
select is(
  (select jsonb_agg(o ->> 'kind') from jsonb_array_elements(pg_temp.got('first', 'owed')::jsonb) o),
  '["identity", "address_proof", "ticket"]'::jsonb,
  'a new case owes the identity, the proof of address and the ticket, in that order'
);
select ok(
  (select bool_and((o ->> 'own')::boolean and not (o ->> 'rejected')::boolean)
   from jsonb_array_elements(pg_temp.got('first', 'owed')::jsonb) o),
  'each is the passenger''s own, none refused'
);

reset role;
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e2300000-0000-4000-8000-000000000001', 'b2300000-0000-4000-8000-00000000000a', 'whatsapp', 'org/b2300000-0000-4000-8000-00000000000a/whatsapp/e2300000-0000-4000-8000-000000000001',
   'identidade.jpg', 'image/jpeg', 100, 'stored', repeat('1', 64), 100, 'image/jpeg', now() + interval '1 hour', now()),
  ('e2300000-0000-4000-8000-000000000002', 'b2300000-0000-4000-8000-00000000000a', 'whatsapp', 'org/b2300000-0000-4000-8000-00000000000a/whatsapp/e2300000-0000-4000-8000-000000000002',
   'conta.jpg', 'image/jpeg', 100, 'stored', repeat('2', 64), 100, 'image/jpeg', now() + interval '1 hour', now());
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, rejected_reason, decided_at)
select 'b2300000-0000-4000-8000-00000000000a', cp.case_id, cp.id, f.file_id, f.kind, 'whatsapp', f.status, f.reason, f.decided
from public.case_parties cp
cross join (values
  ('e2300000-0000-4000-8000-000000000001'::uuid, 'identity', 'received', null, null::timestamptz),
  ('e2300000-0000-4000-8000-000000000002'::uuid, 'address_proof', 'rejected', 'A foto ficou escura.', now())
) as f (file_id, kind, status, reason, decided)
where cp.case_id = pg_temp.got('opened', 'case_id')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into res values ('second', pg_temp.owed());
select is(
  (select jsonb_agg(o ->> 'kind') from jsonb_array_elements(pg_temp.got('second', 'owed')::jsonb) o),
  '["address_proof", "ticket"]'::jsonb,
  'an identity on its way counts, a refused proof of address is still owed'
);
select is(
  (select (o ->> 'rejected')::boolean from jsonb_array_elements(pg_temp.got('second', 'owed')::jsonb) o
   where o ->> 'kind' = 'address_proof'),
  true,
  'the refused one is marked, so ONE does not ask it over the line that says why'
);
select ok(
  (pg_temp.got('second', 'waits_signature'))::boolean
    and (select bool_and(d ->> 'state' = 'later') from jsonb_array_elements(pg_temp.got('second', 'dispensables')::jsonb) d),
  'while the signature is waited for, the dispensable documents wait for it too (0181)'
);

-- With no link to sign by, nothing waits for a signature: the dispensable documents are asked now.
reset role;
update public.client_links set revoked_at = now() where case_id = pg_temp.got('opened', 'case_id')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into res values ('not_had', public.one_dispensables_not_had(pg_temp.got('nidia', 'conversation')::uuid,
  pg_temp.got('nidia_claim', 'claim')::integer));
select is((pg_temp.got('not_had', 'kept'))::int, 2, 'the client''s "Não tenho" is kept for each one asked');
select is(
  (select count(*)::int from jsonb_array_elements((pg_temp.owed()) -> 'dispensables') d where d ->> 'state' = 'not_have'),
  2,
  'and the case reads them as not had, as on the link'
);

select is(
  public.conversation_papers_owed(pg_temp.got('other', 'conversation')::uuid, pg_temp.got('other_claim', 'claim')::integer) ->> 'code',
  'no_case',
  'the same number at firm B gathers no case of firm A'
);

select * from finish();
rollback;
