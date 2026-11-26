begin;
create extension if not exists pgtap;
select plan(24);

-- ============================================================
-- The firm's letterhead copied (0300). A Word document firm A sent waits for ONE's server and cannot be confirmed
-- before; the server claims it once, keeps the paper (a file of A's brand) and A confirms it. A claim given back, a
-- paper of firm B and a claim that is no longer the letterhead's are refused or change nothing; what had its attempts
-- fails. A PDF is kept with its paper at once. The paper is never discarded while it is the letterhead's, a letterhead
-- sent anew or taken away takes its paper with it, and nobody but the backend claims or records. Firm B reads nothing.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3000000-0000-4000-8000-000000000001', 'ana@souza-papel.invalid', 'Ana Souza'),
  ('a3000000-0000-4000-8000-000000000002', 'caio@rocha-papel.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-papel', 'a3000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-papel', 'a3000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b3000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-000000000002', 'owner', 'socio');

create function pg_temp.file(id uuid, firm uuid, mime text) returns void language sql as $$
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256,
                            bytes, detected_mime, expires_at, confirmed_at)
  values (id, firm, 'brand', 'org/' || firm || '/brand/' || id, 'timbrado', mime, 10, 'stored', repeat('a', 64), 10,
          mime, now() + interval '1 day', now());
$$;
-- A's Word document, the paper ONE keeps of it, A's PDF and its paper, a second Word document of A's; a PDF of B's.
select pg_temp.file('f3000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-00000000000a',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
select pg_temp.file('f3000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-00000000000a', 'application/pdf');
select pg_temp.file('f3000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-00000000000a', 'application/pdf');
select pg_temp.file('f3000000-0000-4000-8000-000000000004', 'b3000000-0000-4000-8000-00000000000a', 'application/pdf');
select pg_temp.file('f3000000-0000-4000-8000-000000000005', 'b3000000-0000-4000-8000-00000000000a',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
select pg_temp.file('f3000000-0000-4000-8000-000000000006', 'b3000000-0000-4000-8000-00000000000b', 'application/pdf');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.backend() returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true); $$;

/** The measure of a paper: its first page and its following ones. */
create function pg_temp.paper() returns jsonb language sql as $$
  select jsonb_build_object(
    'pages', 2,
    'page', jsonb_build_object('width', 595.28, 'height', 841.89),
    'first', jsonb_build_object('header', 120, 'footer', 40, 'margins', jsonb_build_object('top', 150, 'bottom', 72, 'left', 85, 'right', 57)),
    'rest', jsonb_build_object('header', 60, 'footer', 40, 'margins', jsonb_build_object('top', 90, 'bottom', 72, 'left', 85, 'right', 57)),
    'stripped', false,
    'fonts', jsonb_build_array('Liberation Sans'));
$$;
create function pg_temp.status() returns text language sql as $$
  select letterhead_paper_status from public.firm_brands where org_id = 'b3000000-0000-4000-8000-00000000000a';
$$;

-- A database that already holds letterheads waiting (a hosted one) keeps them out of this test's claims.
update public.firm_brands set letterhead_paper_status = 'failed', letterhead_paper_claim = null
where letterhead_paper_status = 'converting';

set local role authenticated;
select pg_temp.sign_in('a3000000-0000-4000-8000-000000000001');
select is(
  public.set_firm_letterhead('b3000000-0000-4000-8000-00000000000a', 'word', 'f3000000-0000-4000-8000-000000000001',
                             '{"margins": {"top": 140, "bottom": 85, "left": 85, "right": 57}}') ->> 'code',
  'read', 'A sends a Word document'
);
select is(pg_temp.status(), 'converting', 'which waits for ONE''s server');
select is(
  public.confirm_firm_letterhead('b3000000-0000-4000-8000-00000000000a') ->> 'code', 'paper_not_ready',
  'and cannot be confirmed before the person sees its paper'
);
select throws_ok(
  $$select public.claim_letterhead_paper()$$, '42501', null, 'a person never claims a conversion'
);

-- ONE's server.
reset role;
set local role service_role;
select pg_temp.backend();
create temporary table claimed as select public.claim_letterhead_paper() as answer;
select is(
  (select array[answer ->> 'code', answer ->> 'org_id', answer ->> 'storage_path', answer -> 'margins' ->> 'top', answer ->> 'attempt'] from claimed),
  array['claimed', 'b3000000-0000-4000-8000-00000000000a',
        'org/b3000000-0000-4000-8000-00000000000a/brand/f3000000-0000-4000-8000-000000000001', '140', '1'],
  'the server claims A''s document, with where its file is and its margins'
);
select is(public.claim_letterhead_paper(), null::jsonb, 'once: a claim being worked is nobody else''s');
select is(
  public.record_letterhead_paper('b3000000-0000-4000-8000-00000000000a', (select (answer ->> 'claim')::uuid from claimed),
                                 'ready', 'f3000000-0000-4000-8000-000000000006', pg_temp.paper()) ->> 'code',
  'file_not_found', 'a paper of firm B is refused'
);
select is(
  public.record_letterhead_paper('b3000000-0000-4000-8000-00000000000a', gen_random_uuid(), 'ready',
                                 'f3000000-0000-4000-8000-000000000002', pg_temp.paper()) ->> 'code',
  'stale', 'a claim that is not the letterhead''s changes nothing'
);
select is(
  public.record_letterhead_paper('b3000000-0000-4000-8000-00000000000a', (select (answer ->> 'claim')::uuid from claimed),
                                 'ready', 'f3000000-0000-4000-8000-000000000002', pg_temp.paper()) ->> 'code',
  'ready', 'the paper is kept'
);
select is(
  (select array[letterhead_paper_status, letterhead_paper_file_id::text, letterhead_paper -> 'first' -> 'margins' ->> 'top',
                (letterhead_paper_claim is null)::text]
   from public.firm_brands where org_id = 'b3000000-0000-4000-8000-00000000000a'),
  array['ready', 'f3000000-0000-4000-8000-000000000002', '150', 'true'], 'with its measure, the claim ended'
);
select is(
  public.discard_file('f3000000-0000-4000-8000-000000000002') ->> 'code', 'in_use',
  'the paper ONE draws on is never discarded'
);

reset role;
set local role authenticated;
select pg_temp.sign_in('a3000000-0000-4000-8000-000000000001');
select is(public.confirm_firm_letterhead('b3000000-0000-4000-8000-00000000000a') ->> 'code', 'confirmed', 'A confirms it');

-- A sends another Word document: its paper goes with the one before, and the server gives up after its attempts.
select is(
  public.set_firm_letterhead('b3000000-0000-4000-8000-00000000000a', 'word', 'f3000000-0000-4000-8000-000000000005',
                             '{"margins": {"top": 140, "bottom": 85, "left": 85, "right": 57}}') ->> 'code',
  'read', 'another Word document'
);
select is(
  (select array[letterhead_paper_status, coalesce(letterhead_paper_file_id::text, 'none'), (letterhead_confirmed_at is null)::text]
   from public.firm_brands where org_id = 'b3000000-0000-4000-8000-00000000000a'),
  array['converting', 'none', 'true'], 'takes the paper of the one before with it'
);
reset role;
set local role service_role;
select pg_temp.backend();
select is(
  (select public.record_letterhead_paper('b3000000-0000-4000-8000-00000000000a', (c ->> 'claim')::uuid, 'retry', null, null, 'unavailable') ->> 'code'
   from (select public.claim_letterhead_paper() as c) claim),
  'retry', 'a suite that did not answer is tried again'
);
select is(
  (select public.record_letterhead_paper('b3000000-0000-4000-8000-00000000000a', (c ->> 'claim')::uuid, 'retry', null, null, 'unavailable') ->> 'code'
   from (select public.claim_letterhead_paper() as c) claim),
  'retry', 'and again'
);
select is(
  (select public.record_letterhead_paper('b3000000-0000-4000-8000-00000000000a', (c ->> 'claim')::uuid, 'retry', null, null, 'unavailable') ->> 'code'
   from (select public.claim_letterhead_paper() as c) claim),
  'failed', 'until its attempts are spent'
);
select is(
  (select array[letterhead_paper_status, letterhead_paper_problem] from public.firm_brands
   where org_id = 'b3000000-0000-4000-8000-00000000000a'),
  array['failed', 'unavailable'], 'and the letterhead says why'
);
select is(public.claim_letterhead_paper(), null::jsonb, 'and is claimed no more');

-- A PDF: its paper kept at once.
reset role;
set local role authenticated;
select pg_temp.sign_in('a3000000-0000-4000-8000-000000000001');
select is(
  public.set_firm_letterhead_paper('b3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000003',
                                   'f3000000-0000-4000-8000-000000000006', pg_temp.paper()) ->> 'code',
  'file_not_found', 'never with a paper of firm B'
);
select is(
  public.set_firm_letterhead_paper('b3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000003',
                                   'f3000000-0000-4000-8000-000000000004', pg_temp.paper()) ->> 'code',
  'read', 'A sends a PDF, its paper kept with it'
);
select is(
  (select array[letterhead_kind, letterhead_paper_status, letterhead -> 'margins' ->> 'top'] from public.firm_brands
   where org_id = 'b3000000-0000-4000-8000-00000000000a'),
  array['pdf', 'ready', '90'], 'ready to be seen, its following pages'' margins the letterhead''s'
);

-- Firm B, and back to plain paper.
select pg_temp.sign_in('a3000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::integer from public.firm_brands where org_id = 'b3000000-0000-4000-8000-00000000000a'), 0,
  'firm B reads nothing of A''s'
);
select pg_temp.sign_in('a3000000-0000-4000-8000-000000000001');
select public.remove_firm_letterhead('b3000000-0000-4000-8000-00000000000a');
select is(
  (select array[coalesce(letterhead_paper_status, 'none'), coalesce(letterhead_paper_file_id::text, 'none')]
   from public.firm_brands where org_id = 'b3000000-0000-4000-8000-00000000000a'),
  array['none', 'none'], 'a letterhead taken away takes its paper'
);
reset role;

select * from finish();
rollback;
