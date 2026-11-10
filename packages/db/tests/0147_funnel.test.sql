begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- Where each person stands in the funnel (0148): a client signed, a lead has
-- a case going with no signature, a person whose problem did not qualify is
-- apart until a lawyer goes on with it, and the rest are contacts; Pessoas
-- counts each point as its list has it. Two firms: nothing of one reaches the
-- other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1470000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@funilone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1470000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@funilone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1470000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-funilone', 'a1470000-0000-4000-8000-000000000001'),
  ('b1470000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-funilone', 'a1470000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1470000-0000-4000-8000-00000000000a', 'a1470000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1470000-0000-4000-8000-00000000000b', 'a1470000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

create function pg_temp.new_case(name text, who uuid, org uuid) returns void language plpgsql as $$
declare
  made jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-11-02',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  reset role;
  insert into res values (name, made);
end;
$$;

create function pg_temp.point(name text) returns text language sql as $$
  select fu.point from public.people_funnel((select c.org_id from public.cases c where c.id = pg_temp.got(name, 'case_id')::uuid)) fu
  where fu.person_id = pg_temp.got(name, 'person_id')::uuid;
$$;

create function pg_temp.verdict(outcome text, reason text) returns jsonb language sql as $$
  select jsonb_build_object('rule', 'qualificacao-v1', 'outcome', outcome, 'reasons', jsonb_build_array(reason),
    'missing', '[]'::jsonb, 'assumptions', '[]'::jsonb, 'claims', jsonb_build_object('material', true, 'moral', true));
$$;

-- Firm A: a client who signed, a lead, one whose problem did not qualify, one a lawyer went on with, and a contact
-- whose case the firm declined.
select pg_temp.new_case('cliente', 'a1470000-0000-4000-8000-000000000001', 'b1470000-0000-4000-8000-00000000000a');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
  detected_mime, expires_at, confirmed_at)
values ('e1470000-0000-4000-8000-000000000001', 'b1470000-0000-4000-8000-00000000000a', 'upload',
  'org/b1470000-0000-4000-8000-00000000000a/upload/e1470000-0000-4000-8000-000000000001', 'procuracao.pdf',
  'application/pdf', 100, 'stored', repeat('f', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (org_id, case_id, file_id, kind, source, status, party_id)
values ('b1470000-0000-4000-8000-00000000000a', pg_temp.got('cliente', 'case_id')::uuid,
  'e1470000-0000-4000-8000-000000000001', 'power_of_attorney', 'firm', 'accepted', pg_temp.got('cliente', 'party_id')::uuid);

select pg_temp.new_case('lead', 'a1470000-0000-4000-8000-000000000001', 'b1470000-0000-4000-8000-00000000000a');
select pg_temp.new_case('naoq', 'a1470000-0000-4000-8000-000000000001', 'b1470000-0000-4000-8000-00000000000a');
select pg_temp.new_case('liberado', 'a1470000-0000-4000-8000-000000000001', 'b1470000-0000-4000-8000-00000000000a');
select pg_temp.new_case('contato', 'a1470000-0000-4000-8000-000000000001', 'b1470000-0000-4000-8000-00000000000a');
update public.cases set qualification = pg_temp.verdict('not_qualified', 'cancelled_early_notice')
where id in (pg_temp.got('naoq', 'case_id')::uuid, pg_temp.got('liberado', 'case_id')::uuid);
update public.cases set qualification_released_by = 'a1470000-0000-4000-8000-000000000001',
  qualification_released_at = now(), qualification_release_reason = 'A companhia não ofereceu alternativa.'
where id = pg_temp.got('liberado', 'case_id')::uuid;
update public.cases set status = 'declined', closed_at = now() where id = pg_temp.got('contato', 'case_id')::uuid;

-- Firm B: one lead.
select pg_temp.new_case('beta', 'a1470000-0000-4000-8000-000000000002', 'b1470000-0000-4000-8000-00000000000b');

select ok(
  not has_function_privilege('authenticated', 'public.people_funnel(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.people_funnel(uuid)', 'EXECUTE'),
  'only the database reads the funnel; a person reads it through Pessoas'
);

select ok(
  pg_temp.point('cliente') = 'cliente' and pg_temp.point('lead') = 'lead',
  'who signed is a client, and who has a case going with no signature is a lead'
);

select ok(
  pg_temp.point('naoq') = 'nao_qualificado'
  and (select reasons = array['cancelled_early_notice'] from public.people_funnel('b1470000-0000-4000-8000-00000000000a')
       where person_id = pg_temp.got('naoq', 'person_id')::uuid)
  and pg_temp.point('liberado') = 'lead',
  'a problem that did not qualify is apart with its reason, until a lawyer goes on with it'
);

select ok(
  pg_temp.point('contato') = 'contato',
  'a person whose case the firm declined, with no signature, is a contact'
);

select pg_temp.sign_in('a1470000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('all', public.firm_people('b1470000-0000-4000-8000-00000000000a'));
insert into res values ('leads', public.firm_people('b1470000-0000-4000-8000-00000000000a', 'leads'));
insert into res values ('naoq-list', public.firm_people('b1470000-0000-4000-8000-00000000000a', 'nao-qualificados'));
insert into res values ('numbers', public.firm_people_numbers('b1470000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  (select (payload -> 'counts' ->> 'leads')::int = 2 and (payload -> 'counts' ->> 'clientes')::int = 1
          and (payload -> 'counts' ->> 'nao-qualificados')::int = 1 and (payload -> 'counts' ->> 'contatos')::int = 1
   from res where name = 'all')
  and (select (payload ->> 'total')::int = 2 and jsonb_array_length(payload -> 'rows') = 2 from res where name = 'leads')
  and (select bool_and(r ->> 'point' = 'lead') from res, jsonb_array_elements(payload -> 'rows') r where name = 'leads'),
  'Pessoas counts each point as its list has it'
);

select ok(
  (select payload -> 'rows' -> 0 -> 'reasons' = '["cancelled_early_notice"]'::jsonb from res where name = 'naoq-list')
  and (select payload -> 'funnel' = '{"lead": 2, "cliente": 1, "contato": 1, "nao_qualificado": 1}'::jsonb
       from res where name = 'numbers'),
  'the list says why a person did not qualify, and the numbers count the funnel'
);

select ok(
  not exists (select 1 from res, jsonb_array_elements(payload -> 'rows') r
              where name = 'all' and r ->> 'id' = pg_temp.got('beta', 'person_id'))
  and (select (payload -> 'counts' ->> 'todos')::int = 5 from res where name = 'all'),
  'firm A reads none of firm B''s people'
);

select * from finish();
rollback;
