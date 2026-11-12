begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- ONE marks the leg of the problem (0228). Ana's firm has a case of two legs and no leg marked: the backend
-- marks the late one, the timeline says ONE did, and a second mark of ONE changes nothing. Ana unmarks it and
-- marks the other: the leg is a person's, and ONE never overrides it. Caio's firm has a filed case with no leg
-- marked: ONE leaves it as it is. A member cannot call ONE's function, and nothing of one firm reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2280000-0000-4000-8000-000000000001', 'ana@souza-trecho.invalid', 'Ana Souza'),
  ('a2280000-0000-4000-8000-000000000002', 'caio@rocha-trecho.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2280000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-trecho', 'a2280000-0000-4000-8000-000000000001'),
  ('b2280000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-trecho', 'a2280000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2280000-0000-4000-8000-00000000000a', 'a2280000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2280000-0000-4000-8000-00000000000b', 'a2280000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2280000-0000-4000-8000-000000000001', 'b2280000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake'),
  ('c2280000-0000-4000-8000-000000000002', 'b2280000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.flight_segments (id, org_id, case_id, position, flight_number) values
  ('d2280000-0000-4000-8000-000000000001', 'b2280000-0000-4000-8000-00000000000a', 'c2280000-0000-4000-8000-000000000001', 1, 'G31456'),
  ('d2280000-0000-4000-8000-000000000002', 'b2280000-0000-4000-8000-00000000000a', 'c2280000-0000-4000-8000-000000000001', 2, 'G31802'),
  ('d2280000-0000-4000-8000-000000000003', 'b2280000-0000-4000-8000-00000000000b', 'c2280000-0000-4000-8000-000000000002', 1, 'AD4100');

create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

-- ---------- ONE marks the late leg ----------

select is(
  public.one_mark_problem_leg('c2280000-0000-4000-8000-000000000001', 'd2280000-0000-4000-8000-000000000002'),
  '{"ok": true, "marked": true}'::jsonb,
  'ONE marks the leg its rule found, on a case before the lawsuit with no leg marked'
);

select ok(
  (select affected and affected_by = 'one' from public.flight_segments where id = 'd2280000-0000-4000-8000-000000000002')
    and not (select affected from public.flight_segments where id = 'd2280000-0000-4000-8000-000000000001')
    and exists (select 1 from public.case_events where case_id = 'c2280000-0000-4000-8000-000000000001'
                  and kind = 'leg_marked_by_one' and actor_type = 'system' and data ->> 'flight' = 'G31802'),
  'the leg says ONE marked it, and the timeline tells it with the flight'
);

select is(
  public.one_mark_problem_leg('c2280000-0000-4000-8000-000000000001', 'd2280000-0000-4000-8000-000000000001'),
  '{"ok": true, "marked": false}'::jsonb,
  'a leg already marked stays: ONE marks nothing more'
);

-- ---------- A person's mark is the person's ----------

select pg_temp.sign_in('a2280000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_flight_segment('c2280000-0000-4000-8000-000000000001', 'd2280000-0000-4000-8000-000000000002',
  '{"affected": false}'::jsonb);
select public.save_flight_segment('c2280000-0000-4000-8000-000000000001', 'd2280000-0000-4000-8000-000000000001',
  '{"affected": true}'::jsonb);
reset role;

select ok(
  (select affected and affected_by = 'person' from public.flight_segments where id = 'd2280000-0000-4000-8000-000000000001')
    and (select not affected and affected_by is null from public.flight_segments where id = 'd2280000-0000-4000-8000-000000000002'),
  'a person who unmarks ONE''s leg and marks another makes the mark theirs'
);

select is(
  (public.one_mark_problem_leg('c2280000-0000-4000-8000-000000000001', 'd2280000-0000-4000-8000-000000000002')) ->> 'marked',
  'false',
  'ONE never overrides a person''s mark'
);

-- ---------- After the lawsuit, and the other firm ----------

select is(
  (public.one_mark_problem_leg('c2280000-0000-4000-8000-000000000002', 'd2280000-0000-4000-8000-000000000003')) ->> 'marked',
  'false',
  'a filed case keeps its legs as they are'
);

select ok(
  not (select affected from public.flight_segments where id = 'd2280000-0000-4000-8000-000000000003')
    and not exists (select 1 from public.case_events where case_id = 'c2280000-0000-4000-8000-000000000002'
                      and kind = 'leg_marked_by_one'),
  'nothing of Ana''s case reached Caio''s firm, and its filed case has no mark of ONE'
);

-- ---------- Only the backend calls it ----------

select pg_temp.sign_in('a2280000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.one_mark_problem_leg('c2280000-0000-4000-8000-000000000001', 'd2280000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'a member cannot call ONE''s mark'
);
reset role;

select * from finish();
rollback;
