begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- O ONE lança pela IA as linhas que as regras não decidem (0128). Lima
-- imports a statement: the rules decide nothing of its four lines, which owe
-- the AI's reading; the backend claims the statement, hands the chart and the
-- lines numbered, and records a run of the task: a sure bank fee is ONE's
-- entry, a sure answer whose category does not fit the way of the money and
-- an unsure one are suggestions, a line the model left out is asked no more.
-- Rocha keeps the lines to a person: even a sure answer is a suggestion
-- there. What ONE entered counts in its work, said only to who reads the
-- books. A claim that is no longer the worker's records nothing, and only
-- the backend reads and records.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1270000-0000-4000-8000-000000000001', 'ana@lima-ia.invalid', 'Ana Lima'),
  ('a1270000-0000-4000-8000-000000000002', 'caio@lima-ia.invalid', 'Caio Lima'),
  ('a1270000-0000-4000-8000-000000000005', 'edu@rocha-ia.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1270000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-ia', 'a1270000-0000-4000-8000-000000000001'),
  ('b1270000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-ia', 'a1270000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1270000-0000-4000-8000-00000000000a', 'a1270000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1270000-0000-4000-8000-00000000000a', 'a1270000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1270000-0000-4000-8000-00000000000b', 'a1270000-0000-4000-8000-000000000005', 'owner', 'socio');

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

-- A statement of four lines, in each firm, finished.
create function pg_temp.statement(person uuid, firm uuid, prefix text) returns void language plpgsql as $$
begin
  perform pg_temp.as_person(person, prefix || '-open', format($q$public.open_finance_books(%L, current_date - 60)$q$, firm));
  perform pg_temp.as_person(person, prefix || '-bank',
    format($q$public.save_finance_account(%L, null, '{"kind": "bank", "name": "Itaú PJ"}')$q$, firm));
  perform pg_temp.as_person(person, prefix || '-statement',
    format($q$public.begin_finance_statement(%L, %L, %L::jsonb)$q$, firm, pg_temp.got(prefix || '-bank', '{account_id}'),
      jsonb_build_object('file_name', prefix || '.ofx', 'sha256', repeat('a', 64))));
  perform pg_temp.as_person(person, prefix || '-lines',
    format($q$public.add_finance_statement_lines(%L, %L, %L::jsonb)$q$, firm, pg_temp.got(prefix || '-statement', '{statement_id}'),
      jsonb_build_array(
        jsonb_build_object('bank_id', prefix || '1', 'posted_on', current_date - 9, 'cents', '-3590', 'memo', 'TARIFA PACOTE SERVICOS'),
        jsonb_build_object('bank_id', prefix || '2', 'posted_on', current_date - 8, 'cents', '-12000', 'memo', 'PIX ENVIADO JOAO'),
        jsonb_build_object('bank_id', prefix || '3', 'posted_on', current_date - 7, 'cents', '50000', 'memo', 'PIX RECEBIDO'),
        jsonb_build_object('bank_id', prefix || '4', 'posted_on', current_date - 6, 'cents', '-8000', 'memo', 'COMPRA CARTAO'))));
  perform pg_temp.as_person(person, prefix || '-finish',
    format($q$public.finish_finance_statement(%L, %L)$q$, firm, pg_temp.got(prefix || '-statement', '{statement_id}')));
end;
$$;

select pg_temp.statement('a1270000-0000-4000-8000-000000000001', 'b1270000-0000-4000-8000-00000000000a', 'lima');
insert into public.firm_autonomy (org_id, decision, mode) values ('b1270000-0000-4000-8000-00000000000b', 'finance_lines', 'approval');
select pg_temp.statement('a1270000-0000-4000-8000-000000000005', 'b1270000-0000-4000-8000-00000000000b', 'rocha');

select ok(
  (select bool_and(ai_state = 'due') from public.finance_statements where file_name in ('lima.ofx', 'rocha.ofx'))
    and (select count(*) = 8 from public.finance_statement_lines where state = 'pending'
         and org_id in ('b1270000-0000-4000-8000-00000000000a', 'b1270000-0000-4000-8000-00000000000b')),
  'a statement whose lines no rule decided owes the AI''s reading'
);

-- ---------- Only the backend claims, reads and records ----------

select pg_temp.sign_in('a1270000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ select * from public.claim_finance_categorization(1) $$, '42501', null,
  'nobody of a firm claims the reading of a statement');
reset role;

-- The backend claims both statements and reads them.
create temp table held as select * from public.claim_finance_categorization(5);
grant select on held to authenticated;
create temp table handed as
select h.statement_id, public.finance_lines_to_categorize(h.statement_id, h.claim) as input from held h;
select ok(
  (select count(*) = 2 from held)
    and (select bool_and(jsonb_array_length(input -> 'lines') = 4 and jsonb_array_length(input -> 'categories') = 26)
         from handed)
    and (select (input -> 'lines' -> 0 ->> 'n') = '1' and (input -> 'lines' -> 0 ->> 'memo') = 'TARIFA PACOTE SERVICOS'
         from handed h join public.finance_statements s on s.id = h.statement_id where s.file_name = 'lima.ofx'),
  'the backend claims each statement under a number and hands its chart and its lines, each numbered'
);

-- ---------- The run of the AI, and what the database makes of it ----------

create function pg_temp.category_number(target_statement uuid, target_code text) returns integer language sql as $$
  select array_position(s.ai_categories,
    (select c.id from public.finance_categories c where c.org_id = s.org_id and c.code = target_code))
  from public.finance_statements s where s.id = target_statement;
$$;
create function pg_temp.run(statement uuid) returns uuid language plpgsql as $$
declare
  saved uuid;
begin
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
  select s.org_id, 'financeiro.extrato.categorizacao',
    (select v.id from public.prompt_versions v where v.task = 'financeiro.extrato.categorizacao' and v.is_active),
    'anthropic', 'claude-haiku-5-5', repeat('b', 64), 'succeeded',
    jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('n', 1, 'categoria', pg_temp.category_number(statement, 'despesa.financeiras'), 'quem', 'Itaú', 'certeza', 'alta'),
      -- A sure answer whose category does not fit: an income for money that went out.
      jsonb_build_object('n', 2, 'categoria', pg_temp.category_number(statement, 'receita.contratuais'), 'quem', 'João', 'certeza', 'alta'),
      jsonb_build_object('n', 3, 'categoria', pg_temp.category_number(statement, 'receita.contratuais'), 'quem', '', 'certeza', 'baixa'))),
    now()
  from public.finance_statements s where s.id = statement
  returning id into saved;
  return saved;
end;
$$;

select pg_temp.sign_in('a1270000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$ select public.record_finance_categorization(%L, 1, 'done', null) $$,
    (select statement_id from held h join public.finance_statements s on s.id = h.statement_id where s.file_name = 'lima.ofx')),
  '42501', null, 'nobody of a firm records what the AI said');
reset role;

create temp table lima as select h.* from held h join public.finance_statements s on s.id = h.statement_id where s.file_name = 'lima.ofx';
create temp table rocha as select h.* from held h join public.finance_statements s on s.id = h.statement_id where s.file_name = 'rocha.ofx';
select is(
  public.record_finance_categorization((select statement_id from lima), (select claim from lima) + 1, 'done',
    pg_temp.run((select statement_id from lima))) ->> 'code',
  'not_held', 'a claim that is no longer the worker''s records nothing');
insert into res values ('lima-record', public.record_finance_categorization((select statement_id from lima),
  (select claim from lima), 'done', pg_temp.run((select statement_id from lima))));

select ok(
  pg_temp.got('lima-record', '{entered}') = '1' and pg_temp.got('lima-record', '{suggested}') = '2'
    and (select l.state = 'entered' and l.decided_by_one and l.decided_rule = 'ai' and e.kind = 'expense' and e.by_one
              and e.counterparty = 'Itaú'
         from public.finance_statement_lines l join public.finance_entries e on e.id = l.entry_id
         where l.bank_id = 'lima1'),
  'a sure answer of a category that fits the way of the money is the line''s entry, as ONE''s'
);
select ok(
  (select state = 'pending' and ai_asked and ai_category_id is null and ai_counterparty = 'João'
   from public.finance_statement_lines where bank_id = 'lima2')
    and (select state = 'pending' and ai_asked and ai_category_id is not null and not ai_sure
         from public.finance_statement_lines where bank_id = 'lima3')
    and (select state = 'pending' and ai_asked and ai_category_id is null from public.finance_statement_lines where bank_id = 'lima4')
    and (select ai_state = 'done' from public.finance_statements where file_name = 'lima.ofx'),
  'a category that does not fit is no suggestion, an unsure one waits as a suggestion, a line left out is asked no more'
);

-- ---------- A firm that keeps the lines to a person ----------

insert into res values ('rocha-record', public.record_finance_categorization((select statement_id from rocha),
  (select claim from rocha), 'done', pg_temp.run((select statement_id from rocha))));
select ok(
  pg_temp.got('rocha-record', '{entered}') = '0'
    and (select state = 'pending' and ai_sure and ai_category_id is not null from public.finance_statement_lines where bank_id = 'rocha1'),
  'where the firm keeps the lines to a person, even a sure answer is a suggestion'
);

-- ---------- ONE's work, only to who reads the books ----------

select pg_temp.as_person('a1270000-0000-4000-8000-000000000001', 'ana-work',
  $$public.firm_one_work('b1270000-0000-4000-8000-00000000000a', current_date, current_date)$$);
select pg_temp.as_person('a1270000-0000-4000-8000-000000000002', 'caio-work',
  $$public.firm_one_work('b1270000-0000-4000-8000-00000000000a', current_date, current_date)$$);
select ok(
  (select exists (select 1 from jsonb_array_elements(value -> 'rows') r where r ->> 'kind' = 'linha_extrato' and (r ->> 'alone')::int = 1)
   from res where key = 'ana-work')
    and (select not exists (select 1 from jsonb_array_elements(value -> 'rows') r where r ->> 'kind' = 'linha_extrato')
                and not exists (select 1 from jsonb_array_elements(value -> 'kinds') k where k ->> 'family' = 'financeiro')
         from res where key = 'caio-work'),
  'what ONE entered in the books counts in its work, said only to who reads the books'
);

select ok(
  exists (select 1 from public.ai_tasks where slug = 'financeiro.extrato.categorizacao' and shadow)
    and exists (select 1 from public.autonomy_decisions where key = 'finance_lines' and task is null and default_mode = 'auto'),
  'the task''s runs are nobody''s of the firm to read, and no answer of the books waits in the firm''s queue'
);

select * from finish();
rollback;
