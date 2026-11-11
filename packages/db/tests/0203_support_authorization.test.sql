begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- The support's access (0203). In Lima, Ana (a partner who owns the account)
-- lets the support in for 24 hours with the second factor; Caio, a lawyer,
-- may not. The backend opens a visit into Lima under that authorization and
-- refuses one into Rocha, which gave none; a visit into a person of no firm
-- needs none. Ana ends the authorization and no visit opens after it. Lima's
-- people read whether the support may enter and the visits made; Rocha reads
-- nothing of Lima's. A support visit lets nobody in.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2030000-0000-4000-8000-000000000001', 'ana@lima-suporte.invalid', 'Ana Lima'),
  ('a2030000-0000-4000-8000-000000000002', 'caio@lima-suporte.invalid', 'Caio Lima'),
  ('a2030000-0000-4000-8000-000000000003', 'edu@rocha-suporte.invalid', 'Edu Rocha'),
  ('a2030000-0000-4000-8000-000000000004', 'gil@sem-escritorio.invalid', 'Gil Sem Escritório'),
  ('a2030000-0000-4000-8000-000000000009', 'operador@suporte.invalid', 'Operador')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2030000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-suporte', 'a2030000-0000-4000-8000-000000000001'),
  ('b2030000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-suporte', 'a2030000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2030000-0000-4000-8000-00000000000a', 'a2030000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2030000-0000-4000-8000-00000000000a', 'a2030000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2030000-0000-4000-8000-00000000000b', 'a2030000-0000-4000-8000-000000000003', 'owner', 'socio');
update public.profiles set is_superadmin = true where id = 'a2030000-0000-4000-8000-000000000009';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.sign_in(person uuid, aal text default 'aal2', session uuid default null) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', person, 'role', 'authenticated',
    'aal', aal, 'session_id', session))::text, true);
$$;
-- The backend opens a visit as the service role does.
create function pg_temp.open_visit(target uuid, firm uuid, session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
  values ('a2030000-0000-4000-8000-000000000009', target, firm, 'Chamado 1234: a tela de casos não abre.', session,
          now() + interval '30 minutes');
end;
$$;

select pg_temp.sign_in('a2030000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'caio', public.grant_support_access('b2030000-0000-4000-8000-00000000000a', 24, null);
reset role;
select pg_temp.sign_in('a2030000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
insert into res select 'no_factor', public.grant_support_access('b2030000-0000-4000-8000-00000000000a', 24, null);
reset role;
select pg_temp.sign_in('a2030000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'too_long', public.grant_support_access('b2030000-0000-4000-8000-00000000000a', 500, null);
insert into res select 'granted', public.grant_support_access('b2030000-0000-4000-8000-00000000000a', 24,
  'Para ver o erro da importação.');
reset role;

select ok(
  pg_temp.got('caio', '{code}') = 'not_allowed' and pg_temp.got('no_factor', '{code}') = 'second_factor'
  and pg_temp.got('too_long', '{code}') = 'invalid_hours' and pg_temp.got('granted', '{ok}') = 'true'
  and (pg_temp.got('granted', '{ends_at}'))::timestamptz between now() + interval '23 hours' and now() + interval '25 hours'
  and exists (select 1 from public.audit_events where action = 'support.access_granted'
                and org_id = 'b2030000-0000-4000-8000-00000000000a'),
  'who manages the account lets the support in for some hours, with the second factor, on the record'
);

select lives_ok(
  $$ select pg_temp.open_visit('a2030000-0000-4000-8000-000000000002', 'b2030000-0000-4000-8000-00000000000a',
       'fe030000-0000-4000-8000-000000000001') $$,
  'the backend opens a visit into a firm that let the support in'
);
reset role;

select ok(
  (select authorization_id is not null from public.impersonation_sessions
   where session_id = 'fe030000-0000-4000-8000-000000000001'),
  'and the visit keeps the authorization it came under'
);

select throws_ok(
  $$ select pg_temp.open_visit('a2030000-0000-4000-8000-000000000003', 'b2030000-0000-4000-8000-00000000000b',
       'fe030000-0000-4000-8000-000000000002') $$,
  '42501', 'support_not_authorized', 'no visit opens into a firm that let nobody in'
);
reset role;

select lives_ok(
  $$ select pg_temp.open_visit('a2030000-0000-4000-8000-000000000004', null, 'fe030000-0000-4000-8000-000000000003') $$,
  'a person of no firm needs no authorization'
);
reset role;

-- During the visit into Lima, the visited session lets nobody in.
select pg_temp.sign_in('a2030000-0000-4000-8000-000000000002', 'aal2', 'fe030000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'in_visit', public.grant_support_access('b2030000-0000-4000-8000-00000000000a', 2, null);
reset role;
select pg_temp.sign_in('a2030000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'lima_reads', public.firm_support_access('b2030000-0000-4000-8000-00000000000a');
reset role;

select ok(
  pg_temp.got('in_visit', '{code}') = 'support_visit'
  and pg_temp.got('lima_reads', '{manages}') = 'false'
  and pg_temp.got('lima_reads', '{live,note}') = 'Para ver o erro da importação.'
  and pg_temp.got('lima_reads', '{live,granted_by}') = 'Ana Lima'
  and pg_temp.got('lima_reads', '{visits,0,reason}') = 'Chamado 1234: a tela de casos não abre.',
  'anybody of the firm reads whether the support may enter and the visits made; a visit lets nobody in'
);

select pg_temp.sign_in('a2030000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
insert into res select 'ended', public.end_support_access('b2030000-0000-4000-8000-00000000000a');
reset role;

select throws_ok(
  $$ select pg_temp.open_visit('a2030000-0000-4000-8000-000000000001', 'b2030000-0000-4000-8000-00000000000a',
       'fe030000-0000-4000-8000-000000000004') $$,
  '42501', 'support_not_authorized', 'once the firm ends the authorization, no visit opens'
);
reset role;

select pg_temp.sign_in('a2030000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res select 'operator', public.admin_support_access_for('a2030000-0000-4000-8000-000000000001');
insert into res select 'ask', public.admin_request_support_access('b2030000-0000-4000-8000-00000000000b',
  'Chamado 5678: o protocolo não sai.');
reset role;
select pg_temp.sign_in('a2030000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$ select public.firm_support_access('b2030000-0000-4000-8000-00000000000a') $$, '42501', null,
  'nobody reads another firm''s support access');
reset role;

select ok(
  pg_temp.got('ended', '{ended}') = 'true'
  and pg_temp.got('operator', '{authorized}') = 'false' and pg_temp.got('operator', '{firm_name}') = 'Lima Advocacia'
  and pg_temp.got('ask', '{people,0}') = 'a2030000-0000-4000-8000-000000000003'
  and not has_function_privilege('authenticated', 'public.support_access_live(uuid)', 'EXECUTE'),
  'the operator reads before a visit whether the firm let the support in, and asks it, telling who manages it'
);

select * from finish();
rollback;
