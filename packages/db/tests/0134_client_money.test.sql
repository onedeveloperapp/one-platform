begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- O dinheiro do cliente (0135). Lima opens its books; Ana is a partner and
-- Caio a lawyer who reads only the costs. Maria and her son João won a
-- lawsuit of the TJGO, where the money falls in the firm's account; the fee
-- contract was signed. A release received owes its split; the backend
-- records it (the mother's part owed by its day, the son's held for the
-- judge), the parts must add up, Ana records the transfer, Maria gives her
-- Pix (only her own CPF) and confirms she received it. A part held for lack
-- of a clause is decided by Ana with the second factor. Rocha reads nothing.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1340000-0000-4000-8000-000000000001', 'ana@lima-repasse.invalid', 'Ana Lima'),
  ('a1340000-0000-4000-8000-000000000002', 'caio@lima-repasse.invalid', 'Caio Lima'),
  ('a1340000-0000-4000-8000-000000000009', 'edu@rocha-repasse.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1340000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-repasse', 'a1340000-0000-4000-8000-000000000001'),
  ('b1340000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-repasse', 'a1340000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1340000-0000-4000-8000-00000000000a', 'a1340000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1340000-0000-4000-8000-00000000000a', 'a1340000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1340000-0000-4000-8000-00000000000b', 'a1340000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('d1340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '1990-03-10'),
  ('d1340000-0000-4000-8000-000000000002', 'b1340000-0000-4000-8000-00000000000a', 'João Teste', null, '2018-05-01');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-000000000001',
   'd1340000-0000-4000-8000-000000000001', 'claimant');
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e1340000-0000-4000-8000-000000000002', 'b1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-000000000001',
   'd1340000-0000-4000-8000-000000000002', 'claimant', 'e1340000-0000-4000-8000-000000000001');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-000000000001',
   'comum', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1340000-0000-4000-8000-000000000001', 'e1340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a'),
  ('f1340000-0000-4000-8000-000000000001', 'e1340000-0000-4000-8000-000000000002', 'b1340000-0000-4000-8000-00000000000a');
insert into public.case_fees (case_id, org_id, success_percent, source) values
  ('c1340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 30, 'person');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a8340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-000000000001',
   'd1340000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-da-maria', 'UTF8')), 'hex'), now() + interval '30 days');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create function pg_temp.backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "service_role"}', true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
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
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.backend();
  set local role service_role;
  execute format('insert into res values (%L, to_jsonb((%s)))', name, call);
  reset role;
end;
$$;

select pg_temp.as_person('a1340000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1340000-0000-4000-8000-00000000000a', current_date - 60)$$);

-- ---------- The release, received ----------

insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source) values
  ('a9340000-0000-4000-8000-000000000001', 'b1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-000000000001',
   'f1340000-0000-4000-8000-000000000001', 'alvara', 'alvara', 2000000, current_date - 2, 'person');
update public.lawsuit_facts set received_cents = 2000000, received_on = current_date - 1
where id = 'a9340000-0000-4000-8000-000000000001';
select pg_temp.as_backend('to-split', $$public.money_release_to_split(
  (select id from public.money_releases where fact_id = 'a9340000-0000-4000-8000-000000000001'))$$);
select ok(
  pg_temp.got('to-split', '{path}') = 'firm' and pg_temp.got('to-split', '{received_cents}') = '2000000'
    and (select jsonb_agg((c ->> 'minor')::boolean order by c ->> 'party_id') = '[false, true]'::jsonb
         from res, jsonb_array_elements(value -> 'claimants') c where key = 'to-split')
    and pg_temp.got('to-split', '{fees_authorized}') = 'false',
  'a release received owes its split, by the court''s way of paying: the claimants, who is a minor, the fees'
);

-- ---------- The split ----------

select pg_temp.as_backend('split-bad', format($$public.record_money_split(%L, 'repasse-v1', %L::jsonb)$$,
  (select id from public.money_releases where fact_id = 'a9340000-0000-4000-8000-000000000001'),
  '[{"party_id": "e1340000-0000-4000-8000-000000000001", "person_id": "d1340000-0000-4000-8000-000000000001", "minor": false,
     "gross_cents": 900000, "fees_cents": 0, "costs_cents": 0, "held": [{"reason": "no_clause", "cents": 300000}], "payable_cents": 600000}]'));
select ok(
  pg_temp.got('split-bad', '{code}') = 'split_mismatch' and (select status = 'pending' from public.money_releases)
    and not exists (select 1 from public.money_shares),
  'a split whose parts do not add up to what was received is refused whole'
);

select pg_temp.as_backend('split', format($$public.record_money_split(%L, 'repasse-v1', %L::jsonb)$$,
  (select id from public.money_releases where fact_id = 'a9340000-0000-4000-8000-000000000001'),
  '[{"party_id": "e1340000-0000-4000-8000-000000000001", "person_id": "d1340000-0000-4000-8000-000000000001", "minor": false,
     "gross_cents": 1000000, "fees_cents": 0, "costs_cents": 0, "held": [{"reason": "no_clause", "cents": 300000}], "payable_cents": 700000},
    {"party_id": "e1340000-0000-4000-8000-000000000002", "person_id": "d1340000-0000-4000-8000-000000000002", "minor": true,
     "gross_cents": 1000000, "fees_cents": 0, "costs_cents": 0, "held": [{"reason": "minor", "cents": 1000000}], "payable_cents": 0}]'));
select ok(
  pg_temp.got('split', '{ok}') = 'true'
    and (select status = 'held' and due_on is not null and held_cents = 300000 from public.money_shares
         where person_id = 'd1340000-0000-4000-8000-000000000001')
    and (select status = 'minor' and held_cents = 1000000 from public.money_shares
         where person_id = 'd1340000-0000-4000-8000-000000000002'),
  'the split is recorded: the mother''s fee in discussion held, the son''s part held whole for the judge'
);

-- ---------- The partner decides; the transfer ----------

select pg_temp.as_person('a1340000-0000-4000-8000-000000000002', 'decide-caio',
  format($$public.decide_money_hold(%L, 'paid_whole')$$, (select id from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001')));
select pg_temp.as_person('a1340000-0000-4000-8000-000000000001', 'decide',
  format($$public.decide_money_hold(%L, 'paid_whole')$$, (select id from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001')));
select ok(
  pg_temp.got('decide-caio', '{code}') = 'not_allowed' and pg_temp.got('decide', '{ok}') = 'true'
    and (select status = 'owed' and payable_cents = 1000000 from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001')
    and exists (select 1 from public.finance_bills where description = 'Honorários de êxito não compensados' and cents = 300000),
  'a partner decides a held part with the second factor: passed on whole, the fee becomes a bill to receive'
);

select pg_temp.as_person('a1340000-0000-4000-8000-000000000001', 'transfer',
  format($$public.record_money_transfer(%L, current_date)$$, (select id from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001')));
select pg_temp.as_person('a1340000-0000-4000-8000-000000000001', 'minor-order',
  format($$public.record_minor_order(%L, 'deposited')$$, (select id from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000002')));
select ok(
  pg_temp.got('transfer', '{ok}') = 'true' and pg_temp.got('minor-order', '{ok}') = 'true'
    and (select status = 'paid' from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001')
    and (select status = 'minor' and minor_order = 'deposited' from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000002'),
  'the transfer paid at the bank is recorded, and the judge''s order of the minor''s part'
);

-- ---------- The client's link ----------

select pg_temp.as_backend('pix-other', $$public.client_link_money('token-da-maria', 'pix', '{"pix_key": "123.456.789-09"}')$$);
select pg_temp.as_backend('pix', $$public.client_link_money('token-da-maria', 'pix', '{"pix_key": "529.982.247-25"}')$$);
select pg_temp.as_backend('confirm', format($$public.client_link_money('token-da-maria', null, null, %L)$$,
  (select id from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001')));
select ok(
  pg_temp.got('pix-other', '{code}') = 'not_own_cpf' and pg_temp.got('pix', '{account,ends}') = '4725'
    and (select jsonb_array_length(value -> 'shares') = 2 from res where key = 'confirm')
    and (select client_confirmed_at is not null from public.money_shares where person_id = 'd1340000-0000-4000-8000-000000000001'),
  'the client gives a Pix only in their own CPF, sees their part and their son''s, and confirms they received'
);

-- ---------- Who reads it ----------

select pg_temp.sign_in('a1340000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.money_shares), 0, 'who does not read the books reads no client''s part');
reset role;
select pg_temp.sign_in('a1340000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::integer from public.money_shares) + (select count(*)::integer from public.client_payment_accounts), 0,
  'and nobody of another firm');
reset role;

select * from finish();
rollback;
