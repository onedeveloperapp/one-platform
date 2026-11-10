begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- A tela Pessoas e os segmentos (0134). In Lima, Ana is a partner, Bia runs
-- the controladoria and Davi the attendance. Maria (from an agency, a case
-- going) and Pedro (referred, his case ended with a judgment for him) are
-- adults; João is Maria's son, a minor; Lia asked for no marketing; Rui's only
-- case is a test. The numbers count them; a segment exists only after Ana
-- accepted the term with the second factor; it never holds a minor, Lia or
-- Rui; Bia exports it with the second factor, on the record. Rocha reads
-- nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1330000-0000-4000-8000-000000000001', 'ana@lima-segmentos.invalid', 'Ana Lima'),
  ('a1330000-0000-4000-8000-000000000002', 'bia@lima-segmentos.invalid', 'Bia Lima'),
  ('a1330000-0000-4000-8000-000000000003', 'davi@lima-segmentos.invalid', 'Davi Lima'),
  ('a1330000-0000-4000-8000-000000000009', 'edu@rocha-segmentos.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1330000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-segmentos', 'a1330000-0000-4000-8000-000000000001'),
  ('b1330000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-segmentos', 'a1330000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1330000-0000-4000-8000-00000000000a', 'a1330000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1330000-0000-4000-8000-00000000000a', 'a1330000-0000-4000-8000-000000000002', 'member', 'controladoria'),
  ('b1330000-0000-4000-8000-00000000000a', 'a1330000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b1330000-0000-4000-8000-00000000000b', 'a1330000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.people (id, org_id, full_name, birth_date, phone, email, city, uf, profession, marketing_off_at, marketing_off_how) values
  ('d1330000-0000-4000-8000-000000000001', 'b1330000-0000-4000-8000-00000000000a', 'Maria Teste', '1990-03-10', '5562999990001',
   'maria@teste.invalid', 'Goiânia', 'GO', 'Professora', null, null),
  ('d1330000-0000-4000-8000-000000000002', 'b1330000-0000-4000-8000-00000000000a', 'João Teste', '2018-05-01', null, null,
   'Goiânia', 'GO', null, null, null),
  ('d1330000-0000-4000-8000-000000000003', 'b1330000-0000-4000-8000-00000000000a', 'Pedro Teste', '1960-01-20', '556288887777',
   'pedro@teste.invalid', 'Anápolis', 'GO', 'Engenheiro', null, null),
  ('d1330000-0000-4000-8000-000000000004', 'b1330000-0000-4000-8000-00000000000a', 'Lia Teste', '1995-07-07', '5562977776666',
   'lia@teste.invalid', 'Goiânia', 'GO', null, now(), 'telefone'),
  ('d1330000-0000-4000-8000-000000000005', 'b1330000-0000-4000-8000-00000000000a', 'Rui Teste', '1980-02-02', '5562966665555',
   'rui@teste.invalid', 'Goiânia', 'GO', null, null, null);
insert into public.cases (id, org_id, seq, module, incident, status, origin, airline_iata, is_test) values
  ('c1330000-0000-4000-8000-000000000001', 'b1330000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake', 'agency', 'LA', false),
  ('c1330000-0000-4000-8000-000000000002', 'b1330000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'cancellation', 'filed', 'referral', 'G3', false),
  ('c1330000-0000-4000-8000-000000000004', 'b1330000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'delay', 'intake', 'agency', 'LA', false),
  ('c1330000-0000-4000-8000-000000000005', 'b1330000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay', 'intake', 'agency', 'LA', true);
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1330000-0000-4000-8000-000000000001', 'b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000001',
   'd1330000-0000-4000-8000-000000000001', 'claimant'),
  ('e1330000-0000-4000-8000-000000000003', 'b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000002',
   'd1330000-0000-4000-8000-000000000003', 'claimant'),
  ('e1330000-0000-4000-8000-000000000004', 'b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000004',
   'd1330000-0000-4000-8000-000000000004', 'claimant'),
  ('e1330000-0000-4000-8000-000000000005', 'b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000005',
   'd1330000-0000-4000-8000-000000000005', 'claimant');
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e1330000-0000-4000-8000-000000000002', 'b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000001',
   'd1330000-0000-4000-8000-000000000002', 'claimant', 'e1330000-0000-4000-8000-000000000001');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1330000-0000-4000-8000-000000000002', 'b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, happened_on, source) values
  ('b1330000-0000-4000-8000-00000000000a', 'c1330000-0000-4000-8000-000000000002', 'f1330000-0000-4000-8000-000000000002',
   'sentenca', 'procedente', current_date - 10, 'person');
update public.cases set status = 'closed', closed_at = now() where id = 'c1330000-0000-4000-8000-000000000002';

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

-- ---------- The numbers ----------

select pg_temp.as_person('a1330000-0000-4000-8000-000000000003', 'numbers',
  $$public.firm_people_numbers('b1330000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('numbers', '{registered}') = '5' and pg_temp.got('numbers', '{active}') = '3'
    and pg_temp.got('numbers', '{origins,agency}') = '3' and pg_temp.got('numbers', '{origins,referral}') = '1'
    and pg_temp.got('numbers', '{ages,minor}') = '1' and pg_temp.got('numbers', '{ages,60}') = '1'
    and pg_temp.got('numbers', '{outcomes,0,key}') = 'procedente' and pg_temp.got('numbers', '{marketing_off}') = '1',
  'anybody of the firm reads its numbers: who has a case going, by origin, age and outcome, the test cases out'
);

select pg_temp.as_person('a1330000-0000-4000-8000-000000000003', 'list',
  $$public.firm_people('b1330000-0000-4000-8000-00000000000a', 'sem-caso-ativo', null)$$);
select ok(
  pg_temp.got('list', '{counts,todos}') = '5' and pg_temp.got('list', '{total}') = '2'
    and pg_temp.got('list', '{rows,0,name}') = 'Pedro Teste',
  'the list of people has its views, each counted'
);

-- ---------- The term ----------

select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'segment-before',
  $$public.save_marketing_segment('b1330000-0000-4000-8000-00000000000a', null, 'Agência', '{"origins": ["agency"]}')$$);
select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'term-bia',
  $$public.accept_marketing_term('b1330000-0000-4000-8000-00000000000a', 'termo-marketing-v1')$$);
select pg_temp.as_person('a1330000-0000-4000-8000-000000000001', 'term-aal1',
  $$public.accept_marketing_term('b1330000-0000-4000-8000-00000000000a', 'termo-marketing-v1')$$, 'aal1');
select pg_temp.as_person('a1330000-0000-4000-8000-000000000001', 'term',
  $$public.accept_marketing_term('b1330000-0000-4000-8000-00000000000a', 'termo-marketing-v1')$$);
select ok(
  pg_temp.got('segment-before', '{code}') = 'term_missing' and pg_temp.got('term-bia', '{code}') = 'not_allowed'
    and pg_temp.got('term-aal1', '{code}') = 'second_factor' and pg_temp.got('term', '{ok}') = 'true'
    and (select text like 'O escritório declara%' from public.firm_marketing_terms where org_id = 'b1330000-0000-4000-8000-00000000000a'),
  'no segment before a partner accepts the term with the second factor; the words are kept as accepted'
);

-- ---------- The segments ----------

select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'segment',
  $$public.save_marketing_segment('b1330000-0000-4000-8000-00000000000a', null, 'Agência', '{"origins": ["agency"]}')$$);
select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'all-count',
  $$public.segment_count('b1330000-0000-4000-8000-00000000000a', '{}')$$);
select pg_temp.as_person('a1330000-0000-4000-8000-000000000003', 'davi-count',
  $$public.segment_count('b1330000-0000-4000-8000-00000000000a', '{}')$$);
select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'bad-filter',
  $$public.segment_count('b1330000-0000-4000-8000-00000000000a', '{"telefone": ["x"]}')$$);
select ok(
  pg_temp.got('segment', '{ok}') = 'true'
    and pg_temp.got('all-count', '{count}') = '2' and pg_temp.got('davi-count', '{code}') = 'not_allowed'
    and pg_temp.got('bad-filter', '{code}') = 'invalid_data',
  'a segment holds only adults with a case, never a minor, who asked for no marketing, nor a test case'
);

select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'export-aal1',
  format($$public.export_marketing_segment(%L, array['nome', 'email', 'cpf'])$$, pg_temp.got('segment', '{segment_id}')), 'aal1');
select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'export',
  format($$public.export_marketing_segment(%L, array['nome', 'email', 'cpf'])$$, pg_temp.got('segment', '{segment_id}')));
select ok(
  pg_temp.got('export-aal1', '{code}') = 'second_factor'
    and pg_temp.got('export', '{columns}') = '["nome", "email"]'
    and pg_temp.got('export', '{rows}') = '[{"nome": "Maria Teste", "email": "maria@teste.invalid"}]'
    and exists (select 1 from public.audit_events where action = 'marketing.segment_exported'
                and (metadata ->> 'people')::integer = 1),
  'an export asks the second factor, carries only the columns chosen among the allowed ones, and is on the record'
);

select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'archive',
  format($$public.archive_marketing_segment(%L, 'Campanha encerrada.')$$, pg_temp.got('segment', '{segment_id}')));
select pg_temp.as_person('a1330000-0000-4000-8000-000000000002', 'segments',
  $$public.firm_segments('b1330000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('archive', '{ok}') = 'true' and pg_temp.got('segments', '{0,archive_reason}') = 'Campanha encerrada.'
    and pg_temp.got('segments', '{0,count}') = '1',
  'a segment is archived with its reason and stays listed'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('a1330000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::integer from public.marketing_segments) + (select count(*)::integer from public.firm_marketing_terms), 0,
  'nobody of another firm reads its segments nor its term');
reset role;

select * from finish();
rollback;
