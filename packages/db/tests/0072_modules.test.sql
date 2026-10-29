begin;
create extension if not exists pgtap;
select plan(17);

-- ============================================================
-- The product modules of ONE (0068): the catalog, the modules each firm
-- uses (given to every firm founded, given or taken by the operator on the
-- record), and the module every case is of, the kind of problem required of
-- a passenger case and of no other. Two firms.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-modulos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-modulos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one-modulos.invalid', '', now(), '{}', '{"display_name":"Olga Operadora"}', now(), now()),
  ('a7200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dora@nova-modulos.invalid', '', now(), '{}', '{"display_name":"Dora Nunes"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a7200000-0000-4000-8000-000000000003';

insert into public.organizations (id, name, slug, created_by) values
  ('b7200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-modulos', 'a7200000-0000-4000-8000-000000000001'),
  ('b7200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-modulos', 'a7200000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7200000-0000-4000-8000-00000000000a', 'a7200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7200000-0000-4000-8000-00000000000b', 'a7200000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- ---------- The catalog and a firm's modules ----------

select ok(
  exists (select 1 from public.product_modules m where m.key = 'direito-do-passageiro' and m.is_default and m.retired_at is null),
  'the passenger module is in the catalog, given to every new firm'
);

select ok(
  (select count(*) from public.firm_modules fm
   where fm.module_key = 'direito-do-passageiro'
     and fm.org_id in ('b7200000-0000-4000-8000-00000000000a', 'b7200000-0000-4000-8000-00000000000b')) = 2,
  'a firm founded takes the default module'
);

select pg_temp.sign_in('a7200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_reads', jsonb_build_object(
  'mine', (select count(*) from public.firm_modules where org_id = 'b7200000-0000-4000-8000-00000000000a'),
  'theirs', (select count(*) from public.firm_modules where org_id = 'b7200000-0000-4000-8000-00000000000b'),
  'has', public.firm_has_module('b7200000-0000-4000-8000-00000000000a', 'direito-do-passageiro'),
  'has_theirs', public.firm_has_module('b7200000-0000-4000-8000-00000000000b', 'direito-do-passageiro'),
  'catalog', (select count(*) from public.product_modules)
));
reset role;

select ok(
  pg_temp.got('ana_reads', 'mine') = '1' and pg_temp.got('ana_reads', 'theirs') = '0',
  'a firm reads its own modules and not another firm''s'
);
select ok(
  pg_temp.got('ana_reads', 'has') = 'true' and pg_temp.got('ana_reads', 'has_theirs') = 'false',
  'firm_has_module answers for the firm of who asks, and false for another firm'
);
select ok(pg_temp.got('ana_reads', 'catalog')::integer >= 1, 'anybody signed in reads the catalog');

-- ---------- The operator gives and takes a module ----------

select pg_temp.sign_in('a7200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.admin_set_firm_module('b7200000-0000-4000-8000-00000000000b', 'direito-do-passageiro', false, 'Uma nota longa o bastante') $$,
  '42501', 'not_authorized',
  'a person of a firm does not give or take a module'
);
reset role;

select pg_temp.sign_in('a7200000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('short_note', public.admin_set_firm_module('b7200000-0000-4000-8000-00000000000b',
  'direito-do-passageiro', false, 'curta'));
insert into res values ('taken', public.admin_set_firm_module('b7200000-0000-4000-8000-00000000000b',
  'direito-do-passageiro', false, 'Escritório de teste sem o módulo'));
insert into res values ('taken_again', public.admin_set_firm_module('b7200000-0000-4000-8000-00000000000b',
  'direito-do-passageiro', false, 'Escritório de teste sem o módulo'));
reset role;

select ok(pg_temp.got('short_note', 'code') = 'note_required', 'taking a module asks for a note');
select ok(
  pg_temp.got('taken', 'code') = 'disabled' and pg_temp.got('taken_again', 'code') = 'unchanged'
  and not exists (select 1 from public.firm_modules where org_id = 'b7200000-0000-4000-8000-00000000000b'),
  'the operator takes a module from a firm, once'
);
select ok(
  exists (select 1 from public.audit_events a
          where a.action = 'module.disabled' and a.org_id = 'b7200000-0000-4000-8000-00000000000b'
            and a.metadata ->> 'module' = 'direito-do-passageiro'),
  'taking a module is on the record'
);

select pg_temp.sign_in('a7200000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('caio_has', jsonb_build_object(
  'has', public.firm_has_module('b7200000-0000-4000-8000-00000000000b', 'direito-do-passageiro')));
reset role;
select ok(pg_temp.got('caio_has', 'has') = 'false', 'a firm the module was taken from does not have it');

insert into public.product_modules (key, name, retired_at) values ('modulo-antigo', 'Módulo antigo', now());
select pg_temp.sign_in('a7200000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('given', public.admin_set_firm_module('b7200000-0000-4000-8000-00000000000b',
  'direito-do-passageiro', true, 'Escritório de teste com o módulo'));
insert into res values ('retired', public.admin_set_firm_module('b7200000-0000-4000-8000-00000000000b',
  'modulo-antigo', true, 'Um módulo que não existe mais'));
reset role;

select ok(
  pg_temp.got('given', 'code') = 'enabled'
  and exists (select 1 from public.firm_modules where org_id = 'b7200000-0000-4000-8000-00000000000b'
              and enabled_by = 'a7200000-0000-4000-8000-000000000003'),
  'the operator gives a module back, and who gave it is kept'
);
select ok(pg_temp.got('retired', 'code') = 'module_retired', 'a retired module is given to nobody');

-- ---------- A firm founded from now on ----------

select pg_temp.sign_in('a7200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('founded', jsonb_build_object('org', public.create_firm('Nunes Advocacia', 'socio')));
reset role;
select ok(
  exists (select 1 from public.firm_modules fm
          where fm.org_id = pg_temp.got('founded', 'org')::uuid and fm.module_key = 'direito-do-passageiro')
  and not exists (select 1 from public.firm_modules fm
          where fm.org_id = pg_temp.got('founded', 'org')::uuid and fm.module_key = 'modulo-antigo'),
  'a firm founded through create_firm takes the default modules, never a retired one'
);

-- ---------- The module of a case ----------

insert into public.product_modules (key, name) values ('modulo-de-teste', 'Módulo de teste');

select lives_ok(
  $$ insert into public.cases (org_id, seq, module, incident)
     values ('b7200000-0000-4000-8000-00000000000a', 901, 'modulo-de-teste', null) $$,
  'a case of another module fits the table with no kind of problem'
);
select throws_ok(
  $$ insert into public.cases (org_id, seq, incident) values ('b7200000-0000-4000-8000-00000000000a', 902, null) $$,
  '23514', null,
  'a passenger case still requires its kind of problem'
);
select throws_ok(
  $$ insert into public.cases (org_id, seq, module, incident)
     values ('b7200000-0000-4000-8000-00000000000a', 903, 'modulo-de-teste', 'delay') $$,
  '23514', null,
  'a case of another module takes no kind of problem of the passenger''s'
);
select ok(
  (select module from public.cases where org_id = 'b7200000-0000-4000-8000-00000000000a' and seq = 901) = 'modulo-de-teste'
  and (select count(*) from public.cases where org_id = 'b7200000-0000-4000-8000-00000000000a') = 1,
  'the case keeps its module'
);

select * from finish();
rollback;
