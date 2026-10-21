begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ============================================================
-- Checkout machinery (0004).
--
-- A one-time ACCESS purchase (the `kit` rung of the inherited ladder) writes
-- no subscription, and the right is granted by the webhook on the PAID
-- invoice, idempotently. A refund revokes it, and a late replay of the
-- payment event never revives it. Recurring checkouts freeze the price the
-- firm was sold; an installment plan is one payment that does not renew; a
-- cancellation keeps its reason.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a4000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'buyer@teste.invalid', '', '{}', '{"display_name":"Buyer"}', now(), now()),
  ('a4000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@teste.invalid', '', '{}', '{"display_name":"Operator"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a4000000-0000-4000-8000-000000000002';

insert into public.organizations (id, name, slug, created_by)
values ('b4000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'a4000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role, firm_function)
values ('b4000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-000000000001', 'owner', 'socio');

-- The baseline seeds no priced plan (0015): the test brings the ladder it
-- walks, in the shape 0004 inherits.
insert into public.plans (slug, name, kind, family, tier, period, price_cents, currency, is_public, sort, limits, access_months) values
  ('kit', 'Acesso de teste', 'access', 'kit', 'kit', null, 9700, 'BRL', true, 10, '{"assentos_max": 2}', 12),
  ('kit-usd', 'Acesso de teste', 'access', 'kit', 'kit', null, 2900, 'USD', true, 10, '{"assentos_max": 2}', 12),
  ('club-mensal', 'Assinatura de teste', 'recurring', 'club', 'club', 'monthly', 6700, 'BRL', true, 20, '{"assentos_max": 5}', null),
  ('club-anual', 'Assinatura de teste', 'recurring', 'club', 'club', 'yearly', 59700, 'BRL', true, 21, '{"assentos_max": 5}', null);

create temporary table ctx as
select
  (select org_id from public.memberships where user_id = 'a4000000-0000-4000-8000-000000000001') as org,
  (select id from public.plans where slug = 'kit') as kit,
  (select id from public.plans where slug = 'club-mensal') as club,
  (select id from public.plans where slug = 'club-anual') as club_year;
grant select on ctx to authenticated, service_role;

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ---------- The kit checkout ----------

insert into res values ('claim_kit', public.claim_billing_operation(
  (select org from ctx), 'a4000000-0000-4000-8000-000000000001', 'access_checkout',
  'c4000000-0000-4000-8000-000000000001', 'asaas', (select kit from ctx), null));
select is((select payload ->> 'code' from res where name = 'claim_kit'), 'claimed', 'an access checkout is claimed like any other');

insert into res values ('wrong_kind', public.complete_checkout_billing_operation(
  ((select payload from res where name = 'claim_kit') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_kit') ->> 'claimToken')::uuid,
  (select kit from ctx), 'monthly', 'cus_1', null, 'https://pay.invalid/1'));
select is(
  (select payload ->> 'code' from res where name = 'wrong_kind'),
  'idempotency_conflict',
  'an access operation cannot be finished as a subscription checkout'
);

insert into res values ('complete_kit', public.complete_access_checkout_billing_operation(
  ((select payload from res where name = 'claim_kit') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_kit') ->> 'claimToken')::uuid,
  (select kit from ctx), 'https://pay.invalid/kit'));
select is((select payload ->> 'code' from res where name = 'complete_kit'), 'completed', 'the access checkout completes with its payment link');

reset role;
select is(
  (select count(*)::int from public.subscriptions where org_id = (select org from ctx)),
  1,
  'and writes no subscription: the firm keeps only its floor one'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into res values ('claim_club_as_access', public.claim_billing_operation(
  (select org from ctx), 'a4000000-0000-4000-8000-000000000001', 'access_checkout',
  'c4000000-0000-4000-8000-000000000002', 'asaas', (select club from ctx), null));
insert into res values ('club_as_access', public.complete_access_checkout_billing_operation(
  ((select payload from res where name = 'claim_club_as_access') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_club_as_access') ->> 'claimToken')::uuid,
  (select club from ctx), 'https://pay.invalid/2'));
select is(
  (select payload ->> 'code' from res where name = 'club_as_access'),
  'invalid_result',
  'a recurring plan cannot be sold through the one-time access path'
);

-- ---------- Granting on the paid invoice ----------

insert into res values ('grant_1', public.grant_entitlement_on_invoice((select org from ctx), (select kit from ctx), 'asaas', 'pay_100', 9700, 'BRL'));
insert into res values ('grant_2', public.grant_entitlement_on_invoice((select org from ctx), (select kit from ctx), 'asaas', 'pay_100', 9700, 'BRL'));
insert into res values ('grant_club', public.grant_entitlement_on_invoice((select org from ctx), (select club from ctx), 'asaas', 'pay_101'));
reset role;

select is((select payload ->> 'code' from res where name = 'grant_1'), 'granted', 'the paid invoice grants the kit');
select is((select payload ->> 'code' from res where name = 'grant_2'), 'already_granted', 'a resent event grants nothing more');
select is(
  (select count(*)::int from public.entitlement_grants where org_id = (select org from ctx)),
  1,
  'one invoice, one grant'
);
select is(
  (select payload ->> 'code' from res where name = 'grant_club'),
  'not_an_access_plan',
  'a subscription plan is never granted as if it were the kit'
);
select ok(
  (select limits = (select limits from public.plans where slug = 'kit') and price_cents = 9700 and currency = 'BRL'
   from public.entitlement_grants where invoice_key = 'asaas:pay_100'),
  'the grant keeps a snapshot of what was sold'
);

select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.grant_entitlement_on_invoice((select org from ctx), (select kit from ctx), 'asaas', 'pay_999')$$,
  '42501', null,
  'a person cannot even call the function that grants an access'
);
reset role;

-- ---------- A refund ----------

insert into public.invoices (org_id, plan_id, provider, provider_invoice_id, amount_cents, currency, status, paid_at)
values ((select org from ctx), (select kit from ctx), 'asaas', 'pay_100', 9700, 'BRL', 'paid', now());

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('revert', public.revert_paid_invoice('asaas', 'pay_100', 'refund'));
insert into res values ('replay', public.grant_entitlement_on_invoice((select org from ctx), (select kit from ctx), 'asaas', 'pay_100'));
reset role;

select ok(
  (select payload ->> 'code' = 'reverted' and (payload ->> 'grantsRevoked')::int = 1 from res where name = 'revert'),
  'a refund flips the invoice and revokes what it granted'
);
select is(
  (select status::text from public.invoices where provider_invoice_id = 'pay_100'),
  'refunded',
  'the invoice is marked refunded, never deleted'
);
select ok(
  (select payload ->> 'code' = 'revoked' from res where name = 'replay')
  and (select revoked_at is not null from public.entitlement_grants where invoice_key = 'asaas:pay_100'),
  'a late replay of the payment event does not revive a refunded kit'
);

-- ---------- Recurring checkouts ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('claim_club', public.claim_billing_operation(
  (select org from ctx), 'a4000000-0000-4000-8000-000000000001', 'checkout',
  'c4000000-0000-4000-8000-000000000003', 'asaas', (select club from ctx), null));
insert into res values ('club', public.complete_checkout_billing_operation(
  ((select payload from res where name = 'claim_club') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_club') ->> 'claimToken')::uuid,
  (select club from ctx), 'monthly', 'cus_1', 'sub_club_1', 'https://pay.invalid/club',
  5000, 'BRL', 'LANCAMENTO', null, true));
insert into res values ('claim_year', public.claim_billing_operation(
  (select org from ctx), 'a4000000-0000-4000-8000-000000000001', 'checkout',
  'c4000000-0000-4000-8000-000000000004', 'asaas', (select club_year from ctx), null));
insert into res values ('year', public.complete_checkout_billing_operation(
  ((select payload from res where name = 'claim_year') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_year') ->> 'claimToken')::uuid,
  (select club_year from ctx), 'yearly', 'cus_1', null, 'https://pay.invalid/year',
  null, null, null, 'pay_inst_1', true));
reset role;

select ok(
  (select price_cents = 5000 and currency = 'BRL' and coupon_code_snapshot = 'LANCAMENTO' and status = 'incomplete'
   from public.subscriptions where provider_subscription_id = 'sub_club_1'),
  'a recurring checkout freezes the price, currency and coupon the firm was sold'
);
select ok(
  (select not renews and provider_subscription_id is null and price_cents = 59700
   from public.subscriptions where provider_payment_id = 'pay_inst_1'),
  'a yearly plan paid in installments is one payment that does not renew, at the plan price'
);

update public.plans set price_cents = 9900 where slug = 'club-mensal';
select is(
  (select price_cents from public.subscriptions where provider_subscription_id = 'sub_club_1'),
  5000,
  'changing the catalog price never touches a subscription already sold'
);

-- ---------- Cancellation keeps its reason ----------

update public.subscriptions set status = 'canceled' where org_id = (select org from ctx) and status = 'active';
update public.subscriptions set status = 'active', current_period_end = now() + interval '20 days'
where provider_subscription_id = 'sub_club_1';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('claim_cancel', public.claim_billing_operation(
  (select org from ctx), 'a4000000-0000-4000-8000-000000000001', 'cancel',
  'c4000000-0000-4000-8000-000000000005', 'asaas', null,
  (select id from public.subscriptions where provider_subscription_id = 'sub_club_1')));
insert into res values ('cancel', public.commit_billing_subscription_change(
  ((select payload from res where name = 'claim_cancel') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_cancel') ->> 'claimToken')::uuid,
  (select id from public.subscriptions where provider_subscription_id = 'sub_club_1'),
  'cancel', now() + interval '20 days', 'too_expensive', 'Vou voltar depois'));
reset role;

select ok(
  (select cancel_at_period_end and cancel_reason = 'too_expensive' and cancel_note = 'Vou voltar depois'
   from public.subscriptions where provider_subscription_id = 'sub_club_1'),
  'a cancellation records its reason, and takes effect at the end of the paid period'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('claim_resume', public.claim_billing_operation(
  (select org from ctx), 'a4000000-0000-4000-8000-000000000001', 'resume',
  'c4000000-0000-4000-8000-000000000006', 'asaas', null,
  (select id from public.subscriptions where provider_subscription_id = 'sub_club_1')));
insert into res values ('resume', public.commit_billing_subscription_change(
  ((select payload from res where name = 'claim_resume') ->> 'operationId')::uuid,
  ((select payload from res where name = 'claim_resume') ->> 'claimToken')::uuid,
  (select id from public.subscriptions where provider_subscription_id = 'sub_club_1'),
  'resume', null, null, null));
reset role;

select ok(
  (select not cancel_at_period_end and cancel_reason is null and cancel_note is null
   from public.subscriptions where provider_subscription_id = 'sub_club_1'),
  'undoing the cancellation clears the reason: a firm that stays gave no reason to leave'
);

select * from finish();
rollback;
