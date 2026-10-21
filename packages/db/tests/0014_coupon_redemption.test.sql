begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- Coupon redemption (0004).
--
-- One use per purchase, counted in one statement: a subscription claims its
-- use by taking `coupon_id`, so a replay counts nothing; a kit (no
-- subscription row) counts once per call. Only the service role may count.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'coupon-buyer@teste.invalid', '', '{}', '{"display_name":"Coupon Buyer"}', now(), now());

insert into public.organizations (id, name, slug, created_by)
values ('b8000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'a8000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role, firm_function)
values ('b8000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000001', 'owner', 'socio');

-- The baseline seeds no priced plan (0015): the test brings the ladder it
-- walks, in the shape 0004 inherits.
insert into public.plans (slug, name, kind, family, tier, period, price_cents, currency, is_public, sort, limits, access_months) values
  ('kit', 'Acesso de teste', 'access', 'kit', 'kit', null, 9700, 'BRL', true, 10, '{"assentos_max": 2}', 12),
  ('kit-usd', 'Acesso de teste', 'access', 'kit', 'kit', null, 2900, 'USD', true, 10, '{"assentos_max": 2}', 12),
  ('club-mensal', 'Assinatura de teste', 'recurring', 'club', 'club', 'monthly', 6700, 'BRL', true, 20, '{"assentos_max": 5}', null),
  ('club-anual', 'Assinatura de teste', 'recurring', 'club', 'club', 'yearly', 59700, 'BRL', true, 21, '{"assentos_max": 5}', null);

insert into public.coupons (id, code, discount_type, discount_value, duration)
values ('c8000000-0000-4000-8000-000000000001', 'LANCAMENTO', 'percent', 20, 'forever');

-- An unpaid yearly checkout, as complete_checkout_billing_operation leaves it.
insert into public.subscriptions (id, org_id, plan_id, status, period, price_cents, currency, renews)
values (
  'd8000000-0000-4000-8000-000000000001',
  (select org_id from public.memberships where user_id = 'a8000000-0000-4000-8000-000000000001'),
  (select id from public.plans where slug = 'club-anual' and currency = 'BRL'),
  'incomplete', 'yearly', 47760, 'BRL', false
);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into res values ('kit', public.redeem_coupon('c8000000-0000-4000-8000-000000000001'));
select is((select payload ->> 'code' from res where name = 'kit'), 'counted', 'a kit purchase counts one use');

insert into res values ('sub', public.redeem_coupon(
  'c8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001'));
select is((select payload ->> 'code' from res where name = 'sub'), 'counted', 'a subscription claims its use');

insert into res values ('replay', public.redeem_coupon(
  'c8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001'));
select is(
  (select payload ->> 'code' from res where name = 'replay'),
  'already_counted',
  'a replay (or a parallel parcel of the same purchase) counts nothing'
);

insert into res values ('unknown', public.redeem_coupon('c8000000-0000-4000-8000-0000000000ff'));
select is((select payload ->> 'code' from res where name = 'unknown'), 'unknown_coupon', 'an unknown coupon is reported, not raised');

reset role;

select is(
  (select redeemed_count from public.coupons where id = 'c8000000-0000-4000-8000-000000000001'),
  2,
  'two purchases, two uses: the replay did not count'
);
select is(
  (select coupon_id from public.subscriptions where id = 'd8000000-0000-4000-8000-000000000001'),
  'c8000000-0000-4000-8000-000000000001'::uuid,
  'the subscription keeps the coupon it was sold with'
);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a8000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;

select throws_ok(
  $$ select public.redeem_coupon('c8000000-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'a person cannot count a coupon use'
);

reset role;

select is(
  (select redeemed_count from public.coupons where id = 'c8000000-0000-4000-8000-000000000001'),
  2,
  'and the count is unchanged'
);

select * from finish();
rollback;
