begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ============================================================
-- ONE reads what a court's screen holds now, and what it did there (0306). The instructions in force that read a
-- court's screen are the second: the first's schema and model, room for 4096 tokens, and words that say the code
-- chosen, the box ticked and the field filled, the lines of a table of the system's codes and what ONE did on the
-- screen. The backend starts a reading of a screen for each of two firms with the second, and each firm's run is its
-- own: firm B reads nothing of firm A's.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3060000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@prado-tela.invalid', '', now(), '{}', '{"display_name":"Lia Prado"}', now(), now()),
  ('a3060000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teo@reis-tela.invalid', '', now(), '{}', '{"display_name":"Teo Reis"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b3060000-0000-4000-8000-00000000000a', 'Prado Advogados', 'prado-tela', 'a3060000-0000-4000-8000-000000000001'),
  ('b3060000-0000-4000-8000-00000000000b', 'Reis Advocacia', 'reis-tela', 'a3060000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3060000-0000-4000-8000-00000000000a', 'a3060000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3060000-0000-4000-8000-00000000000b', 'a3060000-0000-4000-8000-000000000002', 'owner', 'advogado');

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
  and (select v.max_tokens = 4096 from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'one version of the reading of a screen is in force, with 4096 tokens');
select ok(
  (select n.output_schema = o.output_schema and n.model = o.model and n.provider = o.provider and n.effort = o.effort
          and n.version = o.version + 1 and not o.is_active
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'protocolo.tela' and n.is_active),
  'its schema, model and effort are the first version''s, which leaves');
select ok(
  (select position('"chosen"' in v.system_prompt) > 0 and position('"checked"' in v.system_prompt) > 0
          and position('"filled"' in v.system_prompt) > 0 and position('"lines"' in v.system_prompt) > 0
          and position('feito' in v.system_prompt) > 0
          and position('processo.assunto_principal_codigo' in v.system_prompt) > 0
          and position('uma lista por vez' in v.system_prompt) > 0
   from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'its words say what the screen holds now, the lines of a table of codes, what ONE did, and the subject by its code');

-- ---------- 2. A reading of a screen, for each firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('a', public.start_ai_run(
  'b3060000-0000-4000-8000-00000000000a', 'protocolo.tela', repeat('a', 64),
  null, 'filing_submission', 'c3060000-0000-4000-8000-0000000000a1'
));
insert into res values ('b', public.start_ai_run(
  'b3060000-0000-4000-8000-00000000000b', 'protocolo.tela', repeat('b', 64),
  null, 'filing_submission', 'c3060000-0000-4000-8000-0000000000b1'
));
reset role;

select ok(
  (select bool_and(payload ->> 'code' = 'started'
                   and (payload -> 'prompt' ->> 'version')::int
                       = (select v.version from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
                   and position('"chosen"' in payload -> 'prompt' ->> 'system_prompt') > 0)
   from res where name in ('a', 'b')),
  'the backend reads a screen for either firm with the second version');
select ok(
  (select count(*) = 2 from public.ai_runs r
   join res on (res.payload ->> 'run_id')::uuid = r.id
   where r.task = 'protocolo.tela'
     and r.org_id = case res.name when 'a' then 'b3060000-0000-4000-8000-00000000000a'::uuid
                                  else 'b3060000-0000-4000-8000-00000000000b'::uuid end),
  'each run is kept under its own firm');

select pg_temp.sign_in('a3060000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.ai_runs where org_id = 'b3060000-0000-4000-8000-00000000000a'),
  0,
  'firm B reads nothing of firm A''s reading of a screen');
reset role;

select * from finish();
rollback;
