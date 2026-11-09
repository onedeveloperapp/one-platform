begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- The list of cases in the screen pattern of phase 0 (0108): the order the
-- person chooses, the list's own filters (the kind of problem and the
-- airline, which narrow every count), the views of the month (opened,
-- filed, ended) and the numbers of the cards, each beside what it was in
-- the same days of the month before. Two firms: A, whose cases are dated
-- this month, in the same days of the month before and earlier; B, with
-- one case of today, which A's numbers never count.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1090000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-barra.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1090000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-barra.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1090000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-barra', 'a1090000-0000-4000-8000-000000000001'),
  ('b1090000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-barra', 'a1090000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1090000-0000-4000-8000-00000000000a', 'a1090000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1090000-0000-4000-8000-00000000000b', 'a1090000-0000-4000-8000-000000000002', 'owner', 'socio');

-- The month in the days of Brasília, as the function reads it.
create temp table moments as
select
  (date_trunc('month', now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo' as month_from,
  ((date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month')::date)::timestamp at time zone 'America/Sao_Paulo' as prev_from,
  (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month')::date as prev_start,
  (now() at time zone 'America/Sao_Paulo')::date as today;

-- A's cases:
--   1  opened now, with the client             (going; opened this month)
--   2  opened in the days of the month before, its lawsuit filed today
--                                              (going, then and now; opened then; filed this month)
--   3  opened long ago, ended now              (going then; ended this month)
--   4  opened long ago, declined in the days of the month before
--                                              (ended then)
--   5  opened long ago, its lawsuit filed on the first of the month before
--                                              (going, then and now; filed then)
insert into public.cases (id, org_id, seq, module, incident, airline_iata, status, created_at, updated_at, closed_at)
select v.id, 'b1090000-0000-4000-8000-00000000000a', v.seq, 'direito-do-passageiro', v.incident, v.airline, v.status,
       v.created_at, v.updated_at, v.closed_at
from moments m, lateral (values
  ('c1090000-0000-4000-8000-000000000001'::uuid, 1, 'delay', 'LA', 'intake', now(), now(), null::timestamptz),
  ('c1090000-0000-4000-8000-000000000002'::uuid, 2, 'cancellation', 'G3', 'filed', m.prev_from + interval '1 hour',
   now() - interval '1 day', null),
  ('c1090000-0000-4000-8000-000000000003'::uuid, 3, 'delay', 'LA', 'closed', m.prev_from - interval '10 days',
   now() - interval '3 days', now()),
  ('c1090000-0000-4000-8000-000000000004'::uuid, 4, 'delay', 'LA', 'declined', m.prev_from - interval '20 days',
   now() - interval '4 days', m.prev_from + interval '1 hour'),
  ('c1090000-0000-4000-8000-000000000005'::uuid, 5, 'cancellation', 'AD', 'filed', m.prev_from - interval '30 days',
   now() - interval '2 days', null)
) as v (id, seq, incident, airline, status, created_at, updated_at, closed_at);
insert into public.proceedings (id, org_id, case_id, kind, court, cnj, status, filed_at)
select v.id, 'b1090000-0000-4000-8000-00000000000a', v.case_id, 'juizado', 'TJGO', v.cnj, 'filed', v.filed_at
from moments m, lateral (values
  ('e1090000-0000-4000-8000-000000000002'::uuid, 'c1090000-0000-4000-8000-000000000002'::uuid, '50002023920998090051', m.today),
  ('e1090000-0000-4000-8000-000000000005'::uuid, 'c1090000-0000-4000-8000-000000000005'::uuid, '50003037620998090051', m.prev_start)
) as v (id, case_id, cnj, filed_at);

-- B: one case of today.
insert into public.cases (id, org_id, seq, module, incident, airline_iata, status) values
  ('c1090000-0000-4000-8000-00000000000b', 'b1090000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'LA', 'intake');

-- The updated_at of the cases as written above: what touched them as the lawsuits went in is undone, with the
-- trigger that writes the moment of a change held for this one statement.
alter table public.cases disable trigger cases_updated_at;
update public.cases c set updated_at = v.updated_at
from (values
  ('c1090000-0000-4000-8000-000000000001'::uuid, now()),
  ('c1090000-0000-4000-8000-000000000002'::uuid, now() - interval '1 day'),
  ('c1090000-0000-4000-8000-000000000005'::uuid, now() - interval '2 days')
) as v (id, updated_at)
where c.id = v.id;
alter table public.cases enable trigger cases_updated_at;

create temp table res (name text primary key, payload jsonb);
grant all on res to authenticated;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.seqs(name text) returns text language sql as
$$ select string_agg((r ->> 'seq'), ',' order by ord) from res, jsonb_array_elements(payload -> 'rows') with ordinality as x (r, ord)
   where res.name = seqs.name; $$;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

select pg_temp.sign_in('a1090000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('all', public.firm_cases('b1090000-0000-4000-8000-00000000000a'));
insert into res values ('oldest', public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, 'oldest'));
insert into res values ('newest', public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, 'newest'));
insert into res values ('first', public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, 'first'));
insert into res values ('new', public.firm_cases('b1090000-0000-4000-8000-00000000000a', 'novos-mes'));
insert into res values ('filed', public.firm_cases('b1090000-0000-4000-8000-00000000000a', 'ajuizados-mes'));
insert into res values ('ended', public.firm_cases('b1090000-0000-4000-8000-00000000000a', 'encerrados-mes'));
insert into res values ('delay', public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, null, 'delay'));
insert into res values ('gol', public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, null, null, 'g3'));
reset role;

select is(
  pg_temp.seqs('all'), '1,2,5',
  'with no choice, the cases still going come with the latest change first, as before'
);

select ok(
  pg_temp.seqs('oldest') = '5,2,1' and pg_temp.seqs('newest') = '5,2,1' and pg_temp.seqs('first') = '1,2,5',
  'the order the person chooses: the oldest change, the newest case, the oldest case'
);

select ok(
  pg_temp.seqs('new') = '1' and pg_temp.got('new', '{total}') = '1',
  'the cases opened this month, in the days of Brasília'
);

select ok(
  pg_temp.seqs('filed') = '2' and pg_temp.got('filed', '{total}') = '1',
  'the cases with a lawsuit filed this month, never one filed the month before'
);

select ok(
  pg_temp.seqs('ended') = '3' and pg_temp.got('ended', '{total}') = '1',
  'the cases ended this month, never one ended the month before'
);

select ok(
  pg_temp.got('all', '{counts,novos-mes}') = '1'
    and pg_temp.got('all', '{counts,ajuizados-mes}') = '1'
    and pg_temp.got('all', '{counts,encerrados-mes}') = '1',
  'each view of the month is counted as its list shows it'
);

select ok(
  pg_temp.got('all', '{numbers,going}') = '3'
    and pg_temp.got('all', '{numbers,going_before}') = '3',
  'the cases going now, and the ones going at the end of the same day of the month before'
);

select ok(
  pg_temp.got('all', '{numbers,new}') = '1' and pg_temp.got('all', '{numbers,new_before}') = '1'
    and pg_temp.got('all', '{numbers,filed}') = '1' and pg_temp.got('all', '{numbers,filed_before}') = '1'
    and pg_temp.got('all', '{numbers,ended}') = '1' and pg_temp.got('all', '{numbers,ended_before}') = '1',
  'opened, filed and ended this month, each beside the same days of the month before'
);

select ok(
  pg_temp.got('all', '{numbers,since}') = (select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date::text)
    and pg_temp.got('all', '{numbers,before_since}') = (select prev_start::text from moments)
    and (pg_temp.got('all', '{numbers,before_until}'))::date
          between (select prev_start from moments)
          and (select (date_trunc('month', now() at time zone 'America/Sao_Paulo')::date - 1))
    and pg_temp.got('all', '{numbers,until}') = (select today::text from moments),
  'the numbers say the days they compare: this month so far and the same days of the month before'
);

select ok(
  pg_temp.seqs('delay') = '1' and pg_temp.got('delay', '{counts,going}') = '1'
    and pg_temp.got('delay', '{counts,all}') = '3' and pg_temp.got('delay', '{numbers,going}') = '1',
  'the kind of problem narrows the list, its counts and its numbers'
);

select ok(
  pg_temp.seqs('gol') = '2' and pg_temp.got('gol', '{counts,going}') = '1' and pg_temp.got('gol', '{numbers,filed}') = '1',
  'the airline narrows them too, however its code is typed'
);

select pg_temp.sign_in('a1090000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, 'alfabetica') $$,
  '22023', 'invalid_sort',
  'an order the list does not have is refused, never read as the usual one'
);
select throws_ok(
  $$ select public.firm_cases('b1090000-0000-4000-8000-00000000000a', null, null, 25, 0, null, null, null, 'Gol Linhas') $$,
  '22023', 'invalid_filter',
  'an airline that is no code is refused'
);
reset role;

select pg_temp.sign_in('a1090000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_cases('b1090000-0000-4000-8000-00000000000a', 'novos-mes') $$,
  '42501', null,
  'somebody of another firm reads nothing of the firm''s cases'
);
insert into res values ('b_all', public.firm_cases('b1090000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('b_all', '{numbers,new}') = '1' and pg_temp.got('b_all', '{numbers,going}') = '1',
  'each firm counts its own cases only'
);

select ok(
  has_function_privilege('authenticated', 'public.firm_cases(uuid, text, text, integer, integer, text, text, text, text, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.firm_cases(uuid, text, text, integer, integer, text, text, text, text, boolean)', 'execute')
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'firm_cases' and p.pronargs <> 10
    ),
  'one list of cases, read by the firm''s people and never by a visitor'
);

select * from finish();
rollback;
