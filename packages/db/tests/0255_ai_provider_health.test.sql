begin;
create extension if not exists pgtap;
select plan(19);

-- ============================================================
-- The platform's AI account (0255). A run of firm A refused for the platform's account marks its provider down, a
-- run of firm B refused the same way counts beside it, a run refused for its request marks nothing, and the first run
-- of the provider that succeeds marks it up. Anybody of either firm reads only that the platform's AI is down and
-- since when; the table, the backend's functions and the operator's are nobody else's. The operator is owed one word
-- when it goes down and one when it comes back, and the backend's check of the account brings it back too.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2550000-0000-4000-8000-000000000001', 'ana@souza-ia.invalid', 'Ana Souza'),
  ('a2550000-0000-4000-8000-000000000002', 'caio@rocha-ia.invalid', 'Caio Rocha'),
  ('a2550000-0000-4000-8000-000000000009', 'operador@one-ia.invalid', 'Olga Operadora')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2550000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-ia', 'a2550000-0000-4000-8000-000000000001'),
  ('b2550000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-ia', 'a2550000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2550000-0000-4000-8000-00000000000a', 'a2550000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2550000-0000-4000-8000-00000000000b', 'a2550000-0000-4000-8000-000000000002', 'owner', 'socio');
update public.profiles set is_superadmin = true where id = 'a2550000-0000-4000-8000-000000000009';

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

/** A run of a firm, started and then finished as said: the trigger reads the finish, as `finish_ai_run` writes it. */
create function pg_temp.run(firm uuid, prov text, finished text, code text) returns void language plpgsql as $$
declare
  made uuid;
begin
  insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status)
  values (firm, 'plataforma.verificacao',
          (select v.id from public.prompt_versions v where v.task = 'plataforma.verificacao' and v.is_active),
          prov, prov || '-modelo', repeat('b', 64), 'running')
  returning ai_runs.id into made;
  update public.ai_runs set status = finished, error_code = code, finished_at = now() where ai_runs.id = made;
end;
$$;

-- ---------- Down, counted, and nothing else ----------

select pg_temp.run('b2550000-0000-4000-8000-00000000000a', 'anthropic', 'failed', 'provider_account');
select is(
  (select jsonb_array_length(public.ai_providers_down())), 1, 'a run of firm A refused for the account marks its provider down'
);
select is(
  (select public.ai_providers_down() -> 0 ->> 'model'), 'anthropic-modelo', 'with the model to ask again'
);
select ok(
  (select public.ai_providers_down() -> 0 -> 'tasks') ? 'caso.documento.conferencia',
  'and the tasks whose instructions in force name it, whose work waits'
);
select pg_temp.run('b2550000-0000-4000-8000-00000000000b', 'anthropic', 'failed', 'provider_account');
select is(
  (select failures from public.ai_provider_health where provider = 'anthropic'), 2,
  'a run of firm B refused the same way counts beside it'
);
select pg_temp.run('b2550000-0000-4000-8000-00000000000b', 'gemini', 'failed', 'provider_rejected');
select pg_temp.run('b2550000-0000-4000-8000-00000000000a', 'openai', 'succeeded', null);
select is(
  (select count(*)::int from public.ai_provider_health), 1,
  'a run refused for its request marks nothing, and a provider never down is not written when a run succeeds'
);

-- ---------- What a person of a firm reads ----------

select pg_temp.sign_in('a2550000-0000-4000-8000-000000000001');
set local role authenticated;
select is((public.platform_ai_status() ->> 'down')::boolean, true, 'a person of firm A reads that the platform''s AI is down');
select ok(public.platform_ai_status() ->> 'since' is not null, 'and since when');
select ok(not (public.platform_ai_status() ? 'provider'), 'never the provider');
select throws_ok($$select * from public.ai_provider_health$$, '42501', null, 'the table is nobody''s to read');
select throws_ok($$select public.ai_providers_down()$$, '42501', null, 'nor the backend''s list');
select throws_ok($$select public.claim_ai_health_alerts()$$, '42501', null, 'nor the alerts');
select throws_ok($$select public.record_ai_provider_check('anthropic', true)$$, '42501', null, 'nor the check of the account');
select throws_ok($$select public.admin_ai_health()$$, '42501', 'not_authorized', 'nor the operator''s view');
reset role;
select pg_temp.sign_in('a2550000-0000-4000-8000-000000000002');
set local role authenticated;
select is((public.platform_ai_status() ->> 'down')::boolean, true, 'and a person of firm B the same: the account is the platform''s');
reset role;

-- ---------- The operator ----------

select pg_temp.sign_in('a2550000-0000-4000-8000-000000000009');
set local role authenticated;
select is(
  (select public.admin_ai_health() -> 0 ->> 'failures')::int, 2, 'the operator reads how each provider stands'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select array_agg(a ->> 'kind') from jsonb_array_elements(public.claim_ai_health_alerts()) a),
  array['down'],
  'the operator is owed one word when it goes down'
);
select is(jsonb_array_length(public.claim_ai_health_alerts()), 0, 'once');
select is(
  public.record_ai_provider_check('anthropic', false) ->> 'code', 'still_down',
  'a check of the account that is refused again keeps it down'
);
reset role;

-- ---------- Up again ----------

select pg_temp.run('b2550000-0000-4000-8000-00000000000a', 'anthropic', 'succeeded', null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select jsonb_build_array(jsonb_array_length(public.ai_providers_down()),
     (select array_agg(a ->> 'kind') from jsonb_array_elements(public.claim_ai_health_alerts()) a))),
  jsonb_build_array(0, array['up']),
  'the first run that succeeds marks it up, and the operator is owed one word of its return'
);
reset role;

select * from finish();
rollback;
