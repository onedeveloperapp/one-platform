begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The claim a firm asks by default among the facts of its setup (0056): a
-- default said for some kind of problem is a fact of the firm that said it,
-- read by anybody of that firm and by nobody of another, and taken back when
-- the default is. The other facts stay as 0044 wrote them. Two firms.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a6200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-valores', 'a6200000-0000-4000-8000-000000000001'),
  ('b6200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-valores', 'a6200000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6200000-0000-4000-8000-00000000000a', 'a6200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6200000-0000-4000-8000-00000000000a', 'a6200000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b6200000-0000-4000-8000-00000000000b', 'a6200000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- ---------- Before any default ----------

select pg_temp.sign_in('a6200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_before', public.firm_setup_facts('b6200000-0000-4000-8000-00000000000a'));
insert into res values ('a_sets', public.set_firm_claim_default('b6200000-0000-4000-8000-00000000000a', 'cancellation', 1000000));
insert into res values ('a_after', public.firm_setup_facts('b6200000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('a_before', 'claim_defaults') = 'false'
  and pg_temp.got('a_sets', 'code') = 'saved'
  and pg_temp.got('a_after', 'claim_defaults') = 'true',
  'a default claim said for a kind of problem is a fact of the firm''s setup'
);

-- ---------- Who reads it ----------

select pg_temp.sign_in('a6200000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
insert into res values ('a_lawyer', public.firm_setup_facts('b6200000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('a_lawyer', 'claim_defaults'), 'true', 'anybody of the firm reads the same fact');

select pg_temp.sign_in('a6200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_own', public.firm_setup_facts('b6200000-0000-4000-8000-00000000000b'));
select throws_ok(
  $$select public.firm_setup_facts('b6200000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'nobody of another firm reads a firm''s setup'
);
reset role;
select is(pg_temp.got('b_own', 'claim_defaults'), 'false', 'a default of one firm is no fact of another');

-- ---------- Taken back ----------

select pg_temp.sign_in('a6200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_removes', public.set_firm_claim_default('b6200000-0000-4000-8000-00000000000a', 'cancellation', null));
insert into res values ('a_removed', public.firm_setup_facts('b6200000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('a_removes', 'ok') = 'true' and pg_temp.got('a_removed', 'claim_defaults') = 'false',
  'a default taken back is no longer a fact of the setup'
);

-- ---------- The rest as it was ----------

select ok(
  (select payload ?& array['firm_document', 'oab', 'signer', 'oab_signer', 'team', 'works_alone', 'whatsapp',
     'channel', 'first_case', 'setup_answered'] from res where name = 'a_removed'),
  'the facts of 0044 are all still there'
);
select ok(
  pg_temp.got('a_removed', 'oab_signer') = 'false' and pg_temp.got('a_removed', 'team') = 'true'
  and pg_temp.got('a_removed', 'channel') = 'false' and pg_temp.got('a_removed', 'setup_answered') = 'false',
  'and they read as they did'
);

select * from finish();
rollback;
