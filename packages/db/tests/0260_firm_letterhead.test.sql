begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- The firm's letterhead (0260). Who manages firm A keeps what ONE read of the Word document it sent (its pictures
-- files of A's brand), unconfirmed until the page of example; confirms it; a new letterhead waits for its own
-- confirmation; and goes back to plain paper. A reading that names a picture of firm B, or a source that is not kept,
-- is refused, and so is a kind that is none. Never without the second factor, never by firm B, which reads nothing.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2600000-0000-4000-8000-000000000001', 'ana@souza-timbrado.invalid', 'Ana Souza'),
  ('a2600000-0000-4000-8000-000000000002', 'caio@rocha-timbrado.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-timbrado', 'a2600000-0000-4000-8000-000000000001'),
  ('b2600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-timbrado', 'a2600000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2600000-0000-4000-8000-00000000000a', 'a2600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2600000-0000-4000-8000-00000000000b', 'a2600000-0000-4000-8000-000000000002', 'owner', 'socio');

create function pg_temp.file(id uuid, firm uuid, kept boolean) returns void language sql as $$
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256,
                            bytes, detected_mime, expires_at, confirmed_at)
  values (id, firm, 'brand', 'org/' || firm || '/brand/' || id, 'timbrado.docx', 'image/png', 10,
          case when kept then 'stored' else 'reserved' end,
          case when kept then repeat('a', 64) end, case when kept then 10 end, case when kept then 'image/png' end,
          now() + interval '1 day', case when kept then now() end);
$$;
-- A's Word document, a picture of its header, a second document; a picture of B's; a file of A's not kept.
select pg_temp.file('f2600000-0000-4000-8000-000000000001', 'b2600000-0000-4000-8000-00000000000a', true);
select pg_temp.file('f2600000-0000-4000-8000-000000000002', 'b2600000-0000-4000-8000-00000000000a', true);
select pg_temp.file('f2600000-0000-4000-8000-000000000003', 'b2600000-0000-4000-8000-00000000000a', true);
select pg_temp.file('f2600000-0000-4000-8000-000000000004', 'b2600000-0000-4000-8000-00000000000b', true);
select pg_temp.file('f2600000-0000-4000-8000-000000000005', 'b2600000-0000-4000-8000-00000000000a', false);

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;

/** A reading of a Word letterhead whose header has the picture given. */
create function pg_temp.reading(picture uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'margins', jsonb_build_object('top', 140, 'bottom', 85, 'left', 85, 'right', 57, 'header', 28, 'footer', 28),
    'header', jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object('text', 'Souza Advogados', 'align', 'center', 'sizePt', 12, 'bold', true)),
      'images', jsonb_build_array(jsonb_build_object('file_id', picture, 'mime', 'image/png', 'widthPt', 150, 'heightPt', 50, 'align', 'center'))),
    'footer', jsonb_build_object('lines', '[]'::jsonb, 'images', '[]'::jsonb));
$$;

set local role authenticated;
select pg_temp.sign_in('a2600000-0000-4000-8000-000000000001');

select is(
  public.set_firm_letterhead('b2600000-0000-4000-8000-00000000000a', 'word', 'f2600000-0000-4000-8000-000000000001',
                             pg_temp.reading('f2600000-0000-4000-8000-000000000002')) ->> 'code',
  'read', 'who manages A keeps what ONE read of its letterhead'
);
select is(
  (select array[letterhead_kind, (letterhead_confirmed_at is null)::text, letterhead -> 'header' -> 'lines' -> 0 ->> 'text']
   from public.firm_brands where org_id = 'b2600000-0000-4000-8000-00000000000a'),
  array['word', 'true', 'Souza Advogados'], 'unconfirmed until the page of example'
);
-- ONE's server keeps the paper it copied of the Word document (0300): only a paper the person saw is confirmed.
reset role;
update public.firm_brands
set letterhead_paper_status = 'ready', letterhead_paper_file_id = 'f2600000-0000-4000-8000-000000000003',
    letterhead_paper = '{}'::jsonb
where org_id = 'b2600000-0000-4000-8000-00000000000a';
set local role authenticated;
select pg_temp.sign_in('a2600000-0000-4000-8000-000000000001');
select is(
  public.confirm_firm_letterhead('b2600000-0000-4000-8000-00000000000a') ->> 'code', 'confirmed',
  'the person confirms it'
);
select ok(
  (select letterhead_confirmed_at is not null and letterhead_confirmed_by = 'a2600000-0000-4000-8000-000000000001'
   from public.firm_brands where org_id = 'b2600000-0000-4000-8000-00000000000a'),
  'and who confirmed is kept'
);
select is(
  public.set_firm_letterhead('b2600000-0000-4000-8000-00000000000a', 'pdf', 'f2600000-0000-4000-8000-000000000003',
                             '{"margins": {"top": 120, "bottom": 90, "left": 62, "right": 62}}') ->> 'code',
  'read', 'a new letterhead'
);
select is(
  (select letterhead_confirmed_at from public.firm_brands where org_id = 'b2600000-0000-4000-8000-00000000000a'),
  null::timestamptz, 'waits for its own confirmation'
);

-- What is refused.
select is(
  public.set_firm_letterhead('b2600000-0000-4000-8000-00000000000a', 'word', 'f2600000-0000-4000-8000-000000000001',
                             pg_temp.reading('f2600000-0000-4000-8000-000000000004')) ->> 'code',
  'file_not_found', 'a reading that names a picture of firm B'
);
select is(
  public.set_firm_letterhead('b2600000-0000-4000-8000-00000000000a', 'pdf', 'f2600000-0000-4000-8000-000000000005', '{}') ->> 'code',
  'file_not_found', 'a source the backend did not keep'
);
select is(
  public.set_firm_letterhead('b2600000-0000-4000-8000-00000000000a', 'png', 'f2600000-0000-4000-8000-000000000001', '{}') ->> 'code',
  'invalid_letterhead', 'a kind that is none'
);

select is(
  public.remove_firm_letterhead('b2600000-0000-4000-8000-00000000000a') ->> 'code', 'removed',
  'back to plain paper'
);
select is(
  (select count(*)::integer from public.audit_events
   where org_id = 'b2600000-0000-4000-8000-00000000000a' and action like 'firm.letterhead%'),
  4, 'each on the record'
);

select pg_temp.sign_in('a2600000-0000-4000-8000-000000000001', 'aal1');
select throws_ok(
  $$select public.confirm_firm_letterhead('b2600000-0000-4000-8000-00000000000a')$$,
  '42501', 'second_factor_required', 'never without the second factor'
);
select pg_temp.sign_in('a2600000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.remove_firm_letterhead('b2600000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized', 'never by firm B'
);
select is(
  (select count(*)::integer from public.firm_brands where org_id = 'b2600000-0000-4000-8000-00000000000a'), 0,
  'which reads nothing of A''s'
);
reset role;

select * from finish();
rollback;
