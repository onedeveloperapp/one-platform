begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- The agency's setup (0080): who manages a travel agency answers its setup
-- once, on the platform's record, never in a support visit; `my_partner`
-- says whether it was answered; and ONE proposes the clause of the agency's
-- contract with the agency's and the firm's names, which the agency may
-- register as it is. Two firms, three agencies (one with no partnership).
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-setup.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-setup.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-sol-setup.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@viagens-sol-setup.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabi@turismo-mar-setup.invalid', '', now(), '{}', '{"display_name":"Fabi Costa"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gil@turismo-mar-setup.invalid', '', now(), '{}', '{"display_name":"Gil Prado"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'hugo@rota-livre-setup.invalid', '', now(), '{}', '{"display_name":"Hugo Dias"}', now(), now()),
  ('a8300000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'iara@operador-setup.invalid', '', now(), '{}', '{"display_name":"Iara Nunes"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a8300000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b8300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-setup', 'a8300000-0000-4000-8000-000000000001'),
  ('b8300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-setup', 'a8300000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8300000-0000-4000-8000-00000000000a', 'a8300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8300000-0000-4000-8000-00000000000b', 'a8300000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.partners (id, name) values
  ('c8300000-0000-4000-8000-00000000000a', 'Viagens Sol'),
  ('c8300000-0000-4000-8000-00000000000b', 'Turismo Mar'),
  ('c8300000-0000-4000-8000-00000000000c', 'Rota Livre');
insert into public.partner_members (partner_id, user_id, role) values
  ('c8300000-0000-4000-8000-00000000000a', 'a8300000-0000-4000-8000-000000000003', 'owner'),
  ('c8300000-0000-4000-8000-00000000000a', 'a8300000-0000-4000-8000-000000000004', 'member'),
  ('c8300000-0000-4000-8000-00000000000b', 'a8300000-0000-4000-8000-000000000005', 'owner'),
  ('c8300000-0000-4000-8000-00000000000b', 'a8300000-0000-4000-8000-000000000006', 'admin'),
  ('c8300000-0000-4000-8000-00000000000c', 'a8300000-0000-4000-8000-000000000007', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d8300000-0000-4000-8000-00000000000a', 'c8300000-0000-4000-8000-00000000000a', 'b8300000-0000-4000-8000-00000000000a', 'direito-do-passageiro'),
  ('d8300000-0000-4000-8000-00000000000b', 'c8300000-0000-4000-8000-00000000000b', 'b8300000-0000-4000-8000-00000000000b', 'direito-do-passageiro');
-- Rota Livre's partnership with firm A ended: it has none active.
insert into public.partner_links (id, partner_id, org_id, module_key, status, ended_at, end_reason) values
  ('d8300000-0000-4000-8000-00000000000c', 'c8300000-0000-4000-8000-00000000000c', 'b8300000-0000-4000-8000-00000000000a',
   'direito-do-passageiro', 'ended', now(), 'Parceria encerrada');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated',
  'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- ---------- Whether the setup was answered ----------

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('duda_before', public.my_partner());
reset role;

select ok(
  pg_temp.got('duda_before', 'setup_answered') = 'false' and pg_temp.got('duda_before', 'role') = 'owner',
  'a new agency''s setup was never answered, and my_partner says so'
);

-- ---------- Who answers it ----------

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$ select public.answer_partner_setup('c8300000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'a member of the agency does not answer its setup: who manages it does'
);
reset role;

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$ select public.answer_partner_setup('c8300000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of another agency answers it'
);
reset role;

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.answer_partner_setup('c8300000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of the firm answers the agency''s setup'
);
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8300000-0000-4000-8000-000000000009', 'a8300000-0000-4000-8000-000000000003', null,
        'Conferindo a configuração', 'f8300000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a8300000-0000-4000-8000-000000000003', 'f8300000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.answer_partner_setup('c8300000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_allowed_in_support_session',
  'a support visit answers nothing for the agency'
);
reset role;

select is(
  (select setup_answered_at from public.partners where id = 'c8300000-0000-4000-8000-00000000000a'),
  null,
  'nothing refused touched the agency'
);

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('answered', public.answer_partner_setup('c8300000-0000-4000-8000-00000000000a'));
insert into res values ('duda_after', public.my_partner());
reset role;

select ok(
  pg_temp.got('answered', 'code') = 'answered'
  and (select setup_answered_at is not null from public.partners where id = 'c8300000-0000-4000-8000-00000000000a')
  and pg_temp.got('duda_after', 'setup_answered') = 'true',
  'who manages the agency answers its setup, and my_partner says it was'
);

create temporary table first_moment as
  select setup_answered_at from public.partners where id = 'c8300000-0000-4000-8000-00000000000a';

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('again', public.answer_partner_setup('c8300000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('again', 'code') = 'unchanged'
  and (select p.setup_answered_at = f.setup_answered_at from public.partners p, first_moment f
       where p.id = 'c8300000-0000-4000-8000-00000000000a')
  and (select count(*) from public.audit_events where action = 'partner.setup_answered'
       and entity_id = 'c8300000-0000-4000-8000-00000000000a') = 1,
  'answering again keeps the first moment, recorded once'
);

select ok(
  exists (select 1 from public.audit_events where action = 'partner.setup_answered' and org_id is null
          and actor_id = 'a8300000-0000-4000-8000-000000000003'),
  'the answer is on the platform''s record'
);

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select count(*)::integer from public.audit_events where action = 'partner.setup_answered'),
  0,
  'no firm reads the agency''s record'
);
reset role;

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000006');
set local role authenticated;
insert into res values ('gil', public.answer_partner_setup('c8300000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('gil', 'code') = 'answered'
  and (select setup_answered_at is not null from public.partners where id = 'c8300000-0000-4000-8000-00000000000b'),
  'an admin of the agency answers its setup too'
);

-- ---------- The clause ONE proposes ----------

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('sol', jsonb_build_object('text', public.pax_clause_proposal('c8300000-0000-4000-8000-00000000000a')));
reset role;
select pg_temp.sign_in('a8300000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('mar', jsonb_build_object('text', public.pax_clause_proposal('c8300000-0000-4000-8000-00000000000b')));
reset role;
select pg_temp.sign_in('a8300000-0000-4000-8000-000000000007');
set local role authenticated;
insert into res values ('rota', jsonb_build_object('text', public.pax_clause_proposal('c8300000-0000-4000-8000-00000000000c')));
reset role;

select ok(
  position('Viagens Sol' in pg_temp.got('sol', 'text')) > 0
  and position('Souza Advogados' in pg_temp.got('sol', 'text')) > 0
  and position('{' in pg_temp.got('sol', 'text')) = 0,
  'the clause ONE proposes names the agency and the firm of its partnership, for anybody of the agency'
);
select ok(
  position('Rocha Advocacia' in pg_temp.got('mar', 'text')) > 0
  and position('Souza Advogados' in pg_temp.got('mar', 'text')) = 0,
  'another agency''s proposal names its own firm'
);
select ok(
  position('parceiro da agência' in pg_temp.got('rota', 'text')) > 0
  and position('Souza Advogados' in pg_temp.got('rota', 'text')) = 0
  and position('{' in pg_temp.got('rota', 'text')) = 0,
  'an agency with no partnership is proposed words that name no firm, never one it no longer works with'
);

select pg_temp.sign_in('a8300000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.pax_clause_proposal('c8300000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of the firm reads the agency''s proposal'
);
reset role;

select pg_temp.anonymous();
set local role anon;
select throws_ok(
  $$ select public.pax_clause_proposal('c8300000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'nobody signed out reads it'
);
reset role;

-- The agency registers the proposal as it is: it is a clause the database takes.
select pg_temp.sign_in('a8300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('saved', public.pax_save_consent_term('c8300000-0000-4000-8000-00000000000a', pg_temp.got('sol', 'text')));
reset role;

select ok(
  pg_temp.got('saved', 'code') = 'saved' and pg_temp.got('saved', 'version') = '1'
  and (select body = pg_temp.got('sol', 'text') from public.pax_consent_terms
       where partner_id = 'c8300000-0000-4000-8000-00000000000a' and version = 1),
  'the agency registers the proposal as its clause, word for word'
);

-- The longest names an agency and a firm may have still leave a clause the database takes, in the copy rules.
update public.partners set name = rpad('Agência Longa ', 120, 'x') where id = 'c8300000-0000-4000-8000-00000000000b';
update public.organizations set name = rpad('Escritório Longo ', 120, 'y') where id = 'b8300000-0000-4000-8000-00000000000b';
select pg_temp.sign_in('a8300000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('long', jsonb_build_object('text', public.pax_clause_proposal('c8300000-0000-4000-8000-00000000000b')));
reset role;

select ok(
  char_length(pg_temp.got('long', 'text')) between 40 and 1200
  and pg_temp.got('long', 'text') !~ '[–—]'
  and pg_temp.got('long', 'text') !~ '[[:alnum:]]!',
  'with the longest names the proposal still fits a clause, with no dash and no exclamation'
);

select * from finish();
rollback;
