begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- ONE's usage events (0211). Lima's case is opened by ONE and another by a
-- person; a lawsuit of it is filed, its piece approved by ONE, the case
-- closed: each writes its event where it happens, with closed values only.
-- A property that is no part of the allowlist is dropped; a firm's person
-- reads none of the events (only the operator does).
--
-- Every person, firm, number and text here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2110000-0000-4000-8000-000000000001', 'ana@lima-uso.invalid', 'Ana Lima'),
  ('a2110000-0000-4000-8000-000000000003', 'edu@rocha-uso.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2110000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-uso', 'a2110000-0000-4000-8000-000000000001'),
  ('b2110000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-uso', 'a2110000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2110000-0000-4000-8000-00000000000a', 'a2110000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2110000-0000-4000-8000-00000000000b', 'a2110000-0000-4000-8000-000000000003', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status, created_by, origin) values
  ('c2110000-0000-4000-8000-000000000001', 'b2110000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay',
   'drafting', null, 'agency'),
  ('c2110000-0000-4000-8000-000000000002', 'b2110000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay',
   'intake', 'a2110000-0000-4000-8000-000000000001', null);
select is(
  (select jsonb_agg(e.properties order by e.properties ->> 'by') from public.product_events e
   where e.org_id = 'b2110000-0000-4000-8000-00000000000a' and e.event_name = 'case.opened'),
  '[{"by": "one", "test": "false", "module": "direito-do-passageiro", "case_origin": "agency"},
    {"by": "person", "test": "false", "module": "direito-do-passageiro", "case_origin": "none"}]'::jsonb,
  'a case opened says who opened it, its module and where it came from');

insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f2110000-0000-4000-8000-000000000001', 'b2110000-0000-4000-8000-00000000000a', 'c2110000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'planned');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version) values
  ('a2110000-0000-4000-8000-0000000000d1', 'b2110000-0000-4000-8000-00000000000a', 'c2110000-0000-4000-8000-000000000001',
   'f2110000-0000-4000-8000-000000000001', 'Petição inicial', 'Modelo de teste, com o texto de uma peça.', 'blank', 'proposed', 1);
update public.case_drafts set status = 'approved', approved_version = 1, approved_body = 'Texto de teste.', approved_at = now()
where id = 'a2110000-0000-4000-8000-0000000000d1';
select is(
  (select e.properties from public.product_events e
   where e.org_id = 'b2110000-0000-4000-8000-00000000000a' and e.event_name = 'piece.approved'),
  '{"by": "one", "test": "false", "module": "direito-do-passageiro"}'::jsonb,
  'a piece approved by ONE says so');

update public.proceedings set status = 'filed', cnj = '10003012720998090100', filed_at = '2026-11-01'
where id = 'f2110000-0000-4000-8000-000000000001';
select is(
  (select e.properties ->> 'kind' from public.product_events e
   where e.org_id = 'b2110000-0000-4000-8000-00000000000a' and e.event_name = 'lawsuit.filed'),
  'juizado', 'a lawsuit filed says its kind');

update public.cases set status = 'closed', closed_at = now(), closed_by_one = true where id = 'c2110000-0000-4000-8000-000000000001';
update public.cases set status = 'closed', closed_at = now(), closed_by_one = true where id = 'c2110000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.product_events e
   where e.org_id = 'b2110000-0000-4000-8000-00000000000a' and e.event_name = 'case.closed'),
  1, 'a case closed is one event, however many times its row is written');
select is(
  (select e.properties ->> 'by' from public.product_events e
   where e.org_id = 'b2110000-0000-4000-8000-00000000000a' and e.event_name = 'case.closed'),
  'one', 'a case closed by ONE says so');

-- Nothing outside the allowlist is kept.
select is(
  public.product_event_sanitize('case.opened', '{"by": "one", "name": "Maria Teste", "module": "Direito Passageiro", "kind": "x"}'),
  '{"by": "one"}'::jsonb, 'a name, a module that is no slug and an unknown kind are dropped');
select ok(public.product_event_known('conversation.from_ad'), 'the vocabulary knows ONE''s events');

-- A firm's person reads none of them.
select set_config('request.jwt.claims', '{"sub":"a2110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.product_events), 0, 'only the operator reads the events');
reset role;

select * from finish();
rollback;
