begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The board of the controladoria by step (0112): `firm_case_board`, a
-- column per step with its cases, the longest at the step first, by the
-- rule of the top of the case (`case_standing`, 0111). Two firms: A with
-- cases at the first contact and in court; B with one of its own.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1130000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-quadro.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1130000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-quadro.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1130000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-quadro', 'a1130000-0000-4000-8000-000000000001'),
  ('b1130000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-quadro', 'a1130000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1130000-0000-4000-8000-00000000000a', 'a1130000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1130000-0000-4000-8000-00000000000b', 'a1130000-0000-4000-8000-000000000002', 'owner', 'socio');

-- A's cases:
--   1 at its first step for 20 days (the limit is 7): stagnant;
--   2 and 3 at their first step for 3 days, the same day: the older case first;
--   4 in court, filed 40 days ago: at the hearing;
--   5 ended: on no board.
insert into public.cases (id, org_id, seq, module, incident, status, status_changed_at, created_at, closed_at)
values
  ('c1130000-0000-4000-8000-000000000001', 'b1130000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay',
   'intake', now() - interval '20 days', now() - interval '20 days', null),
  ('c1130000-0000-4000-8000-000000000002', 'b1130000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay',
   'intake', now() - interval '3 days', now() - interval '3 days', null),
  ('c1130000-0000-4000-8000-000000000003', 'b1130000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay',
   'intake', now() - interval '3 days', now() - interval '3 days', null),
  ('c1130000-0000-4000-8000-000000000004', 'b1130000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'delay',
   'filed', now() - interval '2 days', now() - interval '60 days', null),
  ('c1130000-0000-4000-8000-000000000005', 'b1130000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay',
   'closed', now(), now(), now()),
  ('c1130000-0000-4000-8000-000000000006', 'b1130000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay',
   'intake', now(), now(), null);

insert into public.people (id, org_id, full_name) values
  ('d1130000-0000-4000-8000-000000000001', 'b1130000-0000-4000-8000-00000000000a', 'Lia Teste'),
  ('d1130000-0000-4000-8000-000000000006', 'b1130000-0000-4000-8000-00000000000b', 'Lia Teste');
insert into public.case_parties (id, case_id, org_id, person_id, role) values
  ('e1130000-0000-4000-8000-000000000001', 'c1130000-0000-4000-8000-000000000001', 'b1130000-0000-4000-8000-00000000000a',
   'd1130000-0000-4000-8000-000000000001', 'claimant'),
  ('e1130000-0000-4000-8000-000000000006', 'c1130000-0000-4000-8000-000000000006', 'b1130000-0000-4000-8000-00000000000b',
   'd1130000-0000-4000-8000-000000000006', 'claimant');

-- Case 4's lawsuit, filed 40 days ago.
insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at) values
  ('b1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000000004', 'juizado', 'TJGO', 'filed',
   '00051016820998090051', current_date - 40);

-- No case owes ONE a look.
update public.case_advances set woken_at = null, checked_at = now(), claimed_at = null;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
-- Who has each case as the rule says it, read as the backend before anybody signs in.
create temporary table rule as
select s.case_id, s.holder, s.why from public.case_standing('b1130000-0000-4000-8000-00000000000a') s;
grant select on rule to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.column_of(name text, step text) returns jsonb language sql as
$$ select c from res, jsonb_array_elements(res.payload -> 'columns') c where res.name = column_of.name and c ->> 'step' = column_of.step; $$;
create function pg_temp.seqs(name text, step text) returns jsonb language sql as
$$ select coalesce(jsonb_agg((i ->> 'seq')::int), '[]'::jsonb) from jsonb_array_elements(pg_temp.column_of(name, step) -> 'items') i; $$;

select pg_temp.sign_in('a1130000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('all', public.firm_case_board('b1130000-0000-4000-8000-00000000000a'));
insert into res values ('two', public.firm_case_board('b1130000-0000-4000-8000-00000000000a', null, null, 0, 2));
insert into res values ('more', public.firm_case_board('b1130000-0000-4000-8000-00000000000a', null, 'intake', 2, 2));
reset role;

select is(
  (select jsonb_agg(c ->> 'step' order by c ->> 'step') from res, jsonb_array_elements(payload -> 'columns') c where name = 'all'),
  '["hearing", "intake"]'::jsonb,
  'a column for each step a case going is at, and none for a case that ended'
);
select ok(
  (pg_temp.column_of('all', 'intake') ->> 'cases')::int = 3 and (pg_temp.column_of('all', 'intake') ->> 'stagnant')::int = 1
    and (pg_temp.column_of('all', 'intake') ->> 'limit')::int = 7,
  'each column says how many cases are at its step, how many stagnated and its limit'
);
select is(pg_temp.seqs('all', 'intake'), '[1, 2, 3]'::jsonb, 'the longest at the step first, then the oldest case');
select ok(
  (select i ->> 'client' = 'Lia Teste' and (i ->> 'days')::int = 20 and (i ->> 'stagnant')::boolean
   from jsonb_array_elements(pg_temp.column_of('all', 'intake') -> 'items') i where (i ->> 'seq')::int = 1),
  'each case with its client, its days at the step and whether it stagnated'
);
select ok(
  not exists (
    select 1
    from res, jsonb_array_elements(payload -> 'columns') c, jsonb_array_elements(c -> 'items') i
    join rule r on r.case_id = (i ->> 'id')::uuid
    where name = 'all' and (r.holder is distinct from i ->> 'holder' or r.why is distinct from i ->> 'why')
  ) and (select count(*) from res, jsonb_array_elements(payload -> 'columns') c, jsonb_array_elements(c -> 'items') i
         where name = 'all') = 4,
  'and who has it and why, as the rule of the top of the case says'
);
select ok(
  pg_temp.seqs('two', 'intake') = '[1, 2]'::jsonb and (pg_temp.column_of('two', 'intake') ->> 'cases')::int = 3,
  'a column shows its first cases and still counts them all'
);
select ok(
  pg_temp.seqs('more', 'intake') = '[3]'::jsonb
    and (select jsonb_array_length(payload -> 'columns') from res where name = 'more') = 1,
  'and gives the next ones of one column when asked'
);

-- The limits are the platform's setting.
update public.platform_settings
set value = jsonb_set(value, '{stagnant_days,intake}', '30'::jsonb) where key = 'controladoria';
select pg_temp.sign_in('a1130000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select (c ->> 'stagnant')::int
   from jsonb_array_elements(public.firm_case_board('b1130000-0000-4000-8000-00000000000a') -> 'columns') c
   where c ->> 'step' = 'intake'),
  0,
  'the limits are data'
);
reset role;

select pg_temp.sign_in('a1130000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_case_board('b1130000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'nobody of another firm reads a firm''s board'
);
reset role;

select * from finish();
rollback;
