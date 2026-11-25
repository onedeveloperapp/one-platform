begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ============================================================
-- A case a person of the firm opens (0292). Firm A already has Rita (phone and e-mail on record) and Davi (no e-mail):
-- a case opened with Rita's CPF and the phone and e-mail left blank keeps hers, and her name as recorded; Davi's
-- e-mail typed fills what his record lacked while his phone stays; a CPF the firm does not have is somebody new. A case
-- opened from Rita's page is hers, and nobody new is made; another firm's person, or one whose data were erased, is
-- refused. A case of firm A's family area opens under its script, of a kind the script lists, with its work outside the
-- lawsuit; an area a module serves, an area with no script published and a kind the script does not list are refused.
-- Firm B opens nothing in firm A and reads none of its cases; nobody calls the rule of the client directly.
--
-- Every person, firm, number and name here is invented; the CPFs are the manuals' examples.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2920000-0000-4000-8000-000000000001', 'lia@pires-caso-pessoa.invalid', 'Lia Pires'),
  ('a2920000-0000-4000-8000-000000000002', 'otto@reis-caso-pessoa.invalid', 'Otto Reis')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2920000-0000-4000-8000-00000000000a', 'Pires Advogados', 'pires-caso-pessoa', 'a2920000-0000-4000-8000-000000000001'),
  ('b2920000-0000-4000-8000-00000000000b', 'Reis Advocacia', 'reis-caso-pessoa', 'a2920000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2920000-0000-4000-8000-00000000000a', 'a2920000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2920000-0000-4000-8000-00000000000b', 'a2920000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.people (id, org_id, full_name, cpf, phone, email, erased_at) values
  ('c2920000-0000-4000-8000-0000000000a1', 'b2920000-0000-4000-8000-00000000000a', 'Rita Moraes Lima', '52998224725',
   '5562999920001', 'rita@moraes-caso-pessoa.invalid', null),
  ('c2920000-0000-4000-8000-0000000000a2', 'b2920000-0000-4000-8000-00000000000a', 'Davi Nunes Prado', '11144477735',
   '5562999920002', null, null),
  ('c2920000-0000-4000-8000-0000000000a3', 'b2920000-0000-4000-8000-00000000000a', 'Pessoa Apagada', null, null, null, now()),
  ('c2920000-0000-4000-8000-0000000000b1', 'b2920000-0000-4000-8000-00000000000b', 'Bia Torres Melo', null,
   '5562999920003', null, null);

-- Firm A's family area, its script published; its labour area with no script; and the area of the module.
insert into public.firm_areas (id, org_id, law_area, name, source) values
  ('e2920000-0000-4000-8000-0000000000a1', 'b2920000-0000-4000-8000-00000000000a', 'familia', 'Família e sucessões', 'person'),
  ('e2920000-0000-4000-8000-0000000000a2', 'b2920000-0000-4000-8000-00000000000a', null, 'Consumidor', 'person');
insert into public.firm_areas (org_id, law_area, name, source)
select 'b2920000-0000-4000-8000-00000000000a', 'passageiro', 'Direito do Passageiro', 'module'
where not exists (
  select 1 from public.firm_areas a
  where a.org_id = 'b2920000-0000-4000-8000-00000000000a' and a.law_area = 'passageiro' and a.removed_at is null
);
insert into public.firm_area_scripts (id, org_id, area_id, version, status, script, published_at) values
  ('e2920000-0000-4000-8000-0000000000a3', 'b2920000-0000-4000-8000-00000000000a', 'e2920000-0000-4000-8000-0000000000a1', 1,
   'published', jsonb_build_object(
     'tipos', jsonb_build_array(jsonb_build_object('chave', 'divorcio', 'nome', 'Divórcio consensual',
       'documentos', jsonb_build_array(
         jsonb_build_object('chave', 'rg', 'nome', 'RG ou CNH', 'tipo', 'identity', 'por', 'pessoa', 'essencial', true),
         jsonb_build_object('chave', 'certidao', 'nome', 'Certidão de casamento', 'tipo', 'other', 'por', 'caso', 'essencial', true)),
       'pecas', '[]'::jsonb)),
     'perguntas', '[]'::jsonb, 'etapas', '[]'::jsonb,
     'tarefas', jsonb_build_array(jsonb_build_object('chave', 'partilha', 'nome', 'Lista dos bens a partilhar',
       'quem', 'cliente', 'fase', 'documentos', 'tipos', '[]'::jsonb)),
     'honorarios', '', 'duvidas', '', 'recusa', '', 'tribunais', '[]'::jsonb, 'sensiveis', '[]'::jsonb),
   now());

create temp table res (name text primary key, value jsonb);
grant select, insert on res to authenticated;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> field from res where name = key $$;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

select pg_temp.sign_in('a2920000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values
  ('rita', public.create_case('b2920000-0000-4000-8000-00000000000a', 'delay', null, null,
     jsonb_build_object('full_name', 'Rita', 'cpf', '529.982.247-25', 'phone', null, 'email', null))),
  ('davi', public.create_case('b2920000-0000-4000-8000-00000000000a', 'cancellation', null, null,
     jsonb_build_object('full_name', 'Davi N. Prado', 'cpf', '11144477735', 'phone', '62 99999-0000',
                        'email', 'davi@nunes-caso-pessoa.invalid'))),
  ('new', public.create_case('b2920000-0000-4000-8000-00000000000a', 'overbooking', null, null,
     jsonb_build_object('full_name', 'Caio Brito Sales', 'cpf', '12345678909', 'phone', null, 'email', null))),
  ('page', public.create_case('b2920000-0000-4000-8000-00000000000a', 'delay', null, null, '{}'::jsonb,
     null, null, 'c2920000-0000-4000-8000-0000000000a1')),
  ('other_firm', public.create_case('b2920000-0000-4000-8000-00000000000a', 'delay', null, null, '{}'::jsonb,
     null, null, 'c2920000-0000-4000-8000-0000000000b1')),
  ('erased', public.create_case('b2920000-0000-4000-8000-00000000000a', 'delay', null, null, '{}'::jsonb,
     null, null, 'c2920000-0000-4000-8000-0000000000a3')),
  ('area', public.create_area_case('b2920000-0000-4000-8000-00000000000a', 'e2920000-0000-4000-8000-0000000000a1',
     'divorcio', '{}'::jsonb, 'c2920000-0000-4000-8000-0000000000a2', 'referral')),
  ('area_new', public.create_area_case('b2920000-0000-4000-8000-00000000000a', 'e2920000-0000-4000-8000-0000000000a1',
     'divorcio', jsonb_build_object('full_name', 'Lara Gomes Dias'))),
  ('area_kind', public.create_area_case('b2920000-0000-4000-8000-00000000000a', 'e2920000-0000-4000-8000-0000000000a1',
     'inventario', jsonb_build_object('full_name', 'Lara Gomes Dias'))),
  ('area_script', public.create_area_case('b2920000-0000-4000-8000-00000000000a', 'e2920000-0000-4000-8000-0000000000a2',
     'divorcio', jsonb_build_object('full_name', 'Lara Gomes Dias'))),
  ('area_module', public.create_area_case('b2920000-0000-4000-8000-00000000000a',
     (select a.id from public.firm_areas a
      where a.org_id = 'b2920000-0000-4000-8000-00000000000a' and a.law_area = 'passageiro' and a.removed_at is null),
     'divorcio', jsonb_build_object('full_name', 'Lara Gomes Dias')));
reset role;

-- ---------- A client the firm already has keeps what their record holds ----------

select is(pg_temp.got('rita', 'person_id'), 'c2920000-0000-4000-8000-0000000000a1', 'a CPF the firm has opens the case for that person');
select is((select full_name || ' · ' || phone || ' · ' || email from public.people where id = 'c2920000-0000-4000-8000-0000000000a1'),
  'Rita Moraes Lima · 5562999920001 · rita@moraes-caso-pessoa.invalid',
  'the phone and e-mail left blank, and the name typed, leave her record as it was');
select is((select phone || ' · ' || email from public.people where id = 'c2920000-0000-4000-8000-0000000000a2'),
  '5562999920002 · davi@nunes-caso-pessoa.invalid', 'what was typed fills what the record lacked, and the phone on record stays');
select is((select full_name || ' · ' || cpf from public.people p where p.id = pg_temp.got('new', 'person_id')::uuid
           and p.id not in ('c2920000-0000-4000-8000-0000000000a1', 'c2920000-0000-4000-8000-0000000000a2')),
  'Caio Brito Sales · 12345678909', 'a CPF the firm does not have is somebody new');

-- ---------- From the person's page ----------

select is(pg_temp.got('page', 'ok') || ' ' || pg_temp.got('page', 'person_id'),
  'true c2920000-0000-4000-8000-0000000000a1', 'a case opened from her page is hers');
select is((select count(*)::integer from public.people where org_id = 'b2920000-0000-4000-8000-00000000000a'), 5,
  'and nobody new was made for it (three of the firm, the new CPF''s and the area''s new client)');
select is(pg_temp.got('other_firm', 'code') || ' ' || pg_temp.got('erased', 'code'),
  'person_not_found person_not_found', 'another firm''s person and one whose data were erased are refused');
select is((select count(*)::integer from public.cases where org_id = 'b2920000-0000-4000-8000-00000000000a'), 6,
  'a refused case leaves no case behind (four of the module, two of the area)');

-- ---------- A case of an area of the firm ----------

select is((select coalesce(c.module, 'sem módulo') || ' · ' || a.name || ' · ' || c.case_type || ' · ' || c.origin
           from public.cases c join public.firm_areas a on a.id = c.area_id
           where c.id = pg_temp.got('area', 'case_id')::uuid and c.area_script_id = 'e2920000-0000-4000-8000-0000000000a3'),
  'sem módulo · Família e sucessões · divorcio · referral', 'an area''s case is of no module, of the area, its kind and its script');
select is((select cp.person_id::text from public.case_parties cp where cp.case_id = pg_temp.got('area', 'case_id')::uuid),
  'c2920000-0000-4000-8000-0000000000a2', 'opened from Davi''s page, it is his');
select is((select string_agg(t.name, ', ') from public.case_tasks t where t.case_id = pg_temp.got('area', 'case_id')::uuid),
  'Lista dos bens a partilhar', 'with the work outside the lawsuit its script gives');
select is(pg_temp.got('area_new', 'ok'), 'true', 'somebody new opens an area''s case by their name');
select is(pg_temp.got('area_kind', 'code') || ' ' || pg_temp.got('area_script', 'code') || ' ' || pg_temp.got('area_module', 'code'),
  'invalid_case_type no_area_script area_not_found',
  'a kind the script does not list, an area with no script published and an area a module serves are refused');

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a2920000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.create_area_case('b2920000-0000-4000-8000-00000000000a',
  'e2920000-0000-4000-8000-0000000000a1', 'divorcio', '{"full_name":"Otto Reis"}'::jsonb)$$,
  '42501', null, 'firm B opens no case in firm A');
select is((select count(*)::integer from public.cases where org_id = 'b2920000-0000-4000-8000-00000000000a'), 0,
  'firm B reads none of firm A''s cases');
select throws_ok($$select public.case_client_person('b2920000-0000-4000-8000-00000000000b', null,
  '{"full_name":"Otto Reis"}'::jsonb, 'a2920000-0000-4000-8000-000000000002')$$,
  '42501', null, 'nobody calls the rule of the client directly');
reset role;

select * from finish();
rollback;
