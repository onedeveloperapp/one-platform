begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- The closing goals of the controladoria (0113): who registers them
-- (a partner or the controladoria, never a support visit), what each may
-- be of (a module the firm has, a partnership of its own), archived with
-- the reason and brought back, every change on the record, and read by
-- anybody of the firm with its count by the rule of a closing (0146).
-- Two firms: A with a partner, the controladoria and a lawyer; B with its
-- owner and an agency of its own.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1140000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-metas.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1140000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@lima-metas.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1140000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@lima-metas.invalid', '', now(), '{}', '{"display_name":"Caio Lima"}', now(), now()),
  ('a1140000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@rocha-metas.invalid', '', now(), '{}', '{"display_name":"Duda Rocha"}', now(), now()),
  ('a1140000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@one-metas.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1140000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-metas', 'a1140000-0000-4000-8000-000000000001'),
  ('b1140000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-metas', 'a1140000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1140000-0000-4000-8000-00000000000a', 'a1140000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1140000-0000-4000-8000-00000000000a', 'a1140000-0000-4000-8000-000000000002', 'member', 'controladoria'),
  ('b1140000-0000-4000-8000-00000000000a', 'a1140000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('b1140000-0000-4000-8000-00000000000b', 'a1140000-0000-4000-8000-000000000004', 'owner', 'socio');
update public.profiles set is_superadmin = true where id = 'a1140000-0000-4000-8000-000000000009';

insert into public.partners (id, name) values
  ('c1140000-0000-4000-8000-0000000000aa', 'Viagens Sol'),
  ('c1140000-0000-4000-8000-0000000000bb', 'Viagens Mar');
insert into public.partner_links (id, partner_id, org_id, module_key, status) values
  ('d1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-0000000000aa', 'b1140000-0000-4000-8000-00000000000a',
   'direito-do-passageiro', 'active'),
  ('d1140000-0000-4000-8000-00000000000b', 'c1140000-0000-4000-8000-0000000000bb', 'b1140000-0000-4000-8000-00000000000b',
   'direito-do-passageiro', 'active');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> path from res where res.name = got.name; $$;

-- The partner registers the month's goal of the whole firm; the controladoria one of the agency Sol.
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null,
  date '2026-11-01', date '2026-11-30', null, null, null, null, 40));
reset role;
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('agency', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null,
  date '2026-11-01', date '2026-11-30', 'direito-do-passageiro', 'delay', null, 'd1140000-0000-4000-8000-00000000000a', 12));
insert into res values ('foreign', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null,
  date '2026-11-01', date '2026-11-30', null, null, null, 'd1140000-0000-4000-8000-00000000000b', 5));
insert into res values ('module', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null,
  date '2026-11-01', date '2026-11-30', 'direito-previdenciario', null, null, null, 5));
reset role;
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('lawyer', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null,
  date '2026-11-01', date '2026-11-30', null, null, null, null, 5));
insert into res values ('lawyer-reads', public.firm_closing_goals('b1140000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('firm', '{ok}')::boolean and pg_temp.got('agency', '{ok}')::boolean,
  'a partner and the controladoria register a goal'
);
select is(
  (select g.origin from public.closing_goals g where g.id = pg_temp.got('agency', '{id}')::uuid),
  'agency',
  'a goal of a partner agency is of the cases that came from agencies'
);
select is(pg_temp.got('lawyer', '{code}'), 'not_allowed', 'a lawyer does not');
select ok(
  pg_temp.got('foreign', '{code}') = 'partnership' and pg_temp.got('module', '{code}') = 'module',
  'nor of an agency of another firm, nor of a module the firm does not have'
);
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null, date '2026-11-30', date '2026-11-01',
       null, null, null, null, 5) $$,
  '23514', null,
  'a period ends on or after it starts'
);
reset role;

-- The controladoria changes the agency's target; the partner archives the firm's goal, then brings it back.
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('changed', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a',
  pg_temp.got('agency', '{id}')::uuid, date '2026-11-01', date '2026-11-30', 'direito-do-passageiro', 'delay', null,
  'd1140000-0000-4000-8000-00000000000a', 15));
reset role;
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('short', public.archive_closing_goal('b1140000-0000-4000-8000-00000000000a',
  pg_temp.got('firm', '{id}')::uuid, 'ab'));
insert into res values ('archived', public.archive_closing_goal('b1140000-0000-4000-8000-00000000000a',
  pg_temp.got('firm', '{id}')::uuid, 'Meta trocada pela de dezembro'));
insert into res values ('edit-archived', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a',
  pg_temp.got('firm', '{id}')::uuid, date '2026-11-01', date '2026-11-30', null, null, null, null, 50));
insert into res values ('reads', public.firm_closing_goals('b1140000-0000-4000-8000-00000000000a'));
insert into res values ('restored', public.archive_closing_goal('b1140000-0000-4000-8000-00000000000a',
  pg_temp.got('firm', '{id}')::uuid, null));
reset role;

select ok(
  pg_temp.got('changed', '{ok}')::boolean
    and (select target from public.closing_goals where id = pg_temp.got('agency', '{id}')::uuid) = 15,
  'a goal is changed'
);
select ok(
  pg_temp.got('short', '{code}') = 'reason' and pg_temp.got('archived', '{ok}')::boolean
    and pg_temp.got('edit-archived', '{code}') = 'archived',
  'archived with a reason of a few words, and no longer changed while archived'
);
select ok(
  pg_temp.got('restored', '{ok}')::boolean
    and (select archived_at is null and archive_reason is null from public.closing_goals
         where id = pg_temp.got('firm', '{id}')::uuid),
  'and brought back'
);
select is(
  (select array_agg(action order by action) from public.audit_events
   where org_id = 'b1140000-0000-4000-8000-00000000000a' and entity_type = 'closing_goal'),
  array['closing_goal.archived', 'closing_goal.changed', 'closing_goal.created', 'closing_goal.created',
        'closing_goal.restored'],
  'every change on the record'
);
select ok(
  (select payload ->> 'rule' = 'fechamento-v1' from res where name = 'reads')
    and (select bool_and(g -> 'closings' = '0'::jsonb) from res, jsonb_array_elements(payload -> 'goals') g
         where name = 'reads')
    and jsonb_array_length((select payload -> 'goals' from res where name = 'reads')) = 2,
  'the goals are read with their closings by the rule of a closing (0146), none in a firm with no case'
);
select ok(
  (select g ->> 'partner' = 'Viagens Sol' from res, jsonb_array_elements(payload -> 'goals') g
   where name = 'reads' and g ->> 'id' = pg_temp.got('agency', '{id}'))
    and (select g ->> 'archive_reason' = 'Meta trocada pela de dezembro' from res, jsonb_array_elements(payload -> 'goals') g
         where name = 'reads' and g ->> 'id' = pg_temp.got('firm', '{id}')),
  'each with its agency by name and, archived, its reason'
);
select ok(
  pg_temp.got('reads', '{may_manage}')::boolean and not pg_temp.got('lawyer-reads', '{may_manage}')::boolean
    and jsonb_array_length((select payload -> 'goals' from res where name = 'lawyer-reads')) = 2,
  'anybody of the firm reads them, and is told whether they may change them'
);

-- A support visit changes nothing; another firm reads nothing.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1140000-0000-4000-8000-000000000009', 'a1140000-0000-4000-8000-000000000001', 'b1140000-0000-4000-8000-00000000000a',
        'Conferindo as metas', 'f1140000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a1140000-0000-4000-8000-000000000001', 'f1140000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit', public.save_closing_goal('b1140000-0000-4000-8000-00000000000a', null,
  date '2026-12-01', date '2026-12-31', null, null, null, null, 5));
reset role;
select is(pg_temp.got('visit', '{code}'), 'support_visit', 'a support visit registers nothing');

select pg_temp.sign_in('a1140000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) from public.closing_goals) = 0
    and pg_temp.got('firm', '{id}') is not null,
  'another firm reads none of a firm''s goals'
);
reset role;

select * from finish();
rollback;
