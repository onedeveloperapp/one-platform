begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- The forecast of a case (0250): a day recorded only by the reading's rule
-- in force, a decision read by an older rule read again in place; the cut
-- nearest the case with 30 decisions on the merits (the judge only of a
-- lawsuit distributed); each level beside it; what the claimants may
-- expect; what the airline does at the unit; each open lawsuit's forecast
-- kept, the one it had when distributed never changed; the firm's sum and
-- how the forecast came out. Two firms: each reads its own lawsuits only.
--
-- Every person, judge, unit and decision here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-previsao.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-previsao.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2500000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-previsao', 'a2500000-0000-4000-8000-000000000001'),
  ('b2500000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-previsao', 'a2500000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2500000-0000-4000-8000-00000000000a', 'a2500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2500000-0000-4000-8000-00000000000b', 'a2500000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.people (id, org_id, full_name) values
  ('c2500000-0000-4000-8000-000000000001', 'b2500000-0000-4000-8000-00000000000a', 'Maria Teste'),
  ('c2500000-0000-4000-8000-000000000002', 'b2500000-0000-4000-8000-00000000000a', 'João Teste'),
  ('c2500000-0000-4000-8000-000000000003', 'b2500000-0000-4000-8000-00000000000b', 'Paula Teste');
insert into public.cases (id, org_id, seq, module, incident, status, airline_iata) values
  ('d2500000-0000-4000-8000-000000000001', 'b2500000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'filed', 'AD'),
  ('d2500000-0000-4000-8000-000000000002', 'b2500000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'cancellation', 'filed', 'AD'),
  ('d2500000-0000-4000-8000-000000000003', 'b2500000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'cancellation', 'filed', 'AD');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2500000-0000-4000-8000-000000000001', 'b2500000-0000-4000-8000-00000000000a', 'd2500000-0000-4000-8000-000000000001', 'c2500000-0000-4000-8000-000000000001', 'claimant'),
  ('e2500000-0000-4000-8000-000000000002', 'b2500000-0000-4000-8000-00000000000a', 'd2500000-0000-4000-8000-000000000001', 'c2500000-0000-4000-8000-000000000002', 'claimant'),
  ('e2500000-0000-4000-8000-000000000003', 'b2500000-0000-4000-8000-00000000000b', 'd2500000-0000-4000-8000-000000000003', 'c2500000-0000-4000-8000-000000000003', 'claimant');
-- A1 distributed to a unit with its judge; A2 not yet distributed; B1 in São Paulo.
insert into public.proceedings (id, org_id, case_id, kind, court, comarca, unit, status, cnj, filed_at) values
  ('f2500000-0000-4000-8000-000000000001', 'b2500000-0000-4000-8000-00000000000a', 'd2500000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'Goiânia', 'Goiânia - 9ª UPJ Juizados Especiais Cíveis: 1º e 2º', 'filed', '50002023920998090051', '2026-09-01'),
  ('f2500000-0000-4000-8000-000000000002', 'b2500000-0000-4000-8000-00000000000a', 'd2500000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'Goiânia', null, 'planned', null, null),
  ('f2500000-0000-4000-8000-000000000003', 'b2500000-0000-4000-8000-00000000000b', 'd2500000-0000-4000-8000-000000000003',
   'juizado', 'TJSP', 'São Paulo', null, 'planned', null, null);
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f2500000-0000-4000-8000-000000000001', 'e2500000-0000-4000-8000-000000000001', 'b2500000-0000-4000-8000-00000000000a'),
  ('f2500000-0000-4000-8000-000000000001', 'e2500000-0000-4000-8000-000000000002', 'b2500000-0000-4000-8000-00000000000a'),
  ('f2500000-0000-4000-8000-000000000003', 'e2500000-0000-4000-8000-000000000003', 'b2500000-0000-4000-8000-00000000000b');
insert into public.proceeding_tracking (org_id, case_id, proceeding_id, cnj, source, status, snapshot) values
  ('b2500000-0000-4000-8000-00000000000a', 'd2500000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000001',
   '50002023920998090051', 'projudi', 'tracked', '{"responsibles":[{"name":"Ana Paula Exemplo","role":"Juiz(a)"}]}'::jsonb)
on conflict (proceeding_id) do update set snapshot = excluded.snapshot;

-- The market, invented: at the unit, the judge decides 35 cancellations against the airline (30 won in part with
-- R$ 4.000,00, 5 lost) and another judge 20 (won, R$ 3.000,00); another unit of the comarca loses 10; the unit also
-- extinguishes 4 lawsuits of other problems (3 for the claimant's absence) and approves 2 settlements.
insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result, moral_cents, problem, extinction_reason, rule)
select 'prev-' || n, 'djen', 'TJGO', 'Goiânia - 9ª UPJ Juizados Especiais Cíveis: 1º e 2º', 'Ana Paula Exemplo', 'AZUL LINHAS AEREAS', 'AD',
       current_date - n, 'first', case when n <= 30 then 'parcial' else 'improcedente' end,
       case when n <= 30 then 400000 end, 'cancellation', null, 'mercado-v2'
from generate_series(1, 35) n;
insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result, moral_cents, problem, rule)
select 'prev-b' || n, 'djen', 'TJGO', 'Goiânia - 9ª UPJ Juizados Especiais Cíveis: 1º e 2º', 'Carlos Modelo', 'AZUL LINHAS AEREAS', 'AD',
       current_date - n, 'first', 'procedente', 300000, 'cancellation', 'mercado-v2'
from generate_series(1, 20) n;
insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result, problem, rule)
select 'prev-c' || n, 'djen', 'TJGO', 'Goiânia - 8ª UPJ Juizados Especiais Cíveis', null, 'AZUL LINHAS AEREAS', 'AD',
       current_date - n, 'first', 'improcedente', 'cancellation', 'mercado-v2'
from generate_series(1, 10) n;
insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result, problem, extinction_reason, rule)
select 'prev-d' || n, 'djen', 'TJGO', 'Goiânia - 9ª UPJ Juizados Especiais Cíveis: 1º e 2º', null, 'AZUL LINHAS AEREAS', 'AD',
       current_date - n, 'first', case when n <= 4 then 'extinto' else 'acordo' end, 'other',
       case when n <= 3 then 'ausencia_autor' when n = 4 then 'desistencia' end, 'mercado-v2'
from generate_series(1, 6) n;
-- A decision read by the older rule, read again by the rule in force below.
insert into public.market_decisions (key, source, court, unit, party, airline_iata, day, instance, result, problem, rule)
values ('prev-old', 'djen', 'TJGO', 'Anápolis - 1º Juizado Especial Cível', 'AZUL LINHAS AEREAS', 'AD', current_date - 400, 'first', 'extinto', 'other', 'mercado-v1'),
       -- What the older rule took for a decision and the rule in force does not (an enforcement phase ended by payment).
       ('prev-stale', 'djen', 'TJGO', 'Anápolis - 1º Juizado Especial Cível', 'AZUL LINHAS AEREAS', 'AD', current_date - 400, 'first', 'extinto', 'other', 'mercado-v1');
insert into public.market_captures (id, court, party, airline_iata, next_day) values
  ('92500000-0000-4000-8000-000000000001', 'TJGO', 'COMPANHIA TESTE', 'AD', current_date - 400);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

-- ---------- The backend ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('recorded', public.record_market_day('92500000-0000-4000-8000-000000000001', current_date - 400,
  '[{"key":"prev-old","unit":"Anápolis - 1º Juizado Especial Cível","instance":"first","result":"extinto","problem":"other","extinction_reason":"ausencia_autor"},
    {"key":"prev-new","unit":"Anápolis - 1º Juizado Especial Cível","instance":"first","result":"procedente","moral_cents":500000,"problem":"delay","content_key":"texto-1"},
    {"key":"prev-copy","unit":"Anápolis - 1º Juizado Especial Cível","instance":"first","result":"procedente","moral_cents":500000,"problem":"delay","content_key":"texto-1"}]'::jsonb,
  true, 'mercado-v2'));
insert into res values ('intake', public.market_forecast('cancellation', 'AD', 'TJGO'));
insert into res values ('planned', jsonb_build_object('n', public.market_plan_captures()));
insert into res values ('refreshed', jsonb_build_object('n', public.refresh_case_forecasts(10)));
reset role;

select throws_ok(
  $$ select public.record_market_day('92500000-0000-4000-8000-000000000001', current_date - 399, '[]'::jsonb, true, 'mercado-v1') $$,
  '22023', 'rule_outdated', 'a day read by an older rule is refused'
);

select ok(
  pg_temp.got('recorded', '{kept}') = '1'
  and (select rule = 'mercado-v2' and extinction_reason = 'ausencia_autor' from public.market_decisions where key = 'prev-old')
  and not exists (select 1 from pg_proc where proname = 'record_market_day' and pronargs = 4)
  and not exists (select 1 from public.market_decisions where key in ('prev-stale', 'prev-copy')),
  'a decision read by the older rule is read again in place, what it no longer reads goes, a copy counts once, and the old signature is gone'
);

select ok(
  pg_temp.got('intake', '{cut,level}') = 'court' and pg_temp.got('intake', '{cut,airline}') = 'AD'
  and pg_temp.got('intake', '{merits}') = '65' and pg_temp.got('intake', '{courts,0}') = 'TJGO'
  and pg_temp.got('intake', '{moral,median_cents}') = '400000',
  'the intake''s forecast keeps its keys, by court and airline when no unit is named'
);

-- ---------- A member of the first firm ----------
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2500000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('a1', public.case_forecast('f2500000-0000-4000-8000-000000000001'));
insert into res values ('a2', public.case_forecast('f2500000-0000-4000-8000-000000000002'));
insert into res values ('b1', jsonb_build_object('read', public.case_forecast('f2500000-0000-4000-8000-000000000003')));
insert into res values ('rows', jsonb_build_object('n', (select count(*) from public.case_forecasts)));
reset role;

select ok(
  pg_temp.got('a1', '{stage}') = 'distributed' and pg_temp.got('a1', '{judge}') = 'Ana Paula Exemplo'
  and pg_temp.got('a1', '{forecast,cut,level}') = 'judge' and pg_temp.got('a1', '{forecast,cut,airline}') = 'AD'
  and pg_temp.got('a1', '{forecast,chance_percent}') = '86' and pg_temp.got('a1', '{forecast,base}') = 'media'
  and pg_temp.got('a1', '{claimants}') = '2' and pg_temp.got('a1', '{expected_cents}') = '688000'
  and pg_temp.got('a1', '{forecast,moral,values,0}') = '400000',
  'a lawsuit distributed reads its judge with the airline: the chance, the base, the values and the claimants'' expectation'
);

select ok(
  (select array_agg(x.v ->> 'level' order by x.i) = array['judge', 'unit', 'comarca', 'court']
   from res, jsonb_array_elements(payload -> 'levels') with ordinality as x (v, i) where name = 'a1')
  and (select (x ->> 'merits') = '55' from res, jsonb_array_elements(payload -> 'levels') x
       where name = 'a1' and x ->> 'level' = 'unit')
  and (select (x ->> 'merits') = '65' from res, jsonb_array_elements(payload -> 'levels') x
       where name = 'a1' and x ->> 'level' = 'comarca'),
  'each level is said beside the forecast: the judge, the unit, the comarca and the court'
);

select ok(
  pg_temp.got('a1', '{hearing,level}') = 'unit' and pg_temp.got('a1', '{hearing,decisions}') = '61'
  and pg_temp.got('a1', '{hearing,acordo}') = '2' and pg_temp.got('a1', '{hearing,extinto}') = '4'
  and pg_temp.got('a1', '{hearing,reasons,ausencia_autor}') = '3',
  'what the airline does at the unit: its settlements and its extinctions, by reason'
);

select ok(
  pg_temp.got('a2', '{stage}') = 'before' and pg_temp.got('a2', '{judge}') is null
  and pg_temp.got('a2', '{forecast,cut,level}') = 'comarca' and pg_temp.got('a2', '{forecast,merits}') = '65'
  and pg_temp.got('b1', '{read}') is null and pg_temp.got('rows', '{n}') = '2',
  'before distribution the comarca with no judge; another firm''s lawsuit and its forecast are not read'
);

-- ---------- The forecast kept, and how it came out ----------
insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result, problem, rule)
select 'prev-e' || n, 'djen', 'TJGO', 'Goiânia - 9ª UPJ Juizados Especiais Cíveis: 1º e 2º', 'Ana Paula Exemplo', 'AZUL LINHAS AEREAS', 'AD',
       current_date - n, 'first', 'improcedente', 'cancellation', 'mercado-v2'
from generate_series(1, 15) n;
update public.case_forecasts set refreshed_at = now() - interval '2 days';
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, happened_on, source) values
  ('b2500000-0000-4000-8000-00000000000a', 'd2500000-0000-4000-8000-000000000001', 'f2500000-0000-4000-8000-000000000001',
   'sentenca', 'parcial', current_date, 'person');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('again', jsonb_build_object('n', public.refresh_case_forecasts(10)));
reset role;

select ok(
  pg_temp.got('refreshed', '{n}') = '3' and pg_temp.got('again', '{n}') = '3'
  and (select chance_percent = 60 and distributed_chance = 86 and distributed_level = 'judge'
       from public.case_forecasts where proceeding_id = 'f2500000-0000-4000-8000-000000000001')
  and (select distributed_at is null from public.case_forecasts where proceeding_id = 'f2500000-0000-4000-8000-000000000002'),
  'each open lawsuit''s forecast is refreshed, and the one it had when distributed never changes'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2500000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('firm', public.firm_forecast('b2500000-0000-4000-8000-00000000000a'));
insert into res values ('other_firm', jsonb_build_object('read', public.firm_forecast('b2500000-0000-4000-8000-00000000000b')));
reset role;

select ok(
  pg_temp.got('firm', '{with_forecast}') = '2' and pg_temp.got('firm', '{bands,high}') = '0'
  and pg_temp.got('firm', '{bands,mid}') = '2'
  and pg_temp.got('firm', '{accuracy,judged}') = '1' and pg_temp.got('firm', '{accuracy,as_forecast}') = '1'
  and pg_temp.got('firm', '{accuracy,forecast_percent}') = '86'
  and pg_temp.got('other_firm', '{read}') is null,
  'the firm sums its own open lawsuits and sees how the forecast came out; another firm''s is not read'
);

select ok(
  (select count(*) >= 1 from public.market_captures where court = 'TJSP' and party = 'AZUL LINHAS AEREAS')
  and pg_temp.got('planned', '{n}')::integer >= 1,
  'the court of a firm''s lawsuit is read without anybody asking, by the airline''s short name'
);

select ok(
  not has_function_privilege('authenticated', 'public.market_forecast(text, text, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.market_forecast_of(text, text, text, text, text, text, integer, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.proceeding_forecast(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_market_day(uuid, date, jsonb, boolean, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.refresh_case_forecasts(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_forecast(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.firm_forecast(uuid, boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.case_forecast(uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.case_forecasts', 'INSERT'),
  'the forecast''s inner workings are the backend''s; a member reads the case''s and the firm''s'
);

select * from finish();
rollback;
