begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- ============================================================
-- The term of a one-time access (0004, 0011).
--
-- An access lasts the months its plan says, counted from the paid invoice.
-- Buying it again chains a new term after the current one, so renewing early
-- throws nothing away. The end is announced once, settled once, and a refund
-- of a parcel reaches the grant keyed by its installment. Two firms take part,
-- and what is claimed for one never names the other.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ac000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'buyer@teste.invalid', '', '{}', '{"display_name":"Buyer"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'renewer@teste.invalid', '', '{}', '{"display_name":"Renewer"}', now(), now());

insert into public.organizations (id, name, slug, created_by)
values ('bc000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'ac000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role, firm_function)
values ('bc000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-000000000001', 'owner', 'socio');
insert into public.organizations (id, name, slug, created_by)
values ('bc000000-0000-4000-8000-00000000000b', 'Escritório B', 'escritorio-b', 'ac000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function)
values ('bc000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-000000000002', 'owner', 'socio');

-- The baseline seeds no priced plan (0015): the test brings the ladder it
-- walks, in the shape 0004 inherits.
insert into public.plans (slug, name, kind, family, tier, period, price_cents, currency, is_public, sort, limits, access_months) values
  ('kit', 'Acesso de teste', 'access', 'kit', 'kit', null, 9700, 'BRL', true, 10, '{"assentos_max": 2}', 12),
  ('kit-usd', 'Acesso de teste', 'access', 'kit', 'kit', null, 2900, 'USD', true, 10, '{"assentos_max": 2}', 12),
  ('club-mensal', 'Assinatura de teste', 'recurring', 'club', 'club', 'monthly', 6700, 'BRL', true, 20, '{"assentos_max": 5}', null),
  ('club-anual', 'Assinatura de teste', 'recurring', 'club', 'club', 'yearly', 59700, 'BRL', true, 21, '{"assentos_max": 5}', null);

create temporary table ctx as
select
  (select org_id from public.memberships where user_id = 'ac000000-0000-4000-8000-000000000001'::uuid) as org,
  (select org_id from public.memberships where user_id = 'ac000000-0000-4000-8000-000000000002'::uuid) as org_renew,
  (select id from public.plans where slug = 'kit') as kit;
grant select on ctx to authenticated, service_role;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

-- ---------- The plans ----------

select throws_ok(
  $$update public.plans set access_months = 6 where slug = 'club-mensal'$$,
  '23514', null,
  'a recurring plan has a period, never an access term'
);

-- ---------- A grant with a term, chained on renewal ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('first', public.grant_entitlement_on_invoice((select org from ctx), (select kit from ctx), 'asaas', 'pay_a1', 9700, 'BRL'));
insert into res values ('renewal', public.grant_entitlement_on_invoice((select org from ctx), (select kit from ctx), 'asaas', 'pay_a2', 9700, 'BRL'));
reset role;

select ok(
  (select (payload ->> 'expiresAt')::timestamptz between now() + interval '12 months' - interval '1 minute'
                                                     and now() + interval '12 months' + interval '1 minute'
   from res where name = 'first'),
  'the first purchase ends 12 months from now'
);
select ok(
  (select (payload ->> 'startsAt')::timestamptz = (select (payload ->> 'expiresAt')::timestamptz from res where name = 'first')
   from res where name = 'renewal'),
  'a renewal starts when the current access ends, not when it is paid'
);
select ok(
  (select (payload ->> 'expiresAt')::timestamptz between now() + interval '24 months' - interval '1 minute'
                                                     and now() + interval '24 months' + interval '1 minute'
   from res where name = 'renewal'),
  'and ends 12 months after that'
);

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into res values ('entitlements', public.org_entitlements((select org from ctx)));
reset role;
select is(
  (select count(*)::int from jsonb_array_elements((select payload -> 'sources' from res where name = 'entitlements')) s where s ->> 'type' = 'grant'),
  1,
  'only the running term counts now; the chained one waits its turn'
);
select ok(
  (select (payload -> 'limits' ->> 'assentos_max')::int = 2 from res where name = 'entitlements'),
  'the access grants the limits of its plan'
);

-- ---------- The notice before the end ----------

-- A buyer whose single access ends in 10 days, and the chained buyer above,
-- whose first term also ends soon but is followed by a renewal.
update public.entitlement_grants set expires_at = now() + interval '10 days'
where invoice_key = 'asaas:pay_a1';
update public.entitlement_grants set starts_at = now() + interval '10 days', expires_at = now() + interval '10 days' + interval '12 months'
where invoice_key = 'asaas:pay_a2';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('r_grant', public.grant_entitlement_on_invoice((select org_renew from ctx), (select kit from ctx), 'asaas', 'inst_77', 9700, 'BRL'));
reset role;
update public.entitlement_grants set expires_at = now() + interval '10 days' where invoice_key = 'asaas:inst_77';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'notices', coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.claim_access_end_notices() n;
insert into res select 'notices_again', coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.claim_access_end_notices() n;
reset role;

select is(
  (select jsonb_array_length(payload) from res where name = 'notices'), 1,
  'only an access with nothing chained after it is announced'
);
select is(
  (select payload -> 0 ->> 'org_id' from res where name = 'notices'),
  (select org_renew::text from ctx),
  'and it is the one without a renewal'
);
select is((select payload -> 0 ->> 'plan_name' from res where name = 'notices'), 'Acesso de teste', 'named by the plan');
select is((select jsonb_array_length(payload) from res where name = 'notices_again'), 0, 'a second run finds nothing left');

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.claim_access_end_notices()$$,
  '42501', null,
  'a person cannot claim notices'
);
reset role;

-- ---------- Settling an access that ended ----------

update public.entitlement_grants set starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where invoice_key = 'asaas:inst_77';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'ended', coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.claim_access_endings() e;
insert into res select 'ended_again', coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.claim_access_endings() e;
reset role;

select is((select jsonb_array_length(payload) from res where name = 'ended'), 1, 'an access past its end is settled once');
select is((select payload -> 0 ->> 'org_id' from res where name = 'ended'), (select org_renew::text from ctx), 'the right one');
select is((select jsonb_array_length(payload) from res where name = 'ended_again'), 0, 'and never twice');

-- ---------- A refunded parcel reaches the grant of its installment ----------

insert into public.invoices (org_id, plan_id, provider, provider_invoice_id, amount_cents, currency, status, paid_at)
values ((select org_renew from ctx), (select kit from ctx), 'asaas', 'pay_77_3', 808, 'BRL', 'paid', now());

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('revert', public.revert_paid_invoice('asaas', 'pay_77_3', 'refund', 'inst_77'));
reset role;

select ok(
  (select payload ->> 'code' = 'reverted' and (payload ->> 'grantsRevoked')::int = 1 from res where name = 'revert'),
  'the refund of one parcel revokes the grant keyed by the installment'
);

select * from finish();
rollback;
