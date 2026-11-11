begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- What a publication asks (0186): a triaged publication of a case owes a
-- reading; the backend claims it and the database keeps only what fits the
-- list, read from the run; the client's link shows the client's summary and
-- what the firm asks of them. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1840000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-acao.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1840000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-acao.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1840000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-acao', 'a1840000-0000-4000-8000-000000000001'),
  ('b1840000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-acao', 'a1840000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1840000-0000-4000-8000-00000000000a', 'a1840000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1840000-0000-4000-8000-00000000000b', 'a1840000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.people (id, org_id, full_name) values
  ('d1840000-0000-4000-8000-000000000001', 'b1840000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1840000-0000-4000-8000-000000000001', 'b1840000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (org_id, case_id, person_id, role) values
  ('b1840000-0000-4000-8000-00000000000a', 'c1840000-0000-4000-8000-000000000001', 'd1840000-0000-4000-8000-000000000001', 'claimant');
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b1840000-0000-4000-8000-00000000000a', 'c1840000-0000-4000-8000-000000000001', 'd1840000-0000-4000-8000-000000000001',
   encode(sha256(convert_to('token-da-acao', 'UTF8')), 'hex'), now() + interval '30 days');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1840000-0000-4000-8000-000000000001', 'b1840000-0000-4000-8000-00000000000a', 'c1840000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, head, case_id, proceeding_id, category, triaged_at)
values ('a9840000-0000-4000-8000-000000000001', 'b1840000-0000-4000-8000-00000000000a', 'hash-acao-0001', 'TJGO',
        '10003012720998090100', current_date, 'Intimação', 'Intime-se a parte autora para juntar o comprovante de residência.',
        'Intime-se a parte autora', 'c1840000-0000-4000-8000-000000000001', 'f1840000-0000-4000-8000-000000000001',
        'prazo', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.run(org uuid, answer jsonb) returns uuid language plpgsql as $$
declare
  made uuid := gen_random_uuid();
begin
  insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
  select made, org, 'publicacao.acao', v.id, 'fake', 'fake', repeat('a', 64), 'succeeded', answer, now()
  from public.prompt_versions v where v.task = 'publicacao.acao' and v.is_active;
  return made;
end;
$$;

select ok(
  (select status = 'owed' from public.publication_actions where publication_id = 'a9840000-0000-4000-8000-000000000001'),
  'a triaged publication of a case owes what it asks'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res select 'claim', jsonb_build_object('id', c.action_id, 'claim', c.claim) from public.claim_publication_actions(5) c;
insert into res values ('to-write', public.publication_action_to_write(pg_temp.got('claim', 'id')::uuid, pg_temp.got('claim', 'claim')::integer));
reset role;
insert into res values ('run', jsonb_build_object('id', pg_temp.run('b1840000-0000-4000-8000-00000000000a', jsonb_build_object(
  'resumo_escritorio', 'O juiz pediu o comprovante de residência da autora.',
  'resumo_cliente', 'O juiz pediu o seu comprovante de endereço.',
  'acao', 'juntar_documento', 'motivo', 'A intimação pede o comprovante.',
  'pendencias', jsonb_build_array(
    jsonb_build_object('de', 'cliente', 'tipo', 'documento', 'texto', 'Envie um comprovante de endereço recente.'),
    jsonb_build_object('de', 'outro', 'tipo', 'documento', 'texto', 'Fora da lista.'))))));
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('recorded', public.record_publication_action(pg_temp.got('claim', 'id')::uuid,
  pg_temp.got('claim', 'claim')::integer, 'done', pg_temp.got('run', 'id')::uuid));
insert into res values ('news', public.client_link_publication_news('token-da-acao'));
reset role;

select ok(
  pg_temp.got('to-write', 'category') = 'prazo'
  and pg_temp.got('recorded', 'code') = 'done'
  and (select status = 'done' and action = 'juntar_documento' and jsonb_array_length(pending) = 1
       from public.publication_actions where publication_id = 'a9840000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e where e.kind = 'publication_action' and e.actor_type = 'ai'),
  'the answer is read from the run and kept only where it fits the list'
);

select ok(
  (select payload #>> '{items,0,summary}' = 'O juiz pediu o seu comprovante de endereço.'
          and payload #>> '{items,0,asks,0}' = 'Envie um comprovante de endereço recente.'
   from res where name = 'news'),
  'the client reads the client''s summary and what the firm asks of them'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1840000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.publication_actions), 0, 'another firm reads nothing of it');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.claim_publication_actions(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_publication_action(uuid, integer, text, uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.publication_actions', 'INSERT'),
  'only the backend reads and records what a publication asks'
);

select * from finish();
rollback;
