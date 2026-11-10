begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- Honorários e custos do caso (0131). Lima opens its books and Ana, a
-- partner, confirms how it charges the delays with the second factor. A
-- client signs the fee contract: the terms are the case's and ONE writes the
-- entry and the installments as bills to receive. A release received makes
-- the success fee a bill, once. Caio, a lawyer who reads only the costs,
-- writes a cost the client owes, which is a bill of the reimbursement, and
-- reads the cost and nothing of the fees. The books say how many cases in
-- court have no fees. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1300000-0000-4000-8000-000000000001', 'ana@lima-honorarios.invalid', 'Ana Lima'),
  ('a1300000-0000-4000-8000-000000000002', 'caio@lima-honorarios.invalid', 'Caio Lima'),
  ('a1300000-0000-4000-8000-000000000005', 'edu@rocha-honorarios.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1300000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-honorarios', 'a1300000-0000-4000-8000-000000000001'),
  ('b1300000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-honorarios', 'a1300000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1300000-0000-4000-8000-00000000000a', 'a1300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1300000-0000-4000-8000-00000000000a', 'a1300000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1300000-0000-4000-8000-00000000000b', 'a1300000-0000-4000-8000-000000000005', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1300000-0000-4000-8000-000000000002', 'b1300000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.people (id, org_id, full_name) values
  ('d1300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000001',
   'd1300000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');

-- The fee contract, issued and sent to sign by gov.br.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e2300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'upload',
   'org/b1300000-0000-4000-8000-00000000000a/upload/e2300000-0000-4000-8000-000000000001', 'contrato.pdf', 'application/pdf',
   100, 'stored', repeat('a', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('a7300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000001',
   'e2300000-0000-4000-8000-000000000001', 'power_of_attorney', 'firm', 'accepted');
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers) values
  ('a8300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000001',
   'a7300000-0000-4000-8000-000000000001', 'govbr', 'pending',
   '[{"position": 1, "person_id": "d1300000-0000-4000-8000-000000000001", "name": "Maria Teste"}]');
insert into public.case_papers (org_id, case_id, person_id, kind, document_id, envelope_id) values
  ('b1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
   'contrato', 'a7300000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000001');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1300000-0000-4000-8000-00000000000a', current_date - 60)$$);

-- ---------- The firm's terms ----------

select pg_temp.as_person('a1300000-0000-4000-8000-000000000002', 'terms-caio',
  $$public.save_fee_terms('b1300000-0000-4000-8000-00000000000a', '{"incident": "delay", "success_percent": "30"}')$$);
select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'terms-aal1',
  $$public.save_fee_terms('b1300000-0000-4000-8000-00000000000a', '{"incident": "delay", "success_percent": "30"}')$$, 'aal1');
select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'terms-first',
  $$public.save_fee_terms('b1300000-0000-4000-8000-00000000000a', '{"module": "direito-do-passageiro", "incident": "delay", "success_percent": "25"}')$$);
select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'terms',
  $$public.save_fee_terms('b1300000-0000-4000-8000-00000000000a', '{"module": "direito-do-passageiro", "incident": "delay",
    "entry_cents": "50000", "installments": "3", "installment_cents": "20000", "success_percent": "30",
    "success_min_cents": "50000", "settlement_percent": "20"}')$$);
select ok(
  pg_temp.got('terms-caio', '{code}') = 'not_allowed' and pg_temp.got('terms-aal1', '{code}') = 'second_factor'
    and pg_temp.got('terms', '{ok}') = 'true'
    and (select count(*) = 1 from public.fee_terms where org_id = 'b1300000-0000-4000-8000-00000000000a' and archived_at is null)
    and exists (select 1 from public.fee_terms where success_percent = 25 and archived_at is not null),
  'who decides for the firm confirms its terms with the second factor; the terms before are archived, never deleted'
);

-- ---------- The contract signed ----------

update public.signature_envelopes set status = 'signed', signed_document_id = 'a7300000-0000-4000-8000-000000000001'
where id = 'a8300000-0000-4000-8000-000000000001';
select ok(
  (select source = 'terms' and entry_cents = 50000 and success_percent = 30 and bills_at is not null
   from public.case_fees where case_id = 'c1300000-0000-4000-8000-000000000001')
    and (select count(*) = 4 and sum(cents) = 110000 and bool_and(direction = 'receive' and source = 'fees' and by_one
                                                                  and counterparty = 'Maria Teste')
         from public.finance_bills where case_id = 'c1300000-0000-4000-8000-000000000001'),
  'when the client signs the contract, the terms are the case''s, and ONE writes the entry and the installments to receive'
);

-- ---------- The success fee ----------

insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source) values
  ('a9300000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000001',
   'f1300000-0000-4000-8000-000000000001', 'alvara', 'alvara', 1000000, current_date, 'person');
update public.lawsuit_facts set received_cents = 1000000, received_on = current_date
where id = 'a9300000-0000-4000-8000-000000000001';
update public.lawsuit_facts set received_cents = 1000000, received_on = current_date - 1
where id = 'a9300000-0000-4000-8000-000000000001';
select ok(
  (select count(*) = 1 and min(cents) = 300000 and bool_and(source = 'success')
   from public.finance_bills where fact_id = 'a9300000-0000-4000-8000-000000000001'),
  'a release received makes the success fee a bill to receive, once: thirty percent of what arrived'
);

-- ---------- The costs ----------

select pg_temp.as_person('a1300000-0000-4000-8000-000000000002', 'cost',
  format($$public.save_case_cost('c1300000-0000-4000-8000-000000000001', %L::jsonb)$$, jsonb_build_object(
    'description', 'Custas do recurso', 'cents', '32000', 'spent_on', current_date, 'paid_by', 'firm', 'owed_by', 'client')));
select pg_temp.as_person('a1300000-0000-4000-8000-000000000002', 'cost-bad',
  format($$public.save_case_cost('c1300000-0000-4000-8000-000000000001', %L::jsonb)$$, jsonb_build_object(
    'description', 'Custas', 'cents', '100', 'spent_on', current_date, 'paid_by', 'client', 'owed_by', 'client')));
select ok(
  pg_temp.got('cost', '{ok}') = 'true' and pg_temp.got('cost-bad', '{field}') = 'paid_by'
    and (select b.source = 'cost' and b.cents = 32000 from public.finance_bills b
         join public.case_costs c on c.bill_id = b.id where c.description = 'Custas do recurso'),
  'anybody who works on the case writes a cost; one the client owes is a bill of the reimbursement'
);

select pg_temp.sign_in('a1300000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio-reads', jsonb_build_object(
  'costs', (select count(*) from public.case_costs),
  'fees', (select count(*) from public.case_fees),
  'terms', (select count(*) from public.fee_terms)));
reset role;
select ok(
  pg_temp.got('caio-reads', '{costs}') = '1' and pg_temp.got('caio-reads', '{fees}') = '0'
    and pg_temp.got('caio-reads', '{terms}') = '0',
  'who reads only the costs of the cases reads the costs, and nothing of the fees'
);

select pg_temp.as_person('a1300000-0000-4000-8000-000000000002', 'absorb-caio',
  format($$public.absorb_case_cost(%L, 'A ação terminou sem liberação.')$$,
    (select id from public.case_costs where description = 'Custas do recurso')));
select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'absorb',
  format($$public.absorb_case_cost(%L, 'A ação terminou sem liberação.')$$,
    (select id from public.case_costs where description = 'Custas do recurso')));
select ok(
  pg_temp.got('absorb-caio', '{code}') = 'not_allowed' and pg_temp.got('absorb', '{ok}') = 'true'
    and (select b.status = 'cancelled' from public.finance_bills b join public.case_costs c on c.bill_id = b.id
         where c.description = 'Custas do recurso'),
  'a cost is absorbed by who operates the books, its reimbursement cancelled with the reason'
);

-- ---------- A case by hand, and the cases with no fees ----------

select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'waits',
  $$public.firm_finance_attention('b1300000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'by-hand',
  $$public.save_case_fees('c1300000-0000-4000-8000-000000000002', '{"from_terms": "true"}')$$);
select pg_temp.as_person('a1300000-0000-4000-8000-000000000001', 'again',
  $$public.save_case_fees('c1300000-0000-4000-8000-000000000002', '{"success_percent": "10"}')$$);
select ok(
  pg_temp.got('waits', '{fees_missing}') = '1' and pg_temp.got('by-hand', '{bills}') = '4'
    and pg_temp.got('again', '{code}') = 'fees_billed',
  'the books say a case in court has no fees; a person sets them from the terms, and ONE writes the bills, once'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('a1300000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('rocha-reads', to_jsonb((select count(*) from public.case_costs) + (select count(*) from public.case_fees)
  + (select count(*) from public.fee_terms)));
select throws_ok(
  $$ select public.save_case_cost('c1300000-0000-4000-8000-000000000001', '{"description": "x", "cents": "1"}') $$,
  '42501', null, 'nobody of another firm writes a cost');
reset role;
select is(pg_temp.got('rocha-reads', '{}'), '0', 'and reads nothing of the fees and the costs');

select * from finish();
rollback;
