begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- A term of a publication runs from the earlier of the two intimations
-- (0144): who signs or runs the firm's deadlines gives the day the act was
-- intimated in the court's own system, the deadline is counted again and
-- goes back to be confirmed, the backend hands that day to the rule, and a
-- count that starts before the publication is kept. Two firms: nothing of one
-- reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1430000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@portalone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1430000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@portalone.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1430000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@portalone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1430000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-portalone', 'a1430000-0000-4000-8000-000000000001'),
  ('b1430000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-portalone', 'a1430000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1430000-0000-4000-8000-00000000000a', 'a1430000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1430000-0000-4000-8000-00000000000a', 'a1430000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1430000-0000-4000-8000-00000000000b', 'a1430000-0000-4000-8000-000000000003', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A person sets (or takes back) the day of the intimation in the system.
create function pg_temp.portal(who uuid, deadline uuid, day date) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.set_deadline_portal_day(deadline, day);
  reset role;
  return answer;
end;
$$;

-- A case of firm A with a lawsuit the court has, a publication of it made available three days ago, and two
-- deadlines: one from the publication, one from a day a person gave.
do $$
declare
  made jsonb;
  filed jsonb;
  from_publication jsonb;
  from_day jsonb;
begin
  perform pg_temp.sign_in('a1430000-0000-4000-8000-000000000001');
  set local role authenticated;
  made := public.create_case('b1430000-0000-4000-8000-00000000000a', 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente Alfa', 'birth_date', '1985-04-02'));
  filed := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', '5000811-22.2099.8.09.0051', 'filed_at', to_char(current_date - 20, 'YYYY-MM-DD')),
    array[(made ->> 'party_id')::uuid]);
  reset role;
  insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body,
    proceeding_id, case_id)
  values ('ce143000-0000-4000-8000-0000000000a1', 'b1430000-0000-4000-8000-00000000000a', 'portalone000a1', 'TJGO',
    '50008112220998090051', current_date - 3, 'Intimação', 'Despacho', 'Intime-se a parte autora para se manifestar.',
    (filed ->> 'proceeding_id')::uuid, (made ->> 'case_id')::uuid);
  set local role authenticated;
  from_publication := public.propose_deadline('ce143000-0000-4000-8000-0000000000a1', null, 'Manifestação', null,
    'publication', null, 15, 'business');
  from_day := public.propose_deadline(null, (filed ->> 'proceeding_id')::uuid, 'Manifestação em audiência', null,
    'day', current_date - 1, 5, 'business');
  reset role;
  insert into res values ('alfa', made || jsonb_build_object('proceeding_id', filed ->> 'proceeding_id',
    'from_publication', from_publication ->> 'id', 'from_day', from_day ->> 'id'));
end;
$$;

select ok(
  has_function_privilege('authenticated', 'public.set_deadline_portal_day(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_deadline_portal_day(uuid, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.deadline_to_count(uuid, integer)', 'EXECUTE')
  and pg_temp.got('alfa', 'from_publication') is not null and pg_temp.got('alfa', 'from_day') is not null
  and pg_temp.got('alfa', 'proceeding_id') is not null,
  'a person of the firm gives the day; only the backend reads what a deadline is counted from'
);

insert into res values ('set', pg_temp.portal('a1430000-0000-4000-8000-000000000001',
  pg_temp.got('alfa', 'from_publication')::uuid, current_date - 5));
select ok(
  pg_temp.got('set', 'code') = 'set'
  and (select portal_on = current_date - 5 and revision = 2 and status = 'proposed' and confirmed_at is null
       from public.deadlines where id = pg_temp.got('alfa', 'from_publication')::uuid),
  'a partner gives the day of the intimation in the system: the deadline is counted again and waits to be confirmed'
);

insert into res values ('again', pg_temp.portal('a1430000-0000-4000-8000-000000000001',
  pg_temp.got('alfa', 'from_publication')::uuid, current_date - 5));
select ok(
  pg_temp.got('again', 'code') = 'unchanged'
  and (select revision = 2 from public.deadlines where id = pg_temp.got('alfa', 'from_publication')::uuid),
  'the same day said again changes nothing'
);

select ok(
  pg_temp.portal('a1430000-0000-4000-8000-000000000001', pg_temp.got('alfa', 'from_publication')::uuid,
    current_date + 1) = '{"ok": false, "code": "invalid_day", "field": "portal_on"}'::jsonb
  and pg_temp.portal('a1430000-0000-4000-8000-000000000001', pg_temp.got('alfa', 'from_publication')::uuid,
    current_date - 40) = '{"ok": false, "code": "invalid_day", "field": "portal_on"}'::jsonb,
  'a day still to come, or more than 30 days before the publication, is refused'
);

select ok(
  pg_temp.portal('a1430000-0000-4000-8000-000000000001', pg_temp.got('alfa', 'from_day')::uuid, current_date - 2)
    = '{"ok": false, "code": "invalid_data", "field": "portal_on"}'::jsonb,
  'a deadline that runs from a day a person gave takes no day of the system'
);

select ok(
  pg_temp.portal('a1430000-0000-4000-8000-000000000002', pg_temp.got('alfa', 'from_publication')::uuid,
    current_date - 4) ->> 'code' = 'not_allowed'
  and pg_temp.portal('a1430000-0000-4000-8000-000000000003', pg_temp.got('alfa', 'from_publication')::uuid,
    current_date - 4) ->> 'code' = 'not_found'
  and (select portal_on = current_date - 5 from public.deadlines where id = pg_temp.got('alfa', 'from_publication')::uuid),
  'the attendance of firm A may not give it, and firm B does not see the deadline'
);

-- The backend claims both deadlines and reads what each is counted from.
do $$
declare
  claimed record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  for claimed in select * from public.claim_deadline_counts(10, pg_temp.got('alfa', 'from_publication')::uuid) loop
    insert into res values ('read-pub', public.deadline_to_count(claimed.deadline_id, claimed.claim));
  end loop;
  for claimed in select * from public.claim_deadline_counts(10, pg_temp.got('alfa', 'from_day')::uuid) loop
    insert into res values ('read-day', public.deadline_to_count(claimed.deadline_id, claimed.claim));
  end loop;
  execute 'reset role';
end;
$$;
select ok(
  (pg_temp.got('read-pub', 'portal_on'))::date = current_date - 5
  and (select payload ? 'portal_on' and payload ->> 'portal_on' is null from res where name = 'read-day'),
  'the backend is handed the day for a term of the publication, and none for a term from a day'
);

-- The rule counted from the system's day, before the publication: the count is kept.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  insert into res values ('recorded', public.record_deadline_count(
    pg_temp.got('alfa', 'from_publication')::uuid,
    (pg_temp.got('read-pub', 'claim'))::integer,
    (pg_temp.got('read-pub', 'revision'))::integer,
    'counted',
    jsonb_build_object('rule', 'prazo-v2', 'trigger', 'publication', 'counting', 'business', 'days', 15,
      'triggerDay', current_date - 3, 'publishedOn', current_date - 2, 'fromDay', current_date - 5,
      'startsOn', current_date - 4, 'countedDueOn', current_date + 18, 'dueOn', current_date + 18,
      'skipped', '[]'::jsonb, 'moved', null,
      'assumptions', jsonb_build_array(jsonb_build_object('code', 'portal_first', 'day', current_date - 5)),
      'place', jsonb_build_object('court', 'TJGO'))));
  execute 'reset role';
end;
$$;
select ok(
  pg_temp.got('recorded', 'code') = 'counted'
  and (select computed_revision = revision and starts_on = current_date - 4 and assumptions = array['portal_first']
              and rule_version = 'prazo-v2'
       from public.deadlines where id = pg_temp.got('alfa', 'from_publication')::uuid),
  'a count that starts before the publication, because the system intimated first, is kept with what it assumed'
);

insert into res values ('cleared', pg_temp.portal('a1430000-0000-4000-8000-000000000001',
  pg_temp.got('alfa', 'from_publication')::uuid, null));
select ok(
  pg_temp.got('cleared', 'code') = 'set'
  and (select portal_on is null and revision = 3 and computed_revision is distinct from revision
       from public.deadlines where id = pg_temp.got('alfa', 'from_publication')::uuid),
  'the day taken back is counted again from the publication alone'
);

select ok(
  (select count(*) = 2 from public.audit_events
   where action = 'deadline.portal_day' and org_id = 'b1430000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.audit_events
                  where action = 'deadline.portal_day' and org_id = 'b1430000-0000-4000-8000-00000000000b'),
  'each change of the day is on the record of its firm only'
);

select * from finish();
rollback;
