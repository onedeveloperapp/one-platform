begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ============================================================
-- What the operator consoles read (0012).
--
-- Platform totals, one row per firm with the tiles counted over the same
-- rows, the account of one firm, and the accounts that belong to none. All of
-- it is for the platform operator only, and none of it carries a token, a
-- hash or what a firm keeps in the product.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), now(), '{}', '{"display_name":"Operador"}', now(), now()),
  ('ae000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), now(), '{"provider":"email"}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), now() - interval '2 days', '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('ae000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), now() - interval '40 days', '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ae000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eva@souza.invalid', '', now(), null, '{}', '{"display_name":"Eva Dias"}', now(), now());

update public.profiles set is_superadmin = true where id = 'ae000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by, billing_cpf_cnpj) values
  ('be000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ae000000-0000-4000-8000-000000000002', '11222333000181'),
  ('be000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ae000000-0000-4000-8000-000000000004', null);
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-000000000002', 'owner', 'socio'),
  ('be000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('be000000-0000-4000-8000-00000000000b', 'ae000000-0000-4000-8000-000000000004', 'owner', 'socio');

-- Firm A: its owner has the second factor, a lawyer declared a registration,
-- one invitation is open (to Eva, who has an account and no firm), and the
-- owner signed in this week.
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values ('fe000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'totp', 'verified', now(), now());
insert into public.oab_registrations (user_id, uf, number) values ('ae000000-0000-4000-8000-000000000003', 'GO', '5001');
insert into public.firm_invitations (org_id, email, firm_function, token_hash, invited_by, expires_at)
values ('be000000-0000-4000-8000-00000000000a', 'eva@souza.invalid', 'atendimento', repeat('e', 64),
        'ae000000-0000-4000-8000-000000000002', now() + interval '7 days');
insert into public.access_events (user_id) values ('ae000000-0000-4000-8000-000000000002');
insert into public.consent_acceptances (term_id, org_id, user_id)
select t.id, 'be000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-000000000002'
from public.consent_terms t where t.slug = 'newsletter';
insert into public.signup_attribution (org_id, origem, utm_campaign)
values ('be000000-0000-4000-8000-00000000000a', 'parceiro', 'lancamento');

-- Firm B: a paid plan whose charge failed two days ago, one invoice paid
-- before that, an owner with no second factor who has not signed in for 40 days.
insert into public.plans (slug, name, kind, family, tier, period, price_cents, currency, is_public, sort, limits)
values ('teste-mensal', 'Plano de teste', 'recurring', 'teste-plano', 'club', 'monthly', 6700, 'BRL', false, 20, '{"assentos_max": 5}');
update public.subscriptions
set plan_id = (select id from public.plans where slug = 'teste-mensal'), status = 'past_due', past_due_since = now() - interval '2 days',
    provider = 'asaas', provider_subscription_id = 'sub_b_1', price_cents = 6700, currency = 'BRL', period = 'monthly'
where org_id = 'be000000-0000-4000-8000-00000000000b';
insert into public.invoices (org_id, provider, provider_invoice_id, amount_cents, currency, status, paid_at)
values ('be000000-0000-4000-8000-00000000000b', 'asaas', 'pay_b_1', 6700, 'BRL', 'paid', now() - interval '5 days');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated;

-- ---------- Only the operator ----------

select set_config('request.jwt.claims', '{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.admin_metrics()$$, '42501', 'not_authorized', 'the owner of a firm cannot read the platform totals');
select throws_ok($$select public.admin_people_without_firm()$$, '42501', 'not_authorized', 'nor the accounts without a firm');
select throws_ok(
  $$select public.admin_firm_dossier('be000000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'nor the operator''s view of their own firm'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into res values
  ('metrics', public.admin_metrics()),
  ('overview', public.admin_firms_overview()),
  ('dossier', public.admin_firm_dossier('be000000-0000-4000-8000-00000000000a')),
  ('missing', public.admin_firm_dossier('be000000-0000-4000-8000-0000000000ff')),
  ('people', public.admin_people_without_firm());
reset role;

-- ---------- Platform totals ----------

select ok(
  (select (payload ->> 'firms')::int = 2 and (payload ->> 'people')::int = 5
          and (payload ->> 'people_without_firm')::int = 2 and (payload ->> 'open_invitations')::int = 1
   from res where name = 'metrics'),
  'the totals count firms, people, people without a firm and open invitations'
);
select is(
  (select payload -> 'subscriptions' from res where name = 'metrics'),
  '{"active": 1, "past_due": 1}'::jsonb,
  'subscriptions are counted by status'
);
select ok(
  (select payload -> 'mrr' = '[{"currency": "BRL", "amount_cents": 6700}]'::jsonb
          and payload -> 'revenue_30d' = '[{"currency": "BRL", "amount_cents": 6700}]'::jsonb
   from res where name = 'metrics'),
  'money is kept per currency: the recurring revenue at the price sold, and what was paid in 30 days'
);
select is(
  (select (payload ->> 'firms_signed_in_7d')::int from res where name = 'metrics'),
  1,
  'a firm counts as active when somebody of its team signed in, in their own name'
);

-- ---------- One row per firm ----------

select is(
  (select payload -> 'totals' from res where name = 'overview'),
  '{"firms": 2, "withPlan": 1, "noPlan": 1, "pastDue": 1, "suspended": 0, "cancelScheduled": 0, "idle": 1, "noSecondFactor": 1, "noOwner": 0}'::jsonb,
  'the tiles are counted over the rows of the list'
);
select ok(
  (select f ->> 'name' = 'Souza Advogados'
          and f -> 'owner' ->> 'email' = 'ana@souza.invalid'
          and (f ->> 'people')::int = 2 and (f ->> 'lawyers')::int = 1 and (f ->> 'openInvitations')::int = 1
          and f ->> 'tier' is null
          and f -> 'flags' = '{"hasPlan": false, "pastDue": false, "suspended": false, "cancelScheduled": false, "idle": false, "noSecondFactor": false, "noOwner": false, "comped": false}'::jsonb
          and f -> 'attribution' = '{"origem": "parceiro", "utmCampaign": "lancamento"}'::jsonb
   from res, jsonb_array_elements(payload -> 'firms') f
   where name = 'overview' and f ->> 'orgId' = 'be000000-0000-4000-8000-00000000000a'),
  'a firm on the floor: who answers for it, how many people and lawyers, and nothing to act on'
);
select ok(
  (select f ->> 'tier' = 'club'
          and f -> 'plan' ->> 'slug' = 'teste-mensal' and f -> 'plan' ->> 'status' = 'past_due'
          and (f -> 'plan' ->> 'priceCents')::int = 6700 and not (f -> 'plan' ->> 'comped')::boolean
          and (f -> 'revenue' ->> 'BRL')::int = 6700
          and (f -> 'flags' ->> 'pastDue')::boolean and (f -> 'flags' ->> 'idle')::boolean
          and (f -> 'flags' ->> 'noSecondFactor')::boolean and (f -> 'flags' ->> 'hasPlan')::boolean
   from res, jsonb_array_elements(payload -> 'firms') f
   where name = 'overview' and f ->> 'orgId' = 'be000000-0000-4000-8000-00000000000b'),
  'a firm whose charge failed: its plan, what it paid, and the three things to act on'
);

-- ---------- The account of one firm ----------

select ok(
  (select (payload ->> 'ok')::boolean
          and payload -> 'firm' ->> 'name' = 'Souza Advogados'
          and payload -> 'firm' -> 'billingDocument' = '{"kind": "cnpj", "lastDigits": "81"}'::jsonb
   from res where name = 'dossier'),
  'the dossier names the firm and shows its fiscal document only as a kind and two digits'
);
select ok(
  (select jsonb_array_length(payload -> 'team') = 2
          and payload -> 'team' -> 0 ->> 'role' = 'owner'
          and payload -> 'team' -> 0 ->> 'email' = 'ana@souza.invalid'
          and (payload -> 'team' -> 0 ->> 'twoFactor')::boolean
          and payload -> 'team' -> 1 ->> 'firmFunction' = 'advogado'
          and payload -> 'team' -> 1 -> 'oab' = '[{"uf": "GO", "number": "5001", "kind": "principal"}]'::jsonb
          and not (payload -> 'team' -> 1 ->> 'twoFactor')::boolean
   from res where name = 'dossier'),
  'the team, owner first, with the function, the second factor and the registrations of each person'
);
select ok(
  (select jsonb_array_length(payload -> 'invitations') = 1
          and payload -> 'invitations' -> 0 ->> 'email' = 'eva@souza.invalid'
          and payload -> 'invitations' -> 0 ->> 'status' = 'open'
   from res where name = 'dossier'),
  'the invitations, with their state'
);
select ok(
  (select (payload -> 'entitlements' ->> 'active')::boolean
          and jsonb_array_length(payload -> 'money' -> 'subscriptions') = 1
          and payload -> 'money' -> 'paid' = '{}'::jsonb
   from res where name = 'dossier'),
  'what the firm may use, as the gates read it, and its money'
);
select ok(
  (select jsonb_array_length(payload -> 'consent') = 1
          and payload -> 'consent' -> 0 ->> 'slug' = 'newsletter'
          and (payload -> 'access' ->> 'signIns30d')::int = 1
          and payload -> 'attribution' ->> 'origem' = 'parceiro'
   from res where name = 'dossier'),
  'the consents of its people, how often they sign in, and where the firm came from'
);
select ok(
  (select payload::text not like '%token%' and payload::text not like '%' || repeat('e', 64) || '%'
          and payload::text not like '%unsubscribe%' and payload::text not like '%body_md%'
   from res where name = 'dossier'),
  'and no token, hash or consent text'
);
select is(
  (select payload from res where name = 'missing'),
  '{"ok": false, "code": "not_found"}'::jsonb,
  'a firm that does not exist is answered, not raised'
);

-- ---------- Accounts without a firm ----------

select is(
  (select payload -> 'totals' from res where name = 'people'),
  '{"people": 2, "neverSignedIn": 1, "invited": 1}'::jsonb,
  'the accounts that belong to no firm are counted, with who never signed in and who has an invitation waiting'
);
select ok(
  (select p ->> 'email' = 'eva@souza.invalid' and (p ->> 'openInvitations')::int = 1 and p ->> 'lastSignInAt' is null
   from res, jsonb_array_elements(payload -> 'people') p
   where name = 'people' and p ->> 'userId' = 'ae000000-0000-4000-8000-000000000005'),
  'somebody invited who has not joined yet is told apart'
);
select ok(
  (select (p ->> 'isSuperadmin')::boolean
   from res, jsonb_array_elements(payload -> 'people') p
   where name = 'people' and p ->> 'userId' = 'ae000000-0000-4000-8000-000000000001'),
  'and so is the operator, who works in no firm'
);

-- ---------- A comped plan is not revenue ----------

select set_config('request.jwt.claims', '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.set_org_plan('be000000-0000-4000-8000-00000000000a', (select id from public.plans where slug = 'teste-mensal'), 'piloto');
insert into res values ('overview_2', public.admin_firms_overview()), ('metrics_2', public.admin_metrics());
reset role;

select ok(
  (select (f -> 'plan' ->> 'comped')::boolean and (f -> 'plan' ->> 'priceCents')::int = 0 and f ->> 'tier' = 'club'
   from res, jsonb_array_elements(payload -> 'firms') f
   where name = 'overview_2' and f ->> 'orgId' = 'be000000-0000-4000-8000-00000000000a')
  and (select payload -> 'mrr' = '[{"currency": "BRL", "amount_cents": 6700}]'::jsonb from res where name = 'metrics_2'),
  'a plan given by the team shows as a courtesy and adds nothing to the recurring revenue'
);

select * from finish();
rollback;
