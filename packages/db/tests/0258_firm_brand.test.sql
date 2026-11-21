begin;
create extension if not exists pgtap;
select plan(17);

-- ============================================================
-- The firm's brand (0258). Who manages firm A keeps its logo (the file it sent and ONE's PNG, both its own, of the
-- purpose `brand`) with the colour the rule read; a colour chosen by a person stays when the logo changes, and
-- giving the choice back returns the logo's colour. A file of firm B, of another purpose, or not kept is refused,
-- and so is a colour that is none. Never without the second factor, never by a member who does not manage the firm,
-- never by firm B, which reads nothing of A's brand. The setup's facts say the logo was given.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2580000-0000-4000-8000-000000000001', 'ana@souza-marca.invalid', 'Ana Souza'),
  ('a2580000-0000-4000-8000-000000000002', 'caio@rocha-marca.invalid', 'Caio Rocha'),
  ('a2580000-0000-4000-8000-000000000003', 'bia@souza-marca.invalid', 'Bia Lima')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2580000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-marca', 'a2580000-0000-4000-8000-000000000001'),
  ('b2580000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-marca', 'a2580000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2580000-0000-4000-8000-00000000000a', 'a2580000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2580000-0000-4000-8000-00000000000a', 'a2580000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b2580000-0000-4000-8000-00000000000b', 'a2580000-0000-4000-8000-000000000002', 'owner', 'socio');

/** A file of a firm, of a purpose, kept or only reserved. */
create function pg_temp.file(id uuid, firm uuid, purpose text, kept boolean) returns void language sql as $$
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256,
                            bytes, detected_mime, expires_at, confirmed_at)
  values (id, firm, purpose, 'org/' || firm || '/' || purpose || '/' || id, 'logo.png', 'image/png', 10,
          case when kept then 'stored' else 'reserved' end,
          case when kept then repeat('a', 64) end, case when kept then 10 end, case when kept then 'image/png' end,
          now() + interval '1 day', case when kept then now() end);
$$;
select pg_temp.file('f2580000-0000-4000-8000-000000000001', 'b2580000-0000-4000-8000-00000000000a', 'brand', true);
select pg_temp.file('f2580000-0000-4000-8000-000000000002', 'b2580000-0000-4000-8000-00000000000a', 'brand', true);
select pg_temp.file('f2580000-0000-4000-8000-000000000003', 'b2580000-0000-4000-8000-00000000000a', 'brand', true);
select pg_temp.file('f2580000-0000-4000-8000-000000000004', 'b2580000-0000-4000-8000-00000000000a', 'brand', false);
select pg_temp.file('f2580000-0000-4000-8000-000000000005', 'b2580000-0000-4000-8000-00000000000b', 'brand', true);
select pg_temp.file('f2580000-0000-4000-8000-000000000006', 'b2580000-0000-4000-8000-00000000000a', 'finance', true);

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;

select ok(
  (select (value -> 'purposes' -> 'brand' -> 'mimes') ? 'image/svg+xml' from public.platform_settings where key = 'files'),
  'a firm may send its logo as an SVG, among the files of its brand'
);

set local role authenticated;
select pg_temp.sign_in('a2580000-0000-4000-8000-000000000001');

-- ---------- The logo, and its colour ----------

select is(
  public.set_firm_logo('b2580000-0000-4000-8000-00000000000a', 'f2580000-0000-4000-8000-000000000001',
                       'f2580000-0000-4000-8000-000000000002', 800, 240, '#1F6F3A') ->> 'code',
  'saved', 'who manages A keeps its logo'
);
select is(
  (select array[color, color_from, logo_width::text] from public.firm_brands where org_id = 'b2580000-0000-4000-8000-00000000000a'),
  array['#1f6f3a', 'logo', '800'], 'with the colour the rule read of it'
);
select is(
  (public.firm_setup_facts('b2580000-0000-4000-8000-00000000000a') ->> 'brand')::boolean, true,
  'the setup''s facts say the logo was given'
);

select is(
  public.set_firm_color('b2580000-0000-4000-8000-00000000000a', '#14287A') ->> 'code', 'saved',
  'the person chooses another colour'
);
select is(
  public.set_firm_logo('b2580000-0000-4000-8000-00000000000a', 'f2580000-0000-4000-8000-000000000001',
                       'f2580000-0000-4000-8000-000000000003', 600, 200, '#c0392b') ->> 'code',
  'saved', 'and sends another logo'
);
select is(
  (select array[color, color_from, logo_color] from public.firm_brands where org_id = 'b2580000-0000-4000-8000-00000000000a'),
  array['#14287a', 'person', '#c0392b'], 'the colour the person chose stays'
);
select is(
  public.set_firm_color('b2580000-0000-4000-8000-00000000000a', null) ->> 'code', 'saved',
  'and gives the choice back to the logo'
);
select is(
  (select array[color, color_from] from public.firm_brands where org_id = 'b2580000-0000-4000-8000-00000000000a'),
  array['#c0392b', 'logo'], 'whose colour comes back'
);
select is(
  (select count(*)::integer from public.audit_events
   where org_id = 'b2580000-0000-4000-8000-00000000000a' and action in ('firm.logo_set', 'firm.color_set')),
  4, 'each on the record'
);

-- ---------- What is refused ----------

select is(
  public.set_firm_logo('b2580000-0000-4000-8000-00000000000a', 'f2580000-0000-4000-8000-000000000001',
                       'f2580000-0000-4000-8000-000000000005', 100, 100, null) ->> 'code',
  'file_not_found', 'a file of firm B is no logo of A'
);
select is(
  public.set_firm_logo('b2580000-0000-4000-8000-00000000000a', 'f2580000-0000-4000-8000-000000000006',
                       'f2580000-0000-4000-8000-000000000004', 100, 100, null) ->> 'code',
  'file_not_found', 'nor one of another purpose, nor one the backend did not keep'
);
select is(
  public.set_firm_color('b2580000-0000-4000-8000-00000000000a', 'azul') ->> 'code', 'invalid_color',
  'a colour that is none is refused'
);

select pg_temp.sign_in('a2580000-0000-4000-8000-000000000001', 'aal1');
select throws_ok(
  $$select public.set_firm_color('b2580000-0000-4000-8000-00000000000a', '#000000')$$,
  '42501', 'second_factor_required', 'never without the second factor'
);
select pg_temp.sign_in('a2580000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.set_firm_color('b2580000-0000-4000-8000-00000000000a', '#000000')$$,
  '42501', 'not_authorized', 'never by a member who does not manage the firm'
);
select pg_temp.sign_in('a2580000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.set_firm_logo('b2580000-0000-4000-8000-00000000000a', 'f2580000-0000-4000-8000-000000000001',
                                'f2580000-0000-4000-8000-000000000002', 100, 100, null)$$,
  '42501', 'not_authorized', 'never by firm B'
);
select is(
  (select count(*)::integer from public.firm_brands where org_id = 'b2580000-0000-4000-8000-00000000000a'), 0,
  'which reads nothing of A''s brand'
);
reset role;

select * from finish();
rollback;
