begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- A cost of a case starts from its receipt (0162). The reading is a task the
-- firm reads, with its instructions in force; it counts within the firm's
-- readings of a day for its forms, Lima's and nobody else's; and the cost
-- keeps the receipt it was read from.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1610000-0000-4000-8000-000000000001', 'ana@lima-custo.invalid', 'Ana Lima'),
  ('a1610000-0000-4000-8000-000000000009', 'edu@rocha-custo.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1610000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-custo', 'a1610000-0000-4000-8000-000000000001'),
  ('b1610000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-custo', 'a1610000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1610000-0000-4000-8000-00000000000a', 'a1610000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1610000-0000-4000-8000-00000000000b', 'a1610000-0000-4000-8000-000000000009', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1610000-0000-4000-8000-000000000001', 'b1610000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('f1610000-0000-4000-8000-000000000001', 'b1610000-0000-4000-8000-00000000000a', 'upload',
   'org/b1610000-0000-4000-8000-00000000000a/upload/f1610000-0000-4000-8000-000000000001', 'guia.pdf', 'application/pdf', 2048,
   'stored', repeat('d', 64), 2048, 'application/pdf', now() + interval '1 hour', now());

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
  exists (select 1 from public.ai_tasks t where t.slug = 'caso.custo.leitura' and not t.shadow)
    and exists (select 1 from public.prompt_versions v
                where v.task = 'caso.custo.leitura' and v.is_active and v.output_schema -> 'required' ? 'valor_centavos'),
  'the reading of a cost''s receipt is a task the firm reads, with its instructions in force'
);

update public.platform_settings set value = value || '{"per_day": 1}'::jsonb where key = 'document_prefill';
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, started_at)
select 'b1610000-0000-4000-8000-00000000000a', 'caso.custo.leitura', v.id, 'anthropic', 'claude-sonnet-5-5',
  repeat('e', 64), 'running', now()
from public.prompt_versions v where v.task = 'caso.custo.leitura' and v.version = 1;
select pg_temp.as_person('a1610000-0000-4000-8000-000000000001', 'lima',
  $$public.prefill_reading_allowed('b1610000-0000-4000-8000-00000000000a')$$);
select is(pg_temp.got('lima', '{code}'), 'prefill_limit', 'a cost read counts within the firm''s readings of the day');

select pg_temp.as_person('a1610000-0000-4000-8000-000000000009', 'rocha',
  $$public.prefill_reading_allowed('b1610000-0000-4000-8000-00000000000b')$$);
select is(pg_temp.got('rocha', '{ok}'), 'true', 'another firm''s readings are its own');

select pg_temp.as_person('a1610000-0000-4000-8000-000000000001', 'cost',
  format($$public.save_case_cost('c1610000-0000-4000-8000-000000000001', %L::jsonb)$$,
    jsonb_build_object('description', 'Custas iniciais', 'cents', '18734', 'spent_on', current_date - 7, 'paid_by', 'firm',
      'owed_by', 'client', 'file_id', 'f1610000-0000-4000-8000-000000000001')));
select ok(
  pg_temp.got('cost', '{ok}') = 'true'
    and (select file_id = 'f1610000-0000-4000-8000-000000000001' from public.case_costs
         where case_id = 'c1610000-0000-4000-8000-000000000001'),
  'the cost keeps the receipt it was read from'
);

select * from finish();
rollback;
