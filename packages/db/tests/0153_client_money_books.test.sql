begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- O dinheiro do cliente nos livros (0155). Lima's books are open: Ana, a
-- partner, configures; Duda operates. The court ordered a release of
-- R$ 10.000,00 of Maria's lawsuit; the bank's statement brings it with its
-- correction, the memo carrying the lawsuit's number: ONE records it as
-- received. Split, the firm keeps R$ 3.070,35 of fees and R$ 200,00 of
-- costs: they leave the client's money and settle the success fee and the
-- costs owed back. The next statement brings the Pix of Maria's part: ONE
-- marks it passed on. Undoing it puts the part back to owed. A second
-- release, undone before its split, goes back to waiting. Maria is asked
-- for her account as soon as money is expected. Rocha reads none of it.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1530000-0000-4000-8000-000000000001', 'ana@lima-livros.invalid', 'Ana Lima'),
  ('a1530000-0000-4000-8000-000000000004', 'duda@lima-livros.invalid', 'Duda Lima'),
  ('a1530000-0000-4000-8000-000000000009', 'edu@rocha-livros.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1530000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-livros', 'a1530000-0000-4000-8000-000000000001'),
  ('b1530000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-livros', 'a1530000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1530000-0000-4000-8000-00000000000a', 'a1530000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1530000-0000-4000-8000-00000000000a', 'a1530000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1530000-0000-4000-8000-00000000000b', 'a1530000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('d1530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 'Maria Teste de Oliveira', '52998224725', '1990-03-10');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 'c1530000-0000-4000-8000-000000000001',
   'd1530000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 'c1530000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1530000-0000-4000-8000-000000000001', 'e1530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a');
insert into public.case_fees (case_id, org_id, success_percent, source) values
  ('c1530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 30, 'person');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a8530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 'c1530000-0000-4000-8000-000000000001',
   'd1530000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-dos-livros', 'UTF8')), 'hex'), now() + interval '30 days');

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
-- A statement of the bank account with these lines, finished, as Duda.
create function pg_temp.statement(name text, sha text, lines jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.as_person('a1530000-0000-4000-8000-000000000004', name || '-begin',
    format($q$public.begin_finance_statement('b1530000-0000-4000-8000-00000000000a', %L, %L::jsonb)$q$,
      pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', name || '.ofx', 'sha256', sha)));
  perform pg_temp.as_person('a1530000-0000-4000-8000-000000000004', name || '-lines',
    format($q$public.add_finance_statement_lines('b1530000-0000-4000-8000-00000000000a', %L, %L::jsonb)$q$,
      pg_temp.got(name || '-begin', '{statement_id}'), lines));
  perform pg_temp.as_person('a1530000-0000-4000-8000-000000000004', name || '-finish',
    format($q$public.finish_finance_statement('b1530000-0000-4000-8000-00000000000a', %L)$q$,
      pg_temp.got(name || '-begin', '{statement_id}')));
end;
$$;

select pg_temp.as_person('a1530000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1530000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1530000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1530000-0000-4000-8000-00000000000a', 'a1530000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1530000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1530000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

-- The release the court ordered, and a cost the firm advanced that Maria owes back.
insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source) values
  ('a9530000-0000-4000-8000-000000000001', 'b1530000-0000-4000-8000-00000000000a', 'c1530000-0000-4000-8000-000000000001',
   'f1530000-0000-4000-8000-000000000001', 'alvara', 'alvara', 1000000, current_date - 6, 'person');
insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on, competence_on, source)
values ('b1530000-0000-4000-8000-00000000000a', 'receive', 'Maria Teste de Oliveira', 'Reembolso: custas',
  (select id from public.finance_categories where org_id = 'b1530000-0000-4000-8000-00000000000a' and code = 'receita.reembolso'),
  'c1530000-0000-4000-8000-000000000001', 20000, current_date + 30, current_date, 'cost');

-- ---------- The release, received from the statement ----------

select pg_temp.statement('alvara', repeat('a', 64), jsonb_build_array(
  jsonb_build_object('bank_id', 'A1', 'posted_on', current_date - 4, 'cents', '1023450',
    'memo', 'TED ALVARA JUDICIAL TJGO PROC 10003012720998090100')));
select ok(
  (select received_cents = 1023450 and received_on = current_date - 4 and received_by_one and received_entry_id is not null
   from public.lawsuit_facts where id = 'a9530000-0000-4000-8000-000000000001')
    and (select entry_id is not null and status = 'pending' from public.money_releases
         where fact_id = 'a9530000-0000-4000-8000-000000000001')
    and (select case_id = 'c1530000-0000-4000-8000-000000000001' and kind = 'client_money' from public.finance_entries
         where statement_line_id is not null),
  'the court''s money in the statement, its memo carrying the lawsuit''s number, is the release received, by ONE'
);

-- ---------- Split: the fees and costs kept leave the client's money ----------

select pg_temp.as_backend('split', format($$public.record_money_split(%L, 'repasse-v1', %L::jsonb)$$,
  (select id from public.money_releases where fact_id = 'a9530000-0000-4000-8000-000000000001'),
  '[{"party_id": "e1530000-0000-4000-8000-000000000001", "person_id": "d1530000-0000-4000-8000-000000000001", "minor": false,
     "gross_cents": 1023450, "fees_cents": 307035, "costs_cents": 20000, "held": [], "payable_cents": 696415}]'));
select ok(
  (select kept_at is not null from public.money_releases where fact_id = 'a9530000-0000-4000-8000-000000000001')
    and (select sum(cents) = 0 from public.finance_entries
         where org_id = 'b1530000-0000-4000-8000-00000000000a' and statement_line_id is null and source = 'one')
    and (select sum(cents) from public.finance_entries
         where org_id = 'b1530000-0000-4000-8000-00000000000a' and statement_line_id is null and kind = 'client_money') = -327035,
  'once split, the fees and costs kept leave the client''s money and enter as revenue, moving nothing in the account'
);
select ok(
  (select status = 'paid' from public.finance_bills where fact_id = 'a9530000-0000-4000-8000-000000000001')
    and (select status = 'paid' from public.finance_bills where description = 'Reembolso: custas'),
  'the success fee and the costs Maria owed back are settled by what was kept'
);

-- ---------- The Pix of Maria's part ----------

select pg_temp.statement('repasse', repeat('b', 64), jsonb_build_array(
  jsonb_build_object('bank_id', 'P1', 'posted_on', current_date - 1, 'cents', '-696415',
    'memo', 'PIX ENVIADO MARIA TESTE DE OLIVEIRA ***982247**'),
  jsonb_build_object('bank_id', 'P2', 'posted_on', current_date - 1, 'cents', '-696415',
    'memo', 'PIX ENVIADO JOAO NINGUEM')));
select ok(
  (select status = 'paid' and paid_on = current_date - 1 and paid_by_one and paid_entry_id is not null
   from public.money_shares where person_id = 'd1530000-0000-4000-8000-000000000001')
    and (select state = 'pending' from public.finance_statement_lines where bank_id = 'P2'),
  'the Pix of the same value to Maria is her part passed on, by ONE; one to somebody else is left to a person'
);

select pg_temp.as_person('a1530000-0000-4000-8000-000000000004', 'undo',
  format($$public.undo_finance_line('b1530000-0000-4000-8000-00000000000a', %L)$$,
    (select id from public.finance_statement_lines where bank_id = 'P1')));
select ok(
  (select status = 'owed' and paid_on is null and not paid_by_one from public.money_shares
   where person_id = 'd1530000-0000-4000-8000-000000000001'),
  'undoing ONE''s line puts the part back to owed'
);

-- ---------- A release undone before its split ----------

insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source) values
  ('a9530000-0000-4000-8000-000000000002', 'b1530000-0000-4000-8000-00000000000a', 'c1530000-0000-4000-8000-000000000001',
   'f1530000-0000-4000-8000-000000000001', 'alvara', 'alvara', 500000, current_date - 3, 'person');
select pg_temp.statement('segundo', repeat('c', 64), jsonb_build_array(
  jsonb_build_object('bank_id', 'A2', 'posted_on', current_date - 1, 'cents', '512000', 'memo', 'TED DEPOSITO JUDICIAL')));
select ok(
  (select received_by_one and received_cents = 512000 from public.lawsuit_facts where id = 'a9530000-0000-4000-8000-000000000002'),
  'with no number in the memo, the only release waiting that the value fits is the one received'
);
select pg_temp.as_person('a1530000-0000-4000-8000-000000000004', 'undo-release',
  format($$public.undo_finance_line('b1530000-0000-4000-8000-00000000000a', %L)$$,
    (select id from public.finance_statement_lines where bank_id = 'A2')));
select ok(
  (select received_on is null and not received_by_one from public.lawsuit_facts where id = 'a9530000-0000-4000-8000-000000000002')
    and not exists (select 1 from public.money_releases where fact_id = 'a9530000-0000-4000-8000-000000000002')
    and not exists (select 1 from public.finance_bills where fact_id = 'a9530000-0000-4000-8000-000000000002' and status = 'open'),
  'a release ONE recorded and nobody split yet goes back to waiting when its line is undone'
);

-- ---------- The account is asked as soon as money is expected ----------

select pg_temp.as_backend('link', $$public.client_link_money('token-dos-livros')$$);
select is(pg_temp.got('link', '{expected}'), 'true', 'the client is asked for the account as soon as money is expected');

select pg_temp.sign_in('a1530000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::integer from public.money_shares), 0, 'another firm reads none of it');
reset role;

select * from finish();
rollback;
