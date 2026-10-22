begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ============================================================
-- A firm that starts ready, and what waits for somebody (0044).
--
-- Who manages a firm answers its first questions once: whether it works alone
-- (which takes the team out of its list) and that the setup is answered. The
-- list reads facts: a registration at the bar with somebody chosen to sign, the
-- team, the channel, the first case. What waits for somebody is the firm's to
-- read: the cases where ONE waits for a person and since when, the deadlines
-- past their day, and the deadlines, hearings and papers of today. Two firms:
-- neither answers nor reads the other's.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a5100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a5100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a5100000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia) and Bruno (member, atendimento). Firm B: Davi (owner, advogado), alone.
insert into public.organizations (id, name, slug, created_by) values
  ('b5100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a5100000-0000-4000-8000-000000000001'),
  ('b5100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a5100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5100000-0000-4000-8000-00000000000a', 'a5100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5100000-0000-4000-8000-00000000000a', 'a5100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b5100000-0000-4000-8000-00000000000b', 'a5100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.facts(name text) returns jsonb language sql as
$$ select payload from res where res.name = facts.name; $$;

-- ---------- The first questions ----------

select pg_temp.sign_in('a5100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_new', public.firm_setup_facts('b5100000-0000-4000-8000-00000000000b'));
insert into res values ('b_alone', public.answer_firm_setup('b5100000-0000-4000-8000-00000000000b', true, false));
insert into res values ('b_alone_facts', public.firm_setup_facts('b5100000-0000-4000-8000-00000000000b'));
insert into res values ('b_done', public.answer_firm_setup('b5100000-0000-4000-8000-00000000000b', null, true));
insert into res values ('b_done_facts', public.firm_setup_facts('b5100000-0000-4000-8000-00000000000b'));
insert into res values ('b_nothing', public.answer_firm_setup('b5100000-0000-4000-8000-00000000000b'));
select throws_ok(
  $$select public.answer_firm_setup('b5100000-0000-4000-8000-00000000000a', true, true)$$,
  '42501', 'not_authorized',
  'who manages a firm does not answer for another'
);
select throws_ok(
  $$select public.firm_setup_facts('b5100000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'nor reads its list'
);
reset role;

select ok(
  (select payload ->> 'setup_answered' = 'false' and payload ->> 'works_alone' = 'false'
          and payload ->> 'oab_signer' = 'false' and payload ->> 'first_case' = 'false' and payload ->> 'channel' = 'false'
          and not (payload ? 'firm_document' and payload ->> 'firm_document' = 'true')
   from res where name = 'b_new'),
  'a firm just founded has answered nothing and has nothing of its list done'
);
select ok(
  (select payload ->> 'code' = 'saved' from res where name = 'b_alone')
    and (select payload ->> 'works_alone' = 'true' and payload ->> 'team' = 'false' and payload ->> 'setup_answered' = 'false'
         from res where name = 'b_alone_facts'),
  'a firm that works alone says so, and the list knows it without a second person'
);
select ok(
  (select payload ->> 'setup_answered' = 'true' and payload ->> 'works_alone' = 'true' from res where name = 'b_done_facts')
    and (select works_alone and setup_answered_at is not null from public.organizations where id = 'b5100000-0000-4000-8000-00000000000b'),
  'answering the rest keeps the first answer, and says the setup was answered'
);
select is((select payload ->> 'code' from res where name = 'b_nothing'), 'invalid_data', 'an answer of nothing is refused');
select is(
  (select count(*)::int from public.audit_events where action = 'firm.setup_answered' and org_id = 'b5100000-0000-4000-8000-00000000000b'),
  2,
  'each answer is on the record'
);

-- Bruno works at firm A but does not manage it.
select pg_temp.sign_in('a5100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.answer_firm_setup('b5100000-0000-4000-8000-00000000000a', false, true)$$,
  '42501', 'not_authorized',
  'somebody who does not manage the firm does not answer its setup'
);
reset role;

-- Support visits Ana: nothing is answered in her name.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a5100000-0000-4000-8000-000000000009', 'a5100000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-00000000000a',
        'Conferindo a configuração', 'f5100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a5100000-0000-4000-8000-000000000001', 'aal2', 'f5100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.answer_firm_setup('b5100000-0000-4000-8000-00000000000a', false, true)$$,
  '42501', 'not_allowed_in_support_session',
  'nor does a support visit'
);
reset role;

-- Ana registers at the bar and chooses herself to sign; the firm opens its first case.
select pg_temp.sign_in('a5100000-0000-4000-8000-000000000001');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a5100000-0000-4000-8000-000000000001', 'GO', '12345', 'principal');
select pg_temp.sign_in('a5100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_oab_only', public.firm_setup_facts('b5100000-0000-4000-8000-00000000000a'));
insert into res values ('a_signs', public.set_firm_signer('b5100000-0000-4000-8000-00000000000a',
  'a5100000-0000-4000-8000-000000000001', true));
insert into res values ('a_signer', public.firm_setup_facts('b5100000-0000-4000-8000-00000000000a'));
reset role;

insert into public.people (id, org_id, full_name) values
  ('c5100000-0000-4000-8000-00000000000a', 'b5100000-0000-4000-8000-00000000000a', 'Mariana Duarte'),
  ('c5100000-0000-4000-8000-00000000000b', 'b5100000-0000-4000-8000-00000000000b', 'Paulo Henrique Lima');
insert into public.cases (id, org_id, seq, incident) values
  ('d5100000-0000-4000-8000-00000000000a', 'b5100000-0000-4000-8000-00000000000a', 1, 'cancellation'),
  ('d5100000-0000-4000-8000-00000000000c', 'b5100000-0000-4000-8000-00000000000a', 2, 'delay'),
  ('d5100000-0000-4000-8000-00000000000b', 'b5100000-0000-4000-8000-00000000000b', 1, 'delay');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e5100000-0000-4000-8000-00000000000a', 'b5100000-0000-4000-8000-00000000000a', 'd5100000-0000-4000-8000-00000000000a',
   'c5100000-0000-4000-8000-00000000000a', 'claimant'),
  ('e5100000-0000-4000-8000-00000000000b', 'b5100000-0000-4000-8000-00000000000b', 'd5100000-0000-4000-8000-00000000000b',
   'c5100000-0000-4000-8000-00000000000b', 'claimant');

select pg_temp.sign_in('a5100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_case', public.firm_setup_facts('b5100000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  (select payload ->> 'oab' = 'true' and payload ->> 'oab_signer' = 'false' from res where name = 'a_oab_only')
    and (select payload ->> 'code' = 'saved' from res where name = 'a_signs')
    and (select payload ->> 'oab_signer' = 'true' and payload ->> 'first_case' = 'false' from res where name = 'a_signer'),
  'the registration at the bar counts for the list once somebody is chosen to sign what ONE prepares'
);
select ok(
  (select payload ->> 'first_case' = 'true' and payload ->> 'team' = 'true' and payload ->> 'works_alone' = 'false'
   from res where name = 'a_case'),
  'the first case counts, and a firm of two has its team'
);

-- ---------- Since when ONE waits ----------

update public.case_advances set waiting = 'claims_missing' where case_id = 'd5100000-0000-4000-8000-00000000000a';
insert into res values ('since_1', (select to_jsonb(waiting_since) from public.case_advances where case_id = 'd5100000-0000-4000-8000-00000000000a'));
-- The same wait said again keeps its moment; another wait starts its own.
update public.case_advances set waiting_since = now() - interval '3 days' where case_id = 'd5100000-0000-4000-8000-00000000000a';
update public.case_advances set waiting = 'claims_missing' where case_id = 'd5100000-0000-4000-8000-00000000000a';
insert into res values ('since_same', (select to_jsonb(waiting_since) from public.case_advances where case_id = 'd5100000-0000-4000-8000-00000000000a'));
update public.case_advances set waiting = 'unavailable' where case_id = 'd5100000-0000-4000-8000-00000000000c';
update public.case_advances set waiting = 'no_signer' where case_id = 'd5100000-0000-4000-8000-00000000000b';

select ok(
  (select payload is not null and payload <> 'null'::jsonb from res where name = 'since_1')
    and (select (payload #>> '{}')::timestamptz < now() - interval '2 days' from res where name = 'since_same'),
  'a wait is dated when it starts, and saying it again does not move it'
);

update public.case_advances set waiting = null where case_id = 'd5100000-0000-4000-8000-00000000000c';
select ok(
  (select waiting_since is null from public.case_advances where case_id = 'd5100000-0000-4000-8000-00000000000c'),
  'a case that waits for nothing has no moment'
);
update public.case_advances set waiting = 'unavailable' where case_id = 'd5100000-0000-4000-8000-00000000000c';

-- ---------- What waits for somebody ----------

insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('f5100000-0000-4000-8000-00000000000a', 'b5100000-0000-4000-8000-00000000000a', 'd5100000-0000-4000-8000-00000000000a', 'juizado', 'TJGO');
insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting, due_on) values
  ('b5100000-0000-4000-8000-00000000000a', '50002023920998090051', 'TJGO', 'd5100000-0000-4000-8000-00000000000a',
   'f5100000-0000-4000-8000-00000000000a', 'Manifestação sobre documentos', 'day',
   (now() at time zone 'America/Sao_Paulo')::date - 20, 10, 'business', (now() at time zone 'America/Sao_Paulo')::date - 3),
  ('b5100000-0000-4000-8000-00000000000a', '50002023920998090051', 'TJGO', 'd5100000-0000-4000-8000-00000000000a',
   'f5100000-0000-4000-8000-00000000000a', 'Réplica', 'day',
   (now() at time zone 'America/Sao_Paulo')::date - 10, 10, 'business', (now() at time zone 'America/Sao_Paulo')::date);
insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('b5100000-0000-4000-8000-00000000000a', 'd5100000-0000-4000-8000-00000000000a', 'f5100000-0000-4000-8000-00000000000a',
   'conciliacao', ((now() at time zone 'America/Sao_Paulo')::date + time '12:00') at time zone 'America/Sao_Paulo',
   'America/Sao_Paulo', 'videoconferencia');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('a5110000-0000-4000-8000-00000000000a', 'b5100000-0000-4000-8000-00000000000a', 'client',
   'org/b5100000-0000-4000-8000-00000000000a/client/a5110000-0000-4000-8000-00000000000a',
   'identidade.pdf', 'application/pdf', 100, 'stored', repeat('a', 64), 100, 'application/pdf', now() + interval '1 hour', now()),
  ('a5110000-0000-4000-8000-00000000000c', 'b5100000-0000-4000-8000-00000000000a', 'client',
   'org/b5100000-0000-4000-8000-00000000000a/client/a5110000-0000-4000-8000-00000000000c',
   'comprovante.pdf', 'application/pdf', 100, 'stored', repeat('c', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (org_id, case_id, file_id, kind, source, status, created_at) values
  ('b5100000-0000-4000-8000-00000000000a', 'd5100000-0000-4000-8000-00000000000a', 'a5110000-0000-4000-8000-00000000000a',
   'identity', 'client', 'received', now() - interval '30 hours'),
  ('b5100000-0000-4000-8000-00000000000a', 'd5100000-0000-4000-8000-00000000000a', 'a5110000-0000-4000-8000-00000000000c',
   'address_proof', 'client', 'received', now() - interval '2 hours');

select pg_temp.sign_in('a5100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('a_pending', public.firm_pending('b5100000-0000-4000-8000-00000000000a'));
select throws_ok(
  $$select public.firm_pending('b5100000-0000-4000-8000-00000000000b')$$,
  '42501', 'not_authorized',
  'a person reads what waits in their own firm only'
);
reset role;

select pg_temp.sign_in('a5100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_pending', public.firm_pending('b5100000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  (select jsonb_array_length(payload -> 'one_waits') = 1
          and payload -> 'one_waits' -> 0 ->> 'case_id' = 'd5100000-0000-4000-8000-00000000000a'
          and payload -> 'one_waits' -> 0 ->> 'waiting' = 'claims_missing'
          and payload -> 'one_waits' -> 0 ->> 'client' = 'Mariana Duarte'
          and (payload -> 'one_waits' -> 0 ->> 'seq')::int = 1
          and payload -> 'one_waits' -> 0 ->> 'since' is not null
   from res where name = 'a_pending'),
  'a case where ONE waits for a person is listed with its client, what it waits for and since when'
);
select ok(
  (select (payload ->> 'one_waits_total')::int = 1 and (payload ->> 'one_waits_stale')::int = 1 from res where name = 'a_pending'),
  'a passing failure ONE tries again waits for nobody, and a wait of three days is counted as old'
);
select ok(
  (select jsonb_array_length(payload -> 'deadlines_overdue') = 1
          and payload -> 'deadlines_overdue' -> 0 ->> 'title' = 'Manifestação sobre documentos'
          and payload -> 'deadlines_overdue' -> 0 ->> 'case_id' = 'd5100000-0000-4000-8000-00000000000a'
          and (payload -> 'deadlines_overdue' -> 0 ->> 'seq')::int = 1
   from res where name = 'a_pending'),
  'a deadline past its day is listed with its case'
);
select ok(
  (select (payload ->> 'deadlines_today')::int = 1 and (payload ->> 'hearings_today')::int = 1 from res where name = 'a_pending'),
  'the deadline and the hearing of today are counted'
);
select ok(
  (select (payload ->> 'documents_stale')::int = 1 and (payload ->> 'documents_stale_hours')::int = 24 from res where name = 'a_pending'),
  'a paper nobody decided for more than the setting''s hours is counted, a paper of two hours is not'
);
select ok(
  (select jsonb_array_length(payload -> 'one_waits') = 1
          and payload -> 'one_waits' -> 0 ->> 'case_id' = 'd5100000-0000-4000-8000-00000000000b'
          and jsonb_array_length(payload -> 'deadlines_overdue') = 0
          and (payload ->> 'documents_stale')::int = 0 and (payload ->> 'hearings_today')::int = 0
   from res where name = 'b_pending'),
  'the other firm reads its own waits and none of the first firm''s'
);

update public.cases set status = 'closed', closed_at = now() where id = 'd5100000-0000-4000-8000-00000000000b';
select pg_temp.sign_in('a5100000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select jsonb_array_length(public.firm_pending('b5100000-0000-4000-8000-00000000000b') -> 'one_waits')),
  0,
  'a case that ended waits for nobody'
);
reset role;

select * from finish();
rollback;
