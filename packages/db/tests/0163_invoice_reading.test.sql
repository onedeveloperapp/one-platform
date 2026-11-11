begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The invoice the firm issued, read by ONE (0165). Ana, a partner of Lima,
-- sends the PDF of the NFS-e of a fee received and records it with that file;
-- a file of Rocha's is refused; the backend never forgets the invoice's file,
-- nor takes it back as a document nobody kept; the reading counts within the
-- books' readings of a day.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1630000-0000-4000-8000-000000000001', 'ana@lima-nota.invalid', 'Ana Lima'),
  ('a1630000-0000-4000-8000-000000000009', 'edu@rocha-nota.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1630000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-nota', 'a1630000-0000-4000-8000-000000000001'),
  ('b1630000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-nota', 'a1630000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1630000-0000-4000-8000-00000000000a', 'a1630000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1630000-0000-4000-8000-00000000000b', 'a1630000-0000-4000-8000-000000000009', 'owner', 'socio');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
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

select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1630000-0000-4000-8000-00000000000a', current_date - 40)$$);
select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1630000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);
select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'fee',
  format($$public.save_finance_entry('b1630000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'income', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '150000',
    'category_id', (select id from public.finance_categories where org_id = 'b1630000-0000-4000-8000-00000000000a' and code = 'receita.contratuais'),
    'counterparty', 'Maria Teste', 'occurred_on', current_date - 3)));

-- The invoice's PDF, reserved by Ana and measured by the backend; and one of Rocha's.
select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'upload',
  $$public.reserve_finance_upload('b1630000-0000-4000-8000-00000000000a', 'nfse-123.pdf', 'application/pdf', 4096)$$);
update public.files set status = 'stored', sha256 = repeat('f', 64), bytes = 4096, detected_mime = 'application/pdf',
  confirmed_at = now()
where id = pg_temp.got('upload', '{file_id}')::uuid;
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('f1630000-0000-4000-8000-00000000000b', 'b1630000-0000-4000-8000-00000000000b', 'finance',
   'org/b1630000-0000-4000-8000-00000000000b/finance/f1630000-0000-4000-8000-00000000000b', 'nfse.pdf', 'application/pdf', 4096,
   'stored', repeat('e', 64), 4096, 'application/pdf', now() + interval '1 hour', now());

select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'other-file',
  format($$public.record_finance_invoice(%L, '123', current_date - 2, 'f1630000-0000-4000-8000-00000000000b')$$,
    pg_temp.got('fee', '{entry_id}')));
select is(pg_temp.got('other-file', '{field}'), 'file', 'a file of another firm is no invoice of this one');

select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'recorded',
  format($$public.record_finance_invoice(%L, '123', current_date - 2, %L)$$,
    pg_temp.got('fee', '{entry_id}'), pg_temp.got('upload', '{file_id}')));
select ok(
  pg_temp.got('recorded', '{ok}') = 'true'
    and (select number = '123' and file_id = pg_temp.got('upload', '{file_id}')::uuid from public.finance_invoices
         where entry_id = pg_temp.got('fee', '{entry_id}')::uuid),
  'the invoice is recorded with the file it was read from'
);

select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'again',
  format($$public.record_finance_invoice(%L, '124', current_date - 2)$$, pg_temp.got('fee', '{entry_id}')));
select ok(
  (select number = '124' and file_id = pg_temp.got('upload', '{file_id}')::uuid from public.finance_invoices
   where entry_id = pg_temp.got('fee', '{entry_id}')::uuid),
  'recording it again without a file keeps the file it had'
);

update public.files set created_at = now() - interval '2 days' where id = pg_temp.got('upload', '{file_id}')::uuid;
select pg_temp.sign_in('a1630000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select ok(
  not exists (select 1 from public.finance_unused_documents(500) u where u.file_id = pg_temp.got('upload', '{file_id}')::uuid)
    and (public.discard_file(pg_temp.got('upload', '{file_id}')::uuid) ->> 'code') = 'in_use',
  'the invoice''s file is never taken back nor forgotten'
);
reset role;

update public.platform_settings set value = value || '{"document_reads": 1}'::jsonb where key = 'finance';
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, started_at)
select 'b1630000-0000-4000-8000-00000000000a', 'financeiro.nota.leitura', v.id, 'anthropic', 'claude-sonnet-5-5',
  repeat('d', 64), 'running', now()
from public.prompt_versions v where v.task = 'financeiro.nota.leitura' and v.version = 1;
select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'allowed',
  $$public.finance_document_reading_allowed('b1630000-0000-4000-8000-00000000000a')$$);
select is(pg_temp.got('allowed', '{code}'), 'document_limit', 'reading an invoice counts within the books'' readings of a day');

select pg_temp.as_person('a1630000-0000-4000-8000-000000000001', 'data',
  format($$public.finance_invoice_data('b1630000-0000-4000-8000-00000000000a', %L::date)$$, current_date - 3));
select is(
  (select r #>> '{invoice,file_id}' from res, jsonb_array_elements(res.value) r where res.key = 'data'),
  pg_temp.got('upload', '{file_id}'),
  'the month''s invoices say the file of each'
);

select * from finish();
rollback;
