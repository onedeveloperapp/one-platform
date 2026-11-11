begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The competent unit before the piece (0179): each TJGO comarca has its
-- units by kind, addressed to the comarca's units; a planned lawsuit takes
-- the unit of its court, comarca and kind, named by ONE, and the piece's
-- [[JUIZO]] writes it; a unit a person wrote stays theirs; the operator
-- writes a unit and its profile, and the lawsuits ONE addressed to it take
-- its new name. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1770000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-unidade.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1770000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-unidade.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a1770000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one-unidade.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a1770000-0000-4000-8000-000000000003';
insert into public.organizations (id, name, slug, created_by) values
  ('b1770000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-unidade', 'a1770000-0000-4000-8000-000000000001'),
  ('b1770000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-unidade', 'a1770000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1770000-0000-4000-8000-00000000000a', 'a1770000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1770000-0000-4000-8000-00000000000b', 'a1770000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1770000-0000-4000-8000-000000000001', 'b1770000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting'),
  ('c1770000-0000-4000-8000-000000000002', 'b1770000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'drafting');
-- A lawsuit at Brazabrantes goes to the comarca of Goianira (0145), and to its juizado; one a person addressed stays.
insert into public.proceedings (id, org_id, case_id, kind, court, forum_city, status) values
  ('f1770000-0000-4000-8000-000000000001', 'b1770000-0000-4000-8000-00000000000a', 'c1770000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'Brazabrantes', 'planned'),
  ('f1770000-0000-4000-8000-000000000002', 'b1770000-0000-4000-8000-00000000000b', 'c1770000-0000-4000-8000-000000000002',
   'comum', 'TJGO', 'Goiânia', 'planned');
insert into public.proceedings (id, org_id, case_id, kind, court, forum_city, unit, status) values
  ('f1770000-0000-4000-8000-000000000003', 'b1770000-0000-4000-8000-00000000000a', 'c1770000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'Goiânia', '3º Juizado Especial Cível de Goiânia', 'planned');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version) values
  ('ac770000-0000-4000-8000-000000000001', 'b1770000-0000-4000-8000-00000000000a', 'c1770000-0000-4000-8000-000000000001',
   'f1770000-0000-4000-8000-000000000001', 'Inicial', 'Texto do modelo da inicial.', 'blank', 'proposed', 1);

select ok(
  (select count(*) from public.court_units u where u.court = 'TJGO' and u.kind = 'juizado')
    = (select count(distinct c.comarca) from public.court_comarcas c where c.court = 'TJGO')
  and not exists (select 1 from public.court_units u where u.confirmed),
  'each TJGO comarca has its units by kind, unconfirmed until the operator reads the court''s acts'
);

select ok(
  (select p.comarca = 'Goianira' and p.unit = 'Juizado Especial Cível da Comarca de Goianira' and p.unit_by_one
          and p.unit_id is not null
   from public.proceedings p where p.id = 'f1770000-0000-4000-8000-000000000001')
  and (select p.unit = 'Vara Cível da Comarca de Goiânia' and p.unit_by_one
       from public.proceedings p where p.id = 'f1770000-0000-4000-8000-000000000002')
  and public.case_draft_filled('ac770000-0000-4000-8000-000000000001', 'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]')
      = 'EXCELENTÍSSIMO JUÍZO DO Juizado Especial Cível da Comarca de Goianira',
  'a planned lawsuit takes the unit of its comarca and kind, named by ONE, and the piece addresses it'
);

select ok(
  (select p.unit = '3º Juizado Especial Cível de Goiânia' and not p.unit_by_one and p.unit_id is null
   from public.proceedings p where p.id = 'f1770000-0000-4000-8000-000000000003'),
  'a unit a person wrote stays theirs'
);

-- The firm cannot write the table; the operator writes a unit's name and profile.
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1770000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.admin_save_court_unit((select u.id from public.court_units u where u.court = 'TJGO' and u.comarca = 'Goianira' and u.kind = 'juizado'), '{"prior_complaint": "required"}'::jsonb)$$,
  '42501', 'not_authorized', 'a firm writes no unit'
);
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1770000-0000-4000-8000-000000000003', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select public.admin_save_court_unit(
  (select u.id from public.court_units u where u.court = 'TJGO' and u.comarca = 'Goianira' and u.kind = 'juizado'),
  '{"name": "Juizado Especial Cível e Criminal da Comarca de Goianira", "prior_complaint": "required", "profile_note": "Lido em sentenças de teste."}'::jsonb);
reset role;

select ok(
  (select p.unit = 'Juizado Especial Cível e Criminal da Comarca de Goianira' and p.unit_by_one
   from public.proceedings p where p.id = 'f1770000-0000-4000-8000-000000000001')
  and (select u.prior_complaint = 'required' and u.profile_by = 'a1770000-0000-4000-8000-000000000003'
       from public.court_units u where u.court = 'TJGO' and u.comarca = 'Goianira' and u.kind = 'juizado')
  and exists (select 1 from public.audit_events e where e.action = 'court_unit.saved'),
  'the operator writes a unit''s name and profile, on the record, and the lawsuits ONE addressed to it take the name'
);

select * from finish();
rollback;
