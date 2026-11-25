begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- The triage of a publication has room for the model's thinking and its answer (0290). The instructions in force are
-- the previous ones, word for word, with 4096 tokens; and a publication whose triage was given up because every
-- answer was cut goes back in front of ONE's triage. Firm A's despacho was cut three times; firm B's own publications
-- are one a person already triaged and one given up for another reason, and neither is touched; firm B reads nothing
-- of firm A's.
--
-- Every firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rui@lima-triagem.invalid', '', now(), '{}', '{"display_name":"Rui Lima"}', now(), now()),
  ('a2900000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ines@braga-triagem.invalid', '', now(), '{}', '{"display_name":"Inês Braga"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2900000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-triagem', 'a2900000-0000-4000-8000-000000000001'),
  ('b2900000-0000-4000-8000-00000000000b', 'Braga Advocacia', 'braga-triagem', 'a2900000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2900000-0000-4000-8000-00000000000a', 'a2900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2900000-0000-4000-8000-00000000000b', 'a2900000-0000-4000-8000-000000000002', 'owner', 'socio');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

-- ---------- 1. The instructions in force ----------

select ok(
  (select count(*) = 1 from public.prompt_versions where task = 'publicacao.triagem' and is_active)
  and (select v.max_tokens = 4096 and v.output_schema -> 'properties' ? 'certeza'
       from public.prompt_versions v where v.task = 'publicacao.triagem' and v.is_active),
  'one version of the triage is in force, with 4096 tokens and the certainty it says');
select ok(
  (select n.system_prompt = o.system_prompt and n.output_schema = o.output_schema and n.model = o.model
          and n.provider = o.provider and n.version = o.version + 1 and not o.is_active and o.max_tokens = 600
   from public.prompt_versions n
   join public.prompt_versions o on o.task = n.task and o.version = n.version - 1
   where n.task = 'publicacao.triagem' and n.is_active),
  'its words, schema and model are the previous version''s, which leaves');

-- ---------- 2. A triage given up for a cut answer, asked again ----------

insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, head, lawyer_ids,
                                 ai_attempts, ai_error, category, triaged_at)
values
  ('b2900000-0000-4000-8000-00000000000a', 'p290cut1abcdefghijklmnopqrstuv', 'TJSP', '10002868420998260100',
   current_date - 1, 'Intimação', 'Vistos. Intime-se a parte autora para se manifestar.', 'Vistos.',
   array['a2900000-0000-4000-8000-000000000001'::uuid], 3, 'output_truncated', null, null),
  ('b2900000-0000-4000-8000-00000000000b', 'p290done1bcdefghijklmnopqrstuv', 'TJSP', '10002868420998260100',
   current_date - 1, 'Intimação', 'Fica a parte autora intimada da sentença.', 'Fica a parte autora intimada.',
   array['a2900000-0000-4000-8000-000000000002'::uuid], 3, 'output_truncated', 'decisao', now()),
  ('b2900000-0000-4000-8000-00000000000b', 'p290gone1bcdefghijklmnopqrstuv', 'TJSP', '10002868420998260100',
   current_date - 1, 'Intimação', 'Manifeste-se a parte autora.', 'Manifeste-se.',
   array['a2900000-0000-4000-8000-000000000002'::uuid], 3, 'abandoned', null, null);

select is(public.reopen_cut_triage(), 1, 'only the publication nobody triaged, whose answer was cut, is reopened');
select is((select ai_attempts::text || ' ' || coalesce(ai_error, 'sem erro') from public.publications
           where hash = 'p290cut1abcdefghijklmnopqrstuv'),
  '0 sem erro', 'it has its tries again');
select is((select string_agg(hash || ' ' || ai_attempts || ' ' || ai_error, ', ' order by hash) from public.publications
           where org_id = 'b2900000-0000-4000-8000-00000000000b'),
  'p290done1bcdefghijklmnopqrstuv 3 output_truncated, p290gone1bcdefghijklmnopqrstuv 3 abandoned',
  'one a person triaged and one given up for another reason are left as they were');

create temporary table claimed (publication_id uuid, claim integer);
grant select, insert on claimed to service_role;
select pg_temp.as_backend();
set local role service_role;
insert into claimed select * from public.claim_publication_triage(50, null);
reset role;
select ok(exists (select 1 from claimed c join public.publications p on p.id = c.publication_id
                  where p.hash = 'p290cut1abcdefghijklmnopqrstuv'),
  'the next sweep of the triage takes it');

-- ---------- Each firm its own, and the backend's alone ----------

select pg_temp.sign_in('a2900000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select string_agg(hash, ', ' order by hash) from public.publications where hash like 'p290%'),
  'p290done1bcdefghijklmnopqrstuv, p290gone1bcdefghijklmnopqrstuv', 'firm B reads its own publications, none of firm A''s');
select throws_ok($$select public.reopen_cut_triage()$$, '42501', null, 'a person cannot reopen the triage');
reset role;

select * from finish();
rollback;
