begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- Every page of a list reaches every row, once (0291). The agency Sol
-- registered five passengers in one spreadsheet (one transaction, one
-- moment, no flight yet): read two at a time, each comes once, in the same
-- order every time. Firm Lima has, about its passenger case, two answers of
-- one task waiting and, newer, an answer of another: the queue of the module
-- leaves the task it is asked to out of its page and of its count (the
-- screen asks it of the texts of pieces, which a real draft must back and
-- this fixture has none of). The operator reads the audit
-- trail and the sign-in trail a page at a time, searched in the database;
-- a lawyer reads neither. Two firms, two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2910000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-paginas.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a2910000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-paginas.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a2910000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@sol-paginas.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a2910000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@mar-paginas.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now()),
  ('a2910000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'zeca@plataforma-paginas.invalid', '', now(), '{}', '{"display_name":"Zeca Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a2910000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b2910000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-paginas', 'a2910000-0000-4000-8000-000000000001'),
  ('b2910000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-paginas', 'a2910000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2910000-0000-4000-8000-00000000000a', 'a2910000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2910000-0000-4000-8000-00000000000b', 'a2910000-0000-4000-8000-000000000002', 'owner', 'socio');

-- ---------- The agency's passengers, five of one spreadsheet ----------
insert into public.partners (id, name) values
  ('c2910000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c2910000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c2910000-0000-4000-8000-0000000000aa', 'a2910000-0000-4000-8000-000000000003', 'owner'),
  ('c2910000-0000-4000-8000-0000000000bb', 'a2910000-0000-4000-8000-000000000004', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d2910000-0000-4000-8000-00000000000a', 'c2910000-0000-4000-8000-0000000000aa', 'b2910000-0000-4000-8000-00000000000a',
   'direito-do-passageiro'),
  ('d2910000-0000-4000-8000-00000000000b', 'c2910000-0000-4000-8000-0000000000bb', 'b2910000-0000-4000-8000-00000000000b',
   'direito-do-passageiro');
-- One statement, one moment: created_at is the same for the five, and none has a flight.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone, draft)
select ('f2910000-0000-4000-8000-00000000000' || n)::uuid, 'c2910000-0000-4000-8000-0000000000aa',
       'd2910000-0000-4000-8000-00000000000a', 'b2910000-0000-4000-8000-00000000000a',
       'Passageiro ' || n || ' Teste', ('1985-01-0' || n)::date, '556299990291' || n, false
from generate_series(1, 5) as n;
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, birth_date, phone, draft) values
  ('f2910000-0000-4000-8000-000000000009', 'c2910000-0000-4000-8000-0000000000bb', 'd2910000-0000-4000-8000-00000000000b',
   'b2910000-0000-4000-8000-00000000000b', 'Vera Teste', '1970-10-10', '5562999902919', false);

-- ---------- Lima's passenger case, two checks of a document and a newer answer ----------
insert into public.cases (id, org_id, seq, module, incident) values
  ('e2910000-0000-4000-8000-00000000000a', 'b2910000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay'),
  ('e2910000-0000-4000-8000-00000000000b', 'b2910000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select f.id, f.org, 'client', 'org/' || f.org || '/client/' || f.id,
       'documento.pdf', 'application/pdf', 100, 'stored', repeat(f.mark, 64), 100, 'application/pdf', now() + interval '1 hour', now()
from (values
  ('32910000-0000-4000-8000-000000000001'::uuid, 'b2910000-0000-4000-8000-00000000000a'::uuid, '1'),
  ('32910000-0000-4000-8000-000000000002'::uuid, 'b2910000-0000-4000-8000-00000000000b'::uuid, '2'),
  ('32910000-0000-4000-8000-000000000003'::uuid, 'b2910000-0000-4000-8000-00000000000a'::uuid, '3')
) as f (id, org, mark);
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('42910000-0000-4000-8000-000000000001', 'b2910000-0000-4000-8000-00000000000a', 'e2910000-0000-4000-8000-00000000000a',
   '32910000-0000-4000-8000-000000000001', 'identity', 'client', 'received'),
  ('42910000-0000-4000-8000-000000000002', 'b2910000-0000-4000-8000-00000000000b', 'e2910000-0000-4000-8000-00000000000b',
   '32910000-0000-4000-8000-000000000002', 'identity', 'client', 'received'),
  ('42910000-0000-4000-8000-000000000003', 'b2910000-0000-4000-8000-00000000000a', 'e2910000-0000-4000-8000-00000000000a',
   '32910000-0000-4000-8000-000000000003', 'address_proof', 'client', 'received');
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, subject_type, subject_id, status, output, finished_at)
select r.id, r.org, r.task, v.id, v.provider, v.model, repeat(r.mark, 64), 'case_document', r.subject,
       'succeeded', '{"resposta": "teste"}'::jsonb, now()
from (values
  ('52910000-0000-4000-8000-000000000001'::uuid, 'b2910000-0000-4000-8000-00000000000a'::uuid, 'caso.documento.conferencia', 'a',
   '42910000-0000-4000-8000-000000000001'),
  ('52910000-0000-4000-8000-000000000002'::uuid, 'b2910000-0000-4000-8000-00000000000a'::uuid, 'caso.documento.conferencia', 'b',
   '42910000-0000-4000-8000-000000000003'),
  ('52910000-0000-4000-8000-000000000003'::uuid, 'b2910000-0000-4000-8000-00000000000a'::uuid, 'plataforma.verificacao', 'c',
   '42910000-0000-4000-8000-000000000001'),
  ('52910000-0000-4000-8000-000000000004'::uuid, 'b2910000-0000-4000-8000-00000000000b'::uuid, 'caso.documento.conferencia', 'd',
   '42910000-0000-4000-8000-000000000002')
) as r (id, org, task, mark, subject)
join public.prompt_versions v on v.task = r.task and v.is_active;
-- The two checks are the oldest; the other answer came after them.
insert into public.approvals (org_id, run_id, task, approver_functions, created_at)
select r.org_id, r.id, r.task, array['socio', 'advogado']::public.firm_function[],
       now() - case r.id when '52910000-0000-4000-8000-000000000001' then interval '2 hours'
                         when '52910000-0000-4000-8000-000000000002' then interval '1 hour' else interval '0' end
from public.ai_runs r where r.id::text like '52910000-%';

-- ---------- The trails the operator reads ----------
insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, created_at)
select case when n <= 20 then 'b2910000-0000-4000-8000-00000000000a' else 'b2910000-0000-4000-8000-00000000000b' end::uuid,
       case when n <= 20 then 'a2910000-0000-4000-8000-000000000001' else 'a2910000-0000-4000-8000-000000000002' end::uuid,
       'paginas.teste', 'case', 'evento-' || n, now() - make_interval(mins => n)
from generate_series(1, 30) as n;
insert into public.access_events (user_id, ip, user_agent, aal, impersonated_by, created_at) values
  ('a2910000-0000-4000-8000-000000000001', '10.29.1.1', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', 'aal2', null, now() - interval '3 minutes'),
  ('a2910000-0000-4000-8000-000000000001', '10.29.1.2', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', 'aal2', null, now() - interval '2 minutes'),
  ('a2910000-0000-4000-8000-000000000002', '10.29.2.1', 'Mozilla/5.0 (Macintosh) Safari/605', 'aal1',
   'a2910000-0000-4000-8000-000000000009', now() - interval '1 minute');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.ids(name text) returns text[] language sql as
$$ select coalesce(array_agg(r.value ->> 'id' order by r.ordinality), '{}')
   from res, jsonb_array_elements(res.payload -> 'rows') with ordinality r where res.name = ids.name; $$;
create function pg_temp.total(name text) returns integer language sql as
$$ select (payload ->> 'total')::integer from res where res.name = total.name; $$;

-- ---------- The agency reads its passengers two at a time ----------
select pg_temp.sign_in('a2910000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('pax_1', public.pax_travelers_page('d2910000-0000-4000-8000-00000000000a', null, 'all', 2, 0));
insert into res values ('pax_2', public.pax_travelers_page('d2910000-0000-4000-8000-00000000000a', null, 'all', 2, 2));
insert into res values ('pax_3', public.pax_travelers_page('d2910000-0000-4000-8000-00000000000a', null, 'all', 2, 4));
insert into res values ('pax_1_again', public.pax_travelers_page('d2910000-0000-4000-8000-00000000000a', null, 'all', 2, 0));
reset role;

select is(pg_temp.total('pax_1'), 5, 'the agency''s list counts the five passengers of the spreadsheet');
select is(
  pg_temp.ids('pax_1') || pg_temp.ids('pax_2') || pg_temp.ids('pax_3'),
  array['f2910000-0000-4000-8000-000000000001', 'f2910000-0000-4000-8000-000000000002',
        'f2910000-0000-4000-8000-000000000003', 'f2910000-0000-4000-8000-000000000004',
        'f2910000-0000-4000-8000-000000000005'],
  'read two at a time, each passenger comes once: registered in the same moment, the id decides their order');
select is(pg_temp.ids('pax_1_again'), pg_temp.ids('pax_1'), 'the first page is the same page when read again');

select pg_temp.sign_in('a2910000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.pax_travelers_page('d2910000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized', 'another agency reads nothing of Sol''s passengers');
reset role;

-- ---------- The queue of a module leaves a task out ----------
select pg_temp.sign_in('a2910000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('as_before', public.firm_module_approvals('b2910000-0000-4000-8000-00000000000a', 'direito-do-passageiro', false, 2));
insert into res values ('left_out', public.firm_module_approvals('b2910000-0000-4000-8000-00000000000a', 'direito-do-passageiro', false, 2, 'caso.documento.conferencia'));
reset role;

select is(
  (select array(select jsonb_array_elements_text(payload -> 'ids')) from res where name = 'as_before'),
  array(select a.id::text from public.approvals a
        where a.task = 'caso.documento.conferencia' and a.org_id = 'b2910000-0000-4000-8000-00000000000a'
        order by a.created_at),
  'asked as before, the oldest waiting of the module are still the two checks');
select is(pg_temp.total('as_before'), 3, 'and the count as before is still every answer waiting');
select is(
  (select array(select jsonb_array_elements_text(payload -> 'ids')) from res where name = 'left_out'),
  array(select a.id::text from public.approvals a where a.run_id = '52910000-0000-4000-8000-000000000003'),
  'with the checks'' task left out, the page is the other answer, newer than they are, never an empty page');
select is(pg_temp.total('left_out'), 1, 'and its count is of what the page can show: one answer waiting');

select pg_temp.sign_in('a2910000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_module_approvals('b2910000-0000-4000-8000-00000000000a', 'direito-do-passageiro', false, 30, 'caso.peca.minuta') $$,
  '42501', 'not_authorized', 'another firm reads nothing of Lima''s answers');
reset role;

-- ---------- The operator's trails, a page at a time ----------
select pg_temp.sign_in('a2910000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('audit_1', public.admin_audit_events('paginas.teste', 25, 0));
insert into res values ('audit_2', public.admin_audit_events('paginas.teste', 25, 25));
insert into res values ('audit_rocha', public.admin_audit_events('paginas.teste rocha', 25, 0));
insert into res values ('audit_one', public.admin_audit_events('evento-7 ana', 25, 0));
insert into res values ('access_support', public.admin_access_events('zeca', 25, 0));
insert into res values ('access_ip', public.admin_access_events('10.29.1.', 1, 1));
reset role;

select is(pg_temp.total('audit_1'), 30, 'the search counts every event it matches, never only the ones read');
select is(
  (select count(distinct i) from unnest(pg_temp.ids('audit_1') || pg_temp.ids('audit_2')) i)::integer, 30,
  'the two pages of the search hold the thirty events, each once: the older ones are reached too');
select is(
  (select payload -> 'rows' -> 0 ->> 'entity_id' from res where name = 'audit_1'), 'evento-1',
  'the latest event comes first');
select is(pg_temp.total('audit_rocha'), 10, 'a search by the firm''s name finds the events of that firm only');
select is(
  (select array[payload -> 'rows' -> 0 ->> 'entity_id', payload -> 'rows' -> 0 ->> 'actor_name', payload -> 'rows' -> 0 ->> 'org_name']
   from res where name = 'audit_one'),
  array['evento-7', 'Ana Lima', 'Lima Advocacia'],
  'every word must be found: the event and who did it, named with the firm');
select is(
  (select array[(payload ->> 'total'), payload -> 'rows' -> 0 ->> 'user_name', payload -> 'rows' -> 0 ->> 'support',
                payload -> 'rows' -> 0 ->> 'support_name']
   from res where name = 'access_support'),
  array['1', 'Caio Rocha', 'true', 'Zeca Operador'],
  'a support visit is named with who signed in and the operator who opened it');
select is(
  (select array[(payload ->> 'total'), payload -> 'rows' -> 0 ->> 'ip'] from res where name = 'access_ip'),
  array['2', '10.29.1.1'],
  'the sign-in trail is paged too: the second of Ana''s two sign-ins, the older one');

select pg_temp.sign_in('a2910000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ select public.admin_audit_events(null) $$, '42501', 'not_authorized',
  'a partner of a firm reads nothing of the platform''s audit trail');
select throws_ok($$ select public.admin_access_events(null) $$, '42501', 'not_authorized',
  'nor of the sign-in trail');
reset role;

select * from finish();
rollback;
