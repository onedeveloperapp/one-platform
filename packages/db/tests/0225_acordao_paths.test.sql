begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- O acórdão e o que pode vir depois dele (0225). In Ana's firm the client
-- appealed a judgment of the small-claims court and the turma recursal
-- denied it: ONE records the acórdão against the client, asks the lawyers'
-- awareness, proposes the embargos and the recurso extraordinário from its
-- publication, and offers the reclamação, never a recurso inominado; the
-- client's link keeps asking about the judgment alone; accepting the
-- acórdão takes back what ONE proposed of it. In the other firm the airline
-- appealed a judgment of the civil court and lost: the acórdão is in the
-- client's favour, offers the recurso especial and never the reclamação, and
-- a person records an acórdão by hand. Nothing of one firm reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2250000-0000-4000-8000-000000000001', 'ana@souza-acordao.invalid', 'Ana Souza'),
  ('a2250000-0000-4000-8000-000000000002', 'caio@rocha-acordao.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2250000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-acordao', 'a2250000-0000-4000-8000-000000000001'),
  ('b2250000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-acordao', 'a2250000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2250000-0000-4000-8000-00000000000a', 'a2250000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2250000-0000-4000-8000-00000000000b', 'a2250000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2250000-0000-4000-8000-000000000001', 'b2250000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2250000-0000-4000-8000-000000000002', 'b2250000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2250000-0000-4000-8000-000000000001', 'b2250000-0000-4000-8000-00000000000a', 'c2250000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2025-08-01'),
  ('f2250000-0000-4000-8000-000000000002', 'b2250000-0000-4000-8000-00000000000b', 'c2250000-0000-4000-8000-000000000002',
   'comum', 'TJGO', 'filed', '00051016820998090051', '2025-08-01');
-- Each lawsuit's judgment. In firm A the client appealed it; in firm B the airline did.
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b2250000-0000-4000-8000-00000000000a', 'c2250000-0000-4000-8000-000000000001', 'f2250000-0000-4000-8000-000000000001',
   'sentenca', 'parcial', 200000, current_date - 90, 'person'),
  ('b2250000-0000-4000-8000-00000000000b', 'c2250000-0000-4000-8000-000000000002', 'f2250000-0000-4000-8000-000000000002',
   'sentenca', 'procedente', 500000, current_date - 90, 'person');
update public.judgment_paths set decision = 'recurso_inominado', decided_at = now()
where proceeding_id = 'f2250000-0000-4000-8000-000000000001';
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, appeal_by, happened_on, source) values
  ('b2250000-0000-4000-8000-00000000000b', 'c2250000-0000-4000-8000-000000000002', 'f2250000-0000-4000-8000-000000000002',
   'recurso', 're', current_date - 80, 'person');
insert into public.people (id, org_id, full_name, birth_date) values
  ('d2250000-0000-4000-8000-000000000001', 'b2250000-0000-4000-8000-00000000000a', 'Rui Teste', '1980-01-01');
insert into public.case_parties (org_id, case_id, person_id, role) values
  ('b2250000-0000-4000-8000-00000000000a', 'c2250000-0000-4000-8000-000000000001', 'd2250000-0000-4000-8000-000000000001',
   'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a7225000-0000-4000-8000-000000000001', 'b2250000-0000-4000-8000-00000000000a', 'c2250000-0000-4000-8000-000000000001',
   'd2250000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-acordao', 'UTF8')), 'hex'),
   now() + interval '30 days');
-- The acórdão of each appeal, published yesterday.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, proceeding_id, case_id,
                                 category, triaged_at) values
  ('ce225000-0000-4000-8000-0000000000a1', 'b2250000-0000-4000-8000-00000000000a', 'acordaoone0000a1', 'TJGO',
   '10003012720998090100', current_date - 1, 'Intimação', 'Acórdão',
   'ACÓRDÃO. ACORDAM os integrantes da 1ª Turma Recursal, por unanimidade, em conhecer do recurso e negar-lhe provimento.',
   'f2250000-0000-4000-8000-000000000001', 'c2250000-0000-4000-8000-000000000001', 'decisao', now()),
  ('ce225000-0000-4000-8000-0000000000b1', 'b2250000-0000-4000-8000-00000000000b', 'acordaoone0000b1', 'TJGO',
   '00051016820998090051', current_date - 1, 'Intimação', 'Acórdão',
   'ACÓRDÃO. ACORDAM os desembargadores da 3ª Câmara Cível em negar provimento ao recurso.',
   'f2250000-0000-4000-8000-000000000002', 'c2250000-0000-4000-8000-000000000002', 'decisao', now());

create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

-- ---------- ONE reads the acórdãos ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('a-read', public.record_publication_outcome('ce225000-0000-4000-8000-0000000000a1',
  '{"kind": "acordao", "appeal_result": "desprovido", "words": "conhecer do recurso e negar-lhe provimento"}'));
insert into res values ('b-read', public.record_publication_outcome('ce225000-0000-4000-8000-0000000000b1',
  '{"kind": "acordao", "appeal_result": "desprovido", "words": "negar provimento ao recurso"}'));
reset role;

select ok(
  (select kind = 'acordao' and result = 'improcedente' and appeal_result = 'desprovido' and ack_owed and rule = 'acordao-v1'
   from public.lawsuit_facts where publication_id = 'ce225000-0000-4000-8000-0000000000a1')
    and (select result = 'procedente' and not ack_owed
         from public.lawsuit_facts where publication_id = 'ce225000-0000-4000-8000-0000000000b1'),
  'the client''s appeal denied is against them and asks the lawyers'' awareness; the airline''s denied is in their favour'
);

select ok(
  (select array_agg(act order by act) = array['embargos_declaracao', 'recurso_extraordinario']
   from public.deadlines where publication_id = 'ce225000-0000-4000-8000-0000000000a1' and proposed_auto)
    and (select array_agg(act order by act) = array['embargos_declaracao', 'recurso_especial', 'recurso_extraordinario']
         from public.deadlines where publication_id = 'ce225000-0000-4000-8000-0000000000b1' and proposed_auto),
  'ONE proposes the embargos and the recurso extraordinário from the acórdão, and the recurso especial in the civil court'
);

select ok(
  (select stage = 'acordao' from public.judgment_paths jp
   join public.lawsuit_facts f on f.id = jp.fact_id where f.publication_id = 'ce225000-0000-4000-8000-0000000000a1')
    and public.judgment_path_options('juizado', 'acordao')
        = array['aceitar', 'embargos_declaracao', 'recurso_extraordinario', 'reclamacao']
    and not ('reclamacao' = any (public.judgment_path_options('comum', 'acordao'))),
  'each acórdão has its options: the reclamação in the small-claims court, never in the civil court'
);

-- ---------- The lawyers decide ----------

select pg_temp.sign_in('a2250000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a-wrong', public.decide_judgment_path((select jp.id from public.judgment_paths jp
  join public.lawsuit_facts f on f.id = jp.fact_id where f.publication_id = 'ce225000-0000-4000-8000-0000000000a1'),
  'recurso_inominado', null));
insert into res values ('a-reclamacao', public.decide_judgment_path((select jp.id from public.judgment_paths jp
  join public.lawsuit_facts f on f.id = jp.fact_id where f.publication_id = 'ce225000-0000-4000-8000-0000000000a1'),
  'reclamacao', 'O acórdão contraria a Súmula do STJ sobre o dano moral.'));
reset role;
set local role anon;
insert into res values ('link', public.client_link_judgment_paths('token-do-acordao'));
reset role;
select ok(
  (select value ->> 'code' = 'invalid_decision' from res where key = 'a-wrong')
    and (select value ->> 'code' = 'decided' from res where key = 'a-reclamacao')
    and (select decision = 'reclamacao' from public.judgment_paths jp join public.lawsuit_facts f on f.id = jp.fact_id
         where f.publication_id = 'ce225000-0000-4000-8000-0000000000a1'),
  'after the acórdão a lawyer decides the reclamação, never a recurso inominado'
);
select ok(
  (select jsonb_array_length(value -> 'items') = 1 from res where key = 'link'),
  'the client''s link asks about the judgment alone, never about the acórdão'
);

-- The id of firm A's path, read before anybody of firm B signs in (who cannot even see it).
insert into res select 'a-path', to_jsonb(jp.id::text) from public.judgment_paths jp
  join public.lawsuit_facts f on f.id = jp.fact_id where f.publication_id = 'ce225000-0000-4000-8000-0000000000a1';
select pg_temp.sign_in('a2250000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b-accept', public.decide_judgment_path((select jp.id from public.judgment_paths jp
  join public.lawsuit_facts f on f.id = jp.fact_id where f.publication_id = 'ce225000-0000-4000-8000-0000000000b1'),
  'aceitar', null));
select throws_ok(
  $$ select public.decide_judgment_path((select (value #>> '{}')::uuid from res where key = 'a-path'), 'aceitar', null) $$,
  'P0002', null,
  'another firm decides nothing of the acórdão'
);
reset role;
select ok(
  (select value ->> 'code' = 'decided' from res where key = 'b-accept')
    and (select bool_and(status = 'dismissed' and dismiss_reason = 'O escritório decidiu aceitar o acórdão.')
         from public.deadlines where publication_id = 'ce225000-0000-4000-8000-0000000000b1')
    and (select bool_and(status = 'proposed') from public.deadlines
         where publication_id = 'ce225000-0000-4000-8000-0000000000a1'),
  'accepting the acórdão takes back what ONE proposed of it, and only of that firm'
);

-- ---------- A person records one by hand ----------

select pg_temp.sign_in('a2250000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b-hand', public.save_lawsuit_fact('f2250000-0000-4000-8000-000000000002',
  jsonb_build_object('kind', 'acordao', 'result', 'procedente', 'happened_on', (current_date - 2)::text)));
insert into res values ('b-hand-bad', public.save_lawsuit_fact('f2250000-0000-4000-8000-000000000002',
  jsonb_build_object('kind', 'acordao', 'happened_on', (current_date - 2)::text)));
reset role;
select ok(
  (select value ->> 'ok' = 'true' from res where key = 'b-hand')
    and (select value ->> 'code' = 'invalid_data' from res where key = 'b-hand-bad')
    and (select kind = 'acordao' and result = 'procedente' and source = 'person' from public.lawsuit_facts
         where id = (select (value ->> 'fact_id')::uuid from res where key = 'b-hand')),
  'a person records an acórdão by hand, saying what it is to the client'
);

select * from finish();
rollback;
