begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- How many of a firm's cases are at each step of their way (0082): the
-- cases grouped by stage and, in court, by a hearing held and by a
-- publication in force triaged as a decision and as a payment. Two firms:
-- A, with a case at each point of the way and one of a second module; B,
-- with one case in court. Each reads its own, and nothing of the other's.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-andamento.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a8500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-andamento.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8500000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-andamento', 'a8500000-0000-4000-8000-000000000001'),
  ('b8500000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-andamento', 'a8500000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8500000-0000-4000-8000-00000000000a', 'a8500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8500000-0000-4000-8000-00000000000b', 'a8500000-0000-4000-8000-000000000002', 'owner', 'socio');

-- A second module, that firm A has beside the passenger module.
insert into public.product_modules (key, name, status, sold_as, description, sort) values
  ('modulo-de-teste', 'Módulo de Teste', 'available', 'package', 'Um módulo que só este teste conhece.', 9);
insert into public.firm_modules (org_id, module_key) values
  ('b8500000-0000-4000-8000-00000000000a', 'modulo-de-teste');

-- A: a case gathering documents; in court, one that waits for its hearing (a decision published and then cancelled
-- by the court counts for nothing), one heard, one heard and decided, one decided and paid with no hearing; one
-- closed (a hearing of it held counts for nothing: it ended), one that did not go on, and a case of the other
-- module gathering documents. B: one case heard.
insert into public.cases (id, org_id, seq, module, incident, status, closed_at, close_reason) values
  ('c8500000-0000-4000-8000-000000000001', 'b8500000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents', null, null),
  ('c8500000-0000-4000-8000-000000000002', 'b8500000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed', null, null),
  ('c8500000-0000-4000-8000-000000000003', 'b8500000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'filed', null, null),
  ('c8500000-0000-4000-8000-000000000004', 'b8500000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'delay', 'filed', null, null),
  ('c8500000-0000-4000-8000-000000000005', 'b8500000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay', 'filed', null, null),
  ('c8500000-0000-4000-8000-000000000006', 'b8500000-0000-4000-8000-00000000000a', 6, 'direito-do-passageiro', 'delay', 'closed', now(), 'Pagamento recebido e caso arquivado.'),
  ('c8500000-0000-4000-8000-000000000007', 'b8500000-0000-4000-8000-00000000000a', 7, 'direito-do-passageiro', 'delay', 'declined', now(), 'O cliente desistiu do caso.'),
  ('c8500000-0000-4000-8000-000000000008', 'b8500000-0000-4000-8000-00000000000a', 8, 'modulo-de-teste', null, 'documents', null, null),
  ('c8500000-0000-4000-8000-000000000009', 'b8500000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed', null, null);

insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('e8500000-0000-4000-8000-000000000002', 'b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000002', 'juizado', 'TJGO'),
  ('e8500000-0000-4000-8000-000000000003', 'b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000003', 'juizado', 'TJGO'),
  ('e8500000-0000-4000-8000-000000000004', 'b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000004', 'juizado', 'TJGO'),
  ('e8500000-0000-4000-8000-000000000005', 'b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000005', 'juizado', 'TJGO'),
  ('e8500000-0000-4000-8000-000000000006', 'b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000006', 'juizado', 'TJGO'),
  ('e8500000-0000-4000-8000-000000000009', 'b8500000-0000-4000-8000-00000000000b', 'c8500000-0000-4000-8000-000000000009', 'juizado', 'TJGO');

insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, status, outcome) values
  ('b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000002', 'e8500000-0000-4000-8000-000000000002',
   'conciliacao', now() + interval '20 days', 'America/Sao_Paulo', 'videoconferencia', 'scheduled', null),
  ('b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000003', 'e8500000-0000-4000-8000-000000000003',
   'conciliacao', now() - interval '10 days', 'America/Sao_Paulo', 'videoconferencia', 'held', 'sem_acordo'),
  ('b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000004', 'e8500000-0000-4000-8000-000000000004',
   'conciliacao', now() - interval '40 days', 'America/Sao_Paulo', 'videoconferencia', 'held', 'sem_acordo'),
  ('b8500000-0000-4000-8000-00000000000a', 'c8500000-0000-4000-8000-000000000006', 'e8500000-0000-4000-8000-000000000006',
   'conciliacao', now() - interval '90 days', 'America/Sao_Paulo', 'videoconferencia', 'held', 'acordo'),
  ('b8500000-0000-4000-8000-00000000000b', 'c8500000-0000-4000-8000-000000000009', 'e8500000-0000-4000-8000-000000000009',
   'conciliacao', now() - interval '10 days', 'America/Sao_Paulo', 'videoconferencia', 'held', 'sem_acordo');

insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, case_id, proceeding_id, category, triaged_at, active, cancelled_at, cancel_reason) values
  ('b8500000-0000-4000-8000-00000000000a', 'andamento0002decisao', 'TJGO', '50002023920998090051', current_date - 5, 'Intimação', 'Sentença.',
   'c8500000-0000-4000-8000-000000000002', 'e8500000-0000-4000-8000-000000000002', 'decisao', now(), false, now(), 'Publicada por engano.'),
  ('b8500000-0000-4000-8000-00000000000a', 'andamento0004decisao', 'TJGO', '50002023920998090051', current_date - 20, 'Intimação', 'Sentença.',
   'c8500000-0000-4000-8000-000000000004', 'e8500000-0000-4000-8000-000000000004', 'decisao', now(), true, null, null),
  ('b8500000-0000-4000-8000-00000000000a', 'andamento0005decisao', 'TJGO', '50002023920998090051', current_date - 60, 'Intimação', 'Sentença.',
   'c8500000-0000-4000-8000-000000000005', 'e8500000-0000-4000-8000-000000000005', 'decisao', now(), true, null, null),
  ('b8500000-0000-4000-8000-00000000000a', 'andamento0005pagamento', 'TJGO', '50002023920998090051', current_date - 3, 'Intimação', 'Alvará.',
   'c8500000-0000-4000-8000-000000000005', 'e8500000-0000-4000-8000-000000000005', 'pagamento', now(), true, null, null);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal1')::text, true); $$;
-- How many cases a group of an answer holds: the group of that stage and those three facts, or 0.
create function pg_temp.cases(name text, stage text, held boolean, decided boolean, paid boolean) returns integer language sql as
$$ select coalesce((
     select (g ->> 'cases')::integer from res, jsonb_array_elements(res.payload) g
     where res.name = cases.name and g ->> 'status' = stage and (g ->> 'held')::boolean = cases.held
       and (g ->> 'decided')::boolean = cases.decided and (g ->> 'paid')::boolean = cases.paid
   ), 0); $$;

select pg_temp.sign_in('a8500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_all', public.firm_case_journey('b8500000-0000-4000-8000-00000000000a'));
insert into res values ('a_passenger', public.firm_case_journey('b8500000-0000-4000-8000-00000000000a', 'direito-do-passageiro'));
reset role;

select is(pg_temp.cases('a_all', 'documents', false, false, false), 2,
  'the cases gathering documents count together, of every module');
select is(pg_temp.cases('a_all', 'filed', false, false, false), 1,
  'a case in court with no hearing held waits for it, a decision the court cancelled counting for nothing');
select is(pg_temp.cases('a_all', 'filed', true, false, false), 1, 'a case heard waits for its judgment');
select is(pg_temp.cases('a_all', 'filed', true, true, false), 1, 'a case heard and decided waits for its payment');
select is(pg_temp.cases('a_all', 'filed', false, true, true), 1, 'a case decided and paid with no hearing says so');
select is(pg_temp.cases('a_all', 'closed', false, false, false), 1,
  'a closed case is counted as ended, whatever its lawsuits showed');
select is(pg_temp.cases('a_all', 'declined', false, false, false), 1, 'a case that did not go on is counted apart');
select is(
  (select sum((g ->> 'cases')::integer)::integer from res, jsonb_array_elements(res.payload) g where res.name = 'a_all'),
  8,
  'every case of the firm is counted once'
);
select is(pg_temp.cases('a_passenger', 'documents', false, false, false), 1,
  'of one module, the cases of another module are left out');

select pg_temp.sign_in('a8500000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.firm_case_journey('b8500000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'a person of another firm reads nothing of the firm''s cases'
);
insert into res values ('b_all', public.firm_case_journey('b8500000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.cases('b_all', 'filed', true, false, false) = 1
    and (select jsonb_array_length(payload) from res where name = 'b_all') = 1,
  'each firm counts its own cases, and nothing of the other''s'
);

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  $$select public.firm_case_journey('b8500000-0000-4000-8000-00000000000a')$$,
  '42501', null,
  'a visitor reads nothing'
);
reset role;

select ok(
  has_function_privilege('authenticated', 'public.firm_case_journey(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.firm_case_journey(uuid, text)', 'execute'),
  'the people of a firm may ask for the counts, a visitor may not'
);

select * from finish();
rollback;
