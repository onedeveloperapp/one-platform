begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- A new contact's doubts answered (0249). The market's forecast of a
-- problem takes the most specific cut with thirty decisions on the merits:
-- a delay with Azul has 33 in the TJGO, so its cut is Azul's, with the
-- chance and the median of the moral damages (a value given per claimant
-- stays out, as an appeal and a decision older than the setting's months);
-- a delay with Gol has 6, so the cut is every airline's; a problem with 6
-- decisions in all has the broadest cut with the setting's sample; one with
-- none has no forecast. Only the backend reads it. The intake reads the
-- contact's question, and the task that answers it is the passenger
-- module's, both in its new version. Nobody of either firm calls it.
--
-- Every person, firm and decision here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2490000-0000-4000-8000-000000000001', 'ana@lima-duvida.invalid', 'Ana Lima'),
  ('a2490000-0000-4000-8000-000000000002', 'duda@rocha-duvida.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2490000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-duvida', 'a2490000-0000-4000-8000-000000000001'),
  ('b2490000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-duvida', 'a2490000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2490000-0000-4000-8000-00000000000a', 'a2490000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2490000-0000-4000-8000-00000000000b', 'a2490000-0000-4000-8000-000000000002', 'owner', 'socio');

-- The market's decisions of this test alone (rolled back at the end).
delete from public.market_decisions;
insert into public.market_decisions (key, source, court, party, airline_iata, day, instance, result, moral_cents, per_claimant, problem)
select 'duvida-' || n, 'fake', 'TJGO', 'Azul', 'AD', current_date - 30, 'first', v.result, v.moral, v.per_claimant, 'delay'
from (
  select n, 'procedente' as result, (case when n <= 12 then 200000 else 400000 end)::bigint as moral, false as per_claimant
  from generate_series(1, 24) n
  union all select 25, 'procedente', 5000000, true
  union all select n, 'improcedente', null, false from generate_series(26, 33) n
) v;
insert into public.market_decisions (key, source, court, party, airline_iata, day, instance, result, moral_cents, problem) values
  ('duvida-recurso', 'fake', 'TJGO', 'Azul', 'AD', current_date - 30, 'appeal', 'improcedente', null, 'delay'),
  ('duvida-antiga', 'fake', 'TJGO', 'Azul', 'AD', current_date - interval '30 months', 'first', 'improcedente', null, 'delay');
insert into public.market_decisions (key, source, court, party, airline_iata, day, instance, result, moral_cents, problem)
select 'duvida-gol-' || n, 'fake', 'TJGO', 'Gol', 'G3', current_date - 40, 'first',
       case when n <= 3 then 'procedente' else 'improcedente' end, case when n <= 3 then 300000 end, 'delay'
from generate_series(1, 6) n;
insert into public.market_decisions (key, source, court, party, airline_iata, day, instance, result, moral_cents, problem)
select 'duvida-embarque-' || n, 'fake', 'TJGO', 'Gol', 'G3', current_date - 50, 'first', 'procedente', 500000, 'overbooking'
from generate_series(1, 6) n;

create temp table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values
  ('azul', public.market_forecast('delay', 'ad')),
  ('gol', public.market_forecast('delay', 'G3')),
  ('embarque', public.market_forecast('overbooking')),
  ('bagagem', coalesce(public.market_forecast('baggage'), 'null'::jsonb)),
  ('tribunal', public.market_forecast('delay', null, 'tjgo'));
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select jsonb_build_object('level', payload #>> '{cut,level}', 'airline', payload #>> '{cut,airline}',
                             'merits', payload -> 'merits', 'won', payload -> 'won', 'chance', payload -> 'chance_percent',
                             'base', payload ->> 'base', 'courts', payload -> 'courts')
   from res where name = 'azul'),
  '{"level": "all", "airline": "AD", "merits": 33, "won": 25, "chance": 76, "base": "media", "courts": ["TJGO"]}'::jsonb,
  'a delay with Azul has its own cut, with the chance and where the decisions were read (an appeal and an old one left out)');
select is(
  (select payload -> 'moral' from res where name = 'azul'),
  '{"n": 24, "p25_cents": 200000, "median_cents": 300000, "p75_cents": 400000}'::jsonb,
  'the moral damages'' median, a value per claimant left out');
select ok(
  (select payload #>> '{cut,airline}' is null and (payload ->> 'merits')::integer = 39 from res where name = 'gol'),
  'a delay with Gol, of too few decisions, takes every airline''s');
select ok(
  (select payload ->> 'base' = 'pequena' and (payload ->> 'merits')::integer = 6 and (payload ->> 'chance_percent')::integer = 100
          and (payload #>> '{moral,median_cents}')::bigint = 500000
   from res where name = 'embarque'),
  'a problem of few decisions has the broadest cut, said as a small base');
select is((select payload from res where name = 'bagagem'), 'null'::jsonb, 'a problem with no decisions has no forecast');
select ok(
  (select payload #>> '{cut,level}' = 'court' and payload #>> '{cut,court}' = 'TJGO' and (payload ->> 'merits')::integer = 39
   from res where name = 'tribunal'),
  'with the court asked, the court''s cut');

select ok(
  (select count(*) = 1
          and bool_and((output_schema -> 'properties') ? 'pergunta' and (output_schema -> 'required') ? 'pergunta'
                       and system_prompt like '%- pergunta: a pergunta, a dúvida ou a objeção%')
   from public.prompt_versions where task = 'atendimento.entrada' and is_active),
  'the intake reads the question the contact asked');
select ok(
  exists (select 1 from public.ai_tasks where slug = 'atendimento.duvida' and is_active and autonomy = 'autonomous')
  and (select count(*) = 1 and bool_and(system_prompt like '%Lei 9.099/1995, art. 55%' and system_prompt like '%Nunca prometa%')
       from public.prompt_versions where task = 'atendimento.duvida' and is_active)
  and (select 'atendimento.duvida' = any (version_tasks) from public.product_modules where key = 'direito-do-passageiro'),
  'the task that answers it is the passenger module''s, with what the law says of costs and no promise');
select ok(
  -- The versions in force, which a later migration may raise and publish again (0272).
  (select (v.manifest #>> '{prompts,atendimento.duvida}')::integer
              = (select w.version from public.prompt_versions w where w.task = 'atendimento.duvida' and w.is_active)
          and (v.manifest #>> '{prompts,atendimento.entrada}')::integer
              = (select w.version from public.prompt_versions w where w.task = 'atendimento.entrada' and w.is_active)
   from public.module_versions v
   where v.module = 'direito-do-passageiro' and v.status = 'published' order by v.version desc limit 1),
  'both published in the module''s new version');

-- Nobody of either firm calls it.
select set_config('request.jwt.claims', '{"sub":"a2490000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(
  not has_function_privilege('authenticated', 'public.market_forecast(text, text, text, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.market_forecast(text, text, text, text, text)', 'EXECUTE'),
  'only the backend reads the forecast, for either firm');
reset role;

select * from finish();
rollback;
