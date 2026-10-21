begin;
create extension if not exists pgtap;
select plan(29);

-- ============================================================
-- A firm's portfolio brought from a spreadsheet (0032). A batch is staged
-- by who may, its lines checked again here, committed a few a call with the
-- second factor (a lawsuit the firm has is never opened twice, a client is
-- matched by the CPF only under a name that is theirs, a line that cannot be
-- written leaves nothing and holds no other back), and undone (what somebody
-- worked on stays, whatever recorded it; a client an import wrote goes with
-- the last case of theirs; a batch that stopped half way is undone as far as
-- it went). What a spreadsheet said of people does not outlive its batch,
-- and every step is on record. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of a year
-- to come, and the CPFs are the ones every manual uses as an example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@carteira.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a0200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@carteira.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a0200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@carteira.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a0200000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@carteira.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b0200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-carteira', 'a0200000-0000-4000-8000-000000000001'),
  ('b0200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-carteira', 'a0200000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b0200000-0000-4000-8000-00000000000a', 'a0200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b0200000-0000-4000-8000-00000000000a', 'a0200000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b0200000-0000-4000-8000-00000000000b', 'a0200000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.line(batch text, number integer) returns public.import_rows language sql as
$$ select * from public.import_rows where batch_id = pg_temp.got(batch, 'batch_id')::uuid and row_number = number; $$;

-- Firm A already has a lawsuit (which the spreadsheet repeats) and a client by her CPF (whom it names again).
-- Firm B has a lawsuit of its own.
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('had', public.create_case('b0200000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-05-10',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('had_lawsuit', public.save_proceeding(pg_temp.got('had', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000202-39.2099.8.09.0051", "filed_at": "2026-06-01"}'::jsonb,
  array[pg_temp.got('had', 'party_id')::uuid]));
reset role;
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('had_b', public.create_case('b0200000-0000-4000-8000-00000000000b', 'delay', 'AD', null,
  '{"full_name": "Rui Teste"}'::jsonb));
insert into res values ('had_b_lawsuit', public.save_proceeding(pg_temp.got('had_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "status": "filed", "cnj": "5000303-76.2099.8.09.0051"}'::jsonb,
  array[pg_temp.got('had_b', 'party_id')::uuid]));
reset role;

-- ---------- Who brings a portfolio ----------

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'processos.xlsx', 'Astrea',
  '{"lines": 9, "exists": 1, "duplicate": "x", "bogus": 4}'::jsonb));
reset role;
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'outra.xlsx', null)$$,
  '42501', 'not_authorized', 'who answers the clients brings no portfolio'
);
reset role;
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format($$select public.add_import_rows(%L, '[]'::jsonb)$$, pg_temp.got('batch', 'batch_id')),
  'P0002', 'batch_not_found', 'nobody adds a line to a batch of another firm'
);
reset role;

-- ---------- What the firm has ----------

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('known', jsonb_build_object('known', to_jsonb(public.known_lawsuits('b0200000-0000-4000-8000-00000000000a',
  array['50002023920998090051', '50003037620998090051', '50001236020998090051']))));
reset role;
select is(
  pg_temp.got('known', 'known')::jsonb, '["50002023920998090051"]'::jsonb,
  'a firm learns which of a list of lawsuits it already has, and nothing of another firm''s'
);
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.known_lawsuits('b0200000-0000-4000-8000-00000000000a', array['50002023920998090051'])$$,
  '42501', 'not_authorized', 'nobody asks which lawsuits another firm has'
);
reset role;
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.known_lawsuits('b0200000-0000-4000-8000-00000000000a', array(select '50002023920998090051' from generate_series(1, 1001)))$$,
  '22023', 'too_many_numbers', 'a list of lawsuits is asked a thousand at a time'
);
reset role;

-- ---------- The lines ----------

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bad', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50001236020998090051", "client_name": "Maria Teste", "kind": "juizado", "court": "TJGO"},
    {"row": 3, "cnj": "50001230020998090051", "client_name": "Número Errado", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('wrong_court', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 4, "cnj": "10002348820998260100", "client_name": "João Teste", "kind": "comum", "court": "TJGO"}]'::jsonb));
insert into res values ('bad_day', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 6, "cnj": "50003219720998090051", "client_name": "Dia Errado", "kind": "juizado", "court": "TJGO", "filed_on": "2026-02-31"}]'::jsonb));
insert into res values ('old_day', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 7, "cnj": "50021216320998090051", "client_name": "Dia Antigo", "kind": "juizado", "court": "TJGO", "filed_on": "1985-05-01"}]'::jsonb));
insert into res values ('limits', public.import_limits());
insert into res values ('added', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50001236020998090051", "client_name": "  MARIA   TESTE DA SILVA ", "cpf": "12345678909", "airline": "G3", "kind": "juizado",
     "court": "TJGO", "unit": "3º Juizado Especial Cível", "comarca": "Goiânia", "filed_on": "2026-08-03", "closed": false,
     "summary": "Importado de Astrea · Pasta: A-12"},
    {"row": 3, "cnj": "10002348820998260100", "client_name": "João Teste", "airline": "AD", "kind": "comum", "court": "TJSP", "closed": true},
    {"row": 4, "cnj": "50002023920998090051", "client_name": "Maria Teste", "kind": "juizado", "court": "TJGO"},
    {"row": 5, "cnj": "50004561220998090051", "client_name": "Pedro Teste", "airline": "2Z", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('repeated', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 9, "cnj": "50001236020998090051", "client_name": "Maria Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
reset role;
select ok(
  pg_temp.got('bad', 'code') = 'invalid_row' and pg_temp.got('bad', 'row') = '3' and pg_temp.got('bad', 'field') = 'cnj'
  and pg_temp.got('wrong_court', 'code') = 'invalid_row' and pg_temp.got('wrong_court', 'field') = 'court'
  and pg_temp.got('bad_day', 'row') = '6' and pg_temp.got('bad_day', 'field') = 'filed_on'
  and pg_temp.got('old_day', 'row') = '7' and pg_temp.got('old_day', 'field') = 'filed_on'
  and (select payload = '{"max_rows": 20000, "rows_per_call": 200, "oldest_filed_on": "1990-01-01"}'::jsonb from res where name = 'limits')
  and pg_temp.got('added', 'rows') = '4' and pg_temp.got('repeated', 'code') = 'repeated_line'
  and (select rows_count = 4 and status = 'staged' from public.import_batches where id = pg_temp.got('batch', 'batch_id')::uuid)
  and (select fields ->> 'client_name' = 'MARIA TESTE DA SILVA' and outcome is null from pg_temp.line('batch', 2)),
  'the lines are checked again as they join a batch: one that is not right refuses its call and says which and what of it, and a lawsuit comes once'
);
select ok(
  (select file_counts = '{"lines": 9, "exists": 1}'::jsonb from public.import_batches where id = pg_temp.got('batch', 'batch_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'import.started' and entity_id = pg_temp.got('batch', 'batch_id'))
  and (select count(*) = 1 and bool_and(metadata ->> 'added' = '4')
       from public.audit_events where action = 'import.lines_added' and entity_id = pg_temp.got('batch', 'batch_id')),
  'a batch keeps what the screen counted of its file, only as whole numbers, and starting it and adding to it are on record'
);

-- ---------- Committing ----------

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  format('select public.commit_import_batch(%L)', pg_temp.got('batch', 'batch_id')),
  '42501', 'second_factor_required', 'a portfolio is committed with the second factor'
);
reset role;

-- An airline ONE no longer flies with, between the staging and the commit: its line cannot be written.
update public.airlines set active = false where iata = '2Z';
update public.platform_settings set value = value || '{"rows_per_call": 2}'::jsonb where key = 'import';
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('first', public.commit_import_batch(pg_temp.got('batch', 'batch_id')::uuid));
insert into res values ('second', public.commit_import_batch(pg_temp.got('batch', 'batch_id')::uuid));
insert into res values ('again', public.commit_import_batch(pg_temp.got('batch', 'batch_id')::uuid));
reset role;
update public.airlines set active = true where iata = '2Z';

select ok(
  pg_temp.got('first', 'code') = 'in_progress' and (select payload -> 'counts' ->> 'pending' = '2' from res where name = 'first')
  and pg_temp.got('second', 'code') = 'committed' and pg_temp.got('again', 'code') = 'already_committed'
  and (select payload -> 'counts' = '{"rows": 4, "pending": 0, "created": 2, "exists": 1, "refused": 1, "reverted": 0, "kept": 0}'::jsonb
       from res where name = 'second')
  and (select status = 'committed' and committed_at is not null from public.import_batches where id = pg_temp.got('batch', 'batch_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'import.committed' and entity_id = pg_temp.got('batch', 'batch_id')),
  'a batch is committed a few lines a call, each decided once, and that is on record'
);

select ok(
  (select c.status = 'filed' and c.incident = 'other' and c.airline_iata = 'G3' and c.summary = 'Importado de Astrea · Pasta: A-12'
   from public.cases c where c.id = (select case_id from pg_temp.line('batch', 2)))
  and (select p.status = 'filed' and p.cnj = '50001236020998090051' and p.court = 'TJGO' and p.kind = 'juizado'
              and p.unit = '3º Juizado Especial Cível' and p.filed_at = date '2026-08-03'
       from public.proceedings p where p.id = (select proceeding_id from pg_temp.line('batch', 2)))
  and (select c.status = 'closed' and c.closed_at is not null from public.cases c where c.id = (select case_id from pg_temp.line('batch', 3)))
  and (select p.status = 'closed' and p.court = 'TJSP' from public.proceedings p where p.id = (select proceeding_id from pg_temp.line('batch', 3)))
  and (select count(*) = 2 from public.case_events where kind = 'imported' and org_id = 'b0200000-0000-4000-8000-00000000000a'),
  'a line opens a case with its lawsuit as the court has it, in court or ended, and says in its timeline where it came from'
);

select ok(
  -- The client the firm had by her CPF is the same person, under the name the firm gave her; the other is new.
  (select person_id = pg_temp.got('had', 'person_id')::uuid and not person_created and code is null from pg_temp.line('batch', 2))
  and (select person_created and person_id is not null from pg_temp.line('batch', 3))
  and (select count(*) = 1 and bool_and(full_name = 'Maria Teste') from public.people
       where org_id = 'b0200000-0000-4000-8000-00000000000a' and cpf = '12345678909')
  -- The lawsuit the firm already had was left as it was.
  and (select outcome = 'exists' and proceeding_id = pg_temp.got('had_lawsuit', 'proceeding_id')::uuid from pg_temp.line('batch', 4))
  and (select count(*) = 1 from public.proceedings where org_id = 'b0200000-0000-4000-8000-00000000000a' and cnj = '50002023920998090051')
  -- The line that could not be written left nothing behind, and says why.
  and (select outcome = 'refused' and code = 'unknown_airline' and case_id is null from pg_temp.line('batch', 5))
  and (select count(*) = 0 from public.people where org_id = 'b0200000-0000-4000-8000-00000000000a' and full_name = 'Pedro Teste')
  and (select count(*) = 3 from public.cases where org_id = 'b0200000-0000-4000-8000-00000000000a'),
  'a lawsuit is matched by its number and a client by the CPF, under the name the firm gave her; a line that cannot be written leaves nothing'
);

select ok(
  (select bool_and(fields = '{}'::jsonb) and count(*) = 4 from public.import_rows where batch_id = pg_temp.got('batch', 'batch_id')::uuid)
  and (select cnj = '50004561220998090051' and code = 'unknown_airline' from pg_temp.line('batch', 5))
  -- Its lawsuits are followed in court like any other.
  and (select count(*) = 1 from public.proceeding_tracking where proceeding_id = (select proceeding_id from pg_temp.line('batch', 2)) and status = 'waiting')
  -- One that ended is not.
  and (select count(*) = 0 from public.proceeding_tracking where proceeding_id = (select proceeding_id from pg_temp.line('batch', 3))),
  'a batch that ended keeps each lawsuit''s number and what became of it, nothing the spreadsheet said; a lawsuit it brought is followed in court, unless it ended'
);

-- ---------- Undoing ----------

-- (The test runs in one transaction, at one moment: the commit is set an hour back, and what it wrote two.)
update public.import_rows set decided_at = decided_at - interval '1 hour' where batch_id = pg_temp.got('batch', 'batch_id')::uuid;
update public.case_events set at = at - interval '2 hours'
where case_id in (select case_id from public.import_rows where batch_id = pg_temp.got('batch', 'batch_id')::uuid and outcome = 'created');
-- Somebody works on João's case; the backend reads Maria's lawsuit in court by itself.
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('worked', public.set_case_status((select case_id from pg_temp.line('batch', 3)), 'filed'));
reset role;
insert into public.case_events (org_id, case_id, kind, actor_type)
select org_id, case_id, 'court_moved', 'system' from pg_temp.line('batch', 2);

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  format('select public.revert_import_batch(%L)', pg_temp.got('batch', 'batch_id')),
  '42501', 'second_factor_required', 'a portfolio is undone with the second factor'
);
reset role;
insert into res select 'before_undo', jsonb_build_object('case_2', case_id) from pg_temp.line('batch', 2);
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('undone', public.revert_import_batch(pg_temp.got('batch', 'batch_id')::uuid));
reset role;
select ok(
  pg_temp.got('undone', 'code') = 'reverted'
  and (select payload -> 'counts' ->> 'reverted' = '1' and payload -> 'counts' ->> 'kept' = '1' from res where name = 'undone')
  and (select outcome = 'reverted' and case_id is null from pg_temp.line('batch', 2))
  and (select count(*) = 0 from public.cases where id = pg_temp.got('before_undo', 'case_2')::uuid)
  and (select count(*) = 0 from public.proceedings where org_id = 'b0200000-0000-4000-8000-00000000000a' and cnj = '50001236020998090051')
  -- The client the firm had before the batch stays, with the case she had.
  and (select count(*) = 1 from public.people where id = pg_temp.got('had', 'person_id')::uuid)
  and (select count(*) = 1 from public.cases where id = pg_temp.got('had', 'case_id')::uuid)
  -- The case somebody worked on stays, with its client.
  and (select outcome = 'kept' and case_id is not null from pg_temp.line('batch', 3))
  and (select count(*) = 1 from public.people where id = (select person_id from pg_temp.line('batch', 3)))
  and (select status = 'reverted' from public.import_batches where id = pg_temp.got('batch', 'batch_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'import.reverted' and entity_id = pg_temp.got('batch', 'batch_id')),
  'undoing a batch removes the cases it opened that nobody touched, keeps the ones somebody worked on, and is on record'
);

-- ---------- A client with two lawsuits, a CPF of another name, and what counts as touched ----------

--   2, 3  Rita, a new client, with two lawsuits;
--   4     Pedro Silva, under the CPF the firm has for Maria: his lawsuit is never hers;
--   5     Bruno: somebody marks the news of his lawsuit as seen (only the audit trail records it);
--   6     Lia: her CPF is looked up at the registry;
--   7     Caio: another spreadsheet finds his lawsuit in the firm, and inherits it.
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch2', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'mais.csv', null));
-- (Two lines a call, as the setting now says.)
insert into res values ('added2', public.add_import_rows(pg_temp.got('batch2', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50007896120998090051", "client_name": "Rita Teste", "cpf": "52998224725", "kind": "juizado", "court": "TJGO"},
    {"row": 3, "cnj": "50016669820998090051", "client_name": "Rita Teste", "cpf": "52998224725", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('added2b', public.add_import_rows(pg_temp.got('batch2', 'batch_id')::uuid,
  '[{"row": 4, "cnj": "50017778220998090051", "client_name": "Pedro Silva", "cpf": "12345678909", "kind": "juizado", "court": "TJGO"},
    {"row": 5, "cnj": "50018886620998090051", "client_name": "Bruno Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('added2c', public.add_import_rows(pg_temp.got('batch2', 'batch_id')::uuid,
  '[{"row": 6, "cnj": "50019995020998090051", "client_name": "Lia Teste", "cpf": "11144477735", "kind": "juizado", "court": "TJGO"},
    {"row": 7, "cnj": "50020202620998090051", "client_name": "Caio Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('c2a', public.commit_import_batch(pg_temp.got('batch2', 'batch_id')::uuid));
insert into res values ('c2b', public.commit_import_batch(pg_temp.got('batch2', 'batch_id')::uuid));
insert into res values ('committed2', public.commit_import_batch(pg_temp.got('batch2', 'batch_id')::uuid));
reset role;
select ok(
  pg_temp.got('c2a', 'code') = 'in_progress' and pg_temp.got('committed2', 'code') = 'committed'
  and (select payload -> 'counts' ->> 'created' = '6' from res where name = 'committed2')
  -- Rita is one client, with her two cases; the first line wrote her.
  and (select person_created from pg_temp.line('batch2', 2)) and not (select person_created from pg_temp.line('batch2', 3))
  and (select person_id from pg_temp.line('batch2', 2)) = (select person_id from pg_temp.line('batch2', 3))
  -- Pedro Silva is a client of his own, with no CPF; Maria keeps her CPF, her name and her one case.
  and (select code = 'cpf_other_name' and person_created from pg_temp.line('batch2', 4))
  and (select full_name = 'Pedro Silva' and cpf is null from public.people where id = (select person_id from pg_temp.line('batch2', 4)))
  and (select count(*) = 1 and bool_and(full_name = 'Maria Teste') from public.people
       where org_id = 'b0200000-0000-4000-8000-00000000000a' and cpf = '12345678909')
  and (select count(*) = 1 from public.case_parties where person_id = pg_temp.got('had', 'person_id')::uuid),
  'a client with two lawsuits is one person; a CPF the firm has for somebody of another name never takes a lawsuit to them'
);

update public.import_rows set decided_at = decided_at - interval '1 hour' where batch_id = pg_temp.got('batch2', 'batch_id')::uuid;
update public.case_events set at = at - interval '2 hours'
where case_id in (select case_id from public.import_rows where batch_id = pg_temp.got('batch2', 'batch_id')::uuid);
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('seen', public.acknowledge_proceeding_movements((select proceeding_id from pg_temp.line('batch2', 5))));
reset role;
update public.people set cpf_checked_at = now(), cpf_registry_result = 'found'
where id = (select person_id from pg_temp.line('batch2', 6));
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch2b', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'outra.csv', null));
insert into res values ('added_other', public.add_import_rows(pg_temp.got('batch2b', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50020202620998090051", "client_name": "Caio Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('committed2b', public.commit_import_batch(pg_temp.got('batch2b', 'batch_id')::uuid));
insert into res select 'kept2', jsonb_build_object('rita', (select person_id from pg_temp.line('batch2', 2)),
  'pedro', (select person_id from pg_temp.line('batch2', 4)), 'bruno', (select case_id from pg_temp.line('batch2', 5)),
  'lia', (select case_id from pg_temp.line('batch2', 6)), 'caio', (select case_id from pg_temp.line('batch2', 7)));
insert into res select 'caio_before', jsonb_build_object('outcome', outcome, 'case', case_id) from pg_temp.line('batch2b', 2);
insert into res values ('undone2', public.revert_import_batch(pg_temp.got('batch2', 'batch_id')::uuid));
insert into res values ('undone_again', public.revert_import_batch(pg_temp.got('batch2', 'batch_id')::uuid));
insert into res values ('undone_again2', public.revert_import_batch(pg_temp.got('batch2', 'batch_id')::uuid));
reset role;
select ok(
  pg_temp.got('seen', 'code') = 'seen' and pg_temp.got('committed2b', 'code') = 'committed'
  and pg_temp.got('caio_before', 'outcome') = 'exists' and pg_temp.got('caio_before', 'case') = pg_temp.got('kept2', 'caio')
  and pg_temp.got('undone_again2', 'code') = 'reverted'
  and (select payload -> 'counts' ->> 'reverted' = '3' and payload -> 'counts' ->> 'kept' = '3' from res where name = 'undone_again2')
  -- Rita goes with her last case, and Pedro Silva with his.
  and (select count(*) = 0 from public.people where id = pg_temp.got('kept2', 'rita')::uuid)
  and (select count(*) = 0 from public.people where id = pg_temp.got('kept2', 'pedro')::uuid)
  and (select count(*) = 1 from public.people where id = pg_temp.got('had', 'person_id')::uuid)
  -- What the audit trail alone recorded and a CPF looked up keep their case.
  and (select outcome = 'kept' and code is null from pg_temp.line('batch2', 5))
  and (select outcome = 'kept' and code is null from pg_temp.line('batch2', 6))
  -- The lawsuit another spreadsheet found passes to it: its line is the one that opened the case now.
  and (select outcome = 'kept' and code = 'handed_over' from pg_temp.line('batch2', 7))
  -- (with the moment the case was opened, which the test set an hour back, never the moment it was handed on)
  and (select outcome = 'created' and case_id = pg_temp.got('kept2', 'caio')::uuid and person_created
       and decided_at < now() - interval '30 minutes' from pg_temp.line('batch2b', 2))
  and (select count(*) = 3 from public.cases where id in (pg_temp.got('kept2', 'bruno')::uuid, pg_temp.got('kept2', 'lia')::uuid,
                                                          pg_temp.got('kept2', 'caio')::uuid))
  -- Each case removed is on record as it goes, and the batch's end too.
  and (select count(*) = 3 from public.audit_events
       where action = 'import.case_removed' and metadata ->> 'batch' = pg_temp.got('batch2', 'batch_id'))
  and (select count(*) = 1 from public.audit_events where action = 'import.reverted' and entity_id = pg_temp.got('batch2', 'batch_id')),
  'undoing takes a client an import wrote with the last case of theirs, keeps what anybody touched, whatever recorded it, and hands a case on to the spreadsheet that also found it'
);

-- The spreadsheet that inherited Caio's case undoes it as its own.
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('undone2b', public.revert_import_batch(pg_temp.got('batch2b', 'batch_id')::uuid));
reset role;
select ok(
  pg_temp.got('undone2b', 'code') = 'reverted'
  and (select payload -> 'counts' ->> 'reverted' = '1' from res where name = 'undone2b')
  and (select count(*) = 0 from public.cases where id = pg_temp.got('kept2', 'caio')::uuid)
  and (select count(*) = 0 from public.people where org_id = 'b0200000-0000-4000-8000-00000000000a' and full_name = 'Caio Teste')
  and (select count(*) = 1 from public.audit_events
       where action = 'import.case_removed' and entity_id = pg_temp.got('kept2', 'caio')
         and metadata ->> 'batch' = pg_temp.got('batch2b', 'batch_id')),
  'a case handed on is undone by the spreadsheet that holds it, with the client the first one wrote'
);

-- ---------- A line that fails, and a batch that stopped half way ----------

-- Something nobody foresaw goes wrong for one client, after her case and herself were written.
create function pg_temp.fail_one() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.people p where p.id = new.person_id and p.full_name = 'Carla Teste') then
    raise exception 'something nobody foresaw' using errcode = '22000';
  end if;
  return new;
end;
$$;
create trigger fail_one before insert on public.case_parties for each row execute function pg_temp.fail_one();

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch4', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'parou.csv', null));
insert into res values ('added4', public.add_import_rows(pg_temp.got('batch4', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50006544920998090051", "client_name": "Carla Teste", "kind": "juizado", "court": "TJGO"},
    {"row": 3, "cnj": "50009879820998090051", "client_name": "Dora Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('added4b', public.add_import_rows(pg_temp.got('batch4', 'batch_id')::uuid,
  '[{"row": 4, "cnj": "50011118120998090051", "client_name": "Enzo Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('half', public.commit_import_batch(pg_temp.got('batch4', 'batch_id')::uuid));
reset role;
drop trigger fail_one on public.case_parties;
select ok(
  pg_temp.got('half', 'code') = 'in_progress'
  and (select payload -> 'counts' = '{"rows": 3, "pending": 1, "created": 1, "exists": 0, "refused": 1, "reverted": 0, "kept": 0}'::jsonb
       from res where name = 'half')
  and (select outcome = 'refused' and code = 'failed' and case_id is null and person_id is null from pg_temp.line('batch4', 2))
  and (select count(*) = 0 from public.people where org_id = 'b0200000-0000-4000-8000-00000000000a' and full_name = 'Carla Teste')
  and (select count(*) = 0 from public.proceedings where org_id = 'b0200000-0000-4000-8000-00000000000a' and cnj = '50006544920998090051')
  and (select outcome = 'created' and case_id is not null from pg_temp.line('batch4', 3))
  and (select status = 'staged' from public.import_batches where id = pg_temp.got('batch4', 'batch_id')::uuid),
  'a line that fails for a reason nobody foresaw is refused alone, leaves nothing, and holds no other line back'
);

insert into res select 'dora', jsonb_build_object('case', case_id, 'person', person_id) from pg_temp.line('batch4', 3);
update public.import_rows set decided_at = decided_at - interval '1 hour' where batch_id = pg_temp.got('batch4', 'batch_id')::uuid;
update public.case_events set at = at - interval '2 hours' where case_id = pg_temp.got('dora', 'case')::uuid;
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('discard_half', public.discard_import_batch(pg_temp.got('batch4', 'batch_id')::uuid));
insert into res values ('undone_half', public.revert_import_batch(pg_temp.got('batch4', 'batch_id')::uuid));
insert into res values ('commit_undone', public.commit_import_batch(pg_temp.got('batch4', 'batch_id')::uuid));
reset role;
select ok(
  pg_temp.got('discard_half', 'code') = 'batch_not_staged' and pg_temp.got('undone_half', 'code') = 'reverted'
  and (select payload -> 'counts' = '{"rows": 3, "pending": 0, "created": 0, "exists": 0, "refused": 2, "reverted": 1, "kept": 0}'::jsonb
       from res where name = 'undone_half')
  and (select count(*) = 0 from public.cases where id = pg_temp.got('dora', 'case')::uuid)
  and (select count(*) = 0 from public.people where id = pg_temp.got('dora', 'person')::uuid)
  -- The line nobody decided is not brought, and nothing the spreadsheet said stays.
  and (select outcome = 'refused' and code = 'undone' from pg_temp.line('batch4', 4))
  and (select bool_and(fields = '{}'::jsonb) from public.import_rows where batch_id = pg_temp.got('batch4', 'batch_id')::uuid)
  and (select status = 'reverted' and committed_at is null and reverted_at is not null
       from public.import_batches where id = pg_temp.got('batch4', 'batch_id')::uuid)
  and pg_temp.got('commit_undone', 'code') = 'already_committed'
  and (select count(*) = 0 from public.people where org_id = 'b0200000-0000-4000-8000-00000000000a' and full_name = 'Enzo Teste'),
  'a batch that stopped half way is undone as far as it went, and the lines nobody decided are never brought'
);

-- ---------- Giving up ----------

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch3', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'desistiu.csv', null));
insert into res values ('added3', public.add_import_rows(pg_temp.got('batch3', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50007896120998090051", "client_name": "Rita Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('empty_commit', public.commit_import_batch(
  (public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'vazia.csv', null) ->> 'batch_id')::uuid));
insert into res values ('discard_committed', public.discard_import_batch(pg_temp.got('batch', 'batch_id')::uuid));
insert into res values ('discarded', public.discard_import_batch(pg_temp.got('batch3', 'batch_id')::uuid));
insert into res values ('revert_staged', public.revert_import_batch(
  (select id from public.import_batches where file_name = 'vazia.csv')));
reset role;
insert into res select 'vazia', jsonb_build_object('batch_id', id) from public.import_batches where file_name = 'vazia.csv';
select ok(
  pg_temp.got('empty_commit', 'code') = 'no_rows' and pg_temp.got('discard_committed', 'code') = 'batch_not_staged'
  and pg_temp.got('discarded', 'code') = 'discarded' and pg_temp.got('revert_staged', 'code') = 'batch_not_committed'
  and (select count(*) = 0 from public.import_batches where id = pg_temp.got('batch3', 'batch_id')::uuid)
  and (select count(*) = 0 from public.import_rows where batch_id = pg_temp.got('batch3', 'batch_id')::uuid)
  and (select count(*) = 1 and bool_and(metadata ->> 'rows' = '1')
       from public.audit_events where action = 'import.discarded' and entity_id = pg_temp.got('batch3', 'batch_id')),
  'a batch nobody committed is given up with its lines, on record; one committed is undone, never thrown away'
);

-- ---------- A batch nobody finished ----------

-- One left staged with nothing decided (vazia.csv), one that stopped half way, one still being brought,
-- and one being brought right now whose last change was long ago.
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch5', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'esquecida.csv', null));
insert into res values ('added5', public.add_import_rows(pg_temp.got('batch5', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50012226520998090051", "client_name": "Fabio Teste", "kind": "juizado", "court": "TJGO"},
    {"row": 3, "cnj": "50013334920998090051", "client_name": "Gina Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('added5b', public.add_import_rows(pg_temp.got('batch5', 'batch_id')::uuid,
  '[{"row": 4, "cnj": "50014443320998090051", "client_name": "Hugo Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('half5', public.commit_import_batch(pg_temp.got('batch5', 'batch_id')::uuid));
insert into res values ('batch6', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'recente.csv', null));
insert into res values ('added6', public.add_import_rows(pg_temp.got('batch6', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50015551720998090051", "client_name": "Iara Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('batch7', public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'em-curso.csv', null));
insert into res values ('added7', public.add_import_rows(pg_temp.got('batch7', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "50022220320998090051", "client_name": "Joana Teste", "kind": "juizado", "court": "TJGO"},
    {"row": 3, "cnj": "50003219720998090051", "client_name": "Kleber Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
insert into res values ('added7b', public.add_import_rows(pg_temp.got('batch7', 'batch_id')::uuid,
  '[{"row": 4, "cnj": "50021216320998090051", "client_name": "Luana Teste", "kind": "juizado", "court": "TJGO"}]'::jsonb));
reset role;
alter table public.import_batches disable trigger import_batches_updated_at;
update public.import_batches set updated_at = now() - interval '8 days' where file_name in ('vazia.csv', 'esquecida.csv', 'em-curso.csv');
alter table public.import_batches enable trigger import_batches_updated_at;
-- A call on the one being brought moves it.
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('half7', public.commit_import_batch(pg_temp.got('batch7', 'batch_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('expired', public.expire_import_batches());
insert into res values ('expired_again', public.expire_import_batches());
reset role;
select ok(
  pg_temp.got('half5', 'code') = 'in_progress' and pg_temp.got('half7', 'code') = 'in_progress'
  and pg_temp.got('expired', 'dropped') = '1' and pg_temp.got('expired', 'closed') = '1'
  and pg_temp.got('expired_again', 'dropped') = '0' and pg_temp.got('expired_again', 'closed') = '0'
  and (select count(*) = 0 from public.import_batches where file_name = 'vazia.csv')
  and (select count(*) = 1 from public.audit_events where action = 'import.dropped' and entity_id = pg_temp.got('vazia', 'batch_id'))
  -- The one that stopped half way is closed as far as it went: its cases stay, to be undone by a person.
  and (select status = 'committed' and counts = '{"rows": 3, "pending": 0, "created": 2, "exists": 0, "refused": 1, "reverted": 0, "kept": 0}'::jsonb
       from public.import_batches where id = pg_temp.got('batch5', 'batch_id')::uuid)
  and (select outcome = 'refused' and code = 'expired' from pg_temp.line('batch5', 4))
  and (select bool_and(fields = '{}'::jsonb) from public.import_rows where batch_id = pg_temp.got('batch5', 'batch_id')::uuid)
  and (select count(*) = 2 from public.cases
       where id in (select case_id from public.import_rows where batch_id = pg_temp.got('batch5', 'batch_id')::uuid))
  and (select count(*) = 1 from public.audit_events where action = 'import.expired' and entity_id = pg_temp.got('batch5', 'batch_id'))
  -- The ones still being brought are left alone, the one a call just worked on too.
  and (select b.status = 'staged' and r.fields ->> 'client_name' = 'Iara Teste'
       from public.import_batches b join public.import_rows r on r.batch_id = b.id
       where b.id = pg_temp.got('batch6', 'batch_id')::uuid)
  and (select status = 'staged' from public.import_batches where id = pg_temp.got('batch7', 'batch_id')::uuid)
  and (select count(*) = 1 from public.import_rows where batch_id = pg_temp.got('batch7', 'batch_id')::uuid and outcome is null),
  'a batch nobody finished does not keep a spreadsheet for ever: one never started goes, one that stopped half way is closed as far as it went, one being brought is left alone'
);

-- ---------- Two firms, and who may write ----------

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('seen_b', jsonb_build_object(
  'batches', (select count(*) from public.import_batches), 'rows', (select count(*) from public.import_rows)));
select throws_ok(
  format('select public.commit_import_batch(%L)', pg_temp.got('batch', 'batch_id')),
  'P0002', 'batch_not_found', 'nobody commits a batch of another firm'
);
select throws_ok(
  format('select public.revert_import_batch(%L)', pg_temp.got('batch', 'batch_id')),
  'P0002', 'batch_not_found', 'nobody undoes a batch of another firm'
);
reset role;
select ok(
  pg_temp.got('seen_b', 'batches') = '0' and pg_temp.got('seen_b', 'rows') = '0',
  'a firm reads its own batches and lines and none of another'
);

select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$insert into public.import_batches (org_id, file_name) values (%L, 'direto.csv')$$, 'b0200000-0000-4000-8000-00000000000a'),
  '42501', null, 'a member never writes a batch but through its functions'
);
select throws_ok($$select public.expire_import_batches()$$, '42501', null, 'a member never runs the sweep');
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a0200000-0000-4000-8000-000000000009', 'a0200000-0000-4000-8000-000000000001', 'b0200000-0000-4000-8000-00000000000a',
        'Conferindo a importação', 'f0200000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a0200000-0000-4000-8000-000000000001', 'aal2', 'f0200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.create_import_batch('b0200000-0000-4000-8000-00000000000a', 'suporte.csv', null)$$,
  '42501', 'not_allowed_in_support_session', 'a support visit brings no portfolio'
);
reset role;

-- ---------- One person's name, written two ways ----------

select ok(
  public.import_names_match('Maria Teste', 'MARIA TESTE DA SILVA')
  and public.import_names_match('Maria  teste', 'Maria Teste')
  and public.import_names_match('João da Silva', 'Joao Silva')
  and public.import_names_match('J. Silva', 'João Silva')
  and public.import_names_match('Ana', 'Ana Paula Souza')
  and public.import_names_match('Maria D''Ávila', 'MARIA DAVILA')
  and not public.import_names_match('Maria D''Ávila', 'Maria Dantas')
  and not public.import_names_match('Maria Teste', 'Pedro Teste')
  and not public.import_names_match('Maria Silva', 'Maria Santos')
  and not public.import_names_match('', 'Maria')
  and not public.import_names_match(null, 'Maria')
  and not public.import_names_match('da', 'de'),
  'one person''s name is told however it is written, and two people''s are never taken for one'
);

-- ---------- An airline that no longer flies ----------

select ok(
  (select not active and court_names = array['Oceanair', 'Avianca Brasil'] from public.airlines where iata = 'O6')
  and (select court_names @> array['TAM', 'LATAM Brasil'] from public.airlines where iata = 'LA'),
  'the companies a spreadsheet names are known by their names in court, Avianca Brasil too, which no case is opened under'
);

select * from finish();
rollback;
