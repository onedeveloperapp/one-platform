begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- A sessão de julgamento do recurso e a inscrição para sustentação oral
-- (0219). The Turma Recursal publishes the pauta of Ana's firm's recurso:
-- ONE records the virtual session on its first day, never from a text that
-- withdraws something; the backend counts the limit to register by the
-- court's rule, again when the session changes; a lawyer says the firm
-- registered; the agenda hands out the session and its limit; a new pauta
-- replaces the session to come, and a person withdraws one with why. The
-- other firm records its own presencial session by hand, and nothing of one
-- firm reaches the other. The client hears nothing of it.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2190000-0000-4000-8000-000000000001', 'ana@souza-sessao.invalid', 'Ana Souza'),
  ('a2190000-0000-4000-8000-000000000002', 'caio@rocha-sessao.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2190000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-sessao', 'a2190000-0000-4000-8000-000000000001'),
  ('b2190000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-sessao', 'a2190000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2190000-0000-4000-8000-00000000000a', 'a2190000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2190000-0000-4000-8000-00000000000b', 'a2190000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2190000-0000-4000-8000-000000000001', 'b2190000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2190000-0000-4000-8000-000000000002', 'b2190000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, system, comarca, status, cnj, filed_at) values
  ('f2190000-0000-4000-8000-000000000001', 'b2190000-0000-4000-8000-00000000000a', 'c2190000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'projudi', 'Goiânia', 'filed', '10003012720998090100', '2025-08-01'),
  ('f2190000-0000-4000-8000-000000000002', 'b2190000-0000-4000-8000-00000000000b', 'c2190000-0000-4000-8000-000000000002',
   'comum', 'TJGO', 'projudi', 'Goiânia', 'filed', '00051016820998090051', '2025-08-01');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('f2190000-0000-4000-8000-000000000001', 'a2190000-0000-4000-8000-000000000001', 'b2190000-0000-4000-8000-00000000000a');

create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.br(d date) returns text language sql as $$ select to_char(d, 'DD/MM/YYYY') $$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

-- ---------- ONE reads the pauta ----------

insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, proceeding_id, case_id,
                                 category, triaged_at) values
  ('ce219000-0000-4000-8000-0000000000a1', 'b2190000-0000-4000-8000-00000000000a', 'sessaoone00000a1', 'TJGO',
   '10003012720998090100', current_date, 'Intimação', 'Pauta',
   'PAUTA DE JULGAMENTO. Sessão virtual de julgamento da 1ª Turma Recursal com início em '
     || pg_temp.br(current_date + 10) || ' às 10h00 e término em ' || pg_temp.br(current_date + 17)
     || ' às 18h00. Recurso Inominado. Intimem-se.',
   'f2190000-0000-4000-8000-000000000001', 'c2190000-0000-4000-8000-000000000001', 'ciencia', now()),
  -- A text that withdraws a lawsuit from the pauta is a person's to read.
  ('ce219000-0000-4000-8000-0000000000a2', 'b2190000-0000-4000-8000-00000000000a', 'sessaoone00000a2', 'TJGO',
   '10003012720998090100', current_date, 'Intimação', 'Pauta',
   'Processo retirado de pauta da sessão virtual de julgamento de ' || pg_temp.br(current_date + 30) || '.',
   'f2190000-0000-4000-8000-000000000001', 'c2190000-0000-4000-8000-000000000001', 'ciencia', now());

select ok(
  (select count(*) = 1 from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001')
    and (select kind = 'virtual' and starts_on = current_date + 10 and starts_at is null and source = 'publication'
                and publication_id = 'ce219000-0000-4000-8000-0000000000a1' and status = 'scheduled'
         from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001')
    and exists (select 1 from public.case_events e
                where e.case_id = 'c2190000-0000-4000-8000-000000000001' and e.kind = 'judgment_session_recorded'
                  and e.actor_type = 'system'),
  'ONE records the virtual session on the first day the pauta names, never from a text that withdraws one'
);

select ok(
  not exists (select 1 from public.hearings where case_id = 'c2190000-0000-4000-8000-000000000001')
    and not exists (select 1 from public.client_notices where case_id = 'c2190000-0000-4000-8000-000000000001'),
  'a session is no hearing, and the client is told nothing of it'
);

-- ---------- The backend counts the limit ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('to-count', coalesce((select jsonb_agg(to_jsonb(t)) from public.sessions_to_count(20) t), '[]'::jsonb));
reset role;
select ok(
  (select jsonb_array_length(value) = 1
          and value #>> '{0,until_kind}' = 'previous_business_day' and value #>> '{0,until_hour}' = '10:00:00'
          and value #>> '{0,basis}' like '%Resolução nº 225/2023), art. 78, § 1º'
          and value #>> '{0,comarca}' = 'Goiânia' and value #>> '{0,proceeding_kind}' = 'juizado'
   from res where key = 'to-count'),
  'the session is counted by the rule of the Turma Recursal, with the lawsuit''s place'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('counted', public.record_session_limit(
  (select id from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001'), 1,
  jsonb_build_object('on', (current_date + 9)::text, 'hour', '10:00', 'basis', 'Resolução nº 225/2023, art. 78, § 1º',
                     'passed', '[]'::jsonb, 'rule', 'sustentacao-v1')));
reset role;
select pg_temp.sign_in('a2190000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana-reads', public.case_judgment_sessions('c2190000-0000-4000-8000-000000000001'));
reset role;
select ok(
  (select value ->> 'code' = 'recorded' from res where key = 'counted')
    and (select (value #>> '{sessions,0,counted}')::boolean and value #>> '{sessions,0,limit_on}' = (current_date + 9)::text
                and value #>> '{sessions,0,limit_hour}' = '10:00:00'
         from res where key = 'ana-reads'),
  'the limit the backend counted is the case''s to read'
);

-- A change of the session is counted again; a count of the revision before is left out.
update public.judgment_sessions set starts_at = '14:00'
where proceeding_id = 'f2190000-0000-4000-8000-000000000001';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale', public.record_session_limit(
  (select id from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001'), 1,
  jsonb_build_object('on', (current_date + 9)::text, 'hour', '10:00', 'basis', 'x', 'rule', 'sustentacao-v1')));
insert into res values ('again', coalesce((select jsonb_agg(session_id) from public.sessions_to_count(20)), '[]'::jsonb));
reset role;
select ok(
  (select value ->> 'code' = 'changed' from res where key = 'stale')
    and (select jsonb_array_length(value) = 1 from res where key = 'again')
    and (select revision = 2 from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001'),
  'a change of the session is a new revision, counted again, and a count of the one before is refused'
);

-- ---------- A lawyer says the firm registered; the agenda hands it out ----------

select pg_temp.as_backend();
set local role service_role;
select public.record_session_limit(
  (select id from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001'), 2,
  jsonb_build_object('on', (current_date + 9)::text, 'hour', '10:00', 'basis', 'Resolução nº 225/2023, art. 78, § 1º',
                     'rule', 'sustentacao-v1'));
reset role;
select pg_temp.sign_in('a2190000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('oral', public.decide_oral_argument(
  (select id from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000001'), 'registered'));
insert into res values ('agenda', public.firm_agenda('b2190000-0000-4000-8000-00000000000a', current_date, current_date + 20));
reset role;
select ok(
  (select value ->> 'code' = 'decided' from res where key = 'oral')
    and (select jsonb_array_length(value -> 'sessions') = 1
                and value #>> '{sessions,0,kind}' = 'virtual'
                and value #>> '{sessions,0,starts_on}' = (current_date + 10)::text
                and value #>> '{sessions,0,limit_on}' = (current_date + 9)::text
                and value #>> '{sessions,0,oral_choice}' = 'registered'
                and value #> '{sessions,0,people}' = '["a2190000-0000-4000-8000-000000000001"]'::jsonb
         from res where key = 'agenda')
    and exists (select 1 from public.audit_events where action = 'judgment_session.oral_decided'
                and org_id = 'b2190000-0000-4000-8000-00000000000a'),
  'the lawyer says the firm registered to argue, and the agenda hands out the session with its limit, to the lawsuit''s lawyer'
);

-- ---------- A new pauta replaces the session to come ----------

insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, proceeding_id, case_id,
                                 category, triaged_at) values
  ('ce219000-0000-4000-8000-0000000000a3', 'b2190000-0000-4000-8000-00000000000a', 'sessaoone00000a3', 'TJGO',
   '10003012720998090100', current_date + 1, 'Intimação', 'Pauta',
   'Pauta de julgamento. Sessão de julgamento presencial em ' || pg_temp.br(current_date + 24) || ', às 14h. Intimem-se.',
   'f2190000-0000-4000-8000-000000000001', 'c2190000-0000-4000-8000-000000000001', 'ciencia', now());
select ok(
  (select status = 'withdrawn' and withdraw_reason = 'Uma nova pauta do processo marcou outra sessão.'
   from public.judgment_sessions where publication_id = 'ce219000-0000-4000-8000-0000000000a1')
    and (select kind = 'presencial' and starts_on = current_date + 24 and starts_at = '14:00' and status = 'scheduled'
         from public.judgment_sessions where publication_id = 'ce219000-0000-4000-8000-0000000000a3'),
  'a new pauta of the lawsuit replaces the session to come, with why, and a presencial one keeps its hour'
);

-- ---------- The other firm records its own; nothing crosses ----------

select pg_temp.sign_in('a2190000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b-records', public.record_judgment_session('f2190000-0000-4000-8000-000000000002', 'presencial',
  current_date + 5, '09:00'));
insert into res values ('b-twice', public.record_judgment_session('f2190000-0000-4000-8000-000000000002', 'presencial',
  current_date + 5, '09:00'));
insert into res values ('b-reads-a', public.case_judgment_sessions('c2190000-0000-4000-8000-000000000001'));
insert into res values ('b-agenda', public.firm_agenda('b2190000-0000-4000-8000-00000000000b', current_date, current_date + 30));
select throws_ok(
  $$ select public.record_judgment_session('f2190000-0000-4000-8000-000000000001', 'virtual', current_date + 5, null) $$,
  'P0002', null,
  'another firm records nothing in the case'
);
reset role;
select ok(
  (select value ->> 'code' = 'recorded' from res where key = 'b-records')
    and (select value ->> 'code' = 'already' from res where key = 'b-twice')
    and (select value ->> 'code' = 'case_not_found' from res where key = 'b-reads-a')
    and (select jsonb_array_length(value -> 'sessions') = 1 and value #>> '{sessions,0,kind}' = 'presencial'
         from res where key = 'b-agenda'),
  'a person records a session ONE did not read, once, and one firm reads nothing of the other''s'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('b-count', coalesce((
  select jsonb_agg(to_jsonb(t)) from public.sessions_to_count(20) t
  where t.session_id = (select id from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000002')
), '[]'::jsonb));
reset role;
select ok(
  (select value #>> '{0,until_kind}' = 'session_start' and value #>> '{0,basis}' like 'Regimento Interno do TJGO, art. 150%'
   from res where key = 'b-count'),
  'a presencial session of the chambers is counted by the opening of the session (RITJGO, art. 150)'
);

-- ---------- A person withdraws one ----------

select pg_temp.sign_in('a2190000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b-withdraws', public.withdraw_judgment_session(
  (select id from public.judgment_sessions where proceeding_id = 'f2190000-0000-4000-8000-000000000002'), 'Adiada pelo relator.'));
insert into res values ('b-agenda-after', public.firm_agenda('b2190000-0000-4000-8000-00000000000b', current_date, current_date + 30));
reset role;
select ok(
  (select value ->> 'code' = 'withdrawn' from res where key = 'b-withdraws')
    and (select jsonb_array_length(value -> 'sessions') = 0 from res where key = 'b-agenda-after'),
  'a session withdrawn with why leaves the agenda'
);

select * from finish();
rollback;
