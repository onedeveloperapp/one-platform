begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- ============================================================
-- Sign-up and tenancy (0000, 0001, 0003, 0004).
--
-- A person is an account; a firm is something that account founds or is
-- invited to. Sign-up creates the profile and nothing else. Then the fences:
-- a person founds one firm, sees only their own rows, cannot write a
-- membership or a firm directly, cannot promote themself, and changes the
-- timezone only through the audited function.
--
-- Every person here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza","locale":"en","segment":"dev"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@lima.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'carla@lima.invalid', '', now(), '{"provider":"google"}', '{"full_name":"Carla Lima","picture":"https://example.invalid/c.png"}', now(), now());

create temporary table results (name text primary key, payload jsonb, id uuid);
grant select, insert on results to authenticated;

-- ---------- The trigger ----------

select is(
  (select row(display_name, locale, timezone)::text from public.profiles where id = 'a1000000-0000-4000-8000-000000000001'),
  row('Ana Souza', 'pt-BR', 'America/Sao_Paulo')::text,
  'the profile takes the name from the sign-up metadata and ignores what it does not know (a language, a segment)'
);
select is(
  (select display_name from public.profiles where id = 'a1000000-0000-4000-8000-000000000002'),
  'bruno',
  'with no metadata, the name falls back to the e-mail local part'
);
select is(
  (select row(display_name, avatar_url)::text from public.profiles where id = 'a1000000-0000-4000-8000-000000000003'),
  row('Carla Lima', 'https://example.invalid/c.png')::text,
  'an OAuth full name and picture are used'
);
-- Counted of these sign-ups: a hosted database has firms of its own.
select is((select count(*)::int from public.organizations
           where created_by in ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                                'a1000000-0000-4000-8000-000000000003')), 0, 'sign-up founds no firm');
select is((select count(*)::int from public.memberships
           where user_id in ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                             'a1000000-0000-4000-8000-000000000003')), 0, 'and puts nobody in one');
select throws_ok(
  $$update public.profiles set locale = 'en' where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a language the platform is not written in is refused by the database'
);

-- ---------- An account before it has a firm ----------

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","email":"ana@souza.invalid"}', true);
set local role authenticated;

select is(public.current_org_id(), null, 'an account that founded or joined nothing belongs to no firm');
select is((select count(*)::int from public.organizations), 0, 'and sees no firm');
select is((select count(*)::int from public.profiles), 1, 'it sees one profile: its own');

select throws_ok(
  $$select public.create_firm('A')$$,
  '22023', 'invalid_firm_name',
  'a firm needs a name'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values ('Direto', 'direto')$$,
  '42501', null,
  'a firm is not created by a direct write'
);

-- ---------- Founding a firm ----------

insert into results (name, id) values ('ana_firm', public.create_firm('  Souza   Advogados  '));

select is((select count(*)::int from public.organizations), 1, 'after founding, the person sees one firm: their own');
select is(public.current_org_id(), (select id from results where name = 'ana_firm'), 'current_org_id() answers with it');
select ok(
  (select name = 'Souza Advogados' and slug ~ '^souza-advogados-[0-9a-f]{8}$'
   from public.organizations where id = (select id from results where name = 'ana_firm')),
  'the firm keeps the name as typed, without the extra spaces, and gets an accent-safe slug with an id suffix'
);
select is(
  (select row(role, firm_function)::text from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000001'),
  row('owner', 'socio')::text,
  'the founder is the owner, and a sócio unless told otherwise'
);
select is(
  (select p.slug from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.org_id = (select id from results where name = 'ana_firm') and s.status = 'active'),
  'sem-assinatura',
  'a new firm stands on the floor: no subscription'
);
select throws_ok(
  $$select public.create_firm('Segundo Escritório')$$,
  '23505', 'already_in_a_firm',
  'a person founds one firm: they belong to one at a time'
);

-- ---------- What cannot be written directly ----------

select throws_ok(
  $$insert into public.memberships (org_id, user_id, role, firm_function)
    values ((select id from results where name = 'ana_firm'), 'a1000000-0000-4000-8000-000000000002', 'member', 'advogado')$$,
  '42501', null,
  'nobody is put in a firm by a direct write'
);
select throws_ok(
  $$update public.memberships set firm_function = 'controladoria' where user_id = 'a1000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor is a function or a role changed that way'
);
select throws_ok(
  $$update public.profiles set is_superadmin = true where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'the platform-operator flag is not writable by the person'
);
select throws_ok(
  $$update public.profiles set timezone = 'America/Manaus' where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'the timezone is not a plain column write: it goes through the audited function'
);
select throws_ok(
  $$delete from public.organizations where id = (select id from results where name = 'ana_firm')$$,
  '42501', null,
  'a firm is not deleted by a direct write'
);
select lives_ok(
  $$update public.profiles set display_name = 'Ana S.' where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'the display name is a plain column write'
);
select throws_ok(
  $$update public.organizations set name = 'Direto na tabela' where id = (select id from results where name = 'ana_firm')$$,
  '42501', null,
  'nor is a firm renamed by a direct write'
);
select is(
  public.rename_firm((select id from results where name = 'ana_firm'), '  Souza e   Lima Advogados ') ->> 'name',
  'Souza e Lima Advogados',
  'the owner renames the firm through the audited function'
);
select throws_ok(
  $$select public.rename_firm((select id from results where name = 'ana_firm'), 'X')$$,
  '22023', 'invalid_firm_name',
  'a name too short is refused'
);

insert into results (name, payload) values ('ana_profile', public.update_member_profile(null, 'America/Manaus'));
select throws_ok(
  $$select public.update_member_profile(null, 'Mars/Olympus')$$,
  '22023', 'invalid_timezone',
  'a timezone the database does not know is refused'
);
reset role;

select ok(
  (select payload -> 'changed' = '["timezone"]'::jsonb and payload ->> 'timezone' = 'America/Manaus'
   from results where name = 'ana_profile'),
  'the function reports what changed'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'member.profile_updated'
      and actor_id = 'a1000000-0000-4000-8000-000000000001'
      and org_id = (select id from results where name = 'ana_firm')
      and metadata ->> 'timezone' = 'America/Manaus'
  ),
  'and the change is audited in the firm of the person'
);
select ok(
  exists (
    select 1 from public.audit_events
    where action = 'firm.created' and org_id = (select id from results where name = 'ana_firm')
      and actor_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'founding a firm is audited'
);
select is(
  (select metadata from public.audit_events
   where action = 'firm.renamed' and org_id = (select id from results where name = 'ana_firm')),
  '{"from": "Souza Advogados", "to": "Souza e Lima Advogados"}'::jsonb,
  'and so is renaming it, with the name before and after'
);

-- ---------- The model's own fences ----------

insert into public.organizations (id, name, slug)
values ('b1000000-0000-4000-8000-000000000009', 'Outro Escritório', 'outro-escritorio');

select throws_ok(
  $$insert into public.memberships (org_id, user_id, role, firm_function)
    values ('b1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'member', 'advogado')$$,
  '23505', null,
  'the database itself keeps a person in one firm at a time, whoever writes'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501', null,
  'an anonymous visitor cannot read profiles at all'
);
reset role;

select * from finish();
rollback;
