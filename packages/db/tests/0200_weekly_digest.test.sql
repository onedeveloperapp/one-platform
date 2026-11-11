begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The partner's weekly digest (0200). In Lima, Ana is a partner, Caio a
-- lawyer and Bia runs the controladoria; Rocha has no partner, so Edu, who
-- manages it, decides for it. Last week Lima opened a case, filed its
-- lawsuit, had it judged and settled another; the week before it opened one
-- more; a test case it opened last week is not counted, as Lima has real
-- cases. This week a deadline falls; one is past its day and a publication
-- ONE triaged owes the lawyers' awareness. Rocha has only a test case, so its
-- numbers count it and say so. Only who decides for a firm is owed the
-- e-mail, each once a week; a week with nothing is recorded and sends
-- nothing; the provider's quota gives the turn back; the person stops it in
-- their settings or by the e-mail's link; nobody reads another firm's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2000000-0000-4000-8000-000000000001', 'ana@lima-semana.invalid', 'Ana Lima'),
  ('a2000000-0000-4000-8000-000000000002', 'caio@lima-semana.invalid', 'Caio Lima'),
  ('a2000000-0000-4000-8000-000000000003', 'bia@lima-semana.invalid', 'Bia Lima'),
  ('a2000000-0000-4000-8000-000000000009', 'edu@rocha-semana.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2000000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-semana', 'a2000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-semana', 'a2000000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000003', 'member', 'controladoria'),
  ('b2000000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-000000000009', 'owner', 'advogado');

-- The Monday of last week and of this one, in Brasília's days.
create temporary table k as
select (now() at time zone 'America/Sao_Paulo')::date as today,
       (now() at time zone 'America/Sao_Paulo')::date
         - (extract(isodow from (now() at time zone 'America/Sao_Paulo')::date)::integer - 1) - 7 as week;
grant select on k to anon, authenticated, service_role;
create function pg_temp.at_noon(day date) returns timestamptz language sql as
$$ select (day + time '12:00') at time zone 'America/Sao_Paulo'; $$;

insert into public.cases (id, org_id, seq, module, incident, status, created_at, is_test)
select x.id::uuid, x.org::uuid, x.seq, 'direito-do-passageiro', 'delay', x.status, pg_temp.at_noon(k.week + x.day), x.test
from k, (values
  ('c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-00000000000a', 1, 'filed', 1, false),
  ('c2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-00000000000a', 2, 'filed', -5, false),
  ('c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-00000000000a', 3, 'intake', 2, true),
  ('c2000000-0000-4000-8000-000000000009', 'b2000000-0000-4000-8000-00000000000b', 1, 'intake', 2, true)
) as x (id, org, seq, status, day, test);

insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at)
select x.id::uuid, 'b2000000-0000-4000-8000-00000000000a', x.case_id::uuid, 'juizado', 'TJGO', 'filed', x.cnj, k.week + x.day
from k, (values
  ('f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', '10003012720998090100', 2),
  ('f2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', '10003021220998090100', -3)
) as x (id, case_id, cnj, day);

insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, happened_on, source)
select 'b2000000-0000-4000-8000-00000000000a', x.case_id::uuid, x.proceeding_id::uuid, x.kind, x.result, k.week + 3, 'person'
from k, (values
  ('c2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'sentenca', 'procedente'),
  ('c2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'acordo', null)
) as x (case_id, proceeding_id, kind, result);

insert into public.deadlines (id, org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting,
                              status, due_on, confirmed_at)
select x.id::uuid, 'b2000000-0000-4000-8000-00000000000a', '10003012720998090100', 'TJGO',
       'c2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', x.title, 'day',
       k.week + x.due - 5, 5, 'business', 'confirmed', k.week + x.due, now()
from k, (values
  ('e2000000-0000-4000-8000-000000000001', 'Recurso inominado', 13),
  ('e2000000-0000-4000-8000-000000000002', 'Manifestação', 0)
) as x (id, title, due);

insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id, category,
                                 triaged_at, ack_owed)
values ('d2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-00000000000a', 'hash-semana-1', 'TJGO',
        '10003012720998090100', current_date - 2, 'Intimação', 'Fica a parte intimada da sentença.',
        'f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'decisao', now(), true);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'owed', jsonb_build_object('list', public.weekly_digests_owed((select week from k), 10));
reset role;
insert into res select 'lima', public.weekly_digest_facts('b2000000-0000-4000-8000-00000000000a', (select week from k));
insert into res select 'rocha', public.weekly_digest_facts('b2000000-0000-4000-8000-00000000000b', (select week from k) + 2);

select ok(
  pg_temp.got('lima', '{cases,opened}') = '1' and pg_temp.got('lima', '{cases,opened_before}') = '1'
  and pg_temp.got('lima', '{cases,filed}') = '1' and pg_temp.got('lima', '{cases,filed_before}') = '1'
  and pg_temp.got('lima', '{outcomes,won}') = '1' and pg_temp.got('lima', '{outcomes,settlements}') = '1'
  and pg_temp.got('lima', '{outcomes,lost}') = '0' and pg_temp.got('lima', '{tests_counted}') = 'false',
  'a week of the firm in numbers, beside the week before, the test case left out of a firm with real ones'
);

select ok(
  pg_temp.got('lima', '{ahead,deadlines}') = '1' and pg_temp.got('lima', '{waiting,overdue}') = '1'
  and pg_temp.got('lima', '{waiting,awareness}') = '1'
  and pg_temp.got('lima', '{week}') = (select week::text from k)
  and pg_temp.got('rocha', '{week}') = (select week::text from k)
  and pg_temp.got('rocha', '{tests_counted}') = 'true' and pg_temp.got('rocha', '{cases,opened}') = '1',
  'what this week holds and what waits now; a firm with only test cases counts them, and says so'
);

select ok(
  (select array_agg(p ->> 'user_id' order by p ->> 'user_id')
   from res, jsonb_array_elements(payload -> 'list') f, jsonb_array_elements(f -> 'people') p
   where name = 'owed' and f ->> 'org_id' in ('b2000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-00000000000b'))
  = array['a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000009'],
  'the e-mail is owed only to who decides for each firm: the partner, or who manages a firm with none'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'first', jsonb_build_object('id', public.reserve_weekly_digest('b2000000-0000-4000-8000-00000000000a',
  'a2000000-0000-4000-8000-000000000001', (select week from k), 6));
insert into res select 'again', jsonb_build_object('id', public.reserve_weekly_digest('b2000000-0000-4000-8000-00000000000a',
  'a2000000-0000-4000-8000-000000000001', (select week from k), 6));
insert into res select 'empty', jsonb_build_object('id', public.reserve_weekly_digest('b2000000-0000-4000-8000-00000000000b',
  'a2000000-0000-4000-8000-000000000009', (select week from k), 0));
select public.finish_weekly_digest((select (payload ->> 'id')::uuid from res where name = 'first'), 'quota');
insert into res select 'retry', jsonb_build_object('id', public.reserve_weekly_digest('b2000000-0000-4000-8000-00000000000a',
  'a2000000-0000-4000-8000-000000000001', (select week from k), 6));
select public.finish_weekly_digest((select (payload ->> 'id')::uuid from res where name = 'retry'), 'sent');
reset role;

select ok(
  pg_temp.got('first', '{id}') is not null and pg_temp.got('again', '{id}') is null and pg_temp.got('empty', '{id}') is null
  and pg_temp.got('retry', '{id}') is not null
  and (select status = 'sent' from public.weekly_digests where id = pg_temp.got('retry', '{id}')::uuid)
  and (select status = 'empty' from public.weekly_digests where user_id = 'a2000000-0000-4000-8000-000000000009'),
  'each e-mail is reserved once a week, a week with nothing sends nothing, and the provider''s quota gives the turn back'
);

select throws_ok(
  $$ select public.reserve_weekly_digest('b2000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000001',
       (select week from k) + 1, 3) $$,
  '22023', 'invalid_week', 'a week is told from its Monday'
);

select pg_temp.sign_in('a2000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'caio_off', public.set_weekly_digest('b2000000-0000-4000-8000-00000000000a', false);
insert into res select 'caio_reads', public.firm_weekly_digest('b2000000-0000-4000-8000-00000000000a');
reset role;
select pg_temp.sign_in('a2000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'ana_reads', public.firm_weekly_digest('b2000000-0000-4000-8000-00000000000a');
insert into res select 'ana_off', public.set_weekly_digest('b2000000-0000-4000-8000-00000000000a', false);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'owed_next', jsonb_build_object('list', public.weekly_digests_owed((select week from k) + 7, 10));
reset role;

select ok(
  pg_temp.got('caio_off', '{code}') = 'not_allowed' and pg_temp.got('caio_reads', '{decides}') = 'false'
  and pg_temp.got('caio_reads', '{facts}') is null
  and pg_temp.got('ana_reads', '{decides}') = 'true' and pg_temp.got('ana_reads', '{on}') = 'true'
  and pg_temp.got('ana_reads', '{facts,cases,opened}') is not null
  and pg_temp.got('ana_off', '{on}') = 'false'
  and not exists (select 1 from res, jsonb_array_elements(payload -> 'list') f, jsonb_array_elements(f -> 'people') p
                  where name = 'owed_next' and p ->> 'user_id' = 'a2000000-0000-4000-8000-000000000001')
  and exists (select 1 from public.audit_events where action = 'weekly_digest.off'
                and actor_id = 'a2000000-0000-4000-8000-000000000001'),
  'who decides reads the week and stops the e-mail, on the record; anybody else reads that it is not theirs'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'stopped', jsonb_build_object('ok', public.stop_weekly_digest(
  (select email_unsubscribe_token from public.profiles where id = 'a2000000-0000-4000-8000-000000000009')));
insert into res select 'owed_after', jsonb_build_object('list', public.weekly_digests_owed((select week from k) + 7, 10));
reset role;

select ok(
  pg_temp.got('stopped', '{ok}') = 'true'
  and not exists (select 1 from res, jsonb_array_elements(payload -> 'list') f, jsonb_array_elements(f -> 'people') p
                  where name = 'owed_after' and p ->> 'user_id' = 'a2000000-0000-4000-8000-000000000009')
  and (select not weekly_off and not digest_off from public.agenda_preferences
       where user_id = 'a2000000-0000-4000-8000-000000000002') is not false,
  'the e-mail''s own link stops the weekly digest and nothing else'
);

select pg_temp.sign_in('a2000000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok($$ select public.firm_weekly_digest('b2000000-0000-4000-8000-00000000000a') $$, '42501', null,
  'nobody reads another firm''s week');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.weekly_digests_owed(date, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reserve_weekly_digest(uuid, uuid, date, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.weekly_digest_facts(uuid, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.stop_weekly_digest(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.firm_weekly_digest(uuid)', 'EXECUTE'),
  'only the backend reserves and sends; a person reads their own firm''s week'
);

select * from finish();
rollback;
