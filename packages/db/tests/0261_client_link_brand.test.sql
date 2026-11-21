begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The client's link in the firm's brand (0261). Firm A's client reads, by the token of an open link, A's logo and
-- colour, never B's; a link of firm B reads B's, which has none; a revoked link and a token that is none read nothing.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2610000-0000-4000-8000-000000000001', 'ana@souza-cliente.invalid', 'Ana Souza'),
  ('a2610000-0000-4000-8000-000000000002', 'caio@rocha-cliente.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2610000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-cliente', 'a2610000-0000-4000-8000-000000000001'),
  ('b2610000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-cliente', 'a2610000-0000-4000-8000-000000000002');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                          detected_mime, expires_at, confirmed_at) values
  ('f2610000-0000-4000-8000-000000000001', 'b2610000-0000-4000-8000-00000000000a', 'brand',
   'org/b2610000-0000-4000-8000-00000000000a/brand/logo', 'logomarca.png', 'image/png', 10, 'stored', repeat('a', 64), 10,
   'image/png', now() + interval '1 day', now());
insert into public.firm_brands (org_id, logo_file_id, logo_width, logo_height, color, color_from) values
  ('b2610000-0000-4000-8000-00000000000a', 'f2610000-0000-4000-8000-000000000001', 600, 200, '#14287a', 'person');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2610000-0000-4000-8000-00000000000a', 'b2610000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake'),
  ('c2610000-0000-4000-8000-00000000000b', 'b2610000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'intake');
insert into public.people (id, org_id, full_name, cpf) values
  ('e2610000-0000-4000-8000-00000000000a', 'b2610000-0000-4000-8000-00000000000a', 'Rafaela Teste Lima', '52998224725'),
  ('e2610000-0000-4000-8000-00000000000b', 'b2610000-0000-4000-8000-00000000000b', 'Lia Teste', '11144477735');
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at, revoked_at) values
  ('b2610000-0000-4000-8000-00000000000a', 'c2610000-0000-4000-8000-00000000000a', 'e2610000-0000-4000-8000-00000000000a',
   encode(sha256(convert_to('marca-cliente-a-000000000000000000000000', 'UTF8')), 'hex'), now() + interval '30 days', null),
  ('b2610000-0000-4000-8000-00000000000b', 'c2610000-0000-4000-8000-00000000000b', 'e2610000-0000-4000-8000-00000000000b',
   encode(sha256(convert_to('marca-cliente-b-000000000000000000000000', 'UTF8')), 'hex'), now() + interval '30 days', null),
  ('b2610000-0000-4000-8000-00000000000a', 'c2610000-0000-4000-8000-00000000000a', 'e2610000-0000-4000-8000-00000000000a',
   encode(sha256(convert_to('marca-cliente-a-revogado-00000000000000000', 'UTF8')), 'hex'), now() + interval '30 days', now());

set local role anon;
select is(
  (select array[b ->> 'color', b ->> 'logo_file_id', b ->> 'logo_width']
   from public.client_link_brand('marca-cliente-a-000000000000000000000000') b),
  array['#14287a', 'f2610000-0000-4000-8000-000000000001', '600'],
  'a client of firm A reads, by the token of an open link, A''s logo and colour'
);
select is(
  (select array[b ->> 'ok', b ->> 'color', b ->> 'logo_file_id']
   from public.client_link_brand('marca-cliente-b-000000000000000000000000') b),
  array['true', null, null],
  'a client of firm B reads B''s brand, which has none, never A''s'
);
select is(
  public.client_link_brand('marca-cliente-a-revogado-00000000000000000') ->> 'code', 'link_not_open',
  'a revoked link reads nothing'
);
select is(public.client_link_brand('nenhum') ->> 'code', 'link_not_open', 'nor a token that is none');
select is(public.client_link_brand(null) ->> 'code', 'link_not_open', 'nor no token');
reset role;
select ok(
  not has_function_privilege('anon', 'public.client_link_by_token(text)', 'execute'),
  'the brand is read through its function alone'
);

select * from finish();
rollback;
