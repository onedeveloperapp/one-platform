begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- Contas a pagar e a receber (0129). Lima's books are open: Ana, a partner,
-- configures; Duda operates; Bia views; Caio reads the costs of the cases.
-- Duda writes the rent as a series of three months, the power bill with its
-- typed line, a fee to receive from a client and one a client will not pay.
-- A statement arrives: ONE settles the power bill paid on its day, the rent
-- paid late (interest and fine written apart) and the fee received a little
-- less before its due day (a discount); a person registers a payment in part
-- and then the rest; undoing ONE's act opens the bill again; a renegotiation
-- splits what is owed into installments that add up; a receivable is written
-- off only by who configures. What waits is read by who reads the books, and
-- Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1280000-0000-4000-8000-000000000001', 'ana@lima-contas.invalid', 'Ana Lima'),
  ('a1280000-0000-4000-8000-000000000002', 'caio@lima-contas.invalid', 'Caio Lima'),
  ('a1280000-0000-4000-8000-000000000003', 'bia@lima-contas.invalid', 'Bia Lima'),
  ('a1280000-0000-4000-8000-000000000004', 'duda@lima-contas.invalid', 'Duda Lima'),
  ('a1280000-0000-4000-8000-000000000005', 'edu@rocha-contas.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1280000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-contas', 'a1280000-0000-4000-8000-000000000001'),
  ('b1280000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-contas', 'a1280000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1280000-0000-4000-8000-00000000000a', 'a1280000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1280000-0000-4000-8000-00000000000a', 'a1280000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1280000-0000-4000-8000-00000000000a', 'a1280000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1280000-0000-4000-8000-00000000000a', 'a1280000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1280000-0000-4000-8000-00000000000b', 'a1280000-0000-4000-8000-000000000005', 'owner', 'socio');

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
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;
create function pg_temp.category(target_code text) returns text language sql as $$
  select id::text from public.finance_categories where org_id = 'b1280000-0000-4000-8000-00000000000a' and code = target_code;
$$;
create function pg_temp.bill(target_who text) returns uuid language sql as $$
  select id from public.finance_bills where org_id = 'b1280000-0000-4000-8000-00000000000a' and counterparty = target_who
  order by due_on limit 1;
$$;

select pg_temp.as_person('a1280000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1280000-0000-4000-8000-00000000000a', current_date - 120)$$);
select pg_temp.as_person('a1280000-0000-4000-8000-000000000001', 'grant-bia',
  $$public.set_finance_access('b1280000-0000-4000-8000-00000000000a', 'a1280000-0000-4000-8000-000000000003', 'view')$$);
select pg_temp.as_person('a1280000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1280000-0000-4000-8000-00000000000a', 'a1280000-0000-4000-8000-000000000004', 'operate')$$);
select pg_temp.as_person('a1280000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1280000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);

-- ---------- Writing the bills ----------

select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'rent',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'counterparty', 'Imobiliária Teste', 'category_id', pg_temp.category('despesa.aluguel'),
    'cents', '250000', 'due_on', current_date - 40, 'repeat', '3')));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'power',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'counterparty', 'Energia Teste', 'category_id', pg_temp.category('despesa.utilidades'),
    'cents', '18990', 'due_on', current_date - 20, 'typed_line', repeat('8', 48))));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'fee',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'receive', 'counterparty', 'Maria Teste', 'category_id', pg_temp.category('receita.contratuais'),
    'cents', '100000', 'due_on', current_date - 5)));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'bad-debt',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'receive', 'counterparty', 'Rui Teste', 'category_id', pg_temp.category('receita.contratuais'),
    'cents', '50000', 'due_on', current_date - 90)));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000003', 'bia-bill',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'category_id', pg_temp.category('despesa.outras'), 'cents', '100', 'due_on', current_date)));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'wrong-way',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'category_id', pg_temp.category('receita.contratuais'), 'cents', '100', 'due_on', current_date)));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'bad-line',
  format($$public.save_finance_bill('b1280000-0000-4000-8000-00000000000a', null, %L::jsonb)$$, jsonb_build_object(
    'direction', 'pay', 'category_id', pg_temp.category('despesa.outras'), 'cents', '100', 'due_on', current_date,
    'typed_line', '123')));
select ok(
  pg_temp.got('rent', '{months}') = '3'
    and (select count(*) = 3 and count(distinct series_id) = 1 and max(due_on) - min(due_on) between 59 and 62
         from public.finance_bills where counterparty = 'Imobiliária Teste')
    and pg_temp.got('power', '{ok}') = 'true' and pg_temp.got('fee', '{ok}') = 'true'
    and pg_temp.got('bia-bill', '{code}') = 'not_allowed' and pg_temp.got('wrong-way', '{field}') = 'category'
    and pg_temp.got('bad-line', '{field}') = 'typed_line',
  'who operates writes a bill, a series of the months asked; who views does not; a category of the other way and a line that is none are refused'
);

-- ---------- The statement settles them ----------

select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'statement',
  format($$public.begin_finance_statement('b1280000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'itau.ofx', 'sha256', repeat('a', 64))));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'lines',
  format($$public.add_finance_statement_lines('b1280000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('statement', '{statement_id}'), jsonb_build_array(
      jsonb_build_object('bank_id', 'B1', 'posted_on', current_date - 20, 'cents', '-18990', 'memo', 'PAG CONTA DE LUZ'),
      jsonb_build_object('bank_id', 'B2', 'posted_on', current_date - 35, 'cents', '-275000', 'memo', 'PAG ALUGUEL ATRASADO'),
      jsonb_build_object('bank_id', 'B3', 'posted_on', current_date - 6, 'cents', '95000', 'memo', 'PIX RECEBIDO'))));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'finish',
  format($$public.finish_finance_statement('b1280000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('statement', '{statement_id}')));
select ok(
  (select status = 'paid' and paid_on = current_date - 20 from public.finance_bills where counterparty = 'Energia Teste')
    and (select l.decided_rule = 'bill' and e.by_one and e.kind = 'expense' and e.counterparty = 'Energia Teste'
         from public.finance_statement_lines l join public.finance_entries e on e.id = l.entry_id where l.bank_id = 'B1'),
  'a line that pays an open bill of the same value settles it, as ONE''s, and its entry is the bill''s'
);
select ok(
  (select b.status = 'paid' and p.base_cents = 250000 and p.extra_cents = 25000 and p.by_one
   from public.finance_bills b join public.finance_bill_payments p on p.bill_id = b.id
   where b.id = pg_temp.bill('Imobiliária Teste'))
    and (select count(*) = 2 from public.finance_bills where counterparty = 'Imobiliária Teste' and status = 'open'),
  'paid late with more, the rest is interest and fine; the months still to come stay open'
);
select ok(
  (select b.status = 'paid' and p.discount_cents = 5000 and e.kind = 'income'
   from public.finance_bills b join public.finance_bill_payments p on p.bill_id = b.id
   join public.finance_entries e on e.id = p.entry_id
   where b.counterparty = 'Maria Teste'),
  'received a little less before its due day, the rest is a discount and the receivable is paid'
);

-- ---------- A person's payment, in part, and undoing ONE ----------

select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'part',
  format($$public.settle_finance_bill('b1280000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_bills where counterparty = 'Imobiliária Teste' and status = 'open' order by due_on limit 1),
    jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'), 'paid_on', current_date - 3, 'cents', '100000')));
select ok(
  pg_temp.got('part', '{status}') = 'open'
    and (select paid_cents = 100000 from public.finance_bills where counterparty = 'Imobiliária Teste' and status = 'open'
         order by due_on limit 1),
  'a payment in part leaves the bill open by the rest'
);
select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'rest',
  format($$public.settle_finance_bill('b1280000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_bills where counterparty = 'Imobiliária Teste' and status = 'open' order by due_on limit 1),
    jsonb_build_object('account_id', pg_temp.got('bank', '{account_id}'), 'paid_on', current_date - 2, 'cents', '150000')));
select is(pg_temp.got('rest', '{status}'), 'paid', 'and the rest pays it');

select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'undo',
  format($$public.undo_finance_line('b1280000-0000-4000-8000-00000000000a', %L)$$,
    (select id from public.finance_statement_lines where bank_id = 'B1')));
select ok(
  (select status = 'open' and paid_cents = 0 and paid_on is null from public.finance_bills where counterparty = 'Energia Teste')
    and (select undone_at is not null from public.finance_bill_payments p
         join public.finance_bills b on b.id = p.bill_id where b.counterparty = 'Energia Teste'),
  'undoing what ONE did opens the bill again, its payment undone and never deleted'
);

-- ---------- Renegotiating, closing ----------

select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'renegotiate',
  format($$public.renegotiate_finance_bill('b1280000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_bills where counterparty = 'Imobiliária Teste' and status = 'open' order by due_on limit 1),
    jsonb_build_object('installments', '3', 'first_due_on', current_date + 10, 'reason', 'Acordo com a imobiliária.')));
select ok(
  pg_temp.got('renegotiate', '{ok}') = 'true'
    and (select count(*) = 3 and sum(cents) = 250000 from public.finance_bills where source = 'renegotiation')
    and exists (select 1 from public.finance_bills where status = 'renegotiated' and closed_reason = 'Acordo com a imobiliária.'),
  'a renegotiation splits what is owed into installments that add up, the old bill closed with its reason'
);

select pg_temp.as_person('a1280000-0000-4000-8000-000000000004', 'off-duda',
  format($$public.close_finance_bill('b1280000-0000-4000-8000-00000000000a', %L, 'written_off', 'O cliente não vai pagar.')$$,
    pg_temp.bill('Rui Teste')));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000001', 'off-pay',
  format($$public.close_finance_bill('b1280000-0000-4000-8000-00000000000a', %L, 'written_off', 'Não se paga.')$$,
    pg_temp.bill('Energia Teste')));
select pg_temp.as_person('a1280000-0000-4000-8000-000000000001', 'off',
  format($$public.close_finance_bill('b1280000-0000-4000-8000-00000000000a', %L, 'written_off', 'O cliente não vai pagar.')$$,
    pg_temp.bill('Rui Teste')));
select ok(
  pg_temp.got('off-duda', '{code}') = 'not_allowed' and pg_temp.got('off-pay', '{field}') = 'how'
    and pg_temp.got('off', '{ok}') = 'true'
    and (select status = 'written_off' from public.finance_bills where counterparty = 'Rui Teste'),
  'a receivable a client will not pay is written off by who configures, with the reason; a bill to pay never is'
);

-- ---------- What waits ----------

select pg_temp.as_person('a1280000-0000-4000-8000-000000000003', 'bia-waits',
  $$public.firm_finance_attention('b1280000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1280000-0000-4000-8000-000000000002', 'caio-waits',
  $$coalesce(public.firm_finance_attention('b1280000-0000-4000-8000-00000000000a'), 'null'::jsonb)$$);
select ok(
  pg_temp.got('bia-waits', '{bills,pay_late}') = '1' and pg_temp.got('bia-waits', '{bills,pay_late_cents}') = '18990'
    and pg_temp.got('bia-waits', '{bills,receive_late}') = '0'
    and (select value = 'null'::jsonb from res where key = 'caio-waits'),
  'the bills late and due soon are read by who reads the books, and by nobody else'
);

select pg_temp.sign_in('a1280000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('rocha-reads', to_jsonb((select count(*) from public.finance_bills) + (select count(*) from public.finance_bill_payments)));
reset role;
select is(pg_temp.got('rocha-reads', '{}'), '0', 'another firm reads nothing of the bills');

select * from finish();
rollback;
