begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ============================================================
-- A ticket that prints the day without its year (0293). The reading's instructions in force are the first's, word for
-- word, with the day and the month of each leg's departure and the year never supposed; the passenger module's latest
-- published version pins them, keeping every other task as it was; the panel (no case) and a case of each firm opened
-- now read them; nobody of a firm calls the rule of the version.
--
-- Every firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2930000-0000-4000-8000-000000000001', 'eva@lobo-bilhete.invalid', 'Eva Lobo'),
  ('a2930000-0000-4000-8000-000000000002', 'ivo@sena-bilhete.invalid', 'Ivo Sena')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2930000-0000-4000-8000-00000000000a', 'Lobo Advogados', 'lobo-bilhete', 'a2930000-0000-4000-8000-000000000001'),
  ('b2930000-0000-4000-8000-00000000000b', 'Sena Advocacia', 'sena-bilhete', 'a2930000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2930000-0000-4000-8000-00000000000a', 'a2930000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2930000-0000-4000-8000-00000000000b', 'a2930000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident) values
  ('c2930000-0000-4000-8000-00000000000a', 'b2930000-0000-4000-8000-00000000000a', 1, 'delay'),
  ('c2930000-0000-4000-8000-00000000000b', 'b2930000-0000-4000-8000-00000000000b', 1, 'cancellation');

-- ---------- The instructions in force ----------

select ok(
  (select count(*) = 1 from public.prompt_versions where task = 'caso.documento.leitura' and is_active)
  and (select (v.output_schema #> '{properties,trechos,items,required}') ? 'dia_mes_saida'
              and strpos(v.system_prompt, 'nunca suponha o ano') > 0
       from public.prompt_versions v where v.task = 'caso.documento.leitura' and v.is_active),
  'one version of the reading is in force, with the day and the month of each departure and the year never supposed');
select ok(
  (select strpos(n.system_prompt, o.system_prompt) = 1 and n.model = o.model and n.effort = o.effort
          and n.max_tokens = o.max_tokens and n.version = o.version + 1 and not o.is_active
          and n.output_schema #- '{properties,trechos,items,properties,dia_mes_saida}' #- '{properties,trechos,items,required}'
              = o.output_schema #- '{properties,trechos,items,required}'
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'caso.documento.leitura' and n.is_active),
  'its words, model and schema are the previous version''s, which leaves');

-- ---------- The module's version ----------

select is(
  (select (v.manifest #>> '{prompts,caso.documento.leitura}')::integer from public.module_versions v
   where v.module = 'direito-do-passageiro' and v.status = 'published' order by v.version desc limit 1),
  (select version from public.prompt_versions where task = 'caso.documento.leitura' and is_active),
  'the passenger module''s latest published version pins it');
select is(
  (select (n.manifest -> 'prompts') - 'caso.documento.leitura' from public.module_versions n
   where n.module = 'direito-do-passageiro' and n.status = 'published' order by n.version desc limit 1),
  (select (o.manifest -> 'prompts') - 'caso.documento.leitura' from public.module_versions o
   where o.module = 'direito-do-passageiro' and o.status = 'published' order by o.version desc offset 1 limit 1),
  'and keeps every other task as the version before it');

select is(public.module_prompt_version('caso.documento.leitura', null, null),
  (select version from public.prompt_versions where task = 'caso.documento.leitura' and is_active),
  'the panel, with no case yet, reads it');
select ok(
  public.module_prompt_version('caso.documento.leitura', 'case', 'c2930000-0000-4000-8000-00000000000a')
    = (select version from public.prompt_versions where task = 'caso.documento.leitura' and is_active)
  and public.module_prompt_version('caso.documento.leitura', 'case', 'c2930000-0000-4000-8000-00000000000b')
    = (select version from public.prompt_versions where task = 'caso.documento.leitura' and is_active),
  'a case of each firm opened now reads it');

-- ---------- The backend's alone ----------

select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a2930000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select throws_ok($$select public.module_prompt_version('caso.documento.leitura', 'case', 'c2930000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'nobody of a firm calls the rule of the version');
reset role;

select * from finish();
rollback;
