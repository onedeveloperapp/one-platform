begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The jurimetry (0190): the market's decisions recorded a day at a time,
-- each once, with nothing of a passenger; a unit's and a judge's numbers,
-- each with its sample and nothing of fewer than five as a rate or a
-- median; the projection by unit; the theses in the shadow until the
-- operator's sample met the goal; read by anybody signed in, written only by
-- the backend. Two firms read the same public numbers and nothing else.
--
-- Every unit, judge and decision here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1880000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-mercado.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1880000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-mercado.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1880000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-mercado', 'a1880000-0000-4000-8000-000000000001'),
  ('b1880000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-mercado', 'a1880000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1880000-0000-4000-8000-00000000000a', 'a1880000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1880000-0000-4000-8000-00000000000b', 'a1880000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.market_captures (id, court, party, next_day) values
  ('c1880000-0000-4000-8000-000000000001', 'TJGO', 'COMPANHIA AEREA TESTE S.A.', current_date - 10);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- Six decisions of the unit, five on the merits (four won), each with moral damages of a delay.
create function pg_temp.decisions(prefix text, unit text, judge text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', prefix || n, 'unit', unit, 'judge', judge, 'instance', 'first',
    'result', case when n = 5 then 'improcedente' when n = 6 then 'extinto' else 'procedente' end,
    'moral_cents', case when n <= 4 then 200000 + n * 100000 end, 'per_claimant', false, 'problem', 'delay',
    'prior_complaint', n = 6, 'thesis', case when n <= 5 then 'fortuito_interno' else 'nenhuma_tese' end,
    'passenger', 'Maria Teste'))
  from generate_series(1, 6) n;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('due', jsonb_build_object('list', public.market_days_due(5)));
insert into res values ('recorded', public.record_market_day('c1880000-0000-4000-8000-000000000001', current_date - 10,
  pg_temp.decisions('dia1-', '1º Juizado Especial Cível de Goiânia', 'Ana Paula Exemplo'), true, 'mercado-v2'));
insert into res values ('wrong_day', public.record_market_day('c1880000-0000-4000-8000-000000000001', current_date - 10,
  pg_temp.decisions('dia1-', '1º Juizado Especial Cível de Goiânia', 'Ana Paula Exemplo'), true, 'mercado-v2'));
insert into res values ('again', public.record_market_day('c1880000-0000-4000-8000-000000000001', current_date - 9,
  pg_temp.decisions('dia1-', '1º Juizado Especial Cível de Goiânia', 'Ana Paula Exemplo'), false, 'mercado-v2'));
reset role;

select ok(
  (select exists (select 1 from jsonb_array_elements(payload -> 'list') x
                   where x ->> 'capture_id' = 'c1880000-0000-4000-8000-000000000001') from res where name = 'due')
  and pg_temp.got('recorded', 'kept') = '6' and pg_temp.got('wrong_day', 'code') = 'not_the_day'
  and pg_temp.got('again', 'kept') = '0'
  and (select next_day = current_date - 8 and decisions = 6 and read_days = 2 and incomplete_days = 1
       from public.market_captures where id = 'c1880000-0000-4000-8000-000000000001'),
  'a day of the market is recorded once, the next day follows, and a day read in part is counted'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'market_decisions'
      and column_name in ('passenger', 'cnj', 'lawsuit', 'text', 'grounds')
  )
  and (select count(*) = 5 from public.market_decisions where thesis = 'fortuito_interno')
  and (select count(*) = 1 from public.market_decisions where thesis is null),
  'a decision keeps no passenger, no lawsuit''s number and no text; a thesis not of the catalog is none'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1880000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('profile', public.market_profile('TJGO', '1º JUIZADO ESPECIAL CIVEL DE GOIANIA', 'ana paula exemplo'));
insert into res values ('projection', jsonb_build_object('rows', public.market_projection('TJGO', null, 'delay')));
reset role;

select ok(
  (select (payload #>> '{unit,decisions}')::integer = 6 and (payload #>> '{unit,merits}')::integer = 5
          and (payload #>> '{unit,success_percent}')::integer = 80
          and (payload #>> '{unit,moral,delay,n}')::integer = 4 and payload #>> '{unit,moral,delay,median_cents}' is null
          and (payload #>> '{unit,prior_complaint}')::integer = 1
          and (payload #>> '{judge,decisions}')::integer = 6
   from res where name = 'profile'),
  'a unit''s numbers are said with their samples: a rate of five merits, no median of four values'
);

select ok(
  (select payload #>> '{unit,theses}' is null and (payload #>> '{unit,theses_released}')::boolean = false from res where name = 'profile')
  and (select jsonb_array_length(payload -> 'rows') = 1
          and payload #>> '{rows,0,unit}' = '1º Juizado Especial Cível de Goiânia' from res where name = 'projection'),
  'the theses stay in the shadow, and the projection groups by unit'
);

-- The operator checks two decisions and tries to release: the goal is not met.
-- Made an operator with no session, as the first operator is made.
select set_config('request.jwt.claims', '', true);
insert into res values ('ids', jsonb_build_object(
  'first', (select id from public.market_decisions where key = 'dia1-1'),
  'second', (select id from public.market_decisions where key = 'dia1-2')));
update public.profiles set is_superadmin = true where id = 'a1880000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1880000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('checked', public.admin_check_market_thesis(pg_temp.got('ids', 'first')::uuid, 'fortuito_interno'));
insert into res values ('checked_bad', public.admin_check_market_thesis(pg_temp.got('ids', 'second')::uuid, 'invented'));
insert into res values ('release', public.admin_release_market_theses(true));
reset role;

select ok(
  pg_temp.got('checked', 'code') = 'checked' and pg_temp.got('checked_bad', 'code') = 'invalid_data'
  and pg_temp.got('release', 'code') = 'goal_not_met'
  and not public.jurimetry_theses_released(),
  'the operator checks the reading at the source, and the theses are released only once the goal is met'
);

-- Once released, a piece of a lawsuit of that unit reads its theses.
update public.platform_settings set value = value || '{"theses_released": true}'::jsonb where key = 'jurimetry';
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1880000-0000-4000-8000-0000000000c1', 'b1880000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at, unit) values
  ('f1880000-0000-4000-8000-000000000001', 'b1880000-0000-4000-8000-00000000000a', 'c1880000-0000-4000-8000-0000000000c1',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01', '1º Juizado Especial Cível de Goiânia');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                piece_kind) values
  ('d1880000-0000-4000-8000-000000000001', 'b1880000-0000-4000-8000-00000000000a', 'c1880000-0000-4000-8000-0000000000c1',
   'f1880000-0000-4000-8000-000000000001', 'Réplica', 'Modelo de teste da réplica, com texto.', 'ai', 'generating', 0, 'replica');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('theses', jsonb_build_object('list', public.unit_theses_for_piece('d1880000-0000-4000-8000-000000000001')));
reset role;

select ok(
  (select payload #>> '{list,0,lado}' = 'favor' and (payload #>> '{list,0,acolhida}')::integer = 4
          and (payload #>> '{list,0,rejeitada}')::integer = 1 from res where name = 'theses'),
  'once released, a piece reads the theses its unit''s decisions rest on'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1880000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select count(*) from public.market_decisions $$, '42501', null, 'nobody reads a decision row by row');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.record_market_day(uuid, date, jsonb, boolean, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.market_days_due(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.unit_theses_for_piece(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.market_profile(text, text, text)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.market_captures', 'SELECT'),
  'only the backend reads and records the market; anybody signed in reads its numbers'
);

select * from finish();
rollback;
