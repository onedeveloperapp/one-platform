begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- A firm that said ONE prepares no filing package (0285): the setup's facts say so, so the home leaves the step of
-- the filing out of its list, its filing way never chosen. Firm B, which said ONE prepares them, and a firm that
-- never answered are asked as before; A reads nothing of B's facts.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2850000-0000-4000-8000-000000000001', 'lia@moura-pacotes.invalid', 'Lia Moura'),
  ('a2850000-0000-4000-8000-000000000002', 'davi@prado-pacotes.invalid', 'Davi Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2850000-0000-4000-8000-00000000000a', 'Moura Advogados', 'moura-pacotes', 'a2850000-0000-4000-8000-000000000001'),
  ('b2850000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-pacotes', 'a2850000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2850000-0000-4000-8000-00000000000a', 'a2850000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2850000-0000-4000-8000-00000000000b', 'a2850000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.firm_operations (org_id, one_filing) values
  ('b2850000-0000-4000-8000-00000000000a', false),
  ('b2850000-0000-4000-8000-00000000000b', true);

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

set local role authenticated;
select pg_temp.sign_in('a2850000-0000-4000-8000-000000000001');
select is(
  (public.firm_setup_facts('b2850000-0000-4000-8000-00000000000a') ->> 'files_without_one')::boolean, true,
  'A said ONE prepares no filing package'
);
select is(
  (public.firm_setup_facts('b2850000-0000-4000-8000-00000000000a') ->> 'filing_way')::boolean, false,
  'its filing way stays unsaid, and the home leaves the step out by the new fact'
);
select throws_ok(
  $$select public.firm_setup_facts('b2850000-0000-4000-8000-00000000000b')$$,
  '42501', 'not_authorized', 'A reads nothing of B'
);

select pg_temp.sign_in('a2850000-0000-4000-8000-000000000002');
select is(
  (public.firm_setup_facts('b2850000-0000-4000-8000-00000000000b') ->> 'files_without_one')::boolean, false,
  'B said ONE prepares them: its filing way is asked'
);
reset role;

update public.firm_operations set one_filing = null where org_id = 'b2850000-0000-4000-8000-00000000000b';
set local role authenticated;
select pg_temp.sign_in('a2850000-0000-4000-8000-000000000002');
select is(
  (public.firm_setup_facts('b2850000-0000-4000-8000-00000000000b') ->> 'files_without_one')::boolean, false,
  'a firm that never answered is asked as one that files with ONE'
);
reset role;

select * from finish();
rollback;
