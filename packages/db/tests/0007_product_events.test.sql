begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ============================================================
-- Usage telemetry (0007).
--
-- Events, never content: one vocabulary, one allowlist of property keys AND
-- values, shared by the browser writer and the server writer. An event says
-- that something happened in a firm; it never carries a client's name, a case
-- number or a text somebody typed. A support visit leaves no trace in the
-- person's behaviour, and the browser writer has a ceiling.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'socia@teste.invalid', '', now(), '{}', '{"display_name":"Sócia"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'semfirma@teste.invalid', '', now(), '{}', '{"display_name":"Sem Firma"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a5000000-0000-4000-8000-000000000002';

insert into public.organizations (id, name, slug, created_by)
values ('b5000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'a5000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role, firm_function)
values ('b5000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-000000000001', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

-- ---------- The browser writer ----------

select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.track_product_event(
  'upsell.viewed',
  '{"offer":"club","origin":"home","platform":"server","client_name":"Fulano de Tal","case_number":"0000000-00.2026.8.09.0000","note":"texto livre"}'
);
select public.track_product_event('kit.purchased', '{"offer":"kit"}');
select public.track_product_event('anything.else', '{}');
select is((select count(*)::int from public.product_events), 0, 'a person cannot read the events table');
reset role;

select is(
  (select properties from public.product_events where event_name = 'upsell.viewed'),
  '{"offer": "club", "origin": "home", "platform": "web"}'::jsonb,
  'only allowlisted keys with allowlisted values survive: a name, a case number and free text are dropped, and the browser is always "web"'
);
select ok(
  (select org_id = 'b5000000-0000-4000-8000-00000000000a' and actor_id = 'a5000000-0000-4000-8000-000000000001'
   from public.product_events where event_name = 'upsell.viewed'),
  'the event is stamped with the firm and the person, from the session'
);
select is(
  (select count(*)::int from public.product_events where event_name in ('kit.purchased', 'anything.else')),
  0,
  'the browser may not report a purchase, nor an event outside the vocabulary'
);

select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select public.track_product_event('upsell.clicked', '{"origin":"menu"}');
reset role;
select ok(
  (select org_id is null and actor_id = 'a5000000-0000-4000-8000-000000000003'
   from public.product_events where event_name = 'upsell.clicked'),
  'an account that belongs to no firm leaves an event with no firm'
);

-- ---------- The server writer ----------

select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.track_product_event_server('a5000000-0000-4000-8000-000000000001', null, 'firm.created', '{}', null)$$,
  '42501', null,
  'only the backend may use the server writer'
);
select throws_ok(
  $$select public.rollup_product_events(null)$$,
  '42501', 'not_authorized',
  'and a person cannot run the rollup'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('created', to_jsonb(public.track_product_event_server(
  'a5000000-0000-4000-8000-000000000001', null, 'firm.created',
  '{"firm_function":"socio","role":"owner","platform":"web","firm_name":"Escritório A"}',
  now() + interval '3 days')));
insert into res values ('started', to_jsonb(public.track_product_event_server(
  null, 'b5000000-0000-4000-8000-00000000000a', 'subscription.started',
  '{"tier_to":"club","period":"monthly","tier_from":"inventado"}', null)));
insert into res values ('unknown', to_jsonb(public.track_product_event_server(
  'a5000000-0000-4000-8000-000000000001', null, 'tool.executed', '{}', null)));
reset role;

select is((select payload from res where name = 'created'), 'true'::jsonb, 'the backend records an event');
select is(
  (select properties from public.product_events where event_name = 'firm.created'),
  '{"firm_function": "socio", "role": "owner", "platform": "server"}'::jsonb,
  'through the same allowlist: the firm''s name is dropped and the platform is forced to "server"'
);
select ok(
  (select occurred_at <= now() + interval '1 minute' and org_id = 'b5000000-0000-4000-8000-00000000000a'
   from public.product_events where event_name = 'firm.created'),
  'a timestamp in the future is not believed, and the firm of the person is filled in'
);
select ok(
  (select actor_id is null and org_id = 'b5000000-0000-4000-8000-00000000000a'
          and properties = '{"tier_to": "club", "period": "monthly", "platform": "server"}'::jsonb
   from public.product_events where event_name = 'subscription.started'),
  'an event of the firm with no person behind it (a webhook) is recorded for the firm'
);
select ok(
  (select payload = 'false'::jsonb from res where name = 'unknown')
  and not exists (select 1 from public.product_events where event_name = 'tool.executed'),
  'an event outside the vocabulary is dropped and the caller is told'
);
select throws_ok(
  $$insert into public.product_events (event_name) values ('made.up')$$,
  '23514', null,
  'the table itself refuses a name outside the vocabulary'
);

-- ---------- The ceiling of the browser writer ----------

delete from public.product_events where event_name = 'upsell.clicked';
insert into public.product_events (actor_id, event_name, created_at)
select 'a5000000-0000-4000-8000-000000000001', 'upsell.clicked', now() from generate_series(1, 120);
select set_config('request.jwt.claims', '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.track_product_event('upsell.clicked', '{"offer":"pro"}');
reset role;
select is(
  (select count(*)::int from public.product_events where event_name = 'upsell.clicked'),
  120,
  'a browser over 120 events in the hour is dropped silently'
);

-- ---------- Support visits ----------

delete from public.product_events where event_name = 'upsell.clicked';
insert into public.impersonation_sessions (actor_id, target_user_id, reason, session_id, expires_at)
values ('a5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001',
        'Conferindo um aviso na tela', 'f5000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f5000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select public.track_product_event('upsell.clicked', '{"offer":"pro"}');
reset role;
select is(
  (select count(*)::int from public.product_events where event_name = 'upsell.clicked'),
  0,
  'what an operator does inside a person''s session is not that person''s behaviour'
);

-- ---------- Rollup and retention ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('rollup_1', to_jsonb(public.rollup_product_events((now() at time zone 'America/Sao_Paulo')::date)));
insert into res values ('rollup_2', to_jsonb(public.rollup_product_events((now() at time zone 'America/Sao_Paulo')::date)));
reset role;
select ok(
  (select payload::int > 0 from res where name = 'rollup_1')
  and (select payload from res where name = 'rollup_1') = (select payload from res where name = 'rollup_2'),
  'the daily rollup is idempotent: running it twice writes the same rows'
);
select is(
  (select row(events, actors, firms)::text from public.product_events_daily where event_name = 'firm.created'),
  row(1, 1, 1)::text,
  'and counts events, people and firms per event'
);

insert into public.product_events (actor_id, event_name, occurred_at)
values ('a5000000-0000-4000-8000-000000000001', 'account.created', now() - interval '100 days'),
       ('a5000000-0000-4000-8000-000000000001', 'account.created', now() - interval '30 days');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.purge_product_events(interval '1 day');
reset role;
select is(
  (select count(*)::int from public.product_events where event_name = 'account.created'),
  1,
  'the purge never keeps less than three months, whatever it is asked'
);

-- Deleting the firm detaches its events instead of deleting them.
select set_config('request.jwt.claims', '', true);
delete from public.organizations where id = 'b5000000-0000-4000-8000-00000000000a';
select ok(
  (select org_id is null from public.product_events where event_name = 'firm.created'),
  'an event outlives the firm, detached from it'
);

select * from finish();
rollback;
