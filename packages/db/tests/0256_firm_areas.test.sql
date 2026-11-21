begin;
create extension if not exists pgtap;
select plan(30);

-- ============================================================
-- The areas of a firm and how it works (0256). Each firm founded is given its module's area; who manages firm A
-- says its operation and its areas (one ONE knows, one it proposed, one of the firm's own, a name that is one ONE
-- knows), with the second factor; what is wrong is refused whole; an area left out is taken out, never the module's;
-- the plan's ceiling of areas holds; firm B neither reads nor writes A's. A case takes its module's area and never
-- another firm's; the backend reads whether ONE attends for each firm.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2560000-0000-4000-8000-000000000001', 'ana@souza-areas.invalid', 'Ana Souza'),
  ('a2560000-0000-4000-8000-000000000002', 'caio@rocha-areas.invalid', 'Caio Rocha'),
  ('a2560000-0000-4000-8000-000000000003', 'bia@souza-areas.invalid', 'Bia Lima')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2560000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-areas', 'a2560000-0000-4000-8000-000000000001'),
  ('b2560000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-areas', 'a2560000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2560000-0000-4000-8000-00000000000a', 'a2560000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2560000-0000-4000-8000-00000000000a', 'a2560000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b2560000-0000-4000-8000-00000000000b', 'a2560000-0000-4000-8000-000000000002', 'owner', 'socio');

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;

create temp table res (name text primary key, value jsonb);
grant select, insert on res to authenticated, service_role;

/** The active areas of a firm, by the area of law or the name. */
create function pg_temp.areas(firm uuid) returns text[] language sql as $$
  select coalesce(array_agg(coalesce(a.law_area, a.name) order by coalesce(a.law_area, a.name)), '{}')
  from public.firm_areas a where a.org_id = firm and a.removed_at is null;
$$;

-- ---------- What ONE knows, and what each firm is given ----------

select is((select count(*)::integer from public.law_areas), 12, 'ONE knows twelve areas of law');
select is(
  (select module from public.law_areas where key = 'passageiro'), 'direito-do-passageiro',
  'the passenger''s area is served by its module'
);
select is(pg_temp.areas('b2560000-0000-4000-8000-00000000000a'), array['passageiro'], 'firm A is given its module''s area');
select is(pg_temp.areas('b2560000-0000-4000-8000-00000000000b'), array['passageiro'], 'and so is firm B');
select is(
  (select source from public.firm_areas where org_id = 'b2560000-0000-4000-8000-00000000000a'), 'module',
  'as the module''s'
);

-- ---------- Who manages A says its operation ----------

set local role authenticated;
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000001');
insert into res values ('saved', public.save_firm_operation(
  'b2560000-0000-4000-8000-00000000000a',
  '{"states": ["go", "DF"], "channels": ["indicacao", "anuncio"], "monthly_cases": "ate_100",
    "hours_from": "08:00", "hours_to": "18:00", "saturdays": false, "previous_system": "planilha",
    "one_finance": true, "partners": false, "one_filing": true, "controladoria": false}',
  '[{"law_area": "familia", "source": "xray"}, {"name": "Direito  do agronegócio"}, {"name": "trabalhista"}]'
));
select is((select value ->> 'code' from res where name = 'saved'), 'saved', 'A''s operation is saved');
select is((select (value ->> 'areas')::integer from res where name = 'saved'), 4, 'with four areas');
select is(
  pg_temp.areas('b2560000-0000-4000-8000-00000000000a'),
  array['Direito do agronegócio', 'familia', 'passageiro', 'trabalhista'],
  'the module''s kept, one ONE proposed, one of the firm''s own, and a name that is one ONE knows taken as it'
);
select is(
  (select source from public.firm_areas where org_id = 'b2560000-0000-4000-8000-00000000000a' and law_area = 'familia'),
  'xray', 'the proposed one is said to be ONE''s proposal'
);
select is(
  (select array[array_to_string(states, ','), array_to_string(channels, ','), monthly_cases, previous_system,
                hours_from::text, one_finance::text]
   from public.firm_operations where org_id = 'b2560000-0000-4000-8000-00000000000a'),
  array['DF,GO', 'anuncio,indicacao', 'ate_100', 'planilha', '08:00:00', 'true'],
  'and how it works, as said'
);
select is(
  (select (public.firm_setup_facts('b2560000-0000-4000-8000-00000000000a') ->> 'operation')::boolean), true,
  'the setup''s facts say the operation was said'
);
reset role;
select is(
  (select count(*)::integer from public.audit_events
   where org_id = 'b2560000-0000-4000-8000-00000000000a' and action = 'firm.operation_saved'),
  1, 'on the record'
);
set local role authenticated;
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000001');

-- What is wrong is refused whole.
select is(
  public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{"states": ["XX"]}', '[{"law_area": "civel"}]') ->> 'code',
  'invalid_operation', 'a state that is none is refused'
);
select is(
  public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}', '[{"law_area": "civel"}, {"law_area": "astrologia"}]') ->> 'code',
  'unknown_area', 'an area ONE does not know by its key is refused'
);
select is(
  pg_temp.areas('b2560000-0000-4000-8000-00000000000a'),
  array['Direito do agronegócio', 'familia', 'passageiro', 'trabalhista'],
  'and nothing of a refused one was kept'
);
select is(
  public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}', '[]') ->> 'code',
  'no_areas', 'a firm says at least one area'
);

-- An area left out is taken out, never the module's.
select is(
  public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}', '[{"law_area": "trabalhista"}]') ->> 'areas',
  '2', 'the areas left out are taken out'
);
select is(
  pg_temp.areas('b2560000-0000-4000-8000-00000000000a'), array['passageiro', 'trabalhista'],
  'and the module''s stays'
);

-- The plan's ceiling.
reset role;
insert into public.entitlement_grants (org_id, kind, limits, source, note) values
  ('b2560000-0000-4000-8000-00000000000a', 'comp', '{"areas_max": 2}', 'admin', 'teste');
set local role authenticated;
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000001');
select is(
  public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}',
    '[{"law_area": "trabalhista"}, {"law_area": "previdenciario"}]') ->> 'code',
  'areas_limit', 'more areas than the plan allows are refused'
);
select is(
  pg_temp.areas('b2560000-0000-4000-8000-00000000000a'), array['passageiro', 'trabalhista'],
  'and nothing of them is kept'
);

-- The second factor, the role, the firm.
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000001', 'aal1');
select throws_ok(
  $$select public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}', '[{"law_area": "civel"}]')$$,
  '42501', 'second_factor_required', 'never without the second factor'
);
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}', '[{"law_area": "civel"}]')$$,
  '42501', 'not_authorized', 'never by a member who does not manage the firm'
);
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.save_firm_operation('b2560000-0000-4000-8000-00000000000a', '{}', '[{"law_area": "civel"}]')$$,
  '42501', 'not_authorized', 'never by firm B'
);
select is(
  (select count(*)::integer from public.firm_areas where org_id = 'b2560000-0000-4000-8000-00000000000a'), 0,
  'which reads none of A''s areas'
);
select is(
  (select count(*)::integer from public.firm_operations where org_id = 'b2560000-0000-4000-8000-00000000000a'), 0,
  'nor how A works'
);
reset role;

-- ---------- The area of a case ----------

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2560000-0000-4000-8000-000000000001', 'b2560000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake');
select is(
  (select a.law_area from public.cases c join public.firm_areas a on a.id = c.area_id
   where c.id = 'c2560000-0000-4000-8000-000000000001'),
  'passageiro', 'a case of the module takes its module''s area'
);
select throws_ok(
  $$update public.cases set area_id = (select id from public.firm_areas where org_id = 'b2560000-0000-4000-8000-00000000000b' limit 1)
    where id = 'c2560000-0000-4000-8000-000000000001'$$,
  '42501', 'area_of_another_firm', 'and never an area of another firm'
);

-- ---------- Whether ONE attends ----------

update public.organizations set attended_before_operation = true where id = 'b2560000-0000-4000-8000-00000000000b';
-- A's profile approved (0272): with its operation said, ONE attends for it.
insert into public.firm_personalities (org_id, version, profile, examples, status) values
  ('b2560000-0000-4000-8000-00000000000a', 1, '{"tratamento": "voce", "tom": "proximo", "tamanho": "curtas"}', '[]', 'approved');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select array[(f ->> 'attends'), (f ->> 'declared'), jsonb_array_length(f -> 'areas')::text, f -> 'modules' ->> 0]
   from public.firm_attendance('b2560000-0000-4000-8000-00000000000a') f),
  array['true', 'true', '2', 'direito-do-passageiro'],
  'ONE attends for A, which said its operation and approved its profile, with its areas and its module'
);
select is(
  (select array[(f ->> 'attends'), (f ->> 'declared')] from public.firm_attendance('b2560000-0000-4000-8000-00000000000b') f),
  array['true', 'false'],
  'and for B, attended before the setup asked its operation, which said none yet'
);
reset role;
set local role authenticated;
select pg_temp.sign_in('a2560000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.firm_attendance('b2560000-0000-4000-8000-00000000000a')$$, '42501', null,
  'whether ONE attends is read by the backend only'
);
reset role;

select * from finish();
rollback;
