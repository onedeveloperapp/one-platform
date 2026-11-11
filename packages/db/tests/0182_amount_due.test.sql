begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- What a condemnation is worth (0184): a lawsuit whose judgment condemned
-- the airline and became final is owed a computation; ONE records it with
-- the next step, told in the timeline when it changes; a deposit makes it
-- owed again. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1820000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-valor.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1820000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-valor.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1820000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-valor', 'a1820000-0000-4000-8000-000000000001'),
  ('b1820000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-valor', 'a1820000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1820000-0000-4000-8000-00000000000a', 'a1820000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1820000-0000-4000-8000-00000000000b', 'a1820000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1820000-0000-4000-8000-000000000001', 'b1820000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1820000-0000-4000-8000-000000000002', 'b1820000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1820000-0000-4000-8000-000000000001', 'b1820000-0000-4000-8000-00000000000a', 'c1820000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2025-08-01'),
  ('f1820000-0000-4000-8000-000000000002', 'b1820000-0000-4000-8000-00000000000a', 'c1820000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '00051016820998090051', '2025-08-01');
-- The first won and became final; the second only won.
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b1820000-0000-4000-8000-00000000000a', 'c1820000-0000-4000-8000-000000000001', 'f1820000-0000-4000-8000-000000000001',
   'sentenca', 'procedente', 500000, date '2025-09-20', 'person'),
  ('b1820000-0000-4000-8000-00000000000a', 'c1820000-0000-4000-8000-000000000002', 'f1820000-0000-4000-8000-000000000002',
   'sentenca', 'parcial', 300000, date '2025-09-20', 'person');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, happened_on, source) values
  ('b1820000-0000-4000-8000-00000000000a', 'c1820000-0000-4000-8000-000000000001', 'f1820000-0000-4000-8000-000000000001',
   'transito', date '2025-11-01', 'person');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res select 'owed', coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.lawsuit_amounts_owed(20) o;
insert into res values ('recorded', public.record_lawsuit_amount('f1820000-0000-4000-8000-000000000001', jsonb_build_object(
  'judgment_fact_id', (select payload -> 0 ->> 'judgment_fact_id' from res where name = 'owed'),
  'rule', 'atualizacao-v1', 'principal_cents', 500000, 'correction_from', '2025-09-20', 'interest_from', '2025-08-01',
  'as_of', current_date, 'corrected_cents', 510000, 'interest_cents', 20000, 'total_cents', 530000, 'missing', '[]'::jsonb,
  'needs_terms', false, 'deposited_cents', 0, 'next_step', 'cumprimento', 'fine_cents', 53000)));
insert into res values ('bad', public.record_lawsuit_amount('f1820000-0000-4000-8000-000000000001',
  '{"rule": "atualizacao-v1", "next_step": "guess"}'::jsonb));
insert into res select 'owed_after', coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.lawsuit_amounts_owed(20) o;
reset role;

select ok(
  (select jsonb_array_length(payload) = 1
          and payload -> 0 ->> 'proceeding_id' = 'f1820000-0000-4000-8000-000000000001'
          and payload -> 0 ->> 'principal_cents' = '500000'
          and payload -> 0 ->> 'interest_from' = '2025-08-01'
   from res where name = 'owed'),
  'a judgment that condemned the airline and became final is owed a computation, its interest from the filing'
);

select ok(
  (select payload ->> 'code' from res where name = 'recorded') = 'recorded'
  and (select payload ->> 'code' from res where name = 'bad') = 'invalid_data'
  and (select jsonb_array_length(payload) = 0 from res where name = 'owed_after')
  and (select next_step = 'cumprimento' and fine_cents = 53000 from public.lawsuit_amounts
       where proceeding_id = 'f1820000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e where e.case_id = 'c1820000-0000-4000-8000-000000000001'
              and e.kind = 'amount_step' and e.actor_type = 'system'),
  'ONE records the amount and its next step, told in the timeline, and it is owed no more today'
);

-- A deposit makes it owed again.
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, cents, happened_on, source) values
  ('b1820000-0000-4000-8000-00000000000a', 'c1820000-0000-4000-8000-000000000001', 'f1820000-0000-4000-8000-000000000001',
   'deposito', 450000, current_date, 'person');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res select 'owed_deposit', coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.lawsuit_amounts_owed(20) o;
reset role;
select ok(
  (select payload -> 0 ->> 'deposited_cents' = '450000' from res where name = 'owed_deposit'),
  'a deposit makes the amount owed again, with what was deposited'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1820000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.lawsuit_amounts), 0, 'another firm reads no amount of this one');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.lawsuit_amounts_owed(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_lawsuit_amount(uuid, jsonb)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.lawsuit_amounts', 'INSERT'),
  'only the backend computes and records the amount'
);

select * from finish();
rollback;
