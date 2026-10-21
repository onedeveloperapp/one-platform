begin;
create extension if not exists pgtap;
select plan(30);

-- ============================================================
-- The deadlines (0034). A person who signs or runs the firm's deadlines
-- proposes one, of a publication or of a filed lawsuit; the backend counts
-- it with the rule over the court's calendar (claimed by number, written for
-- the revision it read); who runs the deadlines confirms the counted day or
-- another with the reason. A change of the calendar has the open deadlines
-- whose count goes through it counted again, a change of the lawsuit its
-- own, and a confirmed one whose count changed is shown, never changed; what
-- a person is asked to look at again stops being asked once the deadline is
-- confirmed knowing it. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented; the calendar of TJGO is
-- the court's own list of 2026.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@prazos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@prazos.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@prazos.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@prazos.invalid', '', now(), '{}', '{"display_name":"Edu Prado"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@prazos.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@prazos.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'ae100000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('be100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-prazos', 'ae100000-0000-4000-8000-000000000001'),
  ('be100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-prazos', 'ae100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000002', 'member', 'controladoria'),
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000005', 'member', 'advogado'),
  ('be100000-0000-4000-8000-00000000000b', 'ae100000-0000-4000-8000-000000000004', 'owner', 'advogado');
-- Both firms have a person confirm each deadline (0016): what follows is that path. ONE confirming alone is 0045's.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('be100000-0000-4000-8000-00000000000a', 'deadline_confirm', 'approval'),
  ('be100000-0000-4000-8000-00000000000b', 'deadline_confirm', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.deadline(name text) returns public.deadlines language sql as
$$ select * from public.deadlines where id = pg_temp.got(name, 'id')::uuid; $$;

-- Firm A: a case with a lawsuit filed in TJGO (small claims, Projudi, Goiânia) and one still planned.
-- Firm B: a case with a lawsuit filed in TJGO.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('be100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "Maria Teste", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('go', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "comarca": "Goiânia", "status": "filed", "cnj": "5000123-60.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
insert into res values ('planned', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "system": "projudi"}'::jsonb));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('be100000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-01-20',
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('go_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000789-61.2099.8.09.0051", "filed_at": "2026-02-02"}'::jsonb,
  array[pg_temp.got('case_b', 'party_id')::uuid]));
reset role;

-- What the DJEN brought: written here as the capture would keep it.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id) values
  ('ce100000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-00000000000a', 'prazohash00000001', 'TJGO', '50001236020998090051',
   date '2026-03-02', 'Intimação', 'Manifeste-se a parte autora sobre os documentos.',
   pg_temp.got('go', 'proceeding_id')::uuid, pg_temp.got('case_a', 'case_id')::uuid),
  ('ce100000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-00000000000a', 'prazohash00000002', 'TJSP', '10002348820998260100',
   current_date - 10, 'Intimação', 'Intime-se.', null, null),
  ('ce100000-0000-4000-8000-000000000004', 'be100000-0000-4000-8000-00000000000b', 'prazohash00000004', 'TJGO', '50007896120998090051',
   date '2026-03-02', 'Intimação', 'Intime-se.', pg_temp.got('go_b', 'proceeding_id')::uuid, pg_temp.got('case_b', 'case_id')::uuid);
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, active, cancelled_at, cancel_reason) values
  ('ce100000-0000-4000-8000-000000000003', 'be100000-0000-4000-8000-00000000000a', 'prazohash00000003', 'TJGO', '50001236020998090051',
   date '2026-03-03', 'Intimação', 'Intime-se.', false, now(), 'Publicada por engano.');
-- Three a person of firm A triaged as a deadline and proposed none from: one made available three days ago; one of
-- eighty days ago, triaged seventy days ago; and one of ninety days ago, of the lawsuit in Goiás, read late and
-- triaged five days ago.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, head, category, triaged_by, triaged_at) values
  ('ce100000-0000-4000-8000-000000000005', 'be100000-0000-4000-8000-00000000000a', 'prazohash00000005', 'TJSP', '10002348820998260100',
   current_date - 3, 'Intimação', 'Manifeste-se em cinco dias.', 'Manifeste-se em cinco dias.', 'prazo',
   'ae100000-0000-4000-8000-000000000001', now()),
  ('ce100000-0000-4000-8000-000000000006', 'be100000-0000-4000-8000-00000000000a', 'prazohash00000006', 'TJSP', '10002348820998260100',
   current_date - 80, 'Intimação', 'Manifeste-se.', 'Manifeste-se.', 'prazo', 'ae100000-0000-4000-8000-000000000001',
   now() - interval '70 days'),
  ('ce100000-0000-4000-8000-000000000007', 'be100000-0000-4000-8000-00000000000a', 'prazohash00000007', 'TJGO', '50001236020998090051',
   current_date - 90, 'Intimação', 'Junte o comprovante.', 'Junte o comprovante.', 'prazo', 'ae100000-0000-4000-8000-000000000001',
   now() - interval '5 days');

-- ---------- The calendar, and what nobody but the operator writes ----------

select ok(
  (select source_url like 'https://docs.tjgo.jus.br/%' and not all_comarcas and comarcas = array['Goiânia']
   from public.court_calendar_years where court = 'TJGO' and year = 2026)
  and (select count(*) = 33 from public.court_calendar_days where court = 'TJGO')
  and (select count(*) = 18 from public.court_calendar_days where court = 'TJGO' and label = 'Recesso forense')
  and (select kind = 'partial' from public.court_calendar_days where court = 'TJGO' and day = date '2026-02-18')
  and (select comarcas = array['Goiânia', 'Iporá', 'Leopoldo de Bulhões', 'Senador Canedo']
       from public.court_calendar_days where court = 'TJGO' and day = date '2026-05-24')
  and (select count(*) = 13 from public.deadline_acts where active),
  'the calendar of TJGO for 2026 is the court''s list, with the recess into 2027, and the acts carry the days the law gives them'
);

select ok(
  not has_table_privilege('authenticated', 'public.deadlines', 'INSERT')
  and not has_table_privilege('authenticated', 'public.deadlines', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.court_calendar_days', 'INSERT')
  and not has_table_privilege('authenticated', 'public.court_calendar_years', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.deadline_acts', 'DELETE')
  and has_table_privilege('authenticated', 'public.court_calendar_days', 'SELECT')
  and has_function_privilege('authenticated', 'public.court_calendar(text, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.retry_deadline_count(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_deadline_count(uuid, integer, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_deadline_count(uuid, integer, integer, text, jsonb, text)', 'EXECUTE')
  and (select jsonb_array_length(public.court_calendar('TJGO', 2026) -> 'days_off') = 33
              and public.court_calendar('TJGO', 2026) -> 'years' -> 0 ->> 'checked_on' = '2026-10-11'
              and public.court_calendar('TJGO', 3000) -> 'years' = '[]'::jsonb),
  'a session reads the calendar, the same one a count reads, and writes nothing of it nor of a deadline, but through the functions'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_save_calendar_day(null, 'TJGO', date '2026-03-23', null, 'closed', 'Dia inventado', '{}', '{}', '{}', null)$$,
  '42501', 'not_authorized',
  'a partner of a firm does not change a court''s calendar'
);
reset role;

-- ---------- Proposing ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Manifestação sobre documentos',
  'manifestacao_documentos', 'publication', null, 15, 'business'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('d1', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, ' Manifestação sobre documentos ',
  'manifestacao_documentos', 'publication', null, 15, 'business'));
insert into res values ('bad_title', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'x', null, 'publication', null, 15, 'business'));
insert into res values ('bad_days', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Prazo', null, 'publication', null, 0, 'business'));
insert into res values ('bad_act', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Prazo', 'nope', 'publication', null, 5, 'business'));
insert into res values ('bad_day', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Prazo', null, 'day', null, 5, 'business'));
insert into res values ('bad_counting', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Prazo', null, 'publication', null, 5, 'hours'));
insert into res values ('cancelled', public.propose_deadline('ce100000-0000-4000-8000-000000000003', null, 'Prazo', null, 'publication', null, 5, 'business'));
insert into res values ('from_planned', public.propose_deadline(null, pg_temp.got('planned', 'proceeding_id')::uuid, 'Prazo', null, 'day', current_date, 5, 'business'));
insert into res values ('lawsuit_publication', public.propose_deadline(null, pg_temp.got('go', 'proceeding_id')::uuid, 'Prazo', null, 'publication', null, 5, 'business'));
insert into res values ('d3', public.propose_deadline('ce100000-0000-4000-8000-000000000002', null, 'Contrarrazões', null, 'publication', null, 15, 'business'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d2', public.propose_deadline(null, pg_temp.got('go', 'proceeding_id')::uuid, 'Juntar o comprovante de residência', null,
  'day', current_date - 4, 5, 'business'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_other', public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Prazo', null, 'publication', null, 5, 'business'));
insert into res values ('db', public.propose_deadline('ce100000-0000-4000-8000-000000000004', null, 'Manifestação', 'manifestacao', 'publication', null, 5, 'business'));
reset role;

select ok(
  pg_temp.got('caio', 'code') = 'not_allowed'
  and pg_temp.got('bad_title', 'field') = 'title' and pg_temp.got('bad_days', 'field') = 'days'
  and pg_temp.got('bad_act', 'field') = 'act' and pg_temp.got('bad_day', 'field') = 'trigger_on'
  and pg_temp.got('bad_counting', 'field') = 'counting'
  and pg_temp.got('cancelled', 'code') = 'cancelled' and pg_temp.got('from_planned', 'code') = 'not_filed'
  and pg_temp.got('lawsuit_publication', 'field') = 'trigger'
  and pg_temp.got('davi_other', 'code') = 'not_found',
  'who signs or runs the deadlines proposes one of their own firm, of a publication in force or a filed lawsuit, with what the rule needs'
);

select ok(
  (select title = 'Manifestação sobre documentos' and act = 'manifestacao_documentos' and status = 'proposed' and revision = 1
          and computed_revision is null and due_on is null and trigger = 'publication' and trigger_on = date '2026-03-02'
          and cnj = '50001236020998090051' and court = 'TJGO'
          and case_id = pg_temp.got('case_a', 'case_id')::uuid and proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid
          and created_by = 'ae100000-0000-4000-8000-000000000005'
   from pg_temp.deadline('d1'))
  and (select trigger = 'day' and trigger_on = current_date - 4 and publication_id is null and cnj = '50001236020998090051'
       from pg_temp.deadline('d2'))
  and (select court = 'TJSP' and case_id is null and proceeding_id is null and trigger_on = current_date - 10
       from pg_temp.deadline('d3'))
  and (select count(*) = 4 from public.audit_events where action = 'deadline.proposed')
  and (select count(*) = 3 from public.case_events where kind = 'deadline_proposed' and actor_type = 'person'),
  'a deadline is of its lawsuit, by number and court, and of the publication it came from; a publication of a lawsuit the firm does not follow too'
);

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ae100000-0000-4000-8000-000000000009', 'ae100000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-00000000000a',
        'Conferindo os prazos', 'fe100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.propose_deadline('ce100000-0000-4000-8000-000000000001', null, 'Prazo', null, 'publication', null, 5, 'business')$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit proposes no deadline'
);
reset role;

-- ---------- Counting, by the backend ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select count(*) from public.claim_deadline_counts(10)$$, '42501', null, 'a person never claims a count');
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claims', jsonb_object_agg(c.deadline_id::text, c.claim) from public.claim_deadline_counts(10) c;
insert into res select 'again', jsonb_build_object('n', count(*)) from public.claim_deadline_counts(10);
insert into res values ('read1', public.deadline_to_count(pg_temp.got('d1', 'id')::uuid, 1));
insert into res values ('read3', public.deadline_to_count(pg_temp.got('d3', 'id')::uuid, 1));
insert into res values ('read_wrong', jsonb_build_object('read', public.deadline_to_count(pg_temp.got('d1', 'id')::uuid, 7)));
reset role;

select ok(
  (select count(*) = 4 from jsonb_object_keys((select payload from res where name = 'claims')))
  and pg_temp.got('again', 'n') = '0'
  and pg_temp.got('read1', 'court') = 'TJGO' and pg_temp.got('read1', 'revision') = '1'
  and (select payload -> 'place' = '{"proceeding_kind": "juizado", "system": "projudi", "comarca": "Goiânia"}'::jsonb from res where name = 'read1')
  and (select jsonb_array_length(payload -> 'years') = 1 and jsonb_array_length(payload -> 'days_off') = 33 from res where name = 'read1')
  and pg_temp.got('read3', 'court') = 'TJSP'
  and (select payload -> 'years' = '[]'::jsonb and payload -> 'days_off' = '[]'::jsonb
              and payload -> 'place' = '{"proceeding_kind": null, "system": null, "comarca": null}'::jsonb
       from res where name = 'read3')
  and pg_temp.got('read_wrong', 'read') is null,
  'the backend claims what is not counted for its revision, once, and reads where the lawsuit is and its court''s calendar'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('count1', public.record_deadline_count(pg_temp.got('d1', 'id')::uuid, 1, 1, 'counted',
  '{"rule": "prazo-v1", "trigger": "publication", "triggerDay": "2026-03-02", "publishedOn": "2026-03-03", "fromDay": "2026-03-03",
    "startsOn": "2026-03-04", "countedDueOn": "2026-03-25", "dueOn": "2026-03-25", "days": 15, "counting": "business",
    "skipped": [{"from": "2026-03-20", "to": "2026-03-20", "reason": "closed", "label": "Ponto facultativo (MotoGP em Goiânia)"}],
    "moved": null, "assumptions": [], "place": {"court": "TJGO"}}'::jsonb));
insert into res values ('late', public.record_deadline_count(pg_temp.got('d1', 'id')::uuid, 0, 1, 'counted', '{}'::jsonb));
insert into res values ('count2', public.record_deadline_count(pg_temp.got('d2', 'id')::uuid, 1, 1, 'counted', jsonb_build_object(
  'rule', 'prazo-v1', 'trigger', 'day', 'triggerDay', current_date - 4, 'publishedOn', null, 'fromDay', current_date - 4,
  'startsOn', current_date - 3, 'countedDueOn', current_date + 2, 'dueOn', current_date + 2, 'days', 5, 'counting', 'business',
  'skipped', '[]'::jsonb, 'moved', null,
  'assumptions', '[{"code": "local_days_unchecked", "years": [2026]}]'::jsonb, 'place', jsonb_build_object('court', 'TJGO'))));
-- A count that does not agree with what the deadline is (another number of days) is no count.
insert into res values ('count_db', public.record_deadline_count(pg_temp.got('db', 'id')::uuid, 1, 1, 'counted',
  '{"rule": "prazo-v1", "trigger": "publication", "triggerDay": "2026-03-02", "publishedOn": "2026-03-03",
    "startsOn": "2026-03-04", "dueOn": "2026-03-25", "days": 15, "counting": "business", "skipped": [], "assumptions": []}'::jsonb));
insert into res values ('retry3', public.record_deadline_count(pg_temp.got('d3', 'id')::uuid, 1, 1, 'retry', null, 'Calendar Unavailable!'));
reset role;

select ok(
  pg_temp.got('count1', 'code') = 'counted' and pg_temp.got('late', 'code') = 'not_working'
  and (select computed_revision = 1 and computed_due_on = date '2026-03-25' and due_on = date '2026-03-25'
              and published_on = date '2026-03-03' and starts_on = date '2026-03-04' and rule_version = 'prazo-v1'
              and assumptions = '{}' and explanation -> 'skipped' -> 0 ->> 'reason' = 'closed'
              and count_claimed_at is null and status = 'proposed'
       from pg_temp.deadline('d1'))
  and (select due_on = current_date + 2 and assumptions = array['local_days_unchecked'] from pg_temp.deadline('d2'))
  and pg_temp.got('count_db', 'code') = 'failed'
  and (select computed_revision is null and count_error = 'invalid_result' and count_attempts = 3 from pg_temp.deadline('db'))
  and pg_temp.got('retry3', 'code') = 'retry'
  and (select count_error = 'calendar' and count_retry_after > now() and count_attempts = 1 and count_claimed_at is null
       from pg_temp.deadline('d3')),
  'what the rule counted is kept whole for the revision it read, a proposed deadline takes its day, and a count that does not fit is refused'
);

-- The wait is over, and the next attempt is the rule refusing to count it.
update public.deadlines set count_retry_after = now() - interval '1 minute' where id = pg_temp.got('d3', 'id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim3', jsonb_build_object('claim', c.claim) from public.claim_deadline_counts(1, pg_temp.got('d3', 'id')::uuid) c;
insert into res values ('failed3', public.record_deadline_count(pg_temp.got('d3', 'id')::uuid, pg_temp.got('claim3', 'claim')::integer, 1,
  'failed', null, 'too_long'));
reset role;

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('today_a', public.firm_today('be100000-0000-4000-8000-00000000000a'));
insert into res values ('list_a', public.firm_deadlines('be100000-0000-4000-8000-00000000000a', 'confirmar'));
insert into res values ('list_case', public.firm_deadlines('be100000-0000-4000-8000-00000000000a', 'abertos', 25, 0,
  pg_temp.got('case_a', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('failed3', 'code') = 'failed'
  and pg_temp.got('today_a', 'deadlines_to_confirm') = '3'
  and pg_temp.got('today_a', 'deadlines_soon') = '1'
  and pg_temp.got('today_a', 'deadlines_overdue') = '1'
  and pg_temp.got('today_a', 'deadlines_review') = '1'
  -- Due from today on is every open deadline that is: the one the home counts as due soon is one of them.
  and (select payload -> 'counts' = '{"confirmar": 3, "proximos": 1, "em_breve": 1, "vencidos": 1, "rever": 1, "abertos": 3, "concluidos": 0}'::jsonb
              and (payload ->> 'soon_days')::integer = 3
       from res where name = 'list_a')
  and (select jsonb_array_length(payload -> 'rows') = 3 and payload -> 'rows' -> 0 ->> 'id' = pg_temp.got('d1', 'id')
              and payload -> 'rows' -> 0 ->> 'case_seq' is not null and payload -> 'rows' -> 0 ->> 'proceeding_kind' = 'juizado'
              and payload -> 'rows' -> 0 -> 'calendar_checked' = '[{"year": 2026, "checked_on": "2026-10-11"}]'::jsonb
              and (payload -> 'rows' -> 2 ->> 'count_failed')::boolean
              and payload -> 'rows' -> 2 -> 'review_reasons' = '["count_failed"]'::jsonb
       from res where name = 'list_a')
  and (select (payload -> 'counts' ->> 'abertos')::integer = 2 and jsonb_array_length(payload -> 'rows') = 2
       from res where name = 'list_case'),
  'the firm reads what waits for confirmation, what is due soon, what is past its day and what could not be counted, anybody of the firm, and a case its own'
);

-- ---------- What a triage as a deadline left without one ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('watch_a', public.firm_publications_without_deadline('be100000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('d5', public.propose_deadline('ce100000-0000-4000-8000-000000000005', null, 'Manifestação', 'manifestacao',
  'publication', null, 5, 'business'));
insert into res values ('watch_after', public.firm_publications_without_deadline('be100000-0000-4000-8000-00000000000a'));
insert into res values ('today_after', public.firm_today('be100000-0000-4000-8000-00000000000a'));
reset role;
-- Watched from the triage: the one read late is, the one triaged seventy days ago no longer is.
select ok(
  pg_temp.got('today_a', 'publications_without_deadline') = '2'
  and pg_temp.got('watch_a', 'total') = '2' and pg_temp.got('watch_a', 'watch_days') = '60'
  and (select array_agg(r ->> 'id' order by r ->> 'id')
         = array['ce100000-0000-4000-8000-000000000005', 'ce100000-0000-4000-8000-000000000007']
       from res, jsonb_array_elements(payload -> 'rows') r where name = 'watch_a')
  and (select r ->> 'head' = 'Manifeste-se em cinco dias.' and r ->> 'court' = 'TJSP'
              and not r ? 'body' and not r ? 'ai_category'
       from res, jsonb_array_elements(payload -> 'rows') r
       where name = 'watch_a' and r ->> 'id' = 'ce100000-0000-4000-8000-000000000005')
  and pg_temp.got('d5', 'code') = 'proposed'
  and pg_temp.got('watch_after', 'total') = '1' and pg_temp.got('today_after', 'publications_without_deadline') = '1',
  'a publication triaged as a deadline that no deadline came from is shown to the firm, from its triage and for the days of the setting, until one is proposed'
);

-- The deadline of the act was recorded from the court's system: it is linked to the publication of that act.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('d6', public.propose_deadline(null, pg_temp.got('go', 'proceeding_id')::uuid, 'Juntada lida no Projudi', null,
  'day', current_date - 1, 5, 'business'));
insert into res values ('watch_d6', public.firm_publications_without_deadline('be100000-0000-4000-8000-00000000000a'));
insert into res values ('link_other', public.link_deadline_publication(pg_temp.got('d3', 'id')::uuid, 'ce100000-0000-4000-8000-000000000007'));
insert into res values ('link', public.link_deadline_publication(pg_temp.got('d6', 'id')::uuid, 'ce100000-0000-4000-8000-000000000007'));
insert into res values ('link_again', public.link_deadline_publication(pg_temp.got('d6', 'id')::uuid, 'ce100000-0000-4000-8000-000000000007'));
insert into res values ('watch_linked', public.firm_publications_without_deadline('be100000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_link', public.link_deadline_publication(pg_temp.got('d6', 'id')::uuid, 'ce100000-0000-4000-8000-000000000007'));
reset role;
select ok(
  (select r -> 'lawsuit_deadlines' @> jsonb_build_array(jsonb_build_object('id', pg_temp.got('d6', 'id')))
   from res, jsonb_array_elements(payload -> 'rows') r
   where name = 'watch_d6' and r ->> 'id' = 'ce100000-0000-4000-8000-000000000007')
  and pg_temp.got('link_other', 'code') = 'not_linkable' and pg_temp.got('link', 'code') = 'linked'
  and pg_temp.got('link_again', 'code') = 'not_linkable' and pg_temp.got('caio_link', 'code') = 'not_allowed'
  and pg_temp.got('watch_linked', 'total') = '0'
  and (select publication_id = 'ce100000-0000-4000-8000-000000000007' and trigger = 'day' from pg_temp.deadline('d6'))
  and (select count(*) = 1 from public.audit_events where action = 'deadline.publication_linked'),
  'a deadline recorded from the court''s system is linked to the publication of its act, which then has its deadline'
);

-- ---------- Confirming ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('edu_confirms', public.confirm_deadline(pg_temp.got('d1', 'id')::uuid, 1, null, null));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('stale', public.confirm_deadline(pg_temp.got('d1', 'id')::uuid, 2, null, null));
insert into res values ('c1', public.confirm_deadline(pg_temp.got('d1', 'id')::uuid, 1, null, null));
insert into res values ('c2_bare', public.confirm_deadline(pg_temp.got('d2', 'id')::uuid, 1, current_date + 5, null));
insert into res values ('c2', public.confirm_deadline(pg_temp.got('d2', 'id')::uuid, 1, current_date + 5, 'A juíza deu mais três dias na decisão.'));
insert into res values ('c3_bare', public.confirm_deadline(pg_temp.got('d3', 'id')::uuid, 1, null, 'Contado à mão no calendário do TJSP.'));
insert into res values ('c3', public.confirm_deadline(pg_temp.got('d3', 'id')::uuid, 1, current_date + 6, 'Contado à mão no calendário do TJSP.'));
insert into res values ('cdb', public.confirm_deadline(pg_temp.got('db', 'id')::uuid, 1, null, null));
reset role;

select ok(
  pg_temp.got('edu_confirms', 'code') = 'not_allowed' and pg_temp.got('stale', 'code') = 'changed'
  and pg_temp.got('c1', 'code') = 'confirmed' and pg_temp.got('c2_bare', 'code') = 'reason_required'
  and pg_temp.got('c2', 'code') = 'confirmed' and pg_temp.got('c3_bare', 'field') = 'due_on'
  and pg_temp.got('c3', 'code') = 'confirmed' and pg_temp.got('cdb', 'code') = 'not_found'
  and (select status = 'confirmed' and due_on = date '2026-03-25' and not corrected and confirmed_against = date '2026-03-25'
              and confirmed_by = 'ae100000-0000-4000-8000-000000000002'
       from pg_temp.deadline('d1'))
  and (select due_on = current_date + 5 and corrected and correction_reason = 'A juíza deu mais três dias na decisão.'
              and confirmed_against = current_date + 2
       from pg_temp.deadline('d2'))
  and (select due_on = current_date + 6 and corrected and confirmed_against is null from pg_temp.deadline('d3'))
  and (select count(*) = 2 from public.case_events where kind = 'deadline_confirmed'),
  'who runs the deadlines confirms the counted day, or another one with the reason, and a deadline nobody could count on a day of their own'
);

-- ---------- The calendar changes ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('closed_day', public.admin_save_calendar_day(null, 'TJGO', date '2026-03-23', null, 'closed',
  'Suspensão do expediente', '{}', '{}', '{}', 'https://www.tjgo.jus.br/'));
insert into res values ('span', public.admin_save_calendar_day(null, 'TJGO', date '2026-09-01', date '2026-09-03', 'suspended',
  'Migração do sistema', '{}', array['projudi'], '{}', null));
insert into res values ('bad_span', public.admin_save_calendar_day(null, 'TJGO', date '2026-09-01', date '2026-12-01', 'closed',
  'Longo demais', '{}', '{}', '{}', null));
insert into res values ('bad_kind', public.admin_save_calendar_day(null, 'TJGO', date '2026-09-10', null, 'holiday',
  'Tipo errado', '{}', '{}', '{}', null));
reset role;

-- The deadline of firm B, which no count could take, and the one of firm A of March are reached by a day of
-- March; the one of firm A that runs from October is not, nor the one of another court.
select ok(
  pg_temp.got('closed_day', 'code') = 'saved' and pg_temp.got('closed_day', 'recounted') = '2'
  and pg_temp.got('span', 'days') = '3' and pg_temp.got('bad_span', 'field') = 'day' and pg_temp.got('bad_kind', 'code') = 'invalid_value'
  and (select revision = 3 and computed_revision = 1 and status = 'confirmed' and due_on = date '2026-03-25' from pg_temp.deadline('d1'))
  and (select revision = 1 from pg_temp.deadline('d2'))
  and (select revision = 1 from pg_temp.deadline('d3'))
  and (select revision = 3 from pg_temp.deadline('db'))
  and (select count(*) = 2 from public.audit_events where action = 'admin.calendar.day_saved'),
  'a day the operator adds to a court''s calendar has the open deadlines of that court whose count goes through it counted again, of every firm, and changes no confirmed day'
);

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim1b', jsonb_build_object('claim', c.claim) from public.claim_deadline_counts(1, pg_temp.got('d1', 'id')::uuid) c;
insert into res values ('old_revision', public.record_deadline_count(pg_temp.got('d1', 'id')::uuid, pg_temp.got('claim1b', 'claim')::integer, 2,
  'counted', '{}'::jsonb));
insert into res select 'claim1c', jsonb_build_object('claim', c.claim) from public.claim_deadline_counts(1, pg_temp.got('d1', 'id')::uuid) c;
insert into res values ('count1c', public.record_deadline_count(pg_temp.got('d1', 'id')::uuid, pg_temp.got('claim1c', 'claim')::integer, 3,
  'counted',
  '{"rule": "prazo-v1", "trigger": "publication", "triggerDay": "2026-03-02", "publishedOn": "2026-03-03", "startsOn": "2026-03-04",
    "countedDueOn": "2026-03-26", "dueOn": "2026-03-26", "days": 15, "counting": "business", "skipped": [], "moved": null,
    "assumptions": [], "place": {"court": "TJGO"}}'::jsonb));
reset role;

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('review', public.firm_deadlines('be100000-0000-4000-8000-00000000000a', 'rever'));
reset role;

select ok(
  pg_temp.got('old_revision', 'code') = 'changed' and pg_temp.got('count1c', 'code') = 'counted'
  and (select status = 'confirmed' and due_on = date '2026-03-25' and computed_due_on = date '2026-03-26'
              and computed_revision = 3 and confirmed_against = date '2026-03-25'
       from pg_temp.deadline('d1'))
  and (select payload -> 'rows' -> 0 ->> 'id' = pg_temp.got('d1', 'id') and (payload -> 'rows' -> 0 ->> 'review')::boolean
       from res where name = 'review'),
  'a count of a revision no longer in force writes nothing, and a confirmed deadline whose count changed is shown to be looked at again'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('reconfirm', public.confirm_deadline(pg_temp.got('d1', 'id')::uuid, 3, null, null));
reset role;
select ok(
  pg_temp.got('reconfirm', 'code') = 'confirmed'
  and (select due_on = date '2026-03-26' and confirmed_against = date '2026-03-26' and not public.deadline_needs_review(d)
       from public.deadlines d where d.id = pg_temp.got('d1', 'id')::uuid),
  'and confirmed again on the new count, it is in order'
);

-- ---------- The lawsuit changes ----------

update public.proceedings set comarca = 'Aparecida de Goiânia' where id = pg_temp.got('go', 'proceeding_id')::uuid;
select ok(
  (select revision = 4 from pg_temp.deadline('d1')) and (select revision = 2 from pg_temp.deadline('d2'))
  and (select revision = 1 from pg_temp.deadline('d3')),
  'a lawsuit moved to another comarca has its open deadlines counted again'
);

-- The count of the lawsuit's new place gives d2 a day before the one it was confirmed on: it is urgent by that one.
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim2b', jsonb_build_object('claim', c.claim) from public.claim_deadline_counts(1, pg_temp.got('d2', 'id')::uuid) c;
insert into res values ('count2b', public.record_deadline_count(pg_temp.got('d2', 'id')::uuid, pg_temp.got('claim2b', 'claim')::integer, 2,
  'counted', jsonb_build_object(
  'rule', 'prazo-v1', 'trigger', 'day', 'triggerDay', current_date - 4, 'publishedOn', null, 'fromDay', current_date - 4,
  'startsOn', current_date - 3, 'countedDueOn', current_date - 1, 'dueOn', current_date - 1, 'days', 5, 'counting', 'business',
  'skipped', '[]'::jsonb, 'moved', null, 'assumptions', '[]'::jsonb, 'place', jsonb_build_object('court', 'TJGO'))));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('overdue_a', public.firm_deadlines('be100000-0000-4000-8000-00000000000a', 'vencidos'));
insert into res values ('today_overdue', public.firm_today('be100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('count2b', 'code') = 'counted'
  and (select status = 'confirmed' and due_on = current_date + 5 and computed_due_on = current_date - 1 from pg_temp.deadline('d2'))
  and (select r ->> 'urgent_on' = (current_date - 1)::text and (r ->> 'overdue')::boolean
              and r -> 'review_reasons' = '["count_changed"]'::jsonb and r ->> 'due_on' = (current_date + 5)::text
       from res, jsonb_array_elements(payload -> 'rows') r
       where name = 'overdue_a' and r ->> 'id' = pg_temp.got('d2', 'id'))
  and pg_temp.got('today_overdue', 'deadlines_overdue') = '2',
  'a confirmed deadline whose count now gives an earlier day is urgent by it, past its day when that one passed, until confirmed again'
);

-- The publication of a lawsuit the firm did not follow gets its lawsuit: its deadline follows it.
update public.publications set proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid, case_id = pg_temp.got('case_a', 'case_id')::uuid
where id = 'ce100000-0000-4000-8000-000000000002';
select ok(
  (select revision = 2 and proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid and case_id = pg_temp.got('case_a', 'case_id')::uuid
          and count_attempts = 0 and count_error is null
   from pg_temp.deadline('d3')),
  'a deadline of a publication follows the lawsuit the publication is of, and is counted again'
);

-- Its count fails again: the day confirmed by hand stands, and the firm is asked to look at it.
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim3b', jsonb_build_object('claim', c.claim) from public.claim_deadline_counts(1, pg_temp.got('d3', 'id')::uuid) c;
insert into res values ('failed3b', public.record_deadline_count(pg_temp.got('d3', 'id')::uuid, pg_temp.got('claim3b', 'claim')::integer, 2,
  'failed', null, 'too_long'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_retries', public.retry_deadline_count(pg_temp.got('d3', 'id')::uuid));
reset role;
insert into res select 'reasons3', jsonb_build_object('reasons', public.deadline_review_reasons(d)) from public.deadlines d
where d.id = pg_temp.got('d3', 'id')::uuid;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('edu_retries', public.retry_deadline_count(pg_temp.got('d3', 'id')::uuid));
reset role;
select ok(
  pg_temp.got('failed3b', 'code') = 'failed' and pg_temp.got('caio_retries', 'code') = 'not_allowed'
  and (select payload -> 'reasons' = '["count_failed"]'::jsonb from res where name = 'reasons3')
  and pg_temp.got('edu_retries', 'code') = 'retried'
  and (select status = 'confirmed' and due_on = current_date + 6 and count_attempts = 0 and count_error is null
              and public.deadline_review_reasons(d) = '{}'
       from public.deadlines d where d.id = pg_temp.got('d3', 'id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'deadline.count_retried'),
  'a confirmed deadline whose new count failed keeps its day and is shown, and who works on deadlines asks for its count again'
);

-- The court cancels the publication a deadline came from, a minute ago, after the deadline was confirmed (the
-- clock of a test stands still: the confirmation is set back to before it): it is to be looked at again.
update public.deadlines set confirmed_at = now() - interval '2 minutes' where id = pg_temp.got('d1', 'id')::uuid;
update public.publications set active = false, cancelled_at = now() - interval '1 minute', cancel_reason = 'Republicada.'
where id = 'ce100000-0000-4000-8000-000000000001';
select ok(
  (select public.deadline_needs_review(d) and public.deadline_review_reasons(d) = array['publication_cancelled']
   from public.deadlines d where d.id = pg_temp.got('d1', 'id')::uuid),
  'and one whose publication the court cancelled is to be looked at again'
);

-- Counted for the lawsuit's new place, it is confirmed again by who runs the deadlines, who saw the cancelling.
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim1d', jsonb_build_object('claim', c.claim) from public.claim_deadline_counts(1, pg_temp.got('d1', 'id')::uuid) c;
insert into res values ('count1d', public.record_deadline_count(pg_temp.got('d1', 'id')::uuid, pg_temp.got('claim1d', 'claim')::integer, 4,
  'counted',
  '{"rule": "prazo-v1", "trigger": "publication", "triggerDay": "2026-03-02", "publishedOn": "2026-03-03", "startsOn": "2026-03-04",
    "countedDueOn": "2026-03-26", "dueOn": "2026-03-26", "days": 15, "counting": "business", "skipped": [], "moved": null,
    "assumptions": [], "place": {"court": "TJGO"}}'::jsonb));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('keep1', public.confirm_deadline(pg_temp.got('d1', 'id')::uuid, 4, null, null));
reset role;
select ok(
  pg_temp.got('count1d', 'code') = 'counted' and pg_temp.got('keep1', 'code') = 'confirmed'
  and (select public.deadline_review_reasons(d) = '{}' and confirmed_revision = 4 and due_on = date '2026-03-26'
       from public.deadlines d where d.id = pg_temp.got('d1', 'id')::uuid),
  'confirmed again knowing it, it is not asked again'
);

-- ---------- Done, dismissed, reopened, corrected ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('done2', public.complete_deadline(pg_temp.got('d2', 'id')::uuid, 'Protocolado às 10h.'));
insert into res values ('done2_again', public.complete_deadline(pg_temp.got('d2', 'id')::uuid, null));
insert into res values ('reopen2', public.reopen_deadline(pg_temp.got('d2', 'id')::uuid));
insert into res values ('dismiss2_bare', public.dismiss_deadline(pg_temp.got('d2', 'id')::uuid, 'curto'));
insert into res values ('dismiss2', public.dismiss_deadline(pg_temp.got('d2', 'id')::uuid, 'O juiz revogou a ordem de juntada.'));
insert into res values ('update1_same', public.update_deadline(pg_temp.got('d1', 'id')::uuid, 'Manifestação sobre documentos',
  'manifestacao_documentos', 'publication', null, 15, 'business'));
insert into res values ('rename1', public.update_deadline(pg_temp.got('d1', 'id')::uuid, 'Manifestação sobre os documentos novos',
  'manifestacao_documentos', 'publication', null, 15, 'business'));
insert into res select 'renamed1', to_jsonb(d) from public.deadlines d where d.id = pg_temp.got('d1', 'id')::uuid;
insert into res values ('update1', public.update_deadline(pg_temp.got('d1', 'id')::uuid, 'Manifestação sobre documentos',
  'manifestacao_documentos', 'publication', null, 10, 'business'));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_done', public.complete_deadline(pg_temp.got('d3', 'id')::uuid, null));
reset role;

select ok(
  pg_temp.got('done2', 'code') = 'done' and pg_temp.got('done2_again', 'code') = 'closed'
  and pg_temp.got('reopen2', 'code') = 'reopened' and pg_temp.got('dismiss2_bare', 'code') = 'reason_required'
  and pg_temp.got('dismiss2', 'code') = 'dismissed' and pg_temp.got('caio_done', 'code') = 'not_allowed'
  and (select status = 'dismissed' and dismiss_reason = 'O juiz revogou a ordem de juntada.' and done_at is null
              and due_on is null and revision = 3 and confirmed_at is null
       from pg_temp.deadline('d2'))
  and (select count(*) = 1 from public.audit_events where action = 'deadline.done' and entity_id = pg_temp.got('d2', 'id'))
  and (select count(*) = 1 from public.case_events where kind = 'deadline_reopened'),
  'an act done is said so, a deadline marked by mistake is reopened to be counted and confirmed again, and one that never was is dismissed with why'
);

select ok(
  pg_temp.got('update1_same', 'code') = 'unchanged' and pg_temp.got('rename1', 'code') = 'renamed'
  and pg_temp.got('renamed1', 'title') = 'Manifestação sobre os documentos novos'
  and pg_temp.got('renamed1', 'status') = 'confirmed' and pg_temp.got('renamed1', 'revision') = '4'
  and pg_temp.got('renamed1', 'confirmed_by') = 'ae100000-0000-4000-8000-000000000002'
  and pg_temp.got('update1', 'code') = 'updated'
  and (select status = 'proposed' and days = 10 and revision = 5 and due_on is null and not corrected
              and confirmed_by is null and confirmed_against is null and confirmed_revision is null
       from pg_temp.deadline('d1')),
  'what a deadline is counted from, corrected, sends it back to be counted and confirmed; its words alone keep both'
);

-- An act the operator takes off the list stays the act of the deadline that has it; set to run from a day,
-- a deadline of a publication the court took back cannot be set to run from it again.
update public.deadline_acts set active = false where slug = 'manifestacao_documentos';
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('to_day1', public.update_deadline(pg_temp.got('d1', 'id')::uuid, 'Manifestação sobre documentos',
  'manifestacao_documentos', 'day', current_date - 3, 10, 'business'));
insert into res values ('back1', public.update_deadline(pg_temp.got('d1', 'id')::uuid, 'Manifestação sobre documentos',
  'manifestacao_documentos', 'publication', null, 10, 'business'));
insert into res values ('retired_act', public.propose_deadline(null, pg_temp.got('go', 'proceeding_id')::uuid, 'Prazo',
  'manifestacao_documentos', 'day', current_date, 5, 'business'));
reset role;
update public.deadline_acts set active = true where slug = 'manifestacao_documentos';
select ok(
  pg_temp.got('to_day1', 'code') = 'updated' and pg_temp.got('back1', 'code') = 'cancelled'
  and pg_temp.got('retired_act', 'field') = 'act'
  and (select trigger = 'day' and act = 'manifestacao_documentos' from pg_temp.deadline('d1')),
  'an act taken off the list stays a deadline''s own, and no deadline is set anew to run from a publication the court took back'
);

-- ---------- Two firms ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 1 from public.deadlines) and (select org_id = 'be100000-0000-4000-8000-00000000000b' from public.deadlines)
  and (public.firm_today('be100000-0000-4000-8000-00000000000b') ->> 'deadlines_to_confirm') = '1',
  'a firm reads its own deadlines and none of another'
);
select throws_ok(
  $$select public.firm_deadlines('be100000-0000-4000-8000-00000000000a', 'confirmar')$$,
  '42501', 'not_authorized',
  'nor lists another firm''s'
);
select throws_ok(
  $$select public.firm_deadlines('be100000-0000-4000-8000-00000000000b', 'tudo')$$,
  '22023', 'invalid_view',
  'and a list that does not exist is refused'
);
insert into res values ('davi_confirms_a', public.confirm_deadline(pg_temp.got('d1', 'id')::uuid, 5, null, null));
reset role;
select ok(
  pg_temp.got('davi_confirms_a', 'code') = 'not_found',
  'a deadline of another firm is not found by who confirms'
);

-- ---------- The operator's calendar ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('year', public.admin_save_calendar_year('TJGO', 2027, 'https://docs.tjgo.jus.br/feriados-2027.pdf', 'Feriados 2027',
  false, array[' Goiânia ', 'Goiânia', ''], current_date, null));
insert into res values ('year_note', public.admin_save_calendar_year('TJGO', 2027, 'https://docs.tjgo.jus.br/feriados-2027-v2.pdf',
  'Feriados 2027 (versão 2)', false, array['Goiânia'], current_date - 1, 'Conferido de novo.'));
insert into res values ('year_bad', public.admin_save_calendar_year('TJGO', 2027, 'http://inseguro.invalid', null, false, '{}', current_date, null));
insert into res values ('remove_day', public.admin_remove_calendar_day(
  (select id from public.court_calendar_days where court = 'TJGO' and day = date '2026-03-23')));
insert into res values ('remove_year', public.admin_remove_calendar_year('TJGO', 2027));
insert into res values ('act', public.admin_save_deadline_act('contrarrazoes_embargos', 'Contrarrazões aos embargos de declaração', 5,
  'business', '{}', 'CPC, art. 1.023, § 2º', 55, true));
reset role;
select ok(
  pg_temp.got('year', 'code') = 'saved' and pg_temp.got('year_bad', 'code') = 'invalid_value'
  -- A year checked again, its address and its note changed, holds the same days: no count changes.
  and pg_temp.got('year_note', 'code') = 'saved' and pg_temp.got('year_note', 'recounted') = '0'
  and pg_temp.got('remove_day', 'code') = 'removed' and pg_temp.got('remove_year', 'code') = 'removed'
  and pg_temp.got('act', 'code') = 'saved'
  and (select count(*) = 0 from public.court_calendar_years where court = 'TJGO' and year = 2027)
  and (select days = 5 from public.deadline_acts where slug = 'contrarrazoes_embargos')
  and (select count(*) = 2 from public.audit_events where action = 'admin.calendar.year_saved'
       and metadata ->> 'comarcas' = '1'),
  'the operator keeps the calendar: a year checked against its act, a day added or taken back, an act of the list, each on record'
);

select * from finish();
rollback;
