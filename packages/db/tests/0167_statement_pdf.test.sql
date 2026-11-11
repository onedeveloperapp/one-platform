begin;
create extension if not exists pgtap;
select plan(3);

-- ============================================================
-- A statement or a card bill in PDF (0169). Ana, a partner of Lima, begins a
-- statement of the format pdf, which the books take; a format they do not know
-- is refused; reading a PDF counts within the books' readings of a day.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1670000-0000-4000-8000-000000000001', 'ana@lima-pdf.invalid', 'Ana Lima'),
  ('a1670000-0000-4000-8000-000000000009', 'edu@rocha-pdf.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1670000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-pdf', 'a1670000-0000-4000-8000-000000000001'),
  ('b1670000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-pdf', 'a1670000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1670000-0000-4000-8000-00000000000a', 'a1670000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1670000-0000-4000-8000-00000000000b', 'a1670000-0000-4000-8000-000000000009', 'owner', 'socio');

create function pg_temp.sign_in(person uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

select pg_temp.as_person('a1670000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1670000-0000-4000-8000-00000000000a', current_date - 40)$$);
select pg_temp.as_person('a1670000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1670000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);
select pg_temp.as_person('a1670000-0000-4000-8000-000000000001', 'pdf',
  format($$public.begin_finance_statement('b1670000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'),
    jsonb_build_object('file_name', 'extrato-outubro.pdf', 'sha256', repeat('a', 64), 'format', 'pdf',
      'starts_on', current_date - 30, 'ends_on', current_date - 1, 'balance_cents', '238710', 'balance_on', current_date - 1)));
select ok(
  pg_temp.got('pdf', '{ok}') = 'true'
    and (select format = 'pdf' from public.finance_statements where id = pg_temp.got('pdf', '{statement_id}')::uuid),
  'the books take a statement ONE read from a PDF'
);

select pg_temp.as_person('a1670000-0000-4000-8000-000000000001', 'other',
  format($$public.begin_finance_statement('b1670000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'),
    jsonb_build_object('file_name', 'extrato.doc', 'sha256', repeat('b', 64), 'format', 'doc')));
select is(pg_temp.got('other', '{field}'), 'file', 'a format the books do not know is refused');

update public.platform_settings set value = value || '{"document_reads": 1}'::jsonb where key = 'finance';
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, started_at)
select 'b1670000-0000-4000-8000-00000000000a', 'financeiro.extrato.pdf', v.id, 'anthropic', 'claude-sonnet-5-5',
  repeat('c', 64), 'running', now()
from public.prompt_versions v where v.task = 'financeiro.extrato.pdf' and v.version = 1;
select pg_temp.as_person('a1670000-0000-4000-8000-000000000001', 'allowed',
  $$public.finance_document_reading_allowed('b1670000-0000-4000-8000-00000000000a')$$);
select is(pg_temp.got('allowed', '{code}'), 'document_limit', 'reading a PDF counts within the books'' readings of a day');

select * from finish();
rollback;
