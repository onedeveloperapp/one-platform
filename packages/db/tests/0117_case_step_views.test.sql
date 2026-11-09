begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- The list of cases by the step of their way (0116): `firm_cases` lists the
-- cases at each step by the rule of the top of the case (`case_standing`),
-- and each step lists as many cases as the stock (`firm_case_stock`) counts
-- at it, so a step of the home, of the board or of a module's area opens a
-- list of the size it says. Two firms: A with a case at several steps, a test
-- case and an ended one; B with a case that is A's look-alike.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1170000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-etapa.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1170000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-etapa.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1170000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-etapa', 'a1170000-0000-4000-8000-000000000001'),
  ('b1170000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-etapa', 'a1170000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1170000-0000-4000-8000-00000000000a', 'a1170000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1170000-0000-4000-8000-00000000000b', 'a1170000-0000-4000-8000-000000000002', 'owner', 'socio');

-- A's cases: 1 at its first step; 2 and 3 with a document each (documents); 4 in court with nothing to do (the
-- hearing); 5 ended; 6 a test case at its first step. B's: 7 at its first step.
insert into public.cases (id, org_id, seq, module, incident, status, status_changed_at, created_at, closed_at)
values
  ('c1170000-0000-4000-8000-000000000001', 'b1170000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay',
   'intake', now() - interval '20 days', now() - interval '20 days', null),
  ('c1170000-0000-4000-8000-000000000002', 'b1170000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay',
   'documents', now(), now(), null),
  ('c1170000-0000-4000-8000-000000000003', 'b1170000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay',
   'documents', now(), now(), null),
  ('c1170000-0000-4000-8000-000000000004', 'b1170000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'cancellation',
   'filed', now() - interval '2 days', now() - interval '60 days', null),
  ('c1170000-0000-4000-8000-000000000005', 'b1170000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay',
   'closed', now(), now(), now()),
  ('c1170000-0000-4000-8000-000000000006', 'b1170000-0000-4000-8000-00000000000a', 6, 'direito-do-passageiro', 'delay',
   'intake', now(), now(), null),
  ('c1170000-0000-4000-8000-000000000007', 'b1170000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay',
   'intake', now(), now(), null);
update public.cases set is_test = true where id = 'c1170000-0000-4000-8000-000000000006';

insert into public.people (id, org_id, full_name) values
  ('d1170000-0000-4000-8000-000000000001', 'b1170000-0000-4000-8000-00000000000a', 'Lia Teste'),
  ('d1170000-0000-4000-8000-000000000007', 'b1170000-0000-4000-8000-00000000000b', 'Lia Teste');
insert into public.case_parties (id, case_id, org_id, person_id, role) values
  ('e1170000-0000-4000-8000-000000000001', 'c1170000-0000-4000-8000-000000000001', 'b1170000-0000-4000-8000-00000000000a',
   'd1170000-0000-4000-8000-000000000001', 'claimant'),
  ('e1170000-0000-4000-8000-000000000007', 'c1170000-0000-4000-8000-000000000007', 'b1170000-0000-4000-8000-00000000000b',
   'd1170000-0000-4000-8000-000000000007', 'claimant');

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select f.id, 'b1170000-0000-4000-8000-00000000000a', 'client', 'org/b1170000-0000-4000-8000-00000000000a/client/' || f.id,
       'documento.pdf', 'application/pdf', 100, 'stored', repeat(f.mark, 64), 100, 'application/pdf', now() + interval '1 hour', now()
from (values ('f1170000-0000-4000-8000-000000000002'::uuid, '2'), ('f1170000-0000-4000-8000-000000000003'::uuid, '3')) as f (id, mark);
insert into public.case_documents (org_id, case_id, file_id, kind, source, status, processing) values
  ('b1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000000002', 'f1170000-0000-4000-8000-000000000002',
   'receipt', 'client', 'received', 'done'),
  ('b1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000000003', 'f1170000-0000-4000-8000-000000000003',
   'receipt', 'client', 'received', 'working');

insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at)
select cp.org_id, cp.case_id, cp.person_id, encode(sha256(convert_to(cp.id::text, 'utf8')), 'hex'), now() + interval '30 days'
from public.case_parties cp;

insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at) values
  ('b1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000000004', 'juizado', 'TJGO', 'filed',
   '00051016820998090051', current_date - 40);

update public.case_advances set woken_at = null, checked_at = now(), claimed_at = null;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.seqs(name text) returns jsonb language sql as
$$ select coalesce(jsonb_agg((r ->> 'seq')::int order by (r ->> 'seq')::int), '[]'::jsonb)
   from res, jsonb_array_elements(res.payload -> 'rows') r where res.name = seqs.name; $$;

select pg_temp.sign_in('a1170000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('intake', public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-intake'));
insert into res values ('intake-real', public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-intake',
  null, 25, 0, null, null, null, null, false));
insert into res values ('documents', public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-documents'));
insert into res values ('hearing', public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-hearing'));
insert into res values ('documents-cancel', public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-documents',
  null, 25, 0, null, null, 'cancellation'));
insert into res values ('hearing-cancel', public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-hearing',
  null, 25, 0, null, null, 'cancellation'));
insert into res values ('stock', public.firm_case_stock('b1170000-0000-4000-8000-00000000000a'));
-- Every step of the way, each as its view lists it, beside what the stock counts at it.
insert into res
select 'step-' || s.step, jsonb_build_object(
  'listed', (public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-' || s.step) ->> 'total')::int,
  'counted', coalesce((
    select (x ->> 'cases')::int from jsonb_array_elements(public.firm_case_stock('b1170000-0000-4000-8000-00000000000a') -> 'steps') x
    where x ->> 'step' = s.step
  ), 0))
from unnest(array['intake', 'documents', 'signature', 'drafting', 'filing', 'hearing', 'judgment', 'payment', 'closed']) as s (step);
reset role;

select is(pg_temp.seqs('intake'), '[1, 6]'::jsonb, 'a step lists the cases at it by the rule of the top of the case');
select is(pg_temp.seqs('intake-real'), '[1]'::jsonb, 'and leaves the test cases out where the page asked for the real ones');
select is(pg_temp.seqs('documents'), '[2, 3]'::jsonb, 'the cases whose documents the firm or ONE has are at the documents');
select is(pg_temp.seqs('hearing'), '[4]'::jsonb, 'a case in court with nothing to do is at the hearing');
select ok(
  pg_temp.seqs('documents-cancel') = '[]'::jsonb and pg_temp.seqs('hearing-cancel') = '[4]'::jsonb,
  'a step narrows by the list''s own filters, as its count does'
);
select is(
  (select count(*)::int from res where name like 'step-%' and (payload ->> 'listed')::int <> (payload ->> 'counted')::int),
  0,
  'every step lists as many cases as the stock counts at it'
);
select ok(
  (select sum((payload ->> 'listed')::int) from res where name like 'step-%') = (select (payload ->> 'total')::int from res where name = 'stock')
    and not exists (
      select 1 from res, jsonb_array_elements(payload -> 'rows') r where name in ('intake', 'documents', 'hearing') and (r ->> 'seq')::int = 5
    ),
  'the steps add up to the cases going, and an ended case is at none'
);

select pg_temp.sign_in('a1170000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-ferias') $$,
  '22023', null,
  'a step the way does not have is refused'
);
reset role;

select pg_temp.sign_in('a1170000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_cases('b1170000-0000-4000-8000-00000000000a', 'etapa-intake') $$,
  '42501', null,
  'nobody of another firm reads a firm''s steps'
);
select is(
  (select jsonb_agg((r ->> 'seq')::int) from jsonb_array_elements(
    public.firm_cases('b1170000-0000-4000-8000-00000000000b', 'etapa-intake') -> 'rows') r),
  '[1]'::jsonb,
  'and a firm''s step lists its own cases'
);
reset role;

select * from finish();
rollback;
