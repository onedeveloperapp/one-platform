begin;
create extension if not exists pgtap;
select plan(22);

-- ============================================================
-- The first cut of the controladoria (0110): the court in the list of
-- cases (what moved today and in the last 7 and 30 days, what is quiet for
-- more than 30, 45 and 90 days, what no source ever read), the cases
-- archived in the month, and the list taken to a spreadsheet by who may,
-- on the record and never with the words searched. Two firms: A with a case
-- in each state; B with more cases than a page of the screen holds.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-contr.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1110000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@lima-contr.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1110000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@lima-contr.invalid', '', now(), '{}', '{"display_name":"Caio Lima"}', now(), now()),
  ('a1110000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@rocha-contr.invalid', '', now(), '{}', '{"display_name":"Duda Rocha"}', now(), now()),
  ('a1110000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@one-contr.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1110000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-contr', 'a1110000-0000-4000-8000-000000000001'),
  ('b1110000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-contr', 'a1110000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1110000-0000-4000-8000-00000000000a', 'a1110000-0000-4000-8000-000000000001', 'member', 'socio'),
  ('b1110000-0000-4000-8000-00000000000a', 'a1110000-0000-4000-8000-000000000002', 'member', 'controladoria'),
  ('b1110000-0000-4000-8000-00000000000a', 'a1110000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1110000-0000-4000-8000-00000000000b', 'a1110000-0000-4000-8000-000000000004', 'owner', 'advogado');

-- A: the cases in court, and what each did there.
--   1 moved today;  2 moved 5 days ago;  3 moved 20 days ago;
--   4 quiet for 35 days;  5 for 50;  6 for 100;
--   7 read and never moved, filed 40 days ago;
--   8 in court and never read by any source;
--   9 archived this month;  10 declined this month, never in court;  11 archived a month ago;  12 still being prepared.
insert into public.cases (id, org_id, seq, module, incident, status, closed_at)
select ('c1110000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'b1110000-0000-4000-8000-00000000000a', n,
       'direito-do-passageiro', 'delay',
       case when n <= 8 then 'filed' when n in (9, 11) then 'closed' when n = 10 then 'declined' else 'drafting' end,
       case when n in (9, 10) then now() when n = 11 then now() - interval '1 month' end
from generate_series(1, 12) as n;

insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at)
select ('e1110000-0000-4000-8000-0000000000' || lpad(p.n::text, 2, '0'))::uuid, 'b1110000-0000-4000-8000-00000000000a',
       ('c1110000-0000-4000-8000-0000000000' || lpad(p.n::text, 2, '0'))::uuid, 'juizado', 'TJGO',
       case when p.n in (9, 11) then 'closed' else 'filed' end, p.cnj,
       current_date - case when p.n = 7 then 40 else 120 end
from (values
  (1, '00051016820998090051'), (2, '00051025320998090051'), (3, '00051033820998090051'), (4, '00051042320998090051'),
  (5, '00051050820998090051'), (6, '00051069020998090051'), (7, '00051077520998090051'), (8, '00051086020998090051'),
  (9, '00051094520998090051'), (11, '00051103020998090051')
) as p (n, cnj);

update public.proceeding_tracking t
set status = 'tracked', read_at = now(), checked_at = now(), last_movement_at = m.at
from (values
  (1, now()),
  (2, now() - interval '5 days'),
  (3, now() - interval '20 days'),
  (4, now() - interval '35 days'),
  (5, now() - interval '50 days'),
  (6, now() - interval '100 days'),
  (7, null::timestamptz)
) as m (n, at)
where t.proceeding_id = ('e1110000-0000-4000-8000-0000000000' || lpad(m.n::text, 2, '0'))::uuid;

-- Case 1 had its hearing held.
insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, status) values
  ('b1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000000001', 'e1110000-0000-4000-8000-000000000001',
   'conciliacao', now() - interval '3 days', 'America/Sao_Paulo', 'videoconferencia', 'held');

-- B: more cases than a page of the screen holds.
insert into public.cases (org_id, seq, module, incident)
select 'b1110000-0000-4000-8000-00000000000b', n, 'direito-do-passageiro', 'delay' from generate_series(1, 120) as n;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.seqs(name text) returns int[] language sql as
$$ select coalesce(array_agg((r ->> 'seq')::int order by (r ->> 'seq')::int), '{}') from res, jsonb_array_elements(res.payload -> 'rows') r where res.name = seqs.name; $$;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

select pg_temp.sign_in('a1110000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('all', public.firm_cases('b1110000-0000-4000-8000-00000000000a'));
insert into res values ('today', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'mov-hoje'));
insert into res values ('week', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'mov-7'));
insert into res values ('thirty', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'mov-30'));
insert into res values ('quiet30', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'parado-30'));
insert into res values ('quiet45', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'parado-45'));
insert into res values ('quiet90', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'parado-90'));
insert into res values ('never', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'nunca-capturados'));
insert into res values ('archived', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'arquivados-mes'));
insert into res values ('ended', public.firm_cases('b1110000-0000-4000-8000-00000000000a', 'encerrados-mes'));
reset role;

select ok(
  (pg_temp.got('all', '{counts}')::jsonb @> '{"mov-hoje": 1, "mov-7": 2, "mov-30": 3, "parado-30": 4, "parado-45": 2,
    "parado-90": 1, "nunca-capturados": 1, "arquivados-mes": 1, "encerrados-mes": 2}'::jsonb),
  'every view of the court and of the month is counted'
);
select is(pg_temp.seqs('today'), array[1], 'a lawsuit that moved today is in "movimentados hoje"');
select ok(
  pg_temp.seqs('week') = array[1, 2] and pg_temp.seqs('thirty') = array[1, 2, 3],
  'the last 7 and the last 30 days hold what moved in them'
);
select ok(
  (pg_temp.got('today', '{rows,0,moved_at}')) is not null
    and pg_temp.got('today', '{rows,0,cnjs}')::jsonb = '["00051016820998090051"]'::jsonb,
  'a row says when its lawsuit last moved and the numbers of its lawsuits'
);
select ok(
  pg_temp.got('today', '{rows,0,court}')::jsonb = '{"held": true, "decided": false, "paid": false}'::jsonb
    and (select payload #> '{rows,0,court}' from res where name = 'ended') = 'null'::jsonb,
  'a case in court says what its lawsuits show, read with the row; one out of court says nothing of it'
);
select is(pg_temp.seqs('quiet30'), array[4, 5, 6, 7],
  'quiet for more than 30 days: the last movement, or the filing of a lawsuit that never moved');
select ok(
  pg_temp.seqs('quiet45') = array[5, 6] and pg_temp.seqs('quiet90') = array[6],
  'and the 45 and 90 days marks hold what passed them'
);
select is(pg_temp.seqs('never'), array[8], 'a lawsuit no source ever read is "nunca capturado", and says nothing of being quiet');
select ok(
  pg_temp.seqs('archived') = array[9] and pg_temp.seqs('ended') = array[9, 10],
  'archived is a case that went to court and ended; a case declined before it is only ended'
);
select ok(
  pg_temp.got('all', '{numbers,archived}')::int = 1 and pg_temp.got('all', '{numbers,archived_before}')::int = 1,
  'the archived of the month are beside the same days of the month before'
);

-- ---------- The list taken to a spreadsheet ----------

select pg_temp.sign_in('a1110000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.may_export_cases('b1110000-0000-4000-8000-00000000000a'), false, 'the attendance takes nothing out');
select is(
  public.begin_case_export('b1110000-0000-4000-8000-00000000000a', null, null, false, 3) ->> 'code',
  'not_allowed', 'and its export is refused'
);
reset role;

select pg_temp.sign_in('a1110000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  public.may_export_cases('b1110000-0000-4000-8000-00000000000a'),
  'the controladoria takes the firm''s cases out'
);
select throws_ok(
  $$ select public.firm_cases_export('b1110000-0000-4000-8000-00000000000a') $$,
  '42501', 'export_not_begun',
  'no page is read of an export nobody began'
);
insert into res values ('begun', public.begin_case_export('b1110000-0000-4000-8000-00000000000a', 'mov-30', 'direito-do-passageiro', true, 3));
insert into res values ('page', public.firm_cases_export('b1110000-0000-4000-8000-00000000000a', 'mov-30'));
insert into res values ('too_many', public.begin_case_export('b1110000-0000-4000-8000-00000000000a', null, null, false, 100001));
insert into res values ('empty', public.begin_case_export('b1110000-0000-4000-8000-00000000000a', null, null, false, 0));
reset role;

select ok(
  (pg_temp.got('begun', '{ok}'))::boolean and pg_temp.got('begun', '{page}')::int = 2000 and pg_temp.got('begun', '{left}')::int = 19,
  'an export begun says the size of its pages and how many are left today'
);
select is(
  (select metadata from public.audit_events
   where org_id = 'b1110000-0000-4000-8000-00000000000a' and action = 'case.exported'),
  '{"view": "mov-30", "module": "direito-do-passageiro", "searched": true, "rows": 3, "format": "xlsx"}'::jsonb,
  'the audit trail keeps what was taken and whether a search narrowed it, never the words searched'
);
select is(pg_temp.seqs('page'), array[1, 2, 3], 'the export reads the same list');
select ok(
  pg_temp.got('too_many', '{code}') = 'too_many' and pg_temp.got('too_many', '{limit}')::int = 100000
    and pg_temp.got('empty', '{code}') = 'empty',
  'a list beyond the setting''s cases, or empty, is no export'
);

select pg_temp.sign_in('a1110000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  jsonb_array_length(public.firm_cases('b1110000-0000-4000-8000-00000000000b', null, null, 500) -> 'rows') = 100,
  'a page of the screen holds 100 rows, whatever it asks for'
);
insert into res values ('b_begun', public.begin_case_export('b1110000-0000-4000-8000-00000000000b', null, null, false, 120));
select ok(
  jsonb_array_length(public.firm_cases_export('b1110000-0000-4000-8000-00000000000b') -> 'rows') = 120,
  'a page of an export begun holds the setting''s size'
);
select throws_ok(
  $$ select public.begin_case_export('b1110000-0000-4000-8000-00000000000a', null, null, false, 3) $$,
  '42501', null,
  'nobody of another firm begins an export of a firm''s cases'
);
reset role;

-- A day's exports, and a support visit.
update public.platform_settings set value = value || '{"export_daily": 1}'::jsonb where key = 'controladoria';
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1110000-0000-4000-8000-000000000009', 'a1110000-0000-4000-8000-000000000001', 'b1110000-0000-4000-8000-00000000000a',
        'Conferindo a exportação', 'f1110000-0000-4000-8000-000000000001', now() + interval '30 minutes');

select pg_temp.sign_in('a1110000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('daily', public.begin_case_export('b1110000-0000-4000-8000-00000000000a', null, null, false, 3));
reset role;
select pg_temp.sign_in('a1110000-0000-4000-8000-000000000001', 'f1110000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit', public.begin_case_export('b1110000-0000-4000-8000-00000000000a', null, null, false, 3));
reset role;

select ok(
  pg_temp.got('daily', '{code}') = 'daily_limit' and pg_temp.got('daily', '{limit}')::int = 1
    and pg_temp.got('visit', '{code}') = 'support_visit',
  'the day''s exports end at the setting''s, and a support visit takes nothing out'
);

select * from finish();
rollback;
