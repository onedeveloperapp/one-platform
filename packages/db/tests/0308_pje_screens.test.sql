begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- What the PJe of TJRJ asks, read from its manuals (0308). The instructions in force that read a court's screen are
-- the fourth: the third's schema, model, effort and tokens, and words for a line's action that is only an icon, the
-- search of a subject by its words, the PJe's tabs, the characteristics and the costs by the case's facts, and the
-- button that signs pressed once. The backend starts a reading of a screen for each of two firms with the fourth, and
-- each firm's run is its own: firm B reads nothing of firm A's. The PJe of the TJRJ's small-claims courts takes files of
-- 1,5 MB at most, and no other court's row changes.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3080000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@prado-pje.invalid', '', now(), '{}', '{"display_name":"Lia Prado"}', now(), now()),
  ('a3080000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teo@reis-pje.invalid', '', now(), '{}', '{"display_name":"Teo Reis"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b3080000-0000-4000-8000-00000000000a', 'Prado Advogados', 'prado-pje', 'a3080000-0000-4000-8000-000000000001'),
  ('b3080000-0000-4000-8000-00000000000b', 'Reis Advocacia', 'reis-pje', 'a3080000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3080000-0000-4000-8000-00000000000a', 'a3080000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3080000-0000-4000-8000-00000000000b', 'a3080000-0000-4000-8000-000000000002', 'owner', 'advogado');

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
  and (select v.version = 4 from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'one version of the reading of a screen is in force, the fourth');
select ok(
  (select n.output_schema = o.output_schema and n.model = o.model and n.provider = o.provider and n.effort = o.effort
          and n.max_tokens = o.max_tokens and n.version = o.version + 1 and not o.is_active
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'protocolo.tela' and n.is_active),
  'its schema, model, effort and tokens are the third version''s, which leaves');
select ok(
  (select position('processo.justica_gratuita' in v.system_prompt) > 0
          and position('processo.custas' in v.system_prompt) > 0
          and position('processo.prioridade' in v.system_prompt) > 0
          and position('ícone: seta para a esquerda' in v.system_prompt) > 0
          and position('busque pelo nome' in v.system_prompt) > 0
          and position('Assinar documento(s)' in v.system_prompt) > 0
          and position('copiado exatamente como veio na tela' in v.system_prompt) > 0
          and position('uma lista por vez' in v.system_prompt) > 0
   from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'its words read the PJe''s icons, tabs, characteristics, costs and signature, and keep what the third said');

-- ---------- 2. A reading of a screen, for each firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('a', public.start_ai_run(
  'b3080000-0000-4000-8000-00000000000a', 'protocolo.tela', repeat('a', 64),
  null, 'filing_submission', 'c3080000-0000-4000-8000-0000000000a1'
));
insert into res values ('b', public.start_ai_run(
  'b3080000-0000-4000-8000-00000000000b', 'protocolo.tela', repeat('b', 64),
  null, 'filing_submission', 'c3080000-0000-4000-8000-0000000000b1'
));
reset role;

select ok(
  (select bool_and(payload ->> 'code' = 'started'
                   and (payload -> 'prompt' ->> 'version')::int
                       = (select v.version from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
                   and position('processo.justica_gratuita' in payload -> 'prompt' ->> 'system_prompt') > 0)
   from res where name in ('a', 'b')),
  'the backend reads a screen for either firm with the fourth version');
select ok(
  (select count(*) = 2 from public.ai_runs r
   join res on (res.payload ->> 'run_id')::uuid = r.id
   where r.task = 'protocolo.tela'
     and r.org_id = case res.name when 'a' then 'b3080000-0000-4000-8000-00000000000a'::uuid
                                  else 'b3080000-0000-4000-8000-00000000000b'::uuid end),
  'each run is kept under its own firm');

select pg_temp.sign_in('a3080000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.ai_runs where org_id = 'b3080000-0000-4000-8000-00000000000a'),
  0,
  'firm B reads nothing of firm A''s reading of a screen');
reset role;

-- ---------- 3. The PJe of the TJRJ's small-claims courts takes files of 1,5 MB at most ----------

select ok(
  (select s.max_file_bytes = 1500000 and s.max_petition_bytes = 1500000
   from public.court_systems s
   where s.court = 'TJRJ' and s.proceeding_kind = 'juizado' and s.system = 'pje'),
  'the PJe of the TJRJ''s small-claims courts takes a file of 1,5 MB at most');
select ok(
  not exists (
    select 1 from public.court_systems s
    where s.max_file_bytes = 1500000 and s.max_petition_bytes = 1500000
      and not (s.court = 'TJRJ' and s.proceeding_kind = 'juizado')
      and not (s.court = 'TJCE' and s.system = 'pje')
  ),
  'no other court''s row took that limit');

select * from finish();
rollback;
