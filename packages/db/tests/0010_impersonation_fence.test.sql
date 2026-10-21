begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ============================================================
-- The support-visit fence (0009). Writes go from the browser straight to the
-- API, so the fence lives in the database. It never expires: a fence that
-- lifted when the visit ended would turn a stale support session into a
-- full-privilege session of the person.
--
-- Every person here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ad000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now()),
  ('ad000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'socia@teste.invalid', '', now(), '{}', '{"display_name":"Sócia"}', now(), now()),
  ('ad000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outro-operador@one.invalid', '', now(), '{}', '{"display_name":"Outro operador"}', now(), now()),
  ('ad000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'colega@teste.invalid', '', now(), '{}', '{"display_name":"Colega"}', now(), now());

update public.profiles set is_superadmin = true
where id in ('ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000003');

insert into public.organizations (id, name, slug, created_by)
values ('bd000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'ad000000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bd000000-0000-4000-8000-00000000000a', 'ad000000-0000-4000-8000-000000000002', 'owner', 'socio'),
  ('bd000000-0000-4000-8000-00000000000a', 'ad000000-0000-4000-8000-000000000004', 'member', 'advogado');

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values
  ('ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', 'bd000000-0000-4000-8000-00000000000a',
   'Pessoa relatou um erro na tela da equipe', 'fd000000-0000-4000-8000-000000000001', now() + interval '30 minutes'),
  -- An operator visiting another operator's account.
  ('ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000003', null,
   'Conferindo uma permissão do console', 'fd000000-0000-4000-8000-000000000002', now() + interval '30 minutes');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated;

select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"fd000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select ok(public.is_impersonated() and public.impersonation_active(), 'inside the visit both signals are on');
select is((select count(*)::int from public.memberships), 2, 'the visit reads what the person reads');
select is(
  (select count(*)::int from public.impersonation_sessions),
  1,
  'and the person can see that their account was visited'
);
insert into res values ('profile', public.update_member_profile('Sócia Corrigida', null));
select throws_ok(
  $$select public.leave_firm('bd000000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_allowed_in_support_session',
  'support acts on nobody''s place in a firm'
);
select throws_ok(
  $$select public.accept_terms(array['newsletter'], 'pt-BR')$$,
  '42501', 'support_session_cannot_consent',
  'and consents in nobody''s name'
);
reset role;

select ok(
  exists (select 1 from public.audit_events where action = 'member.profile_updated' and (metadata ->> 'support_session')::boolean),
  'a profile fix made during a visit is audited as made by support'
);

-- The table fence: even a privileged write, when it carries the visit's
-- claims, is refused. Functions written later inherit it.
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"fd000000-0000-4000-8000-000000000001"}', true);
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role, firm_function)
    values ('bd000000-0000-4000-8000-00000000000a', 'ad000000-0000-4000-8000-000000000003', 'admin', 'socio')$$,
  '42501', null,
  'nobody is put in a firm from a support session'
);
select throws_ok(
  $$update public.memberships set role = 'admin' where user_id = 'ad000000-0000-4000-8000-000000000004'$$,
  '42501', null,
  'nor promoted'
);
select throws_ok(
  $$insert into public.firm_invitations (org_id, email, firm_function, token_hash, expires_at)
    values ('bd000000-0000-4000-8000-00000000000a', 'visita@teste.invalid', 'advogado', repeat('a', 64), now() + interval '1 day')$$,
  '42501', null,
  'no invitation is written'
);
select throws_ok(
  $$insert into public.oab_registrations (user_id, uf, number) values ('ad000000-0000-4000-8000-000000000002', 'GO', '321')$$,
  '42501', null,
  'no registration at the bar is declared'
);
select throws_ok(
  $$insert into public.entitlement_grants (org_id, kind, source) values ('bd000000-0000-4000-8000-00000000000a', 'comp', 'admin')$$,
  '42501', null,
  'no courtesy is granted'
);
select throws_ok(
  $$delete from public.consent_acceptances where user_id = 'ad000000-0000-4000-8000-000000000002'$$,
  '42501', null,
  'and the fence is per statement, so a write that touches no row is refused too'
);

update public.impersonation_sessions set ended_at = now(), ended_reason = 'done'
where session_id = 'fd000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"fd000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select ok(
  public.is_impersonated() and not public.impersonation_active(),
  'after the visit ends the session is no longer active'
);
select throws_ok(
  $$select public.remove_firm_member('bd000000-0000-4000-8000-00000000000a', 'ad000000-0000-4000-8000-000000000004')$$,
  '42501', 'not_allowed_in_support_session',
  'and the fence still holds'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"fd000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_user_superadmin('ad000000-0000-4000-8000-000000000002', true, 'de dentro de uma visita')$$,
  'P0001', 'not_authorized',
  'visiting another operator does not borrow their power to grant the platform role'
);
select throws_ok(
  $$delete from public.organizations where id = 'bd000000-0000-4000-8000-00000000000a'$$,
  '42501', null,
  'nor to delete a firm'
);
reset role;

select * from finish();
rollback;
