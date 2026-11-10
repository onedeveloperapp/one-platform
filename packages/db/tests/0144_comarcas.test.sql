begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- A lawsuit planned at the client's city goes to the comarca that city
-- belongs to (0145): the platform's table of Goiás, read by any account and
-- by no visitor; a planned lawsuit whose comarca is the city as written takes
-- its comarca; one a person wrote otherwise, one the court already has and one
-- of a court with no table stay as they are; and each lawsuit says whether its
-- comarca is one the table knows. Two firms: each lawsuit is its firm's.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1440000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@comarcaone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1440000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@comarcaone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1440000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-comarcaone', 'a1440000-0000-4000-8000-000000000001'),
  ('b1440000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-comarcaone', 'a1440000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1440000-0000-4000-8000-00000000000a', 'a1440000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1440000-0000-4000-8000-00000000000b', 'a1440000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case and one lawsuit of it, as a person of the firm writes it.
create function pg_temp.lawsuit(name text, who uuid, org uuid, fields jsonb) returns void
language plpgsql as $$
declare
  made jsonb;
  saved jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  saved := public.save_proceeding((made ->> 'case_id')::uuid, null, fields, array[(made ->> 'party_id')::uuid]);
  reset role;
  insert into res values (name, made || jsonb_build_object('saved', saved, 'proceeding_id', saved ->> 'proceeding_id'));
end;
$$;

create function pg_temp.where_(name text) returns text language sql as
$$ select p.comarca || ':' || p.comarca_checked::text from public.proceedings p
   where p.id = pg_temp.got(name, 'proceeding_id')::uuid; $$;

select ok(
  (select count(*) = 246 and count(distinct comarca) = 127 and count(distinct municipality_key) = 246
          and bool_and(not confirmed and source_url like 'https://legisla.casacivil.go.gov.br/%')
   from public.court_comarcas where court = 'TJGO')
  and has_table_privilege('authenticated', 'public.court_comarcas', 'SELECT')
  and not has_table_privilege('anon', 'public.court_comarcas', 'SELECT')
  and not has_table_privilege('authenticated', 'public.court_comarcas', 'INSERT'),
  'the 246 municipalities of Goiás in 127 comarcas, unconfirmed, read by any account and written by none'
);

select ok(
  public.comarca_of('TJGO', 'Brazabrantes') = 'Goianira'
  and public.comarca_of('TJGO', ' abadia de goias ') = 'Guapó'
  and public.comarca_of('TJGO', 'Goiânia') = 'Goiânia'
  and public.comarca_of('TJGO', 'Rialma') = 'Rialma'
  and public.comarca_of('TJGO', 'Cidade Inventada') is null
  and public.comarca_of('TJSP', 'Brazabrantes') is null,
  'a city is found however it is written, and a city or a court the table does not know gives no comarca'
);

select pg_temp.lawsuit('alfa', 'a1440000-0000-4000-8000-000000000001', 'b1440000-0000-4000-8000-00000000000a',
  '{"kind": "juizado", "court": "TJGO", "comarca": "Brazabrantes", "forum_basis": "domicile", "forum_city": "Brazabrantes", "status": "planned"}');
select ok(
  pg_temp.got('alfa', 'proceeding_id') is not null and pg_temp.where_('alfa') = 'Goianira:true'
  and (select forum_city = 'Brazabrantes' from public.proceedings where id = pg_temp.got('alfa', 'proceeding_id')::uuid),
  'a lawsuit planned at a city with no comarca of its own goes to the comarca the city belongs to, the city kept'
);

select pg_temp.lawsuit('escolha', 'a1440000-0000-4000-8000-000000000001', 'b1440000-0000-4000-8000-00000000000a',
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Brazabrantes", "status": "planned"}');
select ok(
  pg_temp.where_('escolha') = 'Goiânia:true',
  'a comarca a person wrote that is not the city stays theirs'
);

select pg_temp.lawsuit('ajuizada', 'a1440000-0000-4000-8000-000000000001', 'b1440000-0000-4000-8000-00000000000a',
  '{"kind": "juizado", "court": "TJGO", "comarca": "Brazabrantes", "status": "filed", "cnj": "5000821-66.2099.8.09.0051", "filed_at": "2026-10-01"}');
select pg_temp.lawsuit('paulista', 'a1440000-0000-4000-8000-000000000001', 'b1440000-0000-4000-8000-00000000000a',
  '{"kind": "juizado", "court": "TJSP", "comarca": "Campinas", "forum_basis": "domicile", "forum_city": "Campinas", "status": "planned"}');
select ok(
  pg_temp.where_('ajuizada') = 'Brazabrantes:false' and pg_temp.where_('paulista') = 'Campinas:false',
  'a lawsuit the court has keeps what it was recorded with, and a court with no table keeps the city, said unchecked'
);

-- The lawsuit of the city is corrected to another city of the table: it follows the new city's comarca.
do $$
begin
  perform pg_temp.sign_in('a1440000-0000-4000-8000-000000000001');
  set local role authenticated;
  insert into res values ('corrigida', public.save_proceeding(pg_temp.got('alfa', 'case_id')::uuid,
    pg_temp.got('alfa', 'proceeding_id')::uuid,
    '{"kind": "juizado", "court": "TJGO", "comarca": "Aragoiânia", "forum_basis": "domicile", "forum_city": "Aragoiânia", "status": "planned"}',
    null));
  reset role;
end;
$$;
select ok(
  pg_temp.where_('alfa') = 'Guapó:true',
  'a city corrected on a planned lawsuit takes the comarca of the new city'
);

select pg_temp.lawsuit('beta', 'a1440000-0000-4000-8000-000000000002', 'b1440000-0000-4000-8000-00000000000b',
  '{"kind": "juizado", "court": "TJGO", "comarca": "Santo Antônio de Goiás", "forum_basis": "domicile", "forum_city": "Santo Antônio de Goiás", "status": "planned"}');
select ok(
  pg_temp.where_('beta') = 'Goianira:true',
  'a lawsuit of firm B goes to its comarca too'
);

select pg_temp.sign_in('a1440000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (select count(*) = 246 from public.court_comarcas)
  and not exists (select 1 from public.proceedings where id = pg_temp.got('beta', 'proceeding_id')::uuid)
  and exists (select 1 from public.proceedings where id = pg_temp.got('alfa', 'proceeding_id')::uuid),
  'a person of firm A reads the whole table and none of firm B''s lawsuits'
);
reset role;

select * from finish();
rollback;
