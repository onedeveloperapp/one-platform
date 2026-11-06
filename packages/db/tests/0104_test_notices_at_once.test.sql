begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- In a test case, what the test court causes reaches the client at once
-- (0103): a hearing marked minutes ahead is due to its client the moment it
-- is written, and so are the word that the lawsuit was filed and the warning
-- against the scam; a real case waits its minutes as before, and its
-- reminder of the day ends an hour before the hearing. Two firms: nothing of
-- one reaches the other.
--
-- Every person, firm and number here is invented: the phones are of an area
-- code no carrier has, and the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1040000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@avisoteste.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1040000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@avisoteste.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1040000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-aviso-teste', 'a1040000-0000-4000-8000-000000000001'),
  ('b1040000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-aviso-teste', 'a1040000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1040000-0000-4000-8000-00000000000a', 'a1040000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1040000-0000-4000-8000-00000000000b', 'a1040000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case with its client, a lawsuit filed today and a conciliation hearing in three days; `test` marks it a case of
-- the test chat before its lawsuit exists, as the test chat's yes does.
create function pg_temp.lawsuit(name text, who uuid, org uuid, cnj text, phone text, test boolean) returns void
language plpgsql as $$
declare
  made jsonb;
  filed jsonb;
  hearing jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02', 'phone', phone));
  reset role;
  if test then
    update public.cases set is_test = true where id = (made ->> 'case_id')::uuid;
  end if;
  perform pg_temp.sign_in(who);
  set local role authenticated;
  filed := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', cnj, 'filed_at', to_char(current_date, 'YYYY-MM-DD')),
    array[(made ->> 'party_id')::uuid]);
  hearing := public.save_hearing(null, (filed ->> 'proceeding_id')::uuid,
    jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', to_char(current_date + 3, 'YYYY-MM-DD'),
      'time', '10:00', 'place', 'Sala de audiências do 1º Juizado Especial Cível'));
  reset role;
  insert into res values (name, made || jsonb_build_object('proceeding_id', filed ->> 'proceeding_id',
    'hearing_id', hearing ->> 'id', 'filed_code', filed ->> 'code', 'hearing_code', hearing ->> 'code'));
end;
$$;

-- What is due in a firm, of one case.
create function pg_temp.due(org uuid, name text, what text) returns bigint language sql as
$$ select count(*) from public.notice_candidates(org, null) c
   where c.case_id = pg_temp.got(due.name, 'case_id')::uuid and c.kind = due.what
     and c.person_id = pg_temp.got(due.name, 'person_id')::uuid; $$;

select pg_temp.lawsuit('real', 'a1040000-0000-4000-8000-000000000001', 'b1040000-0000-4000-8000-00000000000a',
  '5000501-16.2099.8.09.0051', '5500999104001', false);
select pg_temp.lawsuit('teste', 'a1040000-0000-4000-8000-000000000001', 'b1040000-0000-4000-8000-00000000000a',
  '5000502-98.2099.8.09.0051', '5500999104002', true);
select pg_temp.lawsuit('outra', 'a1040000-0000-4000-8000-000000000002', 'b1040000-0000-4000-8000-00000000000b',
  '5000503-83.2099.8.09.0051', '5500999104003', true);

-- The test court marks the hearing minutes ahead: both of firm A are moved to ten minutes from now, written now;
-- after 23:50 in Brasília, to before midnight, so the reminder of the day is of today (the test ran at 23:51).
create function pg_temp.soon() returns timestamptz language sql stable as
$$ select now() + least(interval '10 minutes',
     ((date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo'
      - now()) / 2); $$;
update public.hearings set starts_at = pg_temp.soon()
where id in (pg_temp.got('real', 'hearing_id')::uuid, pg_temp.got('teste', 'hearing_id')::uuid);

select ok(
  pg_temp.got('real', 'filed_code') is not null and pg_temp.got('real', 'hearing_id') is not null
  and pg_temp.got('teste', 'hearing_id') is not null and pg_temp.got('outra', 'hearing_id') is not null
  and (select is_test from public.cases where id = pg_temp.got('teste', 'case_id')::uuid)
  and not (select is_test from public.cases where id = pg_temp.got('real', 'case_id')::uuid)
  and not has_function_privilege('authenticated', 'public.notice_candidates(uuid, uuid)', 'EXECUTE')
  and (select count(*) = 2 from public.hearings
       where id in (pg_temp.got('real', 'hearing_id')::uuid, pg_temp.got('teste', 'hearing_id')::uuid)
         and starts_at = pg_temp.soon() and changed_at = now()),
  'a real case and a test case of one firm, each with a hearing ten minutes ahead written a moment ago'
);

-- ---------- The hearing ----------

select ok(
  (select count(*) = 1 from public.notice_candidates('b1040000-0000-4000-8000-00000000000a', null) c
   where c.kind = 'hearing_reminder' and c.hearing_id = pg_temp.got('teste', 'hearing_id')::uuid
     and c.person_id = pg_temp.got('teste', 'person_id')::uuid and c.occurrence like '%:day'
     and c.closes = pg_temp.soon()),
  'the client of a test case is due the reminder of the day the moment the hearing is written, until it starts'
);

select ok(
  pg_temp.due('b1040000-0000-4000-8000-00000000000a', 'real', 'hearing_reminder') = 0,
  'the client of a real case is not: the hearing was written a moment ago and starts within the hour'
);

update public.hearings set starts_at = now() + interval '3 hours' where id = pg_temp.got('real', 'hearing_id')::uuid;
update public.hearings set changed_at = now() - interval '20 minutes' where id = pg_temp.got('real', 'hearing_id')::uuid;
select ok(
  pg_temp.due('b1040000-0000-4000-8000-00000000000a', 'real', 'hearing_reminder') = 1,
  'a real hearing written twenty minutes ago and three hours ahead is due, as before'
);

-- ---------- The filing and the payment ----------

insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, category, triaged_by, triaged_at,
  proceeding_id, case_id) values
  ('c1040000-0000-4000-8000-000000000001', 'b1040000-0000-4000-8000-00000000000a', 'avisotestehash01', 'TJGO',
   '50005011620998090051', current_date, 'Intimação', 'Expeça-se alvará.', 'pagamento',
   'a1040000-0000-4000-8000-000000000001', now(), pg_temp.got('real', 'proceeding_id')::uuid,
   pg_temp.got('real', 'case_id')::uuid),
  ('c1040000-0000-4000-8000-000000000002', 'b1040000-0000-4000-8000-00000000000a', 'avisotestehash02', 'TJGO',
   '50005029820998090051', current_date, 'Intimação', 'Expeça-se alvará.', 'pagamento',
   'a1040000-0000-4000-8000-000000000001', now(), pg_temp.got('teste', 'proceeding_id')::uuid,
   pg_temp.got('teste', 'case_id')::uuid);

select ok(
  pg_temp.due('b1040000-0000-4000-8000-00000000000a', 'teste', 'lawsuit_filed') = 1
  and pg_temp.due('b1040000-0000-4000-8000-00000000000a', 'real', 'lawsuit_filed') = 0,
  'the word that the lawsuit was filed is due at once in a test case, and waits its minutes in a real one'
);

select ok(
  pg_temp.due('b1040000-0000-4000-8000-00000000000a', 'teste', 'payment_alert') = 1
  and pg_temp.due('b1040000-0000-4000-8000-00000000000a', 'real', 'payment_alert') = 0,
  'the warning against the scam is due at once in a test case, and waits its minutes in a real one'
);

-- ---------- Two firms ----------

select ok(
  (select count(*) = 0 from public.notice_candidates('b1040000-0000-4000-8000-00000000000b', null) c
   where c.case_id in (pg_temp.got('real', 'case_id')::uuid, pg_temp.got('teste', 'case_id')::uuid))
  and (select count(*) = 0 from public.notice_candidates('b1040000-0000-4000-8000-00000000000a', null) c
       where c.case_id = pg_temp.got('outra', 'case_id')::uuid)
  and (select count(*) >= 1 from public.notice_candidates('b1040000-0000-4000-8000-00000000000b', null) c
       where c.case_id = pg_temp.got('outra', 'case_id')::uuid and c.kind = 'lawsuit_filed'),
  'what is due in one firm holds nothing of the other''s cases'
);

select * from finish();
rollback;
