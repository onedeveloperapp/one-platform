begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- ============================================================
-- AI runs and the approval queue (0016, 0014, 0001).
--
-- A run is started and finished by the backend only, for one firm: it names
-- the instructions it used, keeps a hash of the input and the answer, and
-- charges its cost to that firm. An answer that needs a person waits in the
-- firm's queue, where somebody in the function the task names decides it,
-- with the second factor. Instructions, once published, never change. Two
-- firms: neither sees a run, an answer or a cost of the other, and the
-- platform operator sees counts and cost, never an answer.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a6000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a6000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a6000000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia) and Bruno (atendimento). Firm B: Davi (owner, advogado).
insert into public.organizations (id, name, slug, created_by) values
  ('b6000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a6000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b6000000-0000-4000-8000-00000000000b', 'a6000000-0000-4000-8000-000000000004', 'owner', 'advogado');

update public.platform_settings
set value = '{"models": {"modelo-de-teste": {"inPerMillion": 3, "outPerMillion": 15}}}'::jsonb
where key = 'ai_prices';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal1', session text default null)
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text,
    true
  );
$$;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

-- ---------- The instructions ----------

select is(
  (select row(version, is_active)::text from public.prompt_versions where task = 'plataforma.verificacao'),
  row(1, true)::text,
  'the first task ships with one version of its instructions, in force'
);

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.prompt_versions), 0, 'a firm does not read the platform''s instructions');
select ok((select count(*)::int from public.ai_tasks where slug = 'plataforma.verificacao') = 1, 'it reads which tasks exist');
select throws_ok(
  $$select public.publish_prompt_version('plataforma.verificacao', 'anthropic', 'modelo-de-teste', 'Instruções escritas por quem não pode.', '{"type":"object"}')$$,
  '42501', 'not_authorized',
  'and cannot publish instructions'
);
select throws_ok(
  $$select public.start_ai_run('b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('a', 64))$$,
  '42501', null,
  'nor start a run: only the backend does'
);
reset role;

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('published', public.publish_prompt_version(
  'plataforma.verificacao', 'anthropic', 'modelo-de-teste',
  'Você é o executor de tarefas do ONE. Responda em uma frase curta confirmando a tarefa pedida.',
  '{"type": "object", "required": ["resposta"], "properties": {"resposta": {"type": "string"}}}',
  'low', 256, 'Modelo de teste para o pgTAP.'
));
reset role;

select is((select (payload ->> 'version')::int from res where name = 'published'), 2, 'the operator publishes the next version');
select is(
  (select array_agg(version order by version) from public.prompt_versions where task = 'plataforma.verificacao' and is_active),
  array[2],
  'and it replaces the one in force'
);
select throws_ok(
  $$update public.prompt_versions set system_prompt = 'Outra coisa, escrita depois de publicada a versão.' where version = 2$$,
  '23514', 'prompt_version_immutable',
  'a published version cannot be edited, not even by the database owner'
);
select ok(
  exists (select 1 from public.audit_events where action = 'ai.prompt.published' and actor_type = 'person'),
  'publishing is audited'
);

-- ---------- A run ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('start', public.start_ai_run(
  'b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('a', 64),
  'a6000000-0000-4000-8000-000000000001', null, null, 'verificacao-0001'
));
insert into res values ('start_again', public.start_ai_run(
  'b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('a', 64),
  'a6000000-0000-4000-8000-000000000001', null, null, 'verificacao-0001'
));
insert into res values ('outsider', public.start_ai_run(
  'b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('a', 64),
  'a6000000-0000-4000-8000-000000000004'
));
insert into res values ('unknown', public.start_ai_run(
  'b6000000-0000-4000-8000-00000000000a', 'tarefa.que.nao.existe', repeat('a', 64)
));
reset role;

select ok(
  (select payload ->> 'code' = 'started'
          and (payload -> 'prompt' ->> 'version')::int = 2
          and payload -> 'prompt' ->> 'model' = 'modelo-de-teste'
          and payload -> 'prompt' ? 'system_prompt' and payload -> 'prompt' ? 'output_schema'
   from res where name = 'start'),
  'the backend starts a run and receives the instructions in force'
);
select ok(
  (select payload ->> 'code' = 'existing'
          and payload ->> 'run_id' = (select payload ->> 'run_id' from res where name = 'start')
   from res where name = 'start_again'),
  'the same request made twice is one run'
);
select is(
  (select payload ->> 'code' from res where name = 'outsider'), 'requester_not_in_firm',
  'a run is asked by a person of that firm, never of another'
);
select is((select payload ->> 'code' from res where name = 'unknown'), 'unknown_task', 'a task that does not exist is refused');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('finish', public.finish_ai_run(
  ((select payload from res where name = 'start') ->> 'run_id')::uuid, 'succeeded',
  '{"resposta": "Recebido: verificação do executor."}', 1000, 500, 'modelo-de-teste'
));
insert into res values ('finish_again', public.finish_ai_run(
  ((select payload from res where name = 'start') ->> 'run_id')::uuid, 'succeeded',
  '{"resposta": "Outra resposta."}', 9, 9, 'modelo-de-teste'
));
reset role;

select ok(
  (select payload ->> 'code' = 'finished' and payload ->> 'approval_id' is not null
          and (payload ->> 'cost_usd_micros')::bigint = 10500 and (payload ->> 'priced')::boolean
   from res where name = 'finish'),
  'finishing prices the run and puts its answer in the queue'
);
select ok(
  (select payload ->> 'code' = 'already_finished' and payload ->> 'status' = 'succeeded'
          and payload ->> 'approval_id' = (select payload ->> 'approval_id' from res where name = 'finish')
          and (payload ->> 'cost_usd_micros')::bigint = 10500 and (payload ->> 'priced')::boolean
   from res where name = 'finish_again'),
  'a run is finished once: a retry changes nothing and is told what the record says'
);
select ok(
  (select status = 'succeeded' and output = '{"resposta": "Recebido: verificação do executor."}'::jsonb
          and input_hash = repeat('a', 64) and tokens_in = 1000 and tokens_out = 500
          and cost_usd_micros = 10500 and priced and finished_at is not null
          and prompt_version_id = (select id from public.prompt_versions where task = 'plataforma.verificacao' and version = 2)
   from public.ai_runs where id = ((select payload from res where name = 'start') ->> 'run_id')::uuid),
  'the run keeps the version it used, the hash of the input, the answer and what it cost'
);
select ok(
  (select org_id = 'b6000000-0000-4000-8000-00000000000a' and feature = 'plataforma.verificacao'
          and cost_usd_micros = 10500
          and ref_id = ((select payload from res where name = 'start') ->> 'run_id')::uuid
   from public.ai_spend),
  'the cost is charged to the firm the run was made for, under the task'
);
select is((select count(*)::int from public.ai_spend), 1, 'once');
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'ai.run.succeeded' and actor_type = 'ai' and org_id = 'b6000000-0000-4000-8000-00000000000a'
      and (metadata ->> 'awaits_approval')::boolean
  ),
  'what the backend did on a model''s answer is audited as done by AI'
);

-- ---------- Who sees it ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (select count(*)::int from public.ai_runs) = 1 and (select count(*)::int from public.approvals) = 1,
  'the people of the firm see the run and that its answer waits'
);
select is(
  public.decide_approval(((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved') ->> 'code',
  'not_an_approver',
  'somebody whose function the task does not name cannot decide'
);
reset role;

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000004', 'aal2');
set local role authenticated;
select ok(
  (select count(*)::int from public.ai_runs) = 0 and (select count(*)::int from public.approvals) = 0
  and (select count(*)::int from public.ai_spend) = 0,
  'another firm sees no run, no answer and no cost of this one'
);
select is(
  public.decide_approval(((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved') ->> 'code',
  'not_found',
  'and an answer of another firm does not exist for it'
);
reset role;

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000009', 'aal2');
set local role authenticated;
select ok(
  (select count(*)::int from public.ai_runs) = 0 and (select count(*)::int from public.approvals) = 0,
  'the platform operator reads no answer of a firm'
);
select is((select count(*)::int from public.ai_spend), 1, 'only what it cost');
reset role;

-- ---------- Deciding ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.decide_approval(((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved')$$,
  '42501', 'second_factor_required',
  'deciding an answer asks for the second factor'
);
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a6000000-0000-4000-8000-000000000009', 'a6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-00000000000a',
        'Conferindo a fila de aprovação', 'f6000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001', 'aal2', 'f6000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.decide_approval(((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved')$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit decides nothing in the firm''s name'
);
reset role;

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001', 'aal2');
set local role authenticated;
select is(
  public.decide_approval(((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'rejected') ->> 'code',
  'note_required',
  'a rejection says why'
);
select is(
  array[
    public.decide_approval(
      ((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved', '{"outra": "sem o campo que a resposta tinha"}'
    ) ->> 'code',
    public.decide_approval(
      ((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved',
      '{"resposta": "Recebido.", "efeito": "um campo que a resposta não tinha"}'
    ) ->> 'code',
    public.decide_approval(
      ((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved', '{"resposta": ["de texto para lista"]}'
    ) ->> 'code'
  ],
  array['invalid_output', 'invalid_output', 'invalid_output'],
  'a correction changes what the answer says, never its shape: no field dropped, added or turned into another kind'
);
insert into res values ('decide', public.decide_approval(
  ((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'approved',
  '{"resposta": "Recebido, com a correção de quem aprovou."}', 'Ajustei a frase.'
));
select is(
  public.decide_approval(((select payload from res where name = 'finish') ->> 'approval_id')::uuid, 'rejected', null, 'Mudei de ideia.') ->> 'code',
  'already_decided',
  'an answer is decided once'
);
select throws_ok(
  $$update public.approvals set status = 'pending' where true$$,
  '42501', null,
  'and never by a direct write'
);
reset role;

select ok(
  (select payload ->> 'code' = 'approved' and (payload ->> 'edited')::boolean from res where name = 'decide'),
  'a lawyer of the firm approves, correcting the answer'
);
select ok(
  (select status = 'approved' and edited and decided_by = 'a6000000-0000-4000-8000-000000000001'
          and final_output = '{"resposta": "Recebido, com a correção de quem aprovou."}'::jsonb
   from public.approvals),
  'what takes effect is the corrected answer, and the run keeps what the model said'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'ai.approval.approved' and actor_type = 'person'
      and actor_id = 'a6000000-0000-4000-8000-000000000001' and (metadata ->> 'edited')::boolean
  ),
  'the decision is audited as made by a person'
);

-- ---------- A run that failed, and one in the other firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('start_failed', public.start_ai_run('b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('b', 64)));
insert into res values ('finish_failed', public.finish_ai_run(
  ((select payload from res where name = 'start_failed') ->> 'run_id')::uuid, 'failed', null, 200, 0, null, 'provider_timeout'
));
insert into res values ('start_b', public.start_ai_run('b6000000-0000-4000-8000-00000000000b', 'plataforma.verificacao', repeat('c', 64)));
insert into res values ('finish_b', public.finish_ai_run(
  ((select payload from res where name = 'start_b') ->> 'run_id')::uuid, 'succeeded', '{"resposta": "Recebido."}', 100, 100, 'modelo-sem-preco'
));
reset role;

select ok(
  (select payload ->> 'approval_id' is null from res where name = 'finish_failed')
  and (select status = 'failed' and error_code = 'provider_timeout' and output is null and cost_usd_micros = 600
       from public.ai_runs where id = ((select payload from res where name = 'start_failed') ->> 'run_id')::uuid),
  'a failed run enters no queue, keeps its error and still costs what it consumed'
);
select ok(
  (select not priced and cost_usd_micros = 0 from public.ai_runs where org_id = 'b6000000-0000-4000-8000-00000000000b'),
  'a model with no price is recorded as unpriced, never as free'
);

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000004', 'aal2');
set local role authenticated;
select is(
  public.decide_approval(((select payload from res where name = 'finish_b') ->> 'approval_id')::uuid, 'rejected', null, 'Resposta fora do pedido.') ->> 'code',
  'rejected',
  'the lawyer of the other firm decides the answer of their own firm'
);
select is((select count(*)::int from public.approvals), 1, 'and sees only that one');
reset role;

-- ---------- What the operator measures, and autonomy ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_ai_task_accuracy(90)$$,
  '42501', 'not_authorized',
  'a firm does not read the platform''s measure'
);
reset role;

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000009', 'aal2');
set local role authenticated;
insert into res values ('accuracy', public.admin_ai_task_accuracy(90));
select throws_ok(
  $$select public.set_ai_task_autonomy('plataforma.verificacao', 'autonomous', null, 'curto')$$,
  '22023', 'reason_required',
  'giving a task autonomy takes a written reason'
);
select public.set_ai_task_autonomy('plataforma.verificacao', 'autonomous', null, 'Somente neste teste: exatidão medida em 100 execuções.');
reset role;

select is(
  (select task - 'name' from res, jsonb_array_elements(payload -> 'tasks') as task
   where name = 'accuracy' and task ->> 'task' = 'plataforma.verificacao'),
  '{"task": "plataforma.verificacao", "autonomy": "approval", "shadow": false, "samplePercent": 100, "approvers": ["socio", "advogado"], "activeVersion": 2, "provider": "anthropic", "model": "modelo-de-teste", "runs": 3, "succeeded": 2, "failed": 1, "pending": 0, "approved": 0, "approvedEdited": 1, "rejected": 1, "returned": 0, "revisable": false}'::jsonb,
  'the measure counts, across firms and without naming any: runs, failures and how the answers fared'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('start_auto', public.start_ai_run('b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('d', 64)));
insert into res values ('finish_auto', public.finish_ai_run(
  ((select payload from res where name = 'start_auto') ->> 'run_id')::uuid, 'succeeded', '{"resposta": "Recebido."}', 10, 10, 'modelo-de-teste'
));
reset role;

select ok(
  (select payload ->> 'approval_id' is null from res where name = 'finish_auto')
  and exists (select 1 from public.audit_events where action = 'ai.task.autonomy_changed' and metadata ->> 'to' = 'autonomous'),
  'an autonomous task puts nothing in the queue, and the change that made it so is audited'
);

-- ---------- A run that never reached the provider, and one nobody finished ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('start_unreached', public.start_ai_run('b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('e', 64)));
insert into res values ('finish_unreached', public.finish_ai_run(
  ((select payload from res where name = 'start_unreached') ->> 'run_id')::uuid, 'failed', null, 0, 0, null, 'provider_not_configured'
));
insert into res values ('start_stale', public.start_ai_run(
  'b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('f', 64), null, null, null, 'verificacao-0002'
));
insert into res values ('start_fresh', public.start_ai_run('b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('f', 64)));
reset role;

select ok(
  (select payload ->> 'code' = 'finished' and (payload ->> 'cost_usd_micros')::bigint = 0 and not (payload ->> 'priced')::boolean
   from res where name = 'finish_unreached')
  and (select status = 'failed' and error_code = 'provider_not_configured' and spend_id is null and tokens_in = 0
       from public.ai_runs where id = ((select payload from res where name = 'start_unreached') ->> 'run_id')::uuid),
  'a run that never reached the provider is recorded as failed and charges nothing'
);

-- The process that asked the model stopped an hour ago.
update public.ai_runs set started_at = now() - interval '1 hour'
where id = ((select payload from res where name = 'start_stale') ->> 'run_id')::uuid;

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001', 'aal2');
set local role authenticated;
select throws_ok(
  $$select public.expire_stale_ai_runs()$$,
  '42501', null,
  'a person does not run the sweep'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('swept', to_jsonb(public.expire_stale_ai_runs()));
insert into res values ('swept_again', to_jsonb(public.expire_stale_ai_runs()));
insert into res values ('retry_stale', public.start_ai_run(
  'b6000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('f', 64), null, null, null, 'verificacao-0002'
));
insert into res values ('late', public.finish_ai_run(
  ((select payload from res where name = 'start_stale') ->> 'run_id')::uuid, 'succeeded', '{"resposta": "Chegou tarde."}', 300, 100, 'modelo-de-teste'
));
reset role;

select is(
  array[(select payload from res where name = 'swept'), (select payload from res where name = 'swept_again')],
  array['1'::jsonb, '0'::jsonb],
  'the sweep gives up the run nobody finished, once, and leaves the one that just started'
);
select ok(
  (select status = 'failed' and error_code = 'abandoned' and finished_at is not null
   from public.ai_runs where id = ((select payload from res where name = 'start_stale') ->> 'run_id')::uuid)
  and (select status = 'running'
       from public.ai_runs where id = ((select payload from res where name = 'start_fresh') ->> 'run_id')::uuid)
  and exists (
    select 1 from public.audit_events
    where action = 'ai.run.failed' and actor_type = 'system' and metadata ->> 'error_code' = 'abandoned'
      and entity_id = (select payload ->> 'run_id' from res where name = 'start_stale')
  ),
  'it is recorded as abandoned, by the system'
);
select ok(
  (select payload ->> 'code' = 'existing' and payload ->> 'status' = 'failed'
          and payload ->> 'run_id' = (select payload ->> 'run_id' from res where name = 'start_stale')
   from res where name = 'retry_stale'),
  'its key still names that run: a new attempt takes a new key'
);
select ok(
  (select payload ->> 'code' = 'already_finished' and payload ->> 'status' = 'failed' and payload ->> 'approval_id' is null
          and (payload ->> 'cost_usd_micros')::bigint = 2400
   from res where name = 'late')
  and (select output is null and status = 'failed' and cost_usd_micros = 2400 and priced and spend_id is not null
       from public.ai_runs where id = ((select payload from res where name = 'start_stale') ->> 'run_id')::uuid)
  and (select count(*)::int = 1 from public.ai_spend
       where ref_id = ((select payload from res where name = 'start_stale') ->> 'run_id')::uuid),
  'an answer that lands after the run was given up is discarded, and what it consumed is still charged'
);

-- ---------- The kind of actor is stamped, never claimed ----------

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.audit_events (org_id, actor_id, actor_type, action)
values ('b6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000001', 'system', 'teste.tipo_de_ator');
reset role;
select is(
  (select actor_type from public.audit_events where action = 'teste.tipo_de_ator'),
  'person',
  'a session cannot sign an audit event as the system'
);

select pg_temp.sign_in('a6000000-0000-4000-8000-000000000001', 'aal1', 'f6000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into public.audit_events (org_id, actor_id, action)
values ('b6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000001', 'teste.visita');
reset role;
select is(
  (select actor_type from public.audit_events where action = 'teste.visita'),
  'support',
  'what is written from a support visit is marked as support'
);

select set_config('request.jwt.claims', '', true);
insert into public.audit_events (org_id, action, actor_type) values (null, 'teste.job', 'person');
select is(
  (select actor_type from public.audit_events where action = 'teste.job'),
  'system',
  'and the backend with no session is the system, whatever it sends'
);

-- ---------- The firm goes, its runs go with it ----------

delete from public.organizations where id = 'b6000000-0000-4000-8000-00000000000b';
select ok(
  not exists (select 1 from public.ai_runs where org_id = 'b6000000-0000-4000-8000-00000000000b')
  and not exists (select 1 from public.approvals where org_id = 'b6000000-0000-4000-8000-00000000000b')
  and exists (select 1 from public.prompt_versions where task = 'plataforma.verificacao' and version = 2),
  'deleting a firm removes its runs and answers, and leaves the platform''s instructions'
);

select * from finish();
rollback;
