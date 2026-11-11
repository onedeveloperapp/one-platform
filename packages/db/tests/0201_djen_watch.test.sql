begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The watch over the DJEN (0201). The backend looks at one court an hour,
-- in turn; a look keeps counts only. The DJEN that stopped answering is said
-- to the operator at once, and to a firm that reads the DJEN only past the
-- setting's day; a firm that reads nothing of it is told nothing. A court
-- whose links point to another system than the table's is a signal, for the
-- operator and for who approves a lawsuit's system there. Nobody of a firm
-- reads a look.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2010000-0000-4000-8000-000000000001', 'ana@lima-vigia.invalid', 'Ana Lima'),
  ('a2010000-0000-4000-8000-000000000002', 'edu@rocha-vigia.invalid', 'Edu Rocha'),
  ('a2010000-0000-4000-8000-000000000009', 'operador@vigia.invalid', 'Operador')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2010000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-vigia', 'a2010000-0000-4000-8000-000000000001'),
  ('b2010000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-vigia', 'a2010000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2010000-0000-4000-8000-00000000000a', 'a2010000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2010000-0000-4000-8000-00000000000b', 'a2010000-0000-4000-8000-000000000002', 'owner', 'socio');
-- Lima reads the DJEN for a registration; Rocha reads nothing of it.
insert into public.djen_captures (org_id, user_id, uf, number) values
  ('b2010000-0000-4000-8000-00000000000a', 'a2010000-0000-4000-8000-000000000001', 'GO', '12345');
update public.profiles set is_superadmin = true where id = 'a2010000-0000-4000-8000-000000000009';
delete from public.djen_probes;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

-- The first look: the court never looked at, the first by its name, on the last weekday.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'due', public.djen_probe_due();
insert into res select 'look', jsonb_build_object('id', public.record_djen_probe('TJGO', current_date - 1, 'ok', 820, 100, 2,
  '{"juizado": {"projudi": 60, "pje": 30, "invented": 5}, "comum": {"projudi": 8}, "other": {"x": 1}}'::jsonb));
insert into res select 'after', jsonb_build_object('due', public.djen_probe_due());
reset role;

select ok(
  pg_temp.got('due', '{court}') = (select min(acronym) from public.courts)
  and extract(isodow from pg_temp.got('due', '{day}')::date) between 1 and 5
  and pg_temp.got('after', '{due}') is null
  and (select systems = '{"juizado": {"projudi": 60, "pje": 30}, "comum": {"projudi": 8}}'::jsonb
       from public.djen_probes where id = pg_temp.got('look', '{id}')::uuid),
  'a look is of the court looked at the longest ago, once an hour, and keeps only the counts of the systems ONE knows'
);

insert into res select 'signals', jsonb_build_object('list', (select jsonb_agg(to_jsonb(s)) from public.court_system_signals() s));

select ok(
  (select count(*) = 1 from res, jsonb_array_elements(payload -> 'list') x where name = 'signals')
  and pg_temp.got('signals', '{list,0,court}') = 'TJGO' and pg_temp.got('signals', '{list,0,kind}') = 'juizado'
  and pg_temp.got('signals', '{list,0,table_system}') = 'projudi' and pg_temp.got('signals', '{list,0,seen_system}') = 'pje'
  and pg_temp.got('signals', '{list,0,percent}') = '33',
  'a court whose links point to another system than the table''s is a signal; one that agrees is none'
);

-- The DJEN stopped answering thirty hours ago, and the latest look failed a moment ago.
insert into public.djen_probes (court, day, at, outcome, latency_ms, items) values
  ('TJSP', current_date - 2, now() - interval '31 hours', 'ok', 500, 40),
  ('TJRJ', current_date - 2, now() - interval '30 hours', 'error', null, 0),
  ('TJMG', current_date - 1, now() - interval '20 minutes', 'rate_limited', null, 0),
  ('TJPR', current_date - 1, now() - interval '10 minutes', 'error', null, 0);
update public.djen_probes set at = now() - interval '32 hours' where court = 'TJGO';

select pg_temp.sign_in('a2010000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'lima', jsonb_build_object('outage', public.firm_djen_outage('b2010000-0000-4000-8000-00000000000a'));
insert into res select 'signal', jsonb_build_object('signal', public.court_system_signal('tjgo', 'juizado'),
  'none', public.court_system_signal('TJGO', 'comum'));
reset role;
select pg_temp.sign_in('a2010000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'rocha', jsonb_build_object('outage', public.firm_djen_outage('b2010000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  (pg_temp.got('lima', '{outage,down_since}'))::timestamptz between now() - interval '31 hours' and now() - interval '29 hours'
  and pg_temp.got('rocha', '{outage}') is null,
  'a firm that reads the DJEN is told it does not answer since the first failed look, past a day; a firm that reads none is not'
);

select ok(
  pg_temp.got('signal', '{signal,seen_system}') = 'pje' and pg_temp.got('signal', '{none}') is null,
  'who approves a lawsuit''s system reads the signal of its court and kind'
);

-- A shorter outage asks nothing of a firm.
update public.djen_probes set at = now() - interval '2 hours' where court = 'TJRJ';
update public.djen_probes set at = now() - interval '3 hours' where court = 'TJSP';
select pg_temp.sign_in('a2010000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'short', jsonb_build_object('outage', public.firm_djen_outage('b2010000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('short', '{outage}') is null,
  'an outage of a few hours is ONE''s to wait out, and asks nothing of a firm'
);

select pg_temp.sign_in('a2010000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ select count(*) from public.djen_probes $$, '42501', null, 'nobody of a firm reads a look');
select throws_ok($$ select public.admin_djen_watch() $$, '42501', null, 'nor the operator''s watch');
reset role;

select pg_temp.sign_in('a2010000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res select 'admin', public.admin_djen_watch();
reset role;

select ok(
  pg_temp.got('admin', '{state,down_since}') is not null
  and (select jsonb_array_length(payload -> 'probes') = 5 from res where name = 'admin')
  and pg_temp.got('admin', '{signals,0,seen_system}') = 'pje'
  and not has_function_privilege('authenticated', 'public.record_djen_probe(text, date, text, integer, integer, integer, jsonb, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.djen_probe_due()', 'EXECUTE'),
  'the operator reads the watch, the outage at once and the signals; only the backend looks and records'
);

select * from finish();
rollback;
