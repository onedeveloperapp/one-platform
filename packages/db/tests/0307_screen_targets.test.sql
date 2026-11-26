begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ============================================================
-- The AI copies the target of each field of a court's screen (0307). The instructions in force that read a court's
-- screen are the third: the second's schema, model, effort and tokens, and words that hand each field with its
-- "alvo" and ask it copied as it came, never a bare selector. The backend starts a reading of a screen for each of two
-- firms with the third, and each firm's run is its own: firm B reads nothing of firm A's.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3070000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@prado-alvo.invalid', '', now(), '{}', '{"display_name":"Lia Prado"}', now(), now()),
  ('a3070000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teo@reis-alvo.invalid', '', now(), '{}', '{"display_name":"Teo Reis"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b3070000-0000-4000-8000-00000000000a', 'Prado Advogados', 'prado-alvo', 'a3070000-0000-4000-8000-000000000001'),
  ('b3070000-0000-4000-8000-00000000000b', 'Reis Advocacia', 'reis-alvo', 'a3070000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3070000-0000-4000-8000-00000000000a', 'a3070000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3070000-0000-4000-8000-00000000000b', 'a3070000-0000-4000-8000-000000000002', 'owner', 'advogado');

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
  and (select v.version = 3 from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'one version of the reading of a screen is in force, the third');
select ok(
  (select n.output_schema = o.output_schema and n.model = o.model and n.provider = o.provider and n.effort = o.effort
          and n.max_tokens = o.max_tokens and n.version = o.version + 1 and not o.is_active
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'protocolo.tela' and n.is_active),
  'its schema, model, effort and tokens are the second version''s, which leaves');
select ok(
  (select position('copiado exatamente como veio na tela' in v.system_prompt) > 0
          and position('"0|#campo|0"' in v.system_prompt) > 0
          and position('seletor' in v.system_prompt) = 0
          and position('"chosen"' in v.system_prompt) > 0 and position('"lines"' in v.system_prompt) > 0
          and position('uma lista por vez' in v.system_prompt) > 0
   from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'its words hand each field with its target to copy as it came, and keep what the second said of the screen');

-- ---------- 2. A reading of a screen, for each firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('a', public.start_ai_run(
  'b3070000-0000-4000-8000-00000000000a', 'protocolo.tela', repeat('a', 64),
  null, 'filing_submission', 'c3070000-0000-4000-8000-0000000000a1'
));
insert into res values ('b', public.start_ai_run(
  'b3070000-0000-4000-8000-00000000000b', 'protocolo.tela', repeat('b', 64),
  null, 'filing_submission', 'c3070000-0000-4000-8000-0000000000b1'
));
reset role;

select ok(
  (select bool_and(payload ->> 'code' = 'started'
                   and (payload -> 'prompt' ->> 'version')::int
                       = (select v.version from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
                   and position('copiado exatamente como veio na tela' in payload -> 'prompt' ->> 'system_prompt') > 0)
   from res where name in ('a', 'b')),
  'the backend reads a screen for either firm with the third version');
select ok(
  (select count(*) = 2 from public.ai_runs r
   join res on (res.payload ->> 'run_id')::uuid = r.id
   where r.task = 'protocolo.tela'
     and r.org_id = case res.name when 'a' then 'b3070000-0000-4000-8000-00000000000a'::uuid
                                  else 'b3070000-0000-4000-8000-00000000000b'::uuid end),
  'each run is kept under its own firm');

select pg_temp.sign_in('a3070000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.ai_runs where org_id = 'b3070000-0000-4000-8000-00000000000a'),
  0,
  'firm B reads nothing of firm A''s reading of a screen');
reset role;

select * from finish();
rollback;
