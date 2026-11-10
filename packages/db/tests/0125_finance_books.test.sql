begin;
create extension if not exists pgtap;
select plan(22);

-- ============================================================
-- Os livros do escritório (0126). Lima opens its books: Ana, a partner,
-- configures; Caio, a lawyer, reads only the costs of the cases (nothing of
-- the books); Bia is granted "view" and Duda "operate". A statement of the
-- bank account is imported: the court's release is a client's money, the
-- electricity bill joins the entry Duda wrote by hand, the transfer to the
-- cash account pairs with the cash statement, the fees wait for a person and
-- become a rule that decides the next one, a repeated line waits, and the
-- balance is compared with the bank's. Entries are cancelled, ONE's acts
-- undone and a statement removed whole, never deleted. A support visit and
-- the other firm read and write nothing.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1250000-0000-4000-8000-000000000001', 'ana@lima-livros.invalid', 'Ana Lima'),
  ('a1250000-0000-4000-8000-000000000002', 'caio@lima-livros.invalid', 'Caio Lima'),
  ('a1250000-0000-4000-8000-000000000003', 'bia@lima-livros.invalid', 'Bia Lima'),
  ('a1250000-0000-4000-8000-000000000004', 'duda@lima-livros.invalid', 'Duda Lima'),
  ('a1250000-0000-4000-8000-000000000005', 'edu@rocha-livros.invalid', 'Edu Rocha'),
  ('a1250000-0000-4000-8000-000000000009', 'suporte@one-livros.invalid', 'Suporte')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1250000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-livros', 'a1250000-0000-4000-8000-000000000001'),
  ('b1250000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-livros', 'a1250000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1250000-0000-4000-8000-00000000000b', 'a1250000-0000-4000-8000-000000000005', 'owner', 'socio');

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
/** As a person of Lima, a call whose answer is kept under a name. */
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

-- ---------- Who reads, before and after the books open ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'ana-level', $$to_jsonb(public.finance_level('b1250000-0000-4000-8000-00000000000a'))$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000002', 'caio-level', $$to_jsonb(public.finance_level('b1250000-0000-4000-8000-00000000000a'))$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000002', 'caio-home', $$coalesce(public.firm_finance_home('b1250000-0000-4000-8000-00000000000a'), 'null'::jsonb)$$);
select ok(
  pg_temp.got('ana-level', '{}') = 'configure' and pg_temp.got('caio-level', '{}') = 'costs'
    and (select value = 'null'::jsonb from res where key = 'caio-home'),
  'a partner configures the books; anybody else reads the costs of the cases, and nothing of the books'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'open-aal1',
  $$public.open_finance_books('b1250000-0000-4000-8000-00000000000a', current_date - 60)$$, 'aal1');
select pg_temp.as_person('a1250000-0000-4000-8000-000000000002', 'open-caio',
  $$public.open_finance_books('b1250000-0000-4000-8000-00000000000a', current_date - 60)$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'open-future',
  $$public.open_finance_books('b1250000-0000-4000-8000-00000000000a', current_date + 1)$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'open',
  $$public.open_finance_books('b1250000-0000-4000-8000-00000000000a', current_date - 60)$$);
select ok(
  pg_temp.got('open-aal1', '{code}') = 'second_factor' and pg_temp.got('open-caio', '{code}') = 'not_allowed'
    and pg_temp.got('open-future', '{field}') = 'first_day' and pg_temp.got('open', '{ok}') = 'true'
    and (select count(*) from public.finance_categories where org_id = 'b1250000-0000-4000-8000-00000000000a')
        = (select count(*) from public.finance_categories where org_id is null)
    and exists (select 1 from public.finance_cost_centers where org_id = 'b1250000-0000-4000-8000-00000000000a'),
  'a partner opens the books with the second factor and a first day not to come; the chart is copied and a cost centre made per module'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000002', 'grant-caio',
  $$public.set_finance_access('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000003', 'view')$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'grant-bia',
  $$public.set_finance_access('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000003', 'view')$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'grant-duda',
  $$public.set_finance_access('b1250000-0000-4000-8000-00000000000a', 'a1250000-0000-4000-8000-000000000004', 'operate')$$);
select ok(
  pg_temp.got('grant-caio', '{code}') = 'not_allowed' and pg_temp.got('grant-bia', '{ok}') = 'true'
    and pg_temp.got('grant-duda', '{ok}') = 'true'
    and exists (select 1 from public.audit_events where action = 'finance.access_set'),
  'only a partner grants who reads and who enters, on the record'
);

-- ---------- The accounts ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'account-duda',
  $$public.save_finance_account('b1250000-0000-4000-8000-00000000000a', null, '{"kind": "bank", "name": "Itaú PJ"}')$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'bank',
  $$public.save_finance_account('b1250000-0000-4000-8000-00000000000a', null,
    '{"kind": "bank", "name": "Itaú PJ", "institution": "Itaú", "number_tail": "3456", "opening_cents": "100000"}')$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'cash',
  $$public.save_finance_account('b1250000-0000-4000-8000-00000000000a', null, '{"kind": "cash", "name": "Caixa do escritório"}')$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'card-bad',
  $$public.save_finance_account('b1250000-0000-4000-8000-00000000000a', null, '{"kind": "card", "name": "Cartão"}')$$);
select ok(
  pg_temp.got('account-duda', '{code}') = 'not_allowed' and pg_temp.got('bank', '{ok}') = 'true'
    and pg_temp.got('cash', '{ok}') = 'true' and pg_temp.got('card-bad', '{field}') = 'days',
  'only who configures makes an account, each with its opening balance; a card says when its bill closes and is due'
);

-- ---------- An entry by hand ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'energy',
  format($$public.save_finance_entry('b1250000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-18990',
    'category_id', (select id from public.finance_categories where org_id = 'b1250000-0000-4000-8000-00000000000a' and code = 'despesa.utilidades'),
    'counterparty', 'Energia Teste', 'occurred_on', current_date - 12)));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000003', 'entry-bia',
  format($$public.save_finance_entry('b1250000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-100', 'occurred_on', current_date)));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'entry-wrong-way',
  format($$public.save_finance_entry('b1250000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'income', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-100',
    'category_id', (select id from public.finance_categories where org_id = 'b1250000-0000-4000-8000-00000000000a' and code = 'receita.outras'),
    'occurred_on', current_date)));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'entry-before',
  format($$public.save_finance_entry('b1250000-0000-4000-8000-00000000000a', %L::jsonb)$$, jsonb_build_object(
    'kind', 'expense', 'account_id', pg_temp.got('bank', '{account_id}'), 'cents', '-100',
    'category_id', (select id from public.finance_categories where org_id = 'b1250000-0000-4000-8000-00000000000a' and code = 'despesa.outras'),
    'occurred_on', current_date - 61)));
select ok(
  pg_temp.got('energy', '{ok}') = 'true' and pg_temp.got('entry-bia', '{code}') = 'not_allowed'
    and pg_temp.got('entry-wrong-way', '{field}') = 'cents' and pg_temp.got('entry-before', '{field}') = 'day',
  'who operates writes an entry with its category; who only views does not; an income going out and a day before the books are refused'
);

-- Who reads the entries.
select pg_temp.sign_in('a1250000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio-reads', to_jsonb((select count(*) from public.finance_entries)));
reset role;
select pg_temp.sign_in('a1250000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('bia-reads', to_jsonb((select count(*) from public.finance_entries)));
reset role;
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1250000-0000-4000-8000-000000000009', 'a1250000-0000-4000-8000-000000000001', 'b1250000-0000-4000-8000-00000000000a',
        'Conferindo os livros', 'f2250000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a1250000-0000-4000-8000-000000000001', 'aal2', 'f2250000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit-reads', to_jsonb((select count(*) from public.finance_entries)));
insert into res values ('visit-writes', public.save_finance_account('b1250000-0000-4000-8000-00000000000a', null, '{"kind": "cash", "name": "Outro caixa"}'));
reset role;
select ok(
  pg_temp.got('caio-reads', '{}') = '0' and pg_temp.got('bia-reads', '{}') = '1' and pg_temp.got('visit-reads', '{}') = '0'
    and pg_temp.got('visit-writes', '{code}') = 'support_visit',
  'the books are read by who reads them: neither who reads the costs of the cases nor a support visit, which writes nothing'
);

-- ---------- A statement of the bank, and one of the cash ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'statement',
  format($$public.begin_finance_statement('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'itau.ofx', 'sha256', repeat('a', 64),
      'starts_on', current_date - 30, 'ends_on', current_date - 1, 'balance_cents', '881010', 'balance_on', current_date - 1)));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'lines',
  format($$public.add_finance_statement_lines('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('statement', '{statement_id}'), jsonb_build_array(
      jsonb_build_object('bank_id', 'F1', 'posted_on', current_date - 20, 'cents', '250000', 'memo', 'TED ALVARA JUDICIAL TJGO'),
      jsonb_build_object('bank_id', 'F2', 'posted_on', current_date - 10, 'cents', '-18990', 'memo', 'PAG BOLETO ENERGIA'),
      jsonb_build_object('bank_id', 'F3', 'posted_on', current_date - 8, 'cents', '-50000', 'memo', 'TRANSF CAIXA'),
      jsonb_build_object('bank_id', 'F4', 'posted_on', current_date - 5, 'cents', '300000', 'memo', 'PIX RECEBIDO HONORARIOS MARIA'),
      jsonb_build_object('bank_id', 'F5', 'posted_on', current_date - 5, 'cents', '300000', 'memo', 'PIX RECEBIDO HONORARIOS MARIA'),
      jsonb_build_object('bank_id', 'F1', 'posted_on', current_date - 20, 'cents', '250000', 'memo', 'TED ALVARA JUDICIAL TJGO'),
      jsonb_build_object('bank_id', 'F0', 'posted_on', current_date - 90, 'cents', '100', 'memo', 'ANTES DOS LIVROS'))));
select ok(
  pg_temp.got('lines', '{added}') = '5' and pg_temp.got('lines', '{known}') = '2' and pg_temp.got('lines', '{repeated}') = '1'
    and (select repeat_of is not null from public.finance_statement_lines where bank_id = 'F5'),
  'a line the bank already gave is known, one before the books is left out, and another id with the same day, value and memo is kept as a possible repetition'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'finish',
  format($$public.finish_finance_statement('b1250000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('statement', '{statement_id}')));
select ok(
  (select kind = 'client_money' and cents = 250000 and by_one and source = 'one' from public.finance_entries
   where statement_line_id = (select id from public.finance_statement_lines where bank_id = 'F1'))
    and (select state = 'matched' and entry_id = (select id from public.finance_entries where counterparty = 'Energia Teste')
         from public.finance_statement_lines where bank_id = 'F2')
    and (select count(*) = 1 from public.finance_entries where cents = -18990 and cancelled_at is null),
  'ONE sets the court''s release apart as a client''s money, and joins the bill to the entry written by hand, never counting it twice'
);
select ok(
  (select count(*) from public.finance_statement_lines where state = 'pending') = 3
    and pg_temp.got('finish', '{balance_gap_cents}') = '-550000',
  'the transfer waits for its other leg, the fees and their repetition for a person, and the books say how far they are from the bank''s balance'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'cash-statement',
  format($$public.begin_finance_statement('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('cash', '{account_id}'), jsonb_build_object('file_name', 'caixa.ofx', 'sha256', repeat('b', 64))));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'cash-lines',
  format($$public.add_finance_statement_lines('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('cash-statement', '{statement_id}'), jsonb_build_array(
      jsonb_build_object('bank_id', 'C1', 'posted_on', current_date - 7, 'cents', '50000', 'memo', 'DEPOSITO'))));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'cash-finish',
  format($$public.finish_finance_statement('b1250000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('cash-statement', '{statement_id}')));
select ok(
  (select count(*) = 2 and count(distinct transfer_id) = 1 and sum(cents) = 0 and bool_and(kind = 'transfer' and by_one)
   from public.finance_entries where transfer_id is not null and cancelled_at is null),
  'a debit of the bank and a credit of the cash of the same value, a day apart, are one transfer, both legs at once'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'again',
  format($$public.begin_finance_statement('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'itau-de-novo.ofx', 'sha256', repeat('a', 64))));
select is(pg_temp.got('again', '{code}'), 'already_imported', 'the same file twice adds nothing');

-- ---------- A person decides, and a rule decides the next ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'decide',
  format($$public.decide_finance_line('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_statement_lines where bank_id = 'F4'), jsonb_build_object(
      'kind', 'income',
      'category_id', (select id from public.finance_categories where org_id = 'b1250000-0000-4000-8000-00000000000a' and code = 'receita.contratuais'),
      'counterparty', 'Maria Teste', 'rule_words', 'pix recebido honorarios')));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'decide-bad-rule',
  format($$public.decide_finance_line('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    (select id from public.finance_statement_lines where bank_id = 'F5'), jsonb_build_object(
      'kind', 'income',
      'category_id', (select id from public.finance_categories where org_id = 'b1250000-0000-4000-8000-00000000000a' and code = 'receita.contratuais'),
      'rule_words', 'aluguel')));
select ok(
  pg_temp.got('decide', '{ok}') = 'true'
    and (select state = 'entered' from public.finance_statement_lines where bank_id = 'F4')
    and (select state = 'pending' from public.finance_statement_lines where bank_id = 'F5')
    and pg_temp.got('decide-bad-rule', '{field}') = 'rule_words'
    and exists (select 1 from public.finance_rules where words = 'pix recebido honorarios' and direction = 'in'),
  'a person decides the fees and keeps the answer as a rule; a repetition still waits, and a rule needs words of the line'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'next-statement',
  format($$public.begin_finance_statement('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('bank', '{account_id}'), jsonb_build_object('file_name', 'itau-2.ofx', 'sha256', repeat('c', 64))));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'next-lines',
  format($$public.add_finance_statement_lines('b1250000-0000-4000-8000-00000000000a', %L, %L::jsonb)$$,
    pg_temp.got('next-statement', '{statement_id}'), jsonb_build_array(
      jsonb_build_object('bank_id', 'F6', 'posted_on', current_date - 2, 'cents', '120000', 'memo', 'Pix recebido - honorários João'))));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'next-finish',
  format($$public.finish_finance_statement('b1250000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('next-statement', '{statement_id}')));
select ok(
  (select e.kind = 'income' and e.by_one and l.decided_rule like 'rule:%'
   from public.finance_statement_lines l join public.finance_entries e on e.id = l.entry_id where l.bank_id = 'F6'),
  'the rule decides the next fees by itself, as ONE''s'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'ignore',
  format($$public.decide_finance_line('b1250000-0000-4000-8000-00000000000a', %L, '{"kind": "ignore", "ignore_reason": "O banco mandou duas vezes."}')$$,
    (select id from public.finance_statement_lines where bank_id = 'F5')));
select ok(
  pg_temp.got('ignore', '{ok}') = 'true'
    and (select state = 'ignored' from public.finance_statement_lines where bank_id = 'F5'),
  'a repetition the bank sent is set aside with the reason, never deleted'
);

-- ---------- Undo, cancel, remove ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'undo',
  format($$public.undo_finance_line('b1250000-0000-4000-8000-00000000000a', %L)$$,
    (select id from public.finance_statement_lines where bank_id = 'F1')));
select ok(
  (select state = 'pending' from public.finance_statement_lines where bank_id = 'F1')
    and exists (select 1 from public.finance_entries where kind = 'client_money' and cancelled_reason = 'Desfeito'),
  'what ONE decided is undone: its entry cancelled, the line back to a person'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'cancel',
  format($$public.cancel_finance_entry('b1250000-0000-4000-8000-00000000000a', %L, 'Lançado em duplicidade.')$$,
    (select id from public.finance_entries where counterparty = 'Energia Teste')));
select ok(
  (select cancelled_at is not null and statement_line_id is null from public.finance_entries where counterparty = 'Energia Teste')
    and (select state = 'pending' and entry_id is null from public.finance_statement_lines where bank_id = 'F2'),
  'an entry is cancelled with its reason, and the line it was joined to waits again'
);

select pg_temp.as_person('a1250000-0000-4000-8000-000000000004', 'remove',
  format($$public.remove_finance_statement('b1250000-0000-4000-8000-00000000000a', %L, 'Arquivo do mês errado.')$$,
    pg_temp.got('cash-statement', '{statement_id}')));
select ok(
  (select status = 'removed' from public.finance_statements where file_name = 'caixa.ofx')
    and not exists (select 1 from public.finance_statement_lines where bank_id = 'C1')
    and (select count(*) = 2 and bool_and(cancelled_at is not null) from public.finance_entries where transfer_id is not null)
    and (select state = 'pending' from public.finance_statement_lines where bank_id = 'F3'),
  'a statement imported by mistake leaves whole: its transfer cancelled in both accounts, the other leg back to a person'
);

-- ---------- What is used is archived, never deleted ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'delete-used',
  format($$public.archive_finance_record('b1250000-0000-4000-8000-00000000000a', 'account', %L, null, true)$$, pg_temp.got('bank', '{account_id}')));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'archive-used',
  format($$public.archive_finance_record('b1250000-0000-4000-8000-00000000000a', 'account', %L, 'Conta encerrada no banco.')$$, pg_temp.got('cash', '{account_id}')));
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'spare',
  $$public.save_finance_account('b1250000-0000-4000-8000-00000000000a', null, '{"kind": "receiving", "name": "Maquininha"}')$$);
select pg_temp.as_person('a1250000-0000-4000-8000-000000000001', 'delete-spare',
  format($$public.archive_finance_record('b1250000-0000-4000-8000-00000000000a', 'account', %L, null, true)$$, pg_temp.got('spare', '{account_id}')));
select ok(
  pg_temp.got('delete-used', '{code}') = 'in_use' and pg_temp.got('archive-used', '{ok}') = 'true'
    and (select archived_reason = 'Conta encerrada no banco.' from public.finance_accounts where name = 'Caixa do escritório')
    and pg_temp.got('delete-spare', '{ok}') = 'true' and not exists (select 1 from public.finance_accounts where name = 'Maquininha'),
  'what an entry uses is archived with its reason; only what nothing uses is deleted'
);

-- ---------- The home ----------

select pg_temp.as_person('a1250000-0000-4000-8000-000000000003', 'home', $$public.firm_finance_home('b1250000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('home', '{level}') = 'view'
    and (pg_temp.got('home', '{numbers,income,now}'))::bigint in (0, 120000, 300000, 420000)
    and (select jsonb_array_length(value -> 'accounts') = 2 from res where key = 'home')
    and pg_temp.got('home', '{pending_lines}') = '3',
  'who views reads the home of the books: the accounts, the month''s numbers and the lines that wait'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('a1250000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('rocha-reads', to_jsonb((select count(*) from public.finance_entries) + (select count(*) from public.finance_accounts)
  + (select count(*) from public.finance_statement_lines) + (select count(*) from public.finance_categories)));
select throws_ok(
  $$ select public.save_finance_entry('b1250000-0000-4000-8000-00000000000a', '{"kind": "expense"}') $$,
  '42501', 'not_authorized',
  'nobody of another firm writes in the books'
);
reset role;
select ok(
  pg_temp.got('rocha-reads', '{}') = '0',
  'and reads nothing of them: no entry, account, line or category'
);

select ok(
  exists (select 1 from public.platform_settings s where s.key = 'finance'
          and s.value -> 'client_money_words' ? 'alvara' and s.value -> 'client_money_words' ? 'levantamento'),
  'a client''s money is read by the setting''s words, the same list the code holds'
);

select * from finish();
rollback;
