begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The chat's script, its third part (0231): the papers open to sign are
-- owed a word in the conversation the firm holds with who signs, inside the
-- 24 hours; ONE's message marks them told in the same transaction, once; a
-- person who asked to stop is never written to. Two firms: nothing of one
-- reaches the other.
--
-- Every person, firm, number and address here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2310000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-assina.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2310000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-assina.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2310000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-assina', 'a2310000-0000-4000-8000-000000000001'),
  ('b2310000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-assina', 'a2310000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2310000-0000-4000-8000-00000000000a', 'a2310000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2310000-0000-4000-8000-00000000000b', 'a2310000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2310000-0000-4000-8000-00000000000a', 'b2310000-0000-4000-8000-00000000000a', 'whatsapp', 'assina-waba-a', 'Chat de teste',
   'connected', 'a2310000-0000-4000-8000-000000000001', now()),
  ('c2310000-0000-4000-8000-00000000000b', 'b2310000-0000-4000-8000-00000000000b', 'whatsapp', 'assina-waba-b', 'Chat de teste',
   'connected', 'a2310000-0000-4000-8000-000000000004', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Cliente', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2310000-0000-4000-8000-00000000000a',
  'c2310000-0000-4000-8000-00000000000a', 'test', 'assina-number-a', 'assina-waba-a', '5500900000311', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2310000-0000-4000-8000-00000000000b',
  'c2310000-0000-4000-8000-00000000000b', 'test', 'assina-number-b', 'assina-waba-b', '5500900000312', 'Rocha Advocacia', 'cloud'));
insert into res values ('nidia', jsonb_build_object('conversation',
  pg_temp.writes('b2310000-0000-4000-8000-00000000000a', '5500988883101', 'oi')));
insert into res values ('rui', jsonb_build_object('conversation',
  pg_temp.writes('b2310000-0000-4000-8000-00000000000b', '5500988883102', 'oi')));
reset role;

-- Each firm has a case whose power of attorney waits at ZapSign: Nídia's at firm A, Rui's at firm B, who asked to stop.
insert into public.people (id, org_id, full_name, phone, updated_via) values
  ('d2310000-0000-4000-8000-00000000000a', 'b2310000-0000-4000-8000-00000000000a', 'Nídia Teste', '5500988883101', 'firm'),
  ('d2310000-0000-4000-8000-00000000000b', 'b2310000-0000-4000-8000-00000000000b', 'Rui Teste', '5500988883102', 'firm');
insert into public.cases (id, org_id, seq, incident, status) values
  ('e2310000-0000-4000-8000-00000000000a', 'b2310000-0000-4000-8000-00000000000a', 1, 'cancellation', 'documents'),
  ('e2310000-0000-4000-8000-00000000000b', 'b2310000-0000-4000-8000-00000000000b', 1, 'cancellation', 'documents');
insert into public.case_parties (org_id, case_id, person_id, role) values
  ('b2310000-0000-4000-8000-00000000000a', 'e2310000-0000-4000-8000-00000000000a', 'd2310000-0000-4000-8000-00000000000a', 'claimant'),
  ('b2310000-0000-4000-8000-00000000000b', 'e2310000-0000-4000-8000-00000000000b', 'd2310000-0000-4000-8000-00000000000b', 'claimant');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('f2310000-0000-4000-8000-00000000000a', 'b2310000-0000-4000-8000-00000000000a', 'paper', 'org/b2310000-0000-4000-8000-00000000000a/paper/f2310000-0000-4000-8000-00000000000a',
   'procuracao.pdf', 'application/pdf', 100, 'stored', repeat('a', 64), 100, 'application/pdf', now() + interval '1 hour', now()),
  ('f2310000-0000-4000-8000-00000000000b', 'b2310000-0000-4000-8000-00000000000b', 'paper', 'org/b2310000-0000-4000-8000-00000000000b/paper/f2310000-0000-4000-8000-00000000000b',
   'procuracao.pdf', 'application/pdf', 100, 'stored', repeat('b', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at) values
  ('a2310000-0000-4000-8000-0000000000da', 'b2310000-0000-4000-8000-00000000000a', 'e2310000-0000-4000-8000-00000000000a',
   'f2310000-0000-4000-8000-00000000000a', 'power_of_attorney', 'firm', 'accepted', now()),
  ('a2310000-0000-4000-8000-0000000000db', 'b2310000-0000-4000-8000-00000000000b', 'e2310000-0000-4000-8000-00000000000b',
   'f2310000-0000-4000-8000-00000000000b', 'power_of_attorney', 'firm', 'accepted', now());
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers, provider_id) values
  ('a2310000-0000-4000-8000-0000000000ea', 'b2310000-0000-4000-8000-00000000000a', 'e2310000-0000-4000-8000-00000000000a',
   'a2310000-0000-4000-8000-0000000000da', 'zapsign', 'pending',
   '[{"position": 1, "person_id": "d2310000-0000-4000-8000-00000000000a", "name": "Nídia Teste", "sign_url": "https://app.zapsign.example/verificar/nidia", "signed_at": null}]',
   'assina-envelope-a'),
  ('a2310000-0000-4000-8000-0000000000eb', 'b2310000-0000-4000-8000-00000000000b', 'e2310000-0000-4000-8000-00000000000b',
   'a2310000-0000-4000-8000-0000000000db', 'zapsign', 'pending',
   '[{"position": 1, "person_id": "d2310000-0000-4000-8000-00000000000b", "name": "Rui Teste", "sign_url": "https://app.zapsign.example/verificar/rui", "signed_at": null}]',
   'assina-envelope-b');
insert into public.case_papers (id, org_id, case_id, person_id, kind, document_id, envelope_id) values
  ('a2310000-0000-4000-8000-0000000000fa', 'b2310000-0000-4000-8000-00000000000a', 'e2310000-0000-4000-8000-00000000000a',
   'd2310000-0000-4000-8000-00000000000a', 'procuracao', 'a2310000-0000-4000-8000-0000000000da', 'a2310000-0000-4000-8000-0000000000ea'),
  ('a2310000-0000-4000-8000-0000000000fb', 'b2310000-0000-4000-8000-00000000000b', 'e2310000-0000-4000-8000-00000000000b',
   'd2310000-0000-4000-8000-00000000000b', 'procuracao', 'a2310000-0000-4000-8000-0000000000db', 'a2310000-0000-4000-8000-0000000000eb');
insert into public.wa_optouts (org_id, contact_wa_id, source) values ('b2310000-0000-4000-8000-00000000000b', '5500988883102', 'keyword');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  (select jsonb_agg(jsonb_build_object('conversation', o.conversation_id, 'url', o.papers -> 0 ->> 'sign_url'))
   from public.signature_links_owed(20) o where o.org_id in ('b2310000-0000-4000-8000-00000000000a', 'b2310000-0000-4000-8000-00000000000b')),
  jsonb_build_array(jsonb_build_object('conversation', pg_temp.got('nidia', 'conversation'),
                                       'url', 'https://app.zapsign.example/verificar/nidia')),
  'the paper open to sign is owed a word to who signs, and never to who asked to stop'
);

insert into res values ('told', public.one_tell_signature_links(pg_temp.got('nidia', 'conversation')::uuid,
  array['a2310000-0000-4000-8000-0000000000fa'::uuid], 'Falta só assinar, Nídia. https://app.zapsign.example/verificar/nidia'));
select is(pg_temp.got('told', 'code'), 'queued', 'ONE writes the link in the conversation');
select is(
  (select body from public.wa_messages where id = pg_temp.got('told', 'message_id')::uuid),
  'Falta só assinar, Nídia. https://app.zapsign.example/verificar/nidia',
  'as its own message'
);
select ok(
  (select told_in_chat_at is not null from public.case_papers where id = 'a2310000-0000-4000-8000-0000000000fa'),
  'the paper is marked told'
);
select is(
  public.one_tell_signature_links(pg_temp.got('nidia', 'conversation')::uuid,
    array['a2310000-0000-4000-8000-0000000000fa'::uuid], 'De novo.') ->> 'code',
  'not_owed',
  'and never told twice'
);
select is(
  public.one_tell_signature_links(pg_temp.got('rui', 'conversation')::uuid,
    array['a2310000-0000-4000-8000-0000000000fb'::uuid], 'Falta só assinar, Rui.') ->> 'code',
  'not_owed',
  'who asked to stop is never written to'
);

reset role;
select set_config('request.jwt.claims', '', true);
select ok(
  not has_function_privilege('authenticated', 'public.one_tell_signature_links(uuid, uuid[], text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.signature_links_owed(integer)', 'EXECUTE'),
  'only the backend writes and reads what is owed'
);

select * from finish();
rollback;
