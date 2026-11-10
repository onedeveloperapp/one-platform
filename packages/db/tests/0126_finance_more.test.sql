begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- Os livros, segunda parte (0127). Lima opens its books: Ana, a partner,
-- configures; Fabi manages the firm account and is no partner, so the books
-- are not hers; Caio reads the costs of the cases; Bia views and Duda
-- operates. A statement in CSV is read: the same export twice adds nothing,
-- another export that holds the same lines knows them, and two equal
-- payments of one file are two lines. The court's release is a client's
-- money to set apart until somebody says it was; an account whose statement
-- ended long ago is late; what waits is read by who reads the books only.
-- An export of the entries is on the record within the day's limit, and the
-- books take out who a movement was of after the setting's years.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1260000-0000-4000-8000-000000000001', 'ana@lima-livros2.invalid', 'Ana Lima'),
  ('a1260000-0000-4000-8000-000000000002', 'caio@lima-livros2.invalid', 'Caio Lima'),
  ('a1260000-0000-4000-8000-000000000003', 'bia@lima-livros2.invalid', 'Bia Lima'),
  ('a1260000-0000-4000-8000-000000000004', 'duda@lima-livros2.invalid', 'Duda Lima'),
  ('a1260000-0000-4000-8000-000000000006', 'fabi@lima-livros2.invalid', 'Fabi Lima'),
  ('a1260000-0000-4000-8000-000000000005', 'edu@rocha-livros2.invalid', 'Edu Rocha'),
  ('a1260000-0000-4000-8000-000000000009', 'suporte@one-livros2.invalid', 'Suporte')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1260000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-livros2', 'a1260000-0000-4000-8000-000000000001'),
  ('b1260000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-livros2', 'a1260000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000006', 'admin', 'atendimento'),
  ('b1260000-0000-4000-8000-00000000000b', 'a1260000-0000-4000-8000-000000000005', 'owner', 'socio');

create function pg_temp.sign_in(person uuid, aal text default 'aal2', session uuid default null)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal, 'session_id', session))::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2', session uuid default null)
returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal, session);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

-- The books open, Bia views and Duda operates, and a bank account is made.
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1260000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'grant-bia',
  $$public.set_finance_access('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000003', 'view')$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1260000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'other-bank',
  $$public.save_finance_account('b1260000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Banco do Brasil"}')$$);

-- ---------- Who manages the firm and is no partner ----------

select pg_temp.as_person('a1260000-0000-4000-8000-000000000006', 'fabi-level',
  $$to_jsonb(public.finance_level('b1260000-0000-4000-8000-00000000000a'))$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000006', 'fabi-attention',
  $$coalesce(public.firm_finance_attention('b1260000-0000-4000-8000-00000000000a'), 'null'::jsonb)$$);
select ok(
  pg_temp.got('fabi-level', '{}') = 'costs' and (select value = 'null'::jsonb from res where key = 'fabi-attention'),
  'who manages the firm account and is no partner, in a firm with a partner, reads nothing of the books'
);

-- ---------- A statement in CSV ----------

select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'pdf',
  format($$public.begin_finance_statement('b1260000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'extrato.pdf', 'sha256', repeat('e', 64), 'format', 'pdf')));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'csv',
  format($$public.begin_finance_statement('b1260000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'extrato.csv', 'sha256', repeat('d', 64), 'format', 'csv',
      'starts_on', current_date - 30, 'ends_on', current_date - 25)));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'csv-lines',
  format($$public.add_finance_statement_lines('b1260000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('csv', '{statement_id}'), jsonb_build_array(
      jsonb_build_object('bank_id', 't:alvara1', 'posted_on', current_date - 28, 'cents', '249000', 'memo', 'TED ALVARA JUDICIAL TJGO'),
      jsonb_build_object('bank_id', 't:tarifa1', 'posted_on', current_date - 27, 'cents', '-1500', 'memo', 'TARIFA PACOTE'),
      jsonb_build_object('bank_id', 't:tarifa2', 'posted_on', current_date - 27, 'cents', '-1500', 'memo', 'TARIFA PACOTE'))));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'csv-finish',
  format($$public.finish_finance_statement('b1260000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('csv', '{statement_id}')));
select ok(
  pg_temp.got('pdf', '{field}') = 'file' and pg_temp.got('csv', '{ok}') = 'true'
    and (select format = 'csv' from public.finance_statements where file_name = 'extrato.csv')
    and pg_temp.got('csv-lines', '{added}') = '3' and pg_temp.got('csv-lines', '{repeated}') = '1',
  'a statement in CSV is read as the OFX is; two equal payments of one file are two lines, the second said as a possible repetition'
);

select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'csv-again',
  format($$public.begin_finance_statement('b1260000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'extrato-de-novo.csv', 'sha256', repeat('d', 64), 'format', 'csv')));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'csv-wider',
  format($$public.begin_finance_statement('b1260000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'extrato-maior.xlsx', 'sha256', repeat('f', 64), 'format', 'xlsx',
      'starts_on', current_date - 30, 'ends_on', current_date - 25)));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'csv-wider-lines',
  format($$public.add_finance_statement_lines('b1260000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('csv-wider', '{statement_id}'), jsonb_build_array(
      jsonb_build_object('bank_id', 't:alvara1', 'posted_on', current_date - 28, 'cents', '249000', 'memo', 'TED ALVARA JUDICIAL TJGO'),
      jsonb_build_object('bank_id', 't:tarifa1', 'posted_on', current_date - 27, 'cents', '-1500', 'memo', 'TARIFA PACOTE'))));
select ok(
  pg_temp.got('csv-again', '{code}') = 'already_imported'
    and pg_temp.got('csv-wider-lines', '{added}') = '0' and pg_temp.got('csv-wider-lines', '{known}') = '2',
  'the same export twice adds nothing, and another export holding the same lines knows them'
);

-- ---------- A client's money to set apart ----------

select pg_temp.as_person('a1260000-0000-4000-8000-000000000003', 'bia-attention',
  $$public.firm_finance_attention('b1260000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('bia-attention', '{apart,count}') = '1' and pg_temp.got('bia-attention', '{apart,cents}') = '249000'
    and pg_temp.got('bia-attention', '{lines,count}') = '2',
  'a court''s release net of the bank''s fee is a client''s money, to set apart; the fees wait for a person'
);

select pg_temp.as_person('a1260000-0000-4000-8000-000000000003', 'apart-bia',
  format($$public.set_finance_money_apart('b1260000-0000-4000-8000-00000000000a', %L, true)$$,
    (select id from public.finance_entries where kind = 'client_money' and org_id = 'b1260000-0000-4000-8000-00000000000a')));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'apart',
  format($$public.set_finance_money_apart('b1260000-0000-4000-8000-00000000000a', %L, true)$$,
    (select id from public.finance_entries where kind = 'client_money' and org_id = 'b1260000-0000-4000-8000-00000000000a')));
select pg_temp.as_person('a1260000-0000-4000-8000-000000000004', 'after-apart',
  $$public.firm_finance_attention('b1260000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('apart-bia', '{code}') = 'not_allowed' and pg_temp.got('apart', '{ok}') = 'true'
    and pg_temp.got('after-apart', '{apart,count}') = '0'
    and exists (select 1 from public.audit_events where action = 'finance.money_set_apart'),
  'who operates says the client''s money was set apart, on the record; who only views does not'
);

-- ---------- A statement that is late ----------

select ok(
  (select count(*) = 1 and bool_and(item ->> 'name' = 'Itaú PJ')
   from res, jsonb_array_elements(value -> 'late') item where key = 'after-apart'),
  'an account whose last statement ended long ago is late; one made today is not yet'
);

-- ---------- Who reads what waits ----------

select pg_temp.as_person('a1260000-0000-4000-8000-000000000002', 'caio-attention',
  $$coalesce(public.firm_finance_attention('b1260000-0000-4000-8000-00000000000a'), 'null'::jsonb)$$);
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1260000-0000-4000-8000-000000000009', 'a1260000-0000-4000-8000-000000000001', 'b1260000-0000-4000-8000-00000000000a',
        'Conferindo os livros', 'f2260000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'visit-attention',
  $$coalesce(public.firm_finance_attention('b1260000-0000-4000-8000-00000000000a'), 'null'::jsonb)$$,
  'aal2', 'f2260000-0000-4000-8000-000000000001');
select pg_temp.as_person('a1260000-0000-4000-8000-000000000005', 'rocha-attention',
  $$coalesce(public.firm_finance_attention('b1260000-0000-4000-8000-00000000000a'), 'null'::jsonb)$$);
select ok(
  (select bool_and(value = 'null'::jsonb) from res where key in ('caio-attention', 'visit-attention', 'rocha-attention')),
  'what waits in the books is read by nobody who does not read them: the costs of the cases, a support visit, another firm'
);

-- ---------- The export of the entries ----------

select pg_temp.as_person('a1260000-0000-4000-8000-000000000003', 'export',
  $$public.begin_finance_export('b1260000-0000-4000-8000-00000000000a', 'xlsx', 3)$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000002', 'export-caio',
  $$public.begin_finance_export('b1260000-0000-4000-8000-00000000000a', 'xlsx', 3)$$);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000001', 'export-visit',
  $$public.begin_finance_export('b1260000-0000-4000-8000-00000000000a', 'pdf', 3)$$, 'aal2', 'f2260000-0000-4000-8000-000000000001');
select ok(
  pg_temp.got('export', '{ok}') = 'true' and pg_temp.got('export-caio', '{code}') = 'not_allowed'
    and pg_temp.got('export-visit', '{code}') = 'support_visit'
    and (select metadata = jsonb_build_object('format', 'xlsx', 'rows', 3) from public.audit_events
         where action = 'finance.exported' and actor_id = 'a1260000-0000-4000-8000-000000000003'),
  'who reads the books exports the entries, on the record with the format and how many; nobody else, never a support visit'
);

insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
select 'b1260000-0000-4000-8000-00000000000a', 'a1260000-0000-4000-8000-000000000003', 'finance.exported', 'organization',
       'b1260000-0000-4000-8000-00000000000a', '{}'::jsonb
from generate_series(1, 19);
select pg_temp.as_person('a1260000-0000-4000-8000-000000000003', 'export-over',
  $$public.begin_finance_export('b1260000-0000-4000-8000-00000000000a', 'xlsx', 3)$$);
select is(pg_temp.got('export-over', '{code}'), 'daily_limit', 'a person exports the books the setting''s times a day');

-- ---------- How long the books keep who a movement was of ----------

insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, occurred_on,
  competence_on, source)
values ('b1260000-0000-4000-8000-00000000000a', pg_temp.got('other-bank', '{account_id}')::uuid, 'expense', -5000,
  (select id from public.finance_categories where org_id = 'b1260000-0000-4000-8000-00000000000a' and code = 'despesa.outras'),
  'Maria Antiga', 'Despesa de sete anos atrás', current_date - interval '7 years', current_date - interval '7 years', 'manual');
insert into public.finance_statement_lines (org_id, account_id, statement_id, posted_on, cents, memo, line_key)
values ('b1260000-0000-4000-8000-00000000000a', pg_temp.got('bank', '{account_id}')::uuid, pg_temp.got('csv', '{statement_id}')::uuid,
  current_date - interval '7 years', -5000, 'PIX MARIA ANTIGA', 'antiga');
select pg_temp.sign_in('a1260000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.finance_retention_sweep(10) $$,
  '42501', null,
  'only the backend takes out who a movement was of'
);
reset role;
select public.finance_retention_sweep(10);
select ok(
  (select counterparty is null and description is null and deidentified_at is not null and cents = -5000
   from public.finance_entries where cents = -5000 and org_id = 'b1260000-0000-4000-8000-00000000000a')
    and (select memo = '' and line_key like 'x|%' from public.finance_statement_lines where cents = -5000)
    and (select memo = 'TED ALVARA JUDICIAL TJGO' and deidentified_at is null from public.finance_statement_lines
         where bank_id = 't:alvara1'),
  'after the setting''s years the books take out who a movement was of and keep its value; a recent one is kept whole'
);

select * from finish();
rollback;
