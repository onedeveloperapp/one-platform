begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- The forecast by the place of the case (0310): a decision's comarca as each
-- court writes its units, the kind of lawsuit it judges and its place inside
-- the comarca; the first claimant's neighbourhood read as the filing reads it
-- (the same examples as `forumOfDistrict`'s test); a juizado's forecast by
-- the place of the client's neighbourhood, never with the civil courts'
-- decisions; a civil court's by its own; each level beside it. Two firms:
-- each reads its own lawsuits only.
--
-- Every person, unit name of a fixture and decision here is invented; the
-- unit names of the first assertions are as the DJEN writes them.
-- ============================================================

select is(
  (select array_agg(public.market_comarca_of(v.unit, v.court) order by v.i)
   from (values
     (1, 'Goiânia - 2ª UPJ Juizados Especiais Cíveis: 6º, 7º, 8º, 9º, 10º e 11º', 'TJGO'),
     (2, 'Vila Velha - Comarca da Capital - 4º Juizado Especial Cível', 'TJES'),
     (3, '6º Juizado Especial Cível da Comarca da Capital Lagoa', 'TJRJ'),
     (4, '3º Juizado Especial Cível da Regional da Barra da Tijuca', 'TJRJ'),
     (5, 'Juizado Especial Cível da Comarca de Maricá', 'TJRJ'),
     (6, 'Juizado Especial Cível da Região Oceânica', 'TJRJ'),
     (7, 'UPJ da 1ª a 6ª Varas Cíveis - Regional III - Jabaquara', 'TJSP'),
     (8, '1ª Vara do Juizado Especial Cível - JEC Central - Vergueiro', 'TJSP'),
     (9, 'Foro de Barueri - 1ª Vara do Juizado Especial Cível e Criminal', 'TJSP'),
     (10, 'Ofício Único da 1ª e 2ª Vara do JEC de São José do Rio Preto', 'TJSP'),
     (11, 'UPJ da 1ª a 3ª Varas do Juizado Especial Cível da Comarca de Campinas', 'TJSP'),
     (12, '2ª Unidade Jurisdicional Cível - 5º JD da Comarca de Belo Horizonte', 'TJMG'),
     (13, '1ª Vara Descentralizada de Santa Felicidade - Juizado Especial Cível de Curitiba', 'TJPR'),
     (14, 'Juizado Especial Cível de Curitiba - PUC-Cajuru', 'TJPR'),
     (15, '4º Juizado Especial Cível de Maringá', 'TJPR'),
     (16, '1º Juizado Especial Cível e Criminal do Foro Regional do Sarandi da Comarca de Porto Alegre', 'TJRS'),
     (17, 'JECC Teresina Norte 2 Anexo I Santa Maria da Codipi', 'TJPI'),
     (18, '6º Juizado Especial Cível da Capital', 'TJPB'),
     (19, '1ª Vara Regional Cível de Mangabeira', 'TJPB'),
     (20, 'Juizado Especial Cível do Guará', 'TJDFT'),
     (21, '8º Juizado Especial Cível e das Relações de Consumo de São Luís', 'TJMA'),
     (22, '1º Juizado Especial Cível e Criminal do Termo Judiciário de São José de Ribamar', 'TJMA'),
     (23, 'Juizado Especial Cível e Criminal de Paço do Lumiar', 'TJMA'),
     (24, 'Divisão de Tramitação Remota dos Juizados Especiais Cíveis', 'TJSC'),
     (25, '2ª Vara de São Mateus', 'TJMA'),
     (26, '2º Juizado Especial Cível da Regional de Alcântara', 'TJRJ'),
     (27, 'Juizado Especial Cível da Regional de Vila Inhomirim', 'TJRJ'),
     (28, '1ª Unidade Jurisdicional - JESP - 1º JD Contagem', 'TJMG'),
     (29, 'Juízo Auxiliar da Comarca de Teresina 06', 'TJPI')
   ) as v (i, unit, court)),
  array['Goiânia', 'Vila Velha', 'Rio de Janeiro', 'Rio de Janeiro', 'Maricá', 'Niterói', 'São Paulo', 'São Paulo',
        'Barueri', 'São José do Rio Preto', 'Campinas', 'Belo Horizonte', 'Curitiba', 'Curitiba', 'Maringá',
        'Porto Alegre', 'Teresina', 'João Pessoa', 'João Pessoa', 'Guará', 'São Luís', 'São José de Ribamar',
        'Paço do Lumiar', null, 'São Mateus', 'São Gonçalo', 'Magé', 'Contagem', 'Teresina'],
  'a decision''s comarca as each court writes its units'
);

select is(
  (select array_agg(coalesce(public.market_kind_of(v.unit), '-') order by v.i)
   from (values
     (1, 'Goiânia - 2ª UPJ Juizados Especiais Cíveis: 6º, 7º, 8º, 9º, 10º e 11º'),
     (2, '1ª Vara do Juizado Especial Cível - JEC Central - Vergueiro'),
     (3, 'UPJ da 1ª a 6ª Varas Cíveis - Regional III - Jabaquara'),
     (4, '2ª Unidade Jurisdicional Cível - 5º JD da Comarca de Belo Horizonte'),
     (5, 'JECC Pedro II Sede'),
     (6, '3ª Vara Cível da Comarca da Capital'),
     (7, '2ª Vara Mista de Ingá'),
     (8, '6ª Vara de Família da Comarca da Capital'),
     (9, 'CAPITAL CONSELHO RECURSAL DOS JECs E JECRIMs'),
     (10, '1ª Turma Recursal dos Juizados Especiais Cíveis')
   ) as v (i, unit)),
  array['juizado', 'juizado', 'comum', 'juizado', 'juizado', 'comum', 'comum', '-', '-', '-'],
  'the kind a unit judges: a juizado, a civil court, or neither (a family court, a court of appeal)'
);

select is(
  (select array_agg(coalesce(public.market_place_of(v.unit, v.court), '-') order by v.i)
   from (values
     (1, '6º Juizado Especial Cível da Comarca da Capital Lagoa', 'TJRJ'),
     (2, '2º Juizado Especial Cível da Comarca da Capital', 'TJRJ'),
     (3, '3º Juizado Especial Cível da Regional da Barra da Tijuca', 'TJRJ'),
     (4, 'Juizado Especial Cível da Comarca de Maricá', 'TJRJ'),
     (5, '1ª Vara do Juizado Especial Cível - Regional III - Jabaquara', 'TJSP'),
     (6, '25º Juizado Especial Cível da Regional da Pavuna- Cartório do 25º Juizado Especial Cível', 'TJRJ'),
     (7, 'Comarca da Capital Cartório da 41ª Vara Cível', 'TJRJ')
   ) as v (i, unit, court)),
  array['Lagoa', 'Central', 'Regional da Barra da Tijuca', '-', '-', 'Regional da Pavuna', 'Central'],
  'the place inside the comarca, where the court lists its places by neighbourhood'
);

select ok(
  public.market_place_key('Regional de Pavuna') = public.market_place_key('Regional da Pavuna')
  and public.district_key('JD. BOTANICO') = 'jardim botanico'
  and public.district_key('Sta. Teresa') = 'santa teresa'
  and public.district_key('S. Cristóvão') = 'sao cristovao'
  and public.district_key('Pq. Anchieta') = 'parque anchieta'
  and public.district_key('N. Sra. das Graças') = 'nossa senhora das gracas'
  and public.district_key('Ilha do Gov.') = 'ilha do governador',
  'a neighbourhood is compared as the filing compares it, its short first word spelled out'
);

-- ---------- Two firms ----------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3100000-0000-4000-8000-000000000001', 'bia@lagoa-previsao.invalid', 'Bia Lagoa'),
  ('a3100000-0000-4000-8000-000000000002', 'davi@vara-previsao.invalid', 'Davi Vara')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3100000-0000-4000-8000-00000000000a', 'Lagoa Advocacia', 'lagoa-previsao', 'a3100000-0000-4000-8000-000000000001'),
  ('b3100000-0000-4000-8000-00000000000b', 'Vara Advogados', 'vara-previsao', 'a3100000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3100000-0000-4000-8000-00000000000a', 'a3100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b3100000-0000-4000-8000-00000000000b', 'a3100000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Firm A: a client of the Jardim Botânico ("JD. BOTANICO"), a juizado of the Capital, and two more neighbourhoods;
-- firm B: a civil court of the Capital.
insert into public.people (id, org_id, full_name, district, city) values
  ('c3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-00000000000a', 'Maria Exemplo', 'JD. BOTANICO', 'Rio de Janeiro'),
  ('c3100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-00000000000a', 'João Exemplo', 'Freguesia', 'Rio de Janeiro'),
  ('c3100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-00000000000a', 'Rita Exemplo', 'Sta. Teresa', 'Niterói'),
  ('c3100000-0000-4000-8000-000000000004', 'b3100000-0000-4000-8000-00000000000b', 'Paulo Exemplo', 'Tijuca', 'Rio de Janeiro');
insert into public.cases (id, org_id, seq, module, incident, status, airline_iata) values
  ('d3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'drafting', 'TP'),
  ('d3100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'cancellation', 'drafting', 'TP'),
  ('d3100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'cancellation', 'drafting', 'TP'),
  ('d3100000-0000-4000-8000-000000000004', 'b3100000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'cancellation', 'drafting', 'TP');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-00000000000a', 'd3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'claimant'),
  ('e3100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-00000000000a', 'd3100000-0000-4000-8000-000000000002', 'c3100000-0000-4000-8000-000000000002', 'claimant'),
  ('e3100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-00000000000a', 'd3100000-0000-4000-8000-000000000003', 'c3100000-0000-4000-8000-000000000003', 'claimant'),
  ('e3100000-0000-4000-8000-000000000004', 'b3100000-0000-4000-8000-00000000000b', 'd3100000-0000-4000-8000-000000000004', 'c3100000-0000-4000-8000-000000000004', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, comarca, unit, status) values
  ('f3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-00000000000a', 'd3100000-0000-4000-8000-000000000001',
   'juizado', 'TJRJ', 'Rio de Janeiro', null, 'planned'),
  ('f3100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-00000000000a', 'd3100000-0000-4000-8000-000000000002',
   'juizado', 'TJRJ', 'Rio de Janeiro', null, 'planned'),
  ('f3100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-00000000000a', 'd3100000-0000-4000-8000-000000000003',
   'juizado', 'TJRJ', 'Rio de Janeiro', null, 'planned'),
  ('f3100000-0000-4000-8000-000000000004', 'b3100000-0000-4000-8000-00000000000b', 'd3100000-0000-4000-8000-000000000004',
   'comum', 'TJRJ', 'Rio de Janeiro', null, 'planned');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001', 'b3100000-0000-4000-8000-00000000000a'),
  ('f3100000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-00000000000a'),
  ('f3100000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000003', 'b3100000-0000-4000-8000-00000000000a'),
  ('f3100000-0000-4000-8000-000000000004', 'e3100000-0000-4000-8000-000000000004', 'b3100000-0000-4000-8000-00000000000b');

select is(
  (select array_agg(coalesce(public.proceeding_place(p.id), '-') order by p.id)
   from public.proceedings p where p.id::text like 'f3100000%'),
  array['Lagoa', '-', '-', '-'],
  'the place of the first claimant''s neighbourhood where the comarca is their city; none for two places, another city or a civil court'
);

-- The market, invented, against an airline no capture reads (so the walks' data on a hosted database never joins it):
-- the Lagoa's juizado decides 32 cancellations (28 won in part with
-- R$ 5.000,00, 4 lost); a juizado of the Barra 10 (all lost); the civil courts of the Capital 40 (all won), which a
-- juizado's forecast never reads; a family court 5, which nobody's reads.
insert into public.market_decisions (key, source, court, unit, party, airline_iata, day, instance, result, moral_cents, problem, rule)
select 'lugar-a' || n, 'djen', 'TJRJ', '6º Juizado Especial Cível da Comarca da Capital Lagoa', 'TAP AIR PORTUGAL', 'TP',
       current_date - n, 'first', case when n <= 28 then 'parcial' else 'improcedente' end,
       case when n <= 28 then 500000 end, 'cancellation', 'mercado-v2'
from generate_series(1, 32) n;
insert into public.market_decisions (key, source, court, unit, party, airline_iata, day, instance, result, problem, rule)
select 'lugar-b' || n, 'djen', 'TJRJ', '3º Juizado Especial Cível da Regional da Barra da Tijuca', 'TAP AIR PORTUGAL', 'TP',
       current_date - n, 'first', 'improcedente', 'cancellation', 'mercado-v2'
from generate_series(1, 10) n;
insert into public.market_decisions (key, source, court, unit, party, airline_iata, day, instance, result, moral_cents, problem, rule)
select 'lugar-c' || n, 'djen', 'TJRJ', '3ª Vara Cível da Comarca da Capital', 'TAP AIR PORTUGAL', 'TP',
       current_date - n, 'first', 'procedente', 800000, 'cancellation', 'mercado-v2'
from generate_series(1, 40) n;
insert into public.market_decisions (key, source, court, unit, party, airline_iata, day, instance, result, problem, rule)
select 'lugar-d' || n, 'djen', 'TJRJ', '6ª Vara de Família da Comarca da Capital', 'TAP AIR PORTUGAL', 'TP',
       current_date - n, 'first', 'procedente', 'cancellation', 'mercado-v2'
from generate_series(1, 5) n;

select ok(
  (select kind = 'juizado' and comarca = 'Rio de Janeiro' and place = 'Lagoa' from public.market_decisions where key = 'lugar-a1')
  and (select kind = 'comum' and comarca = 'Rio de Janeiro' and place = 'Central' from public.market_decisions where key = 'lugar-c1')
  and (select kind is null from public.market_decisions where key = 'lugar-d1'),
  'a decision keeps the kind, the comarca and the place its unit says'
);

update public.market_decisions set unit = 'Juizado Especial Cível da Comarca de Maricá' where key = 'lugar-d5';
select ok(
  (select kind = 'juizado' and comarca = 'Maricá' and place is null from public.market_decisions where key = 'lugar-d5'),
  'and reads them again when its unit changes'
);
update public.market_decisions set unit = '6ª Vara de Família da Comarca da Capital' where key = 'lugar-d5';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

-- ---------- A member of each firm ----------
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a3100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('lagoa', public.case_forecast('f3100000-0000-4000-8000-000000000001'));
insert into res values ('freguesia', public.case_forecast('f3100000-0000-4000-8000-000000000002'));
insert into res values ('a_reads_b', jsonb_build_object('read', public.case_forecast('f3100000-0000-4000-8000-000000000004')));
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a3100000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('vara', public.case_forecast('f3100000-0000-4000-8000-000000000004'));
insert into res values ('b_reads_a', jsonb_build_object('read', public.case_forecast('f3100000-0000-4000-8000-000000000001')));
reset role;

select ok(
  pg_temp.got('lagoa', '{stage}') = 'before' and pg_temp.got('lagoa', '{place}') = 'Lagoa'
  and pg_temp.got('lagoa', '{kind}') = 'juizado'
  and pg_temp.got('lagoa', '{forecast,cut,level}') = 'place' and pg_temp.got('lagoa', '{forecast,cut,place}') = 'Lagoa'
  and pg_temp.got('lagoa', '{forecast,cut,kind}') = 'juizado' and pg_temp.got('lagoa', '{forecast,cut,airline}') = 'TP'
  and pg_temp.got('lagoa', '{forecast,merits}') = '32' and pg_temp.got('lagoa', '{forecast,chance_percent}') = '88'
  and pg_temp.got('lagoa', '{forecast,moral,median_cents}') = '500000',
  'a juizado''s lawsuit before distribution reads the place of the client''s neighbourhood, never the civil courts'
);

select ok(
  (select array_agg(x.v ->> 'level' order by x.i) = array['place', 'comarca', 'court']
   from res, jsonb_array_elements(payload -> 'levels') with ordinality as x (v, i) where name = 'lagoa')
  and (select (x ->> 'merits') = '42' and x -> 'cut' ->> 'kind' = 'juizado'
       from res, jsonb_array_elements(payload -> 'levels') x where name = 'lagoa' and x ->> 'level' = 'comarca'),
  'each level beside it, the comarca''s juizados with the Barra''s and the Lagoa''s: 42'
);

select ok(
  pg_temp.got('freguesia', '{place}') is null
  and pg_temp.got('freguesia', '{forecast,cut,level}') = 'comarca' and pg_temp.got('freguesia', '{forecast,merits}') = '42'
  and pg_temp.got('freguesia', '{forecast,chance_percent}') = '67',
  'a neighbourhood of two places reads the comarca''s juizados, nothing guessed'
);

select ok(
  pg_temp.got('vara', '{kind}') = 'comum' and pg_temp.got('vara', '{place}') is null
  and pg_temp.got('vara', '{forecast,cut,level}') = 'comarca' and pg_temp.got('vara', '{forecast,cut,kind}') = 'comum'
  and pg_temp.got('vara', '{forecast,merits}') = '40' and pg_temp.got('vara', '{forecast,chance_percent}') = '100'
  and pg_temp.got('a_reads_b', '{read}') is null and pg_temp.got('b_reads_a', '{read}') is null,
  'a civil court''s lawsuit reads the civil courts alone, not the family court; neither firm reads the other''s'
);

-- ---------- Distributed to the Lagoa's juizado ----------
update public.proceedings set status = 'filed', unit = '6º Juizado Especial Cível da Comarca da Capital Lagoa',
  cnj = '76543213820998190001', filed_at = current_date
where id = 'f3100000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a3100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('filed', public.case_forecast('f3100000-0000-4000-8000-000000000002'));
reset role;

select ok(
  pg_temp.got('filed', '{stage}') = 'distributed' and pg_temp.got('filed', '{place}') = 'Lagoa'
  and pg_temp.got('filed', '{forecast,cut,level}') = 'unit' and pg_temp.got('filed', '{forecast,merits}') = '32'
  and pg_temp.got('filed', '{hearing,level}') = 'unit' and pg_temp.got('filed', '{hearing,decisions}') = '32',
  'distributed, the lawsuit reads its unit and its place from the unit''s name, whatever the neighbourhood'
);

-- ---------- The backend ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('intake', public.market_forecast('cancellation', 'TP', 'TJRJ', '6º Juizado Especial Cível da Comarca da Capital Lagoa'));
reset role;

select ok(
  pg_temp.got('intake', '{cut,level}') = 'unit' and pg_temp.got('intake', '{cut,kind}') is null
  and pg_temp.got('intake', '{merits}') = '32',
  'the intake''s forecast keeps its signature and cuts no kind'
);

select ok(
  (select capital = 'Rio de Janeiro' from public.courts where acronym = 'TJRJ')
  and (select count(*) = 27 from public.courts where acronym like 'TJ%' and capital is not null),
  'each state''s court names its capital'
);

select ok(
  not exists (select 1 from pg_proc where proname = 'market_comarca_of' and pronargs = 1)
  and not exists (select 1 from pg_proc where proname = 'market_forecast_of' and pronargs = 8),
  'the comarca read by one court''s form and the forecast without the place and the kind are gone'
);

select ok(
  not has_function_privilege('authenticated', 'public.market_forecast_of(text, text, text, text, text, text, text, text, integer, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.proceeding_place(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.market_comarca_of(text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.district_key(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.market_decisions_where()', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.market_decisions', 'SELECT'),
  'the forecast''s inner workings stay the backend''s'
);

select * from finish();
rollback;
