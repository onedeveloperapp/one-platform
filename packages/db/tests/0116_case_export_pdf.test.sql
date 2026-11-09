begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- The list of cases as a PDF (0115): a limit of its own, which is data, the
-- same people and the same exports a day as the workbook, on the record with
-- its format and never with the words searched. Two firms: nobody of one
-- begins an export of the other's cases.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1160000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-pdf.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1160000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@lima-pdf.invalid', '', now(), '{}', '{"display_name":"Caio Lima"}', now(), now()),
  ('a1160000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@rocha-pdf.invalid', '', now(), '{}', '{"display_name":"Duda Rocha"}', now(), now()),
  ('a1160000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@one-pdf.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1160000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-pdf', 'a1160000-0000-4000-8000-000000000001'),
  ('b1160000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-pdf', 'a1160000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1160000-0000-4000-8000-00000000000a', 'a1160000-0000-4000-8000-000000000001', 'member', 'socio'),
  ('b1160000-0000-4000-8000-00000000000a', 'a1160000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1160000-0000-4000-8000-00000000000b', 'a1160000-0000-4000-8000-000000000003', 'owner', 'advogado');

create function pg_temp.sign_in(person uuid, session uuid default null)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true);
$$;

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;

create function pg_temp.got(which text, path text[])
returns text language sql as $$
  select value #>> path from res where key = which;
$$;

select is(
  (select (value ->> 'export_pdf_rows')::int from public.platform_settings where key = 'controladoria'),
  2000,
  'a PDF holds the setting''s 2,000 lines'
);

select pg_temp.sign_in('a1160000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('fits', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', 'going', 'direito-do-passageiro', true, 2000, 'pdf'));
insert into res values ('over', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 2001, 'pdf'));
insert into res values ('sheet', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 2001, 'xlsx'));
insert into res values ('none', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 0, 'pdf'));
reset role;

select ok(
  (pg_temp.got('fits', '{ok}'))::boolean and pg_temp.got('fits', '{left}')::int = 19,
  'a PDF within the limit is begun, and says how many exports are left today'
);
select ok(
  pg_temp.got('over', '{code}') = 'too_many' and pg_temp.got('over', '{limit}')::int = 2000,
  'a list longer than the limit is refused, saying the limit'
);
select ok(
  (pg_temp.got('sheet', '{ok}'))::boolean and pg_temp.got('sheet', '{left}')::int = 18,
  'the same list still goes to a workbook, and the two count together in the day''s exports'
);
select is(pg_temp.got('none', '{code}'), 'empty', 'an empty list has no PDF');

select is(
  (select e.metadata from public.audit_events e
   where e.org_id = 'b1160000-0000-4000-8000-00000000000a' and e.action = 'case.exported' and e.metadata ->> 'format' = 'pdf'),
  '{"view": "going", "module": "direito-do-passageiro", "searched": true, "rows": 2000, "format": "pdf"}'::jsonb,
  'on the record with its format and that a search narrowed it: no argument takes the words searched'
);

-- The limit is data.
update public.platform_settings set value = value || '{"export_pdf_rows": 10}'::jsonb where key = 'controladoria';
select pg_temp.sign_in('a1160000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lower', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 11, 'pdf'));
reset role;
select ok(
  pg_temp.got('lower', '{code}') = 'too_many' and pg_temp.got('lower', '{limit}')::int = 10,
  'the operator''s setting decides the limit'
);
update public.platform_settings set value = value || '{"export_pdf_rows": 2000}'::jsonb where key = 'controladoria';

-- Who may, and in which format.
select pg_temp.sign_in('a1160000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 3, 'docx') $$,
  '22023', 'invalid_format',
  'a format ONE does not write is refused'
);
reset role;

select pg_temp.sign_in('a1160000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 3, 'pdf') ->> 'code',
  'not_allowed',
  'the attendance takes no PDF of the firm''s cases'
);
reset role;

select pg_temp.sign_in('a1160000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 3, 'pdf') $$,
  '42501', null,
  'nobody of another firm begins a PDF of a firm''s cases'
);
reset role;

-- A support visit, and the day's exports.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1160000-0000-4000-8000-000000000009', 'a1160000-0000-4000-8000-000000000001', 'b1160000-0000-4000-8000-00000000000a',
        'Conferindo a exportação', 'f1160000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a1160000-0000-4000-8000-000000000001', 'f1160000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 3, 'pdf'));
reset role;
select is(pg_temp.got('visit', '{code}'), 'support_visit', 'a support visit takes no PDF');

update public.platform_settings set value = value || '{"export_daily": 2}'::jsonb where key = 'controladoria';
select pg_temp.sign_in('a1160000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('daily', public.begin_case_export('b1160000-0000-4000-8000-00000000000a', null, null, false, 3, 'pdf'));
reset role;
select ok(
  pg_temp.got('daily', '{code}') = 'daily_limit' and pg_temp.got('daily', '{limit}')::int = 2,
  'a PDF counts in the day''s exports as a workbook does'
);

select * from finish();
rollback;
