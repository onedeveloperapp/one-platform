begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- What a document says of its person enters the person's record (0063).
--
-- The AI's check reads, in the answer it already gives, what an identity
-- says of its person and the address of a proof of address; once the
-- document is accepted (by ONE, or by a person who approves the check), the
-- database writes it where the record has nothing, marks each field as read
-- from that document, and tells it in the timeline. A field somebody wrote is
-- never changed, a name is only completed, an address is taken whole, a CPF a
-- link sends counts against that link, and nothing changes under a lawsuit
-- being prepared. Two firms: nothing of one reaches the other.
--
-- Every person, firm and CPF here is invented; the CPFs are the ones manuals
-- use as examples.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@leitura.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@leitura.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-leitura', 'a6800000-0000-4000-8000-000000000001'),
  ('b6800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-leitura', 'a6800000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6800000-0000-4000-8000-00000000000a', 'a6800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6800000-0000-4000-8000-00000000000b', 'a6800000-0000-4000-8000-000000000004', 'owner', 'advogado');
-- Firm A lets ONE decide each check (the platform's default); in firm B a person decides every one.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b6800000-0000-4000-8000-00000000000b', 'document_check', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- A file the backend measured and kept (called as the service role).
create function pg_temp.stored(org uuid, file_name text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', file_name, 'application/pdf', 4000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat('a', 64), 4000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- What the model answers, in the shape of the second version of the task's schema: `read` holds what the
-- document says of its person, and the name printed on it is the name read, in capitals.
create function pg_temp.answer(decision text, matches text, read jsonb) returns jsonb language sql as $$
  select jsonb_build_object('decisao', decision,
    'motivo', case when decision = 'recusar' then 'A foto ficou escura. Envie outra.' else '' end,
    'tipo_identificado', 'documento', 'legivel', true,
    'nome_no_documento', upper(coalesce(read ->> 'nome_completo', '')), 'confere_com_a_pessoa', matches,
    'dados_lidos', jsonb_build_object('nome_completo', '', 'cpf', '', 'data_nascimento', '', 'nacionalidade', '',
      'cep', '', 'logradouro', '', 'numero', '', 'complemento', '', 'bairro', '', 'cidade', '', 'uf', '') || read,
    'observacoes', '', 'trechos', '[]'::jsonb);
$$;
-- A run of the check for a document, finished with an answer (as the service role).
create function pg_temp.checked(org uuid, document uuid, output jsonb) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'caso.documento.conferencia', repeat('f', 64), null,
    'case_document', document::text, 'doc:' || document::text || ':1');
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 1200, 300)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- A document checked by the model and applied as ONE's (firm A's checks wait for nobody).
create function pg_temp.applied(name text, org uuid, document uuid, output jsonb) returns void language plpgsql as $$
begin
  insert into res values (name, pg_temp.checked(org, document, output));
  insert into res values (name || '_applied', public.apply_unattended_document_check(pg_temp.got(name, 'run_id')::uuid));
end;
$$;
-- ---------- The cases ----------

-- Firm A: Maria, with nothing on record but her name, and the minor Joao she answers for; Rita, who has her
-- city; Carla, who has another postal code; Lucas, who already signs a paper; Bruno, whose case is being
-- prepared; and Sofia, whose own link sends her identity.
select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('maria', public.create_case('b6800000-0000-4000-8000-00000000000a', 'delay', 'G3',
  date '2026-09-20', '{"full_name": "Maria Teste"}'::jsonb));
insert into res values ('guardian', public.save_case_person(pg_temp.got('maria', 'case_id')::uuid,
  pg_temp.got('maria', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('joao', public.save_case_person(pg_temp.got('maria', 'case_id')::uuid, null,
  '{"full_name": "Joao Teste", "birth_date": "2018-07-01"}'::jsonb, 'claimant', pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('rita', public.create_case('b6800000-0000-4000-8000-00000000000a', 'delay', 'AD', null,
  '{"full_name": "Rita Costa", "city": "Goiânia", "uf": "GO"}'::jsonb));
insert into res values ('carla', public.create_case('b6800000-0000-4000-8000-00000000000a', 'delay', 'AD', null,
  '{"full_name": "Carla Dias", "postal_code": "75000000"}'::jsonb));
insert into res values ('lucas', public.create_case('b6800000-0000-4000-8000-00000000000a', 'cancellation', 'LA', null,
  '{"full_name": "Lucas Prado"}'::jsonb));
insert into res values ('bruno', public.create_case('b6800000-0000-4000-8000-00000000000a', 'cancellation', 'LA', null,
  '{"full_name": "Bruno Alves"}'::jsonb));
insert into res values ('sofia', public.create_case('b6800000-0000-4000-8000-00000000000a', 'cancellation', 'LA', null,
  '{"full_name": "Sofia Lima"}'::jsonb));
insert into res values ('sofia_link', public.create_client_link(pg_temp.got('sofia', 'case_id')::uuid,
  pg_temp.got('sofia', 'person_id')::uuid, pg_temp.hash('token-da-sofia-para-a-leitura-1234567890')));
insert into res values ('maria_link', public.create_client_link(pg_temp.got('maria', 'case_id')::uuid,
  pg_temp.got('maria', 'person_id')::uuid, pg_temp.hash('token-da-maria-para-a-leitura-1234567890')));
reset role;
-- Firm B: Paulo.
select pg_temp.sign_in('a6800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('paulo', public.create_case('b6800000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- The files, kept by the backend, and attached by the firm to each person.
select pg_temp.as_backend();
set local role service_role;
insert into res
select name, jsonb_build_object('file_id', pg_temp.stored(org::uuid, name || '.pdf'))
from (values
  ('f_identity', 'b6800000-0000-4000-8000-00000000000a'), ('f_address', 'b6800000-0000-4000-8000-00000000000a'),
  ('f_identity_2', 'b6800000-0000-4000-8000-00000000000a'), ('f_refused', 'b6800000-0000-4000-8000-00000000000a'),
  ('f_other_name', 'b6800000-0000-4000-8000-00000000000a'), ('f_joao', 'b6800000-0000-4000-8000-00000000000a'),
  ('f_ticket', 'b6800000-0000-4000-8000-00000000000a'), ('f_rita', 'b6800000-0000-4000-8000-00000000000a'),
  ('f_carla', 'b6800000-0000-4000-8000-00000000000a'), ('f_lucas', 'b6800000-0000-4000-8000-00000000000a'),
  ('f_lucas_paper', 'b6800000-0000-4000-8000-00000000000a'), ('f_bruno', 'b6800000-0000-4000-8000-00000000000a'),
  ('f_paulo', 'b6800000-0000-4000-8000-00000000000b')
) as files (name, org);
reset role;

select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res
select name, public.attach_case_document(pg_temp.got(holder, 'case_id')::uuid, pg_temp.got(file, 'file_id')::uuid,
  kind, case when party = '' then null else pg_temp.got(party, 'party_id')::uuid end)
from (values
  ('identity', 'maria', 'f_identity', 'identity', 'maria'),
  ('address', 'maria', 'f_address', 'address_proof', 'maria'),
  ('identity_2', 'maria', 'f_identity_2', 'identity', 'maria'),
  ('refused', 'maria', 'f_refused', 'identity', 'maria'),
  ('other_name', 'maria', 'f_other_name', 'identity', 'maria'),
  ('joao_identity', 'maria', 'f_joao', 'identity', 'joao'),
  ('ticket', 'maria', 'f_ticket', 'ticket', ''),
  ('rita_address', 'rita', 'f_rita', 'address_proof', 'rita'),
  ('carla_address', 'carla', 'f_carla', 'address_proof', 'carla'),
  ('lucas_identity', 'lucas', 'f_lucas', 'identity', 'lucas'),
  ('lucas_paper', 'lucas', 'f_lucas_paper', 'power_of_attorney', 'lucas'),
  ('bruno_identity', 'bruno', 'f_bruno', 'identity', 'bruno')
) as attached (name, holder, file, kind, party);
reset role;
select pg_temp.sign_in('a6800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('paulo_identity', public.attach_case_document(pg_temp.got('paulo', 'case_id')::uuid,
  pg_temp.got('f_paulo', 'file_id')::uuid, 'identity', pg_temp.got('paulo', 'party_id')::uuid));
reset role;

-- Bruno's case is being prepared already, and Lucas was sent a power of attorney to sign (0054).
update public.cases set status = 'drafting' where id = pg_temp.got('bruno', 'case_id')::uuid;
insert into public.case_papers (org_id, case_id, person_id, kind, document_id)
values ('b6800000-0000-4000-8000-00000000000a', pg_temp.got('lucas', 'case_id')::uuid,
        pg_temp.got('lucas', 'person_id')::uuid, 'procuracao', pg_temp.got('lucas_paper', 'document_id')::uuid);

-- ---------- The rule of a name an identity completes ----------

select ok(
  public.completed_name('Maria Teste', 'Maria Teste de Souza') = 'Maria Teste de Souza'
  and public.completed_name('maria teste', 'Maria Teste de Souza') = 'Maria Teste de Souza'
  and public.completed_name('Joao Silva', 'João da Silva') = 'João da Silva'
  and public.completed_name('João Silva', 'Joao da Silva') = 'João da Silva'
  and public.completed_name('Mariana Costa', 'Maria Costa de Lima') is null
  and public.completed_name('Maria Costa Lima', 'Maria Lima Costa Souza') is null
  and public.completed_name('Maria Teste de Souza', 'Maria Teste') is null
  and public.completed_name('Maria Teste', 'Maria  Teste') is null,
  'an identity completes a name whose every word it has, in order, keeping the accents either spelling has, and replaces none'
);

select ok(
  public.name_case('RUA DAS PALMEIRAS') = 'Rua das Palmeiras'
  and public.name_case('SETOR BUENO') = 'Setor Bueno'
  and public.name_case('GOIÂNIA') = 'Goiânia'
  and public.name_case('APTO 302') = 'Apto 302'
  and public.name_case('S/N') = 'S/N'
  and public.name_case('DE SOUZA E FILHOS') = 'De Souza e Filhos'
  and public.name_case('Rua das Flores') = 'Rua das Flores'
  and public.name_case('rua da praia') = 'rua da praia'
  and public.name_case(null) is null
  and public.name_case('') = '',
  'what a document gives all in capitals is written as a name, and a value with a small letter is left as it came'
);

-- ---------- ONE accepts an identity and a proof of address of Maria ----------

select pg_temp.as_backend();
set local role service_role;
select pg_temp.applied('run_identity', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('identity', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Maria Teste de Souza", "cpf": "529.982.247-25",
    "data_nascimento": "1985-04-02", "nacionalidade": "Brasileira"}'::jsonb));
select pg_temp.applied('run_address', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('address', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"cep": "74000-000", "logradouro": "Rua das Flores", "numero": "10",
    "bairro": "Centro", "cidade": "Goiânia", "uf": "go"}'::jsonb));
reset role;

select ok(
  pg_temp.got('run_identity_applied', 'code') = 'accepted'
  and (select full_name = 'Maria Teste de Souza' and cpf = '52998224725' and birth_date = date '1985-04-02'
              and nationality = 'brasileira' and updated_via = 'document'
       from public.people where id = pg_temp.got('maria', 'person_id')::uuid),
  'an identity ONE accepted completes the name and writes the CPF, the birth date and the nationality the record lacked'
);

select ok(
  (select postal_code = '74000000' and street = 'Rua das Flores' and address_number = '10' and district = 'Centro'
              and city = 'Goiânia' and uf = 'GO' and complement is null
       from public.people where id = pg_temp.got('maria', 'person_id')::uuid),
  'a proof of address ONE accepted writes the address whole'
);

select ok(
  (select read_fields -> 'cpf' = jsonb_build_object('document', pg_temp.got('identity', 'document_id'), 'kind', 'identity')
              and read_fields -> 'street' = jsonb_build_object('document', pg_temp.got('address', 'document_id'), 'kind', 'address_proof')
              and read_fields ?& array['full_name', 'birth_date', 'nationality', 'postal_code', 'address_number', 'district', 'city', 'uf']
              and not read_fields ? 'complement'
       from public.people where id = pg_temp.got('maria', 'person_id')::uuid)
  and (select count(*) = 2 and bool_and(e.actor_type = 'ai')
              and bool_and(not e.data::text like '%52998224725%' and not e.data::text like '%Flores%')
       from public.case_events e
       where e.case_id = pg_temp.got('maria', 'case_id')::uuid and e.kind = 'person_read')
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('maria', 'case_id')::uuid and e.kind = 'person_read'
                and e.data -> 'fields' ? 'cpf' and e.data ->> 'document' = pg_temp.got('identity', 'document_id')),
  'each field is marked as read from its document, and the timeline tells it by the names of the fields, never their values'
);

-- ---------- What a document never changes ----------

select pg_temp.as_backend();
set local role service_role;
-- A second identity with another CPF, birth date and a longer name: what is on record stays.
select pg_temp.applied('run_identity_2', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('identity_2', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Maria Teste de Souza Lima", "cpf": "111.444.777-35",
    "data_nascimento": "1990-01-01", "nacionalidade": "portuguesa"}'::jsonb));
-- A refused identity, and an identity the model says is somebody else's.
select pg_temp.applied('run_refused', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('refused', 'document_id')::uuid,
  pg_temp.answer('recusar', 'sim', '{"nome_completo": "Maria Teste de Souza", "cpf": "111.444.777-35"}'::jsonb));
select pg_temp.applied('run_other_name', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('other_name', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'nao', '{"nome_completo": "Marta Teste", "cpf": "111.444.777-35"}'::jsonb));
-- A ticket is nobody's: what it would say of a person goes nowhere.
select pg_temp.applied('run_ticket', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('ticket', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sem_nome', '{"cpf": "111.444.777-35", "cep": "74000-999", "logradouro": "Rua A",
    "cidade": "Goiânia", "uf": "GO"}'::jsonb));
reset role;

select ok(
  (select full_name = 'Maria Teste de Souza' and cpf = '52998224725' and birth_date = date '1985-04-02'
              and nationality = 'brasileira' and postal_code = '74000000'
       from public.people where id = pg_temp.got('maria', 'person_id')::uuid)
  and pg_temp.got('run_refused_applied', 'code') = 'rejected'
  and (select count(*) = 2 from public.case_events e
       where e.case_id = pg_temp.got('maria', 'case_id')::uuid and e.kind = 'person_read'),
  'a field on record is never changed, a name ONE completed is not completed again, and a refused document, one of somebody else or one of nobody writes nothing'
);

select pg_temp.as_backend();
set local role service_role;
-- The minor's identity: the name completed and the CPF, never a nationality; the birth date on record stays.
select pg_temp.applied('run_joao', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('joao_identity', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Joao Teste da Silva", "cpf": "123.456.789-09",
    "data_nascimento": "2018-07-01", "nacionalidade": "brasileira"}'::jsonb));
reset role;

select ok(
  (select full_name = 'Joao Teste da Silva' and cpf = '12345678909' and birth_date = date '2018-07-01'
              and nationality is null and read_fields ?& array['full_name', 'cpf'] and not read_fields ? 'birth_date'
       from public.people where id = pg_temp.got('joao', 'person_id')::uuid),
  'a minor''s identity writes the name and the CPF, and no nationality, which nobody asks of a minor'
);

select pg_temp.as_backend();
set local role service_role;
-- Rita has her city: a bill of that city fills the rest of the address, its capitals written as names (0065).
select pg_temp.applied('run_rita', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('rita_address', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"cep": "74000001", "logradouro": "AVENIDA DAS NAÇÕES", "numero": "100",
    "complemento": "QD 12 LT 5", "bairro": "SETOR CENTRAL", "cidade": "GOIANIA", "uf": "GO"}'::jsonb));
-- Carla has another postal code: her bill says another address, and nothing of it is written.
select pg_temp.applied('run_carla', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('carla_address', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"cep": "74000002", "logradouro": "Rua B", "numero": "5", "bairro": "Centro",
    "cidade": "Goiânia", "uf": "GO"}'::jsonb));
reset role;

select ok(
  (select postal_code = '74000001' and street = 'Avenida das Nações' and address_number = '100'
              and complement = 'Qd 12 Lt 5' and district = 'Setor Central' and city = 'Goiânia' and uf = 'GO'
              and read_fields ?& array['postal_code', 'street', 'address_number', 'complement', 'district']
              and not read_fields ?| array['city', 'uf']
       from public.people where id = pg_temp.got('rita', 'person_id')::uuid)
  and (select postal_code = '75000000' and street is null and city is null and read_fields = '{}'::jsonb
       from public.people where id = pg_temp.got('carla', 'person_id')::uuid),
  'an address is written only where what the record has of one agrees with it, and only in what is missing'
);

select pg_temp.as_backend();
set local role service_role;
-- Lucas: Maria's CPF, which the firm has for her, and a longer name, while a paper of his waits to be signed.
select pg_temp.applied('run_lucas', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('lucas_identity', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Lucas Prado Neto", "cpf": "529.982.247-25",
    "data_nascimento": "1979-11-30"}'::jsonb));
-- Bruno's case is being prepared: his identity is accepted, and his record is left as it is.
select pg_temp.applied('run_bruno', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('bruno_identity', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Bruno Alves Pinto", "cpf": "111.444.777-35",
    "data_nascimento": "1980-02-03"}'::jsonb));
reset role;

select ok(
  (select full_name = 'Lucas Prado' and cpf is null and birth_date = date '1979-11-30' and read_fields ?| array['birth_date']
       from public.people where id = pg_temp.got('lucas', 'person_id')::uuid)
  and pg_temp.got('run_bruno_applied', 'code') = 'accepted'
  and (select full_name = 'Bruno Alves' and cpf is null and birth_date is null and read_fields = '{}'::jsonb
       from public.people where id = pg_temp.got('bruno', 'person_id')::uuid),
  'a CPF the firm has for somebody else is never written, a name signed in a paper is not completed, and nothing changes under a lawsuit being prepared'
);

-- ---------- A CPF a link sends ----------

-- Sofia sends her identity through her link.
select pg_temp.as_client();
set local role anon;
insert into res values ('sofia_reserve', public.client_link_reserve_upload('token-da-sofia-para-a-leitura-1234567890',
  'identity', pg_temp.got('sofia', 'party_id')::uuid, 'rg-sofia.pdf', 'application/pdf', 4000));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('sofia_reserve', 'file_id')::uuid, repeat('b', 64), 4000, 'application/pdf', 1);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('sofia_finish', public.client_link_finish_upload('token-da-sofia-para-a-leitura-1234567890',
  pg_temp.got('sofia_reserve', 'document_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.applied('run_sofia', 'b6800000-0000-4000-8000-00000000000a', pg_temp.got('sofia_reserve', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Sofia Lima", "cpf": "111.444.777-35"}'::jsonb));
reset role;

select ok(
  pg_temp.got('sofia_finish', 'code') = 'received'
  and (select cpf = '11144477735' from public.people where id = pg_temp.got('sofia', 'person_id')::uuid)
  and (select cpf_attempts = 1 from public.client_links where id = pg_temp.got('sofia_link', 'link_id')::uuid),
  'a CPF read from a document a link sent is one more of the CPFs that link may write'
);

-- ---------- The client and the firm read the marks ----------

select pg_temp.as_client();
set local role anon;
insert into res values ('maria_open', public.client_link_open('token-da-maria-para-a-leitura-1234567890'));
reset role;

select ok(
  (select p -> 'read_fields' ? 'cpf' and p -> 'read_fields' -> 'cpf' ->> 'kind' = 'identity'
   from res, jsonb_array_elements(res.payload -> 'people') as p
   where res.name = 'maria_open' and p ->> 'person_id' = pg_temp.got('maria', 'person_id'))
  and (select bool_and(d ? 'processing') and count(*) > 0
       from res, jsonb_array_elements(res.payload -> 'documents') as d where res.name = 'maria_open'),
  'the client''s link says which of their data were read from a document, and whether a document is still being read'
);

-- The firm corrects Maria's CPF: that mark goes, the others stay.
select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('correct', public.save_case_person(pg_temp.got('maria', 'case_id')::uuid,
  pg_temp.got('maria', 'person_id')::uuid, '{"cpf": "111.444.777-35"}'::jsonb));
reset role;

select ok(
  pg_temp.got('correct', 'code') = 'cpf_in_use'
  and (select cpf = '52998224725' and read_fields ? 'cpf' from public.people where id = pg_temp.got('maria', 'person_id')::uuid),
  'a correction the database refuses changes nothing, the mark included'
);

select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('correct_2', public.save_case_person(pg_temp.got('maria', 'case_id')::uuid,
  pg_temp.got('maria', 'person_id')::uuid, '{"birth_date": "1985-04-03", "district": "Setor Oeste"}'::jsonb));
reset role;

select ok(
  pg_temp.got('correct_2', 'code') = 'saved'
  and (select birth_date = date '1985-04-03' and district = 'Setor Oeste' and updated_via = 'firm'
              and not read_fields ?| array['birth_date', 'district']
              and read_fields ?& array['full_name', 'cpf', 'nationality', 'postal_code', 'street', 'city', 'uf']
       from public.people where id = pg_temp.got('maria', 'person_id')::uuid),
  'a field a person writes is theirs: its mark goes, and the marks of the fields they left stay'
);

-- ---------- A person decides the check, in firm B ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_paulo', pg_temp.checked('b6800000-0000-4000-8000-00000000000b',
  pg_temp.got('paulo_identity', 'document_id')::uuid,
  pg_temp.answer('aceitar', 'sim', '{"nome_completo": "Paulo Teste Rocha", "cpf": "529.982.247-25",
    "data_nascimento": "1975-08-09", "nacionalidade": "brasileira"}'::jsonb)));
reset role;

select ok(
  pg_temp.got('run_paulo', 'approval_id') is not null
  and (select full_name = 'Paulo Teste' and cpf is null and read_fields = '{}'::jsonb
       from public.people where id = pg_temp.got('paulo', 'person_id')::uuid),
  'where a person decides the checks, nothing of the document is written while its check waits'
);

select pg_temp.sign_in('a6800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('approve_paulo', public.decide_approval(pg_temp.got('run_paulo', 'approval_id')::uuid, 'approved'));
reset role;

select ok(
  pg_temp.got('approve_paulo', 'code') = 'approved'
  and (select full_name = 'Paulo Teste Rocha' and cpf = '52998224725' and birth_date = date '1975-08-09'
              and nationality = 'brasileira'
       from public.people where id = pg_temp.got('paulo', 'person_id')::uuid)
  and exists (select 1 from public.case_events e
              where e.case_id = pg_temp.got('paulo', 'case_id')::uuid and e.kind = 'person_read' and e.actor_type = 'person'),
  'approved by a person, the check writes what the document says, the CPF another firm has for its own client included'
);

-- ---------- Each firm reads its own ----------

select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  not exists (select 1 from public.people where id = pg_temp.got('paulo', 'person_id')::uuid)
  and (select read_fields ? 'full_name' from public.people where id = pg_temp.got('maria', 'person_id')::uuid),
  'a firm reads the marks of its own clients and nothing of another firm''s'
);
select throws_ok(
  format('select public.apply_document_data(%L, %L::jsonb, %L)', pg_temp.got('identity', 'document_id'), '{}', 'person'),
  '42501', null,
  'nobody of a firm writes a document''s data by hand: only the decided check does'
);
reset role;

-- The second version reads what a document says of its person (0063), the third writes its address as names (0065),
-- the fourth reads the purchase on a ticket and the expense on a receipt (0091), the fifth no longer refuses a bill
-- in somebody else's name for the name on it (0123), the sixth no identity for its name (0236), the
-- seventh reads the date of a bill (0237), the eighth the names on a document of the link to a bill's holder (0294).
select ok(
  (select array_agg(v.version::text || ':' || v.is_active::text order by v.version)
   from public.prompt_versions v where v.task = 'caso.documento.conferencia') = array['1:false', '2:false', '3:false', '4:false', '5:false', '6:false', '7:false', '8:true']
  and (select v.system_prompt like '%nunca a data de expedição nem a de validade%'
              and v.system_prompt like '%bairro e cidade (cada um escrito como um nome%'
              and v.output_schema -> 'properties' ? 'dados_lidos'
       from public.prompt_versions v where v.task = 'caso.documento.conferencia' and v.is_active)
  and (select count(distinct v.model) = 1 from public.prompt_versions v where v.task = 'caso.documento.conferencia'),
  'the instructions in force read what a document says of its person and ask for its address written as names, with the same model'
);

select * from finish();
rollback;
