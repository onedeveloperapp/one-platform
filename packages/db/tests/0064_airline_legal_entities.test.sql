begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- The legal entity in Brazil of the airlines a passenger sues (0058): the
-- four Brazilian operators carry their legal name and a CNPJ whose check
-- digits hold, and the papers of each firm name the company that answers in
-- court for the case's airline. Two firms, each with its own case.
--
-- Every person and firm here is invented; the companies are real, and their
-- CNPJs are the public ones of their head offices.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@companhias.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6400000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@companhias.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6400000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-companhias', 'a6400000-0000-4000-8000-000000000001'),
  ('b6400000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-companhias', 'a6400000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6400000-0000-4000-8000-00000000000a', 'a6400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6400000-0000-4000-8000-00000000000b', 'a6400000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A CNPJ whose two check digits hold (the weights of the Receita Federal).
create function pg_temp.cnpj_ok(cnpj text) returns boolean language plpgsql as $$
declare
  digits int[] := (select array_agg(substr(cnpj, i, 1)::int order by i) from generate_series(1, 14) i);
  w1 int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  w2 int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  total int := 0;
  check1 int;
  check2 int;
begin
  if cnpj !~ '^\d{14}$' then
    return false;
  end if;
  for i in 1..12 loop total := total + digits[i] * w1[i]; end loop;
  check1 := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  total := 0;
  for i in 1..13 loop total := total + digits[i] * w2[i]; end loop;
  check2 := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  return digits[13] = check1 and digits[14] = check2;
end;
$$;

select ok(
  (select bool_and(legal_name is not null and pg_temp.cnpj_ok(cnpj)) from public.airlines where iata in ('LA', 'G3', 'AD', '2Z'))
  and (select count(*) from public.airlines where iata in ('LA', 'G3', 'AD', '2Z')) = 4,
  'the four Brazilian operators carry their legal name and a CNPJ whose check digits hold'
);
select ok(
  (select legal_name is null and cnpj is null from public.airlines where iata = 'JJ')
  and (select count(*) from public.airlines where cnpj = '02012862000160') = 1,
  'LATAM''s company answers under one code: a name of it in court names one airline (0059)'
);

select pg_temp.sign_in('a6400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('latam', public.create_case('b6400000-0000-4000-8000-00000000000a', 'cancellation', 'LA',
  date '2026-10-24', '{"full_name": "Mariana Teste", "cpf": "12345678909", "city": "Goiânia", "uf": "GO"}'::jsonb));
reset role;
select pg_temp.sign_in('a6400000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('azul', public.create_case('b6400000-0000-4000-8000-00000000000b', 'delay', 'AD',
  date '2026-10-24', '{"full_name": "Pedro Teste", "cpf": "11144477735", "city": "Goiânia", "uf": "GO"}'::jsonb));
reset role;

select is(
  public.case_paper_filled(pg_temp.got('latam', 'case_id')::uuid, pg_temp.got('latam', 'person_id')::uuid, 'contra [[RE]].'),
  'contra TAM Linhas Aéreas S.A., CNPJ nº 02.012.862/0001-60.',
  'a paper of one firm names the company that answers for its case''s airline'
);
select is(
  public.case_paper_filled(pg_temp.got('azul', 'case_id')::uuid, pg_temp.got('azul', 'person_id')::uuid, 'contra [[RE]].'),
  'contra Azul Linhas Aéreas Brasileiras S.A., CNPJ nº 09.296.295/0001-60.',
  'and of the other firm, for its own'
);

select * from finish();
rollback;
