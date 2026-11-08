begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- Who has each case and how long it is at its step (0111): `case_standing`
-- through `firm_cases` (its views and each row of a page) and the stock of
-- the controladoria (`firm_case_stock`, which counts the views). Two firms: A with a case in each
-- state; B with a case that is A's look-alike. The comparison with the top
-- of the case, case by case, is the app's (`standing.db.test.ts`).
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1120000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-posicao.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1120000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-posicao.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1120000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-posicao', 'a1120000-0000-4000-8000-000000000001'),
  ('b1120000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-posicao', 'a1120000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1120000-0000-4000-8000-00000000000a', 'a1120000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1120000-0000-4000-8000-00000000000b', 'a1120000-0000-4000-8000-000000000002', 'owner', 'socio');

-- A's cases:
--   1 a client whose data is missing, at its first step for 20 days (the limit is 7): the client's, stagnant;
--   2 a document waits for the firm to decide it: the firm's;
--   3 ONE checks a document: ONE's;
--   4 in court with nothing to do, filed 40 days ago: the court's, at the hearing for 40 days (a cancellation);
--   5 ended: in no list of who has a case.
insert into public.cases (id, org_id, seq, module, incident, status, status_changed_at, created_at, closed_at)
values
  ('c1120000-0000-4000-8000-000000000001', 'b1120000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay',
   'intake', now() - interval '20 days', now() - interval '20 days', null),
  ('c1120000-0000-4000-8000-000000000002', 'b1120000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay',
   'documents', now(), now(), null),
  ('c1120000-0000-4000-8000-000000000003', 'b1120000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay',
   'documents', now(), now(), null),
  ('c1120000-0000-4000-8000-000000000004', 'b1120000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'cancellation',
   'filed', now() - interval '2 days', now() - interval '60 days', null),
  ('c1120000-0000-4000-8000-000000000005', 'b1120000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay',
   'closed', now(), now(), now()),
  ('c1120000-0000-4000-8000-000000000006', 'b1120000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay',
   'intake', now(), now(), null);

insert into public.people (id, org_id, full_name) values
  ('d1120000-0000-4000-8000-000000000001', 'b1120000-0000-4000-8000-00000000000a', 'Lia Teste'),
  ('d1120000-0000-4000-8000-000000000006', 'b1120000-0000-4000-8000-00000000000b', 'Lia Teste');
insert into public.case_parties (id, case_id, org_id, person_id, role) values
  ('e1120000-0000-4000-8000-000000000001', 'c1120000-0000-4000-8000-000000000001', 'b1120000-0000-4000-8000-00000000000a',
   'd1120000-0000-4000-8000-000000000001', 'claimant'),
  ('e1120000-0000-4000-8000-000000000006', 'c1120000-0000-4000-8000-000000000006', 'b1120000-0000-4000-8000-00000000000b',
   'd1120000-0000-4000-8000-000000000006', 'claimant');

-- The documents of cases 2 and 3: one received and checked, one ONE is checking.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select f.id, 'b1120000-0000-4000-8000-00000000000a', 'client', 'org/b1120000-0000-4000-8000-00000000000a/client/' || f.id,
       'documento.pdf', 'application/pdf', 100, 'stored', repeat(f.mark, 64), 100, 'application/pdf', now() + interval '1 hour', now()
from (values ('f1120000-0000-4000-8000-000000000002'::uuid, '2'), ('f1120000-0000-4000-8000-000000000003'::uuid, '3')) as f (id, mark);
insert into public.case_documents (org_id, case_id, file_id, kind, source, status, processing) values
  ('b1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000000002', 'f1120000-0000-4000-8000-000000000002',
   'receipt', 'client', 'received', 'done'),
  ('b1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000000003', 'f1120000-0000-4000-8000-000000000003',
   'receipt', 'client', 'received', 'working');

-- What a document's arrival sets of its work is the backend's: here one was checked, the other is being checked.
update public.case_documents set processing = 'done' where case_id = 'c1120000-0000-4000-8000-000000000002';
update public.case_documents set processing = 'working' where case_id = 'c1120000-0000-4000-8000-000000000003';

-- Each client was sent their link already (these firms have no WhatsApp: a link owed would be the firm's to send).
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at)
select cp.org_id, cp.case_id, cp.person_id, encode(sha256(convert_to(cp.id::text, 'utf8')), 'hex'), now() + interval '30 days'
from public.case_parties cp;

-- Case 4's lawsuit, filed 40 days ago and read by its source, with no movement since.
insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at) values
  ('b1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000000004', 'juizado', 'TJGO', 'filed',
   '00051016820998090051', current_date - 40);

-- No case owes ONE a look.
update public.case_advances set woken_at = null, checked_at = now(), claimed_at = null;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.row_of(name text, seq int) returns jsonb language sql as
$$ select r from res, jsonb_array_elements(res.payload -> 'rows') r where res.name = row_of.name and (r ->> 'seq')::int = row_of.seq; $$;

select pg_temp.sign_in('a1120000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('all', public.firm_cases('b1120000-0000-4000-8000-00000000000a'));
insert into res values ('ended', public.firm_cases('b1120000-0000-4000-8000-00000000000a', 'ended'));
insert into res values ('firm', public.firm_cases('b1120000-0000-4000-8000-00000000000a', 'com-escritorio'));
insert into res values ('stagnant', public.firm_cases('b1120000-0000-4000-8000-00000000000a', 'estagnados'));
insert into res values ('stock', public.firm_case_stock('b1120000-0000-4000-8000-00000000000a'));
insert into res values ('stock-kind', public.firm_case_stock('b1120000-0000-4000-8000-00000000000a', null, 'cancellation'));
reset role;

select is(pg_temp.row_of('all', 1) ->> 'holder', 'client', 'a client whose data is missing has the case');
select ok(
  pg_temp.row_of('all', 1) ->> 'step' = 'intake' and (pg_temp.row_of('all', 1) ->> 'step_days')::int = 20
    and (pg_temp.row_of('all', 1) ->> 'stagnant')::boolean,
  'at its first step for 20 days, past the 7 of the setting: stagnant'
);
select is(pg_temp.row_of('all', 2) ->> 'holder', 'firm', 'a document waiting to be decided is the firm''s');
select is(pg_temp.row_of('all', 2) ->> 'why', 'documents', 'and the list says why');
select is(pg_temp.row_of('all', 3) ->> 'holder', 'one', 'a document ONE is checking is ONE''s');
select ok(
  pg_temp.row_of('all', 4) ->> 'holder' = 'court' and pg_temp.row_of('all', 4) ->> 'step' = 'hearing'
    and (pg_temp.row_of('all', 4) ->> 'step_days')::int = 40,
  'a case in court with nothing to do is the court''s, at the hearing since its filing, whenever it changed stage'
);
select ok(
  pg_temp.row_of('ended', 5) ->> 'holder' is null and pg_temp.row_of('ended', 5) ->> 'step' is null,
  'an ended case is in no list of who has a case'
);
select ok(
  (select payload -> 'holders' from res where name = 'stock-kind') = '{"firm": 0, "client": 0, "one": 0, "court": 1,
    "platform": 0}'::jsonb and (select payload ->> 'total' = '1' from res where name = 'stock-kind'),
  'the stock reads under the list''s filters, so the views of who has the case count what the list shows'
);
select ok(
  (select jsonb_agg((r ->> 'seq')::int) from res, jsonb_array_elements(payload -> 'rows') r where name = 'firm') = '[2]'::jsonb
    and (select jsonb_agg((r ->> 'seq')::int) from res, jsonb_array_elements(payload -> 'rows') r where name = 'stagnant') = '[1]'::jsonb,
  'the views list what they count'
);
select is(
  (select payload -> 'holders' from res where name = 'stock'),
  '{"firm": 1, "client": 1, "one": 1, "court": 1, "platform": 0}'::jsonb,
  'the stock says who has the cases, the firm''s own and none of another firm''s'
);
select ok(
  (select s ->> 'cases' = '1' and s ->> 'stagnant' = '1' and s ->> 'oldest_days' = '20' and s ->> 'limit' = '7'
   from res, jsonb_array_elements(payload -> 'steps') s where name = 'stock' and s ->> 'step' = 'intake')
    and (select payload ->> 'total' = '4' and payload ->> 'stagnant' = '1' from res where name = 'stock'),
  'and each step with its cases, the stagnant ones, the oldest days and its limit'
);

-- A firm's limits are the platform's setting: a step given a longer limit has no stagnant case.
update public.platform_settings
set value = jsonb_set(value, '{stagnant_days,intake}', '30'::jsonb) where key = 'controladoria';
select pg_temp.sign_in('a1120000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (public.firm_case_stock('b1120000-0000-4000-8000-00000000000a') ->> 'stagnant')::int = 0
    and (public.firm_cases('b1120000-0000-4000-8000-00000000000a', 'estagnados') ->> 'total')::int = 0
    and not exists (
      select 1 from jsonb_array_elements(public.firm_cases('b1120000-0000-4000-8000-00000000000a') -> 'rows') r
      where (r ->> 'stagnant')::boolean
    ),
  'the limits are data'
);
reset role;

select pg_temp.sign_in('a1120000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_case_stock('b1120000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'nobody of another firm reads a firm''s stock'
);
select is(
  (public.firm_case_stock('b1120000-0000-4000-8000-00000000000b') ->> 'total')::int, 1,
  'and a firm''s stock is its own cases'
);
reset role;

select * from finish();
rollback;
