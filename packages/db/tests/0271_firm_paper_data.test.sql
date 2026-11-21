begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- The firm's data read from the documents it sends (0271): what a paper of
-- the firm says of it fills the record where the record has nothing, never
-- over what a person gave, on the record and marked as read until a person
-- saves "Dados do escritório"; only the backend writes it, only from the
-- firm's own request or file; the request then hands its paragraphs of the
-- firm's data to the check of a save; the fifth marking is the one in force.
-- Two firms: nothing of one reaches the other.
--
-- Every person, firm, address and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2710000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-papel.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a2710000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-papel.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by, billing_cpf_cnpj, office_email) values
  ('b2710000-0000-4000-8000-00000000000a', 'Lima & Prado', 'lima-papel-271', 'a2710000-0000-4000-8000-000000000001', null, null),
  ('b2710000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-papel-271', 'a2710000-0000-4000-8000-000000000002',
   '11444777000161', 'contato@rocha-papel.invalid');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2710000-0000-4000-8000-00000000000a', 'a2710000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2710000-0000-4000-8000-00000000000b', 'a2710000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a2710000-0000-4000-8000-000000000001', 'GO', '12345', 'principal');
insert into public.template_imports (id, org_id, file_name, source, status, paragraphs, expected_kind) values
  ('c2710000-0000-4000-8000-00000000000a', 'b2710000-0000-4000-8000-00000000000a', 'procuracao.pdf', 'pdf', 'marking',
   '["PROCURAÇÃO", "OUTORGADOS: Lima & Prado Sociedade de Advogados, CNPJ 11.222.333/0001-81, OAB/GO 4321, Rua das Palmeiras, 100, Sala 2, Setor Oeste, Goiânia/GO, CEP 74110-010.", "Poderes da cláusula ad judicia."]',
   'procuracao'),
  ('c2710000-0000-4000-8000-00000000000b', 'b2710000-0000-4000-8000-00000000000b', 'procuracao.pdf', 'pdf', 'marking',
   '["PROCURAÇÃO", "OUTORGADOS: Rocha Advocacia.", "Poderes da cláusula ad judicia."]', 'procuracao');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

create function pg_temp.read_paper(org uuid, ref uuid, data jsonb) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.as_backend();
  set local role service_role;
  answer := public.fill_firm_office_from_paper(org, 'procuracao', ref, data);
  reset role;
  return answer;
end;
$$;

-- What the backend checked of the paper of firm A against its own text.
insert into res values ('paper', '{
  "cnpj": "11222333000181",
  "phone": "6232224455",
  "email": "Contato@Lima-Papel.invalid",
  "society": {"uf": "GO", "number": "4321"},
  "address": {"postal_code": "74110-010", "street": "Rua das Palmeiras", "number": "100", "complement": "Sala 2",
              "district": "Setor Oeste", "city": "Goiânia", "uf": "go"},
  "lawyers": [{"name": "Ana Lima", "uf": "GO", "number": "12345"},
              {"name": "Bruno Prado", "uf": "GO", "number": "054321"}]
}');

-- ---------- Only the backend writes it, and only from the firm's own request ----------

select pg_temp.sign_in('a2710000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.fill_firm_office_from_paper('b2710000-0000-4000-8000-00000000000a', 'procuracao',
       'c2710000-0000-4000-8000-00000000000a', '{}') $$,
  '42501', null,
  'a member cannot write the firm''s record as read from a paper: only the backend does'
);
reset role;

insert into res values ('foreign', pg_temp.read_paper('b2710000-0000-4000-8000-00000000000a',
  'c2710000-0000-4000-8000-00000000000b', (select payload from res where name = 'paper')));
select ok(
  (select payload ->> 'code' from res where name = 'foreign') = 'not_found'
  and (select office_street is null and billing_cpf_cnpj is null from public.organizations
       where id = 'b2710000-0000-4000-8000-00000000000a'),
  'a request of another firm reads nothing into this one'
);

-- ---------- What the record lacks is filled, and marked as read ----------

insert into res values ('first', pg_temp.read_paper('b2710000-0000-4000-8000-00000000000a',
  'c2710000-0000-4000-8000-00000000000a', (select payload from res where name = 'paper')));
select ok(
  (select payload -> 'fields' from res where name = 'first') @> '["address", "email", "society", "cnpj", "phone", "lawyers"]'
  and (select office_postal_code = '74110010' and office_street = 'Rua das Palmeiras' and office_number = '100'
         and office_complement = 'Sala 2' and office_district = 'Setor Oeste' and office_city = 'Goiânia'
         and office_uf = 'GO' and office_email = 'contato@lima-papel.invalid'
         and oab_society_uf = 'GO' and oab_society_number = '4321'
         and billing_cpf_cnpj = '11222333000181' and billing_phone = '6232224455'
       from public.organizations where id = 'b2710000-0000-4000-8000-00000000000a'),
  'the office''s address, its e-mail, the society''s registration, the CNPJ and the telephone are written where the record had none'
);
select ok(
  (select office_lawyers from public.organizations where id = 'b2710000-0000-4000-8000-00000000000a')
    = '[{"name": "Bruno Prado", "uf": "GO", "number": "54321"}]'::jsonb,
  'a lawyer of the paper who is not of the team joins the record, and a lawyer of the team does not'
);
select ok(
  (select office_read ->> 'source' = 'procuracao' and office_read ->> 'ref' = 'c2710000-0000-4000-8000-00000000000a'
          and office_read -> 'fields' @> '["address", "cnpj"]' and not office_read ? 'left'
   from public.organizations where id = 'b2710000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.audit_events where org_id = 'b2710000-0000-4000-8000-00000000000a'
              and action = 'firm.office_read' and actor_id is null and metadata -> 'fields' ? 'address')
  and (select firm_read from public.template_imports where id = 'c2710000-0000-4000-8000-00000000000a'),
  'what ONE read is marked with where it came from, on the record by ONE, and the request reads the firm''s data as its own'
);

-- ---------- Never over what a person gave ----------

insert into res values ('second', pg_temp.read_paper('b2710000-0000-4000-8000-00000000000a',
  'c2710000-0000-4000-8000-00000000000a', '{
    "cnpj": "11444777000161", "email": "outro@lima-papel.invalid",
    "address": {"postal_code": "01310-100", "street": "Avenida Paulista", "number": "1", "city": "São Paulo", "uf": "SP"},
    "lawyers": [{"name": "Bruno Prado", "uf": "GO", "number": "54321"}]
  }'));
select ok(
  (select payload ->> 'code' from res where name = 'second') = 'nothing'
  and (select office_street = 'Rua das Palmeiras' and billing_cpf_cnpj = '11222333000181'
         and office_email = 'contato@lima-papel.invalid' and jsonb_array_length(office_lawyers) = 1
       from public.organizations where id = 'b2710000-0000-4000-8000-00000000000a'),
  'a second paper changes nothing the record already has, and a lawyer already there is not taken twice'
);

-- Firm B, with its CNPJ and e-mail given, gets only its address; read without a CEP, it is kept for the form.
insert into res values ('no_cep', pg_temp.read_paper('b2710000-0000-4000-8000-00000000000b',
  'c2710000-0000-4000-8000-00000000000b', '{
    "cnpj": "11222333000181", "email": "papel@rocha-papel.invalid",
    "address": {"street": "Rua do Comércio", "number": "50", "city": "Anápolis", "uf": "GO"}
  }'));
select ok(
  (select payload -> 'fields' from res where name = 'no_cep') = '[]'::jsonb
  and (select office_street is null and billing_cpf_cnpj = '11444777000161' and office_email = 'contato@rocha-papel.invalid'
         and office_read -> 'left' ->> 'street' = 'Rua do Comércio' and office_read -> 'left' ->> 'city' = 'Anápolis'
       from public.organizations where id = 'b2710000-0000-4000-8000-00000000000b')
  and (select office_street = 'Rua das Palmeiras' from public.organizations where id = 'b2710000-0000-4000-8000-00000000000a'),
  'an address read without its CEP is kept apart for the form, nothing a person gave changes, and the other firm is untouched'
);

-- ---------- A person saves "Dados do escritório" ----------

select pg_temp.sign_in('a2710000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('saved', public.set_firm_office('b2710000-0000-4000-8000-00000000000a', '{
  "postal_code": "74110-010", "street": "Rua das Palmeiras", "number": "100", "complement": "Sala 2",
  "district": "Setor Oeste", "city": "Goiânia", "uf": "GO", "email": "contato@lima-papel.invalid",
  "society_uf": "GO", "society_number": "4321", "lawyers": []}'));
reset role;
select ok(
  (select payload ->> 'code' from res where name = 'saved') = 'saved'
  and (select office_read is null and office_lawyers = '[]'::jsonb and billing_cpf_cnpj = '11222333000181'
       from public.organizations where id = 'b2710000-0000-4000-8000-00000000000a'),
  'saving confirms what ONE read, which is no longer marked, and a lawyer of the papers left out goes'
);

select pg_temp.sign_in('a2710000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('kept', public.set_firm_office('b2710000-0000-4000-8000-00000000000b', '{
  "email": "contato@rocha-papel.invalid"}'));
reset role;
select ok(
  (select payload ->> 'code' from res where name = 'kept') = 'saved'
  and (select office_read is null and office_lawyers = '[]'::jsonb
       from public.organizations where id = 'b2710000-0000-4000-8000-00000000000b'),
  'a save without the lawyers keeps the papers'' lawyers as they were and clears the mark'
);

-- ---------- The check of a save is handed the firm's paragraphs ----------

update public.template_imports set firm_read = false where id = 'c2710000-0000-4000-8000-00000000000b';
select ok(
  public.template_import_firm_texts(
    (select paragraphs from public.template_imports where id = 'c2710000-0000-4000-8000-00000000000a'),
    '{"firm_paragraphs": [2]}', '[{"answers": ["firm_read"]}]')
    = jsonb_build_array((select paragraphs ->> 1 from public.template_imports where id = 'c2710000-0000-4000-8000-00000000000a'))
  and position('held.firm_read' in pg_get_functiondef('public.template_import_to_work(uuid, integer)'::regprocedure)) > 0,
  'the worker hands the paragraphs of the firm''s data to the check of a save once the marking read them as the firm''s'
);

-- ---------- The fifth marking ----------

select ok(
  (select count(*) from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and is_active) = 1
  and (select output_schema -> 'properties' ? 'dados_do_escritorio'
              and output_schema -> 'required' ? 'dados_do_escritorio'
       from public.prompt_versions where task = 'biblioteca.modelo.marcacao' and is_active),
  'the marking in force says what a document writes of the firm'
);

select ok(
  not has_function_privilege('authenticated', 'public.fill_firm_office_from_paper(uuid, text, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.fill_firm_office_from_paper(uuid, text, uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.fill_firm_office_from_paper(uuid, text, uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.office_read_text(text, integer, integer)', 'execute'),
  'the reading of a paper into the record is the backend''s alone'
);

select * from finish();
rollback;
