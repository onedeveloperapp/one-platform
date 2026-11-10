begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- O documento de uma conta (0140). Lima's books are open: Ana, a partner,
-- configures; Duda operates; Bia views; Caio reads only the costs of the
-- cases. Duda reserves the upload of a power bill, the backend keeps it, and
-- it is kept with the bill she saves; Caio reserves nothing and does not see
-- the document's row, Bia sees it; ONE reads within the day's ceiling; the
-- document a bill names is never forgotten, and one nobody used is handed to
-- the backend after a day. Rocha attaches nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1390000-0000-4000-8000-000000000001', 'ana@lima-docfin.invalid', 'Ana Lima'),
  ('a1390000-0000-4000-8000-000000000002', 'caio@lima-docfin.invalid', 'Caio Lima'),
  ('a1390000-0000-4000-8000-000000000003', 'bia@lima-docfin.invalid', 'Bia Lima'),
  ('a1390000-0000-4000-8000-000000000004', 'duda@lima-docfin.invalid', 'Duda Lima'),
  ('a1390000-0000-4000-8000-000000000005', 'edu@rocha-docfin.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1390000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-docfin', 'a1390000-0000-4000-8000-000000000001'),
  ('b1390000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-docfin', 'a1390000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1390000-0000-4000-8000-00000000000a', 'a1390000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1390000-0000-4000-8000-00000000000a', 'a1390000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1390000-0000-4000-8000-00000000000a', 'a1390000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1390000-0000-4000-8000-00000000000a', 'a1390000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1390000-0000-4000-8000-00000000000b', 'a1390000-0000-4000-8000-000000000005', 'owner', 'socio');

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
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  set local role service_role;
  execute format('insert into res values (%L, to_jsonb((%s)))', name, call);
  reset role;
end;
$$;
create function pg_temp.category(target_code text) returns text language sql as $$
  select id::text from public.finance_categories where org_id = 'b1390000-0000-4000-8000-00000000000a' and code = target_code;
$$;

select pg_temp.as_person('a1390000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1390000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1390000-0000-4000-8000-000000000005', 'open-rocha',
  $$public.open_finance_books('b1390000-0000-4000-8000-00000000000b', current_date - 60)$$);
select pg_temp.as_person('a1390000-0000-4000-8000-000000000001', 'grant-bia',
  $$public.set_finance_access('b1390000-0000-4000-8000-00000000000a', 'a1390000-0000-4000-8000-000000000003', 'view')$$);
select pg_temp.as_person('a1390000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1390000-0000-4000-8000-00000000000a', 'a1390000-0000-4000-8000-000000000004', 'operate')$$);

-- ---------- The upload ----------

select pg_temp.as_person('a1390000-0000-4000-8000-000000000004', 'reserve',
  $$public.reserve_finance_upload('b1390000-0000-4000-8000-00000000000a', 'conta-de-luz.pdf', 'application/pdf', 120000)$$);
select pg_temp.as_person('a1390000-0000-4000-8000-000000000002', 'reserve-caio',
  $$public.reserve_finance_upload('b1390000-0000-4000-8000-00000000000a', 'conta-de-luz.pdf', 'application/pdf', 120000)$$);
select pg_temp.as_person('a1390000-0000-4000-8000-000000000004', 'reserve-generic',
  $$public.reserve_file_upload('b1390000-0000-4000-8000-00000000000a', 'finance', 'conta.pdf', 'application/pdf', 120000)$$);
select ok(
  pg_temp.got('reserve', '{ok}') = 'true' and pg_temp.got('reserve-caio', '{code}') = 'not_allowed'
    and pg_temp.got('reserve-generic', '{code}') = 'purpose_not_allowed',
  'who writes in the books reserves a document of theirs, through their own reservation only'
);

-- The backend measured it and kept it.
update public.files set status = 'stored', sha256 = repeat('a', 64), bytes = 120000, detected_mime = 'application/pdf',
  confirmed_at = now()
where id = pg_temp.got('reserve', '{file_id}')::uuid;

select pg_temp.sign_in('a1390000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.files where id = pg_temp.got('reserve', '{file_id}')::uuid), 0,
  'who does not read the books does not see the document''s row, nor download it');
reset role;
select pg_temp.sign_in('a1390000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select count(*)::integer from public.files where id = pg_temp.got('reserve', '{file_id}')::uuid), 1,
  'who reads the books sees it');
reset role;

-- ---------- The reading's ceiling ----------

select pg_temp.as_person('a1390000-0000-4000-8000-000000000004', 'allowed',
  $$public.finance_document_reading_allowed('b1390000-0000-4000-8000-00000000000a')$$);
update public.platform_settings set value = value || '{"document_reads": 1}'::jsonb where key = 'finance';
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, started_at)
select 'b1390000-0000-4000-8000-00000000000a', 'financeiro.documento.leitura', v.id, 'anthropic', 'claude-sonnet-5-5',
  repeat('b', 64), 'running', now()
from public.prompt_versions v where v.task = 'financeiro.documento.leitura' and v.version = 1;
select pg_temp.as_person('a1390000-0000-4000-8000-000000000004', 'allowed-full',
  $$public.finance_document_reading_allowed('b1390000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1390000-0000-4000-8000-000000000003', 'allowed-bia',
  $$public.finance_document_reading_allowed('b1390000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('allowed', '{ok}') = 'true' and pg_temp.got('allowed-full', '{code}') = 'document_limit'
    and pg_temp.got('allowed-bia', '{code}') = 'not_allowed',
  'ONE reads a document for who writes in the books, within the day''s ceiling'
);

-- ---------- Kept with the bill ----------

select pg_temp.as_person('a1390000-0000-4000-8000-000000000004', 'power',
  format($$public.save_finance_bill('b1390000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'counterparty', 'Energia Teste', 'category_id', pg_temp.category('despesa.utilidades'),
    'cents', '18990', 'due_on', current_date + 10)));
select pg_temp.as_person('a1390000-0000-4000-8000-000000000004', 'attach',
  format($$public.attach_finance_document('b1390000-0000-4000-8000-00000000000a', 'bill', %L, %L)$$,
    pg_temp.got('power', '{bill_id}'), pg_temp.got('reserve', '{file_id}')));
select pg_temp.as_person('a1390000-0000-4000-8000-000000000005', 'attach-rocha',
  format($$public.attach_finance_document('b1390000-0000-4000-8000-00000000000b', 'bill', %L, %L)$$,
    pg_temp.got('power', '{bill_id}'), pg_temp.got('reserve', '{file_id}')));
select ok(
  pg_temp.got('attach', '{ok}') = 'true'
    and (select file_id::text from public.finance_bills where id = pg_temp.got('power', '{bill_id}')::uuid) = pg_temp.got('reserve', '{file_id}')
    and pg_temp.got('attach-rocha', '{code}') = 'file_not_found',
  'the document is kept with the bill it was read into, and never with another firm''s'
);

select pg_temp.as_backend('discard', format($$public.discard_file(%L)$$, pg_temp.got('reserve', '{file_id}')));
select is(pg_temp.got('discard', '{code}'), 'in_use', 'a document a bill names is never forgotten');

-- ---------- What nobody saved ----------

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                          detected_mime, confirmed_at, created_at, expires_at) values
  ('e2390000-0000-4000-8000-000000000001', 'b1390000-0000-4000-8000-00000000000a', 'finance',
   'org/b1390000-0000-4000-8000-00000000000a/finance/e2390000-0000-4000-8000-000000000001', 'recibo.pdf', 'application/pdf',
   100, 'stored', repeat('c', 64), 100, 'application/pdf', now() - interval '2 days', now() - interval '2 days',
   now() - interval '2 days' + interval '1 hour');
select pg_temp.as_backend('unused', $$(select array_agg(file_id) from public.finance_unused_documents(50))$$);
select ok(
  pg_temp.got('unused', '{}') like '%e2390000-0000-4000-8000-000000000001%'
    and pg_temp.got('unused', '{}') not like '%' || pg_temp.got('reserve', '{file_id}') || '%',
  'a document sent for a form nobody saved is handed back after a day, never one a bill keeps'
);

select * from finish();
rollback;
