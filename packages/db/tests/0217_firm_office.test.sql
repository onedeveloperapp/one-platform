begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- Where the firm is, in the power of attorney (0217): who manages the firm
-- says its address, its e-mail and its registration at the bar, whole or
-- not at all, on the record; a member who does not manage it cannot; the
-- paper writes them after the firm's name, and a firm that gave none is
-- named as before. Two firms: nothing of one reaches the other.
--
-- Every person, firm and address here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2170000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-sede.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2170000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-sede.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a2170000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-sede.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now());
insert into public.organizations (id, name, slug, created_by, billing_cpf_cnpj) values
  ('b2170000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-sede-217', 'a2170000-0000-4000-8000-000000000001', '11222333000181'),
  ('b2170000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-sede-217', 'a2170000-0000-4000-8000-000000000002', null);
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2170000-0000-4000-8000-00000000000a', 'a2170000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2170000-0000-4000-8000-00000000000a', 'a2170000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b2170000-0000-4000-8000-00000000000b', 'a2170000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.people (id, org_id, full_name) values
  ('d2170000-0000-4000-8000-000000000001', 'b2170000-0000-4000-8000-00000000000a', 'Maria Teste'),
  ('d2170000-0000-4000-8000-000000000002', 'b2170000-0000-4000-8000-00000000000b', 'João Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2170000-0000-4000-8000-000000000001', 'b2170000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'signature'),
  ('c2170000-0000-4000-8000-000000000002', 'b2170000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'signature');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.office(who uuid, org uuid, payload jsonb) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.set_firm_office(org, payload);
  reset role;
  return answer;
end;
$$;

insert into res values ('member', pg_temp.office('a2170000-0000-4000-8000-000000000003', 'b2170000-0000-4000-8000-00000000000a',
  '{"postal_code": "74000-000", "street": "Rua das Flores", "city": "Goiânia", "uf": "GO"}'));
insert into res values ('half', pg_temp.office('a2170000-0000-4000-8000-000000000001', 'b2170000-0000-4000-8000-00000000000a',
  '{"postal_code": "74000-000", "street": "Rua das Flores"}'));
insert into res values ('other', pg_temp.office('a2170000-0000-4000-8000-000000000002', 'b2170000-0000-4000-8000-00000000000a',
  '{"postal_code": "74000-000", "street": "Rua das Flores", "city": "Goiânia", "uf": "GO"}'));
select ok(
  (select payload ->> 'code' from res where name = 'member') = 'not_authorized'
  and (select payload ->> 'field' from res where name = 'half') = 'address'
  and (select payload ->> 'code' from res where name = 'other') = 'not_authorized'
  and (select office_postal_code is null from public.organizations where id = 'b2170000-0000-4000-8000-00000000000a'),
  'a member who does not manage the firm, an address half given and another firm''s owner change nothing'
);

insert into res values ('saved', pg_temp.office('a2170000-0000-4000-8000-000000000001', 'b2170000-0000-4000-8000-00000000000a',
  '{"postal_code": "74000-000", "street": "Rua das Flores", "number": "10", "complement": "sala 3", "district": "Centro",
    "city": "Goiânia", "uf": "go", "email": "Contato@Souza.invalid", "society_uf": "GO", "society_number": "1.234"}'));
select ok(
  (select payload ->> 'code' from res where name = 'saved') = 'saved'
  and (select office_postal_code = '74000000' and office_uf = 'GO' and office_email = 'contato@souza.invalid'
              and oab_society_uf = 'GO' and oab_society_number = '1234'
       from public.organizations where id = 'b2170000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.audit_events where action = 'firm.office_set'
              and org_id = 'b2170000-0000-4000-8000-00000000000a' and actor_id = 'a2170000-0000-4000-8000-000000000001'),
  'who manages the firm says where it is, its e-mail and its registration at the bar, on the record'
);

select is(
  public.case_paper_filled('c2170000-0000-4000-8000-000000000001', 'd2170000-0000-4000-8000-000000000001',
    'do escritório [[ESCRITORIO]].'),
  'do escritório Souza Advogados, CNPJ nº 11.222.333/0001-81, inscrita na OAB/GO sob o nº 1234, com sede em Rua das Flores, nº 10, sala 3, Centro, Goiânia/GO, CEP 74000-000, endereço eletrônico contato@souza.invalid.',
  'the power of attorney names the firm''s registration, address and e-mail after its name and CNPJ'
);

select is(
  public.case_paper_filled('c2170000-0000-4000-8000-000000000002', 'd2170000-0000-4000-8000-000000000002',
    'do escritório [[ESCRITORIO]].'),
  'do escritório Rocha Advocacia.',
  'a firm that gave none is named as before'
);

select ok(
  not has_function_privilege('authenticated', 'public.firm_office_words(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_firm_office(uuid, jsonb)', 'EXECUTE'),
  'the words of a paper are the database''s, and nobody signed out says where a firm is'
);

select * from finish();
rollback;
