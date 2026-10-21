begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ============================================================
-- Messages and scheduled jobs (0010, 0011).
--
-- A message that must go out once is claimed in the statement that marks it
-- as sent, so a job that runs twice finds nothing left. Only the backend may
-- claim; the operator starts a send to the list, the backend delivers it.
--
-- Every person, firm and address here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ab000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'socia@teste.invalid', '', now(), '{}', '{"display_name":"Sócia"}', now(), now()),
  ('ab000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outra@teste.invalid', '', now(), '{}', '{"display_name":"Outra"}', now(), now()),
  ('ab000000-0000-4000-8000-000000000003'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'ab000000-0000-4000-8000-000000000003'::uuid;

insert into public.organizations (id, name, slug, created_by) values
  ('bb000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'ab000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-00000000000b', 'Escritório B', 'escritorio-b', 'ab000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bb000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bb000000-0000-4000-8000-00000000000b', 'ab000000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.plans (slug, name, kind, family, tier, period, price_cents, currency, is_public, sort, limits) values
  ('teste-mensal', 'Plano mensal de teste', 'recurring', 'teste-plano', 'club', 'monthly', 6700, 'BRL', false, 20, '{}'),
  ('teste-anual', 'Plano anual de teste', 'recurring', 'teste-plano', 'club', 'yearly', 59700, 'BRL', false, 21, '{}');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

-- ---------- End of a paid period that does not renew ----------

-- Firm A paid a year in installments (one purchase, no renewal), ending in ten
-- days. Firm B renews by itself on the same day.
update public.subscriptions
set plan_id = (select id from public.plans where slug = 'teste-anual'), status = 'active', renews = false,
    current_period_start = now() - interval '355 days', current_period_end = now() + interval '10 days'
where org_id = 'bb000000-0000-4000-8000-00000000000a';

update public.subscriptions
set plan_id = (select id from public.plans where slug = 'teste-mensal'), status = 'active', renews = true,
    current_period_start = now() - interval '20 days', current_period_end = now() + interval '10 days'
where org_id = 'bb000000-0000-4000-8000-00000000000b';

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.claim_term_end_notices()$$,
  '42501', null,
  'a person cannot claim notices'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'terms', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.claim_term_end_notices() t;
insert into res select 'terms_again', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.claim_term_end_notices() t;
reset role;

select ok(
  (select jsonb_array_length(payload) from res where name = 'terms') = 1
  and (select payload -> 0 ->> 'org_id' from res where name = 'terms') = 'bb000000-0000-4000-8000-00000000000a'
  and (select payload -> 0 ->> 'plan_name' from res where name = 'terms') = 'Plano anual de teste',
  'only the period that does not renew is announced, to its own firm, never a subscription that renews by itself'
);
select is((select jsonb_array_length(payload) from res where name = 'terms_again'), 0, 'the notice goes out once per period');

update public.subscriptions set current_period_end = now() + interval '370 days' where org_id = 'bb000000-0000-4000-8000-00000000000a';
select is(
  (select term_notice_sent_at from public.subscriptions where org_id = 'bb000000-0000-4000-8000-00000000000a'), null,
  'a new period clears the mark, so the next ending is announced too'
);

-- ---------- Messages to the confirmed list ----------

insert into public.leads (email, locale, source, confirmed_at, opted_out_at)
values
  ('leitora@teste.invalid', 'pt-BR', 'waitlist', now(), null),
  ('contato@teste.invalid', 'pt-BR', 'contact', now(), null),
  ('saiu@teste.invalid', 'pt-BR', 'waitlist', now(), now()),
  ('pendente@teste.invalid', 'pt-BR', 'waitlist', null, null);

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_newsletter_send('{"pt-BR": "Abrimos"}', '{"pt-BR": "A plataforma abriu."}')$$,
  '42501', null,
  'a person cannot write to the list'
);
select is((select count(*)::int from public.newsletter_sends), 0, 'nor read what was sent to it');
reset role;

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_newsletter_send('{"pt-BR": "Abrimos"}', '{"pt-BR": "  "}')$$,
  '22023', null,
  'a language with a subject and no text is refused'
);
select throws_ok(
  $$select public.create_newsletter_send('{"en": "We are open"}', '{"en": "The platform is open."}')$$,
  '23514', null,
  'and so is a message in a language the platform is not written in'
);
insert into res
select 'audience', coalesce(jsonb_object_agg(a.locale, a.readers), '{}'::jsonb)
from public.newsletter_audience(array['pt-BR']) a;
insert into res
select 'audience_waitlist', coalesce(jsonb_object_agg(a.locale, a.readers), '{}'::jsonb)
from public.newsletter_audience(array['pt-BR'], 'waitlist') a;
insert into res values ('send', to_jsonb(public.create_newsletter_send('{"pt-BR": "Abrimos"}', '{"pt-BR": "A plataforma abriu."}', 'waitlist')));
insert into res values ('send_failing', to_jsonb(public.create_newsletter_send('{"pt-BR": "Novidade"}', '{"pt-BR": "Uma novidade."}')));
reset role;

select ok(
  (select payload = '{"pt-BR": 2}'::jsonb from res where name = 'audience')
  and (select payload = '{"pt-BR": 1}'::jsonb from res where name = 'audience_waitlist'),
  'the audience counts confirmed readers who have not left, and narrows to one origin of the list'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res
select 'batch', coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
from public.claim_newsletter_batch((select (payload #>> '{}')::uuid from res where name = 'send')) b;
insert into res
select 'batch_again', coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
from public.claim_newsletter_batch((select (payload #>> '{}')::uuid from res where name = 'send')) b;
select public.settle_newsletter_batch(
  (select (payload #>> '{}')::uuid from res where name = 'send'),
  array(select (entry ->> 'lead_id')::uuid from res, jsonb_array_elements(payload) entry where name = 'batch'),
  true
);
select public.finish_newsletter_send((select (payload #>> '{}')::uuid from res where name = 'send'));
reset role;

select ok(
  (select jsonb_array_length(payload) from res where name = 'batch') = 1
  and (select payload -> 0 ->> 'email' from res where name = 'batch') = 'leitora@teste.invalid'
  and (select payload -> 0 ->> 'subject' from res where name = 'batch') = 'Abrimos'
  and (select payload -> 0 ->> 'unsubscribe_token' from res where name = 'batch') is not null,
  'a send reaches only the readers it was written for, confirmed and still on the list, each with a way out'
);
select is((select jsonb_array_length(payload) from res where name = 'batch_again'), 0, 'a reader is claimed once per send');
select ok(
  (select status = 'sent' and delivered = 1 and finished_at is not null
   from public.newsletter_sends where id = (select (payload #>> '{}')::uuid from res where name = 'send')),
  'the send is closed with the number delivered'
);

-- A batch the provider refused gives its readers back.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res
select 'failing_batch', coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
from public.claim_newsletter_batch((select (payload #>> '{}')::uuid from res where name = 'send_failing')) b;
select public.settle_newsletter_batch(
  (select (payload #>> '{}')::uuid from res where name = 'send_failing'),
  array(select (entry ->> 'lead_id')::uuid from res, jsonb_array_elements(payload) entry where name = 'failing_batch'),
  false,
  'provider_down'
);
reset role;

select is((select jsonb_array_length(payload) from res where name = 'failing_batch'), 2, 'a send to the whole list claims both readers');
select ok(
  (select status = 'failed' and delivered = 0 and last_error = 'provider_down'
   from public.newsletter_sends where id = (select (payload #>> '{}')::uuid from res where name = 'send_failing'))
  and not exists (
    select 1 from public.newsletter_deliveries
    where send_id = (select (payload #>> '{}')::uuid from res where name = 'send_failing')
  ),
  'a refused batch marks the send as failed and releases its readers: nobody is counted as written to'
);

-- Erasing a reader takes the delivery with it; the send keeps its count.
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select public.purge_lead((select id from public.leads where email = 'leitora@teste.invalid'), 'Pediu exclusão');
reset role;
select ok(
  not exists (select 1 from public.newsletter_deliveries)
  and (select delivered = 1 from public.newsletter_sends where id = (select (payload #>> '{}')::uuid from res where name = 'send')),
  'erasing a reader removes who received what, and the send keeps a count that names nobody'
);

-- Never from a support visit.
insert into public.impersonation_sessions (actor_id, target_user_id, reason, session_id, expires_at)
values ('ab000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-000000000003',
        'Sessão de teste do console', 'fb000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"fb000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_newsletter_send('{"pt-BR": "De uma visita"}', '{"pt-BR": "Texto."}')$$,
  '42501', 'not_allowed_in_support_session',
  'nothing is written to the list from a support visit'
);
reset role;

-- ---------- Who a message is written to ----------

update auth.users set banned_until = now() + interval '1 day' where id = 'ab000000-0000-4000-8000-000000000002'::uuid;
update public.profiles set marketing_email_opt_out = true where id = 'ab000000-0000-4000-8000-000000000001'::uuid;

select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.member_recipients(array['ab000000-0000-4000-8000-000000000001'::uuid])$$,
  '42501', null,
  'nobody with a session reads the addresses of other people, the operator included'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res
select 'recipients', coalesce(jsonb_agg(to_jsonb(r) order by r.email), '[]'::jsonb)
from public.member_recipients(array[
  'ab000000-0000-4000-8000-000000000001'::uuid,
  'ab000000-0000-4000-8000-000000000002'::uuid,
  'ab000000-0000-4000-8000-0000000000ff'::uuid
]) r;
reset role;

select is(
  (select jsonb_array_length(payload) from res where name = 'recipients'), 1,
  'a banned account and an unknown id are left out'
);
select ok(
  (select payload -> 0 ->> 'email' = 'socia@teste.invalid'
      and payload -> 0 ->> 'locale' = 'pt-BR'
      and payload -> 0 ->> 'timezone' = 'America/Sao_Paulo'
      and (payload -> 0 ->> 'marketing_email_opt_out')::boolean
      and payload -> 0 ->> 'email_unsubscribe_token' is not null
   from res where name = 'recipients'),
  'a recipient carries the address, the language, the timezone, the news preference and the unsubscribe token'
);

-- ---------- The one-click way out of the news ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.unsubscribe_profile((select email_unsubscribe_token from public.profiles where id = 'ab000000-0000-4000-8000-000000000002'));
reset role;
select is(
  (select marketing_email_opt_out from public.profiles where id = 'ab000000-0000-4000-8000-000000000002'),
  true,
  'the link in a news e-mail stops the news for that account'
);
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.unsubscribe_profile(gen_random_uuid())$$,
  '42501', null,
  'and only the backend follows it: the token is the only credential'
);
reset role;

select * from finish();
rollback;
