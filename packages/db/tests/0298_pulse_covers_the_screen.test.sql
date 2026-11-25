begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- The mark of a case covers everything its screen shows (0298). Firm Lima
-- has a case with a lawsuit and a hearing. What its cards show beyond what
-- the mark already held (a task of the case, who the fees are split with,
-- a stop of the client's notices, ONE's reading of the lawsuit's history,
-- the guide of the hearing) moves the mark when it changes, so the screen
-- reads itself again; and so does ONE giving up on the triage of a
-- publication of the case, which the screen says as "O ONE está triando"
-- for as long as it reads ONE at it. A mark asked twice with nothing
-- changed is the same mark. Firm Prado's case never moves with Lima's, and nobody of Prado
-- reads Lima's mark. Two firms.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2980000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-marca.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a2980000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@prado-marca.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b2980000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-marca', 'a2980000-0000-4000-8000-000000000001'),
  ('b2980000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-marca', 'a2980000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2980000-0000-4000-8000-00000000000a', 'a2980000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2980000-0000-4000-8000-00000000000b', 'a2980000-0000-4000-8000-000000000002', 'owner', 'socio');

-- A case of each firm, with its client; Lima's has a lawsuit and a hearing.
insert into public.cases (id, org_id, seq, module, incident) values
  ('c2980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay'),
  ('c2980000-0000-4000-8000-00000000000b', 'b2980000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay');
insert into public.people (id, org_id, full_name, phone) values
  ('d2980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'Marina Teste', '5562999982981'),
  ('d2980000-0000-4000-8000-00000000000b', 'b2980000-0000-4000-8000-00000000000b', 'Paulo Teste', '5562999982982');
insert into public.case_parties (case_id, org_id, person_id, role) values
  ('c2980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'd2980000-0000-4000-8000-00000000000a', 'claimant'),
  ('c2980000-0000-4000-8000-00000000000b', 'b2980000-0000-4000-8000-00000000000b', 'd2980000-0000-4000-8000-00000000000b', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('e2980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'c2980000-0000-4000-8000-00000000000a', 'juizado', 'TJGO');
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('f2980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'c2980000-0000-4000-8000-00000000000a',
   'e2980000-0000-4000-8000-00000000000a', 'conciliacao', now() + interval '20 days', 'America/Sao_Paulo', 'videoconferencia');

create temporary table marks (name text primary key, stamp text);
grant select, insert on marks to authenticated;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
/** Ana reads the mark of Lima's case, and Caio the mark of Prado's, kept under a name. */
create function pg_temp.read_marks(name text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in('a2980000-0000-4000-8000-000000000001');
  set local role authenticated;
  insert into marks values (name || ':lima', public.case_pulse('c2980000-0000-4000-8000-00000000000a') ->> 'stamp');
  reset role;
  perform pg_temp.sign_in('a2980000-0000-4000-8000-000000000002');
  set local role authenticated;
  insert into marks values (name || ':prado', public.case_pulse('c2980000-0000-4000-8000-00000000000b') ->> 'stamp');
  reset role;
end;
$$;
create function pg_temp.mark(name text) returns text language sql as
$$ select stamp from marks where marks.name = mark.name; $$;

select pg_temp.read_marks('start');
select pg_temp.read_marks('again');
select is(pg_temp.mark('again:lima'), pg_temp.mark('start:lima'), 'asked twice with nothing changed, the mark is the same mark');

-- A task of the case (a case of an area keeps its tasks here).
insert into public.case_tasks (id, org_id, case_id, key, name, who, phase, position) values
  ('12980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'c2980000-0000-4000-8000-00000000000a',
   'juntar_documentos', 'Juntar os documentos', 'escritorio', 'documentos', 1);
select pg_temp.read_marks('task');
select isnt(pg_temp.mark('task:lima'), pg_temp.mark('again:lima'), 'a task of the case moves its mark');
update public.case_tasks set done_at = now(), done_by = 'a2980000-0000-4000-8000-000000000001'
where id = '12980000-0000-4000-8000-00000000000a';
select pg_temp.read_marks('task_done');
select isnt(pg_temp.mark('task_done:lima'), pg_temp.mark('task:lima'), 'and so does marking it as done');

-- Who the fees are split with.
insert into public.case_fee_splits (org_id, case_id, name, document, bar_registration, percent) values
  ('b2980000-0000-4000-8000-00000000000a', 'c2980000-0000-4000-8000-00000000000a', 'Bruno Parceiro', '52998224725', 'GO 12345', 30);
select pg_temp.read_marks('split');
select isnt(pg_temp.mark('split:lima'), pg_temp.mark('task_done:lima'), 'a split of the fees moves the mark');

-- The client asked the firm's notices to stop.
insert into public.notice_stops (person_id, org_id, source) values
  ('d2980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'client');
select pg_temp.read_marks('stop');
select isnt(pg_temp.mark('stop:lima'), pg_temp.mark('split:lima'), 'a stop of the client''s notices moves the mark');

-- ONE reads the history of the lawsuit, and ends the reading.
insert into public.proceeding_history_reads (id, org_id, proceeding_id, case_id) values
  ('22980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'e2980000-0000-4000-8000-00000000000a',
   'c2980000-0000-4000-8000-00000000000a');
select pg_temp.read_marks('history');
select isnt(pg_temp.mark('history:lima'), pg_temp.mark('stop:lima'), 'a reading of the lawsuit''s history asked for moves the mark');
update public.proceeding_history_reads set status = 'done', read_at = now(), seen = 4, kept = 3, left_out = 1
where id = '22980000-0000-4000-8000-00000000000a';
select pg_temp.read_marks('history_done');
select isnt(pg_temp.mark('history_done:lima'), pg_temp.mark('history:lima'), 'and so does the reading that ended');

-- The guide of the hearing is made.
insert into public.hearing_briefs (org_id, case_id, hearing_id, body) values
  ('b2980000-0000-4000-8000-00000000000a', 'c2980000-0000-4000-8000-00000000000a', 'f2980000-0000-4000-8000-00000000000a',
   'Guia da audiência de conciliação, para quem vai a ela.');
select pg_temp.read_marks('brief');
select isnt(pg_temp.mark('brief:lima'), pg_temp.mark('history_done:lima'), 'the guide of a hearing, once made, moves the mark');

-- A publication of the lawsuit nobody triaged: ONE is on it (the firm lets it triage, the default), then its tries
-- are spent and it is left to a person. The screen reads that state, and nothing else of the row a member reads
-- changes with it.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, case_id, proceeding_id) values
  ('32980000-0000-4000-8000-00000000000a', 'b2980000-0000-4000-8000-00000000000a', 'marcatriagem0001', 'TJGO',
   '50002023920998090051', current_date, 'Intimação', 'Texto inventado de uma intimação.',
   'c2980000-0000-4000-8000-00000000000a', 'e2980000-0000-4000-8000-00000000000a');
select pg_temp.read_marks('triaging');
select pg_temp.sign_in('a2980000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select state from public.publication_triage_states(array['32980000-0000-4000-8000-00000000000a']::uuid[])),
  'working', 'ONE is on the triage of the publication nobody triaged');
reset role;
update public.publications set ai_attempts = greatest(public.publications_setting('max_attempts', 3), 1)
where id = '32980000-0000-4000-8000-00000000000a';
select pg_temp.read_marks('triage_left');
select isnt(pg_temp.mark('triage_left:lima'), pg_temp.mark('triaging:lima'),
  'ONE giving up on the triage of a publication moves the mark: the screen stops saying ONE is at it');

select is(pg_temp.mark('triage_left:prado'), pg_temp.mark('start:prado'), 'nothing of Lima''s case ever moved the mark of Prado''s');

-- The answer is as before: the mark, and whether ONE looks at the case.
select pg_temp.sign_in('a2980000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (public.case_pulse('c2980000-0000-4000-8000-00000000000a') ->> 'stamp') ~ '^[0-9a-f]{32}$'
  and public.case_pulse('c2980000-0000-4000-8000-00000000000a') -> 'advance' ? 'running'
  and public.case_pulse('c2980000-0000-4000-8000-00000000000a') -> 'advance' ? 'due',
  'the pulse still answers a mark of 32 hex digits, and whether ONE looks at the case or owes it a look');
reset role;

select pg_temp.sign_in('a2980000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.case_pulse('c2980000-0000-4000-8000-00000000000a') $$,
  'P0002', 'case_not_found', 'nobody of Prado reads the mark of Lima''s case');
reset role;

select * from finish();
rollback;
