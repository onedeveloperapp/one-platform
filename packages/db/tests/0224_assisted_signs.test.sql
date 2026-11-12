begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- O adolescente de 16 ou 17 anos assina junto com quem o assiste (0224).
-- Rui answers for Lia, 17, whom he assists, and for Pedro, 10, whom he
-- represents. ONE issues Rui's power of attorney with Lia as its second
-- signer, never Pedro; Rui's link shows Lia's part. Lia signs the
-- declaration of hardship only when she asks free justice. In the other
-- firm, Bia answers for Caio, 15: she signs alone.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2240000-0000-4000-8000-000000000001', 'ana@souza-assiste.invalid', 'Ana Souza'),
  ('a2240000-0000-4000-8000-000000000002', 'caio@rocha-assiste.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2240000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-assiste', 'a2240000-0000-4000-8000-000000000001'),
  ('b2240000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-assiste', 'a2240000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2240000-0000-4000-8000-00000000000a', 'a2240000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2240000-0000-4000-8000-00000000000b', 'a2240000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2240000-0000-4000-8000-000000000001', 'b2240000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting'),
  ('c2240000-0000-4000-8000-000000000002', 'b2240000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'drafting');
insert into public.people (id, org_id, full_name, cpf, birth_date, nationality, marital_status, profession,
                           street, address_number, district, city, uf, postal_code) values
  ('d2240000-0000-4000-8000-000000000001', 'b2240000-0000-4000-8000-00000000000a', 'Rui Teste', '52998224725',
   '1980-01-01', 'brasileira', 'casado', 'Professor', 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO', '74000000'),
  ('d2240000-0000-4000-8000-000000000002', 'b2240000-0000-4000-8000-00000000000a', 'Lia Teste', '11144477735',
   (current_date - interval '17 years')::date, 'brasileira', 'solteiro', 'Estudante', 'Rua das Flores', '10', 'Centro',
   'Goiânia', 'GO', '74000000'),
  ('d2240000-0000-4000-8000-000000000003', 'b2240000-0000-4000-8000-00000000000a', 'Pedro Teste', null,
   (current_date - interval '10 years')::date, null, null, null, null, null, null, null, null, null),
  ('d2240000-0000-4000-8000-000000000004', 'b2240000-0000-4000-8000-00000000000b', 'Bia Teste', '12345678909',
   '1985-03-03', 'brasileira', 'solteiro', 'Médica', 'Rua dos Ipês', '20', 'Setor Sul', 'Goiânia', 'GO', '74080000'),
  ('d2240000-0000-4000-8000-000000000005', 'b2240000-0000-4000-8000-00000000000b', 'Caio Teste', null,
   (current_date - interval '15 years')::date, null, null, null, null, null, null, null, null, null);
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e2240000-0000-4000-8000-000000000001', 'b2240000-0000-4000-8000-00000000000a', 'c2240000-0000-4000-8000-000000000001',
   'd2240000-0000-4000-8000-000000000001', 'claimant', null),
  ('e2240000-0000-4000-8000-000000000004', 'b2240000-0000-4000-8000-00000000000b', 'c2240000-0000-4000-8000-000000000002',
   'd2240000-0000-4000-8000-000000000004', 'claimant', null);
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e2240000-0000-4000-8000-000000000002', 'b2240000-0000-4000-8000-00000000000a', 'c2240000-0000-4000-8000-000000000001',
   'd2240000-0000-4000-8000-000000000002', 'claimant', 'e2240000-0000-4000-8000-000000000001'),
  ('e2240000-0000-4000-8000-000000000003', 'b2240000-0000-4000-8000-00000000000a', 'c2240000-0000-4000-8000-000000000001',
   'd2240000-0000-4000-8000-000000000003', 'claimant', 'e2240000-0000-4000-8000-000000000001'),
  ('e2240000-0000-4000-8000-000000000005', 'b2240000-0000-4000-8000-00000000000b', 'c2240000-0000-4000-8000-000000000002',
   'd2240000-0000-4000-8000-000000000005', 'claimant', 'e2240000-0000-4000-8000-000000000004');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7224000-0000-4000-8000-000000000001', 'b2240000-0000-4000-8000-00000000000a', 'c2240000-0000-4000-8000-000000000001',
   'd2240000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-rui-assiste', 'UTF8')), 'hex'),
   now() + interval '30 days', now());

create function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

select ok(
  (select array_agg(full_name order by seq) = array['Lia Teste']
   from public.paper_cosigners('c2240000-0000-4000-8000-000000000001', 'd2240000-0000-4000-8000-000000000001', 'procuracao'))
    and not exists (select 1 from public.paper_cosigners('c2240000-0000-4000-8000-000000000001',
                    'd2240000-0000-4000-8000-000000000001', 'contrato')),
  'Lia, 17, signs Rui''s power of attorney beside him; Pedro, 10, is represented and signs nothing, and nobody signs the contract with him'
);

select ok(
  not exists (select 1 from public.paper_cosigners('c2240000-0000-4000-8000-000000000001',
              'd2240000-0000-4000-8000-000000000001', 'declaracao_hipossuficiencia')),
  'Lia signs the declaration of hardship only when she asks free justice'
);

-- ONE issues Rui's power of attorney.
update public.case_advances set claimed_at = now(), claims = claims + 1
where case_id = 'c2240000-0000-4000-8000-000000000001';
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at)
values ('a8224000-0000-4000-8000-0000000000aa', 'b2240000-0000-4000-8000-00000000000a', 'paper', 'org/x/procuracao',
        'procuracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('issued', public.advance_record_paper('c2240000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c2240000-0000-4000-8000-000000000001'),
  'd2240000-0000-4000-8000-000000000001', 'procuracao',
  public.paper_template_for('b2240000-0000-4000-8000-00000000000a', 'procuracao'),
  jsonb_build_object('file_id', 'a8224000-0000-4000-8000-0000000000aa', 'sha256', repeat('f', 64), 'bytes', '100', 'pages', '1')));
reset role;
select ok(
  (select value ->> 'code' = 'issued' from res where key = 'issued')
    and (select jsonb_agg(jsonb_build_array((s ->> 'position')::integer, s ->> 'name') order by (s ->> 'position')::integer)
         = '[[1, "Rui Teste"], [2, "Lia Teste"]]'::jsonb
         from public.signature_envelopes e, jsonb_array_elements(e.signers) s
         where e.id = (select (value ->> 'envelope_id')::uuid from res where key = 'issued')),
  'ONE issues the power of attorney with Rui first and Lia second, each a signer of the same envelope'
);

set local role anon;
insert into res values ('link', public.client_link_signatures('token-do-rui-assiste'));
reset role;
select ok(
  (select jsonb_array_length(value -> 'signatures') = 1
          and value #> '{signatures,0,assisted}' = '[{"name": "Lia Teste", "sign_url": null, "signed_at": null}]'::jsonb
   from res where key = 'link'),
  'Rui''s link shows Lia''s part of the document he signs'
);

select ok(
  not exists (select 1 from public.paper_cosigners('c2240000-0000-4000-8000-000000000002',
              'd2240000-0000-4000-8000-000000000004', 'procuracao'))
    and not exists (select 1 from public.paper_cosigners('c2240000-0000-4000-8000-000000000001',
                    'd2240000-0000-4000-8000-000000000004', 'procuracao')),
  'in the other firm Bia signs alone for Caio, 15, and nobody of one firm co-signs a paper of the other'
);

select * from finish();
rollback;
