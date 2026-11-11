begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- Where the airline sued is, in the petition (0215): the four Brazilian
-- operators keep the address of their head office, a piece names it after
-- the CNPJ, and an airline with none on record is named as before. Two
-- firms, each with its own airline.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2150000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-sede.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2150000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-sede.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2150000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-sede', 'a2150000-0000-4000-8000-000000000001'),
  ('b2150000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-sede', 'a2150000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2150000-0000-4000-8000-00000000000a', 'a2150000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2150000-0000-4000-8000-00000000000b', 'a2150000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status, airline_iata) values
  ('c2150000-0000-4000-8000-000000000001', 'b2150000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting', 'LA'),
  ('c2150000-0000-4000-8000-000000000002', 'b2150000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'drafting', 'AD');
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f2150000-0000-4000-8000-000000000001', 'b2150000-0000-4000-8000-00000000000a', 'c2150000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'planned'),
  ('f2150000-0000-4000-8000-000000000002', 'b2150000-0000-4000-8000-00000000000b', 'c2150000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'planned');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version) values
  ('d2150000-0000-4000-8000-000000000001', 'b2150000-0000-4000-8000-00000000000a', 'c2150000-0000-4000-8000-000000000001',
   'f2150000-0000-4000-8000-000000000001', 'Inicial', 'Modelo de teste, com o texto de uma inicial.', 'blank', 'proposed', 1),
  ('d2150000-0000-4000-8000-000000000002', 'b2150000-0000-4000-8000-00000000000b', 'c2150000-0000-4000-8000-000000000002',
   'f2150000-0000-4000-8000-000000000002', 'Inicial', 'Modelo de teste, com o texto de uma inicial.', 'blank', 'proposed', 1);

select ok(
  (select count(*) = 4 from public.airlines where iata in ('LA', 'G3', 'AD', '2Z') and address ~ ', CEP [0-9]{5}-[0-9]{3}$')
  and (select address is null from public.airlines where iata = 'JJ'),
  'the four Brazilian operators keep the address of their head office, and LATAM''s old code none'
);

select is(
  public.case_draft_filled('d2150000-0000-4000-8000-000000000001', 'em face de [[RE]].'),
  'em face de TAM Linhas Aéreas S.A., CNPJ nº 02.012.862/0001-60, com sede em Rua Ática, nº 673, andar 6, sala 62, Jardim Brasil (Zona Sul), São Paulo/SP, CEP 04634-042.',
  'a piece names the airline''s head office after its CNPJ'
);

select is(
  public.case_draft_filled('d2150000-0000-4000-8000-000000000002', 'em face de [[RE]].'),
  'em face de Azul Linhas Aéreas Brasileiras S.A., CNPJ nº 09.296.295/0001-60, com sede em Avenida Marcos Penteado de Ulhôa Rodrigues, nº 939, 9º andar, Edifício Jatobá, Condomínio Castelo Branco, Tamboré, Barueri/SP, CEP 06460-040.',
  'and another firm''s piece its own airline''s'
);

update public.airlines set address = null where iata = 'AD';
select is(
  public.case_draft_filled('d2150000-0000-4000-8000-000000000002', 'em face de [[RE]].'),
  'em face de Azul Linhas Aéreas Brasileiras S.A., CNPJ nº 09.296.295/0001-60.',
  'an airline with no address on record is named by its legal name and CNPJ, as before'
);

select * from finish();
rollback;
