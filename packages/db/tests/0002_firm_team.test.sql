begin;
create extension if not exists pgtap with schema extensions;
select plan(96);

-- ============================================================
-- The team of a firm (0003, 0005, 0009).
--
-- Who belongs to a firm, with which role and function, changes only through
-- audited functions that take the firm, check who is asking and, when the
-- change gives or takes access, ask for the second factor. An invitation is
-- bound to the confirmed e-mail of the account that accepts it, expires, is
-- replaced by the next one sent to the same address, and never passes the
-- seat ceiling of the plan. A support visit changes none of it.
--
-- Every person here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@lima.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'carla@lima.invalid', '', now(), '{}', '{"display_name":"Carla Lima"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@outro.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  -- Eva never confirmed her address.
  ('a1000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eva@lima.invalid', '', null, '{}', '{"display_name":"Eva Dias"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabio@lima.invalid', '', now(), '{}', '{"display_name":"Fabio Reis"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gil@lima.invalid', '', now(), '{}', '{"display_name":"Gil Prado"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a1000000-0000-4000-8000-000000000009';

-- Ana already confirmed a second factor; nobody else did.
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'totp', 'verified', now(), now());

create temporary table results (name text primary key, payload jsonb, id uuid);
grant select, insert on results to authenticated, anon;

-- The hash the backend stores for a link token.
create function pg_temp.h(token text) returns text language sql immutable as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex') $$;

-- Sign in as a person, with or without the second factor.
create function pg_temp.sign_in(who uuid, address text, level text default 'aal1', session text default null)
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object(
      'sub', who, 'role', 'authenticated', 'email', address, 'aal', level, 'session_id', session
    ))::text,
    true
  );
$$;

-- ---------- Founding and inviting ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000004', 'davi@outro.invalid');
set local role authenticated;
insert into results (name, id) values ('firm_b', public.create_firm('Rocha Advocacia', 'advogado'));
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid');
set local role authenticated;
insert into results (name, id) values ('firm_a', public.create_firm('Souza Advogados'));

select throws_ok(
  $$select public.invite_to_firm((select id from results where name = 'firm_a'), 'bruno@lima.invalid', 'admin', 'advogado', pg_temp.h('t-bruno'))$$,
  '42501', 'second_factor_required',
  'inviting somebody into the firm asks for the second factor'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;

insert into results (name, payload) values (
  'inv_bruno',
  public.invite_to_firm((select id from results where name = 'firm_a'), ' Bruno@Lima.invalid ', 'admin', 'advogado', pg_temp.h('t-bruno'))
);
select is((select payload ->> 'code' from results where name = 'inv_bruno'), 'invited', 'the owner invites an admin');
select is(
  (select email::text from public.firm_invitations where id = (select (payload ->> 'id')::uuid from results where name = 'inv_bruno')),
  'bruno@lima.invalid',
  'the invited address is stored trimmed and in lower case'
);
select is(
  public.invite_to_firm((select id from results where name = 'firm_a'), 'sem-arroba', 'member', 'advogado', pg_temp.h('t-x')) ->> 'code',
  'invalid_email',
  'an address that is not one is refused'
);
select is(
  public.invite_to_firm((select id from results where name = 'firm_a'), 'x@lima.invalid', 'owner', 'socio', pg_temp.h('t-x')) ->> 'code',
  'invalid_role',
  'nobody is invited as the owner'
);
select is(
  public.invite_to_firm((select id from results where name = 'firm_a'), 'ANA@souza.invalid', 'member', 'advogado', pg_temp.h('t-x')) ->> 'code',
  'already_member',
  'nor is somebody who is already in the firm'
);
select throws_ok(
  $$select token_hash from public.firm_invitations$$,
  '42501', null,
  'no session reads the hash of an invitation link'
);
select throws_ok(
  $$insert into public.firm_invitations (org_id, email, firm_function, token_hash, expires_at)
    values ((select id from results where name = 'firm_a'), 'direto@lima.invalid', 'advogado', pg_temp.h('t-d'), now() + interval '1 day')$$,
  '42501', null,
  'an invitation is not created by a direct write'
);
reset role;

-- ---------- What the link shows ----------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into results (name, payload) values ('preview_anon', public.firm_invitation_preview('t-bruno'));
select ok(
  (select payload ->> 'firm' = 'Souza Advogados'
          and payload ->> 'invited_by' = 'Ana Souza'
          and payload ->> 'status' = 'open'
          and payload ->> 'role' = 'admin'
          and payload ->> 'firm_function' = 'advogado'
   from results where name = 'preview_anon'),
  'whoever opens the link sees the firm, who invited and the role, before signing in'
);
select ok(
  (select payload ->> 'email_hint' = 'b****@lima.invalid' and (payload ->> 'for_this_account')::boolean = false
          and not (payload ? 'email') and not (payload ? 'token_hash')
   from results where name = 'preview_anon'),
  'the invited address comes back masked'
);
select is(public.firm_invitation_preview('token-que-nao-existe') ->> 'found', 'false', 'an unknown token finds nothing');
select throws_ok(
  $$select count(*) from public.firm_invitations$$,
  '42501', null,
  'an anonymous visitor cannot read the invitations table'
);
reset role;

-- ---------- Accepting ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid');
set local role authenticated;
select is((select count(*)::int from public.my_firm_invitations()), 1, 'the invited account is offered its invitation when it signs in');
select is(public.firm_invitation_preview('t-bruno') ->> 'for_this_account', 'true', 'and the link knows it is the invited account');
insert into results (name, payload) values (
  'acc_bruno',
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_bruno'))
);
select is((select payload ->> 'code' from results where name = 'acc_bruno'), 'joined', 'the invited person joins');
select is(
  (select row(role, firm_function)::text from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000002'),
  row('admin', 'advogado')::text,
  'with the role and the function the invitation carried'
);
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_bruno')) ->> 'code',
  'already_accepted',
  'an invitation is accepted once'
);
select is(public.add_oab_registration('go', '12.345') ->> 'code', 'added', 'a lawyer records the registration at the bar');
reset role;

-- Bruno, an admin, invites Carla twice: the second link replaces the first.
select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid', 'aal2');
set local role authenticated;
insert into results (name, payload) values (
  'inv_carla_1',
  public.invite_to_firm((select id from results where name = 'firm_a'), 'carla@lima.invalid', 'member', 'atendimento', pg_temp.h('t-carla-1'))
);
insert into results (name, payload) values (
  'inv_carla_2',
  public.invite_to_firm((select id from results where name = 'firm_a'), 'carla@lima.invalid', 'member', 'atendimento', pg_temp.h('t-carla-2'))
);
select is((select payload ->> 'code' from results where name = 'inv_carla_2'), 'invited', 'an admin invites a plain member');
select is(
  public.invite_to_firm((select id from results where name = 'firm_a'), 'outro@lima.invalid', 'admin', 'advogado', pg_temp.h('t-o')) ->> 'code',
  'only_owner_invites_admin',
  'only the owner hands out the admin role'
);
reset role;

select is(
  (select count(*)::int from public.firm_invitations
   where email = 'carla@lima.invalid' and accepted_at is null and revoked_at is null),
  1,
  'one open invitation per address: inviting again replaces the previous link'
);

-- The invitation of somebody else, an unconfirmed address, an expired link.
select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
insert into results (name, payload) values
  ('inv_eva', public.invite_to_firm((select id from results where name = 'firm_a'), 'eva@lima.invalid', 'member', 'advogado', pg_temp.h('t-eva'))),
  ('inv_fabio', public.invite_to_firm((select id from results where name = 'firm_a'), 'fabio@lima.invalid', 'member', 'advogado', pg_temp.h('t-fabio'))),
  ('inv_gil', public.invite_to_firm((select id from results where name = 'firm_a'), 'gil@lima.invalid', 'member', 'controladoria', pg_temp.h('t-gil')));
reset role;

update public.firm_invitations set expires_at = now() - interval '1 minute'
where id = (select (payload ->> 'id')::uuid from results where name = 'inv_fabio');

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000004', 'davi@outro.invalid');
set local role authenticated;
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_carla_2')) ->> 'code',
  'not_found',
  'an invitation addressed to somebody else does not exist for this account'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000005', 'eva@lima.invalid');
set local role authenticated;
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_eva')) ->> 'code',
  'email_not_confirmed',
  'an account that never confirmed its address cannot accept'
);
select is((select count(*)::int from public.my_firm_invitations()), 0, 'and is offered nothing');
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000006', 'fabio@lima.invalid');
set local role authenticated;
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_fabio')) ->> 'code',
  'expired',
  'an invitation expires'
);
select is(public.firm_invitation_preview('t-fabio') ->> 'status', 'expired', 'and its link says so');
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000003', 'carla@lima.invalid');
set local role authenticated;
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_carla_1')) ->> 'code',
  'revoked',
  'the replaced link no longer works'
);
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_carla_2')) ->> 'code',
  'joined',
  'the last one sent does'
);

-- ---------- The roster ----------

select is((select count(*)::int from public.firm_team((select id from results where name = 'firm_a'))), 3, 'a member sees the whole team');
select ok(
  (select email = 'ana@souza.invalid' and display_name = 'Ana Souza' and firm_function = 'socio'
   from public.firm_team((select id from results where name = 'firm_a')) where role = 'owner'),
  'with the name, the address and the function of each colleague'
);
select is(
  (select count(*)::int from public.firm_team((select id from results where name = 'firm_a')) where has_second_factor is not null),
  0,
  'who is not a manager is not told who has the second factor'
);
select is(
  (select jsonb_array_length(oab) from public.firm_team((select id from results where name = 'firm_a'))
   where user_id = 'a1000000-0000-4000-8000-000000000002'),
  1,
  'the registrations at the bar of a colleague are on the roster'
);
select is(
  (select row(uf, number, kind)::text from public.oab_registrations where user_id = 'a1000000-0000-4000-8000-000000000002'),
  row('GO', '12345', 'principal')::text,
  'and readable by a colleague, as the bar writes them'
);
select is((select count(*)::int from public.profiles), 1, 'the profiles table itself stays private to its owner');
select is((select count(*)::int from public.firm_invitations), 0, 'a plain member does not see the invitations of the firm');
select throws_ok(
  $$select public.set_member_function((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000002', 'socio')$$,
  '42501', 'not_authorized',
  'nor changes what a colleague does in the firm'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid');
set local role authenticated;
select is(
  (select array_agg(has_second_factor order by display_name)
   from public.firm_team((select id from results where name = 'firm_a'))),
  array[true, false, false],
  'the owner sees who has the second factor'
);
reset role;

-- ---------- Who must have a second factor ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid');
set local role authenticated;
select is(public.second_factor_required(), true, 'the owner of a firm must have a second factor');
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000003', 'carla@lima.invalid');
set local role authenticated;
select is(public.second_factor_required(), false, 'a plain member is not asked for one, to start');
reset role;

update public.platform_settings
set value = '{"second_factor": {"roles": ["owner", "admin"], "functions": ["atendimento"]}}'
where key = 'security';

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000003', 'carla@lima.invalid');
set local role authenticated;
select is(public.second_factor_required(), true, 'the rule is data: naming a function in the setting asks its people too');
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000007', 'gil@lima.invalid');
set local role authenticated;
select is(public.second_factor_required(), false, 'an account that belongs to no firm is not asked');
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000009', 'operador@one.invalid');
set local role authenticated;
select is(public.second_factor_required(), true, 'the platform operator always is');
reset role;

-- ---------- The seat ceiling of the plan ----------

insert into public.entitlement_grants (org_id, kind, limits, source, note)
values ((select id from results where name = 'firm_a'), 'comp', '{"assentos_max": 3}', 'admin', 'teste');

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
insert into results (name, payload) values (
  'inv_over',
  public.invite_to_firm((select id from results where name = 'firm_a'), 'hugo@lima.invalid', 'member', 'advogado', pg_temp.h('t-hugo'))
);
select ok(
  (select payload ->> 'code' = 'seat_limit' and (payload ->> 'seats')::int = 3 from results where name = 'inv_over'),
  'no invitation goes out past the seats of the plan'
);
reset role;

-- Sending Gil's invitation again is refused too, and the one he has stays open.
select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
select is(
  public.invite_to_firm((select id from results where name = 'firm_a'), 'gil@lima.invalid', 'member', 'controladoria', pg_temp.h('t-gil-2')) ->> 'code',
  'seat_limit',
  'an invitation that cannot be replaced is refused'
);
reset role;
select ok(
  (select accepted_at is null and revoked_at is null from public.firm_invitations
   where id = (select (payload ->> 'id')::uuid from results where name = 'inv_gil')),
  'and the refusal leaves the open invitation as it was'
);

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000007', 'gil@lima.invalid');
set local role authenticated;
select throws_ok(
  $$select public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_gil'))$$,
  'P0001', 'seat_limit',
  'and an invitation sent before the team filled up cannot be accepted past them'
);
reset role;

select is(
  (select count(*)::int from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000007'),
  0,
  'the refused person is in no firm'
);

update public.entitlement_grants set limits = '{"assentos_max": 10}'
where org_id = (select id from results where name = 'firm_a');

-- ---------- A ceiling on invitations per day ----------

update public.platform_settings set value = value || '{"invites_per_day": 1}'::jsonb where key = 'team';

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
select is(
  public.invite_to_firm((select id from results where name = 'firm_a'), 'limite@lima.invalid', 'member', 'advogado', pg_temp.h('t-limite')) ->> 'code',
  'invite_rate_limited',
  'a firm sends a limited number of invitations a day'
);
reset role;
select is(
  (select count(*)::int from public.firm_invitations where email = 'limite@lima.invalid'),
  0,
  'and a refused invitation writes nothing'
);

update public.platform_settings set value = value || '{"invites_per_day": 30}'::jsonb where key = 'team';

-- ---------- One firm per person ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
insert into results (name, payload) values (
  'inv_davi',
  public.invite_to_firm((select id from results where name = 'firm_a'), 'davi@outro.invalid', 'member', 'advogado', pg_temp.h('t-davi'))
);
insert into results (name, payload) values (
  'revoke_eva',
  public.revoke_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_eva'))
);
select is((select payload ->> 'code' from results where name = 'revoke_eva'), 'revoked', 'a manager revokes an invitation');
select is(
  public.revoke_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_eva')) ->> 'code',
  'already_revoked',
  'revoking twice changes nothing'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000004', 'davi@outro.invalid', 'aal2');
set local role authenticated;
select is(
  public.accept_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_davi')) ->> 'code',
  'already_in_a_firm',
  'somebody who belongs to a firm cannot join a second one'
);

-- ---------- Another firm changes nothing here ----------

select throws_ok(
  $$select public.invite_to_firm((select id from results where name = 'firm_a'), 'z@outro.invalid', 'member', 'advogado', pg_temp.h('t-z'))$$,
  '42501', 'not_authorized',
  'the owner of another firm cannot invite into this one'
);
select throws_ok(
  $$select public.revoke_firm_invitation((select (payload ->> 'id')::uuid from results where name = 'inv_gil'))$$,
  '42501', 'not_authorized',
  'nor revoke its invitations'
);
select throws_ok(
  $$select * from public.firm_team((select id from results where name = 'firm_a'))$$,
  '42501', null,
  'nor read its roster'
);
select is(
  (select count(*)::int from public.oab_registrations where user_id = 'a1000000-0000-4000-8000-000000000002'),
  0,
  'nor the registrations of its lawyers'
);
select is(public.add_oab_registration('GO', '12345') ->> 'code', 'registration_in_use', 'a registration belongs to one account');
reset role;

-- ---------- Functions and roles ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid');
set local role authenticated;
select throws_ok(
  $$select public.set_member_function((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003', 'controladoria')$$,
  '42501', 'second_factor_required',
  'changing a function asks for the second factor'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid', 'aal2');
set local role authenticated;
select is(
  public.set_member_function((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003', 'controladoria') ->> 'code',
  'changed',
  'an admin changes the function of a plain member'
);
select is(
  public.set_member_function((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000002', 'socio') ->> 'code',
  'changed',
  'and their own'
);
select is(
  public.set_member_function((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000001', 'advogado') ->> 'code',
  'only_owner_changes_managers',
  'but not the owner''s'
);
select throws_ok(
  $$select public.set_member_role((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003', 'admin')$$,
  '42501', 'not_authorized',
  'an admin does not make admins'
);
select is(
  public.remove_firm_member((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000001') ->> 'code',
  'owner_cannot_be_removed',
  'nobody removes the owner'
);
select is(
  public.remove_firm_member((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000002') ->> 'code',
  'use_leave_firm',
  'and nobody removes themself: leaving is its own act'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
select is(
  public.set_member_role((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003', 'admin') ->> 'code',
  'changed',
  'the owner makes a member an admin'
);
select throws_ok(
  $$select public.set_member_role((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003', 'owner')$$,
  '22023', 'invalid_role',
  'the owner role is never assigned: it is transferred'
);
select is(
  public.set_member_role((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000001', 'member') ->> 'code',
  'owner_role_is_transferred',
  'and the owner does not demote themself'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid', 'aal2');
set local role authenticated;
select is(
  public.remove_firm_member((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003') ->> 'code',
  'only_owner_changes_managers',
  'an admin does not remove another admin'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
select is(
  public.set_member_role((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003', 'member') ->> 'code',
  'changed',
  'the owner makes an admin a plain member again'
);
reset role;

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid', 'aal2');
set local role authenticated;
select is(
  public.remove_firm_member((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003') ->> 'code',
  'removed',
  'an admin removes a plain member'
);
reset role;

select is(
  (select count(*)::int from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000003'),
  0,
  'the removed person belongs to no firm'
);

-- ---------- A support visit changes nothing ----------

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values (
  'a1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001',
  (select id from results where name = 'firm_a'), 'chamado de teste 123',
  'c1000000-0000-4000-8000-000000000001', now() + interval '30 minutes'
);

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2', 'c1000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.invite_to_firm((select id from results where name = 'firm_a'), 'visita@lima.invalid', 'member', 'advogado', pg_temp.h('t-v'))$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit cannot invite'
);
select throws_ok(
  $$select public.transfer_firm_ownership((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000002')$$,
  '42501', 'not_allowed_in_support_session',
  'nor hand the firm over'
);
select throws_ok(
  $$select public.remove_firm_member((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000002')$$,
  '42501', 'not_allowed_in_support_session',
  'nor remove a person'
);
select throws_ok(
  $$select public.add_oab_registration('SP', '4321')$$,
  '42501', 'not_allowed_in_support_session',
  'nor declare a registration at the bar'
);
select is(
  (select count(*)::int from public.firm_team((select id from results where name = 'firm_a'))),
  2,
  'it still reads the roster'
);
reset role;

-- ---------- Registrations at the bar ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@lima.invalid');
set local role authenticated;
select is(public.add_oab_registration('SP', '77', 'principal') ->> 'code', 'principal_already_registered', 'a lawyer has one principal registration');
select is(public.add_oab_registration('GO', '555', 'suplementar') ->> 'code', 'state_already_registered', 'and one registration per state');
select is(public.add_oab_registration('SP', '77a', 'suplementar') ->> 'code', 'added', 'a supplementary registration in another state is added');
select is(public.add_oab_registration('XX', '10', 'suplementar') ->> 'code', 'invalid_registration', 'a state that does not exist is refused');
select is(public.add_oab_registration('RJ', 'abc', 'suplementar') ->> 'code', 'invalid_registration', 'and so is a number that is not one');
select is(
  (select array_agg(uf || ':' || number order by uf) from public.oab_registrations where user_id = 'a1000000-0000-4000-8000-000000000002'),
  array['GO:12345', 'SP:77A'],
  'the person reads their own registrations'
);
select is(
  public.remove_oab_registration((select id from public.oab_registrations where uf = 'SP')) ->> 'code',
  'removed',
  'and removes one'
);
reset role;

-- ---------- Ownership and leaving ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid', 'aal2');
set local role authenticated;
select is(
  public.leave_firm((select id from results where name = 'firm_a')) ->> 'code',
  'owner_must_transfer_first',
  'the owner cannot walk out: a firm always has an owner'
);
select is(
  public.transfer_firm_ownership((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000003') ->> 'code',
  'not_a_member',
  'the firm is handed only to somebody who is in it'
);
select is(
  public.transfer_firm_ownership((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000002') ->> 'code',
  'transferred',
  'the owner hands the firm to a colleague'
);
reset role;

select is(
  (select array_agg(m.role::text || ':' || split_part(u.email, '@', 1) order by u.email)
   from public.memberships m join auth.users u on u.id = m.user_id
   where m.org_id = (select id from results where name = 'firm_a')),
  array['admin:ana', 'owner:bruno'],
  'the firm has exactly one owner, and the former one stays as an admin'
);

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid');
set local role authenticated;
select throws_ok(
  $$select public.transfer_firm_ownership((select id from results where name = 'firm_a'), 'a1000000-0000-4000-8000-000000000001')$$,
  '42501', 'not_authorized',
  'who is no longer the owner cannot take the firm back'
);
select is(
  public.leave_firm((select id from results where name = 'firm_a')) ->> 'code',
  'left',
  'leaving gives access up and asks for no second factor'
);
select is(public.current_org_id(), null, 'who left belongs to no firm');
select is((select count(*)::int from public.organizations), 0, 'and no longer sees it');
reset role;

-- ---------- The trail ----------

select is(
  (select array_agg(distinct action order by action) from public.audit_events
   where org_id = (select id from results where name = 'firm_a') and action like 'firm.%'),
  array[
    'firm.created',
    'firm.invitation.accepted',
    'firm.invitation.revoked',
    'firm.invitation.sent',
    'firm.member.function_changed',
    'firm.member.left',
    'firm.member.removed',
    'firm.member.role_changed',
    'firm.ownership.transferred'
  ],
  'every change to the team left an audit event in the firm'
);
select is(
  (select count(*)::int from public.audit_events
   where org_id = (select id from results where name = 'firm_a') and action = 'firm.invitation.sent'),
  7,
  'one per invitation sent'
);
select is(
  (select array_agg(action order by action) from public.audit_events
   where actor_id = 'a1000000-0000-4000-8000-000000000002' and action like 'member.oab.%'),
  array['member.oab.added', 'member.oab.added', 'member.oab.removed'],
  'and the registrations at the bar are audited too'
);
select ok(
  not exists (
    select 1 from public.audit_events
    where org_id = (select id from results where name = 'firm_b') and action <> 'firm.created'
  ),
  'nothing of this reached the other firm'
);
select is(
  (select count(*)::int from public.firm_invitations where org_id = (select id from results where name = 'firm_a') and accepted_at is not null),
  2,
  'two invitations were accepted'
);

select * from finish();
rollback;
