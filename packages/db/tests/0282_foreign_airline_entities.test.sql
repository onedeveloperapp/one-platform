begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- The legal entity in Brazil of the foreign airlines a passenger sues
-- (0282): the twenty foreign airlines carry their legal name, a CNPJ whose
-- check digits hold and the address the Receita Federal has, no CNPJ names
-- two airlines (LATAM still answers under one code), and the papers of each
-- firm name the company that answers in court for the case's airline. Two
-- firms, each with its own case.
--
-- Every person and firm here is invented; the companies are real, and their
-- CNPJs are the public ones of their establishments in Brazil.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2820000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@estrangeiras.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2820000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@estrangeiras.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b2820000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-estrangeiras', 'a2820000-0000-4000-8000-000000000001'),
  ('b2820000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-estrangeiras', 'a2820000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2820000-0000-4000-8000-00000000000a', 'a2820000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2820000-0000-4000-8000-00000000000b', 'a2820000-0000-4000-8000-000000000004', 'owner', 'socio');

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
  (select bool_and(nullif(btrim(legal_name), '') is not null and pg_temp.cnpj_ok(cnpj) and nullif(btrim(address), '') is not null)
   from public.airlines
   where iata in ('QR', 'TP', 'AA', 'AF', 'KL', 'AM', 'AR', 'AV', 'BA', 'CM', 'DL', 'EK', 'ET', 'H2', 'IB', 'JA', 'LH', 'TK', 'UA', 'UX'))
  and (select count(*) from public.airlines
       where iata in ('QR', 'TP', 'AA', 'AF', 'KL', 'AM', 'AR', 'AV', 'BA', 'CM', 'DL', 'EK', 'ET', 'H2', 'IB', 'JA', 'LH', 'TK', 'UA', 'UX')) = 20,
  'the twenty foreign airlines carry their legal name, a CNPJ whose check digits hold and their address in Brazil'
);
select ok(
  (select count(cnpj) = count(distinct cnpj) from public.airlines)
  and (select legal_name is null and cnpj is null from public.airlines where iata = 'JJ')
  and (select address is not null from public.airlines where iata = 'LA'),
  'no CNPJ names two airlines: LATAM still answers under one code'
);
select is((select legal_name || ' ' || cnpj from public.airlines where iata = 'QR'),
  'Qatar Airways Group (Q.C.S.C.) 08734301000150', 'the company of the owner''s test is the one the Receita Federal has');

select pg_temp.sign_in('a2820000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('qatar', public.create_case('b2820000-0000-4000-8000-00000000000a', 'cancellation', 'QR',
  date '2026-10-24', '{"full_name": "Mariana Teste", "cpf": "12345678909", "city": "Goiânia", "uf": "GO"}'::jsonb));
reset role;
select pg_temp.sign_in('a2820000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('tap', public.create_case('b2820000-0000-4000-8000-00000000000b', 'delay', 'TP',
  date '2026-10-24', '{"full_name": "Pedro Teste", "cpf": "11144477735", "city": "Goiânia", "uf": "GO"}'::jsonb));
reset role;

select is(
  public.case_paper_filled(pg_temp.got('qatar', 'case_id')::uuid, pg_temp.got('qatar', 'person_id')::uuid, 'contra [[RE]].')
  || ' ' ||
  public.case_paper_filled(pg_temp.got('tap', 'case_id')::uuid, pg_temp.got('tap', 'person_id')::uuid, 'contra [[RE]].'),
  'contra Qatar Airways Group (Q.C.S.C.), CNPJ nº 08.734.301/0001-50. contra Transportes Aéreos Portugueses S.A., CNPJ nº 33.136.896/0001-90.',
  'the papers of each firm name the company that answers in Brazil for its case''s foreign airline'
);

select * from finish();
rollback;
