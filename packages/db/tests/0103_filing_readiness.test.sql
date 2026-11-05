begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- What ONE's filing needs of a person is asked for ahead, and what came back
-- of a filing waits where the firm looks first (0102). A planned lawsuit
-- whose court takes the files signed waits on its lawyers from the moment it
-- exists: a CPF never declared, no authorization in the cloud, or one that
-- runs out within the hours ahead; one a lawyer covers, and a test case,
-- wait on nobody. A filing ONE sent that came back is listed. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1030000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@prontidao.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1030000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@prontidao.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1030000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-prontidao', 'a1030000-0000-4000-8000-000000000001'),
  ('b1030000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-prontidao', 'a1030000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1030000-0000-4000-8000-00000000000a', 'a1030000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1030000-0000-4000-8000-00000000000b', 'a1030000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case of a firm with a planned lawsuit of the small-claims court of Goiânia (Projudi, which takes the files signed)
-- and its lawyer.
create function pg_temp.lawsuit(name text, who uuid, org uuid, test boolean default false) returns void language plpgsql as $$
declare
  made jsonb;
  lawsuit uuid := gen_random_uuid();
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(translate(name, '_', ' ')),
                       'phone', '55009996' || lpad((abs(hashtext(name)) % 100000)::text, 5, '0')));
  reset role;
  update public.cases set status = 'drafting', is_test = test where id = (made ->> 'case_id')::uuid;
  insert into public.proceedings (id, org_id, case_id, kind, court, comarca, status)
  values (lawsuit, org, (made ->> 'case_id')::uuid, 'juizado', 'TJGO', 'Goiânia', 'planned');
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values (lawsuit, who, org);
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit));
end;
$$;
create function pg_temp.attention(who uuid, org uuid) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.firm_filing_attention(org);
  reset role;
  return answer;
end;
$$;
create function pg_temp.ana_signature() returns jsonb language sql as
$$ select pg_temp.attention('a1030000-0000-4000-8000-000000000001', 'b1030000-0000-4000-8000-00000000000a') -> 'signatures' -> 0; $$;

select pg_temp.lawsuit('real', 'a1030000-0000-4000-8000-000000000001', 'b1030000-0000-4000-8000-00000000000a');
select pg_temp.lawsuit('test', 'a1030000-0000-4000-8000-000000000001', 'b1030000-0000-4000-8000-00000000000a', true);

select ok(
  not has_function_privilege('authenticated', 'public.lawsuits_awaiting_signature(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.firm_filing_attention(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.case_signature_ahead(uuid)', 'EXECUTE')
  and exists (select 1 from public.court_systems where court = 'TJGO' and proceeding_kind = 'juizado'
                and system = 'projudi' and signed_files = 'p7s'),
  'what the filing waits on is read by the firm through its functions; the Projudi of TJGO takes the files signed'
);

-- ---------- From the moment the lawsuit exists ----------

select ok(
  pg_temp.ana_signature() ->> 'state' = 'cpf_missing'
  and (pg_temp.ana_signature() ->> 'lawsuits')::integer = 1
  and (pg_temp.ana_signature() ->> 'cases')::integer = 1
  and pg_temp.ana_signature() ->> 'case_id' = pg_temp.got('real', 'case_id')
  and pg_temp.ana_signature() ->> 'name' = 'Ana Lima',
  'a lawsuit ONE will sign in the cloud waits on its lawyer as soon as it exists, first for the CPF the authorization needs; a test case on nobody'
);

insert into public.lawyer_cpfs (user_id, cpf) values ('a1030000-0000-4000-8000-000000000001', '52998224725');
select is(pg_temp.ana_signature() ->> 'state', 'none', 'with the CPF declared, it waits for the authorization');

insert into public.connections (org_id, provider, external_id, label, person_id, status, expires_at, metadata)
values ('b1030000-0000-4000-8000-00000000000a', 'psc.birdid', 'a1030000-0000-4000-8000-000000000001', 'BirdID',
        'a1030000-0000-4000-8000-000000000001', 'connected', now() + interval '3 hours',
        '{"holder_cpf_middle": "982247"}'::jsonb);
select ok(
  pg_temp.ana_signature() ->> 'state' = 'expiring'
  and (pg_temp.ana_signature() ->> 'expires_at')::timestamptz between now() + interval '2 hours' and now() + interval '4 hours',
  'an authorization that runs out within the hours ahead is said with when, before it does'
);

update public.connections set expires_at = now() + interval '3 days'
where person_id = 'a1030000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a1030000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ahead_covered', jsonb_build_object('rows', public.case_signature_ahead(pg_temp.got('real', 'case_id')::uuid)));
reset role;
select ok(
  pg_temp.ana_signature() is null
  and pg_temp.got('ahead_covered', 'rows')::jsonb = '[]'::jsonb,
  'a lawsuit a lawyer of it covers waits on nobody'
);

update public.connections set expires_at = now() + interval '1 hour'
where person_id = 'a1030000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a1030000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ahead', jsonb_build_object('rows', public.case_signature_ahead(pg_temp.got('real', 'case_id')::uuid)));
reset role;
select ok(
  (select payload -> 'rows' -> 0 ->> 'proceeding_id' = pg_temp.got('real', 'proceeding_id')
          and payload -> 'rows' -> 0 ->> 'viewer_signs' = 'true' and payload -> 'rows' -> 0 ->> 'viewer_cpf' = 'true'
          and jsonb_array_length(payload -> 'rows') = 1
   from res where name = 'ahead'),
  'the card of the filing reads it of its case, with whether the person who asks signs it'
);

-- ---------- What came back of a filing ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('file', public.reserve_file('b1030000-0000-4000-8000-00000000000a', 'upload', 'inicial.pdf',
  'application/pdf', 300000));
select public.confirm_file(pg_temp.got('file', 'file_id')::uuid, repeat('c', 64), 300000, 'application/pdf', 8);
reset role;
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
values ('c1030000-0000-4000-8000-0000000000d1', 'b1030000-0000-4000-8000-00000000000a', pg_temp.got('real', 'case_id')::uuid,
        pg_temp.got('file', 'file_id')::uuid, 'petition', 'firm', 'accepted', now());
insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id)
values ('c1030000-0000-4000-8000-0000000000f1', 'b1030000-0000-4000-8000-00000000000a', pg_temp.got('real', 'case_id')::uuid,
        pg_temp.got('real', 'proceeding_id')::uuid, 'TJGO', 'projudi', 'juizado', 'ready', 'c1030000-0000-4000-8000-0000000000d1');
insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel, status, message, error)
values ('b1030000-0000-4000-8000-00000000000a', pg_temp.got('real', 'case_id')::uuid, pg_temp.got('real', 'proceeding_id')::uuid,
        'c1030000-0000-4000-8000-0000000000f1', 'mni', 'refused', 'Classe incompatível.', 'court_refused');
select ok(
  (select payload -> 'filings' -> 0 ->> 'status' = 'refused' and (payload ->> 'filings_total')::integer = 1
          and payload -> 'filings' -> 0 ->> 'case_id' = pg_temp.got('real', 'case_id')
   from (select pg_temp.attention('a1030000-0000-4000-8000-000000000001', 'b1030000-0000-4000-8000-00000000000a') as payload) x),
  'a filing the court refused waits for a person, with its case'
);

update public.filing_submissions set status = 'filed', error = null, case_number = '00012342099809000155'
where package_id = 'c1030000-0000-4000-8000-0000000000f1';
select ok(
  (select (payload ->> 'filings_total')::integer = 0
   from (select pg_temp.attention('a1030000-0000-4000-8000-000000000001', 'b1030000-0000-4000-8000-00000000000a') as payload) x),
  'one filed with its number waits for nobody'
);

-- ---------- Two firms ----------

select pg_temp.sign_in('a1030000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.firm_filing_attention('b1030000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'nobody of another firm reads what this one''s filing waits on'
);
reset role;

select * from finish();
rollback;
