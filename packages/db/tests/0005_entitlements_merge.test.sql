begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ============================================================
-- org_entitlements: the single answer to "what may this firm use?" (0005).
-- Walks one firm up the ladder and back down: the floor -> a one-time access
-- (a grant) -> a subscription -> a courtesy grant on top, then suspension,
-- the dunning grace window, a refund, and an unconfirmed PIX. More sources
-- never mean fewer rights, and the answer always names its tier and sources.
--
-- The plans are created here: the baseline seeds no priced plan. The limit
-- keys are the test's own, except `assentos_max`, the one the team reads.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'socia@teste.invalid', '', now(), '{}', '{"display_name":"Sócia"}', now(), now()),
  ('a3000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now()),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'estranho@outro.invalid', '', now(), '{}', '{"display_name":"Estranho"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a3000000-0000-4000-8000-000000000002';

insert into public.organizations (id, name, slug, created_by) values
  ('b3000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'a3000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-00000000000b', 'Escritório B', 'escritorio-b', 'a3000000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b3000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-000000000003', 'owner', 'socio');

insert into public.plans (slug, name, kind, family, tier, period, price_cents, currency, is_public, sort, limits, access_months) values
  ('teste-acesso', 'Acesso de teste', 'access', 'teste-acesso', 'kit', null, 9700, 'BRL', false, 10,
   '{"assentos_max": 2, "recurso_a": 1, "recurso_b": 0}', null),
  ('teste-mensal', 'Plano de teste', 'recurring', 'teste-plano', 'club', 'monthly', 6700, 'BRL', false, 20,
   '{"assentos_max": 5, "recurso_a": 1, "recurso_b": 1}', null),
  ('teste-maior', 'Plano maior de teste', 'recurring', 'teste-maior', 'pro', 'yearly', 59700, 'BRL', false, 30,
   '{"assentos_max": 10, "recurso_a": 1, "recurso_b": 1, "recurso_c": 1}', null);
-- The order of the tiers is data (0202): each plan says its rank.
update public.plans set rank = case slug when 'teste-acesso' then 1 when 'teste-mensal' then 2 when 'teste-maior' then 3 end
where slug in ('teste-acesso', 'teste-mensal', 'teste-maior');

create temporary table snap (name text primary key, payload jsonb);
grant select, insert on snap to authenticated, service_role;

-- Reads the answer exactly as the screens do: as a person of the firm.
create function pg_temp.take(label text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  insert into snap values (label, public.org_entitlements('b3000000-0000-4000-8000-00000000000a'));
end;
$$;

-- ---------- The floor ----------

select pg_temp.take('floor');
select ok(
  (select (payload ->> 'active')::boolean and payload ->> 'tier' is null and payload -> 'limits' = '{}'::jsonb
   from snap where name = 'floor'),
  'a new firm is active on the floor, with no tier and no limit of its own'
);
select is(
  (select payload -> 'sources' -> 0 ->> 'type' from snap where name = 'floor'),
  'free',
  'and says the floor is where that comes from'
);

-- ---------- A one-time access: a grant from a paid invoice ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.grant_entitlement_on_invoice('b3000000-0000-4000-8000-00000000000a', (select id from public.plans where slug = 'teste-acesso'), 'asaas', 'pay_acesso_1', 9700, 'BRL');
reset role;

select pg_temp.take('access');
select ok(
  (select payload ->> 'tier' = 'kit'
          and (payload -> 'limits' ->> 'assentos_max')::int = 2
          and (payload -> 'limits' ->> 'recurso_a')::int = 1
          and (payload -> 'limits' ->> 'recurso_b')::int = 0
   from snap where name = 'access'),
  'a paid access grants its limits'
);
select ok(
  (select exists (select 1 from jsonb_array_elements(payload -> 'sources') s where s ->> 'kind' = 'kit')
   from snap where name = 'access'),
  'and the grant is listed as a source'
);

-- ---------- A subscription on top ----------

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.set_org_plan('b3000000-0000-4000-8000-00000000000a', (select id from public.plans where slug = 'teste-mensal'), 'piloto');
reset role;

select pg_temp.take('subscription');
select ok(
  (select payload ->> 'tier' = 'club'
          and (payload -> 'limits' ->> 'assentos_max')::int = 5
          and (payload -> 'limits' ->> 'recurso_b')::int = 1
   from snap where name = 'subscription'),
  'the subscription adds its layer and raises the seat ceiling'
);
select is(
  (select jsonb_array_length(payload -> 'sources') from snap where name = 'subscription'),
  2,
  'the answer lists both the access and the subscription'
);
select is(
  public.entitlement_merge('{"assentos_max": 5, "recurso_b": 1}', '{"assentos_max": 2, "recurso_b": 0, "canal": "estavel"}'),
  '{"assentos_max": 5, "recurso_b": 1, "canal": "estavel"}'::jsonb,
  'merging never lowers a number: whichever source merges last, the greater ceiling wins'
);

-- ---------- A courtesy grant on top ----------

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into snap values ('comp', public.grant_entitlement('b3000000-0000-4000-8000-00000000000a', (select id from public.plans where slug = 'teste-maior'), 'parceria', null));
reset role;

select pg_temp.take('comp_layer');
select ok(
  (select payload ->> 'tier' = 'pro'
          and (payload -> 'limits' ->> 'assentos_max')::int = 10
          and (payload -> 'limits' ->> 'recurso_c')::int = 1
          and exists (select 1 from jsonb_array_elements(payload -> 'sources') s where s ->> 'kind' = 'comp')
   from snap where name = 'comp_layer'),
  'a courtesy grant is listed as a source and carries the limits of its plan'
);
select ok(
  exists (select 1 from public.audit_events where action = 'admin.org.entitlement_granted' and org_id = 'b3000000-0000-4000-8000-00000000000a'),
  'and the courtesy is audited'
);

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.revoke_entitlement_grant(((select payload from snap where name = 'comp') ->> 'grantId')::uuid, 'Parceria encerrada');
reset role;

-- ---------- Suspension and dunning ----------

update public.subscriptions set admin_suspended = true
where org_id = 'b3000000-0000-4000-8000-00000000000a' and status = 'active';
select pg_temp.take('suspended');
select ok(
  (select not (payload ->> 'active')::boolean and (payload ->> 'suspended')::boolean from snap where name = 'suspended'),
  'a suspended firm is not active, whatever it bought'
);

update public.subscriptions set admin_suspended = false, status = 'past_due', past_due_since = now() - interval '2 days'
where org_id = 'b3000000-0000-4000-8000-00000000000a' and status = 'active';
select pg_temp.take('grace');
select ok(
  (select (payload ->> 'active')::boolean and (payload ->> 'past_due_grace')::boolean and payload ->> 'tier' = 'club'
   from snap where name = 'grace'),
  'a failed charge keeps the subscription inside the configured grace window'
);

update public.subscriptions set past_due_since = now() - interval '30 days'
where org_id = 'b3000000-0000-4000-8000-00000000000a' and status = 'past_due';
select pg_temp.take('lapsed');
select ok(
  (select (payload ->> 'active')::boolean and payload ->> 'tier' = 'kit'
          and (payload -> 'limits' ->> 'assentos_max')::int = 2
          and not (payload ->> 'past_due_grace')::boolean
   from snap where name = 'lapsed'),
  'past the window the subscription stops counting, and the access still does'
);

-- ---------- A refund ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.revoke_grant_for_invoice('asaas', 'pay_acesso_1', 'refund');
reset role;
select pg_temp.take('refunded');
select ok(
  (select payload ->> 'tier' is null and not (payload -> 'limits' ? 'assentos_max') from snap where name = 'refunded'),
  'a refunded access stops granting anything'
);

-- ---------- An unconfirmed PIX inside its window ----------

update public.subscriptions set status = 'canceled', canceled_at = now()
where org_id = 'b3000000-0000-4000-8000-00000000000a' and status = 'past_due';
insert into public.subscriptions (org_id, plan_id, status, provider, provider_subscription_id, period, provisional_until)
values ('b3000000-0000-4000-8000-00000000000a', (select id from public.plans where slug = 'teste-mensal'), 'incomplete', 'asaas', 'sub_pix_1', 'monthly',
        now() + interval '6 hours');
select pg_temp.take('provisional');
select ok(
  (select payload ->> 'tier' = 'club'
          and exists (select 1 from jsonb_array_elements(payload -> 'sources') s where s ->> 'type' = 'provisional')
   from snap where name = 'provisional'),
  'a PIX not yet confirmed releases the plan while its provisional window is open'
);

-- ---------- Who may ask ----------

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.org_entitlements('b3000000-0000-4000-8000-00000000000a')$$,
  'P0001', 'not a member of this organization',
  'nobody reads what another firm may use'
);
select is(
  public.org_has_entitlement('b3000000-0000-4000-8000-00000000000a', 'recurso_a'),
  false,
  'and the yes/no form answers false instead of raising, so it is safe inside a policy'
);
select ok(
  (public.org_entitlements('b3000000-0000-4000-8000-00000000000b') ->> 'active')::boolean
  and public.org_entitlements('b3000000-0000-4000-8000-00000000000b') -> 'limits' = '{}'::jsonb,
  'the other firm is still on its own floor: nothing granted to the first reached it'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok(
  (public.org_entitlements('b3000000-0000-4000-8000-00000000000a') ->> 'active')::boolean,
  'the backend, which has no session, asks with the service role'
);
reset role;

select * from finish();
rollback;
