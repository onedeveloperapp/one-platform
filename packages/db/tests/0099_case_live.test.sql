begin;
create extension if not exists pgtap;
select plan(19);

-- ============================================================
-- What a screen needs to say what happens in a case while it is open
-- (0096): the pulse of a case changes when the case changes and says when
-- ONE is looking at it or owes it a look; the pulse of a firm changes when
-- what its home shows changes; a decision is the judgment only when it is
-- said to be, by the app's reading of its words or by a person, and only
-- such a decision marks the case as judged. Two firms: nothing of one
-- reaches the other.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@pulso.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9900000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@pulso.invalid', '', now(), '{}', '{"display_name":"Bia Souto"}', now(), now()),
  ('a9900000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@pulso.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9900000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-pulso', 'a9900000-0000-4000-8000-000000000001'),
  ('b9900000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-pulso', 'a9900000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9900000-0000-4000-8000-00000000000a', 'a9900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9900000-0000-4000-8000-00000000000a', 'a9900000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b9900000-0000-4000-8000-00000000000b', 'a9900000-0000-4000-8000-000000000003', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select ok(
  has_function_privilege('authenticated', 'public.case_pulse(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_pulse(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.firm_pulse(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.firm_pulse(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_publication_judgment(uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_publication_judgment(uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publications_judgment_follows_category()', 'EXECUTE'),
  'the pulses and the word on a judgment are a member''s; the trigger is nobody''s to call'
);

-- Firm A: Ana's case. Firm B: a case of its own.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9900000-0000-4000-8000-00000000000a', 'cancellation', 'LA', date '2026-09-20',
  '{"full_name": "Ana Teste", "cpf": "12345678909", "phone": "5500999998001"}'::jsonb));
insert into res values ('firm_a_before', public.firm_pulse('b9900000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9900000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999998003"}'::jsonb));
reset role;

-- ---------- 1. The pulse of a case ----------

select pg_temp.sign_in('a9900000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('p1', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('p2', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('p1', 'stamp') ~ '^[0-9a-f]{32}$' and pg_temp.got('p1', 'stamp') = pg_temp.got('p2', 'stamp'),
  'anybody of the firm reads the mark of its case, and nothing changed reads the same mark'
);

select pg_temp.sign_in('a9900000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.case_pulse(%L)', pg_temp.got('case', 'case_id')),
  'P0002', 'case_not_found',
  'another firm never reads the mark of a case that is not its own'
);
reset role;

-- A person's write changes the mark.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_case_person(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  '{"profession": "Professora"}'::jsonb);
insert into res values ('p3', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
select isnt(pg_temp.got('p3', 'stamp'), pg_temp.got('p1', 'stamp'), 'a write to the case changes its mark');

-- What the backend writes changes it too: a document ONE checks, as it moves from one state to the next.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
values ('f9900000-0000-4000-8000-000000000001', 'b9900000-0000-4000-8000-00000000000a', 'client',
  'org/b9900000-0000-4000-8000-00000000000a/client/f9900000-0000-4000-8000-000000000001', 'identidade.pdf',
  'application/pdf', 100, 'stored', repeat('d', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (id, org_id, case_id, file_id, kind, party_id, source, status, processing)
select 'd9900000-0000-4000-8000-000000000001', 'b9900000-0000-4000-8000-00000000000a', k.id,
  'f9900000-0000-4000-8000-000000000001', 'identity', cp.id, 'client', 'received', 'pending'
from public.cases k join public.case_parties cp on cp.case_id = k.id
where k.id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('p4', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
update public.case_documents set processing = 'working' where id = 'd9900000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('p5', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('p4', 'stamp') <> pg_temp.got('p3', 'stamp') and pg_temp.got('p5', 'stamp') <> pg_temp.got('p4', 'stamp'),
  'a document that arrives, and ONE starting to check it, each change the mark'
);

-- Whether ONE owes the case a look, and whether it is looking now.
update public.case_advances set woken_at = null, claimed_at = null, checked_at = now(), after = null
where case_id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('idle', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  (select (payload #>> '{advance,due}')::boolean = false and (payload #>> '{advance,running}')::boolean = false
   from res where name = 'idle'),
  'a case ONE looked at, with nothing changed since, owes no look and is not being looked at'
);

select pg_temp.as_backend();
select public.wake_case_advance(pg_temp.got('case', 'case_id')::uuid);
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('woken', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  (select (payload #>> '{advance,due}')::boolean from res where name = 'woken'),
  'something ONE reads changed: the case owes a look at ONE''s next round'
);

update public.case_advances set claimed_at = clock_timestamp() where case_id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('claimed', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
update public.case_advances set claimed_at = now() - interval '2 hours' where case_id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('stale', public.case_pulse(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  (select (payload #>> '{advance,running}')::boolean from res where name = 'claimed')
  and (select (payload #>> '{advance,running}')::boolean = false from res where name = 'stale'),
  'ONE is looking at the case while its claim is fresh; a claim gone stale is no look'
);

-- ---------- 2. The pulse of the firm ----------

select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm_a_after', public.firm_pulse('b9900000-0000-4000-8000-00000000000a'));
insert into res values ('firm_a_again', public.firm_pulse('b9900000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('firm_a_before', 'stamp') ~ '^[0-9a-f]{32}$'
  and pg_temp.got('firm_a_after', 'stamp') <> pg_temp.got('firm_a_before', 'stamp')
  and pg_temp.got('firm_a_after', 'stamp') = pg_temp.got('firm_a_again', 'stamp'),
  'the home''s mark changes with what the firm''s cases did, and reads the same when nothing changed'
);

-- Firm B's work never moves firm A's mark.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000003');
set local role authenticated;
select public.save_case_person(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('case_b', 'person_id')::uuid,
  '{"profession": "Arquiteto"}'::jsonb);
select throws_ok(
  'select public.firm_pulse(''b9900000-0000-4000-8000-00000000000a'')',
  '42501', null,
  'another firm never reads the mark of a firm that is not its own'
);
reset role;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm_a_untouched', public.firm_pulse('b9900000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('firm_a_untouched', 'stamp'), pg_temp.got('firm_a_after', 'stamp'),
  'what another firm does leaves the home''s mark as it was');

-- ---------- 3. A decision is the judgment only when it is ----------

insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, lawyer_ids, case_id)
values
  ('c9900000-0000-4000-8000-000000000001', 'b9900000-0000-4000-8000-00000000000a', 'hashpulso0000001abcdefghijk', 'TJGO',
   '50002023920998090051', current_date, 'Intimação', 'Decisão', 'Defiro a tutela de urgência.',
   array['a9900000-0000-4000-8000-000000000001']::uuid[], pg_temp.got('case', 'case_id')::uuid),
  ('c9900000-0000-4000-8000-000000000002', 'b9900000-0000-4000-8000-00000000000a', 'hashpulso0000002abcdefghijk', 'TJGO',
   '50002023920998090051', current_date, 'Intimação', null, 'Intime-se a parte.',
   array['a9900000-0000-4000-8000-000000000001']::uuid[], pg_temp.got('case', 'case_id')::uuid);
update public.cases set status = 'filed' where id = pg_temp.got('case', 'case_id')::uuid;

select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
select public.triage_publication('c9900000-0000-4000-8000-000000000001', 'decisao', null);
select public.triage_publication('c9900000-0000-4000-8000-000000000002', 'ciencia', null);
reset role;

-- Who does not triage, and another firm, never say what a decision is.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.set_publication_judgment('c9900000-0000-4000-8000-000000000001', true, 'person') ->> 'code', 'not_allowed',
  'who does not triage the firm''s publications never says whether a decision is the judgment');
reset role;
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.set_publication_judgment('c9900000-0000-4000-8000-000000000001', true, 'person') ->> 'code', 'not_found',
  'another firm never reaches the firm''s publication');
reset role;

select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.set_publication_judgment('c9900000-0000-4000-8000-000000000002', true, 'person') ->> 'code', 'not_decision',
  'only a publication triaged as a decision may be the judgment');
-- The rule reads the words once, and never over a word already said.
insert into res values ('rule', public.set_publication_judgment('c9900000-0000-4000-8000-000000000001', false, 'rule'));
insert into res values ('rule_again', public.set_publication_judgment('c9900000-0000-4000-8000-000000000001', true, 'rule'));
insert into res values ('journey_not_judged', public.firm_case_journey('b9900000-0000-4000-8000-00000000000a', null));
reset role;
select ok(
  pg_temp.got('rule', 'code') = 'saved' and pg_temp.got('rule_again', 'code') = 'kept'
  and (select judgment = false and judgment_source = 'rule' from public.publications where id = 'c9900000-0000-4000-8000-000000000001')
  and (select bool_and((g ->> 'decided')::boolean = false) from res, jsonb_array_elements(payload) g where name = 'journey_not_judged'),
  'the app''s reading of the words is kept once, and a decision that is not the judgment judges no case'
);

-- The person's word corrects the rule's, judges the case and is told in its timeline.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('person', public.set_publication_judgment('c9900000-0000-4000-8000-000000000001', true, 'person'));
insert into res values ('journey_judged', public.firm_case_journey('b9900000-0000-4000-8000-00000000000a', null));
reset role;
select ok(
  pg_temp.got('person', 'code') = 'saved'
  and (select judgment and judgment_source = 'person' and judgment_by = 'a9900000-0000-4000-8000-000000000001'
       from public.publications where id = 'c9900000-0000-4000-8000-000000000001')
  and (select bool_or((g ->> 'decided')::boolean) from res, jsonb_array_elements(payload) g where name = 'journey_judged'),
  'a person says the decision is the judgment: the case is judged'
);
select ok(
  exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case', 'case_id')::uuid
          and e.kind = 'publication_judged' and (e.data ->> 'judgment')::boolean)
  and exists (select 1 from public.audit_events a where a.action = 'publication.judgment'
              and a.entity_id = 'c9900000-0000-4000-8000-000000000001'),
  'the word on the judgment is told in the case''s timeline and kept on the record'
);

-- A triage changed to another word takes the word on the judgment with it.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000001');
set local role authenticated;
select public.triage_publication('c9900000-0000-4000-8000-000000000001', 'outro', null);
reset role;
select ok(
  (select judgment is null and judgment_source is null and judgment_by is null
   from public.publications where id = 'c9900000-0000-4000-8000-000000000001'),
  'a publication that is no longer a decision is no judgment'
);

-- Firm B's own case is never judged by firm A's publications.
select pg_temp.sign_in('a9900000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::integer from jsonb_array_elements(public.firm_case_journey('b9900000-0000-4000-8000-00000000000b', null)) g
   where (g ->> 'decided')::boolean),
  0,
  'nothing of firm A judges a case of firm B'
);
reset role;

select * from finish();
rollback;
