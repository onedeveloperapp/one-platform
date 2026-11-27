begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- ============================================================
-- The PJe's documents as the lawyer's test showed them (0311). The instructions in force that read a court's screen are
-- the sixth: the fifth's schema, model, effort and tokens, and words for the program's refusals in `feito`, the
-- petition once in its own field, the attachments in the page's hidden field, and no box of secrecy or of selection
-- ticked. The backend starts a reading of a screen for each of two firms with the sixth, each firm's run its own.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@prado-anexo.invalid', '', now(), '{}', '{"display_name":"Lia Prado"}', now(), now()),
  ('a3110000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teo@reis-anexo.invalid', '', now(), '{}', '{"display_name":"Teo Reis"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b3110000-0000-4000-8000-00000000000a', 'Prado Advogados', 'prado-anexo', 'a3110000-0000-4000-8000-000000000001'),
  ('b3110000-0000-4000-8000-00000000000b', 'Reis Advocacia', 'reis-anexo', 'a3110000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3110000-0000-4000-8000-00000000000a', 'a3110000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3110000-0000-4000-8000-00000000000b', 'a3110000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

-- ---------- 1. The instructions in force ----------

select ok(
  (select count(*) = 1 from public.prompt_versions where task = 'protocolo.tela' and is_active)
  and (select v.version >= 6 from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
  and exists (
    select 1 from public.prompt_versions v
    where v.task = 'protocolo.tela' and v.version = 6 and position('not_the_petition' in v.system_prompt) > 0
  ),
  'one version of the reading of a screen is in force, the sixth or one after it');
select ok(
  (select n.output_schema = o.output_schema and n.model = o.model and n.provider = o.provider and n.effort = o.effort
          and n.max_tokens = o.max_tokens and n.version = o.version + 1 and not o.is_active
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'protocolo.tela' and n.is_active),
  'its schema, model, effort and tokens are the version''s before it, which leaves');
select ok(
  (select position('not_the_petition' in v.system_prompt) > 0
          and position('secrecy_not_asked' in v.system_prompt) > 0
          and position('"Sua petição"' in v.system_prompt) > 0
          and position('Nunca marque "Sigiloso"' in v.system_prompt) > 0
          and position('percurso' in v.system_prompt) > 0
          and position('nunca um rascunho antigo' in v.system_prompt) > 0
          and position('"Aba Partes"' in v.system_prompt) > 0
          and position('"section"' in v.system_prompt) > 0
          and position('Justiça Gratuita? · Sim' in v.system_prompt) > 0
          and position('"Polo Passivo"' in v.system_prompt) > 0
          and position('processo.foro' in v.system_prompt) > 0
          and position('processo.justica_gratuita' in v.system_prompt) > 0
          and position('copiado exatamente como veio na tela' in v.system_prompt) > 0
   from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'its words read the refusals, the petition''s field, the attachments and secrecy, and keep what the fifth said');

-- ---------- 2. A reading of a screen, for each firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('a', public.start_ai_run(
  'b3110000-0000-4000-8000-00000000000a', 'protocolo.tela', repeat('a', 64),
  null, 'filing_submission', 'c3110000-0000-4000-8000-0000000000a1'
));
insert into res values ('b', public.start_ai_run(
  'b3110000-0000-4000-8000-00000000000b', 'protocolo.tela', repeat('b', 64),
  null, 'filing_submission', 'c3110000-0000-4000-8000-0000000000b1'
));
reset role;

select ok(
  (select bool_and(payload ->> 'code' = 'started'
                   and (payload -> 'prompt' ->> 'version')::int
                       = (select v.version from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
                   and position('not_the_petition' in payload -> 'prompt' ->> 'system_prompt') > 0)
   from res where name in ('a', 'b')),
  'the backend reads a screen for either firm with the version in force');

select pg_temp.sign_in('a3110000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.ai_runs where org_id = 'b3110000-0000-4000-8000-00000000000a'),
  0,
  'firm B reads nothing of firm A''s reading of a screen');
reset role;

select * from finish();
rollback;
