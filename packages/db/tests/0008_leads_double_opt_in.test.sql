begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- ============================================================
-- Waitlist and newsletter (0010).
--
-- The address is trusted only after the confirmation link is clicked. A
-- repeated sign-up never rewrites what is stored and answers the same either
-- way. An opt-out is lifted only by confirming again from the inbox. Erasure
-- takes the change history with it.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'member@teste.invalid', '', '{}', '{"display_name":"Member"}', now(), now()),
  ('a9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@teste.invalid', '', '{}', '{"display_name":"Operator"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a9000000-0000-4000-8000-000000000002';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.submit_lead('{"email":"x@teste.invalid","consent":true}', null, repeat('a', 64))$$,
  '42501', null,
  'only the form''s server action can write a lead'
);
select is((select count(*)::int from public.leads), 0, 'and a person cannot read the list');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('no_consent', public.submit_lead('{"email":"ana@teste.invalid"}', null, repeat('a', 64)));
insert into res values ('first', public.submit_lead(
  '{"email":"Ana@Teste.invalid","name":"Ana","locale":"en","segment":"dev","consent":true,"origem":"Parceiro X!","utm_source":"newsletter"}',
  repeat('1', 64), repeat('a', 64)));
insert into res values ('repeat', public.submit_lead(
  '{"email":"ana@teste.invalid","name":"Somebody Else","consent":true}', repeat('1', 64), repeat('b', 64)));
insert into res values ('wrong', public.confirm_lead(repeat('a', 64)));
insert into res values ('confirm', public.confirm_lead(repeat('b', 64)));
insert into res values ('known', public.submit_lead('{"email":"ana@teste.invalid","consent":true}', repeat('1', 64), repeat('c', 64)));
reset role;

select is((select payload ->> 'code' from res where name = 'no_consent'), 'consent_required', 'nothing is stored without the consent box');
select ok(
  (select payload ->> 'code' = 'created' and (payload ->> 'send_confirmation')::boolean from res where name = 'first'),
  'a new address is stored and gets a confirmation link'
);
select ok(
  (select email::text = 'ana@teste.invalid' and name = 'Ana' and locale = 'pt-BR' and origem = 'parceirox'
          and consent_text like '%Quero receber por e-mail os avisos do ONE%' and consent_term_version = 1
   from public.leads),
  'the address is the identity regardless of case, a language the platform is not written in falls back to Portuguese, the entry door is normalized, and the consent text is pinned'
);
select ok(
  (select payload ->> 'code' = 'pending' from res where name = 'repeat')
  and (select name = 'Ana' from public.leads),
  'signing up again issues a new link and never rewrites the stored name'
);
select is((select payload ->> 'code' from res where name = 'wrong'), 'invalid', 'a superseded link no longer confirms');
select ok(
  (select payload ->> 'code' = 'confirmed' from res where name = 'confirm')
  and (select confirmed_at is not null and confirm_token_hash is null from public.leads),
  'the current link confirms, and is spent'
);
select ok(
  (select payload ->> 'code' = 'already_confirmed' and not (payload ->> 'send_confirmation')::boolean from res where name = 'known'),
  'a confirmed subscriber who signs up again is sent nothing'
);
select is(
  (select count(*)::int from public.product_events where event_name = 'waitlist.joined'),
  1,
  'joining the waitlist is recorded once, at confirmation'
);

-- ---------- Opting out and back in ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.unsubscribe_lead((select email_unsubscribe_token from public.leads));
insert into res values ('after_out', public.submit_lead('{"email":"ana@teste.invalid","consent":true}', repeat('1', 64), repeat('d', 64)));
reset role;
select ok(
  (select payload ->> 'code' = 'pending' from res where name = 'after_out')
  and (select opted_out_at is not null from public.leads),
  'after an opt-out, a form post alone does not resubscribe the address'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('back', public.confirm_lead(repeat('d', 64)));
reset role;
select ok(
  (select payload ->> 'code' = 'resubscribed' from res where name = 'back')
  and (select opted_out_at is null from public.leads)
  and (select count(*)::int from public.product_events where event_name = 'waitlist.joined') = 1,
  'confirming from the inbox does, without counting a second join'
);

-- ---------- The per-network window ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res
select 'burst_' || n, public.submit_lead(
  jsonb_build_object('email', 'burst' || n || '@teste.invalid', 'consent', true), repeat('2', 64), md5(n::text) || md5('x' || n))
from generate_series(1, 11) as n;
reset role;
select is((select payload ->> 'code' from res where name = 'burst_11'), 'rate_limited', 'one network cannot sign up more than ten addresses an hour');

-- ---------- Retention and erasure ----------

update public.leads set created_at = now() - interval '8 days', confirm_sent_at = now() - interval '8 days'
where email = 'burst1@teste.invalid';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.purge_expired_leads();
reset role;
select ok(
  not exists (select 1 from public.leads where email = 'burst1@teste.invalid')
  and not exists (
    select 1 from public.record_versions where table_name = 'leads' and data ->> 'email' = 'burst1@teste.invalid'
  ),
  'an address never confirmed is erased after seven days, history included'
);

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.purge_lead((select id from public.leads where email = 'ana@teste.invalid'), 'Pediu exclusão por e-mail');
reset role;
select ok(
  not exists (select 1 from public.leads where email = 'ana@teste.invalid')
  and exists (
    select 1 from public.audit_events
    where action = 'admin.leads.purged' and metadata = '{"reason": "Pediu exclusão por e-mail"}'::jsonb
  ),
  'an erasure on request keeps only the reason in the audit trail, never the address'
);

select * from finish();
rollback;
