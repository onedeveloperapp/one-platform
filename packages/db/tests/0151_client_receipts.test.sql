begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- O recibo ao cliente (0152). Lima's books are open: Ana, a partner,
-- configures; Duda operates; Caio reads only the costs of the cases. Maria
-- pays the entry of her fees: a receipt is owed of her, never of a bill of
-- no case nor of one the firm pays. The backend fails once, then issues it;
-- Maria reads it on her link, Caio and Rocha nothing. The payment undone
-- voids it and revokes its document. Kept to a person, the next receipt
-- waits until Duda asks for it.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1510000-0000-4000-8000-000000000001', 'ana@lima-recibo.invalid', 'Ana Lima'),
  ('a1510000-0000-4000-8000-000000000002', 'caio@lima-recibo.invalid', 'Caio Lima'),
  ('a1510000-0000-4000-8000-000000000004', 'duda@lima-recibo.invalid', 'Duda Lima'),
  ('a1510000-0000-4000-8000-000000000005', 'edu@rocha-recibo.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by, billing_cpf_cnpj) values
  ('b1510000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-recibo', 'a1510000-0000-4000-8000-000000000001', '11222333000181'),
  ('b1510000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-recibo', 'a1510000-0000-4000-8000-000000000005', null);
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1510000-0000-4000-8000-00000000000a', 'a1510000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1510000-0000-4000-8000-00000000000a', 'a1510000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1510000-0000-4000-8000-00000000000a', 'a1510000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1510000-0000-4000-8000-00000000000b', 'a1510000-0000-4000-8000-000000000005', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1510000-0000-4000-8000-000000000001', 'b1510000-0000-4000-8000-00000000000a', 7, 'direito-do-passageiro', 'delay', 'filed');
insert into public.people (id, org_id, full_name, cpf) values
  ('d1510000-0000-4000-8000-000000000001', 'b1510000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1510000-0000-4000-8000-000000000001', 'b1510000-0000-4000-8000-00000000000a', 'c1510000-0000-4000-8000-000000000001',
   'd1510000-0000-4000-8000-000000000001', 'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('f1510000-0000-4000-8000-000000000001', 'b1510000-0000-4000-8000-00000000000a', 'c1510000-0000-4000-8000-000000000001',
   'd1510000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-recibo', 'UTF8')), 'hex'), now() + interval '30 days');

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
create function pg_temp.category(target_code text) returns uuid language sql as $$
  select id from public.finance_categories where org_id = 'b1510000-0000-4000-8000-00000000000a' and code = target_code;
$$;
create function pg_temp.bill(what text) returns uuid language sql as $$
  select id from public.finance_bills where org_id = 'b1510000-0000-4000-8000-00000000000a' and description = what;
$$;

select pg_temp.as_person('a1510000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1510000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1510000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1510000-0000-4000-8000-00000000000a', 'a1510000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1510000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1510000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on, competence_on, source, by_one) values
  ('b1510000-0000-4000-8000-00000000000a', 'receive', 'Maria Teste', 'Entrada dos honorários', pg_temp.category('receita.contratuais'),
   'c1510000-0000-4000-8000-000000000001', 150000, current_date, current_date, 'fees', true),
  ('b1510000-0000-4000-8000-00000000000a', 'receive', 'Maria Teste', 'Parcela dos honorários', pg_temp.category('receita.contratuais'),
   'c1510000-0000-4000-8000-000000000001', 50000, current_date + 30, current_date + 30, 'fees', true),
  ('b1510000-0000-4000-8000-00000000000a', 'receive', 'Empresa Teste', 'Consultoria avulsa', pg_temp.category('receita.outras'), null, 80000, current_date, current_date, 'manual', false),
  ('b1510000-0000-4000-8000-00000000000a', 'pay', 'Tribunal Teste', 'Custas iniciais', pg_temp.category('despesa.custas'),
   'c1510000-0000-4000-8000-000000000001', 20000, current_date, current_date, 'manual', false);

create function pg_temp.settle(name text, what text) returns void language sql as $$
  select pg_temp.as_person('a1510000-0000-4000-8000-000000000004', name,
    format($q$public.settle_finance_bill('b1510000-0000-4000-8000-00000000000a', %L, %L::jsonb)$q$,
      pg_temp.bill(what),
      jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'), 'paid_on', current_date - 1,
        'cents', (select cents from public.finance_bills where description = what)::text)));
$$;
select pg_temp.settle('paid', 'Entrada dos honorários');
select pg_temp.settle('paid-other', 'Consultoria avulsa');
select pg_temp.settle('paid-cost', 'Custas iniciais');

-- ---------- Owed, then issued by the backend ----------

select ok(
  (select count(*) from public.finance_receipts where org_id = 'b1510000-0000-4000-8000-00000000000a') = 1
    and (select person_id = 'd1510000-0000-4000-8000-000000000001' and payer = 'Maria Teste' and cents = 150000
           and about = 'Entrada dos honorários' and status = 'owed'
         from public.finance_receipts where bill_id = pg_temp.bill('Entrada dos honorários')),
  'a client''s bill received owes its receipt, of the person of the case; a bill of no case or to pay owes none'
);

select pg_temp.as_backend('claim', $$(select jsonb_agg(c) from public.claim_finance_receipts(10) c)$$);
select pg_temp.as_backend('facts', format($$public.finance_receipt_to_issue(%L, %s)$$,
  pg_temp.got('claim', '{0,receipt_id}'), pg_temp.got('claim', '{0,claim_seq}')));
select ok(
  pg_temp.got('facts', '{payer}') = 'Maria Teste' and pg_temp.got('facts', '{payer_cpf}') = '52998224725'
    and pg_temp.got('facts', '{firm}') = 'Lima Advocacia' and pg_temp.got('facts', '{firm_document}') = '11222333000181'
    and pg_temp.got('facts', '{case_seq}') = '7' and pg_temp.got('facts', '{cents}') = '150000',
  'the backend claims it and reads what the receipt says: who paid, the firm, the case and the value'
);

select pg_temp.as_backend('fail', format($$public.record_finance_receipt(%L, %s, null, 'store_unavailable')$$,
  pg_temp.got('claim', '{0,receipt_id}'), pg_temp.got('claim', '{0,claim_seq}')));
select pg_temp.as_backend('claim-2', $$(select jsonb_agg(c) from public.claim_finance_receipts(10) c)$$);
select ok(
  (select status = 'owed' and error = 'store_unavailable' from public.finance_receipts
   where id = pg_temp.got('claim', '{0,receipt_id}')::uuid)
    and pg_temp.got('claim-2', '{0,claim_seq}')::integer = pg_temp.got('claim', '{0,claim_seq}')::integer + 1,
  'a try that failed gives the receipt back to the next claim, under a new number'
);

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e1510000-0000-4000-8000-00000000000f', 'b1510000-0000-4000-8000-00000000000a', 'issued',
   'org/b1510000-0000-4000-8000-00000000000a/issued/e1510000-0000-4000-8000-00000000000f',
   'recibo.pdf', 'application/pdf', 100, 'stored', repeat('c', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.issued_documents (id, org_id, kind, title, status, verify_code, file_id, content_hash, idempotency_key, issued_at) values
  ('e1510000-0000-4000-8000-0000000000d1', 'b1510000-0000-4000-8000-00000000000a', 'recibo', 'Recibo do caso nº 7', 'issued',
   'CDEFGHJKMNPQ', 'e1510000-0000-4000-8000-00000000000f', repeat('c', 64), 'recibo:teste-maria', now());

select pg_temp.as_backend('stale', format($$public.record_finance_receipt(%L, %s, 'e1510000-0000-4000-8000-0000000000d1')$$,
  pg_temp.got('claim', '{0,receipt_id}'), pg_temp.got('claim', '{0,claim_seq}')));
select pg_temp.as_backend('issued', format($$public.record_finance_receipt(%L, %s, 'e1510000-0000-4000-8000-0000000000d1')$$,
  pg_temp.got('claim-2', '{0,receipt_id}'), pg_temp.got('claim-2', '{0,claim_seq}')));
select pg_temp.as_backend('issued-again', format($$public.record_finance_receipt(%L, %s, 'e1510000-0000-4000-8000-0000000000d1')$$,
  pg_temp.got('claim', '{0,receipt_id}'), pg_temp.got('claim', '{0,claim_seq}')));
select ok(
  pg_temp.got('stale', '{code}') = 'not_working' and pg_temp.got('issued', '{code}') = 'issued'
    and pg_temp.got('issued-again', '{code}') = 'issued'
    and exists (select 1 from public.audit_events where action = 'finance.receipt_issued'
                and org_id = 'b1510000-0000-4000-8000-00000000000a' and metadata ->> 'auto' = 'true'),
  'only the claim in force records the document; the same document named again is the same record, on the record as ONE''s'
);

select ok(
  exists (select 1 from public.one_work_acts('b1510000-0000-4000-8000-00000000000a', now() - interval '1 hour', now() + interval '1 hour') a
          where a.kind = 'recibo_cliente' and not a.assisted),
  'the receipt counts in the work of ONE'
);

-- ---------- Who reads it ----------

select pg_temp.as_person('a1510000-0000-4000-8000-000000000004', 'read',
  format($$public.firm_finance_receipts('b1510000-0000-4000-8000-00000000000a', array[%L]::uuid[])$$,
    pg_temp.bill('Entrada dos honorários')));
select pg_temp.as_person('a1510000-0000-4000-8000-000000000002', 'read-caio',
  format($$public.firm_finance_receipts('b1510000-0000-4000-8000-00000000000a', array[%L]::uuid[])$$,
    pg_temp.bill('Entrada dos honorários')));
select ok(
  pg_temp.got('read', '{0,status}') = 'issued' and pg_temp.got('read', '{0,issued_documents,verify_code}') = 'CDEFGHJKMNPQ'
    and (select value is null or value = 'null'::jsonb from res where key = 'read-caio'),
  'who reads the books sees the receipt and its code; who reads only the costs, nothing'
);

select pg_temp.sign_in('a1510000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (select count(*) from public.issued_documents where kind = 'recibo') = 0
    and (select count(*) from public.files where id = 'e1510000-0000-4000-8000-00000000000f') = 0,
  'who reads only the costs reads neither the receipt''s document nor its file'
);
reset role;

select pg_temp.sign_in('a1510000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.finance_receipts), 0, 'another firm reads none of it');
reset role;

select pg_temp.as_backend('link', $$public.client_link_receipts('token-do-recibo')$$);
select pg_temp.as_backend('link-file', format($$public.client_link_receipt_file('token-do-recibo', %L)$$,
  pg_temp.got('claim', '{0,receipt_id}')));
select ok(
  pg_temp.got('link', '{receipts,0,verify_code}') = 'CDEFGHJKMNPQ' and pg_temp.got('link', '{receipts,0,cents}') = '150000'
    and pg_temp.got('link-file', '{name}') = 'Recibo do caso nº 7.pdf',
  'the client reads the receipt on their link and takes its file'
);

-- ---------- The payment undone ----------

select pg_temp.as_person('a1510000-0000-4000-8000-000000000004', 'cancel',
  format($$public.cancel_finance_entry('b1510000-0000-4000-8000-00000000000a', %L, 'Lançado em dobro')$$,
    pg_temp.got('paid', '{entry_id}')));
select pg_temp.as_backend('link-after', $$public.client_link_receipts('token-do-recibo')$$);
select ok(
  (select status = 'void' from public.finance_receipts where id = pg_temp.got('claim', '{0,receipt_id}')::uuid)
    and (select status = 'revoked' from public.issued_documents where id = 'e1510000-0000-4000-8000-0000000000d1')
    and pg_temp.got('link-after', '{receipts}') = '[]',
  'a payment undone voids its receipt and revokes its document, which leaves the client''s link'
);

-- ---------- Kept to a person ----------

select pg_temp.as_person('a1510000-0000-4000-8000-000000000001', 'keep',
  $$public.set_firm_autonomy('b1510000-0000-4000-8000-00000000000a', 'client_receipt', 'approval')$$);
select pg_temp.settle('paid-2', 'Parcela dos honorários');
select pg_temp.as_backend('claim-kept', $$(select coalesce(jsonb_agg(c), '[]'::jsonb) from public.claim_finance_receipts(10) c)$$);
select pg_temp.as_person('a1510000-0000-4000-8000-000000000004', 'read-kept',
  format($$public.firm_finance_receipts('b1510000-0000-4000-8000-00000000000a', array[%L]::uuid[])$$,
    pg_temp.bill('Parcela dos honorários')));
select ok(
  pg_temp.got('claim-kept', '{}') = '[]' and pg_temp.got('read-kept', '{0,status}') = 'waiting',
  'where the firm keeps receipts to a person, the backend claims none and the receipt waits'
);

select pg_temp.as_person('a1510000-0000-4000-8000-000000000002', 'ask-caio',
  format($$public.request_finance_receipt('b1510000-0000-4000-8000-00000000000a', %L)$$, pg_temp.bill('Parcela dos honorários')));
select is(pg_temp.got('ask-caio', '{code}'), 'not_allowed', 'only who operates the books asks for a receipt');

select pg_temp.as_person('a1510000-0000-4000-8000-000000000004', 'ask',
  format($$public.request_finance_receipt('b1510000-0000-4000-8000-00000000000a', %L)$$, pg_temp.bill('Parcela dos honorários')));
select pg_temp.as_backend('claim-asked', $$(select jsonb_agg(c) from public.claim_finance_receipts(10) c)$$);
select ok(
  pg_temp.got('ask', '{receipts}') = '1' and jsonb_array_length((select value from res where key = 'claim-asked')) = 1,
  'once a person asks for it, the backend issues it'
);

select * from finish();
rollback;
