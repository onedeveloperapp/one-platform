begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ============================================================
-- The path of a filing, the PJe as the lawyer walked it, and the place inside the comarca (0309). The instructions in
-- force that read a court's screen are the fifth: the fourth's schema, model, effort and tokens, and words for the path
-- of the filing (`percurso`: a filing ONE started is its own), the tabs, a field's section, a radio's question, a cell
-- made pressable, the PJe's parties and costs, and the place inside the comarca by `processo.foro`. The backend starts a
-- reading of a screen for each of two firms with the fifth, each firm's run its own. The places of a court inside a
-- comarca are the platform's: any member of either firm reads them, nobody writes them.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3090000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@prado-foro.invalid', '', now(), '{}', '{"display_name":"Lia Prado"}', now(), now()),
  ('a3090000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'teo@reis-foro.invalid', '', now(), '{}', '{"display_name":"Teo Reis"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b3090000-0000-4000-8000-00000000000a', 'Prado Advogados', 'prado-foro', 'a3090000-0000-4000-8000-000000000001'),
  ('b3090000-0000-4000-8000-00000000000b', 'Reis Advocacia', 'reis-foro', 'a3090000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3090000-0000-4000-8000-00000000000a', 'a3090000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3090000-0000-4000-8000-00000000000b', 'a3090000-0000-4000-8000-000000000002', 'owner', 'advogado');

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
  and (select v.version >= 5 from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
  and exists (
    select 1 from public.prompt_versions v
    where v.task = 'protocolo.tela' and v.version = 5 and position('percurso' in v.system_prompt) > 0
  ),
  'one version of the reading of a screen is in force, the fifth or one after it');
select ok(
  (select n.output_schema = o.output_schema and n.model = o.model and n.provider = o.provider and n.effort = o.effort
          and n.max_tokens = o.max_tokens and n.version = o.version + 1 and not o.is_active
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'protocolo.tela' and n.is_active),
  'its schema, model, effort and tokens are the version''s before it, which leaves');
select ok(
  (select position('percurso' in v.system_prompt) > 0
          and position('nunca um rascunho antigo' in v.system_prompt) > 0
          and position('"Aba Partes"' in v.system_prompt) > 0
          and position('"section"' in v.system_prompt) > 0
          and position('Justiça Gratuita? · Sim' in v.system_prompt) > 0
          and position('"Polo Passivo"' in v.system_prompt) > 0
          and position('processo.foro' in v.system_prompt) > 0
          and position('processo.justica_gratuita' in v.system_prompt) > 0
          and position('copiado exatamente como veio na tela' in v.system_prompt) > 0
   from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active),
  'its words read the path, the tabs, the sections, the questions and the place, and keep what the fourth said');

-- ---------- 2. A reading of a screen, for each firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('a', public.start_ai_run(
  'b3090000-0000-4000-8000-00000000000a', 'protocolo.tela', repeat('a', 64),
  null, 'filing_submission', 'c3090000-0000-4000-8000-0000000000a1'
));
insert into res values ('b', public.start_ai_run(
  'b3090000-0000-4000-8000-00000000000b', 'protocolo.tela', repeat('b', 64),
  null, 'filing_submission', 'c3090000-0000-4000-8000-0000000000b1'
));
reset role;

select ok(
  (select bool_and(payload ->> 'code' = 'started'
                   and (payload -> 'prompt' ->> 'version')::int
                       = (select v.version from public.prompt_versions v where v.task = 'protocolo.tela' and v.is_active)
                   and position('percurso' in payload -> 'prompt' ->> 'system_prompt') > 0)
   from res where name in ('a', 'b')),
  'the backend reads a screen for either firm with the version in force');

select pg_temp.sign_in('a3090000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::int from public.ai_runs where org_id = 'b3090000-0000-4000-8000-00000000000a'),
  0,
  'firm B reads nothing of firm A''s reading of a screen');
reset role;

-- ---------- 3. The places of a court inside a comarca ----------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.court_forum_areas'::regclass),
  'the places inside a comarca are under row-level security');

select pg_temp.sign_in('a3090000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ insert into public.court_forum_areas (court, comarca, kind, district, forum, source_url, read_on)
     values ('TJRJ', 'Rio de Janeiro', 'juizado', 'Bairro Inventado', 'Lagoa', 'https://example.invalid/ato', current_date) $$,
  '42501',
  null,
  'a member of a firm writes no place of a court');
reset role;

select ok(
  (select count(*) = 189 and count(distinct forum) = 14 from public.court_forum_areas
   where court = 'TJRJ' and comarca = 'Rio de Janeiro' and kind = 'juizado')
  and not exists (select 1 from public.court_forum_areas where kind = 'comum'),
  'the Capital''s small-claims courts take their 189 neighbourhoods in 14 places, and the civil courts none');
select ok(
  (select forum = 'Lagoa' from public.court_forum_areas where court = 'TJRJ' and district = 'Jardim Botânico')
  and (select forum = 'Lagoa' from public.court_forum_areas where court = 'TJRJ' and district = 'Humaitá')
  and (select forum = 'Regional da Barra da Tijuca' from public.court_forum_areas where court = 'TJRJ' and district = 'Rocinha')
  and (select forum = 'Regional do Méier' from public.court_forum_areas where court = 'TJRJ' and district = 'Quintino Bocaiúva'),
  'the Jardim Botânico and the Humaitá go to Lagoa, the Rocinha to Barra, the Quintino to Méier');
select ok(
  (select bool_and(forum = 'Central' and source_url like '%dtPub=25/06/2026%') from public.court_forum_areas
   where court = 'TJRJ' and district in ('Copacabana', 'Leme')),
  'Copacabana and Leme go to the Comarca da Capital, by the act of 2026-06-24');
select ok(
  not exists (
    select 1 from public.court_forum_areas a
    join public.court_forum_areas b on b.court = a.court and b.comarca = a.comarca and b.kind = a.kind
      and public.slugify(b.district) = public.slugify(a.district) and b.forum <> a.forum
  ),
  'no neighbourhood is in two places');

select * from finish();
rollback;
