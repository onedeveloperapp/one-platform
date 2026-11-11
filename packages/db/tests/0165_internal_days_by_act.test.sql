begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The internal deadline by kind of act (0167). Ana, a partner of Lima, gives
-- an act of the list its own internal days; Duda, of the controladoria, takes
-- them off again; Caio, a lawyer, may not; an act that is not of the list, and
-- days out of range, are refused; the agenda hands the acts' days out beside
-- the firm's. Rocha's are its own.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1650000-0000-4000-8000-000000000001', 'ana@lima-ato.invalid', 'Ana Lima'),
  ('a1650000-0000-4000-8000-000000000002', 'caio@lima-ato.invalid', 'Caio Lima'),
  ('a1650000-0000-4000-8000-000000000004', 'duda@lima-ato.invalid', 'Duda Lima'),
  ('a1650000-0000-4000-8000-000000000009', 'edu@rocha-ato.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1650000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-ato', 'a1650000-0000-4000-8000-000000000001'),
  ('b1650000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-ato', 'a1650000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1650000-0000-4000-8000-00000000000a', 'a1650000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1650000-0000-4000-8000-00000000000a', 'a1650000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1650000-0000-4000-8000-00000000000a', 'a1650000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1650000-0000-4000-8000-00000000000b', 'a1650000-0000-4000-8000-000000000009', 'owner', 'socio');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;
create temp table act as select slug from public.deadline_acts where active order by position limit 1;
grant select on act to authenticated;

select pg_temp.as_person('a1650000-0000-4000-8000-000000000001', 'ana',
  format($$public.set_internal_deadline_days_for_act('b1650000-0000-4000-8000-00000000000a', %L, 5)$$, (select slug from act)));
select ok(
  pg_temp.got('ana', '{ok}') = 'true'
    and (select (internal_deadline_by_act ->> (select slug from act))::integer = 5 and internal_deadline_days = 2
         from public.organizations where id = 'b1650000-0000-4000-8000-00000000000a'),
  'a partner gives an act its own internal days, the firm''s days staying for the rest'
);

select pg_temp.as_person('a1650000-0000-4000-8000-000000000002', 'caio',
  format($$public.set_internal_deadline_days_for_act('b1650000-0000-4000-8000-00000000000a', %L, 1)$$, (select slug from act)));
select pg_temp.as_person('a1650000-0000-4000-8000-000000000001', 'no-act',
  $$public.set_internal_deadline_days_for_act('b1650000-0000-4000-8000-00000000000a', 'ato_que_nao_existe', 3)$$);
select pg_temp.as_person('a1650000-0000-4000-8000-000000000001', 'too-many',
  format($$public.set_internal_deadline_days_for_act('b1650000-0000-4000-8000-00000000000a', %L, 30)$$, (select slug from act)));
select ok(
  pg_temp.got('caio', '{code}') = 'not_allowed' and pg_temp.got('no-act', '{field}') = 'act'
    and pg_temp.got('too-many', '{field}') = 'days',
  'a lawyer sets none, an act not of the list and days out of range are refused'
);

select pg_temp.as_person('a1650000-0000-4000-8000-000000000004', 'agenda',
  $$public.firm_agenda('b1650000-0000-4000-8000-00000000000a', current_date, current_date)$$);
select is(
  (select value -> 'internal_by_act' ->> (select slug from act) from res where key = 'agenda'),
  '5', 'the agenda hands the act''s days out beside the firm''s'
);

select pg_temp.as_person('a1650000-0000-4000-8000-000000000004', 'off',
  format($$public.set_internal_deadline_days_for_act('b1650000-0000-4000-8000-00000000000a', %L, null)$$, (select slug from act)));
select ok(
  pg_temp.got('off', '{ok}') = 'true'
    and (select internal_deadline_by_act = '{}'::jsonb from public.organizations where id = 'b1650000-0000-4000-8000-00000000000a')
    and exists (select 1 from public.audit_events where action = 'agenda.internal_days_act_set'
                and org_id = 'b1650000-0000-4000-8000-00000000000a'),
  'the controladoria takes them off, the firm''s days holding for the act again, on the record'
);

select is(
  (select internal_deadline_by_act from public.organizations where id = 'b1650000-0000-4000-8000-00000000000b'),
  '{}'::jsonb, 'another firm''s acts keep the firm''s own days'
);

select * from finish();
rollback;
