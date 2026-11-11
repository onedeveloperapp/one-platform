begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The priority of processing (0178): a claimant of 60 years or more has
-- it, one of 80 or more the special one, by the birth date on record; the
-- piece writes it where its model carries `[[PRIORIDADE]]`, and a lawsuit
-- with nobody of that age leaves the place empty; the platform's models
-- carry the mark. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1760000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-prioridade.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1760000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-prioridade.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1760000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-prioridade', 'a1760000-0000-4000-8000-000000000001'),
  ('b1760000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-prioridade', 'a1760000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1760000-0000-4000-8000-00000000000a', 'a1760000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1760000-0000-4000-8000-00000000000b', 'a1760000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Ana is 64, Rui 82, Lia 30; three lawsuits of firm A: Ana's, Ana and Rui's, Lia's.
insert into public.people (id, org_id, full_name, birth_date) values
  ('d1760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a', 'Ana Teste', current_date - interval '64 years'),
  ('d1760000-0000-4000-8000-000000000002', 'b1760000-0000-4000-8000-00000000000a', 'Rui Teste', current_date - interval '82 years'),
  ('d1760000-0000-4000-8000-000000000003', 'b1760000-0000-4000-8000-00000000000a', 'Lia Teste', current_date - interval '30 years');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001', 'claimant'),
  ('e1760000-0000-4000-8000-000000000002', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000002', 'claimant'),
  ('e1760000-0000-4000-8000-000000000003', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000003', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f1760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned'),
  ('f1760000-0000-4000-8000-000000000002', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned'),
  ('f1760000-0000-4000-8000-000000000003', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1760000-0000-4000-8000-000000000001', 'e1760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a'),
  ('f1760000-0000-4000-8000-000000000002', 'e1760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a'),
  ('f1760000-0000-4000-8000-000000000002', 'e1760000-0000-4000-8000-000000000002', 'b1760000-0000-4000-8000-00000000000a'),
  ('f1760000-0000-4000-8000-000000000003', 'e1760000-0000-4000-8000-000000000003', 'b1760000-0000-4000-8000-00000000000a');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version) values
  ('ac760000-0000-4000-8000-000000000001', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001',
   'f1760000-0000-4000-8000-000000000001', 'Inicial', 'Texto do modelo da inicial.', 'blank', 'proposed', 1),
  ('ac760000-0000-4000-8000-000000000002', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001',
   'f1760000-0000-4000-8000-000000000002', 'Inicial', 'Texto do modelo da inicial.', 'blank', 'proposed', 1),
  ('ac760000-0000-4000-8000-000000000003', 'b1760000-0000-4000-8000-00000000000a', 'c1760000-0000-4000-8000-000000000001',
   'f1760000-0000-4000-8000-000000000003', 'Inicial', 'Texto do modelo da inicial.', 'blank', 'proposed', 1);

select ok(
  public.lawsuit_priority('f1760000-0000-4000-8000-000000000001') ->> 'priority' = 'elderly'
  and public.lawsuit_priority('f1760000-0000-4000-8000-000000000002') ->> 'priority' = 'elderly_80'
  and public.lawsuit_priority('f1760000-0000-4000-8000-000000000003') ->> 'priority' = 'none'
  and (select array_agg(p ->> 'name' order by (p ->> 'age')::integer desc) = array['Rui Teste', 'Ana Teste']
       from jsonb_array_elements(public.lawsuit_priority('f1760000-0000-4000-8000-000000000002') -> 'people') p),
  'the priority is the claimants'' by their ages: 60 or more, and the special one from 80'
);

select ok(
  public.case_draft_filled('ac760000-0000-4000-8000-000000000001', E'Abertura.\n\n[[PRIORIDADE]]\n\nDos fatos.')
    like E'Abertura.\n\nDA PRIORIDADE DE TRAMITAÇÃO\n\nA parte autora Ana Teste, com 64 anos, é pessoa idosa e requer a prioridade de tramitação deste processo, nos termos do art. 71 da Lei nº 10.741 e do art. 1.048, I, da Lei nº 13.105.\n\nDos fatos.',
  'the piece asks the priority by name and age, with its law'
);

select ok(
  public.case_draft_filled('ac760000-0000-4000-8000-000000000002', '[[PRIORIDADE]]')
    like 'DA PRIORIDADE DE TRAMITAÇÃO%As partes autoras Rui Teste, com 82 anos e Ana Teste, com 64 anos, são pessoas idosas%prioridade especial do § 5º do art. 71%',
  'two of them are named, and the special priority from 80'
);

select is(
  public.case_draft_filled('ac760000-0000-4000-8000-000000000003', E'Abertura.\n\n[[PRIORIDADE]]\n\nDos fatos.'),
  E'Abertura.\n\nDos fatos.',
  'a lawsuit with nobody of that age leaves the place empty, with no blank lines'
);

select ok(
  not exists (select 1 from public.draft_templates t
              where t.org_id is null and t.proceeding_kind in ('juizado', 'comum') and strpos(t.body, 'em face de [[RE]]') > 0
                and strpos(t.body, '[[PRIORIDADE]]') = 0)
  and not has_function_privilege('authenticated', 'public.lawsuit_priority(uuid)', 'EXECUTE'),
  'the platform''s models carry the mark, and the priority is read by the database alone'
);

select * from finish();
rollback;
