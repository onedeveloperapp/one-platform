begin;
create extension if not exists pgtap;
select plan(3);

-- ============================================================
-- Accepting a judgment takes back every term ONE proposed of it (0216): of
-- the judgment given at a hearing and of the decision of its embargos too;
-- what a person confirmed, and a term of another act, stay. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2160000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-aceite.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2160000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-aceite.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2160000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-aceite', 'a2160000-0000-4000-8000-000000000001'),
  ('b2160000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-aceite', 'a2160000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2160000-0000-4000-8000-00000000000a', 'a2160000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2160000-0000-4000-8000-00000000000b', 'a2160000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2160000-0000-4000-8000-000000000001', 'b2160000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2160000-0000-4000-8000-000000000002', 'b2160000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2160000-0000-4000-8000-000000000001', 'b2160000-0000-4000-8000-00000000000a', 'c2160000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2025-08-01'),
  ('f2160000-0000-4000-8000-000000000002', 'b2160000-0000-4000-8000-00000000000b', 'c2160000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '00051016820998090051', '2025-08-01');
-- A judgment given at a hearing ten days ago in each firm; firm A's embargos decided four days ago.
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b2160000-0000-4000-8000-00000000000a', 'c2160000-0000-4000-8000-000000000001', 'f2160000-0000-4000-8000-000000000001',
   'sentenca', 'parcial', 200000, current_date - 10, 'person'),
  ('b2160000-0000-4000-8000-00000000000b', 'c2160000-0000-4000-8000-000000000002', 'f2160000-0000-4000-8000-000000000002',
   'sentenca', 'parcial', 200000, current_date - 10, 'person');
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, proceeding_id, case_id,
                                 category, triaged_at) values
  ('ce216000-0000-4000-8000-0000000000a1', 'b2160000-0000-4000-8000-00000000000a', 'aceiteone0000a1', 'TJGO',
   '10003012720998090100', current_date - 4, 'Intimação', 'Decisão', 'Rejeito os embargos de declaração. Intimem-se.',
   'f2160000-0000-4000-8000-000000000001', 'c2160000-0000-4000-8000-000000000001', 'decisao', now());

-- The terms on record, as ONE or a person left them.
insert into public.deadlines (id, org_id, cnj, court, case_id, proceeding_id, publication_id, title, act, trigger, trigger_on,
                              days, counting, created_by, proposed_auto, status, due_on, confirmed_at, confirmed_by)
values
  -- ONE's, from the hearing's day: embargos and recurso.
  ('d2160000-0000-4000-8000-000000000001', 'b2160000-0000-4000-8000-00000000000a', '10003012720998090100', 'TJGO',
   'c2160000-0000-4000-8000-000000000001', 'f2160000-0000-4000-8000-000000000001', null, 'Embargos de declaração',
   'embargos_declaracao', 'day', current_date - 10, 5, 'business', null, true, 'proposed', null, null, null),
  ('d2160000-0000-4000-8000-000000000002', 'b2160000-0000-4000-8000-00000000000a', '10003012720998090100', 'TJGO',
   'c2160000-0000-4000-8000-000000000001', 'f2160000-0000-4000-8000-000000000001', null, 'Recurso inominado',
   'recurso_inominado', 'day', current_date - 10, 10, 'business', null, true, 'confirmed', current_date + 3, now(),
   'a2160000-0000-4000-8000-000000000001'),
  -- ONE's, from the decision of the embargos.
  ('d2160000-0000-4000-8000-000000000003', 'b2160000-0000-4000-8000-00000000000a', '10003012720998090100', 'TJGO',
   'c2160000-0000-4000-8000-000000000001', 'f2160000-0000-4000-8000-000000000001', 'ce216000-0000-4000-8000-0000000000a1',
   'Recurso inominado', 'recurso_inominado', 'publication', current_date - 4, 10, 'business', null, true, 'proposed',
   null, null, null),
  -- ONE's, of another act.
  ('d2160000-0000-4000-8000-000000000004', 'b2160000-0000-4000-8000-00000000000a', '10003012720998090100', 'TJGO',
   'c2160000-0000-4000-8000-000000000001', 'f2160000-0000-4000-8000-000000000001', null, 'Manifestação',
   'manifestacao', 'day', current_date - 10, 5, 'business', null, true, 'proposed', null, null, null),
  -- Firm B's, from its own hearing.
  ('d2160000-0000-4000-8000-000000000005', 'b2160000-0000-4000-8000-00000000000b', '00051016820998090051', 'TJGO',
   'c2160000-0000-4000-8000-000000000002', 'f2160000-0000-4000-8000-000000000002', null, 'Recurso inominado',
   'recurso_inominado', 'day', current_date - 10, 10, 'business', null, true, 'proposed', null, null, null);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.status(n text) returns text language sql as
$$ select status from public.deadlines where id = ('d2160000-0000-4000-8000-00000000000' || n)::uuid; $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2160000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('accepted', public.decide_judgment_path(
  (select id from public.judgment_paths where proceeding_id = 'f2160000-0000-4000-8000-000000000001'), 'aceitar', null));
reset role;

select ok(
  (select payload ->> 'code' from res where name = 'accepted') = 'decided'
  and pg_temp.status('1') = 'dismissed' and pg_temp.status('3') = 'dismissed'
  and (select bool_and(dismiss_reason = 'O escritório decidiu aceitar a sentença.') from public.deadlines
       where id in ('d2160000-0000-4000-8000-000000000001', 'd2160000-0000-4000-8000-000000000003')),
  'accepting the judgment takes back the terms ONE proposed from the hearing''s day and from the decision of the embargos'
);

select ok(
  pg_temp.status('2') = 'confirmed' and pg_temp.status('4') = 'proposed',
  'what a person confirmed stays, and so does a term of another act'
);

select ok(
  pg_temp.status('5') = 'proposed',
  'another firm''s terms stay as they were'
);

select * from finish();
rollback;
