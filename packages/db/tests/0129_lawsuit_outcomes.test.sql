begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- O resultado de cada ação (0130). Lima has a case in court with one lawsuit:
-- the backend records what ONE's rule read of its movements (a judgment, the
-- judgment become final, a release, the definitive archiving) and of the
-- judgment's words (its value per claimant), each once, as ONE's, the
-- lawyers asked to be aware of what changes the course; a person registers
-- what the release paid and ONE closes the case. A second case is corrected
-- and recorded by hand. Rocha keeps the result to a person: what ONE reads
-- there waits for a person's confirmation, and the case is not closed by
-- ONE. Who may write, the other firm, a support visit and the test court.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1290000-0000-4000-8000-000000000001', 'ana@lima-resultado.invalid', 'Ana Lima'),
  ('a1290000-0000-4000-8000-000000000002', 'bia@lima-resultado.invalid', 'Bia Lima'),
  ('a1290000-0000-4000-8000-000000000005', 'edu@rocha-resultado.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1290000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-resultado', 'a1290000-0000-4000-8000-000000000001'),
  ('b1290000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-resultado', 'a1290000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1290000-0000-4000-8000-00000000000a', 'a1290000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1290000-0000-4000-8000-00000000000a', 'a1290000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1290000-0000-4000-8000-00000000000b', 'a1290000-0000-4000-8000-000000000005', 'owner', 'socio');
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b1290000-0000-4000-8000-00000000000b', 'record_outcome', 'approval'),
  ('b1290000-0000-4000-8000-00000000000b', 'close_case', 'approval');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1290000-0000-4000-8000-000000000001', 'b1290000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1290000-0000-4000-8000-000000000002', 'b1290000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1290000-0000-4000-8000-000000000003', 'b1290000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1290000-0000-4000-8000-000000000001', 'b1290000-0000-4000-8000-00000000000a', 'c1290000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01'),
  ('f1290000-0000-4000-8000-000000000002', 'b1290000-0000-4000-8000-00000000000a', 'c1290000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003021220998090100', '2026-09-01'),
  ('f1290000-0000-4000-8000-000000000003', 'b1290000-0000-4000-8000-00000000000b', 'c1290000-0000-4000-8000-000000000003',
   'juizado', 'TJGO', 'filed', '10003039420998090100', '2026-09-01');

-- Movements the court gave, not read yet by ONE.
insert into public.movements (id, org_id, case_id, proceeding_id, source, source_id, occurred_at, title) values
  ('e1290000-0000-4000-8000-000000000001', 'b1290000-0000-4000-8000-00000000000a', 'c1290000-0000-4000-8000-000000000001',
   'f1290000-0000-4000-8000-000000000001', 'projudi', 'm1', now() - interval '20 days', 'Julgado procedente o pedido'),
  ('e1290000-0000-4000-8000-000000000002', 'b1290000-0000-4000-8000-00000000000a', 'c1290000-0000-4000-8000-000000000001',
   'f1290000-0000-4000-8000-000000000001', 'projudi', 'm2', now() - interval '10 days', 'Certificado o trânsito em julgado'),
  ('e1290000-0000-4000-8000-000000000003', 'b1290000-0000-4000-8000-00000000000a', 'c1290000-0000-4000-8000-000000000001',
   'f1290000-0000-4000-8000-000000000001', 'projudi', 'm3', now() - interval '5 days', 'Expedido alvará eletrônico'),
  ('e1290000-0000-4000-8000-000000000004', 'b1290000-0000-4000-8000-00000000000a', 'c1290000-0000-4000-8000-000000000001',
   'f1290000-0000-4000-8000-000000000001', 'projudi', 'm4', now() - interval '1 day', 'Arquivado definitivamente'),
  ('e1290000-0000-4000-8000-000000000005', 'b1290000-0000-4000-8000-00000000000b', 'c1290000-0000-4000-8000-000000000003',
   'f1290000-0000-4000-8000-000000000003', 'projudi', 'm5', now() - interval '1 day', 'Arquivado definitivamente');

create function pg_temp.sign_in(person uuid, aal text default 'aal2', session uuid default null)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal, 'session_id', session))::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text, session uuid default null) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, 'aal2', session);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  set local role service_role;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

-- ---------- Only the backend records what ONE read ----------

select pg_temp.sign_in('a1290000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.record_movement_outcome('e1290000-0000-4000-8000-000000000001', '{"kind": "sentenca", "result": "procedente"}') $$,
  '42501', null, 'nobody of a firm records what ONE read');
reset role;

select pg_temp.as_backend('m1', $$public.record_movement_outcome('e1290000-0000-4000-8000-000000000001', '{"kind": "sentenca", "result": "procedente"}')$$);
select pg_temp.as_backend('m1-again', $$public.record_movement_outcome('e1290000-0000-4000-8000-000000000001', '{"kind": "sentenca", "result": "procedente"}')$$);
select pg_temp.as_backend('m2', $$public.record_movement_outcome('e1290000-0000-4000-8000-000000000002', '{"kind": "transito"}')$$);
select pg_temp.as_backend('m3', $$public.record_movement_outcome('e1290000-0000-4000-8000-000000000003', '{"kind": "alvara", "release_kind": "alvara"}')$$);
select ok(
  pg_temp.got('m1', '{code}') = 'recorded' and pg_temp.got('m1-again', '{code}') = 'read_before'
    and (select count(*) = 3 and bool_and(by_one and confirmed and source = 'rule')
         from public.lawsuit_facts where case_id = 'c1290000-0000-4000-8000-000000000001')
    and (select ack_owed from public.lawsuit_facts where kind = 'transito')
    and (select not ack_owed from public.lawsuit_facts where kind = 'sentenca'),
  'ONE records each fact a movement says once, as ONE''s; the judgment become final asks the lawyers'' awareness'
);

-- The judgment's words complete the judgment the movement said, and a release's words its value.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id, category, triaged_at, judgment)
values ('d1290000-0000-4000-8000-000000000001', 'b1290000-0000-4000-8000-00000000000a', 'hash-resultado-1', 'TJGO', '10003012720998090100',
        current_date - 19, 'Intimação', 'JULGO PROCEDENTE ... R$ 5.000,00 por autor', 'f1290000-0000-4000-8000-000000000001',
        'c1290000-0000-4000-8000-000000000001', 'decisao', now(), true),
       ('d1290000-0000-4000-8000-000000000002', 'b1290000-0000-4000-8000-00000000000a', 'hash-resultado-2', 'TJGO', '10003012720998090100',
        current_date - 4, 'Intimação', 'Expeça-se alvará no valor de R$ 10.000,00', 'f1290000-0000-4000-8000-000000000001',
        'c1290000-0000-4000-8000-000000000001', 'pagamento', now(), null);
select pg_temp.as_backend('p1', $$public.record_publication_outcome('d1290000-0000-4000-8000-000000000001',
  '{"kind": "sentenca", "result": "procedente", "cents": "500000", "per_claimant": true, "words": "JULGO PROCEDENTE"}')$$);
select pg_temp.as_backend('p2', $$public.record_publication_outcome('d1290000-0000-4000-8000-000000000002',
  '{"kind": "alvara", "cents": "1000000", "words": "Expeça-se alvará no valor de R$ 10.000,00"}')$$);
select ok(
  (select count(*) = 1 and bool_and(cents = 500000 and per_claimant and words is not null)
   from public.lawsuit_facts where kind = 'sentenca' and case_id = 'c1290000-0000-4000-8000-000000000001')
    and pg_temp.got('p2', '{code}') = 'completed'
    and (select cents = 1000000 from public.lawsuit_facts where kind = 'alvara'),
  'the judgment''s words complete the judgment the movement said, and a release''s words its value: nothing twice'
);

-- ---------- The release received, and ONE closes the case ----------

select pg_temp.as_backend('m4', $$public.record_movement_outcome('e1290000-0000-4000-8000-000000000004', '{"kind": "arquivamento"}')$$);
select pg_temp.as_backend('close-before', $$to_jsonb(public.close_cases_by_one(50))$$);
select pg_temp.as_person('a1290000-0000-4000-8000-000000000002', 'received-bia',
  format($$public.act_on_lawsuit_fact(%L, 'received', '{"cents": "1000000", "received_on": "%s"}')$$,
    (select id from public.lawsuit_facts where kind = 'alvara'), current_date));
select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'received',
  format($$public.act_on_lawsuit_fact(%L, 'received', '{"cents": "1000000", "received_on": "%s"}')$$,
    (select id from public.lawsuit_facts where kind = 'alvara'), current_date));
select pg_temp.as_backend('close', $$to_jsonb(public.close_cases_by_one(50))$$);
select ok(
  pg_temp.got('close-before', '{}') = '0' and pg_temp.got('received-bia', '{code}') = 'not_allowed'
    and pg_temp.got('received', '{ok}') = 'true' and pg_temp.got('close', '{}') = '1'
    and (select status = 'closed' and closed_by_one and close_acked_at is null from public.cases
         where id = 'c1290000-0000-4000-8000-000000000001'),
  'ONE closes the case only once every lawsuit was archived and the release received, said as ONE''s'
);

select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'attention',
  $$public.firm_outcome_attention('b1290000-0000-4000-8000-00000000000a')$$);
select ok(
  (select jsonb_array_length(value -> 'acks') = 2 and jsonb_array_length(value -> 'closed_by_one') = 1
          and jsonb_array_length(value -> 'releases') = 0 from res where key = 'attention'),
  'the lawyers are asked to be aware of the final judgment, the archiving and the case ONE closed'
);

select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'ack',
  format($$public.act_on_lawsuit_fact(%L, 'ack')$$, (select id from public.lawsuit_facts where kind = 'transito')));
select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'ack-close',
  $$public.acknowledge_case_closure('c1290000-0000-4000-8000-000000000001')$$);
select ok(
  (select acked_by = 'a1290000-0000-4000-8000-000000000001' from public.lawsuit_facts where kind = 'transito')
    and (select close_acked_at is not null from public.cases where id = 'c1290000-0000-4000-8000-000000000001')
    and exists (select 1 from public.case_events e where e.case_id = 'c1290000-0000-4000-8000-000000000001'
                and e.kind = 'outcome_recorded' and not (e.data ? 'cents')),
  'a lawyer says they are aware; the timeline says each fact''s kind, never a value'
);

-- ---------- By hand, and corrected ----------

select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'hand',
  format($$public.save_lawsuit_fact('f1290000-0000-4000-8000-000000000002', '{"kind": "sentenca", "result": "improcedente", "happened_on": "%s"}')$$,
    current_date - 2));
select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'hand-twice',
  format($$public.save_lawsuit_fact('f1290000-0000-4000-8000-000000000002', '{"kind": "sentenca", "result": "procedente", "happened_on": "%s"}')$$,
    current_date - 2));
select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'correct',
  format($$public.act_on_lawsuit_fact(%L, 'correct', '{"reason": "Era sentença de outro processo."}')$$,
    pg_temp.got('hand', '{fact_id}')));
select ok(
  pg_temp.got('hand', '{ok}') = 'true' and pg_temp.got('hand-twice', '{code}') = 'fact_exists'
    and (select ack_owed and source = 'person' and not by_one and corrected_reason = 'Era sentença de outro processo.'
         from public.lawsuit_facts where id = pg_temp.got('hand', '{fact_id}')::uuid),
  'a person records a judgment by hand, a judgment against the client asks awareness, and a fact is corrected, never deleted'
);

-- ---------- A firm that keeps the result to a person ----------

select pg_temp.as_backend('rocha-m5', $$public.record_movement_outcome('e1290000-0000-4000-8000-000000000005', '{"kind": "arquivamento"}')$$);
select pg_temp.as_backend('rocha-close', $$to_jsonb(public.close_cases_by_one(50))$$);
select pg_temp.as_person('a1290000-0000-4000-8000-000000000005', 'rocha-attention',
  $$public.firm_outcome_attention('b1290000-0000-4000-8000-00000000000b')$$);
select ok(
  (select not confirmed and by_one from public.lawsuit_facts where case_id = 'c1290000-0000-4000-8000-000000000003')
    and pg_temp.got('rocha-close', '{}') = '0'
    and (select status = 'filed' from public.cases where id = 'c1290000-0000-4000-8000-000000000003')
    and (select jsonb_array_length(value -> 'unconfirmed') = 1 from res where key = 'rocha-attention'),
  'where the firm keeps the result to a person, what ONE read waits for a person and closes nothing'
);

select pg_temp.as_person('a1290000-0000-4000-8000-000000000005', 'rocha-confirm',
  format($$public.act_on_lawsuit_fact(%L, 'confirm')$$,
    (select id from public.lawsuit_facts where case_id = 'c1290000-0000-4000-8000-000000000003')));
select pg_temp.as_person('a1290000-0000-4000-8000-000000000005', 'rocha-attention-2',
  $$public.firm_outcome_attention('b1290000-0000-4000-8000-00000000000b')$$);
select ok(
  pg_temp.got('rocha-confirm', '{ok}') = 'true'
    and (select jsonb_array_length(value -> 'ready_to_close') = 1 from res where key = 'rocha-attention-2'),
  'confirmed, the case is ready to close and waits for a person there'
);

-- ---------- The other firm, and a support visit ----------

select pg_temp.sign_in('a1290000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('rocha-reads', to_jsonb((select count(*) from public.lawsuit_facts
  where org_id = 'b1290000-0000-4000-8000-00000000000a')));
reset role;
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1290000-0000-4000-8000-000000000005', 'a1290000-0000-4000-8000-000000000001', 'b1290000-0000-4000-8000-00000000000a',
        'Conferindo o resultado', 'f2290000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.as_person('a1290000-0000-4000-8000-000000000001', 'visit',
  format($$public.save_lawsuit_fact('f1290000-0000-4000-8000-000000000002', '{"kind": "deposito", "happened_on": "%s"}')$$,
    current_date), 'f2290000-0000-4000-8000-000000000001');
select ok(
  pg_temp.got('rocha-reads', '{}') = '0' and pg_temp.got('visit', '{code}') = 'support_visit',
  'another firm reads nothing of the facts, and a support visit writes none'
);

select * from finish();
rollback;
