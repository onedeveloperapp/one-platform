begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- ONE reads the fee terms from the firm's contract (0160). Ana, a partner of
-- Lima, may have ONE read the firm's contract; Duda, of the controladoria,
-- may not (the terms are confirmed by who decides for the firm). The day's
-- readings run out at the setting's ceiling. Edu, of Rocha, never asks about
-- Lima. The task's instructions are in force with their schema.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1580000-0000-4000-8000-000000000001', 'ana@lima-leitura.invalid', 'Ana Lima'),
  ('a1580000-0000-4000-8000-000000000004', 'duda@lima-leitura.invalid', 'Duda Lima'),
  ('a1580000-0000-4000-8000-000000000009', 'edu@rocha-leitura.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1580000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-leitura', 'a1580000-0000-4000-8000-000000000001'),
  ('b1580000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-leitura', 'a1580000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1580000-0000-4000-8000-00000000000a', 'a1580000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1580000-0000-4000-8000-00000000000a', 'a1580000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1580000-0000-4000-8000-00000000000b', 'a1580000-0000-4000-8000-000000000009', 'owner', 'socio');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

select ok(
  exists (select 1 from public.ai_tasks t where t.slug = 'financeiro.honorarios.leitura' and not t.shadow)
    and exists (select 1 from public.prompt_versions v
                where v.task = 'financeiro.honorarios.leitura' and v.is_active
                  and v.output_schema -> 'required' ? 'exito_trecho'),
  'the reading of the contract is a task with its instructions in force, each value asked with its words'
);

select pg_temp.as_person('a1580000-0000-4000-8000-000000000001', 'ana',
  $$public.fee_terms_reading_allowed('b1580000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1580000-0000-4000-8000-000000000004', 'duda',
  $$public.fee_terms_reading_allowed('b1580000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('ana', '{ok}') = 'true' and pg_temp.got('duda', '{code}') = 'not_allowed',
  'who decides for the firm has ONE read its contract; the controladoria does not'
);

update public.platform_settings set value = value || '{"terms_reads": 1}'::jsonb where key = 'finance';
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, started_at)
select 'b1580000-0000-4000-8000-00000000000a', 'financeiro.honorarios.leitura', v.id, 'anthropic', 'claude-sonnet-5-5',
  repeat('c', 64), 'running', now()
from public.prompt_versions v where v.task = 'financeiro.honorarios.leitura' and v.version = 1;
select pg_temp.as_person('a1580000-0000-4000-8000-000000000001', 'ana-full',
  $$public.fee_terms_reading_allowed('b1580000-0000-4000-8000-00000000000a')$$);
select is(pg_temp.got('ana-full', '{code}'), 'reading_limit', 'the day''s readings end at the setting''s ceiling');

select pg_temp.as_person('a1580000-0000-4000-8000-000000000009', 'edu',
  $$public.fee_terms_reading_allowed('b1580000-0000-4000-8000-00000000000b')$$);
select is(pg_temp.got('edu', '{ok}'), 'true', 'another firm''s readings are its own');

select pg_temp.sign_in('a1580000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$select public.fee_terms_reading_allowed('b1580000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized', 'nobody asks about a firm they are not of'
);
reset role;

select * from finish();
rollback;
