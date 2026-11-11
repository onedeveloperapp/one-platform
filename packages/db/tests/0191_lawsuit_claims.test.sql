begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The result of each claim of a lawsuit (0193). Lima has three cases in
-- court. In the first, a movement says the judgment and its publication then
-- says what it decided of each claim: the publication's claims are kept,
-- cleaned of what is no claim. In the second, a judgment read before 0193
-- from a movement alone waits to be read again from its words, once, by the
-- backend. In the third, a partner records the judgment by hand with its
-- claims. The firm's numbers carry them; Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1910000-0000-4000-8000-000000000001', 'ana@lima-pedidos.invalid', 'Ana Lima'),
  ('a1910000-0000-4000-8000-000000000005', 'edu@rocha-pedidos.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1910000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-pedidos', 'a1910000-0000-4000-8000-000000000001'),
  ('b1910000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-pedidos', 'a1910000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1910000-0000-4000-8000-00000000000a', 'a1910000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1910000-0000-4000-8000-00000000000b', 'a1910000-0000-4000-8000-000000000005', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1910000-0000-4000-8000-000000000001', 'b1910000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1910000-0000-4000-8000-000000000002', 'b1910000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'cancellation', 'filed'),
  ('c1910000-0000-4000-8000-000000000003', 'b1910000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1910000-0000-4000-8000-000000000001', 'b1910000-0000-4000-8000-00000000000a', 'c1910000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01'),
  ('f1910000-0000-4000-8000-000000000002', 'b1910000-0000-4000-8000-00000000000a', 'c1910000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003021220998090100', '2026-09-02'),
  ('f1910000-0000-4000-8000-000000000003', 'b1910000-0000-4000-8000-00000000000a', 'c1910000-0000-4000-8000-000000000003',
   'juizado', 'TJGO', 'filed', '10003039420998090100', '2026-09-03');
insert into public.movements (id, org_id, case_id, proceeding_id, source, source_id, occurred_at, title) values
  ('e1910000-0000-4000-8000-000000000001', 'b1910000-0000-4000-8000-00000000000a', 'c1910000-0000-4000-8000-000000000001',
   'f1910000-0000-4000-8000-000000000001', 'projudi', 'p1', now() - interval '20 days', 'Julgado parcialmente procedente o pedido'),
  ('e1910000-0000-4000-8000-000000000002', 'b1910000-0000-4000-8000-00000000000a', 'c1910000-0000-4000-8000-000000000002',
   'f1910000-0000-4000-8000-000000000002', 'projudi', 'p2', now() - interval '15 days', 'Julgado procedente o pedido');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
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
create function pg_temp.judgment(target_case uuid) returns public.lawsuit_facts language sql as $$
  select * from public.lawsuit_facts where case_id = target_case and kind = 'sentenca' and corrected_at is null;
$$;

-- ---------- A judgment from a movement, completed by its publication ----------

select pg_temp.as_backend('m1', $$public.record_movement_outcome('e1910000-0000-4000-8000-000000000001', '{"kind": "sentenca", "result": "parcial"}')$$);
select ok(
  (select claims is null and claims_read_at is null from pg_temp.judgment('c1910000-0000-4000-8000-000000000001')),
  'a judgment a movement said has no claims yet, and waits to be read'
);

insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id, category, triaged_at, judgment)
values ('d1910000-0000-4000-8000-000000000001', 'b1910000-0000-4000-8000-00000000000a', 'hash-pedidos-1', 'TJGO', '10003012720998090100',
        current_date - 19, 'Intimação', 'JULGO PARCIALMENTE PROCEDENTE ...', 'f1910000-0000-4000-8000-000000000001',
        'c1910000-0000-4000-8000-000000000001', 'decisao', now(), true);
select pg_temp.as_backend('p1', format($$public.record_publication_outcome('d1910000-0000-4000-8000-000000000001', %L::jsonb)$$,
  jsonb_build_object('kind', 'sentenca', 'result', 'parcial', 'cents', '500000', 'per_claimant', true,
    'words', 'JULGO PARCIALMENTE PROCEDENTE', 'claims', jsonb_build_array(
      jsonb_build_object('claim', 'danos_morais', 'result', 'concedido', 'cents', '500000', 'per_claimant', true),
      jsonb_build_object('claim', 'danos_materiais', 'result', 'negado', 'cents', '90000', 'per_claimant', true),
      jsonb_build_object('claim', 'danos_morais', 'result', 'negado'),
      jsonb_build_object('claim', 'honra', 'result', 'concedido'),
      jsonb_build_object('claim', 'restituicao', 'result', 'talvez'),
      'nada'))));
select ok(
  pg_temp.got('p1', '{code}') = 'recorded'
    and (select claims = '[{"claim": "danos_morais", "result": "concedido", "cents": 500000, "per_claimant": true},
                           {"claim": "danos_materiais", "result": "negado", "cents": null, "per_claimant": false}]'::jsonb
           and claims_read_at is not null
         from pg_temp.judgment('c1910000-0000-4000-8000-000000000001'))
    and (select count(*) = 1 from public.lawsuit_facts where case_id = 'c1910000-0000-4000-8000-000000000001' and kind = 'sentenca'),
  'the judgment''s publication completes it with each claim, once each, a denial with no value, and nothing that is no claim'
);

-- ---------- A judgment read before, read again from its words ----------

select pg_temp.as_backend('m2', $$public.record_movement_outcome('e1910000-0000-4000-8000-000000000002', '{"kind": "sentenca", "result": "procedente"}')$$);
select pg_temp.sign_in('a1910000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$ select public.record_fact_claims(%L, '[]'::jsonb) $$, (select id from public.lawsuit_facts where case_id = 'c1910000-0000-4000-8000-000000000002')),
  '42501', null, 'nobody of a firm records what the rule read of a judgment''s claims');
reset role;
select pg_temp.as_backend('again', format($$public.record_fact_claims(%L, %L::jsonb)$$,
  (pg_temp.judgment('c1910000-0000-4000-8000-000000000002')).id,
  jsonb_build_array(jsonb_build_object('claim', 'restituicao', 'result', 'concedido', 'cents', '85000'))));
select pg_temp.as_backend('again-twice', format($$public.record_fact_claims(%L, '[]'::jsonb)$$,
  (pg_temp.judgment('c1910000-0000-4000-8000-000000000002')).id));
select ok(
  pg_temp.got('again', '{code}') = 'recorded' and pg_temp.got('again-twice', '{code}') = 'read_before'
    and (select claims -> 0 ->> 'claim' = 'restituicao' and (claims -> 0 ->> 'cents')::bigint = 85000
         from pg_temp.judgment('c1910000-0000-4000-8000-000000000002')),
  'a judgment read before is read again from its words once, by the backend'
);

-- ---------- A person records the judgment with its claims ----------

select pg_temp.as_person('a1910000-0000-4000-8000-000000000001', 'by-hand',
  format($$public.save_lawsuit_fact('f1910000-0000-4000-8000-000000000003', %L::jsonb)$$, jsonb_build_object(
    'kind', 'sentenca', 'result', 'parcial', 'happened_on', current_date - 3,
    'claims', jsonb_build_array(
      jsonb_build_object('claim', 'danos_morais', 'result', 'concedido', 'cents', '300000'),
      jsonb_build_object('claim', 'lucros_cessantes', 'result', 'negado')))));
select ok(
  pg_temp.got('by-hand', '{ok}') = 'true'
    and (select jsonb_array_length(claims) = 2 and claims_read_at is not null and source = 'person'
         from pg_temp.judgment('c1910000-0000-4000-8000-000000000003')),
  'a partner records a judgment by hand with what it decided of each claim'
);

-- ---------- The firm's numbers carry the claims ----------

select pg_temp.as_person('a1910000-0000-4000-8000-000000000001', 'numbers',
  $$public.firm_lawsuit_numbers('b1910000-0000-4000-8000-00000000000a')$$);
select ok(
  (select count(*) = 3 and count(*) filter (where jsonb_typeof(r -> 'claims') = 'array') = 3
   from jsonb_array_elements((select value -> 'rows' from res where key = 'numbers')) r),
  'the firm''s numbers carry each judgment''s claims'
);

select pg_temp.sign_in('a1910000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$ select public.firm_lawsuit_numbers('b1910000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'another firm reads nothing of Lima''s');
reset role;

select * from finish();
rollback;
