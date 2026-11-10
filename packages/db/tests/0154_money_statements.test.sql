begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- A prestação de contas ao cliente (0156). Lima's books are open: Ana, a
-- partner, configures; Duda operates; Caio reads only the costs of the
-- cases. Maria's release is received and split; the statement brings the
-- Pix of her part: ONE marks it passed on, and a statement is owed. The
-- backend issues it; Maria reads it on her link; Caio and Rocha read
-- nothing of it. The Pix undone voids it and revokes its document; passed
-- on again, a new round is owed. Kept to a person, it waits for Duda.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1540000-0000-4000-8000-000000000001', 'ana@lima-contas.invalid', 'Ana Lima'),
  ('a1540000-0000-4000-8000-000000000002', 'caio@lima-contas.invalid', 'Caio Lima'),
  ('a1540000-0000-4000-8000-000000000004', 'duda@lima-contas.invalid', 'Duda Lima'),
  ('a1540000-0000-4000-8000-000000000009', 'edu@rocha-contas.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by, billing_cpf_cnpj) values
  ('b1540000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-contas', 'a1540000-0000-4000-8000-000000000001', '11222333000181'),
  ('b1540000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-contas', 'a1540000-0000-4000-8000-000000000009', null);
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1540000-0000-4000-8000-00000000000a', 'a1540000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1540000-0000-4000-8000-00000000000a', 'a1540000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1540000-0000-4000-8000-00000000000a', 'a1540000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1540000-0000-4000-8000-00000000000b', 'a1540000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('d1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a', 'Maria Teste de Oliveira', '52998224725', '1990-03-10');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a', 'c1540000-0000-4000-8000-000000000001',
   'd1540000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a', 'c1540000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1540000-0000-4000-8000-000000000001', 'e1540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a8540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a', 'c1540000-0000-4000-8000-000000000001',
   'd1540000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-das-contas', 'UTF8')), 'hex'), now() + interval '30 days');

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
create function pg_temp.statement(name text, sha text, lines jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.as_person('a1540000-0000-4000-8000-000000000004', name || '-begin',
    format($q$public.begin_finance_statement('b1540000-0000-4000-8000-00000000000a', %L, %L::jsonb)$q$,
      pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', name || '.ofx', 'sha256', sha)));
  perform pg_temp.as_person('a1540000-0000-4000-8000-000000000004', name || '-lines',
    format($q$public.add_finance_statement_lines('b1540000-0000-4000-8000-00000000000a', %L, %L::jsonb)$q$,
      pg_temp.got(name || '-begin', '{statement_id}'), lines));
  perform pg_temp.as_person('a1540000-0000-4000-8000-000000000004', name || '-finish',
    format($q$public.finish_finance_statement('b1540000-0000-4000-8000-00000000000a', %L)$q$,
      pg_temp.got(name || '-begin', '{statement_id}')));
end;
$$;
create function pg_temp.share() returns uuid language sql as $$
  select id from public.money_shares where person_id = 'd1540000-0000-4000-8000-000000000001';
$$;

select pg_temp.as_person('a1540000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1540000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1540000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1540000-0000-4000-8000-00000000000a', 'a1540000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1540000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1540000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

-- The release, received by a person and split by the backend: Maria's part is owed, and owes no statement yet.
insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source) values
  ('a9540000-0000-4000-8000-000000000001', 'b1540000-0000-4000-8000-00000000000a', 'c1540000-0000-4000-8000-000000000001',
   'f1540000-0000-4000-8000-000000000001', 'alvara', 'alvara', 800000, current_date - 6, 'person');
update public.lawsuit_facts set received_cents = 800000, received_on = current_date - 5
where id = 'a9540000-0000-4000-8000-000000000001';
select pg_temp.as_backend('split', format($$public.record_money_split(%L, 'repasse-v1', %L::jsonb)$$,
  (select id from public.money_releases where fact_id = 'a9540000-0000-4000-8000-000000000001'),
  '[{"party_id": "e1540000-0000-4000-8000-000000000001", "person_id": "d1540000-0000-4000-8000-000000000001", "minor": false,
     "gross_cents": 800000, "fees_cents": 240000, "costs_cents": 0, "held": [], "payable_cents": 560000}]'));
select ok(
  not exists (select 1 from public.money_statements),
  'a part still owed owes no statement'
);

-- ---------- Passed on: the statement is owed, issued and read ----------

select pg_temp.statement('pix', repeat('a', 64), jsonb_build_array(
  jsonb_build_object('bank_id', 'P1', 'posted_on', current_date - 1, 'cents', '-560000', 'memo', 'PIX ENVIADO MARIA TESTE DE OLIVEIRA')));
select pg_temp.as_backend('claim', $$(select jsonb_agg(c) from public.claim_money_statements(10) c)$$);
select pg_temp.as_backend('facts', format($$public.money_statement_to_issue(%L, %s)$$,
  pg_temp.got('claim', '{0,statement_id}'), pg_temp.got('claim', '{0,claim_seq}')));
select ok(
  pg_temp.got('facts', '{person}') = 'Maria Teste de Oliveira' and pg_temp.got('facts', '{gross_cents}') = '800000'
    and pg_temp.got('facts', '{fees_cents}') = '240000' and pg_temp.got('facts', '{payable_cents}') = '560000'
    and pg_temp.got('facts', '{paid_on}') = (current_date - 1)::text and pg_temp.got('facts', '{round}') = '1'
    and pg_temp.got('facts', '{cnj}') = '10003012720998090100',
  'the part passed on owes its statement, and the backend reads what it says'
);

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e1540000-0000-4000-8000-00000000000f', 'b1540000-0000-4000-8000-00000000000a', 'issued',
   'org/b1540000-0000-4000-8000-00000000000a/issued/e1540000-0000-4000-8000-00000000000f',
   'prestacao.pdf', 'application/pdf', 100, 'stored', repeat('d', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.issued_documents (id, org_id, kind, title, status, verify_code, file_id, content_hash, idempotency_key, issued_at) values
  ('e1540000-0000-4000-8000-0000000000d1', 'b1540000-0000-4000-8000-00000000000a', 'prestacao', 'Prestação de contas do caso nº 4',
   'issued', 'DEFGHJKMNPQR', 'e1540000-0000-4000-8000-00000000000f', repeat('d', 64), 'prestacao:teste-maria:1', now());
select pg_temp.as_backend('issued', format($$public.record_money_statement(%L, %s, 'e1540000-0000-4000-8000-0000000000d1')$$,
  pg_temp.got('claim', '{0,statement_id}'), pg_temp.got('claim', '{0,claim_seq}')));
select pg_temp.as_backend('link', $$public.client_link_money_statements('token-das-contas')$$);
select pg_temp.as_backend('link-file', format($$public.client_link_money_statement_file('token-das-contas', %L)$$,
  pg_temp.got('claim', '{0,statement_id}')));
select ok(
  pg_temp.got('issued', '{code}') = 'issued' and pg_temp.got('link', '{statements,0,verify_code}') = 'DEFGHJKMNPQR'
    and pg_temp.got('link-file', '{name}') = 'Prestação de contas do caso nº 4.pdf',
  'issued, the client reads it on their link and takes its file'
);

select pg_temp.as_person('a1540000-0000-4000-8000-000000000004', 'read',
  $$public.firm_money_statements('b1540000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1540000-0000-4000-8000-000000000002', 'read-caio',
  $$public.firm_money_statements('b1540000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('read', '{0,status}') = 'issued' and pg_temp.got('read', '{0,file_id}') = 'e1540000-0000-4000-8000-00000000000f'
    and (select value is null or value = 'null'::jsonb from res where key = 'read-caio'),
  'who reads the books sees the statement and its file; who reads only the costs, nothing'
);

select pg_temp.sign_in('a1540000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (select count(*) from public.issued_documents where kind = 'prestacao') = 0
    and (select count(*) from public.files where id = 'e1540000-0000-4000-8000-00000000000f') = 0,
  'who reads only the costs reads neither its document nor its file'
);
reset role;

-- ---------- Undone, then passed on again ----------

select pg_temp.as_person('a1540000-0000-4000-8000-000000000004', 'undo',
  format($$public.undo_finance_line('b1540000-0000-4000-8000-00000000000a', %L)$$,
    (select id from public.finance_statement_lines where bank_id = 'P1')));
select ok(
  (select status = 'void' from public.money_statements where share_id = pg_temp.share())
    and (select status = 'revoked' from public.issued_documents where id = 'e1540000-0000-4000-8000-0000000000d1'),
  'the Pix undone voids the statement and revokes its document'
);

select pg_temp.as_person('a1540000-0000-4000-8000-000000000001', 'keep',
  $$public.set_firm_autonomy('b1540000-0000-4000-8000-00000000000a', 'client_receipt', 'approval')$$);
select pg_temp.statement('pix-again', repeat('b', 64), jsonb_build_array(
  jsonb_build_object('bank_id', 'P2', 'posted_on', current_date, 'cents', '-560000', 'memo', 'PIX ENVIADO MARIA TESTE DE OLIVEIRA')));
select pg_temp.as_backend('claim-kept', $$(select coalesce(jsonb_agg(c), '[]'::jsonb) from public.claim_money_statements(10) c)$$);
select ok(
  (select status = 'owed' and round = 2 from public.money_statements where share_id = pg_temp.share())
    and pg_temp.got('claim-kept', '{}') = '[]',
  'passed on again, a new round is owed; kept to a person, the backend claims none'
);

select pg_temp.as_person('a1540000-0000-4000-8000-000000000004', 'ask',
  format($$public.request_money_statement('b1540000-0000-4000-8000-00000000000a', %L)$$, pg_temp.share()));
select pg_temp.as_backend('claim-asked', $$(select jsonb_agg(c) from public.claim_money_statements(10) c)$$);
select ok(
  pg_temp.got('ask', '{code}') = 'requested' and jsonb_array_length((select value from res where key = 'claim-asked')) = 1,
  'once who operates the books asks for it, the backend issues it'
);

select pg_temp.sign_in('a1540000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::integer from public.money_statements), 0, 'another firm reads none of it');
reset role;

select * from finish();
rollback;
