begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The term to pay a condemnation, by the kind of lawsuit (0214): the
-- lawsuits owed a computation say their kind and where they run; ONE keeps
-- the kind, read from the lawsuit, and the last day of the term it counted
-- in the small-claims court (none in the civil court, where the term runs
-- from the intimation the request asks); the backend reads the court's
-- calendar. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2140000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-pagar.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2140000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-pagar.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2140000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-pagar', 'a2140000-0000-4000-8000-000000000001'),
  ('b2140000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-pagar', 'a2140000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2140000-0000-4000-8000-00000000000a', 'a2140000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2140000-0000-4000-8000-00000000000b', 'a2140000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2140000-0000-4000-8000-000000000001', 'b2140000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2140000-0000-4000-8000-000000000002', 'b2140000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, system, comarca, status, cnj, filed_at) values
  ('f2140000-0000-4000-8000-000000000001', 'b2140000-0000-4000-8000-00000000000a', 'c2140000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'projudi', 'Goiânia', 'filed', '10003012720998090100', '2025-08-01'),
  ('f2140000-0000-4000-8000-000000000002', 'b2140000-0000-4000-8000-00000000000a', 'c2140000-0000-4000-8000-000000000002',
   'comum', 'TJGO', 'projudi', 'Goiânia', 'filed', '00051016820998090051', '2025-08-01');
-- Both won and became final.
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b2140000-0000-4000-8000-00000000000a', 'c2140000-0000-4000-8000-000000000001', 'f2140000-0000-4000-8000-000000000001',
   'sentenca', 'procedente', 500000, date '2025-09-20', 'person'),
  ('b2140000-0000-4000-8000-00000000000a', 'c2140000-0000-4000-8000-000000000002', 'f2140000-0000-4000-8000-000000000002',
   'sentenca', 'parcial', 300000, date '2025-09-20', 'person');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, happened_on, source) values
  ('b2140000-0000-4000-8000-00000000000a', 'c2140000-0000-4000-8000-000000000001', 'f2140000-0000-4000-8000-000000000001',
   'transito', date '2025-11-03', 'person'),
  ('b2140000-0000-4000-8000-00000000000a', 'c2140000-0000-4000-8000-000000000002', 'f2140000-0000-4000-8000-000000000002',
   'transito', date '2025-11-03', 'person');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.amount(lawsuit uuid, fact uuid, step text, fine bigint, until text) returns jsonb language sql as $$
  select jsonb_build_object(
    'judgment_fact_id', fact, 'rule', 'atualizacao-v1', 'principal_cents', 500000, 'correction_from', '2025-09-20',
    'interest_from', '2025-08-01', 'as_of', current_date, 'corrected_cents', 510000, 'interest_cents', 20000,
    'total_cents', 530000, 'missing', '[]'::jsonb, 'needs_terms', false, 'deposited_cents', 0, 'next_step', step,
    'fine_cents', fine, 'pay_until', until);
$$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res select 'owed', coalesce(jsonb_agg(to_jsonb(o) order by o.proceeding_id), '[]') from public.lawsuit_amounts_owed(20) o;
insert into res values ('jec', public.record_lawsuit_amount('f2140000-0000-4000-8000-000000000001', pg_temp.amount(
  'f2140000-0000-4000-8000-000000000001',
  (select f.id from public.lawsuit_facts f where f.proceeding_id = 'f2140000-0000-4000-8000-000000000001' and f.kind = 'sentenca'),
  'cumprimento', 53000, '2025-11-24')));
insert into res values ('civel', public.record_lawsuit_amount('f2140000-0000-4000-8000-000000000002', pg_temp.amount(
  'f2140000-0000-4000-8000-000000000002',
  (select f.id from public.lawsuit_facts f where f.proceeding_id = 'f2140000-0000-4000-8000-000000000002' and f.kind = 'sentenca'),
  'cumprimento', 0, '2025-11-24')));
insert into res values ('calendar', public.court_calendar('TJGO', 2025));
reset role;

select ok(
  (select jsonb_array_length(payload) = 2
          and payload -> 0 ->> 'kind' = 'juizado' and payload -> 1 ->> 'kind' = 'comum'
          and payload -> 0 ->> 'court' = 'TJGO' and payload -> 0 ->> 'system' = 'projudi'
          and payload -> 0 ->> 'comarca' = 'Goiânia' and payload -> 0 ->> 'final_on' = '2025-11-03'
   from res where name = 'owed'),
  'the lawsuits owed a computation say their kind and where they run'
);

select ok(
  (select payload ->> 'code' from res where name = 'jec') = 'recorded'
  and (select lawsuit_kind = 'juizado' and pay_until = date '2025-11-24' and fine_cents = 53000
       from public.lawsuit_amounts where proceeding_id = 'f2140000-0000-4000-8000-000000000001'),
  'in the small-claims court ONE keeps the last day of the term it counted, with the fine past it'
);

select ok(
  (select payload ->> 'code' from res where name = 'civel') = 'recorded'
  and (select lawsuit_kind = 'comum' and pay_until is null and fine_cents = 0 and next_step = 'cumprimento'
       from public.lawsuit_amounts where proceeding_id = 'f2140000-0000-4000-8000-000000000002'),
  'in the civil court the next step is the request, with no last day kept: the term runs from its intimation'
);

select ok(
  (select payload ? 'years' and payload ? 'days_off' from res where name = 'calendar')
  and has_function_privilege('service_role', 'public.court_calendar(text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lawsuit_amounts_owed(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_lawsuit_amount(uuid, jsonb)', 'EXECUTE'),
  'the backend reads the court''s calendar, and nobody of a firm lists or records an amount'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2140000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.lawsuit_amounts), 0, 'another firm reads no amount of this one');
reset role;

select * from finish();
rollback;
