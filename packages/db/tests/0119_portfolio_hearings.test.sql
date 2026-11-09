begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The portfolio takes the hearings (0118): each hearing of the firm's lawsuits,
-- marked, held or cancelled, on the clock of the zone it is said in, with how,
-- where, who goes and what came of it; counted and put on the record with the
-- other sheets; the test cases leave with theirs; nothing of another firm. Two
-- firms: Lima with hearings of a real case and of a test case, Rocha with one
-- of its own.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1190000-0000-4000-8000-000000000001', 'ana@lima-audiencias.invalid', 'Ana Lima'),
  ('a1190000-0000-4000-8000-000000000002', 'caio@lima-audiencias.invalid', 'Caio Lima'),
  ('a1190000-0000-4000-8000-000000000003', 'duda@rocha-audiencias.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1190000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-audiencias', 'a1190000-0000-4000-8000-000000000001'),
  ('b1190000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-audiencias', 'a1190000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1190000-0000-4000-8000-00000000000a', 'a1190000-0000-4000-8000-000000000001', 'member', 'socio'),
  ('b1190000-0000-4000-8000-00000000000a', 'a1190000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1190000-0000-4000-8000-00000000000b', 'a1190000-0000-4000-8000-000000000003', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1190000-0000-4000-8000-000000000001', 'b1190000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1190000-0000-4000-8000-000000000002', 'b1190000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1190000-0000-4000-8000-000000000003', 'b1190000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
update public.cases set is_test = true where id = 'c1190000-0000-4000-8000-000000000002';
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1190000-0000-4000-8000-000000000001', 'b1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '00051016820998090051', '2026-10-01'),
  ('f1190000-0000-4000-8000-000000000002', 'b1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000000002',
   'juizado', 'TJAM', 'filed', '00051024720998040001', '2026-10-01'),
  ('f1190000-0000-4000-8000-000000000003', 'b1190000-0000-4000-8000-00000000000b', 'c1190000-0000-4000-8000-000000000003',
   'juizado', 'TJGO', 'filed', '00051033820998090051', '2026-10-01');

-- Lima's real case: an instruction already held, with a correspondent, and a conciliation to come by video, which ONE
-- registered. Its test case: a conciliation in Manaus, cancelled. Rocha: one of its own.
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, place, link,
                             attendee_user_id, attendee_name, notes, status, outcome, outcome_note, created_auto) values
  ('a4190000-0000-4000-8000-000000000001', 'b1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000000001',
   'f1190000-0000-4000-8000-000000000001', 'instrucao', '2026-10-15 13:00+00', 'America/Sao_Paulo', 'presencial',
   'Fórum de Goiânia, sala 4', null, null, 'Paula Correspondente', null, 'held', 'sem_acordo', 'A ré não propôs acordo.', false),
  ('a4190000-0000-4000-8000-000000000002', 'b1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000000001',
   'f1190000-0000-4000-8000-000000000001', 'conciliacao', '2026-11-20 17:00+00', 'America/Sao_Paulo', 'videoconferencia',
   null, 'https://videoconferencia.teste.invalid/sala-1', 'a1190000-0000-4000-8000-000000000002', null,
   'Levar o bilhete impresso.', 'scheduled', null, null, true),
  ('a4190000-0000-4000-8000-000000000003', 'b1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000000002',
   'f1190000-0000-4000-8000-000000000002', 'conciliacao', '2026-11-25 13:00+00', 'America/Manaus', 'presencial',
   'Fórum de Manaus', null, null, null, null, 'cancelled', null, 'Remarcada pelo juízo.', false),
  ('a4190000-0000-4000-8000-000000000004', 'b1190000-0000-4000-8000-00000000000b', 'c1190000-0000-4000-8000-000000000003',
   'f1190000-0000-4000-8000-000000000003', 'una', '2026-11-30 12:00+00', 'America/Sao_Paulo', 'presencial',
   'Fórum de Anápolis', null, null, null, null, 'scheduled', null, null, false);

create function pg_temp.sign_in(person uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;

create function pg_temp.got(which text, path text[])
returns text language sql as $$
  select value #>> path from res where key = which;
$$;

select pg_temp.sign_in('a1190000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('begun', public.begin_portfolio_export('b1190000-0000-4000-8000-00000000000a'));
insert into res values ('all', public.firm_portfolio_page('b1190000-0000-4000-8000-00000000000a', 'audiencias'));
insert into res values ('real', public.firm_portfolio_page('b1190000-0000-4000-8000-00000000000a', 'audiencias', 0, false));
reset role;

select is(
  pg_temp.got('begun', '{counts,audiencias}'),
  '3',
  'the hearings are counted with the other sheets, every state of them'
);
select is(
  (select metadata #>> '{sheets,audiencias}' from public.audit_events
   where action = 'portfolio.exported' and org_id = 'b1190000-0000-4000-8000-00000000000a'),
  '3',
  'and the record keeps how many went'
);
select ok(
  pg_temp.got('all', '{rows,0,seq}') = '1' and pg_temp.got('all', '{rows,0,kind}') = 'instrucao'
    and pg_temp.got('all', '{rows,0,status}') = 'held' and pg_temp.got('all', '{rows,0,outcome}') = 'sem_acordo'
    and pg_temp.got('all', '{rows,0,outcome_note}') = 'A ré não propôs acordo.'
    and pg_temp.got('all', '{rows,0,place}') = 'Fórum de Goiânia, sala 4'
    and pg_temp.got('all', '{rows,0,attendee}') = 'Paula Correspondente',
  'a hearing held comes with what came of it, its place and who went from outside the firm, the earliest first'
);
select ok(
  pg_temp.got('all', '{rows,1,starts_at}') = '2026-11-20 14:00' and pg_temp.got('all', '{rows,1,time_zone}') = 'America/Sao_Paulo'
    and pg_temp.got('all', '{rows,1,mode}') = 'videoconferencia'
    and pg_temp.got('all', '{rows,1,link}') = 'https://videoconferencia.teste.invalid/sala-1'
    and pg_temp.got('all', '{rows,1,attendee}') = 'Caio Lima' and pg_temp.got('all', '{rows,1,created_auto}') = 'true'
    and pg_temp.got('all', '{rows,1,cnj}') = '00051016820998090051' and pg_temp.got('all', '{rows,1,court}') = 'TJGO'
    and pg_temp.got('all', '{rows,1,notes}') = 'Levar o bilhete impresso.',
  'one to come comes on Brasília''s clock with its link, who of the firm goes, its lawsuit and that ONE registered it'
);
select ok(
  pg_temp.got('all', '{rows,2,seq}') = '2' and pg_temp.got('all', '{rows,2,starts_at}') = '2026-11-25 09:00'
    and pg_temp.got('all', '{rows,2,time_zone}') = 'America/Manaus' and pg_temp.got('all', '{rows,2,status}') = 'cancelled'
    and pg_temp.got('all', '{rows,2,outcome_note}') = 'Remarcada pelo juízo.',
  'one said in another zone comes on that zone''s clock, a cancelled one with why'
);
select ok(
  (select jsonb_array_length(value -> 'rows') from res where key = 'real') = 2
    and (select public.portfolio_counts('b1190000-0000-4000-8000-00000000000a', false) ->> 'audiencias') = '2'
    and not exists (select 1 from res, jsonb_array_elements(value -> 'rows') r where key = 'real' and r ->> 'seq' = '2'),
  'with the test cases left out, their hearings leave too'
);
select is(
  (select count(*)::int from res, jsonb_array_elements(value -> 'rows') r
   where key = 'all' and (r ->> 'place' = 'Fórum de Anápolis' or r ->> 'cnj' = '00051033820998090051')),
  0,
  'nothing of another firm''s hearings'
);

select pg_temp.sign_in('a1190000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('rocha-begun', public.begin_portfolio_export('b1190000-0000-4000-8000-00000000000b'));
insert into res values ('rocha', public.firm_portfolio_page('b1190000-0000-4000-8000-00000000000b', 'audiencias'));
reset role;
select ok(
  (select jsonb_array_length(value -> 'rows') from res where key = 'rocha') = 1
    and pg_temp.got('rocha', '{rows,0,kind}') = 'una' and pg_temp.got('rocha', '{rows,0,starts_at}') = '2026-11-30 09:00',
  'and the other firm reads its own alone'
);

select * from finish();
rollback;
