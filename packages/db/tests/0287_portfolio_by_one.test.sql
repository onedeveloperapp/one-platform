begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ============================================================
-- The lawsuits a firm already has when it arrives, brought into ONE by ONE (0287). Firm A's lawyer has, in the
-- DJEN, a lawsuit against the airline of the test (ONE reads it, opens its case in court with its two claimants,
-- in a batch of its own the firm undoes, and never opens it again), one where the firm is on the side sued (left
-- with why), one whose texts name no airline (never read) and one it already has. Its clients get their CPF from
-- the firm: one given, one that is a client the firm already had (the case takes them), one the firm has for
-- somebody else (refused). A spreadsheet's lawsuit in course has its history owed at once, an ended one not. Firm B
-- keeps the decision with a person: nothing is read until its partner asks, and it reads nothing of firm A's.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099, and the CPFs are the ones every manual
-- uses as examples.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2870000-0000-4000-8000-000000000001', 'ana@lima-carteira.invalid', 'Ana Lima'),
  ('a2870000-0000-4000-8000-000000000002', 'davi@lima-carteira.invalid', 'Davi Lima'),
  ('a2870000-0000-4000-8000-000000000003', 'edu@rocha-carteira.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2870000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-carteira', 'a2870000-0000-4000-8000-000000000001'),
  ('b2870000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-carteira', 'a2870000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2870000-0000-4000-8000-00000000000a', 'a2870000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2870000-0000-4000-8000-00000000000a', 'a2870000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b2870000-0000-4000-8000-00000000000b', 'a2870000-0000-4000-8000-000000000003', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a2870000-0000-4000-8000-000000000001', 'GO', '28701'),
  ('a2870000-0000-4000-8000-000000000003', 'GO', '28703');
insert into public.firm_modules (org_id, module_key) values
  ('b2870000-0000-4000-8000-00000000000a', 'direito-do-passageiro'),
  ('b2870000-0000-4000-8000-00000000000b', 'direito-do-passageiro')
on conflict do nothing;
-- Firm B keeps the opening of these cases with a person.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b2870000-0000-4000-8000-00000000000b', 'open_case_from_djen', 'approval');
-- Firm A said it used Astrea before ONE.
insert into public.firm_operations (org_id, previous_system) values ('b2870000-0000-4000-8000-00000000000a', 'astrea');
-- The company of the test, known by its name in court.
insert into public.airlines (iata, name, country, legal_name, court_names) values
  ('ZZ', 'Companhia de Teste', 'BR', 'COMPANHIA AEREA DE TESTE SA', array['COMPANHIA AEREA DE TESTE SA'])
on conflict (iata) do update set court_names = excluded.court_names, active = true;

-- A lawsuit firm A already has, and a client it already had (by the CPF of the manuals).
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2870000-0000-4000-8000-000000000001', 'b2870000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at) values
  ('b2870000-0000-4000-8000-00000000000a', 'c2870000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'filed',
   '28710048020998090051', '2026-09-01');
insert into public.people (id, org_id, full_name, cpf) values
  ('d2870000-0000-4000-8000-000000000001', 'b2870000-0000-4000-8000-00000000000a', 'João Inventado da Silva', '11144477735'),
  ('d2870000-0000-4000-8000-000000000002', 'b2870000-0000-4000-8000-00000000000a', 'Pedro Outro Inventado', '12345678909');

insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, unit, class_name) values
  -- Against the airline: opened, then undone by the firm.
  ('b2870000-0000-4000-8000-00000000000a', 'hash-carteira-1', 'TJGO', '28710012820998090051', current_date - 9, 'Intimação',
   'Requerente: Maria Inventada. Requerido: COMPANHIA AÉREA DE TESTE SA. Designada audiência.',
   '1º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível'),
  -- The firm on the side sued.
  ('b2870000-0000-4000-8000-00000000000a', 'hash-carteira-2', 'TJGO', '28710021320998090051', current_date - 8, 'Intimação',
   'COMPANHIA AÉREA DE TESTE SA: intime-se.', '2ª Vara Cível de Goiânia', 'Procedimento Comum Cível'),
  -- Texts that name no airline: never read.
  ('b2870000-0000-4000-8000-00000000000a', 'hash-carteira-3', 'TJGO', '28710039520998090051', current_date - 7, 'Intimação',
   'Intime-se a parte autora.', '3º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível'),
  -- The lawsuit the firm already has.
  ('b2870000-0000-4000-8000-00000000000a', 'hash-carteira-4', 'TJGO', '28710048020998090051', current_date - 6, 'Intimação',
   'COMPANHIA AÉREA DE TESTE SA: manifeste-se.', '4º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível'),
  -- Against the airline, in the civil court: opened after the undoing, its clients get their CPF.
  ('b2870000-0000-4000-8000-00000000000a', 'hash-carteira-7', 'TJGO', '28710073520998090051', current_date - 5, 'Intimação',
   'Autores x COMPANHIA AÉREA DE TESTE SA. Cite-se.', '5ª Vara Cível de Goiânia', 'Procedimento Comum Cível'),
  -- Firm B's.
  ('b2870000-0000-4000-8000-00000000000b', 'hash-carteira-5', 'TJGO', '28710056520998090051', current_date - 4, 'Intimação',
   'Requerido: COMPANHIA AÉREA DE TESTE SA.', '6º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to authenticated, service_role, anon;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, key text) returns text language sql as
$$ select payload #>> string_to_array(key, '.') from res where res.name = got.name; $$;
create function pg_temp.read_of(target_cnj text) returns uuid language sql as
$$ select id from public.djen_case_reads where cnj = target_cnj; $$;

-- ---------- What ONE owes: a reading of each lawsuit it may open ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('prepared', public.prepare_djen_case_reads());
insert into res select 'claimed', jsonb_build_object('rows', jsonb_agg(to_jsonb(c)))
  from public.claim_djen_case_reads(10, 'b2870000-0000-4000-8000-00000000000a') c;
reset role;

select ok(
  (select array_agg(cnj order by cnj) from public.djen_case_reads where org_id = 'b2870000-0000-4000-8000-00000000000a')
    = array['28710012820998090051', '28710021320998090051', '28710073520998090051']
  and not exists (select 1 from public.djen_case_reads where org_id = 'b2870000-0000-4000-8000-00000000000b'),
  'ONE owes a reading of each lawsuit of the DJEN whose texts name an airline and the firm has not, where the firm leaves it to ONE'
);
select ok(
  jsonb_array_length(pg_temp.got('claimed', 'rows')::jsonb) = 3
  and (select bool_and(status = 'working' and claims = 1) from public.djen_case_reads
       where org_id = 'b2870000-0000-4000-8000-00000000000a'),
  'the sweep claims what is owed under a number'
);

-- ---------- ONE opens a case ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('wrong_claim', public.one_open_djen_case(pg_temp.read_of('28710012820998090051'), 9, '[]'::jsonb));
insert into res values ('opened', public.one_open_djen_case(pg_temp.read_of('28710012820998090051'), 1, '[
  {"parties": [{"name": "MARIA INVENTADA DA SILVA", "side": "active"}, {"name": "JOSE INVENTADO DA SILVA FILHO", "side": "active"},
               {"name": "COMPANHIA AEREA DE TESTE SA", "side": "passive"}],
   "lawyers": [{"uf": "GO", "number": "28701"}]},
  {"parties": [{"name": "Maria Inventada da Silva", "side": "active"}, {"name": "JOSE INVENTADO DA SILVA", "side": "active"}],
   "lawyers": [{"uf": "GO", "number": "28701"}]},
  {"parties": [{"name": "Outra Parte Inventada", "side": "active"}], "lawyers": [{"uf": "SP", "number": "99999"}]}
]'::jsonb));
insert into res values ('defense', public.one_open_djen_case(pg_temp.read_of('28710021320998090051'), 1, '[
  {"parties": [{"name": "COMPANHIA AEREA DE TESTE SA", "side": "passive"}], "lawyers": [{"uf": "GO", "number": "28701"}]}
]'::jsonb));
reset role;

select is(pg_temp.got('wrong_claim', 'code'), 'not_working', 'a claim that is not the worker''s opens nothing');
select ok(
  pg_temp.got('opened', 'code') = 'opened'
  and (select c.status = 'filed' and c.module = 'direito-do-passageiro' and c.airline_iata = 'ZZ'
       from public.cases c where c.id = pg_temp.got('opened', 'case_id')::uuid)
  and (select array_agg(p.full_name order by p.full_name) from public.case_parties cp
       join public.people p on p.id = cp.person_id
       where cp.case_id = pg_temp.got('opened', 'case_id')::uuid and cp.role = 'claimant')
      = array['Jose Inventado da Silva', 'Jose Inventado da Silva Filho', 'Maria Inventada da Silva'],
  'ONE opens the case in court against the airline, with the clients of the side that sues through the firm''s lawyer, each once, father and son apart'
);
select ok(
  (select pr.status = 'filed' and pr.kind = 'juizado' and pr.court = 'TJGO' and pr.created_by_one
          and pr.unit = '1º Juizado Especial Cível de Goiânia' and pr.filed_at is null
          and (select count(*) from public.proceeding_parties pp where pp.proceeding_id = pr.id) = 3
   from public.proceedings pr where pr.cnj = '28710012820998090051')
  and exists (select 1 from public.proceeding_history_reads h
              join public.proceedings pr on pr.id = h.proceeding_id
              where pr.cnj = '28710012820998090051' and h.status = 'due')
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('opened', 'case_id')::uuid and e.kind = 'opened_from_djen' and e.actor_type = 'system'),
  'its lawsuit is filed with its number, unit and kind, by ONE, its history owed to the DJEN, and the case says ONE opened it'
);
select ok(
  (select b.kind = 'djen' and b.status = 'committed' and b.rows_count = 1 and b.created_by is null
   from public.import_batches b where b.org_id = 'b2870000-0000-4000-8000-00000000000a')
  and (select r.outcome = 'created' and r.person_created and cardinality(r.more_people) = 2
       from public.import_rows r where r.cnj = '28710012820998090051'),
  'the case is a line of a batch of ONE''s own, which the firm may undo'
);
select ok(
  pg_temp.got('defense', 'reason') = 'firm_on_defense'
  and (select status = 'skipped' and code = 'firm_on_defense' from public.djen_case_reads where cnj = '28710021320998090051'),
  'a lawsuit where the firm is on the side sued is left with why'
);

-- ---------- The firm undoes it, and ONE never opens it again ----------

select pg_temp.sign_in('a2870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'undone', public.revert_import_batch(b.id)
  from public.import_batches b where b.org_id = 'b2870000-0000-4000-8000-00000000000a' and b.kind = 'djen';
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('prepared_again', public.prepare_djen_case_reads());
reset role;

select ok(
  pg_temp.got('undone', 'code') = 'reverted'
  and not exists (select 1 from public.proceedings where cnj = '28710012820998090051')
  and not exists (select 1 from public.people where org_id = 'b2870000-0000-4000-8000-00000000000a' and full_name like 'Jose Inventado%')
  and not exists (select 1 from public.people where org_id = 'b2870000-0000-4000-8000-00000000000a' and full_name = 'Maria Inventada da Silva')
  and (select status = 'opened' and case_id is null from public.djen_case_reads where cnj = '28710012820998090051'),
  'undone, the case goes with every client ONE wrote of it, and ONE never opens that lawsuit again'
);

-- ---------- A case whose clients get their CPF from the firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('opened_7', public.one_open_djen_case(pg_temp.read_of('28710073520998090051'), 1, '[
  {"parties": [{"name": "MARIA INVENTADA DA SILVA", "side": "active"}, {"name": "JOÃO INVENTADO DA SILVA", "side": "active"},
               {"name": "LARA INVENTADA SOUZA", "side": "active"}, {"name": "VIAGENS INVENTADAS LTDA", "side": "active"}],
   "lawyers": [{"uf": "GO", "number": "28701"}]}
]'::jsonb));
reset role;

select ok(
  pg_temp.got('opened_7', 'code') = 'opened'
  and (select pr.kind = 'comum' from public.proceedings pr where pr.cnj = '28710073520998090051')
  and (select b.status = 'committed' and b.rows_count = 1 from public.import_batches b
       join public.djen_case_reads r on r.batch_id = b.id where r.cnj = '28710073520998090051')
  and (select count(*) from public.case_parties cp where cp.case_id = pg_temp.got('opened_7', 'case_id')::uuid) = 3,
  'a case of the civil court opens in a new batch once the day''s was undone, and a company of the side that sues is no client'
);

select pg_temp.sign_in('a2870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cases_a', public.firm_djen_cases('b2870000-0000-4000-8000-00000000000a'));
insert into res values ('portfolio_a', public.firm_portfolio('b2870000-0000-4000-8000-00000000000a'));
insert into res values ('lawsuits_a', public.firm_djen_lawsuits('b2870000-0000-4000-8000-00000000000a', 100));
reset role;
select pg_temp.sign_in('a2870000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cases_davi', public.firm_djen_cases('b2870000-0000-4000-8000-00000000000a'));
insert into res values ('portfolio_davi', public.firm_portfolio('b2870000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('cases_a', 'mode') = 'auto'
  and pg_temp.got('cases_a', 'opened') = '1'
  and pg_temp.got('cases_a', 'without_cpf_total') = '3'
  and pg_temp.got('cases_a', 'skipped.firm_on_defense') = '1'
  and pg_temp.got('cases_a', 'without_cpf.0.seq') is not null,
  'the import''s screen reads what ONE opened, why it left the rest, and each client it named with no CPF'
);
select ok(
  pg_temp.got('portfolio_a', 'system') = 'astrea'
  and pg_temp.got('portfolio_a', 'brought') = 'false'
  and pg_temp.got('portfolio_a', 'can_import') = 'true'
  and pg_temp.got('portfolio_a', 'opened') = '1'
  and pg_temp.got('portfolio_a', 'without_cpf') = '3'
  and pg_temp.got('portfolio_davi', 'can_import') = 'false'
  and pg_temp.got('cases_davi', 'code') = 'not_allowed',
  'the home knows the firm used Astrea and brought nothing yet; who answers the clients reads it and brings nothing'
);
select ok(
  exists (select 1 from res, jsonb_array_elements(payload -> 'lawsuits') l
          where name = 'lawsuits_a' and l ->> 'cnj' = '28710021320998090051' and l ->> 'one' = 'firm_on_defense')
  and exists (select 1 from res, jsonb_array_elements(payload -> 'lawsuits') l
              where name = 'lawsuits_a' and l ->> 'cnj' = '28710039520998090051' and l ->> 'one' is null)
  and not exists (select 1 from res, jsonb_array_elements(payload -> 'lawsuits') l
                  where name = 'lawsuits_a' and l ->> 'cnj' = '28710073520998090051'),
  'the lawsuits of the DJEN say what ONE did of each, and the one it opened is the firm''s'
);

select pg_temp.sign_in('a2870000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'cpf_maria', public.complete_djen_client(p.id, '529.982.247-25')
  from public.people p join public.case_parties cp on cp.person_id = p.id
  where cp.case_id = pg_temp.got('opened_7', 'case_id')::uuid and p.full_name = 'Maria Inventada da Silva';
insert into res select 'cpf_joao', public.complete_djen_client(p.id, '111.444.777-35')
  from public.people p join public.case_parties cp on cp.person_id = p.id
  where cp.case_id = pg_temp.got('opened_7', 'case_id')::uuid and p.cpf is null and p.full_name like 'Jo%';
insert into res select 'cpf_lara', public.complete_djen_client(p.id, '123.456.789-09')
  from public.people p join public.case_parties cp on cp.person_id = p.id
  where cp.case_id = pg_temp.got('opened_7', 'case_id')::uuid and p.full_name = 'Lara Inventada Souza';
insert into res select 'cpf_again', public.complete_djen_client(p.id, '529.982.247-25')
  from public.people p where p.org_id = 'b2870000-0000-4000-8000-00000000000a' and p.cpf = '52998224725';
reset role;

select ok(
  pg_temp.got('cpf_maria', 'code') = 'saved'
  and (select cpf = '52998224725' from public.people where org_id = 'b2870000-0000-4000-8000-00000000000a'
       and full_name = 'Maria Inventada da Silva')
  and pg_temp.got('cpf_again', 'code') = 'has_cpf',
  'the firm gives a client ONE named their CPF, once'
);
select ok(
  pg_temp.got('cpf_joao', 'code') = 'merged'
  and exists (select 1 from public.case_parties cp
              where cp.case_id = pg_temp.got('opened_7', 'case_id')::uuid and cp.person_id = 'd2870000-0000-4000-8000-000000000001')
  and (select count(*) from public.people where org_id = 'b2870000-0000-4000-8000-00000000000a'
       and public.slugify(full_name) = public.slugify('João Inventado da Silva')) = 1,
  'a CPF of a client the firm already had makes the case theirs, and the person ONE wrote goes'
);
select ok(
  pg_temp.got('cpf_lara', 'code') = 'cpf_other_name'
  and (select cpf is null from public.people where full_name = 'Lara Inventada Souza'),
  'a CPF the firm has for somebody of another name is refused'
);

-- ---------- A firm that keeps the decision with a person ----------

select pg_temp.sign_in('a2870000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('cases_b', public.firm_djen_cases('b2870000-0000-4000-8000-00000000000b'));
insert into res values ('asked_b', public.ask_djen_cases('b2870000-0000-4000-8000-00000000000b'));
select throws_ok(
  $$select public.firm_djen_cases('b2870000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'nobody reads what ONE opened for another firm'
);
reset role;

select ok(
  pg_temp.got('cases_b', 'mode') = 'approval'
  and pg_temp.got('cases_b', 'waiting') = '1'
  and pg_temp.got('asked_b', 'code') = 'queued'
  and (select status = 'due' and asked_by = 'a2870000-0000-4000-8000-000000000003'
       from public.djen_case_reads where org_id = 'b2870000-0000-4000-8000-00000000000b'),
  'where the firm keeps it with a person, ONE reads nothing until its partner asks, and the asking is on record'
);

-- ---------- The import: the history of what it brings in course ----------

select pg_temp.sign_in('a2870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch', public.create_import_batch('b2870000-0000-4000-8000-00000000000a', 'carteira.xlsx', 'Astrea'));
insert into res values ('lines', public.add_import_rows(pg_temp.got('batch', 'batch_id')::uuid,
  '[{"row": 2, "cnj": "28710065020998090051", "client_name": "Rui Inventado", "kind": "juizado", "court": "TJGO"},
    {"row": 3, "cnj": "28710082020998090051", "client_name": "Rui Inventado", "kind": "juizado", "court": "TJGO", "closed": true}]'::jsonb));
insert into res values ('committed', public.commit_import_batch(pg_temp.got('batch', 'batch_id')::uuid));
insert into res values ('portfolio_after', public.firm_portfolio('b2870000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('committed', 'code') = 'committed'
  and exists (select 1 from public.proceeding_history_reads h join public.proceedings pr on pr.id = h.proceeding_id
              where pr.cnj = '28710065020998090051' and h.status = 'due' and h.asked_by = 'a2870000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.proceeding_history_reads h join public.proceedings pr on pr.id = h.proceeding_id
                  where pr.cnj = '28710082020998090051')
  and pg_temp.got('portfolio_after', 'brought') = 'true',
  'a spreadsheet''s lawsuit in course has its history owed at once, an ended one is brought as it was, and the home knows the portfolio came'
);

select ok(
  (select key = 'open_case_from_djen' and modes = array['auto', 'approval'] and default_mode = 'auto'
   from public.autonomy_decisions where key = 'open_case_from_djen'),
  'opening these cases is a decision of each firm, ONE''s by default'
);

select * from finish();
rollback;
